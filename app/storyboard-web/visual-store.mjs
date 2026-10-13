import { randomUUID } from "node:crypto";
import { applyOperation, ensurePanelIds, persistenceMode, preservePanelIdentity } from "./assembly.mjs";
import { inspectImage, parseIdentityImage } from "./image-info.mjs";
import { presentFrameTiming } from "./timing.mjs";
import {
  expandStoryboardFrames,
  placement,
  resolvePanelSubject,
  resolvePlacementUpdate,
} from "./visual-model.mjs";

function failed(kind, httpStatus = 400) {
  return { ok: false, status: "failed", kind, httpStatus };
}

function assetUrl(id) {
  return id ? `/api/visual/assets/${id}` : null;
}

async function withClient(pool, fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function activeResult(client) {
  const result = await client.query(`
    SELECT storyboard_result.id,
           storyboard_result.material_state_id,
           storyboard_result.stage_payload
    FROM project
    JOIN storyboard_result
      ON storyboard_result.material_state_id = project.active_material_state_id
    WHERE project.singleton = true
      AND storyboard_result.status = 'checked'
    ORDER BY storyboard_result.created_at DESC, storyboard_result.id DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

async function castFor(client, materialStateId) {
  const characters = await client.query(`
    SELECT name FROM canonical_character
    WHERE material_state_id = $1
    ORDER BY ordinal, id
  `, [materialStateId]);
  const aliases = await client.query(`
    SELECT alias.surface_text, canonical_character.name
    FROM alias
    JOIN canonical_character ON canonical_character.id = alias.character_id
    WHERE alias.material_state_id = $1
    ORDER BY alias.surface_text, canonical_character.name
  `, [materialStateId]);
  return {
    characters: characters.rows.map((row) => ({ name: row.name })),
    aliases: aliases.rows.map((row) => ({ surface: row.surface_text, characterName: row.name })),
  };
}

async function ensureVersion(client) {
  const result = await activeResult(client);
  if (!result) return null;
  const head = await client.query(`
    SELECT storyboard_version.id,
           storyboard_version.parent_storyboard_version_id,
           storyboard_version.frames,
           storyboard_version.instruction
    FROM storyboard_head
    JOIN storyboard_version ON storyboard_version.id = storyboard_head.active_storyboard_version_id
    WHERE storyboard_head.storyboard_result_id = $1
  `, [result.id]);
  if (head.rowCount === 1) return { result, version: head.rows[0] };
  const id = randomUUID();
  const frames = Array.isArray(result.stage_payload?.frames) ? result.stage_payload.frames : [];
  await client.query(
    `INSERT INTO storyboard_version (id, storyboard_result_id, frames)
     VALUES ($1, $2, $3::jsonb)`,
    [id, result.id, JSON.stringify(frames)],
  );
  await client.query(
    `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id)
     VALUES ($1, $2)`,
    [result.id, id],
  );
  return { result, version: { id, parent_storyboard_version_id: null, frames, instruction: null } };
}

async function persistPanelIds(client, context) {
  const identified = ensurePanelIds(context.version.frames);
  if (!identified.changed) return context;
  await client.query(
    `UPDATE storyboard_version SET frames = $2::jsonb WHERE id = $1`,
    [context.version.id, JSON.stringify(identified.frames)],
  );
  context.version.frames = identified.frames;
  return context;
}

async function backfillPanelIds(client, versionId, frames) {
  for (const frame of expandStoryboardFrames(frames)) {
    for (let index = 0; index < (frame.panels || []).length; index += 1) {
      const panelId = frame.panels[index]?.id;
      if (!panelId) continue;
      await client.query(`
        UPDATE panel_visual_state
        SET panel_id = $4
        WHERE storyboard_version_id = $1 AND frame_id = $2 AND panel_index = $3 AND panel_id IS NULL
      `, [versionId, frame.id, index, panelId]);
    }
  }
}

async function copyPanelState(client, fromVersionId, toVersionId, frames) {
  for (const frame of expandStoryboardFrames(frames)) {
    for (let index = 0; index < (frame.panels || []).length; index += 1) {
      const panelId = frame.panels[index]?.id;
      if (!panelId) continue;
      await client.query(`
        INSERT INTO panel_visual_state (
          id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
          performance_asset_id, current_generation_id, zoom, position_x, position_y, mirrored,
          assigned_asset_id, assignment_origin
        )
        SELECT $1, $2, $3, $4, panel_id, subject,
               performance_asset_id, current_generation_id, zoom, position_x, position_y, mirrored,
               assigned_asset_id, assignment_origin
        FROM panel_visual_state
        WHERE storyboard_version_id = $5 AND panel_id = $6
        ON CONFLICT DO NOTHING
      `, [randomUUID(), toVersionId, frame.id, index, fromVersionId, panelId]);
    }
  }
}

async function lockHead(client, resultId) {
  await client.query(
    `SELECT active_storyboard_version_id FROM storyboard_head WHERE storyboard_result_id = $1 FOR UPDATE`,
    [resultId],
  );
}

async function ensurePanelRows(client, context, cast) {
  const frames = expandStoryboardFrames(context.version.frames);
  for (const frame of frames) {
    for (let panelIndex = 0; panelIndex < (frame.panels || []).length; panelIndex += 1) {
      const panel = frame.panels[panelIndex];
      const subject = resolvePanelSubject(panel.description, cast.characters, cast.aliases);
      await client.query(`
        INSERT INTO panel_visual_state (
          id, storyboard_version_id, frame_id, panel_index, panel_id, subject
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (storyboard_version_id, frame_id, panel_index)
        DO UPDATE SET subject = EXCLUDED.subject,
                      panel_id = COALESCE(panel_visual_state.panel_id, EXCLUDED.panel_id)
      `, [randomUUID(), context.version.id, frame.id, panelIndex, panel.id ?? null, subject]);
    }
  }
}

async function assetRow(client, assetId) {
  if (!assetId) return null;
  const result = await client.query(
    `SELECT id, kind, mime, width, height, byte_length, sha256, bytes
     FROM visual_asset WHERE id = $1`,
    [assetId],
  );
  return result.rows[0] ?? null;
}

function imageBytes(image) {
  return image?.bytes ?? image?.buffer ?? null;
}

function invalidImageError() {
  const error = new Error("invalid-image");
  error.kind = "invalid-image";
  return error;
}

async function insertAsset(client, kind, image) {
  const bytes = imageBytes(image);
  const inspected = bytes ? inspectImage(bytes) : { mime: null };
  if (!inspected.mime || !["image/png", "image/jpeg", "image/webp"].includes(inspected.mime)) {
    throw invalidImageError();
  }
  const id = randomUUID();
  await client.query(`
    INSERT INTO visual_asset (id, kind, mime, width, height, byte_length, sha256, bytes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [id, kind, inspected.mime, inspected.width, inspected.height, inspected.byteLength, inspected.sha256, bytes]);
  return { id, ...inspected };
}

async function currentIdentity(client, materialStateId, characterName) {
  const result = await client.query(`
    SELECT character_identity.current_asset_id,
           character_identity.comment,
           visual_asset.mime,
           visual_asset.width,
           visual_asset.height
    FROM character_identity
    JOIN visual_asset ON visual_asset.id = character_identity.current_asset_id
    WHERE character_identity.material_state_id = $1
      AND character_identity.character_name = $2
  `, [materialStateId, characterName]);
  return result.rows[0] ?? null;
}

async function latestAnchor(client, materialStateId, characterName, { approved = false, identityAssetId = null } = {}) {
  const clauses = ["material_state_id = $1", "character_name = $2"];
  const values = [materialStateId, characterName];
  if (approved) clauses.push("status = 'approved'");
  if (identityAssetId) {
    values.push(identityAssetId);
    clauses.push(`identity_asset_id = $${values.length}`);
  }
  const result = await client.query(`
    SELECT * FROM character_anchor_version
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, values);
  return result.rows[0] ?? null;
}

async function approvedAnchor(client, materialStateId, characterName) {
  const identity = await currentIdentity(client, materialStateId, characterName);
  if (!identity) return null;
  return latestAnchor(client, materialStateId, characterName, {
    approved: true,
    identityAssetId: identity.current_asset_id,
  });
}

async function readStyleSeed(client, materialStateId) {
  const result = await client.query(
    `SELECT material_state_id, style_asset_id, source_anchor_version_id, created_at
     FROM project_style_seed
     WHERE material_state_id = $1`,
    [materialStateId],
  );
  return result.rows[0] ?? null;
}

async function backfillStyleSeed(client, materialStateId) {
  const existing = await readStyleSeed(client, materialStateId);
  if (existing) return existing;
  const approved = await client.query(`
    SELECT id, output_asset_id
    FROM character_anchor_version
    WHERE material_state_id = $1
      AND status = 'approved'
      AND output_asset_id IS NOT NULL
    ORDER BY approved_at NULLS LAST, created_at, id
    LIMIT 1
  `, [materialStateId]);
  if (approved.rowCount !== 1) return null;
  await client.query(`
    INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (material_state_id) DO NOTHING
  `, [materialStateId, approved.rows[0].output_asset_id, approved.rows[0].id]);
  return readStyleSeed(client, materialStateId);
}

async function ensureStyleSeedFromApproval(client, materialStateId, anchorId, styleAssetId) {
  if (!styleAssetId) return readStyleSeed(client, materialStateId);
  await client.query(`
    INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (material_state_id) DO NOTHING
  `, [materialStateId, styleAssetId, anchorId]);
  return readStyleSeed(client, materialStateId);
}

async function projectStyleAsset(client, materialStateId) {
  const seed = await backfillStyleSeed(client, materialStateId);
  if (!seed?.style_asset_id) return null;
  return assetRow(client, seed.style_asset_id);
}

function placementSnapshot(frames) {
  return frames.map((frame) => ({
    id: frame.id,
    panels: frame.panels.map((panel) => ({
      assetId: panel.assetId ?? null,
      zoom: panel.zoom,
      position: panel.position,
      mirrored: panel.mirrored === true,
    })),
  }));
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

function currentSnapshot(frames) {
  return placementSnapshot(frames);
}

async function loadVisualWithClient(client) {
  await client.query("BEGIN");
  try {
    const context = await ensureVersion(client);
    if (!context) {
      await client.query("COMMIT");
      return { ok: true, status: "unavailable" };
    }
    await persistPanelIds(client, context);
    await backfillPanelIds(client, context.version.id, context.version.frames);
    const cast = await castFor(client, context.result.material_state_id);
    await ensurePanelRows(client, context, cast);
    await client.query("COMMIT");

    const states = await client.query(`
      SELECT panel_visual_state.*,
             panel_generation.status AS generation_status,
             panel_generation.anchor_version_id,
             panel_generation.output_asset_id,
             panel_generation.instruction AS generation_instruction
      FROM panel_visual_state
      LEFT JOIN panel_generation ON panel_generation.id = panel_visual_state.current_generation_id
      WHERE panel_visual_state.storyboard_version_id = $1
      ORDER BY panel_visual_state.frame_id, panel_visual_state.panel_index
    `, [context.version.id]);
    const latest = await client.query(`
      SELECT DISTINCT ON (panel_visual_state_id)
             panel_visual_state_id, status, error_kind
      FROM panel_generation
      WHERE panel_visual_state_id IN (
        SELECT id FROM panel_visual_state WHERE storyboard_version_id = $1
      )
      ORDER BY panel_visual_state_id, created_at DESC, id DESC
    `, [context.version.id]);
    const latestByState = new Map(latest.rows.map((row) => [row.panel_visual_state_id, row]));
    const stateByKey = new Map(states.rows.map((row) => [`${row.frame_id}:${row.panel_index}`, row]));

    const anchors = [];
    const approvedByName = new Map();
    for (const character of cast.characters) {
      const identity = await currentIdentity(client, context.result.material_state_id, character.name);
      const candidate = await latestAnchor(client, context.result.material_state_id, character.name, {
        identityAssetId: identity?.current_asset_id ?? null,
      });
      const approved = await approvedAnchor(client, context.result.material_state_id, character.name);
      if (approved) approvedByName.set(character.name, approved.id);
      anchors.push({
        name: character.name,
        identity: identity ? {
          assetId: identity.current_asset_id,
          assetUrl: assetUrl(identity.current_asset_id),
          comment: identity.comment,
          width: identity.width,
          height: identity.height,
        } : null,
        candidate: candidate ? {
          id: candidate.id,
          status: candidate.status,
          errorKind: candidate.error_kind,
          instruction: candidate.instruction,
          assetId: candidate.output_asset_id,
          assetUrl: assetUrl(candidate.output_asset_id),
        } : null,
        approvedAnchorId: approved?.id ?? null,
        approvedAssetId: approved?.output_asset_id ?? null,
        approvedAssetUrl: assetUrl(approved?.output_asset_id),
      });
    }

    const frames = expandStoryboardFrames(context.version.frames).map((frame) => {
      const panels = frame.panels.map((panel, panelIndex) => {
        const state = stateByKey.get(`${frame.id}:${panelIndex}`);
        const latestGeneration = state ? latestByState.get(state.id) : null;
        const anchorCurrent = !state?.subject || (
          state.anchor_version_id && approvedByName.get(state.subject) === state.anchor_version_id
        );
        const assignedId = state?.assigned_asset_id ?? null;
        const generatedId = state?.generation_status === "ready" && anchorCurrent ? state.output_asset_id : null;
        const outputAssetId = assignedId || generatedId;
        const placed = placement({
          zoom: state?.zoom ?? 1,
          positionX: state?.position_x ?? 50,
          positionY: state?.position_y ?? 30,
          mirrored: state?.mirrored === true,
        });
        return {
          ...panel,
          subject: state?.subject ?? null,
          role: Number.isInteger(frame.speakerPanel)
            ? (frame.speakerPanel === panelIndex ? "Говорит" : "Слушает")
            : "Действие",
          stateId: state?.id ?? null,
          assetId: outputAssetId,
          asset: assetUrl(outputAssetId),
          assignmentOrigin: assignedId ? (state?.assignment_origin ?? null) : null,
          ownerDescription: typeof panel.ownerDescription === "string" ? panel.ownerDescription : "",
          performanceAssetId: state?.performance_asset_id ?? null,
          performanceAssetUrl: assetUrl(state?.performance_asset_id),
          generationStatus: latestGeneration?.status ?? null,
          generationError: latestGeneration?.error_kind ?? null,
          instruction: state?.generation_instruction ?? "",
          ...placed,
        };
      });
      const timing = presentFrameTiming(frame);
      const visualReady = frame.frameKind === "text"
        ? Boolean(String(frame.textCard || "").trim())
        : panels.length > 0 && panels.every((panel) => panel.assetId);
      return { ...frame, panels, ...timing, visualReady };
    });
    const complete = frames.length > 0 && frames.every((frame) => frame.visualReady);
    const snapshot = currentSnapshot(frames);
    const approval = await client.query(`
      SELECT id, snapshot, approved_at
      FROM visual_approval
      WHERE storyboard_version_id = $1
      ORDER BY approved_at DESC, id DESC
      LIMIT 1
    `, [context.version.id]);
    const approved = approval.rowCount === 1
      && JSON.stringify(normalizeApprovalSnapshot(approval.rows[0].snapshot)) === JSON.stringify(normalizeApprovalSnapshot(snapshot));
    const styleSeed = await backfillStyleSeed(client, context.result.material_state_id);
    const reusable = await client.query(`
      SELECT DISTINCT a.id, a.kind, a.mime, a.width, a.height
      FROM visual_asset a
      WHERE a.kind IN ('uploaded-image', 'panel-image')
        AND a.id IN (
          SELECT pvs.assigned_asset_id
          FROM panel_visual_state pvs
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $1 AND pvs.assigned_asset_id IS NOT NULL
          UNION
          SELECT pg.output_asset_id
          FROM panel_generation pg
          JOIN panel_visual_state pvs ON pvs.id = pg.panel_visual_state_id
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $1 AND pg.status = 'ready' AND pg.output_asset_id IS NOT NULL
        )
      ORDER BY a.id
    `, [context.result.id]);
    return {
      ok: true,
      status: "ready",
      materialStateId: context.result.material_state_id,
      storyboardResultId: context.result.id,
      storyboardVersionId: context.version.id,
      canUndo: Boolean(context.version.parent_storyboard_version_id),
      instruction: context.version.instruction,
      styleSeedAssetId: styleSeed?.style_asset_id ?? null,
      styleSeedAssetUrl: assetUrl(styleSeed?.style_asset_id),
      characters: anchors,
      allAnchorsApproved: anchors.length > 0 && anchors.every((anchor) => anchor.approvedAnchorId),
      frames,
      reusableAssets: reusable.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        mime: row.mime,
        width: row.width,
        height: row.height,
        url: assetUrl(row.id),
      })),
      complete,
      approved,
      readyForVideo: complete && approved,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function loadVisual(pool) {
  try {
    return await withClient(pool, (client) => loadVisualWithClient(client));
  } catch {
    return failed("database", 503);
  }
}

export async function saveIdentity(pool, { characterName, image, comment = "" }) {
  if (!characterName || !imageBytes(image) || String(comment).length > 4000) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const context = await ensureVersion(client);
      if (!context) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const cast = await castFor(client, context.result.material_state_id);
      if (!cast.characters.some((entry) => entry.name === characterName)) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const asset = await insertAsset(client, "identity-reference", image);
      await client.query(`
        INSERT INTO character_identity (material_state_id, character_name, current_asset_id, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (material_state_id, character_name)
        DO UPDATE SET current_asset_id = EXCLUDED.current_asset_id,
                      comment = EXCLUDED.comment,
                      updated_at = clock_timestamp()
      `, [context.result.material_state_id, characterName, asset.id, String(comment).trim()]);
      await client.query("COMMIT");
      return { ok: true, assetId: asset.id };
    });
  } catch (error) {
    if (error?.kind === "invalid-image") return failed("invalid-image");
    return failed("database", 503);
  }
}

export async function beginAnchor(pool, { characterName, instruction = "" }) {
  if (!characterName || String(instruction).length > 4000) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      if (!context) return failed("not-found", 404);
      const materialStateId = context.result.material_state_id;
      const identity = await currentIdentity(client, materialStateId, characterName);
      if (!identity) return failed("identity-required", 409);
      const parent = await latestAnchor(client, materialStateId, characterName, { identityAssetId: identity.current_asset_id });
      const style = await projectStyleAsset(client, materialStateId);
      const id = randomUUID();
      await client.query(`
        INSERT INTO character_anchor_version (
          id, material_state_id, character_name, parent_anchor_version_id,
          identity_asset_id, style_asset_id, instruction, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      `, [
        id,
        materialStateId,
        characterName,
        parent?.id ?? null,
        identity.current_asset_id,
        style?.id ?? null,
        String(instruction).trim(),
      ]);
      return {
        ok: true,
        id,
        materialStateId,
        characterName,
        identityComment: identity.comment,
        instruction: String(instruction).trim(),
        identity: await assetRow(client, identity.current_asset_id),
        previous: parent?.output_asset_id ? await assetRow(client, parent.output_asset_id) : null,
        style,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function finishAnchor(pool, { id, result }) {
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      if (!result?.ok) {
        await client.query(
          `UPDATE character_anchor_version SET status = 'failed', error_kind = $2, provider_metadata = $3::jsonb
           WHERE id = $1 AND status = 'pending'`,
          [id, result?.kind || "provider", JSON.stringify(result?.diagnostics || {})],
        );
        await client.query("COMMIT");
        return failed(result?.kind || "provider", result?.httpStatus || 502);
      }
      const asset = await insertAsset(client, "base-anchor", result.image);
      await client.query(
        `UPDATE character_anchor_version
         SET status = 'ready', output_asset_id = $2, provider_metadata = $3::jsonb
         WHERE id = $1 AND status = 'pending'`,
        [id, asset.id, JSON.stringify(result.metadata || {})],
      );
      await client.query("COMMIT");
      return { ok: true, anchorId: id, assetId: asset.id };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function approveAnchor(pool, { characterName, anchorId }) {
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      if (!context) return failed("not-found", 404);
      const identity = await currentIdentity(client, context.result.material_state_id, characterName);
      const updated = await client.query(`
        UPDATE character_anchor_version
        SET status = 'approved', approved_at = clock_timestamp()
        WHERE id = $1
          AND material_state_id = $2
          AND character_name = $3
          AND identity_asset_id = $4
          AND status IN ('ready', 'approved')
          AND output_asset_id IS NOT NULL
        RETURNING id, output_asset_id
      `, [anchorId, context.result.material_state_id, characterName, identity?.current_asset_id ?? null]);
      if (updated.rowCount !== 1) return failed("not-found", 404);
      const seed = await ensureStyleSeedFromApproval(
        client,
        context.result.material_state_id,
        updated.rows[0].id,
        updated.rows[0].output_asset_id,
      );
      return {
        ok: true,
        anchorId,
        styleSeedAssetId: seed?.style_asset_id ?? null,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

async function panelContext(client, frameId, panelIndex) {
  const context = await ensureVersion(client);
  if (!context) return null;
  const cast = await castFor(client, context.result.material_state_id);
  await ensurePanelRows(client, context, cast);
  const frame = expandStoryboardFrames(context.version.frames).find((entry) => entry.id === frameId);
  const panel = frame?.panels?.[panelIndex];
  if (!frame || !panel) return null;
  const state = await client.query(`
    SELECT * FROM panel_visual_state
    WHERE storyboard_version_id = $1 AND frame_id = $2 AND panel_index = $3
  `, [context.version.id, frameId, panelIndex]);
  if (state.rowCount !== 1) return null;
  return { context, frame, panel, state: state.rows[0] };
}

export async function beginPanelGeneration(pool, {
  frameId,
  panelIndex,
  instruction = "",
  performanceImage = null,
  clearPerformance = false,
}) {
  if (!frameId || !Number.isInteger(panelIndex) || panelIndex < 0 || String(instruction).length > 4000) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const target = await panelContext(client, frameId, panelIndex);
      if (!target) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      let performanceAssetId = clearPerformance ? null : target.state.performance_asset_id;
      if (performanceImage?.bytes) {
        performanceAssetId = (await insertAsset(client, "performance-reference", performanceImage)).id;
      }
      if (clearPerformance || performanceImage?.bytes) {
        await client.query(
          `UPDATE panel_visual_state SET performance_asset_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
          [target.state.id, performanceAssetId],
        );
      }
      const subject = target.state.subject;
      const anchor = subject ? await approvedAnchor(client, target.context.result.material_state_id, subject) : null;
      if (subject && !anchor) {
        await client.query("ROLLBACK");
        return failed("anchor-required", 409);
      }
      const style = await projectStyleAsset(client, target.context.result.material_state_id);
      const parent = target.state.current_generation_id
        ? (await client.query("SELECT * FROM panel_generation WHERE id = $1", [target.state.current_generation_id])).rows[0]
        : null;
      const id = randomUUID();
      await client.query(`
        INSERT INTO panel_generation (
          id, panel_visual_state_id, parent_generation_id, anchor_version_id,
          performance_asset_id, resolved_description, instruction, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      `, [
        id,
        target.state.id,
        parent?.id ?? null,
        anchor?.id ?? null,
        performanceAssetId,
        target.panel.description,
        String(instruction).trim(),
      ]);
      const refs = {
        anchor: anchor?.output_asset_id ? await assetRow(client, anchor.output_asset_id) : null,
        previous: parent?.output_asset_id ? await assetRow(client, parent.output_asset_id) : null,
        performance: performanceAssetId ? await assetRow(client, performanceAssetId) : null,
        style: style && style.id !== anchor?.output_asset_id ? style : null,
      };
      await client.query("COMMIT");
      return {
        ok: true,
        id,
        materialStateId: target.context.result.material_state_id,
        storyboardVersionId: target.context.version.id,
        frame: target.frame,
        panel: target.panel,
        panelIndex,
        subject,
        instruction: String(instruction).trim(),
        refs,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function finishPanelGeneration(pool, { id, result }) {
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const generation = await client.query("SELECT * FROM panel_generation WHERE id = $1 FOR UPDATE", [id]);
      if (generation.rowCount !== 1 || generation.rows[0].status !== "pending") {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      if (!result?.ok) {
        await client.query(
          `UPDATE panel_generation SET status = 'failed', error_kind = $2, provider_metadata = $3::jsonb WHERE id = $1`,
          [id, result?.kind || "provider", JSON.stringify(result?.diagnostics || {})],
        );
        await client.query("COMMIT");
        return failed(result?.kind || "provider", result?.httpStatus || 502);
      }
      const asset = await insertAsset(client, "panel-image", result.image);
      await client.query(
        `UPDATE panel_generation
         SET status = 'ready', output_asset_id = $2, provider_metadata = $3::jsonb
         WHERE id = $1`,
        [id, asset.id, JSON.stringify(result.metadata || {})],
      );
      await client.query(
        `UPDATE panel_visual_state
         SET current_generation_id = $2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [generation.rows[0].panel_visual_state_id, id],
      );
      await client.query("COMMIT");
      return { ok: true, generationId: id, assetId: asset.id };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function updatePlacement(pool, input = {}) {
  const { frameId, panelIndex } = input;
  if (!frameId || !Number.isInteger(panelIndex) || panelIndex < 0) return failed("invalid-request");
  if (input.reset != null && input.reset !== true && input.reset !== false) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      const target = await panelContext(client, frameId, panelIndex);
      if (!target) return failed("not-found", 404);
      const resolved = resolvePlacementUpdate(target.state, input);
      if (!resolved) return failed("invalid-request");
      const updated = await client.query(`
        UPDATE panel_visual_state
        SET zoom = $2, position_x = $3, position_y = $4, mirrored = $5, updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING zoom, position_x, position_y, mirrored
      `, [target.state.id, resolved.zoom, resolved.positionX, resolved.positionY, resolved.mirrored]);
      const row = updated.rows[0];
      return {
        ok: true,
        placement: {
          zoom: Number(row.zoom),
          positionX: Number(row.position_x),
          positionY: Number(row.position_y),
          mirrored: row.mirrored === true,
        },
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function saveStoryboardEdit(pool, { instruction, frames }) {
  if (!String(instruction ?? "").trim() || !Array.isArray(frames) || frames.length === 0) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      let current = await ensureVersion(client);
      if (!current) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      await lockHead(client, current.result.id);
      current = await ensureVersion(client);
      await persistPanelIds(client, current);
      await backfillPanelIds(client, current.version.id, current.version.frames);
      const id = randomUUID();
      const nextFrames = preservePanelIdentity(current.version.frames, frames);
      await client.query(`
        INSERT INTO storyboard_version (
          id, storyboard_result_id, parent_storyboard_version_id, instruction, frames
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [id, current.result.id, current.version.id, String(instruction).trim(), JSON.stringify(nextFrames)]);
      await copyPanelState(client, current.version.id, id, nextFrames);
      await client.query(
        `UPDATE storyboard_head SET active_storyboard_version_id = $2 WHERE storyboard_result_id = $1`,
        [current.result.id, id],
      );
      await client.query("COMMIT");
      return { ok: true, storyboardVersionId: id };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function undoStoryboardEdit(pool) {
  try {
    return await withClient(pool, async (client) => {
      const current = await ensureVersion(client);
      const parent = current?.version?.parent_storyboard_version_id;
      if (!current || !parent) return failed("nothing-to-undo", 409);
      await client.query(
        `UPDATE storyboard_head SET active_storyboard_version_id = $2 WHERE storyboard_result_id = $1`,
        [current.result.id, parent],
      );
      return { ok: true, storyboardVersionId: parent };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function approveVisual(pool) {
  try {
    return await withClient(pool, async (client) => {
      const visual = await loadVisualWithClient(client);
      if (!visual.ok || visual.status !== "ready") return failed("not-found", 404);
      if (!visual.allAnchorsApproved || !visual.complete) return failed("visual-incomplete", 409);
      const snapshot = currentSnapshot(visual.frames);
      const id = randomUUID();
      await client.query(
        `INSERT INTO visual_approval (id, storyboard_version_id, snapshot)
         VALUES ($1, $2, $3::jsonb)`,
        [id, visual.storyboardVersionId, JSON.stringify(snapshot)],
      );
      return { ok: true, approvalId: id, readyForVideo: true };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function readAsset(pool, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ""))) return null;
  try {
    return await withClient(pool, (client) => assetRow(client, id));
  } catch {
    return null;
  }
}

export async function loadStoryboardStructure(pool) {
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      return context
        ? { ok: true, storyboardVersionId: context.version.id, frames: context.version.frames }
        : failed("not-found", 404);
    });
  } catch {
    return failed("database", 503);
  }
}

async function assetIsReusable(client, storyboardResultId, assetId) {
  if (typeof assetId !== "string" || !assetId) return false;
  const result = await client.query(`
    SELECT 1
    FROM visual_asset a
    WHERE a.id = $1
      AND a.kind IN ('uploaded-image', 'panel-image')
      AND (
        EXISTS (
          SELECT 1
          FROM panel_visual_state pvs
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $2 AND pvs.assigned_asset_id = a.id
        )
        OR EXISTS (
          SELECT 1
          FROM panel_generation pg
          JOIN panel_visual_state pvs ON pvs.id = pg.panel_visual_state_id
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $2
            AND pg.status = 'ready'
            AND pg.output_asset_id = a.id
        )
      )
  `, [assetId, storyboardResultId]);
  return result.rowCount > 0;
}

async function applyAssignment(client, current, operation) {
  const targets = Array.isArray(operation.targets) ? operation.targets : [];
  const panelIds = targets.map((target) => target?.panelId).filter((id) => typeof id === "string" && id);
  if (!panelIds.length || panelIds.length !== targets.length) return failed("panel-not-found");
  let assetId = operation.assetId;
  let origin = "reuse";
  if (operation.op === "uploadAsset") {
    const image = parseIdentityImage(operation.imageDataUrl);
    if (!image.ok) return failed(image.kind);
    const existing = await client.query(`
      SELECT id FROM visual_asset
      WHERE sha256 = $1 AND kind IN ('uploaded-image', 'panel-image')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `, [image.sha256]);
    if (existing.rowCount === 1) {
      assetId = existing.rows[0].id;
      origin = "reuse";
    } else {
      const inserted = await insertAsset(client, "uploaded-image", image);
      assetId = inserted.id;
      origin = "upload";
    }
  } else if (!(await assetIsReusable(client, current.result.id, assetId))) {
    return failed("asset-not-reusable");
  }
  const rows = await client.query(`
    SELECT panel_id FROM panel_visual_state
    WHERE storyboard_version_id = $1 AND panel_id = ANY($2::text[])
  `, [current.version.id, panelIds]);
  if (rows.rowCount !== new Set(panelIds).size) return failed("panel-not-found");
  for (const panelId of new Set(panelIds)) {
    await client.query(`
      UPDATE panel_visual_state
      SET assigned_asset_id = $3, assignment_origin = $4, updated_at = clock_timestamp()
      WHERE storyboard_version_id = $1 AND panel_id = $2
    `, [current.version.id, panelId, assetId, origin]);
  }
  return { ok: true, context: current, assetId };
}

async function applyLockedOperation(client, current, operation) {
  if (operation.op === "uploadAsset" || operation.op === "assignAsset") {
    return applyAssignment(client, current, operation);
  }
  const applied = applyOperation(current.version.frames, operation);
  if (!applied.ok) return failed(applied.kind);
  if (persistenceMode(operation.op) === "current") {
    await client.query(
      `UPDATE storyboard_version SET frames = $2::jsonb WHERE id = $1`,
      [current.version.id, JSON.stringify(applied.frames)],
    );
    current.version.frames = applied.frames;
    return { ok: true, context: current };
  }
  const versionId = randomUUID();
  await client.query(`
    INSERT INTO storyboard_version (
      id, storyboard_result_id, parent_storyboard_version_id, instruction, frames
    ) VALUES ($1, $2, $3, $4, $5::jsonb)
  `, [versionId, current.result.id, current.version.id, operation.op, JSON.stringify(applied.frames)]);
  await copyPanelState(client, current.version.id, versionId, applied.frames);
  await client.query(
    `UPDATE storyboard_head SET active_storyboard_version_id = $2 WHERE storyboard_result_id = $1`,
    [current.result.id, versionId],
  );
  const cast = await castFor(client, current.result.material_state_id);
  const next = {
    result: current.result,
    version: {
      id: versionId,
      parent_storyboard_version_id: current.version.id,
      frames: applied.frames,
      instruction: operation.op,
    },
  };
  await ensurePanelRows(client, next, cast);
  return { ok: true, context: next };
}

export async function applyProductOperation(pool, input) {
  const operations = input?.op === "batch" ? input.operations : [input];
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 40) {
    return failed("invalid-operation");
  }
  if (operations.some((operation) => !operation || typeof operation.op !== "string" || operation.op === "batch")) {
    return failed("invalid-operation");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      let current = await ensureVersion(client);
      if (!current) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      await lockHead(client, current.result.id);
      current = await ensureVersion(client);
      await persistPanelIds(client, current);
      await backfillPanelIds(client, current.version.id, current.version.frames);
      const cast = await castFor(client, current.result.material_state_id);
      await ensurePanelRows(client, current, cast);
      for (const operation of operations) {
        const result = await applyLockedOperation(client, current, operation);
        if (!result.ok) {
          await client.query("ROLLBACK");
          return result;
        }
        if (result.context) current = result.context;
      }
      await client.query("COMMIT");
      return { ok: true, storyboardVersionId: current.version.id };
    });
  } catch (error) {
    if (error?.kind === "invalid-image") return failed("invalid-image");
    return failed("database", 503);
  }
}

export function createVisualStore(pool) {
  return {
    load: () => loadVisual(pool),
    saveIdentity: (input) => saveIdentity(pool, input),
    beginAnchor: (input) => beginAnchor(pool, input),
    finishAnchor: (input) => finishAnchor(pool, input),
    approveAnchor: (input) => approveAnchor(pool, input),
    beginPanelGeneration: (input) => beginPanelGeneration(pool, input),
    finishPanelGeneration: (input) => finishPanelGeneration(pool, input),
    updatePlacement: (input) => updatePlacement(pool, input),
    saveStoryboardEdit: (input) => saveStoryboardEdit(pool, input),
    undoStoryboardEdit: () => undoStoryboardEdit(pool),
    approveVisual: () => approveVisual(pool),
    applyOperation: (input) => applyProductOperation(pool, input),
    readAsset: (id) => readAsset(pool, id),
    loadStructure: () => loadStoryboardStructure(pool),
  };
}
