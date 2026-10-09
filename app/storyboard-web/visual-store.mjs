import { randomUUID } from "node:crypto";
import { inspectImage } from "./image-info.mjs";
import { normalizeProviderOutcome, resolveImageProviderConfig } from "./image-provider.mjs";
import { extractChromakeyMatte } from "./image-matte.mjs";
import { buildHybridVisualIntent } from "./visual-intent.mjs";
import {
  compileCharacterStatePrompt,
  compileSceneBackgroundPrompt,
  expandStoryboardFrames,
  HYBRID_PROMPT_COMPILER_VERSION,
  isEligibleHybridDialogueFrame,
  placement,
  resolvePanelSubject,
} from "./visual-model.mjs";

const PRIMARY_SCENE_KEY = "primary";
const HYBRID_COMPOSITION_MODES = new Set([
  "near-frontal-pair",
  "inward-conversation",
  "asymmetric-pair",
]);
const OPERATION_PHASES = new Set([
  "queued",
  "preparing-background",
  "generating-background",
  "generating-character-states",
  "assembling",
  "complete",
  "failed",
]);

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

async function ensurePanelRows(client, context, cast) {
  const frames = expandStoryboardFrames(context.version.frames);
  for (const frame of frames) {
    for (let panelIndex = 0; panelIndex < (frame.panels || []).length; panelIndex += 1) {
      const panel = frame.panels[panelIndex];
      const subject = resolvePanelSubject(panel.description, cast.characters, cast.aliases);
      await client.query(`
        INSERT INTO panel_visual_state (id, storyboard_version_id, frame_id, panel_index, subject)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (storyboard_version_id, frame_id, panel_index)
        DO UPDATE SET subject = EXCLUDED.subject
      `, [randomUUID(), context.version.id, frame.id, panelIndex, subject]);
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

function currentSnapshot(frames) {
  return frames.map((frame) => ({
    id: frame.id,
    panels: frame.panels.map((panel) => ({
      assetId: panel.assetId ?? null,
      zoom: panel.zoom,
      position: panel.position,
    })),
  }));
}

async function loadVisualWithClient(client) {
  await client.query("BEGIN");
  try {
    const context = await ensureVersion(client);
    if (!context) {
      await client.query("COMMIT");
      return { ok: true, status: "unavailable" };
    }
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

    const styleSeed = await backfillStyleSeed(client, context.result.material_state_id);
    const hybridRows = await client.query(`
      SELECT * FROM frame_hybrid_state
      WHERE storyboard_version_id = $1
    `, [context.version.id]);
    const hybridByFrame = new Map(hybridRows.rows.map((row) => [row.frame_id, row]));
    const sceneQuery = await client.query(
      `SELECT * FROM scene_background_state
       WHERE storyboard_version_id = $1 AND scene_key = $2`,
      [context.version.id, PRIMARY_SCENE_KEY],
    );
    const sceneState = sceneQuery.rows[0] ?? null;
    const sceneGeneration = sceneState?.current_generation_id
      ? (await client.query(
        `SELECT * FROM scene_background_generation WHERE id = $1`,
        [sceneState.current_generation_id],
      )).rows[0]
      : null;
    const characterIds = states.rows
      .map((row) => row.current_character_generation_id)
      .filter(Boolean);
    const characterRows = characterIds.length
      ? await client.query(`
          SELECT * FROM character_visual_state_generation
          WHERE id = ANY($1::uuid[])
        `, [characterIds])
      : { rows: [] };
    const characterById = new Map(characterRows.rows.map((row) => [row.id, row]));
    const operationIds = [
      ...hybridRows.rows.map((row) => row.active_operation_id).filter(Boolean),
    ];
    const operations = operationIds.length
      ? await client.query(`SELECT * FROM visual_frame_operation WHERE id = ANY($1::uuid[])`, [operationIds])
      : { rows: [] };
    const operationById = new Map(operations.rows.map((row) => [row.id, row]));

    const frames = expandStoryboardFrames(context.version.frames).map((frame) => {
      const hybridRow = hybridByFrame.get(frame.id) ?? null;
      const hybridAttempted = Boolean(hybridRow);
      const operation = hybridRow?.active_operation_id
        ? operationById.get(hybridRow.active_operation_id) ?? null
        : null;
      const compositionMode = hybridRow?.composition_mode || "near-frontal-pair";
      const intentBuilt = isEligibleHybridDialogueFrame(frame) || hybridAttempted
        ? buildHybridVisualIntent({
          project: {
            styleSeedAssetId: styleSeed?.style_asset_id ?? null,
            visualDirection: "project-style-seed",
          },
          scene: {
            sceneKey: PRIMARY_SCENE_KEY,
            continuity: "shared dialogue interior",
          },
          frame: { ...frame, compositionMode },
          panels: frame.panels.map((panel, panelIndex) => ({
            ...panel,
            subject: stateByKey.get(`${frame.id}:${panelIndex}`)?.subject ?? panel.subject,
            panelIndex,
          })),
        })
        : null;

      const panels = frame.panels.map((panel, panelIndex) => {
        const state = stateByKey.get(`${frame.id}:${panelIndex}`);
        const latestGeneration = state ? latestByState.get(state.id) : null;
        const anchorCurrent = !state?.subject || (
          state.anchor_version_id && approvedByName.get(state.subject) === state.anchor_version_id
        );
        const historicalAssetId = state?.generation_status === "ready" && anchorCurrent
          ? state.output_asset_id
          : null;
        const character = state?.current_character_generation_id
          ? characterById.get(state.current_character_generation_id)
          : null;
        const characterReady = character?.status === "ready" && character.output_asset_id;
        const placed = placement({
          zoom: state?.zoom ?? 1,
          positionX: state?.position_x ?? 50,
          positionY: state?.position_y ?? 30,
        });
        return {
          ...panel,
          subject: state?.subject ?? null,
          role: Number.isInteger(frame.speakerPanel)
            ? (frame.speakerPanel === panelIndex ? "Говорит" : "Слушает")
            : "Действие",
          stateId: state?.id ?? null,
          assetId: historicalAssetId,
          asset: assetUrl(historicalAssetId),
          characterAssetId: characterReady ? character.output_asset_id : null,
          characterAsset: assetUrl(characterReady ? character.output_asset_id : null),
          characterStatus: character?.status ?? null,
          characterErrorKind: character?.error_kind ?? null,
          performanceAssetId: state?.performance_asset_id ?? null,
          performanceAssetUrl: assetUrl(state?.performance_asset_id),
          generationStatus: latestGeneration?.status ?? null,
          generationError: latestGeneration?.error_kind ?? null,
          instruction: state?.generation_instruction ?? "",
          fitMode: state?.fit_mode ?? "manual",
          positionX: Number(state?.position_x ?? 50),
          positionY: Number(state?.position_y ?? 30),
          ...placed,
        };
      });

      const backgroundReady = sceneGeneration?.status === "ready" && sceneGeneration.output_asset_id;
      const charactersReady = panels.length > 0 && panels.every((panel) => panel.characterAssetId);
      const assemblyStatus = hybridRow?.assembly_status ?? "not-ready";
      const hybridVisualReady = Boolean(
        backgroundReady && charactersReady && assemblyStatus === "ready",
      );
      const historicalVisualReady = panels.length > 0 && panels.every((panel) => panel.assetId);
      // Precedence: hybrid wins when ready; after a hybrid attempt begins, never claim
      // historical full-panel assets as successful hybrid completion.
      const visualReady = hybridAttempted
        ? hybridVisualReady
        : historicalVisualReady;

      const hybrid = hybridAttempted || isEligibleHybridDialogueFrame(frame)
        ? {
          sceneKey: PRIMARY_SCENE_KEY,
          compositionMode,
          assemblyStatus,
          activeOperationId: hybridRow?.active_operation_id ?? null,
          operation: operation ? {
            operationId: operation.id,
            phase: operation.phase,
            status: operation.status,
            errorKind: operation.error_kind,
            writeVersion: Number(operation.write_version),
          } : null,
          background: {
            status: backgroundReady
              ? "ready"
              : (sceneGeneration?.status || (sceneState?.active_operation_id ? "pending" : "missing")),
            assetId: backgroundReady ? sceneGeneration.output_asset_id : null,
            asset: assetUrl(backgroundReady ? sceneGeneration.output_asset_id : null),
          },
          panels: panels.map((panel, panelIndex) => ({
            panelIndex,
            subject: panel.subject,
            status: panel.characterStatus
              || (panel.characterAssetId ? "ready" : "missing"),
            assetId: panel.characterAssetId,
            errorKind: panel.characterErrorKind,
            zoom: panel.zoom,
            positionX: panel.positionX,
            positionY: panel.positionY,
            fitMode: panel.fitMode,
          })),
        }
        : null;

      return {
        ...frame,
        panels,
        visualReady,
        gridDescription: intentBuilt?.gridDescription ?? null,
        detailedBrief: intentBuilt?.detailedBrief ?? null,
        hybrid,
      };
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
    const approved = approval.rowCount === 1 && JSON.stringify(approval.rows[0].snapshot) === JSON.stringify(snapshot);
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

export async function updatePlacement(pool, {
  frameId,
  panelIndex,
  zoom,
  positionX,
  positionY,
  fitMode = "manual",
} = {}) {
  const numbers = [zoom, positionX, positionY].map(Number);
  const mode = fitMode == null || fitMode === "" ? "manual" : String(fitMode);
  if (!frameId || !Number.isInteger(panelIndex) || panelIndex < 0
      || !numbers.every(Number.isFinite)
      || numbers[0] < 1 || numbers[0] > 3
      || numbers[1] < 0 || numbers[1] > 100
      || numbers[2] < 0 || numbers[2] > 100
      || (mode !== "manual" && mode !== "fit")) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      const target = await panelContext(client, frameId, panelIndex);
      if (!target) return failed("not-found", 404);
      await client.query(`
        UPDATE panel_visual_state
        SET zoom = $2,
            position_x = $3,
            position_y = $4,
            fit_mode = $5,
            updated_at = clock_timestamp()
        WHERE id = $1
      `, [target.state.id, ...numbers, mode]);
      return { ok: true, fitMode: mode };
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
      const current = await ensureVersion(client);
      if (!current) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const id = randomUUID();
      await client.query(`
        INSERT INTO storyboard_version (
          id, storyboard_result_id, parent_storyboard_version_id, instruction, frames
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
      `, [id, current.result.id, current.version.id, String(instruction).trim(), JSON.stringify(frames)]);
      const oldFrames = new Map(expandStoryboardFrames(current.version.frames).map((frame) => [frame.id, frame]));
      for (const frame of expandStoryboardFrames(frames)) {
        const old = oldFrames.get(frame.id);
        if (!old || old.layout !== frame.layout || old.panels.length !== frame.panels.length) continue;
        for (let index = 0; index < frame.panels.length; index += 1) {
          if (old.panels[index]?.description !== frame.panels[index]?.description) continue;
          await client.query(`
            INSERT INTO panel_visual_state (
              id, storyboard_version_id, frame_id, panel_index, subject,
              performance_asset_id, current_generation_id, zoom, position_x, position_y
            )
            SELECT $1, $2, frame_id, panel_index, subject,
                   performance_asset_id, current_generation_id, zoom, position_x, position_y
            FROM panel_visual_state
            WHERE storyboard_version_id = $3 AND frame_id = $4 AND panel_index = $5
            ON CONFLICT DO NOTHING
          `, [randomUUID(), id, current.version.id, frame.id, index]);
        }
      }
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

async function ensureSceneBackgroundState(client, storyboardVersionId) {
  await client.query(`
    INSERT INTO scene_background_state (
      id, storyboard_version_id, scene_key, write_version
    ) VALUES ($1, $2, $3, 0)
    ON CONFLICT (storyboard_version_id, scene_key) DO NOTHING
  `, [randomUUID(), storyboardVersionId, PRIMARY_SCENE_KEY]);
  const existing = await client.query(
    `SELECT * FROM scene_background_state
     WHERE storyboard_version_id = $1 AND scene_key = $2`,
    [storyboardVersionId, PRIMARY_SCENE_KEY],
  );
  return existing.rows[0];
}

async function ensureFrameHybridState(client, {
  storyboardVersionId,
  frameId,
  compositionMode = "near-frontal-pair",
}) {
  const mode = HYBRID_COMPOSITION_MODES.has(compositionMode)
    ? compositionMode
    : "near-frontal-pair";
  await client.query(`
    INSERT INTO frame_hybrid_state (
      storyboard_version_id, frame_id, scene_key, composition_mode, assembly_status
    ) VALUES ($1, $2, $3, $4, 'not-ready')
    ON CONFLICT (storyboard_version_id, frame_id) DO NOTHING
  `, [storyboardVersionId, frameId, PRIMARY_SCENE_KEY, mode]);
  const result = await client.query(`
    SELECT * FROM frame_hybrid_state
    WHERE storyboard_version_id = $1 AND frame_id = $2
  `, [storyboardVersionId, frameId]);
  return result.rows[0];
}

async function lockFrameHybridState(client, storyboardVersionId, frameId, compositionMode) {
  await ensureFrameHybridState(client, { storyboardVersionId, frameId, compositionMode });
  const locked = await client.query(`
    SELECT * FROM frame_hybrid_state
    WHERE storyboard_version_id = $1 AND frame_id = $2
    FOR UPDATE
  `, [storyboardVersionId, frameId]);
  return locked.rows[0];
}

async function nextFrameOperationWriteVersion(client, storyboardVersionId, frameId) {
  const result = await client.query(`
    SELECT COALESCE(MAX(write_version), 0) + 1 AS next_version
    FROM visual_frame_operation
    WHERE storyboard_version_id = $1 AND frame_id = $2
  `, [storyboardVersionId, frameId]);
  return Number(result.rows[0].next_version);
}

export async function ensureHybridHeads(pool, {
  frameId,
  compositionMode = "near-frontal-pair",
} = {}) {
  if (!frameId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const context = await ensureVersion(client);
      if (!context) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const cast = await castFor(client, context.result.material_state_id);
      await ensurePanelRows(client, context, cast);
      const scene = await ensureSceneBackgroundState(client, context.version.id);
      const hybrid = await ensureFrameHybridState(client, {
        storyboardVersionId: context.version.id,
        frameId,
        compositionMode,
      });
      await client.query("COMMIT");
      return {
        ok: true,
        storyboardResultId: context.result.id,
        storyboardVersionId: context.version.id,
        sceneBackgroundState: mapSceneState(scene),
        frameHybridState: mapFrameHybrid(hybrid),
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function createFrameOperation(pool, {
  frameId,
  scope = "frame",
  panelIndex = null,
  phase = "queued",
} = {}) {
  if (!frameId || (scope !== "frame" && scope !== "panel")) return failed("invalid-request");
  if (scope === "panel" && (!Number.isInteger(panelIndex) || panelIndex < 0)) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const context = await ensureVersion(client);
      if (!context) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      await lockFrameHybridState(client, context.version.id, frameId);
      const writeVersion = await nextFrameOperationWriteVersion(client, context.version.id, frameId);
      const id = randomUUID();
      await client.query(`
        INSERT INTO visual_frame_operation (
          id, storyboard_result_id, storyboard_version_id, frame_id,
          scope, panel_index, write_version, phase, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running')
      `, [
        id,
        context.result.id,
        context.version.id,
        frameId,
        scope,
        scope === "panel" ? panelIndex : null,
        writeVersion,
        phase,
      ]);
      await client.query(`
        UPDATE frame_hybrid_state
        SET active_operation_id = $3, updated_at = clock_timestamp()
        WHERE storyboard_version_id = $1 AND frame_id = $2
      `, [context.version.id, frameId, id]);
      await client.query("COMMIT");
      return {
        ok: true,
        operationId: id,
        storyboardResultId: context.result.id,
        storyboardVersionId: context.version.id,
        frameId,
        scope,
        panelIndex: scope === "panel" ? panelIndex : null,
        writeVersion,
        phase,
        status: "running",
      };
    });
  } catch {
    return failed("database", 503);
  }
}

async function readySceneBackground(client, sceneState) {
  if (!sceneState.current_generation_id) return null;
  const generation = await client.query(`
    SELECT * FROM scene_background_generation
    WHERE id = $1 AND status = 'ready' AND output_asset_id IS NOT NULL
  `, [sceneState.current_generation_id]);
  return generation.rows[0] ?? null;
}

export async function claimOrReuseSceneBackground(pool, {
  operationId,
  preferReuse = true,
} = {}) {
  if (!operationId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const operation = await client.query(
        `SELECT * FROM visual_frame_operation WHERE id = $1 FOR UPDATE`,
        [operationId],
      );
      if (operation.rowCount !== 1) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const op = operation.rows[0];
      const scene = await ensureSceneBackgroundState(client, op.storyboard_version_id);
      const locked = await client.query(
        `SELECT * FROM scene_background_state WHERE id = $1 FOR UPDATE`,
        [scene.id],
      );
      const state = locked.rows[0];
      if (preferReuse) {
        const ready = await readySceneBackground(client, state);
        if (ready) {
          await client.query("COMMIT");
          return {
            ok: true,
            mode: "reuse",
            sceneBackgroundStateId: state.id,
            currentGenerationId: ready.id,
            writeVersion: Number(state.write_version),
            claimed: false,
          };
        }
      }
      const nextWriteVersion = Number(state.write_version) + 1;
      const claimed = await client.query(`
        UPDATE scene_background_state
        SET active_operation_id = $2,
            write_version = $3,
            updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING *
      `, [state.id, operationId, nextWriteVersion]);
      await client.query("COMMIT");
      return {
        ok: true,
        mode: "claim",
        sceneBackgroundStateId: claimed.rows[0].id,
        currentGenerationId: claimed.rows[0].current_generation_id,
        writeVersion: Number(claimed.rows[0].write_version),
        capturedSceneWriteVersion: nextWriteVersion,
        claimed: true,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function createSceneBackgroundGeneration(pool, {
  operationId,
  styleAssetId,
  capturedSceneWriteVersion,
  parentGenerationId = null,
  provenance,
} = {}) {
  if (!operationId || !styleAssetId || !Number.isInteger(capturedSceneWriteVersion)) {
    return failed("invalid-request");
  }
  if (!provenance?.compiledPrompt || !provenance?.promptCompilerVersion || !provenance?.model) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const created = await insertSceneBackgroundGeneration(client, {
        operationId,
        styleAssetId,
        capturedSceneWriteVersion,
        parentGenerationId,
        provenance,
      });
      if (!created.ok) {
        await client.query("ROLLBACK");
        return created;
      }
      await client.query("COMMIT");
      return created;
    });
  } catch {
    return failed("database", 503);
  }
}

async function insertSceneBackgroundGeneration(client, {
  operationId,
  styleAssetId,
  capturedSceneWriteVersion,
  parentGenerationId = null,
  provenance,
}) {
  const operation = await client.query(
    `SELECT * FROM visual_frame_operation WHERE id = $1 FOR UPDATE`,
    [operationId],
  );
  if (operation.rowCount !== 1) return failed("not-found", 404);
  const op = operation.rows[0];
  const context = await ensureVersion(client);
  if (!context
      || context.version.id !== op.storyboard_version_id
      || context.result.id !== op.storyboard_result_id) {
    return failed("not-found", 404);
  }
  const scene = await ensureSceneBackgroundState(client, op.storyboard_version_id);
  const locked = await client.query(
    `SELECT * FROM scene_background_state WHERE id = $1 FOR UPDATE`,
    [scene.id],
  );
  const state = locked.rows[0];
  const claimMatches = state.active_operation_id === operationId
    && Number(state.write_version) === Number(capturedSceneWriteVersion);
  if (!claimMatches) return failed("conflict", 409);
  const generationId = randomUUID();
  const recordId = randomUUID();
  await client.query(`
    INSERT INTO generation_record (
      id, operation_type, storyboard_result_id, storyboard_version_id,
      frame_id, scene_key, component_generation_id, operation_id,
      visual_intent_json, compiled_prompt, prompt_compiler_version,
      model, generation_settings_json, reference_manifest_json,
      omitted_references_json, app_git_commit, status
    ) VALUES (
      $1, 'scene-background', $2, $3, $4, $5, $6, $7,
      $8::jsonb, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, 'pending'
    )
  `, [
    recordId,
    op.storyboard_result_id,
    op.storyboard_version_id,
    op.frame_id,
    PRIMARY_SCENE_KEY,
    generationId,
    operationId,
    JSON.stringify(provenance.visualIntent ?? {}),
    String(provenance.compiledPrompt),
    String(provenance.promptCompilerVersion),
    String(provenance.model),
    JSON.stringify(provenance.generationSettings ?? {}),
    JSON.stringify(provenance.referenceManifest ?? []),
    JSON.stringify(provenance.omittedReferences ?? []),
    provenance.appGitCommit ?? null,
  ]);
  await client.query(`
    INSERT INTO scene_background_generation (
      id, scene_background_state_id, parent_generation_id, status,
      style_asset_id, captured_scene_write_version, generation_record_id, operation_id
    ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
  `, [
    generationId,
    scene.id,
    parentGenerationId,
    styleAssetId,
    capturedSceneWriteVersion,
    recordId,
    operationId,
  ]);
  return {
    ok: true,
    generationId,
    generationRecordId: recordId,
    sceneBackgroundStateId: scene.id,
    capturedSceneWriteVersion,
    status: "pending",
  };
}

export async function finalizeSceneBackgroundGeneration(pool, {
  generationId,
  result,
} = {}) {
  if (!generationId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const generation = await client.query(
        `SELECT * FROM scene_background_generation WHERE id = $1 FOR UPDATE`,
        [generationId],
      );
      if (generation.rowCount !== 1 || generation.rows[0].status !== "pending") {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const row = generation.rows[0];
      const terminal = result?.ok ? "ready" : "failed";
      const errorKind = result?.ok ? null : (result?.kind || "provider");
      let outputAssetId = null;
      if (result?.ok) {
        outputAssetId = (await insertAsset(client, "scene-background", result.image)).id;
      }
      const finalizedRecord = await finalizeGenerationRecordRow(client, {
        id: row.generation_record_id,
        status: terminal,
        errorKind,
        output: result?.ok ? result.image : null,
        outputAssetId,
        providerStatus: result?.providerStatus ?? null,
        latencyMs: result?.latencyMs ?? null,
      });
      if (!finalizedRecord.ok) {
        await client.query("ROLLBACK");
        return finalizedRecord;
      }
      await client.query(`
        UPDATE scene_background_generation
        SET status = $2,
            error_kind = $3,
            output_asset_id = $4,
            finished_at = clock_timestamp()
        WHERE id = $1 AND status = 'pending'
      `, [generationId, terminal, errorKind, outputAssetId]);

      let advanced = false;
      let clearedSceneClaim = false;
      const scene = await client.query(
        `SELECT * FROM scene_background_state WHERE id = $1 FOR UPDATE`,
        [row.scene_background_state_id],
      );
      const state = scene.rows[0];
      const authorityMatches = state.active_operation_id === row.operation_id
        && Number(state.write_version) === Number(row.captured_scene_write_version);
      if (terminal === "ready" && authorityMatches) {
        await client.query(`
          UPDATE scene_background_state
          SET current_generation_id = $2,
              active_operation_id = NULL,
              updated_at = clock_timestamp()
          WHERE id = $1
        `, [state.id, generationId]);
        advanced = true;
        clearedSceneClaim = true;
      } else if (terminal === "failed" && authorityMatches) {
        // Authoritative failure clears the scene claim but preserves any previous ready pointer.
        await client.query(`
          UPDATE scene_background_state
          SET active_operation_id = NULL,
              updated_at = clock_timestamp()
          WHERE id = $1
        `, [state.id]);
        clearedSceneClaim = true;
      }
      await client.query("COMMIT");
      return {
        ok: true,
        generationId,
        status: terminal,
        errorKind,
        outputAssetId,
        advancedCurrentPointer: advanced,
        clearedSceneClaim,
      };
    });
  } catch (error) {
    if (error?.kind === "invalid-image") return failed("invalid-image");
    return failed("database", 503);
  }
}

export async function createCharacterStateGeneration(pool, {
  operationId,
  frameId,
  panelIndex,
  anchorVersionId,
  styleAssetId,
  parentGenerationId = null,
  provenance,
} = {}) {
  if (!operationId || !frameId || !Number.isInteger(panelIndex) || panelIndex < 0) {
    return failed("invalid-request");
  }
  if (!anchorVersionId || !styleAssetId) return failed("invalid-request");
  if (!provenance?.compiledPrompt || !provenance?.promptCompilerVersion || !provenance?.model) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const operation = await client.query(
        `SELECT * FROM visual_frame_operation WHERE id = $1 FOR UPDATE`,
        [operationId],
      );
      if (operation.rowCount !== 1) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const op = operation.rows[0];
      if (op.frame_id !== frameId) {
        await client.query("ROLLBACK");
        return failed("conflict", 409);
      }
      if (op.scope === "panel" && Number(op.panel_index) !== Number(panelIndex)) {
        await client.query("ROLLBACK");
        return failed("conflict", 409);
      }
      const target = await panelContext(client, frameId, panelIndex);
      if (!target
          || target.context.version.id !== op.storyboard_version_id
          || target.context.result.id !== op.storyboard_result_id) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const generationId = randomUUID();
      const recordId = randomUUID();
      await client.query(`
        INSERT INTO generation_record (
          id, operation_type, storyboard_result_id, storyboard_version_id,
          frame_id, panel_index, scene_key, component_generation_id, operation_id,
          visual_intent_json, compiled_prompt, prompt_compiler_version,
          model, generation_settings_json, reference_manifest_json,
          omitted_references_json, app_git_commit, status
        ) VALUES (
          $1, 'character-state', $2, $3, $4, $5, $6, $7, $8,
          $9::jsonb, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, 'pending'
        )
      `, [
        recordId,
        op.storyboard_result_id,
        op.storyboard_version_id,
        frameId,
        panelIndex,
        PRIMARY_SCENE_KEY,
        generationId,
        operationId,
        JSON.stringify(provenance.visualIntent ?? {}),
        String(provenance.compiledPrompt),
        String(provenance.promptCompilerVersion),
        String(provenance.model),
        JSON.stringify(provenance.generationSettings ?? {}),
        JSON.stringify(provenance.referenceManifest ?? []),
        JSON.stringify(provenance.omittedReferences ?? []),
        provenance.appGitCommit ?? null,
      ]);
      await client.query(`
        INSERT INTO character_visual_state_generation (
          id, panel_visual_state_id, parent_generation_id, anchor_version_id,
          style_asset_id, status, generation_record_id, operation_id
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
      `, [
        generationId,
        target.state.id,
        parentGenerationId,
        anchorVersionId,
        styleAssetId,
        recordId,
        operationId,
      ]);
      await client.query("COMMIT");
      return {
        ok: true,
        generationId,
        generationRecordId: recordId,
        panelVisualStateId: target.state.id,
        status: "pending",
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function finalizeCharacterStateGeneration(pool, {
  generationId,
  result,
  advanceWithOperationId = null,
} = {}) {
  if (!generationId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const generation = await client.query(
        `SELECT * FROM character_visual_state_generation WHERE id = $1 FOR UPDATE`,
        [generationId],
      );
      if (generation.rowCount !== 1 || generation.rows[0].status !== "pending") {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const row = generation.rows[0];
      const terminal = result?.ok ? "ready" : "failed";
      const errorKind = result?.ok ? null : (result?.kind || "provider");
      let rawAssetId = null;
      let outputAssetId = null;
      if (result?.rawImage) {
        rawAssetId = (await insertAsset(client, "character-state-raw", result.rawImage)).id;
      }
      if (result?.ok) {
        outputAssetId = (await insertAsset(client, "character-state", result.image)).id;
      }
      const finalizedRecord = await finalizeGenerationRecordRow(client, {
        id: row.generation_record_id,
        status: terminal,
        errorKind,
        output: result?.ok ? result.image : null,
        outputAssetId,
        providerStatus: result?.providerStatus ?? null,
        latencyMs: result?.latencyMs ?? null,
      });
      if (!finalizedRecord.ok) {
        await client.query("ROLLBACK");
        return finalizedRecord;
      }
      await client.query(`
        UPDATE character_visual_state_generation
        SET status = $2,
            error_kind = $3,
            raw_asset_id = $4,
            output_asset_id = $5,
            finished_at = clock_timestamp()
        WHERE id = $1 AND status = 'pending'
      `, [generationId, terminal, errorKind, rawAssetId, outputAssetId]);

      let advanced = false;
      if (terminal === "ready") {
        const hybrid = await client.query(`
          SELECT frame_hybrid_state.active_operation_id
          FROM panel_visual_state
          JOIN frame_hybrid_state
            ON frame_hybrid_state.storyboard_version_id = panel_visual_state.storyboard_version_id
           AND frame_hybrid_state.frame_id = panel_visual_state.frame_id
          WHERE panel_visual_state.id = $1
        `, [row.panel_visual_state_id]);
        const activeOperationId = hybrid.rows[0]?.active_operation_id ?? null;
        const authoritative = advanceWithOperationId
          ? activeOperationId === advanceWithOperationId && row.operation_id === advanceWithOperationId
          : activeOperationId === row.operation_id;
        if (authoritative) {
          await client.query(`
            UPDATE panel_visual_state
            SET current_character_generation_id = $2, updated_at = clock_timestamp()
            WHERE id = $1
          `, [row.panel_visual_state_id, generationId]);
          advanced = true;
        }
      }
      await client.query("COMMIT");
      return {
        ok: true,
        generationId,
        status: terminal,
        errorKind,
        rawAssetId,
        outputAssetId,
        advancedCurrentPointer: advanced,
      };
    });
  } catch (error) {
    if (error?.kind === "invalid-image") return failed("invalid-image");
    return failed("database", 503);
  }
}

async function finalizeGenerationRecordRow(client, {
  id,
  status,
  errorKind = null,
  output = null,
  outputAssetId = null,
  providerStatus = null,
  latencyMs = null,
}) {
  if (!id) return failed("not-found", 404);
  if (status !== "ready" && status !== "failed") {
    return failed("invalid-request");
  }
  const bytes = imageBytes(output);
  const inspected = bytes ? inspectImage(bytes) : null;
  const updated = await client.query(`
    UPDATE generation_record
    SET status = $2,
        error_kind = $3,
        provider_status = $4,
        latency_ms = $5,
        output_asset_id = $6,
        output_sha256 = $7,
        output_mime = $8,
        output_width = $9,
        output_height = $10,
        output_byte_length = $11,
        finished_at = clock_timestamp()
    WHERE id = $1 AND status = 'pending'
    RETURNING id, status, compiled_prompt, visual_intent_json, reference_manifest_json,
              prompt_compiler_version, model, generation_settings_json, omitted_references_json,
              app_git_commit, operation_type, storyboard_version_id, frame_id
  `, [
    id,
    status,
    errorKind,
    providerStatus,
    latencyMs,
    outputAssetId,
    inspected?.sha256 ?? null,
    inspected?.mime ?? null,
    inspected?.width ?? null,
    inspected?.height ?? null,
    inspected?.byteLength ?? null,
  ]);
  if (updated.rowCount !== 1) return failed("conflict", 409);
  return { ok: true, record: updated.rows[0] };
}

export async function finalizeGenerationRecord(pool, input) {
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const result = await finalizeGenerationRecordRow(client, input);
      if (!result.ok) {
        await client.query("ROLLBACK");
        return result;
      }
      await client.query("COMMIT");
      return result;
    });
  } catch {
    return failed("database", 503);
  }
}

export async function loadHybridPersistence(pool, { frameId } = {}) {
  if (!frameId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      if (!context) return failed("not-found", 404);
      const scene = await ensureSceneBackgroundState(client, context.version.id);
      const hybrid = await client.query(`
        SELECT * FROM frame_hybrid_state
        WHERE storyboard_version_id = $1 AND frame_id = $2
      `, [context.version.id, frameId]);
      const panels = await client.query(`
        SELECT id, frame_id, panel_index, current_generation_id,
               current_character_generation_id, fit_mode, zoom, position_x, position_y
        FROM panel_visual_state
        WHERE storyboard_version_id = $1 AND frame_id = $2
        ORDER BY panel_index
      `, [context.version.id, frameId]);
      return {
        ok: true,
        storyboardResultId: context.result.id,
        storyboardVersionId: context.version.id,
        sceneBackgroundState: mapSceneState(scene),
        frameHybridState: hybrid.rowCount === 1 ? mapFrameHybrid(hybrid.rows[0]) : null,
        panels: panels.rows.map((row) => ({
          id: row.id,
          frameId: row.frame_id,
          panelIndex: row.panel_index,
          currentGenerationId: row.current_generation_id,
          currentCharacterGenerationId: row.current_character_generation_id,
          fitMode: row.fit_mode,
          zoom: Number(row.zoom),
          positionX: Number(row.position_x),
          positionY: Number(row.position_y),
        })),
      };
    });
  } catch {
    return failed("database", 503);
  }
}

function mapSceneState(row) {
  return {
    id: row.id,
    storyboardVersionId: row.storyboard_version_id,
    sceneKey: row.scene_key,
    currentGenerationId: row.current_generation_id,
    activeOperationId: row.active_operation_id,
    writeVersion: Number(row.write_version),
  };
}

function mapFrameHybrid(row) {
  return {
    storyboardVersionId: row.storyboard_version_id,
    frameId: row.frame_id,
    sceneKey: row.scene_key,
    compositionMode: row.composition_mode,
    activeOperationId: row.active_operation_id,
    assemblyStatus: row.assembly_status,
  };
}

function mapOperationRow(row, extras = {}) {
  return {
    ok: true,
    operationId: row.id,
    frameId: row.frame_id,
    storyboardResultId: row.storyboard_result_id,
    storyboardVersionId: row.storyboard_version_id,
    scope: row.scope,
    panelIndex: row.panel_index,
    writeVersion: Number(row.write_version),
    phase: row.phase,
    status: row.status,
    errorKind: row.error_kind,
    componentFailures: Array.isArray(row.component_failures_json) ? row.component_failures_json : [],
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    finishedAt: row.finished_at?.toISOString?.() ?? row.finished_at ?? null,
    ...extras,
  };
}

async function loadStyleAsset(client, materialStateId) {
  const seed = await backfillStyleSeed(client, materialStateId);
  if (!seed?.style_asset_id) return null;
  const asset = await assetRow(client, seed.style_asset_id);
  if (!asset) return null;
  return {
    id: asset.id,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
  };
}

async function loadApprovedAnchorAsset(client, materialStateId, characterName) {
  const approved = await approvedAnchor(client, materialStateId, characterName);
  if (!approved?.output_asset_id) return null;
  const asset = await assetRow(client, approved.output_asset_id);
  if (!asset) return null;
  return {
    id: approved.id,
    assetId: asset.id,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
  };
}

export async function updateFrameOperation(pool, {
  operationId,
  phase,
  status,
  errorKind = null,
  componentFailures = null,
} = {}) {
  if (!operationId) return failed("invalid-request");
  if (phase != null && !OPERATION_PHASES.has(phase)) return failed("invalid-request");
  if (status != null && status !== "running" && status !== "complete" && status !== "failed") {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM visual_frame_operation WHERE id = $1 FOR UPDATE`,
        [operationId],
      );
      if (existing.rowCount !== 1) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const row = existing.rows[0];
      if (row.status !== "running" && (phase === "complete" || phase === "failed" || status === "complete" || status === "failed")) {
        // Allow terminal writes only from running; otherwise conflict.
        if (row.status !== status || (phase != null && row.phase !== phase)) {
          await client.query("ROLLBACK");
          return failed("conflict", 409);
        }
      }
      const nextPhase = phase ?? row.phase;
      const nextStatus = status ?? (nextPhase === "complete" || nextPhase === "failed" ? nextPhase : row.status);
      const nextError = errorKind !== undefined ? errorKind : row.error_kind;
      const nextFailures = componentFailures != null
        ? componentFailures
        : row.component_failures_json;
      const finished = nextStatus === "complete" || nextStatus === "failed";
      const updated = await client.query(`
        UPDATE visual_frame_operation
        SET phase = $2,
            status = $3,
            error_kind = $4,
            component_failures_json = $5::jsonb,
            updated_at = clock_timestamp(),
            finished_at = CASE
              WHEN $6::boolean THEN COALESCE(finished_at, clock_timestamp())
              ELSE finished_at
            END
        WHERE id = $1
        RETURNING *
      `, [
        operationId,
        nextPhase,
        nextStatus,
        nextError,
        JSON.stringify(nextFailures ?? []),
        finished,
      ]);
      await client.query("COMMIT");
      return mapOperationRow(updated.rows[0]);
    });
  } catch {
    return failed("database", 503);
  }
}

export async function getFrameOperation(pool, { frameId, operationId } = {}) {
  if (!frameId || !operationId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      if (!context) return failed("not-found", 404);
      const operation = await client.query(`
        SELECT * FROM visual_frame_operation
        WHERE id = $1
          AND frame_id = $2
          AND storyboard_result_id = $3
          AND storyboard_version_id = $4
      `, [operationId, frameId, context.result.id, context.version.id]);
      if (operation.rowCount !== 1) return failed("not-found", 404);
      const summary = await buildHybridOperationSummary(client, context, frameId, operation.rows[0]);
      return mapOperationRow(operation.rows[0], summary);
    });
  } catch {
    return failed("database", 503);
  }
}

async function buildHybridOperationSummary(client, context, frameId, operationRow) {
  const hybrid = await client.query(`
    SELECT * FROM frame_hybrid_state
    WHERE storyboard_version_id = $1 AND frame_id = $2
  `, [context.version.id, frameId]);
  const scene = await client.query(
    `SELECT * FROM scene_background_state
     WHERE storyboard_version_id = $1 AND scene_key = $2`,
    [context.version.id, PRIMARY_SCENE_KEY],
  );
  const sceneState = scene.rows[0] ?? null;
  const sceneGeneration = sceneState?.current_generation_id
    ? (await client.query(
      `SELECT * FROM scene_background_generation WHERE id = $1`,
      [sceneState.current_generation_id],
    )).rows[0]
    : null;
  const panels = await client.query(`
    SELECT panel_visual_state.*, character_visual_state_generation.status AS character_status,
           character_visual_state_generation.error_kind AS character_error_kind,
           character_visual_state_generation.output_asset_id AS character_asset_id
    FROM panel_visual_state
    LEFT JOIN character_visual_state_generation
      ON character_visual_state_generation.id = panel_visual_state.current_character_generation_id
    WHERE panel_visual_state.storyboard_version_id = $1
      AND panel_visual_state.frame_id = $2
    ORDER BY panel_visual_state.panel_index
  `, [context.version.id, frameId]);
  const backgroundReady = sceneGeneration?.status === "ready" && sceneGeneration.output_asset_id;
  const charactersReady = panels.rows.length > 0
    && panels.rows.every((row) => row.character_status === "ready" && row.character_asset_id);
  const assemblyStatus = hybrid.rows[0]?.assembly_status ?? "not-ready";
  const visualReady = Boolean(backgroundReady && charactersReady && assemblyStatus === "ready");
  return {
    visualReady,
    hybrid: {
      sceneKey: PRIMARY_SCENE_KEY,
      compositionMode: hybrid.rows[0]?.composition_mode || "near-frontal-pair",
      assemblyStatus,
      background: {
        status: backgroundReady
          ? "ready"
          : (sceneGeneration?.status || (sceneState?.active_operation_id ? "pending" : "missing")),
        assetId: backgroundReady ? sceneGeneration.output_asset_id : null,
      },
      panels: panels.rows.map((row) => ({
        panelIndex: row.panel_index,
        subject: row.subject,
        status: row.character_status || "missing",
        assetId: row.character_asset_id,
        errorKind: row.character_error_kind,
        zoom: Number(row.zoom),
        positionX: Number(row.position_x),
        positionY: Number(row.position_y),
        fitMode: row.fit_mode,
      })),
    },
  };
}

async function assertActiveFrameOperation(client, { operationId, frameId = null } = {}) {
  if (!operationId) return failed("invalid-request");
  const operation = await client.query(
    `SELECT * FROM visual_frame_operation WHERE id = $1 FOR UPDATE`,
    [operationId],
  );
  if (operation.rowCount !== 1) return failed("not-found", 404);
  const op = operation.rows[0];
  const context = await ensureVersion(client);
  if (!context
      || context.version.id !== op.storyboard_version_id
      || context.result.id !== op.storyboard_result_id) {
    return failed("not-found", 404);
  }
  if (frameId && op.frame_id !== frameId) return failed("conflict", 409);
  if (op.status !== "running") return failed("conflict", 409);
  const hybrid = await lockFrameHybridState(client, op.storyboard_version_id, op.frame_id);
  if (hybrid.active_operation_id !== operationId) return failed("conflict", 409);
  return {
    ok: true,
    operation: op,
    context,
    writeVersion: Number(op.write_version),
    frameHybridState: hybrid,
  };
}

export async function assertFrameOperationAuthority(pool, { operationId, frameId = null } = {}) {
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const result = await assertActiveFrameOperation(client, { operationId, frameId });
      if (!result.ok) {
        await client.query("ROLLBACK");
        return result;
      }
      await client.query("COMMIT");
      return {
        ok: true,
        operationId,
        frameId: result.operation.frame_id,
        scope: result.operation.scope,
        panelIndex: result.operation.panel_index == null
          ? null
          : Number(result.operation.panel_index),
        writeVersion: result.writeVersion,
        storyboardVersionId: result.operation.storyboard_version_id,
        storyboardResultId: result.operation.storyboard_result_id,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

/** True when the active version has a ready primary-scene background. */
export async function hasReadyPrimaryBackground(pool) {
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      if (!context) return { ok: false, kind: "not-found", httpStatus: 404 };
      const scene = await ensureSceneBackgroundState(client, context.version.id);
      const ready = await readySceneBackground(client, scene);
      return {
        ok: true,
        ready: Boolean(ready),
        generationId: ready?.id ?? null,
        assetId: ready?.output_asset_id ?? null,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

/** T017 sole owner: begin background component (provenance before provider I/O). */
export async function beginSceneBackgroundLifecycle(pool, {
  operationId,
  sceneContinuity = "shared dialogue interior",
  compositionMode = "near-frontal-pair",
  visualIntent = null,
  env = process.env,
  providerConfig = null,
  preferReuse = true,
  onBeforeCreateGeneration = null,
} = {}) {
  if (!operationId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        const authority = await assertActiveFrameOperation(client, { operationId });
        if (!authority.ok) {
          await client.query("ROLLBACK");
          return authority;
        }
        const op = authority.operation;
        const context = authority.context;
        const styleAsset = await loadStyleAsset(client, context.result.material_state_id);
        if (!styleAsset) {
          await client.query("ROLLBACK");
          return failed("style-required", 409);
        }
        const scene = await ensureSceneBackgroundState(client, op.storyboard_version_id);
        const locked = await client.query(
          `SELECT * FROM scene_background_state WHERE id = $1 FOR UPDATE`,
          [scene.id],
        );
        const state = locked.rows[0];
        const ready = preferReuse ? await readySceneBackground(client, state) : null;
        if (ready) {
          await client.query("COMMIT");
          return {
            ok: true,
            mode: "reuse",
            claimed: false,
            currentGenerationId: ready.id,
            writeVersion: Number(state.write_version),
            sceneBackgroundStateId: state.id,
          };
        }

        const capturedSceneWriteVersion = Number(state.write_version) + 1;
        await client.query(`
          UPDATE scene_background_state
          SET active_operation_id = $2,
              write_version = $3,
              updated_at = clock_timestamp()
          WHERE id = $1
        `, [state.id, operationId, capturedSceneWriteVersion]);

        const config = resolveImageProviderConfig({
          env,
          aspectRatio: "21:9",
          component: "scene-background",
          model: providerConfig?.model ?? null,
          timeoutMs: providerConfig?.timeoutMs ?? null,
        });
        if (!config.ok) {
          await client.query("ROLLBACK");
          return failed(config.kind, config.kind === "configuration" ? 500 : 400);
        }
        const compiled = compileSceneBackgroundPrompt({
          sceneContinuity,
          compositionMode,
          styleAsset,
        });
        if (!compiled.ok) {
          await client.query("ROLLBACK");
          return failed(compiled.kind, 409);
        }
        const intent = visualIntent || buildHybridVisualIntent({
          project: { styleSeedAssetId: styleAsset.id },
          scene: { sceneKey: PRIMARY_SCENE_KEY, continuity: sceneContinuity },
          frame: { id: op.frame_id, compositionMode, layout: "split2" },
          panels: [],
        }).intent;

        if (typeof onBeforeCreateGeneration === "function") {
          await onBeforeCreateGeneration({
            client,
            operationId,
            capturedSceneWriteVersion,
          });
        }

        const created = await insertSceneBackgroundGeneration(client, {
          operationId,
          styleAssetId: styleAsset.id,
          capturedSceneWriteVersion,
          provenance: {
            visualIntent: intent,
            compiledPrompt: compiled.prompt,
            promptCompilerVersion: compiled.promptCompilerVersion || HYBRID_PROMPT_COMPILER_VERSION,
            model: config.model,
            generationSettings: config.generationSettings,
            referenceManifest: compiled.referenceManifest,
            omittedReferences: compiled.omittedReferences,
          },
        });
        if (!created.ok) {
          await client.query("ROLLBACK");
          return created;
        }
        await client.query("COMMIT");
        return {
          ok: true,
          mode: "generate",
          claimed: true,
          generationId: created.generationId,
          generationRecordId: created.generationRecordId,
          capturedSceneWriteVersion,
          prompt: compiled.prompt,
          images: compiled.images.map((image) => ({
            id: image.id,
            mime: image.mime,
            bytes: image.bytes,
          })),
          aspectRatio: config.generationSettings.aspectRatio,
          model: config.model,
          timeoutMs: config.timeoutMs,
          generationSettings: config.generationSettings,
          promptCompilerVersion: compiled.promptCompilerVersion,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error?.kind) return failed(error.kind, error.httpStatus || 400);
        return failed("database", 503);
      }
    });
  } catch {
    return failed("database", 503);
  }
}

/** T017 sole owner: finalize background component after provider I/O. */
export async function finalizeSceneBackgroundLifecycle(pool, {
  generationId,
  providerResult,
} = {}) {
  if (!generationId) return failed("invalid-request");
  const outcome = normalizeProviderOutcome(providerResult);
  if (!outcome.ok) {
    return finalizeSceneBackgroundGeneration(pool, {
      generationId,
      result: {
        ok: false,
        kind: outcome.kind || "provider",
        providerStatus: outcome.providerStatus,
        latencyMs: outcome.latencyMs,
      },
    });
  }
  if (!imageBytes(outcome.image)) {
    return finalizeSceneBackgroundGeneration(pool, {
      generationId,
      result: { ok: false, kind: "invalid-output" },
    });
  }
  return finalizeSceneBackgroundGeneration(pool, {
    generationId,
    result: {
      ok: true,
      image: outcome.image,
      providerStatus: outcome.providerStatus,
      latencyMs: outcome.latencyMs,
    },
  });
}

/** T018 sole owner: begin character-state component (provenance before provider I/O). */
export async function beginCharacterStateLifecycle(pool, {
  operationId,
  frameId,
  panelIndex,
  compositionMode = "near-frontal-pair",
  visualIntent = null,
  env = process.env,
  providerConfig = null,
} = {}) {
  if (!operationId || !frameId || !Number.isInteger(panelIndex)) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      try {
        const authority = await assertActiveFrameOperation(client, { operationId, frameId });
        if (!authority.ok) {
          await client.query("ROLLBACK");
          return authority;
        }
        const op = authority.operation;
        const context = authority.context;
        if (op.scope === "panel" && Number(op.panel_index) !== Number(panelIndex)) {
          await client.query("ROLLBACK");
          return failed("conflict", 409);
        }
        const cast = await castFor(client, context.result.material_state_id);
        await ensurePanelRows(client, context, cast);
        const target = await panelContext(client, frameId, panelIndex);
        if (!target
            || target.context.version.id !== op.storyboard_version_id
            || target.context.result.id !== op.storyboard_result_id) {
          await client.query("ROLLBACK");
          return failed("not-found", 404);
        }
        const subject = target.state.subject;
        if (!subject) {
          await client.query("ROLLBACK");
          return failed("anchor-required", 409);
        }
        const styleAsset = await loadStyleAsset(client, context.result.material_state_id);
        if (!styleAsset) {
          await client.query("ROLLBACK");
          return failed("style-required", 409);
        }
        const identity = await loadApprovedAnchorAsset(client, context.result.material_state_id, subject);
        if (!identity) {
          await client.query("ROLLBACK");
          return failed("anchor-required", 409);
        }
        const frame = expandStoryboardFrames(context.version.frames).find((entry) => entry.id === frameId);
        const panels = frame?.panels || [];
        const otherSubjects = [];
        for (let index = 0; index < panels.length; index += 1) {
          if (index === panelIndex) continue;
          const other = await panelContext(client, frameId, index);
          if (other?.state?.subject && other.state.subject !== subject) {
            otherSubjects.push(other.state.subject);
          }
        }
        const config = resolveImageProviderConfig({
          env,
          aspectRatio: "4:5",
          component: "character-state",
          panelIndex,
          model: providerConfig?.model ?? null,
          timeoutMs: providerConfig?.timeoutMs ?? null,
        });
        if (!config.ok) {
          await client.query("ROLLBACK");
          return failed(config.kind, config.kind === "configuration" ? 500 : 400);
        }
        const compiled = compileCharacterStatePrompt({
          characterName: subject,
          description: panels[panelIndex]?.description || subject,
          compositionMode,
          panelIndex,
          speakerPanel: frame?.speakerPanel ?? null,
          offscreenOthers: otherSubjects,
          identityAsset: { id: identity.assetId, mime: identity.mime, bytes: identity.bytes },
          styleAsset,
        });
        if (!compiled.ok) {
          await client.query("ROLLBACK");
          return failed(compiled.kind, 409);
        }
        const intent = visualIntent || buildHybridVisualIntent({
          project: { styleSeedAssetId: styleAsset.id },
          scene: { sceneKey: PRIMARY_SCENE_KEY },
          frame: { ...frame, id: frameId, compositionMode },
          panels: panels.map((panel, index) => ({
            ...panel,
            panelIndex: index,
            subject: index === panelIndex ? subject : otherSubjects[0] || panel.subject,
          })),
        }).intent;

        const generationId = randomUUID();
        const recordId = randomUUID();
        await client.query(`
          INSERT INTO generation_record (
            id, operation_type, storyboard_result_id, storyboard_version_id,
            frame_id, panel_index, scene_key, component_generation_id, operation_id,
            visual_intent_json, compiled_prompt, prompt_compiler_version,
            model, generation_settings_json, reference_manifest_json,
            omitted_references_json, app_git_commit, status
          ) VALUES (
            $1, 'character-state', $2, $3, $4, $5, $6, $7, $8,
            $9::jsonb, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, 'pending'
          )
        `, [
          recordId,
          op.storyboard_result_id,
          op.storyboard_version_id,
          frameId,
          panelIndex,
          PRIMARY_SCENE_KEY,
          generationId,
          operationId,
          JSON.stringify(intent),
          String(compiled.prompt),
          String(compiled.promptCompilerVersion || HYBRID_PROMPT_COMPILER_VERSION),
          config.model,
          JSON.stringify(config.generationSettings),
          JSON.stringify(compiled.referenceManifest ?? []),
          JSON.stringify(compiled.omittedReferences ?? []),
          null,
        ]);
        await client.query(`
          INSERT INTO character_visual_state_generation (
            id, panel_visual_state_id, parent_generation_id, anchor_version_id,
            style_asset_id, status, generation_record_id, operation_id
          ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
        `, [
          generationId,
          target.state.id,
          target.state.current_character_generation_id,
          identity.id,
          styleAsset.id,
          recordId,
          operationId,
        ]);
        await client.query("COMMIT");
        return {
          ok: true,
          mode: "generate",
          generationId,
          generationRecordId: recordId,
          panelIndex,
          subject,
          prompt: compiled.prompt,
          images: compiled.images.map((image) => ({
            id: image.id,
            mime: image.mime,
            bytes: image.bytes,
          })),
          aspectRatio: config.generationSettings.aspectRatio,
          model: config.model,
          timeoutMs: config.timeoutMs,
          generationSettings: config.generationSettings,
          promptCompilerVersion: compiled.promptCompilerVersion,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error?.kind) return failed(error.kind, error.httpStatus || 400);
        return failed("database", 503);
      }
    });
  } catch {
    return failed("database", 503);
  }
}

/** T018 sole owner: matte + finalize character-state after provider I/O. */
export async function finalizeCharacterStateLifecycle(pool, {
  generationId,
  providerResult,
  advanceWithOperationId = null,
} = {}) {
  if (!generationId) return failed("invalid-request");
  const outcome = normalizeProviderOutcome(providerResult);
  if (!outcome.ok) {
    return finalizeCharacterStateGeneration(pool, {
      generationId,
      advanceWithOperationId,
      result: {
        ok: false,
        kind: outcome.kind || "provider",
        providerStatus: outcome.providerStatus,
        latencyMs: outcome.latencyMs,
      },
    });
  }
  const rawBytes = imageBytes(outcome.image);
  if (!rawBytes) {
    return finalizeCharacterStateGeneration(pool, {
      generationId,
      advanceWithOperationId,
      result: { ok: false, kind: "invalid-output" },
    });
  }
  const matte = extractChromakeyMatte(rawBytes);
  if (!matte.ok) {
    return finalizeCharacterStateGeneration(pool, {
      generationId,
      advanceWithOperationId,
      result: {
        ok: false,
        kind: "matte-failed",
        rawImage: { bytes: matte.rawBytes || rawBytes, mime: "image/png" },
        providerStatus: outcome.providerStatus,
        latencyMs: outcome.latencyMs,
      },
    });
  }
  return finalizeCharacterStateGeneration(pool, {
    generationId,
    advanceWithOperationId,
    result: {
      ok: true,
      rawImage: { bytes: matte.rawBytes, mime: "image/png" },
      image: { bytes: matte.rgbaBytes, mime: "image/png" },
      providerStatus: outcome.providerStatus,
      latencyMs: outcome.latencyMs,
    },
  });
}

/** T020: deterministic assembly validation and readiness. */
export async function evaluateHybridAssembly(pool, { frameId, operationId = null } = {}) {
  if (!frameId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const context = await ensureVersion(client);
      if (!context) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      if (operationId) {
        const authority = await assertActiveFrameOperation(client, { operationId, frameId });
        if (!authority.ok) {
          await client.query("ROLLBACK");
          return authority;
        }
      }
      const hybrid = await lockFrameHybridState(client, context.version.id, frameId);
      const scene = await ensureSceneBackgroundState(client, context.version.id);
      const readyBackground = await readySceneBackground(client, scene);
      const panels = await client.query(`
        SELECT panel_visual_state.panel_index,
               panel_visual_state.current_character_generation_id,
               character_visual_state_generation.status,
               character_visual_state_generation.output_asset_id
        FROM panel_visual_state
        LEFT JOIN character_visual_state_generation
          ON character_visual_state_generation.id = panel_visual_state.current_character_generation_id
        WHERE panel_visual_state.storyboard_version_id = $1
          AND panel_visual_state.frame_id = $2
        ORDER BY panel_visual_state.panel_index
      `, [context.version.id, frameId]);
      const frame = expandStoryboardFrames(context.version.frames).find((entry) => entry.id === frameId);
      const requiredCount = frame?.panels?.length ?? panels.rows.length;
      const charactersReady = panels.rows.length >= requiredCount
        && panels.rows.every((row) => row.status === "ready" && row.output_asset_id);
      const assemblyReady = Boolean(readyBackground && charactersReady);
      await client.query(`
        UPDATE frame_hybrid_state
        SET assembly_status = $3, updated_at = clock_timestamp()
        WHERE storyboard_version_id = $1 AND frame_id = $2
      `, [context.version.id, frameId, assemblyReady ? "ready" : "not-ready"]);
      void hybrid;
      await client.query("COMMIT");
      return {
        ok: true,
        frameId,
        assemblyStatus: assemblyReady ? "ready" : "not-ready",
        visualReady: assemblyReady,
        backgroundReady: Boolean(readyBackground),
        charactersReady,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

async function failOperationConflict(pool, operationId, failures) {
  await updateFrameOperation(pool, {
    operationId,
    phase: "failed",
    status: "failed",
    errorKind: "conflict",
    componentFailures: failures,
  }).catch(() => {});
  return { ok: false, kind: "conflict", componentFailures: failures };
}

/** Finalize a begun component as failed/conflict when provider I/O is skipped. */
async function finalizeBegunComponentAsConflict(pool, { component, generationId }) {
  if (component === "scene-background") {
    return finalizeSceneBackgroundLifecycle(pool, {
      generationId,
      providerResult: { ok: false, kind: "conflict" },
    });
  }
  return finalizeCharacterStateLifecycle(pool, {
    generationId,
    providerResult: { ok: false, kind: "conflict" },
  });
}

/** Provider args must use the immutable settings captured at lifecycle begin. */
function providerInvocationFromBegin(begun, { component, panelIndex = null } = {}) {
  const settings = begun.generationSettings && typeof begun.generationSettings === "object"
    ? begun.generationSettings
    : {};
  const args = {
    prompt: begun.prompt,
    images: begun.images,
    aspectRatio: settings.aspectRatio ?? begun.aspectRatio,
    model: begun.model,
    timeoutMs: settings.timeoutMs ?? begun.timeoutMs,
    component: settings.component ?? component,
  };
  const resolvedPanel = Number.isInteger(settings.panelIndex)
    ? settings.panelIndex
    : (Number.isInteger(panelIndex) ? panelIndex : null);
  if (Number.isInteger(resolvedPanel)) args.panelIndex = resolvedPanel;
  return args;
}

/** T019: orchestrate component lifecycles without creating provenance itself. */
export async function orchestrateHybridFrameOperation(pool, {
  operationId,
  generateImage,
  env = process.env,
  providerConfig = null,
  onAfterBackgroundBegin = null,
  onAfterCharacterBegin = null,
  onHybridLog = null,
} = {}) {
  if (!operationId || typeof generateImage !== "function") return failed("invalid-request");
  const failures = [];
  const emit = (event, fields = {}) => {
    if (typeof onHybridLog === "function") {
      try { onHybridLog(event, fields); } catch { /* logging must not break orchestration */ }
    }
  };
  try {
    const authority = await assertFrameOperationAuthority(pool, { operationId });
    if (!authority.ok) {
      if (authority.kind === "conflict") {
        return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
      }
      return authority;
    }
    const frameId = authority.frameId;
    const operationScope = authority.scope === "panel" ? "panel" : "frame";
    const scopedPanelIndex = Number.isInteger(authority.panelIndex) ? authority.panelIndex : null;

    await updateFrameOperation(pool, { operationId, phase: "preparing-background", status: "running" });
    emit("visual-hybrid-operation-phase", {
      operationId,
      frameId,
      scope: operationScope,
      panelIndex: scopedPanelIndex,
      phase: "preparing-background",
      status: "running",
    });
    const stillPreparing = await assertFrameOperationAuthority(pool, { operationId, frameId });
    if (!stillPreparing.ok) {
      return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
    }

    if (operationScope === "panel") {
      const readyBackground = await hasReadyPrimaryBackground(pool);
      if (!readyBackground.ok || !readyBackground.ready) {
        const kind = readyBackground.ok ? "frame-generation-required" : (readyBackground.kind || "database");
        failures.push({ component: "background", kind });
        await updateFrameOperation(pool, {
          operationId,
          phase: "failed",
          status: "failed",
          errorKind: kind,
          componentFailures: failures,
        });
        return { ok: false, kind, componentFailures: failures };
      }
    } else {
    const background = await beginSceneBackgroundLifecycle(pool, {
      operationId,
      env,
      providerConfig,
    });
    if (!background.ok) {
      const kind = background.kind || "provider";
      failures.push({ component: "background", kind });
      await updateFrameOperation(pool, {
        operationId,
        phase: "failed",
        status: "failed",
        errorKind: kind,
        componentFailures: failures,
      });
      return { ok: false, kind, componentFailures: failures };
    }

    if (background.mode === "generate") {
      if (typeof onAfterBackgroundBegin === "function") {
        await onAfterBackgroundBegin(background);
      }
      const beforeProvider = await assertFrameOperationAuthority(pool, { operationId, frameId });
      if (!beforeProvider.ok) {
        await finalizeBegunComponentAsConflict(pool, {
          component: "scene-background",
          generationId: background.generationId,
        });
        failures.push({ component: "background", kind: "conflict" });
        return failOperationConflict(pool, operationId, failures);
      }
      await updateFrameOperation(pool, { operationId, phase: "generating-background", status: "running" });
      emit("visual-hybrid-operation-phase", {
        operationId, frameId, scope: operationScope, phase: "generating-background", status: "running",
      });
      const bgArgs = providerInvocationFromBegin(background, { component: "scene-background" });
      emit("visual-background-start", {
        operationId,
        frameId,
        component: "scene-background",
        generationId: background.generationId,
        generationRecordId: background.generationRecordId,
        model: bgArgs.model,
        writeVersion: background.capturedSceneWriteVersion,
      });
      let providerResult;
      try {
        providerResult = await generateImage({ ...bgArgs, env });
      } catch {
        providerResult = { ok: false, kind: "provider" };
      }
      const bgOutcome = normalizeProviderOutcome(providerResult);
      emit("visual-background-provider", {
        operationId,
        frameId,
        component: "scene-background",
        generationId: background.generationId,
        status: bgOutcome.ok ? "ok" : "failed",
        kind: bgOutcome.ok ? undefined : (bgOutcome.kind || "provider"),
        providerStatus: bgOutcome.providerStatus,
        latencyMs: bgOutcome.latencyMs,
        model: bgArgs.model,
      });
      const finalized = await finalizeSceneBackgroundLifecycle(pool, {
        generationId: background.generationId,
        providerResult,
      });
      emit("visual-background-storage", {
        operationId,
        frameId,
        component: "scene-background",
        generationId: background.generationId,
        status: finalized.ok ? finalized.status : "failed",
        kind: finalized.ok ? finalized.errorKind : (finalized.kind || "database"),
        advancedCurrentPointer: Boolean(finalized.advancedCurrentPointer),
      });
      const afterProvider = await assertFrameOperationAuthority(pool, { operationId, frameId });
      if (!afterProvider.ok) {
        failures.push({ component: "operation", kind: "conflict" });
        return failOperationConflict(pool, operationId, failures);
      }
      if (!finalized.ok || finalized.status === "failed") {
        const kind = finalized.errorKind || normalizeProviderOutcome(providerResult).kind || "provider";
        failures.push({ component: "background", kind });
        await updateFrameOperation(pool, {
          operationId,
          phase: "failed",
          status: "failed",
          errorKind: kind,
          componentFailures: failures,
        });
        return { ok: false, kind, componentFailures: failures };
      }
    }
    }

    const beforeCharacters = await assertFrameOperationAuthority(pool, { operationId, frameId });
    if (!beforeCharacters.ok) {
      return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
    }
    await updateFrameOperation(pool, {
      operationId,
      phase: "generating-character-states",
      status: "running",
    });
    emit("visual-hybrid-operation-phase", {
      operationId,
      frameId,
      scope: operationScope,
      panelIndex: scopedPanelIndex,
      phase: "generating-character-states",
      status: "running",
    });

    const panelCount = await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      const frame = expandStoryboardFrames(context.version.frames).find((entry) => entry.id === frameId);
      return frame?.panels?.length ?? 0;
    });
    const panelIndexes = operationScope === "panel" && Number.isInteger(scopedPanelIndex)
      ? [scopedPanelIndex]
      : [...Array(panelCount).keys()];

    for (const panelIndex of panelIndexes) {
      const beforePanel = await assertFrameOperationAuthority(pool, { operationId, frameId });
      if (!beforePanel.ok) {
        return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
      }
      const started = await beginCharacterStateLifecycle(pool, {
        operationId,
        frameId,
        panelIndex,
        env,
        providerConfig,
      });
      if (!started.ok) {
        const kind = started.kind || "provider";
        failures.push({
          component: "character-state",
          panelIndex,
          kind,
        });
        await updateFrameOperation(pool, {
          operationId,
          phase: "failed",
          status: "failed",
          errorKind: kind,
          componentFailures: failures,
        });
        return { ok: false, kind, componentFailures: failures };
      }
      if (typeof onAfterCharacterBegin === "function") {
        await onAfterCharacterBegin(started);
      }
      const beforeCharProvider = await assertFrameOperationAuthority(pool, { operationId, frameId });
      if (!beforeCharProvider.ok) {
        await finalizeBegunComponentAsConflict(pool, {
          component: "character-state",
          generationId: started.generationId,
        });
        failures.push({ component: "character-state", panelIndex, kind: "conflict" });
        return failOperationConflict(pool, operationId, failures);
      }
      const charArgs = providerInvocationFromBegin(started, {
        component: "character-state",
        panelIndex,
      });
      emit("visual-character-state-start", {
        operationId,
        frameId,
        component: "character-state",
        panelIndex,
        generationId: started.generationId,
        generationRecordId: started.generationRecordId,
        model: charArgs.model,
      });
      let providerResult;
      try {
        providerResult = await generateImage({ ...charArgs, env });
      } catch {
        providerResult = { ok: false, kind: "provider" };
      }
      const charOutcome = normalizeProviderOutcome(providerResult);
      emit("visual-character-state-provider", {
        operationId,
        frameId,
        component: "character-state",
        panelIndex,
        generationId: started.generationId,
        status: charOutcome.ok ? "ok" : "failed",
        kind: charOutcome.ok ? undefined : (charOutcome.kind || "provider"),
        providerStatus: charOutcome.providerStatus,
        latencyMs: charOutcome.latencyMs,
        model: charArgs.model,
      });
      const finalized = await finalizeCharacterStateLifecycle(pool, {
        generationId: started.generationId,
        providerResult,
        advanceWithOperationId: operationId,
      });
      emit("visual-character-state-matte", {
        operationId,
        frameId,
        component: "character-state",
        panelIndex,
        generationId: started.generationId,
        status: finalized.ok && finalized.status === "ready" ? "ok" : "failed",
        kind: finalized.errorKind || (finalized.ok ? undefined : finalized.kind),
        accepted: Boolean(finalized.ok && finalized.status === "ready"),
      });
      emit("visual-character-state-storage", {
        operationId,
        frameId,
        component: "character-state",
        panelIndex,
        generationId: started.generationId,
        status: finalized.ok ? finalized.status : "failed",
        kind: finalized.ok ? finalized.errorKind : (finalized.kind || "database"),
        advancedCurrentPointer: Boolean(finalized.advancedCurrentPointer),
      });
      const afterPanel = await assertFrameOperationAuthority(pool, { operationId, frameId });
      if (!afterPanel.ok) {
        return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
      }
      if (!finalized.ok || finalized.status === "failed") {
        const kind = finalized.errorKind || normalizeProviderOutcome(providerResult).kind || "provider";
        failures.push({ component: "character-state", panelIndex, kind });
        await evaluateHybridAssembly(pool, { frameId, operationId });
        await updateFrameOperation(pool, {
          operationId,
          phase: "failed",
          status: "failed",
          errorKind: kind,
          componentFailures: failures,
        });
        return { ok: false, kind, componentFailures: failures };
      }
    }

    const beforeAssemble = await assertFrameOperationAuthority(pool, { operationId, frameId });
    if (!beforeAssemble.ok) {
      return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
    }
    await updateFrameOperation(pool, { operationId, phase: "assembling", status: "running" });
    emit("visual-hybrid-operation-phase", {
      operationId, frameId, scope: operationScope, panelIndex: scopedPanelIndex,
      phase: "assembling", status: "running",
    });
    const assembly = await evaluateHybridAssembly(pool, { frameId, operationId });
    if (!assembly.ok) {
      if (assembly.kind === "conflict") {
        return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
      }
      failures.push({ component: "assembly", kind: assembly.kind || "assembly-failed" });
      await updateFrameOperation(pool, {
        operationId,
        phase: "failed",
        status: "failed",
        errorKind: assembly.kind || "assembly-failed",
        componentFailures: failures,
      });
      return { ok: false, kind: assembly.kind || "assembly-failed", componentFailures: failures };
    }
    if (!assembly.visualReady) {
      failures.push({ component: "assembly", kind: "assembly-failed" });
      await updateFrameOperation(pool, {
        operationId,
        phase: "failed",
        status: "failed",
        errorKind: "assembly-failed",
        componentFailures: failures,
      });
      return { ok: false, kind: "assembly-failed", componentFailures: failures };
    }

    const beforeComplete = await assertFrameOperationAuthority(pool, { operationId, frameId });
    if (!beforeComplete.ok) {
      return failOperationConflict(pool, operationId, [{ component: "operation", kind: "conflict" }]);
    }
    await updateFrameOperation(pool, {
      operationId,
      phase: "complete",
      status: "complete",
      errorKind: null,
      componentFailures: [],
    });
    emit("visual-hybrid-operation-phase", {
      operationId, frameId, scope: operationScope, panelIndex: scopedPanelIndex,
      phase: "complete", status: "complete",
    });
    return { ok: true, phase: "complete", visualReady: true, scope: operationScope, panelIndex: scopedPanelIndex };
  } catch (error) {
    const kind = error?.kind || "provider";
    failures.push({ component: "operation", kind });
    await updateFrameOperation(pool, {
      operationId,
      phase: "failed",
      status: "failed",
      errorKind: kind,
      componentFailures: failures,
    }).catch(() => {});
    return { ok: false, kind, componentFailures: failures };
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
    readAsset: (id) => readAsset(pool, id),
    loadStructure: () => loadStoryboardStructure(pool),
    ensureHybridHeads: (input) => ensureHybridHeads(pool, input),
    createFrameOperation: (input) => createFrameOperation(pool, input),
    hasReadyPrimaryBackground: () => hasReadyPrimaryBackground(pool),
    claimOrReuseSceneBackground: (input) => claimOrReuseSceneBackground(pool, input),
    createSceneBackgroundGeneration: (input) => createSceneBackgroundGeneration(pool, input),
    finalizeSceneBackgroundGeneration: (input) => finalizeSceneBackgroundGeneration(pool, input),
    createCharacterStateGeneration: (input) => createCharacterStateGeneration(pool, input),
    finalizeCharacterStateGeneration: (input) => finalizeCharacterStateGeneration(pool, input),
    finalizeGenerationRecord: (input) => finalizeGenerationRecord(pool, input),
    loadHybridPersistence: (input) => loadHybridPersistence(pool, input),
    updateFrameOperation: (input) => updateFrameOperation(pool, input),
    getFrameOperation: (input) => getFrameOperation(pool, input),
    assertFrameOperationAuthority: (input) => assertFrameOperationAuthority(pool, input),
    beginSceneBackgroundLifecycle: (input) => beginSceneBackgroundLifecycle(pool, input),
    finalizeSceneBackgroundLifecycle: (input) => finalizeSceneBackgroundLifecycle(pool, input),
    beginCharacterStateLifecycle: (input) => beginCharacterStateLifecycle(pool, input),
    finalizeCharacterStateLifecycle: (input) => finalizeCharacterStateLifecycle(pool, input),
    evaluateHybridAssembly: (input) => evaluateHybridAssembly(pool, input),
    orchestrateHybridFrameOperation: (input) => orchestrateHybridFrameOperation(pool, input),
  };
}
