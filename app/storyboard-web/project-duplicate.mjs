import { randomUUID } from "node:crypto";
import { normalizeTitle, PROJECT_ID_PATTERN } from "./project-scope.mjs";
import { listReusableAssetRows, sanitizeProvenance } from "./visual-store.mjs";
import { expandStoryboardFrames, placement } from "./visual-model.mjs";

function databaseFailure() {
  return { ok: false, httpStatus: 503, kind: "database" };
}

function notFound() {
  return { ok: false, httpStatus: 404, kind: "not-found" };
}

function invalidRequest() {
  return { ok: false, httpStatus: 400, kind: "invalid-request" };
}

function iso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeApprovalSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((frame) => ({
    id: frame?.id,
    panels: Array.isArray(frame?.panels) ? frame.panels.map((panel) => ({
      assetId: panel?.assetId ?? null,
      zoom: panel?.zoom,
      position: panel?.position,
      mirrored: panel?.mirrored === true,
    })) : [],
  }));
}

function remapProvenance(value, maps) {
  const clean = sanitizeProvenance(value);
  if (!clean) return null;
  const rewrite = (key, table) => {
    if (!Object.hasOwn(clean, key)) return;
    const next = table.get(clean[key]);
    if (next) clean[key] = next;
    else delete clean[key];
  };
  rewrite("storyboardResultId", maps.results);
  rewrite("styleAssetId", maps.assets);
  rewrite("sourceAssetId", maps.assets);
  rewrite("anchorVersionId", maps.anchors);
  return Object.keys(clean).length ? clean : null;
}

function visualSnapshot(frames, states, assetIdFor) {
  const byKey = new Map(states.map((state) => [`${state.frame_id}:${state.panel_index}`, state]));
  return expandStoryboardFrames(frames).map((frame) => ({
    id: frame.id,
    panels: (frame.panels || []).map((panel, panelIndex) => {
      const state = byKey.get(`${frame.id}:${panelIndex}`);
      const placed = placement({
        zoom: state?.zoom ?? 1,
        positionX: state?.position_x ?? 50,
        positionY: state?.position_y ?? 30,
        mirrored: state?.mirrored === true,
      });
      const assetId = state ? assetIdFor(state.effective_asset_id) : null;
      return {
        assetId,
        zoom: placed.zoom,
        position: placed.position,
        mirrored: placed.mirrored,
      };
    }),
  }));
}

async function effectivePanelState(client, state) {
  let assetId = state.current_asset_id;
  let origin = state.current_asset_origin;
  if (!assetId && state.assigned_asset_id) {
    assetId = state.assigned_asset_id;
    origin = state.assignment_origin;
  }
  if (!assetId && state.current_generation_id) {
    const generation = await client.query(
      `SELECT output_asset_id, status FROM panel_generation WHERE id = $1`,
      [state.current_generation_id],
    );
    if (generation.rows[0]?.status === "ready" && generation.rows[0].output_asset_id) {
      assetId = generation.rows[0].output_asset_id;
      origin = "generation";
    }
  }
  return { ...state, effective_asset_id: assetId, effective_origin: assetId ? origin : null };
}

async function copyOwnedAssets(client, sourceProjectId, destinationId, assetIds, maps) {
  const ids = [...assetIds].filter(Boolean);
  if (!ids.length) return;
  const rows = await client.query(
    `SELECT id, kind, mime, width, height, byte_length, sha256, bytes, provenance
     FROM visual_asset
     WHERE project_id = $1 AND id = ANY($2::uuid[])`,
    [sourceProjectId, ids],
  );
  for (const row of rows.rows) {
    if (!maps.assets.has(row.id)) maps.assets.set(row.id, randomUUID());
    maps.assetRows.set(row.id, row);
  }
  for (const row of rows.rows) {
    const provenance = remapProvenance(row.provenance, maps);
    await client.query(
      `INSERT INTO visual_asset (
         id, project_id, kind, mime, width, height, byte_length, sha256, bytes, provenance
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        maps.assets.get(row.id),
        destinationId,
        row.kind,
        row.mime,
        row.width,
        row.height,
        row.byte_length,
        row.sha256,
        row.bytes,
        provenance ? JSON.stringify(provenance) : null,
      ],
    );
  }
}

function mappedAsset(maps, assetId) {
  if (!assetId) return null;
  return maps.assets.get(assetId) ?? null;
}

function styleSeedUnavailable() {
  const error = new Error("style-seed-anchor-unavailable");
  error.code = "STYLE_SEED_ANCHOR_UNAVAILABLE";
  return error;
}

async function insertCopiedAnchor(client, anchor, destinationAnchorId, materialStateId, maps) {
  await client.query(
    `INSERT INTO character_anchor_version (
       id, material_state_id, character_name, parent_anchor_version_id,
       identity_asset_id, output_asset_id, instruction, status, error_kind,
       provider_metadata, created_at, approved_at, style_asset_id, provenance
     ) VALUES (
       $1, $2, $3, NULL, $4, $5, $6, 'approved', NULL, NULL, $7, $8, $9, $10
     )`,
    [
      destinationAnchorId,
      materialStateId,
      anchor.character_name,
      mappedAsset(maps, anchor.identity_asset_id),
      mappedAsset(maps, anchor.output_asset_id),
      anchor.instruction || "",
      anchor.created_at,
      anchor.approved_at,
      mappedAsset(maps, anchor.style_asset_id),
      anchor.provenance,
    ],
  );
}

async function copyActiveGraph(client, { sourceProjectId, destinationId, materialId }) {
  const material = await client.query(
    `SELECT material_state.id,
            material_state.source_revision_id,
            material_state.interpretation_id,
            source_revision.text,
            source_revision.project_id
     FROM material_state
     JOIN source_revision ON source_revision.id = material_state.source_revision_id
     WHERE material_state.id = $1`,
    [materialId],
  );
  if (material.rowCount !== 1 || material.rows[0].project_id !== sourceProjectId) {
    throw new Error("source-material-mismatch");
  }
  const source = material.rows[0];
  const readingId = randomUUID();
  const revisionId = randomUUID();
  const interpretationId = randomUUID();
  const nextMaterialId = randomUUID();
  await client.query(
    `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
     VALUES ($1, $2, $3, $4, 'ready')`,
    [readingId, destinationId, source.text, randomUUID()],
  );
  await client.query(
    `INSERT INTO source_revision (id, project_id, parent_source_revision_id, text)
     VALUES ($1, $2, NULL, $3)`,
    [revisionId, destinationId, source.text],
  );
  await client.query(
    `INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)`,
    [interpretationId, revisionId, readingId],
  );
  const items = await client.query(
    `SELECT ordinal, model_id, kind, speaker_status, speaker_label, draft_start, draft_end, source_quote, spoken_text
     FROM source_item WHERE interpretation_id = $1 ORDER BY ordinal`,
    [source.interpretation_id],
  );
  for (const item of items.rows) {
    await client.query(
      `INSERT INTO source_item (
         interpretation_id, ordinal, model_id, kind, speaker_status, speaker_label,
         draft_start, draft_end, source_quote, spoken_text
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        interpretationId,
        item.ordinal,
        item.model_id,
        item.kind,
        item.speaker_status,
        item.speaker_label,
        item.draft_start,
        item.draft_end,
        item.source_quote,
        item.spoken_text,
      ],
    );
  }
  const provisional = await client.query(
    `SELECT model_id, name FROM provisional_character WHERE interpretation_id = $1`,
    [source.interpretation_id],
  );
  for (const character of provisional.rows) {
    await client.query(
      `INSERT INTO provisional_character (interpretation_id, model_id, name) VALUES ($1, $2, $3)`,
      [interpretationId, character.model_id, character.name],
    );
  }
  const surfaces = await client.query(
    `SELECT model_id, quote, role, proposed_character_model_id
     FROM surface_form WHERE interpretation_id = $1`,
    [source.interpretation_id],
  );
  for (const form of surfaces.rows) {
    await client.query(
      `INSERT INTO surface_form (interpretation_id, model_id, quote, role, proposed_character_model_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [interpretationId, form.model_id, form.quote, form.role, form.proposed_character_model_id],
    );
  }
  await client.query(
    `INSERT INTO material_state (id, source_revision_id, interpretation_id, parent_material_state_id)
     VALUES ($1, $2, $3, NULL)`,
    [nextMaterialId, revisionId, interpretationId],
  );
  const characters = await client.query(
    `SELECT id, ordinal, name, included, extracted_name
     FROM canonical_character WHERE material_state_id = $1 ORDER BY ordinal, id`,
    [materialId],
  );
  const characterIds = new Map();
  for (const character of characters.rows) {
    const id = randomUUID();
    characterIds.set(character.id, id);
    await client.query(
      `INSERT INTO canonical_character (id, material_state_id, ordinal, name, included, extracted_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, nextMaterialId, character.ordinal, character.name, character.included, character.extracted_name],
    );
  }
  const aliases = await client.query(
    `SELECT surface_text, character_id FROM alias WHERE material_state_id = $1`,
    [materialId],
  );
  for (const alias of aliases.rows) {
    const characterId = characterIds.get(alias.character_id);
    if (!characterId) throw new Error("alias-character-missing");
    await client.query(
      `INSERT INTO alias (id, material_state_id, surface_text, character_id) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), nextMaterialId, alias.surface_text, characterId],
    );
  }
  const speakers = await client.query(
    `SELECT source_item_model_id, character_id FROM speaker_assignment WHERE material_state_id = $1`,
    [materialId],
  );
  for (const speaker of speakers.rows) {
    const characterId = characterIds.get(speaker.character_id);
    if (!characterId) throw new Error("speaker-character-missing");
    await client.query(
      `INSERT INTO speaker_assignment (material_state_id, source_item_model_id, character_id)
       VALUES ($1, $2, $3)`,
      [nextMaterialId, speaker.source_item_model_id, characterId],
    );
  }
  await client.query(
    `UPDATE project
     SET active_source_revision_id = $2, active_material_state_id = $3
     WHERE id = $1`,
    [destinationId, revisionId, nextMaterialId],
  );

  const storyboard = await copyStoryboard(client, {
    sourceProjectId,
    destinationId,
    materialId,
    nextMaterialId,
  });
  return {
    hasMaterial: true,
    hasStoryboard: storyboard.hasStoryboard,
    hasVisual: storyboard.hasVisual,
    visualApproved: storyboard.visualApproved,
  };
}

async function copyStoryboard(client, {
  sourceProjectId,
  destinationId,
  materialId,
  nextMaterialId,
}) {
  const result = await client.query(
    `SELECT id, stage_payload, failures
     FROM storyboard_result
     WHERE material_state_id = $1 AND status = 'checked'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [materialId],
  );
  const anchors = await client.query(
    `SELECT character_anchor_version.*
     FROM character_anchor_head
     JOIN character_anchor_version
       ON character_anchor_version.id = character_anchor_head.anchor_version_id
     WHERE character_anchor_head.material_state_id = $1
       AND character_anchor_version.status = 'approved'`,
    [materialId],
  );
  const identities = await client.query(
    `SELECT character_name, current_asset_id, comment
     FROM character_identity WHERE material_state_id = $1`,
    [materialId],
  );
  const seed = await client.query(
    `SELECT style_asset_id, source_anchor_version_id FROM project_style_seed WHERE material_state_id = $1`,
    [materialId],
  );
  let seedAnchor = null;
  if (seed.rowCount === 1) {
    const loaded = await client.query(
      `SELECT character_anchor_version.*
       FROM character_anchor_version
       JOIN material_state ON material_state.id = character_anchor_version.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE character_anchor_version.id = $1
         AND source_revision.project_id = $2
         AND character_anchor_version.status = 'approved'`,
      [seed.rows[0].source_anchor_version_id, sourceProjectId],
    );
    if (loaded.rowCount !== 1) throw styleSeedUnavailable();
    seedAnchor = loaded.rows[0];
  }
  let version = null;
  let states = [];
  if (result.rowCount === 1) {
    const head = await client.query(
      `SELECT storyboard_version.id, storyboard_version.frames
       FROM storyboard_head
       JOIN storyboard_version ON storyboard_version.id = storyboard_head.active_storyboard_version_id
       WHERE storyboard_head.storyboard_result_id = $1`,
      [result.rows[0].id],
    );
    version = head.rows[0] ?? null;
    if (version) {
      const panelRows = await client.query(
        `SELECT * FROM panel_visual_state WHERE storyboard_version_id = $1 ORDER BY frame_id, panel_index`,
        [version.id],
      );
      states = [];
      for (const row of panelRows.rows) states.push(await effectivePanelState(client, row));
    }
  }

  const maps = {
    assets: new Map(),
    assetRows: new Map(),
    anchors: new Map(),
    results: new Map(),
  };
  const assetIds = new Set();
  const reusableIds = [];
  const remember = (assetId) => {
    if (assetId) assetIds.add(assetId);
  };
  if (result.rowCount === 1) {
    const reusable = await listReusableAssetRows(client, result.rows[0].id, sourceProjectId);
    for (const row of reusable.rows) {
      reusableIds.push(row.id);
      remember(row.id);
    }
  }
  for (const state of states) {
    remember(state.effective_asset_id);
    remember(state.assigned_asset_id);
    remember(state.performance_asset_id);
  }
  for (const anchor of anchors.rows) {
    maps.anchors.set(anchor.id, randomUUID());
    remember(anchor.identity_asset_id);
    remember(anchor.output_asset_id);
    remember(anchor.style_asset_id);
  }
  if (seedAnchor && !maps.anchors.has(seedAnchor.id)) {
    maps.anchors.set(seedAnchor.id, randomUUID());
    remember(seedAnchor.identity_asset_id);
    remember(seedAnchor.output_asset_id);
    remember(seedAnchor.style_asset_id);
  }
  for (const identity of identities.rows) remember(identity.current_asset_id);
  if (seed.rowCount === 1) remember(seed.rows[0].style_asset_id);

  let nextResultId = null;
  let nextVersionId = null;
  let frames = [];
  if (result.rowCount === 1) {
    nextResultId = randomUUID();
    maps.results.set(result.rows[0].id, nextResultId);
    const payload = result.rows[0].stage_payload && typeof result.rows[0].stage_payload === "object"
      ? result.rows[0].stage_payload
      : {};
    frames = version && Array.isArray(version.frames)
      ? version.frames
      : (Array.isArray(payload.frames) ? payload.frames : []);
    await client.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, failures, stage_payload)
       VALUES ($1, $2, 'checked', $3::jsonb, $4::jsonb)`,
      [
        nextResultId,
        nextMaterialId,
        result.rows[0].failures == null ? null : JSON.stringify(result.rows[0].failures),
        JSON.stringify(payload),
      ],
    );
    nextVersionId = randomUUID();
    await client.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, parent_storyboard_version_id, instruction, frames, operation_context)
       VALUES ($1, $2, NULL, NULL, $3::jsonb, NULL)`,
      [nextVersionId, nextResultId, JSON.stringify(frames)],
    );
    await client.query(
      `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
      [nextResultId, nextVersionId],
    );
  }

  await copyOwnedAssets(client, sourceProjectId, destinationId, assetIds, maps);
  if (nextResultId) {
    for (const sourceAssetId of reusableIds) {
      const destinationAssetId = mappedAsset(maps, sourceAssetId);
      if (!destinationAssetId) throw new Error("reusable-asset-unavailable");
      await client.query(
        `INSERT INTO storyboard_reusable_asset (storyboard_result_id, asset_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [nextResultId, destinationAssetId],
      );
    }
  }

  for (const identity of identities.rows) {
    const assetId = mappedAsset(maps, identity.current_asset_id);
    if (!assetId) continue;
    await client.query(
      `INSERT INTO character_identity (material_state_id, character_name, current_asset_id, comment)
       VALUES ($1, $2, $3, $4)`,
      [nextMaterialId, identity.character_name, assetId, identity.comment ?? ""],
    );
  }
  for (const anchor of anchors.rows) {
    await insertCopiedAnchor(client, anchor, maps.anchors.get(anchor.id), nextMaterialId, maps);
    await client.query(
      `INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
       VALUES ($1, $2, $3)`,
      [nextMaterialId, anchor.character_name, maps.anchors.get(anchor.id)],
    );
  }
  if (seed.rowCount === 1) {
    const sourceAnchorId = seed.rows[0].source_anchor_version_id;
    const destinationAnchorId = maps.anchors.get(sourceAnchorId);
    const styleAssetId = mappedAsset(maps, seed.rows[0].style_asset_id);
    if (!destinationAnchorId || !styleAssetId) throw styleSeedUnavailable();
    const copiedAsHead = anchors.rows.some((anchor) => anchor.id === sourceAnchorId);
    if (!copiedAsHead) {
      await insertCopiedAnchor(client, seedAnchor, destinationAnchorId, nextMaterialId, maps);
    }
    await client.query(
      `INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
       VALUES ($1, $2, $3)`,
      [nextMaterialId, styleAssetId, destinationAnchorId],
    );
  }
  for (const state of states) {
    const currentId = mappedAsset(maps, state.effective_asset_id);
    const assignedId = mappedAsset(maps, state.assigned_asset_id);
    const performanceId = mappedAsset(maps, state.performance_asset_id);
    await client.query(
      `INSERT INTO panel_visual_state (
         id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
         performance_asset_id, current_generation_id, zoom, position_x, position_y, mirrored,
         assigned_asset_id, assignment_origin, current_asset_id, current_asset_origin
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, NULL, $8, $9, $10, $11,
         $12, $13, $14, $15
       )`,
      [
        randomUUID(),
        nextVersionId,
        state.frame_id,
        state.panel_index,
        state.panel_id,
        state.subject,
        performanceId,
        state.zoom,
        state.position_x,
        state.position_y,
        state.mirrored === true,
        assignedId,
        assignedId ? state.assignment_origin : null,
        currentId,
        currentId ? state.effective_origin : null,
      ],
    );
  }

  let visualApproved = false;
  if (version && nextVersionId) {
    const approval = await client.query(
      `SELECT snapshot FROM visual_approval
       WHERE storyboard_version_id = $1
       ORDER BY approved_at DESC, id DESC
       LIMIT 1`,
      [version.id],
    );
    const current = visualSnapshot(frames, states, (assetId) => assetId ?? null);
    if (approval.rowCount === 1
      && JSON.stringify(normalizeApprovalSnapshot(approval.rows[0].snapshot))
        === JSON.stringify(normalizeApprovalSnapshot(current))) {
      const copied = visualSnapshot(frames, states, (assetId) => mappedAsset(maps, assetId));
      await client.query(
        `INSERT INTO visual_approval (id, storyboard_version_id, snapshot)
         VALUES ($1, $2, $3::jsonb)`,
        [randomUUID(), nextVersionId, JSON.stringify(copied)],
      );
      visualApproved = true;
    }
  }

  const hasVisual = states.some((state) => mappedAsset(maps, state.effective_asset_id))
    || anchors.rows.length > 0;
  return {
    hasStoryboard: result.rowCount === 1,
    hasVisual,
    visualApproved,
  };
}

export async function duplicateProject(pool, sourceProjectId, title, options = {}) {
  if (!PROJECT_ID_PATTERN.test(String(sourceProjectId ?? ""))) return notFound();
  const nextTitle = normalizeTitle(title);
  if (!nextTitle) return invalidRequest();
  const destinationId = randomUUID();
  let client;
  try {
    client = await pool.connect();
  } catch {
    return databaseFailure();
  }
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const source = await client.query(
      `SELECT id, active_material_state_id
       FROM project
       WHERE id = $1
       FOR UPDATE`,
      [sourceProjectId],
    );
    if (source.rowCount !== 1) {
      await client.query("ROLLBACK");
      return notFound();
    }
    const draft = await client.query(
      `SELECT text FROM working_draft WHERE project_id = $1 FOR UPDATE`,
      [sourceProjectId],
    );
    if (draft.rowCount !== 1) {
      await client.query("ROLLBACK");
      return notFound();
    }
    const inserted = await client.query(
      `INSERT INTO project (id, title, created_at, updated_at)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp())
       RETURNING created_at, updated_at`,
      [destinationId, nextTitle],
    );
    await client.query(
      `INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, $2, $3)`,
      [destinationId, draft.rows[0].text, randomUUID()],
    );
    await client.query(
      `INSERT INTO character_exclusion (project_id, extracted_name)
       SELECT $2, extracted_name FROM character_exclusion WHERE project_id = $1`,
      [sourceProjectId, destinationId],
    );
    const flags = source.rows[0].active_material_state_id
      ? await copyActiveGraph(client, {
        sourceProjectId,
        destinationId,
        materialId: source.rows[0].active_material_state_id,
      })
      : { hasMaterial: false, hasStoryboard: false, hasVisual: false, visualApproved: false };
    if (options.afterCopy) await options.afterCopy(client, { destinationId });
    await client.query("COMMIT");
    return {
      ok: true,
      destinationId,
      title: nextTitle,
      draftText: draft.rows[0].text,
      createdAt: iso(inserted.rows[0].created_at),
      updatedAt: iso(inserted.rows[0].updated_at),
      ...flags,
    };
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return databaseFailure();
  } finally {
    client.release();
  }
}
