import { randomUUID } from "node:crypto";
import { inspectImage } from "./image-info.mjs";
import { expandStoryboardFrames, placement, resolvePanelSubject } from "./visual-model.mjs";

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

    const frames = expandStoryboardFrames(context.version.frames).map((frame) => {
      const panels = frame.panels.map((panel, panelIndex) => {
        const state = stateByKey.get(`${frame.id}:${panelIndex}`);
        const latestGeneration = state ? latestByState.get(state.id) : null;
        const anchorCurrent = !state?.subject || (
          state.anchor_version_id && approvedByName.get(state.subject) === state.anchor_version_id
        );
        const outputAssetId = state?.generation_status === "ready" && anchorCurrent ? state.output_asset_id : null;
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
          assetId: outputAssetId,
          asset: assetUrl(outputAssetId),
          performanceAssetId: state?.performance_asset_id ?? null,
          performanceAssetUrl: assetUrl(state?.performance_asset_id),
          generationStatus: latestGeneration?.status ?? null,
          generationError: latestGeneration?.error_kind ?? null,
          instruction: state?.generation_instruction ?? "",
          ...placed,
        };
      });
      return { ...frame, panels, visualReady: panels.length > 0 && panels.every((panel) => panel.assetId) };
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
    const styleSeed = await backfillStyleSeed(client, context.result.material_state_id);
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

export async function updatePlacement(pool, { frameId, panelIndex, zoom, positionX, positionY }) {
  const numbers = [zoom, positionX, positionY].map(Number);
  if (!frameId || !Number.isInteger(panelIndex) || panelIndex < 0
      || !numbers.every(Number.isFinite)
      || numbers[0] < 1 || numbers[0] > 3
      || numbers[1] < 0 || numbers[1] > 100
      || numbers[2] < 0 || numbers[2] > 100) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      const target = await panelContext(client, frameId, panelIndex);
      if (!target) return failed("not-found", 404);
      await client.query(`
        UPDATE panel_visual_state
        SET zoom = $2, position_x = $3, position_y = $4, updated_at = clock_timestamp()
        WHERE id = $1
      `, [target.state.id, ...numbers]);
      return { ok: true };
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

const PRIMARY_SCENE_KEY = "primary";
const HYBRID_COMPOSITION_MODES = new Set([
  "near-frontal-pair",
  "inward-conversation",
  "asymmetric-pair",
]);

async function ensureSceneBackgroundState(client, storyboardVersionId) {
  const existing = await client.query(
    `SELECT * FROM scene_background_state
     WHERE storyboard_version_id = $1 AND scene_key = $2`,
    [storyboardVersionId, PRIMARY_SCENE_KEY],
  );
  if (existing.rowCount === 1) return existing.rows[0];
  const id = randomUUID();
  await client.query(`
    INSERT INTO scene_background_state (
      id, storyboard_version_id, scene_key, write_version
    ) VALUES ($1, $2, $3, 0)
  `, [id, storyboardVersionId, PRIMARY_SCENE_KEY]);
  const created = await client.query(`SELECT * FROM scene_background_state WHERE id = $1`, [id]);
  return created.rows[0];
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
      await ensureFrameHybridState(client, {
        storyboardVersionId: context.version.id,
        frameId,
      });
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
  if (!provenance?.compiledPrompt || !provenance?.promptCompilerVersion) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const operation = await client.query(
        `SELECT * FROM visual_frame_operation WHERE id = $1`,
        [operationId],
      );
      if (operation.rowCount !== 1) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const op = operation.rows[0];
      const scene = await ensureSceneBackgroundState(client, op.storyboard_version_id);
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
        provenance.model ?? null,
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
      await client.query("COMMIT");
      return {
        ok: true,
        generationId,
        generationRecordId: recordId,
        sceneBackgroundStateId: scene.id,
        capturedSceneWriteVersion,
        status: "pending",
      };
    });
  } catch {
    return failed("database", 503);
  }
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
      if (terminal === "ready") {
        const scene = await client.query(
          `SELECT * FROM scene_background_state WHERE id = $1 FOR UPDATE`,
          [row.scene_background_state_id],
        );
        const state = scene.rows[0];
        const authorityMatches = state.active_operation_id === row.operation_id
          && Number(state.write_version) === Number(row.captured_scene_write_version);
        if (authorityMatches) {
          await client.query(`
            UPDATE scene_background_state
            SET current_generation_id = $2,
                active_operation_id = NULL,
                updated_at = clock_timestamp()
            WHERE id = $1
          `, [state.id, generationId]);
          advanced = true;
        }
      }
      await client.query("COMMIT");
      return {
        ok: true,
        generationId,
        status: terminal,
        errorKind,
        outputAssetId,
        advancedCurrentPointer: advanced,
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
  if (!provenance?.compiledPrompt || !provenance?.promptCompilerVersion) {
    return failed("invalid-request");
  }
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const operation = await client.query(
        `SELECT * FROM visual_frame_operation WHERE id = $1`,
        [operationId],
      );
      if (operation.rowCount !== 1) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const op = operation.rows[0];
      const target = await panelContext(client, frameId, panelIndex);
      if (!target || target.context.version.id !== op.storyboard_version_id) {
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
        provenance.model ?? null,
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
      if (result?.ok) {
        if (result.rawImage) {
          rawAssetId = (await insertAsset(client, "character-state-raw", result.rawImage)).id;
        }
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
    RETURNING id, status, compiled_prompt, visual_intent_json, reference_manifest_json
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
    claimOrReuseSceneBackground: (input) => claimOrReuseSceneBackground(pool, input),
    createSceneBackgroundGeneration: (input) => createSceneBackgroundGeneration(pool, input),
    finalizeSceneBackgroundGeneration: (input) => finalizeSceneBackgroundGeneration(pool, input),
    createCharacterStateGeneration: (input) => createCharacterStateGeneration(pool, input),
    finalizeCharacterStateGeneration: (input) => finalizeCharacterStateGeneration(pool, input),
    finalizeGenerationRecord: (input) => finalizeGenerationRecord(pool, input),
    loadHybridPersistence: (input) => loadHybridPersistence(pool, input),
  };
}
