import { randomUUID } from "node:crypto";
import {
  applyOperation,
  ensurePanelIds,
  metadataCarryDecision,
  preservePanelIdentity,
  visibleFrameSignature,
} from "./assembly.mjs";
import { backfillDialogueModes } from "./dialogue-mode.mjs";
import { inspectImage, parseIdentityImage } from "./image-info.mjs";
import { presentFrameTiming } from "./timing.mjs";
import { MATTE_CONTRACT_VERSION } from "./foreground/contract.mjs";
import { attachPanelForeground } from "./foreground/persist.mjs";
import { SYSTEM_PANEL_BACKGROUND } from "./panel-background.mjs";
import { requireProjectId, touchProjectContent } from "./project-scope.mjs";
import {
  initializeEffectiveIntent,
  moveCandidateSelection,
  normalizeRevisionSnapshot,
  PANEL_REVISION_COMPILER_ID,
  PANEL_REVISION_COMPILER_VERSION,
  revisionBasisFor,
  summarizeRevision,
} from "./panel-revision.mjs";
import {
  expandStoryboardFrames,
  isManualCharacterTarget,
  placement,
  resolvePanelSubject,
  resolvePlacementUpdate,
} from "./visual-model.mjs";

function failed(kind, httpStatus = 400) {
  return { ok: false, status: "failed", kind, httpStatus };
}

function assetUrl(id) {
  if (!id) return null;
  const projectId = requireProjectId();
  return `/api/projects/${projectId}/visual/assets/${id}`;
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
  const projectId = requireProjectId();
  const result = await client.query(`
    SELECT storyboard_result.id,
           storyboard_result.material_state_id,
           storyboard_result.stage_payload
    FROM project
    JOIN storyboard_result
      ON storyboard_result.material_state_id = project.active_material_state_id
    WHERE project.id = $1
      AND storyboard_result.status = 'checked'
    ORDER BY storyboard_result.created_at DESC, storyboard_result.id DESC
    LIMIT 1
  `, [projectId]);
  return result.rows[0] ?? null;
}

async function castFor(client, materialStateId) {
  const characters = await client.query(`
    SELECT name FROM canonical_character
    WHERE material_state_id = $1
      AND included = true
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
  if (head.rowCount === 1) {
    const context = { result, version: head.rows[0] };
    await persistDialogueModes(client, context);
    return context;
  }
  const id = randomUUID();
  const frames = backfillDialogueModes(
    Array.isArray(result.stage_payload?.frames) ? result.stage_payload.frames : [],
  ).frames;
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

async function persistDialogueModes(client, context) {
  const rows = await client.query(
    `SELECT id, frames FROM storyboard_version WHERE storyboard_result_id = $1`,
    [context.result.id],
  );
  for (const row of rows.rows) {
    const filled = backfillDialogueModes(row.frames);
    if (!filled.changed) continue;
    await client.query(
      `UPDATE storyboard_version SET frames = $2::jsonb WHERE id = $1`,
      [row.id, JSON.stringify(filled.frames)],
    );
    if (row.id === context.version.id) context.version.frames = filled.frames;
  }
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

async function copyDuplicatedPanelState(client, fromVersionId, toVersionId, copies) {
  for (const copy of copies || []) {
    if (typeof copy?.sourcePanelId !== "string" || !copy.sourcePanelId) continue;
    if (typeof copy.panelId !== "string" || !copy.panelId) continue;
    if (typeof copy.frameId !== "string" || !copy.frameId) continue;
    if (!Number.isInteger(copy.panelIndex) || copy.panelIndex < 0) continue;
    // The generation pointer stays on the source panel's copied row. The duplicate
    // keeps the effective asset, placement, and performance reference without a
    // second panel_generation row or a claim on the source attempt.
    await client.query(`
      INSERT INTO panel_visual_state (
        id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
        performance_asset_id, current_generation_id, zoom, position_x, position_y, mirrored,
        assigned_asset_id, assignment_origin, current_asset_id, current_asset_origin
      )
      SELECT $1, $2, $3, $4, $5, subject,
             performance_asset_id, NULL, zoom, position_x, position_y, mirrored,
             assigned_asset_id, assignment_origin, current_asset_id, current_asset_origin
      FROM panel_visual_state
      WHERE storyboard_version_id = $6 AND panel_id = $7
    `, [
      randomUUID(),
      toVersionId,
      copy.frameId,
      copy.panelIndex,
      copy.panelId,
      fromVersionId,
      copy.sourcePanelId,
    ]);
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
          assigned_asset_id, assignment_origin, current_asset_id, current_asset_origin
        )
        SELECT $1, $2, $3, $4, panel_id, subject,
               performance_asset_id, current_generation_id, zoom, position_x, position_y, mirrored,
               assigned_asset_id, assignment_origin, current_asset_id, current_asset_origin
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

const UNDO_LABELS = {
  insertFrame: "вставку кадра",
  deleteFrame: "удаление кадра",
  duplicateFrame: "дублирование кадра",
  reorderFrames: "перемещение кадра",
  addPanel: "добавление панели",
  deletePanel: "удаление панели",
  reorderPanels: "перестановку панелей",
  setDuration: "длительность",
  setTextCard: "текст карточки",
  setOwnerDescription: "заметку к панели",
  setManualSubject: "выбор персонажа",
  setFrameDialogue: "диалог кадра",
  uploadAsset: "загрузку изображения",
  assignAsset: "назначение изображения",
  batch: "несколько изменений",
  placement: "кадрирование",
  "panel-generation": "генерацию панели",
  "panel-revision-accept": "принятие кандидата панели",
};

function undoLabelFor(instruction) {
  if (UNDO_LABELS[instruction]) return UNDO_LABELS[instruction];
  const text = String(instruction || "").trim();
  if (!text) return "последнее изменение";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

async function backfillCurrentAssets(client, versionId) {
  await client.query(`
    UPDATE panel_visual_state
    SET current_asset_id = assigned_asset_id,
        current_asset_origin = assignment_origin
    WHERE storyboard_version_id = $1
      AND current_asset_id IS NULL
      AND assigned_asset_id IS NOT NULL
  `, [versionId]);
  await client.query(`
    UPDATE panel_visual_state AS panel_state
    SET current_asset_id = panel_generation.output_asset_id,
        current_asset_origin = 'generation'
    FROM panel_generation
    WHERE panel_state.storyboard_version_id = $1
      AND panel_state.current_asset_id IS NULL
      AND panel_state.current_generation_id = panel_generation.id
      AND panel_generation.status = 'ready'
      AND panel_generation.output_asset_id IS NOT NULL
  `, [versionId]);
}

async function forkVisibleState(client, current, { instruction, frames, customize = null, operationContext = null }) {
  const versionId = randomUUID();
  const nextFrames = frames ?? current.version.frames;
  await client.query(`
    INSERT INTO storyboard_version (
      id, storyboard_result_id, parent_storyboard_version_id, instruction, frames, operation_context
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
  `, [
    versionId,
    current.result.id,
    current.version.id,
    instruction,
    JSON.stringify(nextFrames),
    operationContext ? JSON.stringify(operationContext) : null,
  ]);
  await copyPanelState(client, current.version.id, versionId, nextFrames);
  const next = {
    result: current.result,
    version: {
      id: versionId,
      parent_storyboard_version_id: current.version.id,
      frames: nextFrames,
      instruction,
    },
  };
  if (customize) await customize(client, next);
  await client.query(
    `UPDATE storyboard_head SET active_storyboard_version_id = $2 WHERE storyboard_result_id = $1`,
    [current.result.id, versionId],
  );
  const cast = await castFor(client, current.result.material_state_id);
  await ensurePanelRows(client, next, cast);
  return next;
}

async function ensurePanelRows(client, context, cast) {
  const frames = expandStoryboardFrames(context.version.frames);
  for (const frame of frames) {
    for (let panelIndex = 0; panelIndex < (frame.panels || []).length; panelIndex += 1) {
      const panel = frame.panels[panelIndex];
      const derived = resolvePanelSubject(panel.description, cast.characters, cast.aliases);
      const manual = typeof panel.manualSubject === "string" ? panel.manualSubject.trim() : "";
      const subject = manual || derived;
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
     FROM visual_asset WHERE id = $1 AND project_id = $2`,
    [assetId, requireProjectId()],
  );
  return result.rows[0] ?? null;
}

async function generationOwned(client, generationId) {
  const result = await client.query(`
    SELECT panel_generation.id
    FROM panel_generation
    JOIN panel_visual_state ON panel_visual_state.id = panel_generation.panel_visual_state_id
    JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
    JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
    JOIN material_state ON material_state.id = storyboard_result.material_state_id
    JOIN source_revision ON source_revision.id = material_state.source_revision_id
    WHERE panel_generation.id = $1 AND source_revision.project_id = $2
  `, [generationId, requireProjectId()]);
  return result.rowCount === 1;
}

async function anchorOwned(client, anchorId) {
  const result = await client.query(`
    SELECT character_anchor_version.id
    FROM character_anchor_version
    JOIN material_state ON material_state.id = character_anchor_version.material_state_id
    JOIN source_revision ON source_revision.id = material_state.source_revision_id
    WHERE character_anchor_version.id = $1 AND source_revision.project_id = $2
  `, [anchorId, requireProjectId()]);
  return result.rowCount === 1;
}

function imageBytes(image) {
  return image?.bytes ?? image?.buffer ?? null;
}

function invalidImageError() {
  const error = new Error("invalid-image");
  error.kind = "invalid-image";
  return error;
}

const PROVENANCE_INTENT_KEYS = [
  "framing",
  "upperBody",
  "gesture",
  "headPose",
  "gaze",
  "expression",
  "background",
  "eyes",
  "eyebrows",
];

export function sanitizeProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  if (value.origin === "generation" || value.origin === "upload" || value.origin === "reuse") {
    out.origin = value.origin;
  }
  if (typeof value.subject === "string" && value.subject) out.subject = value.subject;
  if (typeof value.description === "string" && value.description.trim()) out.description = value.description;
  if (typeof value.submittedText === "string" && value.submittedText.trim()) out.submittedText = value.submittedText;
  if (typeof value.structureFrameId === "string" && value.structureFrameId) out.structureFrameId = value.structureFrameId;
  if (typeof value.panelId === "string" && value.panelId) out.panelId = value.panelId;
  if (Number.isInteger(value.panelIndex) && value.panelIndex >= 0) out.panelIndex = value.panelIndex;
  if (typeof value.storyboardResultId === "string" && value.storyboardResultId) {
    out.storyboardResultId = value.storyboardResultId;
  }
  if (typeof value.styleAssetId === "string" && value.styleAssetId) out.styleAssetId = value.styleAssetId;
  if (typeof value.anchorVersionId === "string" && value.anchorVersionId) out.anchorVersionId = value.anchorVersionId;
  if (typeof value.sourceAssetId === "string" && value.sourceAssetId) out.sourceAssetId = value.sourceAssetId;
  if (value.matteContractVersion === MATTE_CONTRACT_VERSION) out.matteContractVersion = value.matteContractVersion;
  if (typeof value.matteContractSha256 === "string" && /^[0-9a-f]{64}$/.test(value.matteContractSha256)) {
    out.matteContractSha256 = value.matteContractSha256;
  }
  if (value.intent && typeof value.intent === "object" && !Array.isArray(value.intent)) {
    const intent = {};
    for (const key of PROVENANCE_INTENT_KEYS) {
      if (typeof value.intent[key] === "string" && value.intent[key]) intent[key] = value.intent[key];
    }
    if (Object.keys(intent).length) out.intent = intent;
  }
  if (value.effectiveIntent && typeof value.effectiveIntent === "object" && !Array.isArray(value.effectiveIntent)) {
    out.effectiveIntent = normalizeRevisionSnapshot(value.effectiveIntent);
  }
  return Object.keys(out).length ? out : null;
}

function publicProvenance(value) {
  const clean = sanitizeProvenance(value);
  if (!clean) return null;
  return {
    origin: clean.origin ?? null,
    subject: clean.subject ?? null,
    description: clean.description ?? null,
    submittedText: clean.submittedText ?? null,
    structureFrameId: clean.structureFrameId ?? null,
    panelId: clean.panelId ?? null,
    panelIndex: clean.panelIndex ?? null,
  };
}

export async function insertAsset(client, kind, image, provenance = null) {
  const bytes = imageBytes(image);
  const inspected = bytes ? inspectImage(bytes) : { mime: null };
  if (!inspected.mime || !["image/png", "image/jpeg", "image/webp"].includes(inspected.mime)) {
    throw invalidImageError();
  }
  const id = randomUUID();
  const clean = sanitizeProvenance(provenance);
  await client.query(`
    INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes, provenance)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  `, [
    id,
    requireProjectId(),
    kind,
    inspected.mime,
    inspected.width,
    inspected.height,
    inspected.byteLength,
    inspected.sha256,
    bytes,
    clean ? JSON.stringify(clean) : null,
  ]);
  return { id, ...inspected, provenance: clean };
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
      AND visual_asset.project_id = $3
    WHERE character_identity.material_state_id = $1
      AND character_identity.character_name = $2
  `, [materialStateId, characterName, requireProjectId()]);
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
  const head = await client.query(`
    SELECT character_anchor_version.*
    FROM character_anchor_head
    JOIN character_anchor_version
      ON character_anchor_version.id = character_anchor_head.anchor_version_id
    WHERE character_anchor_head.material_state_id = $1
      AND character_anchor_head.character_name = $2
      AND character_anchor_version.status = 'approved'
  `, [materialStateId, characterName]);
  return head.rows[0] ?? null;
}

async function setAnchorHead(client, materialStateId, characterName, anchorId) {
  await client.query(`
    INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (material_state_id, character_name)
    DO UPDATE SET anchor_version_id = EXCLUDED.anchor_version_id
  `, [materialStateId, characterName, anchorId]);
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
    await backfillCurrentAssets(client, context.version.id);
    const cast = await castFor(client, context.result.material_state_id);
    await ensurePanelRows(client, context, cast);
    await client.query("COMMIT");

    const states = await client.query(`
      SELECT panel_visual_state.*,
             panel_generation.status AS generation_status,
             panel_generation.anchor_version_id,
             panel_generation.output_asset_id,
             panel_generation.instruction AS generation_instruction,
             current_asset.provenance AS current_asset_provenance
      FROM panel_visual_state
      LEFT JOIN panel_generation ON panel_generation.id = panel_visual_state.current_generation_id
      LEFT JOIN visual_asset AS current_asset ON current_asset.id = panel_visual_state.current_asset_id
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
    const currentAssetIds = states.rows.map((row) => row.current_asset_id).filter(Boolean);
    const extractionRows = currentAssetIds.length === 0
      ? { rows: [] }
      : await client.query(`
        SELECT source_asset_id, foreground_asset_id, status, findings, extractor_version, contract_version
        FROM panel_foreground_extraction
        WHERE project_id = $1 AND source_asset_id = ANY($2::uuid[])
      `, [requireProjectId(), currentAssetIds]);
    const extractionByAsset = new Map(extractionRows.rows.map((row) => [row.source_asset_id, row]));

    const anchors = [];
    const approvedByName = new Map();
    for (const character of cast.characters) {
      const identity = await currentIdentity(client, context.result.material_state_id, character.name);
      const candidate = await latestAnchor(client, context.result.material_state_id, character.name, {
        identityAssetId: identity?.current_asset_id ?? null,
      });
      const approved = await approvedAnchor(client, context.result.material_state_id, character.name);
      if (approved) approvedByName.set(character.name, approved.id);
      const anchorProvenance = approved?.provenance || null;
      const showSource = Boolean(identity) && anchorProvenance !== "uploaded_as_ready_anchor" && Boolean(approved);
      anchors.push({
        name: character.name,
        anchorProvenance,
        sourcePhoto: showSource ? {
          assetId: identity.current_asset_id,
          assetUrl: assetUrl(identity.current_asset_id),
        } : null,
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
    const openRevisions = await loadOpenRevisions(client, anchors, states.rows);

    const frames = expandStoryboardFrames(context.version.frames).map((frame) => {
      const panels = frame.panels.map((panel, panelIndex) => {
        const state = stateByKey.get(`${frame.id}:${panelIndex}`);
        const latestGeneration = state ? latestByState.get(state.id) : null;
        const derivedSubject = resolvePanelSubject(panel.description, cast.characters, cast.aliases);
        const outputAssetId = state?.current_asset_id ?? null;
        const extractionRow = outputAssetId ? extractionByAsset.get(outputAssetId) : null;
        const usesForeground = extractionRow?.status === "candidate-pass" && Boolean(extractionRow.foreground_asset_id);
        const drawAssetId = usesForeground ? extractionRow.foreground_asset_id : outputAssetId;
        const extractionFindings = Array.isArray(extractionRow?.findings) ? extractionRow.findings : [];
        const placed = placement({
          zoom: state?.zoom ?? 1,
          positionX: state?.position_x ?? 50,
          positionY: state?.position_y ?? 30,
          mirrored: state?.mirrored === true,
        });
        return {
          ...panel,
          subject: state?.subject ?? null,
          role: frame.dialogueMode === "silent"
            ? "Молчит"
            : (frame.dialogueMode === "hidden" || !Number.isInteger(frame.speakerPanel)
              ? "Действие"
              : (frame.speakerPanel === panelIndex ? "Говорит" : "Слушает")),
          stateId: state?.id ?? null,
          assetId: outputAssetId,
          drawAssetId: outputAssetId ? drawAssetId : null,
          asset: assetUrl(outputAssetId ? drawAssetId : null),
          backgroundColor: SYSTEM_PANEL_BACKGROUND,
          extraction: outputAssetId ? {
            status: extractionRow?.status ?? "not-extracted",
            usesForeground,
            findings: extractionFindings.map((finding) => ({
              code: finding.code,
              level: finding.level,
            })),
            extractorVersion: extractionRow?.extractor_version ?? null,
            contractVersion: extractionRow?.contract_version ?? null,
          } : null,
          assignmentOrigin: outputAssetId ? (state?.current_asset_origin ?? null) : null,
          subjectEditable: !derivedSubject,
          ownerDescription: typeof panel.ownerDescription === "string" ? panel.ownerDescription : "",
          performanceAssetId: state?.performance_asset_id ?? null,
          performanceAssetUrl: assetUrl(state?.performance_asset_id),
          assetProvenance: publicProvenance(state?.current_asset_provenance),
          generationStatus: latestGeneration?.status ?? null,
          generationError: latestGeneration?.error_kind ?? null,
          instruction: state?.generation_instruction ?? "",
          revision: openRevisions.get(panel.id) || openRevisions.get(state?.panel_id) || null,
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
    const reusable = await listReusableAssetRows(client, context.result.id, requireProjectId());
    return {
      ok: true,
      status: "ready",
      materialStateId: context.result.material_state_id,
      storyboardResultId: context.result.id,
      storyboardVersionId: context.version.id,
      canUndo: Boolean(context.version.parent_storyboard_version_id),
      undoLabel: context.version.parent_storyboard_version_id
        ? undoLabelFor(context.version.instruction)
        : null,
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
        provenance: publicProvenance(row.provenance),
        createdAt: row.created_at ?? null,
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

function revisionMode(value) {
  return value === "new-variation" ? "new-variation" : "refine";
}

async function loadOpenRevisions(client, anchors, states) {
  const sessions = await client.query(`
    SELECT *
    FROM panel_revision_session
    WHERE project_id = $1 AND status = 'open'
    ORDER BY created_at, id
  `, [requireProjectId()]);
  if (sessions.rowCount === 0) return new Map();
  const candidates = await client.query(`
    SELECT candidate.*, panel_generation.output_asset_id
    FROM panel_revision_candidate candidate
    JOIN panel_generation ON panel_generation.id = candidate.panel_generation_id
    WHERE candidate.session_id = ANY($1::uuid[])
    ORDER BY candidate.ordinal, candidate.id
  `, [sessions.rows.map((row) => row.id)]);
  const bySession = new Map();
  for (const row of candidates.rows) {
    const list = bySession.get(row.session_id) || [];
    list.push(row);
    bySession.set(row.session_id, list);
  }
  const stateByPanel = new Map((states || []).filter((row) => row.panel_id).map((row) => [row.panel_id, row]));
  const anchorByName = new Map((anchors || []).map((anchor) => [anchor.name, anchor.approvedAnchorId]));
  const presented = new Map();
  for (const session of sessions.rows) {
    const rows = bySession.get(session.id) || [];
    const selected = rows.find((row) => row.id === session.selected_candidate_id) || null;
    const state = stateByPanel.get(session.panel_id);
    const provenance = state?.current_asset_provenance && typeof state.current_asset_provenance === "object"
      ? state.current_asset_provenance
      : null;
    const baseline = selected
      ? normalizeRevisionSnapshot(selected.effective_intent)
      : initializeEffectiveIntent({
        snapshot: provenance?.effectiveIntent || null,
        provenanceIntent: provenance?.intent || null,
        characterName: state?.subject || null,
        identityAuthorityId: anchorByName.get(state?.subject) || null,
        performanceAssetId: state?.performance_asset_id || null,
      });
    const mode = revisionMode(session.draft_mode);
    const summary = summarizeRevision({
      mode,
      instruction: session.draft_instruction || "",
      baseline,
      basis: revisionBasisFor({ mode, selected }),
    });
    presented.set(session.panel_id, {
      id: session.id,
      draftMode: mode,
      draftInstruction: session.draft_instruction || "",
      reconstruction: baseline.reconstruction,
      selectedCandidateId: selected?.id || null,
      summary: summary.ok ? publicSummary(summary) : null,
      candidates: rows.map((row) => ({
        id: row.id,
        ordinal: row.ordinal,
        mode: row.mode,
        assetId: row.output_asset_id,
        assetUrl: assetUrl(row.output_asset_id),
        basisKind: row.visual_basis_kind,
        basisOrdinal: row.visual_basis_ordinal,
        panelGenerationId: row.panel_generation_id,
      })),
    });
  }
  return presented;
}

function publicSummary(summary) {
  return {
    mode: summary.mode,
    basis: summary.basis,
    changes: summary.changes,
    preserved: summary.preserved,
    notApplied: summary.notApplied,
    reconstruction: summary.reconstruction,
    deterministicControl: summary.deterministicControl,
    blockReason: summary.blockReason,
    providerCall: summary.providerCall,
  };
}

async function sessionForPanel(client, panelId, { openOnly = true } = {}) {
  const result = await client.query(`
    SELECT *
    FROM panel_revision_session
    WHERE project_id = $1 AND panel_id = $2
      AND ($3::boolean = false OR status = 'open')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [requireProjectId(), panelId, openOnly]);
  return result.rows[0] ?? null;
}

async function revisionCandidates(client, sessionId) {
  const result = await client.query(`
    SELECT candidate.*, panel_generation.output_asset_id, panel_generation.performance_intent,
           panel_generation.performance_asset_id AS generation_performance_asset_id
    FROM panel_revision_candidate candidate
    JOIN panel_generation ON panel_generation.id = candidate.panel_generation_id
    WHERE candidate.session_id = $1
    ORDER BY candidate.ordinal, candidate.id
  `, [sessionId]);
  return result.rows;
}

async function revisionAuthorities(client, target) {
  const subject = target.state.subject;
  const anchor = subject ? await approvedAnchor(client, target.context.result.material_state_id, subject) : null;
  const style = await projectStyleAsset(client, target.context.result.material_state_id);
  const provenance = target.state.current_asset_id
    ? (await client.query(
      `SELECT provenance FROM visual_asset WHERE id = $1 AND project_id = $2`,
      [target.state.current_asset_id, requireProjectId()],
    )).rows[0]?.provenance
    : null;
  return { subject, anchor, style, provenance: provenance && typeof provenance === "object" ? provenance : null };
}

async function buildRevisionPlan(client, { frameId, panelIndex, mode, instruction }) {
  const target = await panelContext(client, frameId, panelIndex);
  if (!target?.state?.panel_id) return failed(target ? "invalid-request" : "not-found", target ? 400 : 404);
  if (!target.state.current_asset_id) return failed("image-required", 409);
  const chosenMode = revisionMode(mode);
  const authorities = await revisionAuthorities(client, target);
  if (authorities.subject && !authorities.anchor) return failed("anchor-required", 409);
  const session = await sessionForPanel(client, target.state.panel_id);
  const candidates = session ? await revisionCandidates(client, session.id) : [];
  const selected = candidates.find((row) => row.id === session?.selected_candidate_id) || null;
  const baseline = selected
    ? normalizeRevisionSnapshot(selected.effective_intent)
    : initializeEffectiveIntent({
      snapshot: authorities.provenance?.effectiveIntent || null,
      provenanceIntent: authorities.provenance?.intent || null,
      characterName: authorities.subject,
      identityAuthorityId: authorities.anchor?.id || null,
      performanceAssetId: target.state.performance_asset_id || null,
      styleAssetId: authorities.style?.id || null,
    });
  const summary = summarizeRevision({
    mode: chosenMode,
    instruction,
    baseline,
    basis: revisionBasisFor({ mode: chosenMode, selected }),
  });
  const basisAssetId = summary.basis.kind === "candidate"
    ? selected?.output_asset_id || null
    : (summary.basis.kind === "current-panel" ? target.state.current_asset_id : null);
  return {
    ok: true,
    target,
    authorities,
    session,
    candidates,
    selected,
    baseline,
    summary,
    basisAssetId,
    mode: chosenMode,
  };
}

async function attachRevisionCandidate(client, { generation, assetId, revision }) {
  const state = await client.query(
    `SELECT panel_id FROM panel_visual_state WHERE id = $1`,
    [generation.panel_visual_state_id],
  );
  const session = await client.query(`
    SELECT * FROM panel_revision_session
    WHERE id = $1 AND project_id = $2
    FOR UPDATE
  `, [revision.sessionId, requireProjectId()]);
  if (session.rowCount !== 1 || session.rows[0].status !== "open") return failed("not-found", 404);
  if (session.rows[0].panel_id !== state.rows[0]?.panel_id) return failed("not-found", 404);
  const ordinalResult = await client.query(
    `SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM panel_revision_candidate WHERE session_id = $1`,
    [session.rows[0].id],
  );
  const candidateId = randomUUID();
  const ordinal = Number(ordinalResult.rows[0].ordinal);
  await client.query(`
    INSERT INTO panel_revision_candidate (
      id, session_id, ordinal, mode, visual_basis_kind, visual_basis_asset_id, visual_basis_ordinal,
      effective_intent, panel_generation_id, performance_asset_id, reference_identity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)
  `, [
    candidateId,
    session.rows[0].id,
    ordinal,
    revision.mode,
    revision.basisKind,
    revision.basisAssetId,
    revision.basisOrdinal,
    JSON.stringify(normalizeRevisionSnapshot(revision.effectiveIntent)),
    generation.id,
    revision.performanceAssetId || null,
    JSON.stringify(revision.referenceIdentity || {}),
  ]);
  await client.query(`
    UPDATE panel_revision_session
    SET selected_candidate_id = $2,
        draft_mode = $3,
        draft_instruction = $4,
        updated_at = clock_timestamp()
    WHERE id = $1
  `, [session.rows[0].id, candidateId, revision.mode, revision.instruction || ""]);
  return { ok: true, candidateId, assetId };
}

async function ensureRevisionSession(client, plan, instruction) {
  if (plan.session) {
    await client.query(`
      UPDATE panel_revision_session
      SET draft_mode = $2, draft_instruction = $3, updated_at = clock_timestamp()
      WHERE id = $1 AND status = 'open'
    `, [plan.session.id, plan.mode, String(instruction ?? "").trim()]);
    return plan.session.id;
  }
  const id = randomUUID();
  await client.query(`
    INSERT INTO panel_revision_session (
      id, project_id, panel_id, storyboard_version_id, baseline_asset_id, baseline_generation_id,
      baseline_performance_asset_id, compiler_id, compiler_version, draft_mode, draft_instruction, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open')
  `, [
    id,
    requireProjectId(),
    plan.target.state.panel_id,
    plan.target.context.version.id,
    plan.target.state.current_asset_id,
    plan.target.state.current_generation_id,
    plan.target.state.performance_asset_id,
    PANEL_REVISION_COMPILER_ID,
    PANEL_REVISION_COMPILER_VERSION,
    plan.mode,
    String(instruction ?? "").trim(),
  ]);
  return id;
}

function revisionWrite(pool, fn) {
  return withClient(pool, async (client) => {
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      if (!result?.ok) {
        await client.query("ROLLBACK");
        return result;
      }
      await client.query("COMMIT");
      return result;
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      return failed("database", 503);
    }
  });
}

export async function previewPanelRevision(pool, input = {}) {
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const plan = await buildRevisionPlan(client, input);
      await client.query(plan.ok ? "COMMIT" : "ROLLBACK");
      if (!plan.ok) return plan;
      return {
        ok: true,
        summary: publicSummary(plan.summary),
        effectiveIntent: plan.summary.snapshot,
        basisAssetId: plan.basisAssetId,
        basisKind: plan.summary.basis.kind,
        basisOrdinal: plan.summary.basis.ordinal,
        anchorVersionId: plan.authorities.anchor?.id || null,
        identityAssetId: plan.authorities.anchor?.output_asset_id || null,
        styleAssetId: plan.authorities.style?.id || null,
      };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function openPanelRevision(pool, input = {}) {
  try {
    return await revisionWrite(pool, async (client) => {
      const plan = await buildRevisionPlan(client, input);
      if (!plan.ok) return plan;
      const sessionId = await ensureRevisionSession(client, plan, input.instruction);
      return { ok: true, sessionId };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function navigatePanelRevision(pool, { frameId, panelIndex, direction } = {}) {
  if (direction !== "undo" && direction !== "redo") return failed("invalid-request");
  try {
    return await revisionWrite(pool, async (client) => {
      const target = await panelContext(client, frameId, panelIndex);
      if (!target?.state?.panel_id) return failed("not-found", 404);
      const session = await sessionForPanel(client, target.state.panel_id);
      if (!session) return failed("not-found", 404);
      const candidates = await revisionCandidates(client, session.id);
      if (!candidates.length) return { ok: true, changed: false };
      const selectedId = moveCandidateSelection(candidates, session.selected_candidate_id, direction);
      await client.query(`
        UPDATE panel_revision_session
        SET selected_candidate_id = $2, updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'open'
      `, [session.id, selectedId]);
      return { ok: true, changed: selectedId !== session.selected_candidate_id };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function acceptPanelRevision(pool, { frameId, panelIndex, candidateId = null } = {}) {
  try {
    return await revisionWrite(pool, async (client) => {
      let current = await ensureVersion(client);
      if (!current) return failed("not-found", 404);
      await lockHead(client, current.result.id);
      current = await ensureVersion(client);
      const target = await panelContext(client, frameId, panelIndex);
      if (!target?.state?.panel_id) return failed("not-found", 404);
      const session = await client.query(`
        SELECT * FROM panel_revision_session
        WHERE project_id = $1 AND panel_id = $2 AND status = 'open'
        FOR UPDATE
      `, [requireProjectId(), target.state.panel_id]);
      if (session.rowCount !== 1) return failed("not-found", 404);
      const candidates = await revisionCandidates(client, session.rows[0].id);
      const chosenId = candidateId || session.rows[0].selected_candidate_id;
      if (candidateId && candidateId !== session.rows[0].selected_candidate_id) return failed("not-found", 409);
      const chosen = candidates.find((row) => row.id === chosenId);
      if (!chosen?.output_asset_id) return failed("not-found", 404);
      const asset = await assetRow(client, chosen.output_asset_id);
      if (!asset) return failed("not-found", 404);
      const forked = await forkVisibleState(client, current, {
        instruction: "panel-revision-accept",
        operationContext: {
          op: "panel-revision-accept",
          panelId: target.state.panel_id,
          candidateId: chosen.id,
        },
        customize: async (forkClient, next) => {
          await forkClient.query(`
            UPDATE panel_visual_state
            SET current_generation_id = $3,
                current_asset_id = $4,
                current_asset_origin = 'generation',
                performance_asset_id = CASE
                  WHEN $5::text IN ('set', 'clear') THEN $6::uuid
                  ELSE performance_asset_id
                END,
                updated_at = clock_timestamp()
            WHERE storyboard_version_id = $1 AND panel_id = $2
          `, [
            next.version.id,
            target.state.panel_id,
            chosen.panel_generation_id,
            chosen.output_asset_id,
            chosen.performance_intent,
            chosen.generation_performance_asset_id,
          ]);
        },
      });
      const closed = await client.query(`
        UPDATE panel_revision_session
        SET status = 'accepted',
            review_outcome = 'accepted',
            reviewed_at = clock_timestamp(),
            accepted_candidate_id = $2,
            accepted_storyboard_version_id = $3,
            selected_candidate_id = $2,
            updated_at = clock_timestamp()
        WHERE id = $1 AND status = 'open'
      `, [session.rows[0].id, chosen.id, forked.version.id]);
      if (closed.rowCount !== 1) return failed("not-found", 404);
      return { ok: true, storyboardVersionId: forked.version.id, candidateId: chosen.id };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function cancelPanelRevision(pool, { frameId, panelIndex } = {}) {
  try {
    return await revisionWrite(pool, async (client) => {
      const target = await panelContext(client, frameId, panelIndex);
      if (!target?.state?.panel_id) return failed("not-found", 404);
      const closed = await client.query(`
        UPDATE panel_revision_session
        SET status = 'cancelled',
            review_outcome = 'cancelled',
            reviewed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE project_id = $1 AND panel_id = $2 AND status = 'open'
      `, [requireProjectId(), target.state.panel_id]);
      if (closed.rowCount !== 1) return failed("not-found", 404);
      return { ok: true };
    });
  } catch {
    return failed("database", 503);
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
      if (!(await anchorOwned(client, id))) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
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
      await setAnchorHead(
        client,
        context.result.material_state_id,
        characterName,
        updated.rows[0].id,
      );
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
  revisionBasis = null,
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
      const subject = target.state.subject;
      const manual = isManualCharacterTarget(target.frame, panelIndex);
      if (manual && !subject) {
        await client.query("ROLLBACK");
        return failed("subject-required", 409);
      }
      const anchor = subject ? await approvedAnchor(client, target.context.result.material_state_id, subject) : null;
      if (subject && !anchor) {
        await client.query("ROLLBACK");
        return failed("anchor-required", 409);
      }
      const style = await projectStyleAsset(client, target.context.result.material_state_id);
      if (manual && subject && !style) {
        await client.query("ROLLBACK");
        return failed("style-required", 409);
      }
      let performanceAssetId = target.state.performance_asset_id;
      let performanceIntent = "keep";
      if (performanceImage?.bytes) {
        performanceAssetId = (await insertAsset(client, "performance-reference", performanceImage)).id;
        performanceIntent = "set";
      } else if (clearPerformance) {
        performanceAssetId = null;
        performanceIntent = "clear";
      }
      const parent = target.state.current_generation_id
        ? (await client.query("SELECT * FROM panel_generation WHERE id = $1", [target.state.current_generation_id])).rows[0]
        : null;
      const currentAssetId = target.state.current_asset_id ?? null;
      let previous = null;
      if (revisionBasis?.omitPrevious === true) {
        previous = null;
      } else if (typeof revisionBasis?.assetId === "string" && revisionBasis.assetId) {
        previous = await assetRow(client, revisionBasis.assetId);
        if (!previous) {
          await client.query("ROLLBACK");
          return failed("not-found", 404);
        }
      } else {
        previous = currentAssetId
          ? await assetRow(client, currentAssetId)
          : (parent?.output_asset_id ? await assetRow(client, parent.output_asset_id) : null);
      }
      const id = randomUUID();
      await client.query(`
        INSERT INTO panel_generation (
          id, panel_visual_state_id, parent_generation_id, anchor_version_id,
          performance_asset_id, performance_intent, resolved_description, instruction, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      `, [
        id,
        target.state.id,
        parent?.id ?? null,
        anchor?.id ?? null,
        performanceAssetId,
        performanceIntent,
        target.panel.description,
        String(instruction).trim(),
      ]);
      const refs = {
        anchor: anchor?.output_asset_id ? await assetRow(client, anchor.output_asset_id) : null,
        previous,
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

export async function finishPanelGeneration(pool, {
  id,
  result,
  provenance = null,
  runExtraction = undefined,
  revision = null,
} = {}) {
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      if (!(await generationOwned(client, id))) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
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
      const asset = await insertAsset(client, "panel-image", result.image, provenance);
      await attachPanelForeground(client, {
        sourceAsset: asset,
        bytes: imageBytes(result.image),
        contractVersion: asset.provenance?.matteContractVersion ?? null,
        insertAsset,
        ...(typeof runExtraction === "function" ? { runExtraction } : {}),
      });
      await client.query(
        `UPDATE panel_generation
         SET status = 'ready', output_asset_id = $2, provider_metadata = $3::jsonb
         WHERE id = $1`,
        [id, asset.id, JSON.stringify(result.metadata || {})],
      );
      if (revision) {
        const attached = await attachRevisionCandidate(client, {
          generation: generation.rows[0],
          assetId: asset.id,
          revision,
        });
        if (!attached.ok) {
          await client.query("ROLLBACK");
          return attached;
        }
        await client.query("COMMIT");
        return {
          ok: true,
          generationId: id,
          assetId: asset.id,
          applied: false,
          candidateId: attached.candidateId,
        };
      }
      const state = await client.query(
        `SELECT panel_id, frame_id, panel_index FROM panel_visual_state WHERE id = $1`,
        [generation.rows[0].panel_visual_state_id],
      );
      const panelId = state.rows[0]?.panel_id ?? null;
      let current = await ensureVersion(client);
      if (!current || !panelId) {
        await client.query("COMMIT");
        return { ok: true, generationId: id, assetId: asset.id, applied: false };
      }
      await lockHead(client, current.result.id);
      current = await ensureVersion(client);
      const visible = expandStoryboardFrames(current.version.frames)
        .some((frame) => (frame.panels || []).some((panel) => panel.id === panelId));
      if (!visible) {
        await client.query("COMMIT");
        return { ok: true, generationId: id, assetId: asset.id, applied: false };
      }
      await forkVisibleState(client, current, {
        instruction: "panel-generation",
        operationContext: {
          op: "panel-generation",
          structureFrameId: state.rows[0]?.frame_id ?? null,
          panelId,
          panelIndex: state.rows[0]?.panel_index ?? null,
        },
        customize: async (forkClient, next) => {
          await forkClient.query(`
            UPDATE panel_visual_state
            SET current_generation_id = $3,
                current_asset_id = $4,
                current_asset_origin = 'generation',
                performance_asset_id = CASE
                  WHEN $5::text IN ('set', 'clear') THEN $6::uuid
                  ELSE performance_asset_id
                END,
                updated_at = clock_timestamp()
            WHERE storyboard_version_id = $1 AND panel_id = $2
          `, [
            next.version.id,
            panelId,
            id,
            asset.id,
            generation.rows[0].performance_intent,
            generation.rows[0].performance_asset_id,
          ]);
        },
      });
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
      const target = await panelContext(client, frameId, panelIndex);
      if (!target) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const resolved = resolvePlacementUpdate(target.state, input);
      if (!resolved) {
        await client.query("ROLLBACK");
        return failed("invalid-request");
      }
      const unchanged = Number(target.state.zoom) === resolved.zoom
        && Number(target.state.position_x) === resolved.positionX
        && Number(target.state.position_y) === resolved.positionY
        && (target.state.mirrored === true) === resolved.mirrored;
      if (unchanged) {
        await client.query("COMMIT");
        return {
          ok: true,
          changed: false,
          placement: resolved,
        };
      }
      await forkVisibleState(client, current, {
        instruction: "placement",
        customize: async (forkClient, next) => {
          await forkClient.query(`
            UPDATE panel_visual_state
            SET zoom = $3, position_x = $4, position_y = $5, mirrored = $6, updated_at = clock_timestamp()
            WHERE storyboard_version_id = $1 AND panel_id = $2
          `, [next.version.id, target.panel.id, resolved.zoom, resolved.positionX, resolved.positionY, resolved.mirrored]);
        },
      });
      await client.query("COMMIT");
      return { ok: true, changed: true, placement: resolved };
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
      const leaving = await client.query(
        `SELECT instruction, operation_context FROM storyboard_version WHERE id = $1`,
        [current.version.id],
      );
      await client.query(
        `UPDATE storyboard_head SET active_storyboard_version_id = $2 WHERE storyboard_result_id = $1`,
        [current.result.id, parent],
      );
      const context = leaving.rows[0]?.operation_context ?? null;
      return {
        ok: true,
        changed: true,
        storyboardVersionId: parent,
        undoneLabel: undoLabelFor(leaving.rows[0]?.instruction),
        undoneTarget: context && typeof context === "object" ? context : null,
      };
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

export async function listReusableAssetRows(client, storyboardResultId, projectId, assetId = null) {
  return client.query(`
    SELECT DISTINCT a.id, a.kind, a.mime, a.width, a.height, a.provenance, a.created_at
    FROM visual_asset a
    WHERE a.project_id = $2
      AND a.kind IN ('uploaded-image', 'panel-image')
      AND ($3::uuid IS NULL OR a.id = $3::uuid)
      AND (
        EXISTS (
          SELECT 1
          FROM panel_visual_state pvs
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $1 AND pvs.assigned_asset_id = a.id
        )
        OR EXISTS (
          SELECT 1
          FROM panel_visual_state pvs
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $1 AND pvs.current_asset_id = a.id
        )
        OR EXISTS (
          SELECT 1
          FROM panel_generation pg
          JOIN panel_visual_state pvs ON pvs.id = pg.panel_visual_state_id
          JOIN storyboard_version sv ON sv.id = pvs.storyboard_version_id
          WHERE sv.storyboard_result_id = $1
            AND pg.status = 'ready'
            AND pg.output_asset_id = a.id
            AND NOT EXISTS (
              SELECT 1 FROM panel_revision_candidate candidate
              WHERE candidate.panel_generation_id = pg.id
            )
        )
        OR EXISTS (
          SELECT 1
          FROM storyboard_reusable_asset membership
          WHERE membership.storyboard_result_id = $1
            AND membership.asset_id = a.id
        )
      )
    ORDER BY a.id
  `, [storyboardResultId, projectId, assetId]);
}

async function assetIsReusable(client, storyboardResultId, assetId) {
  if (typeof assetId !== "string" || !assetId) return false;
  const result = await listReusableAssetRows(client, storyboardResultId, requireProjectId(), assetId);
  return result.rowCount > 0;
}

async function prepareAssignment(client, current, operation) {
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
      WHERE project_id = $1 AND sha256 = $2 AND kind IN ('uploaded-image', 'panel-image')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `, [requireProjectId(), image.sha256]);
    if (existing.rowCount === 1) {
      assetId = existing.rows[0].id;
      origin = "reuse";
    } else {
      const inserted = await insertAsset(client, "uploaded-image", image, { origin: "upload" });
      await attachPanelForeground(client, {
        sourceAsset: inserted,
        bytes: imageBytes(image),
        contractVersion: null,
        insertAsset,
      });
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
  const stored = await client.query(
    `SELECT provenance FROM visual_asset WHERE id = $1 AND project_id = $2`,
    [assetId, requireProjectId()],
  );
  return {
    ok: true,
    patch: {
      panelIds: [...new Set(panelIds)],
      assetId,
      origin,
      provenance: sanitizeProvenance(stored.rows[0]?.provenance),
      carryMetadata: operation.carryMetadata === true,
    },
  };
}

function eachStoredPanel(frames, visit) {
  for (const frame of frames || []) {
    if (frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0) {
      for (const segment of frame.segments) {
        for (const panel of segment.panels || []) visit(frame, segment, panel);
      }
      continue;
    }
    for (const panel of frame.panels || []) visit(frame, frame, panel);
  }
}

function applyMetadataCarry(frames, patches, castNames) {
  for (const patch of patches) {
    for (const panelId of patch.panelIds) {
      eachStoredPanel(frames, (frame, node, panel) => {
        if (panel.id !== panelId) return;
        const decision = metadataCarryDecision({
          frame: { origin: frame.origin, frameKind: node.frameKind ?? frame.frameKind },
          panel,
          provenance: patch.provenance,
          castNames,
          carryMetadata: patch.carryMetadata,
        });
        if (decision.mode !== "carry") return;
        if (decision.subject) panel.manualSubject = decision.subject;
        if (decision.description) panel.description = decision.description;
      });
    }
  }
}

function panelVisualSignature(rows) {
  return JSON.stringify(rows.map((row) => ({
    panelId: row.panel_id ?? null,
    subject: row.subject ?? null,
    currentAssetId: row.current_asset_id ?? null,
    currentAssetOrigin: row.current_asset_origin ?? null,
    zoom: Number(row.zoom),
    positionX: Number(row.position_x),
    positionY: Number(row.position_y),
    mirrored: row.mirrored === true,
    performanceAssetId: row.performance_asset_id ?? null,
  })).sort((left, right) => String(left.panelId).localeCompare(String(right.panelId))));
}

function proposedPanelRows(currentRows, frames, patches, cast) {
  const byId = new Map(currentRows.map((row) => [row.panel_id, { ...row }]));
  const next = [];
  for (const frame of expandStoryboardFrames(frames)) {
    for (const panel of frame.panels || []) {
      const existing = byId.get(panel.id) || {
        panel_id: panel.id,
        subject: null,
        current_asset_id: null,
        current_asset_origin: null,
        zoom: 1,
        position_x: 50,
        position_y: 30,
        mirrored: false,
        performance_asset_id: null,
      };
      const manual = typeof panel.manualSubject === "string" ? panel.manualSubject.trim() : "";
      const derived = resolvePanelSubject(panel.description, cast.characters, cast.aliases);
      existing.subject = manual || derived || null;
      next.push(existing);
    }
  }
  for (const patch of patches) {
    for (const panelId of patch.panelIds) {
      const row = next.find((entry) => entry.panel_id === panelId);
      if (!row) continue;
      row.current_asset_id = patch.assetId;
      row.current_asset_origin = patch.origin;
    }
  }
  return next;
}

function publicDuplicateResult(duplicate) {
  if (!duplicate?.created?.structureFrameId) return null;
  return {
    op: "duplicateFrame",
    source: {
      structureFrameId: duplicate.source?.structureFrameId ?? null,
      structureSegmentIndex: Number.isInteger(duplicate.source?.structureSegmentIndex)
        ? duplicate.source.structureSegmentIndex
        : null,
    },
    created: {
      structureFrameId: duplicate.created.structureFrameId,
      structureSegmentIndex: Number.isInteger(duplicate.created.structureSegmentIndex)
        ? duplicate.created.structureSegmentIndex
        : null,
    },
  };
}

function operationContextFor(operations, duplicate = null) {
  const operation = operations.length === 1 ? operations[0] : { op: "batch" };
  const panelId = typeof operation.panelId === "string"
    ? operation.panelId
    : (typeof operation.speakerPanelId === "string"
      ? operation.speakerPanelId
      : (operation.targets?.[0]?.panelId ?? null));
  const context = {
    op: operation.op,
    structureFrameId: operation.structureFrameId ?? operation.afterStructureFrameId ?? null,
    structureSegmentIndex: Number.isInteger(operation.structureSegmentIndex) ? operation.structureSegmentIndex : null,
    panelId: typeof panelId === "string" ? panelId : null,
    panelIndex: Number.isInteger(operation.panelIndex) ? operation.panelIndex : null,
    displayFrameNumber: Number.isInteger(operation.displayFrameNumber) ? operation.displayFrameNumber : null,
  };
  if (operation.dialogueMode === "spoken" || operation.dialogueMode === "silent" || operation.dialogueMode === "hidden") {
    context.dialogueMode = operation.dialogueMode;
  }
  const result = publicDuplicateResult(duplicate);
  if (result) {
    context.op = "duplicateFrame";
    context.structureFrameId = result.source.structureFrameId;
    context.structureSegmentIndex = result.source.structureSegmentIndex;
    context.source = result.source;
    context.created = result.created;
  }
  return context;
}

export async function applyProductOperation(pool, input) {
  const operations = input?.op === "batch" ? input.operations : [input];
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 40) {
    return failed("invalid-operation");
  }
  if (operations.some((operation) => !operation || typeof operation.op !== "string" || operation.op === "batch")) {
    return failed("invalid-operation");
  }
  if (input?.op === "batch" && operations.some((operation) => operation.op === "duplicateFrame")) {
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
      let frames = current.version.frames;
      const patches = [];
      let duplicate = null;
      const panelCopies = [];
      for (const operation of operations) {
        if (operation.op === "setManualSubject") {
          const name = typeof operation.characterName === "string" ? operation.characterName.trim() : "";
          if (!cast.characters.some((entry) => entry.name === name)) {
            await client.query("ROLLBACK");
            return failed("unknown-subject");
          }
        }
        if (operation.op === "uploadAsset" || operation.op === "assignAsset") {
          const prepared = await prepareAssignment(client, current, operation);
          if (!prepared.ok) {
            await client.query("ROLLBACK");
            return prepared;
          }
          patches.push(prepared.patch);
          continue;
        }
        const applied = applyOperation(frames, operation);
        if (!applied.ok) {
          await client.query("ROLLBACK");
          return failed(applied.kind);
        }
        frames = applied.frames;
        if (applied.duplicate) {
          duplicate = applied.duplicate;
          panelCopies.push(...(applied.duplicate.panelCopies || []));
        }
      }
      applyMetadataCarry(frames, patches, cast.characters.map((entry) => entry.name));
      const beforeRows = await client.query(`
        SELECT panel_id, subject, current_asset_id, current_asset_origin,
               zoom, position_x, position_y, mirrored, performance_asset_id
        FROM panel_visual_state
        WHERE storyboard_version_id = $1
      `, [current.version.id]);
      const sameFrames = visibleFrameSignature(frames) === visibleFrameSignature(current.version.frames);
      const samePanels = panelVisualSignature(beforeRows.rows)
        === panelVisualSignature(proposedPanelRows(beforeRows.rows, frames, patches, cast));
      if (sameFrames && samePanels) {
        await client.query("COMMIT");
        return { ok: true, changed: false, invalidateRender: false, storyboardVersionId: current.version.id };
      }
      const invalidateRender = operations.some((operation) => (
        operation.op === "setFrameDialogue" || operation.op === "duplicateFrame"
      ));
      const instruction = operations.length === 1 ? operations[0].op : "batch";
      const parentVersionId = current.version.id;
      const next = await forkVisibleState(client, current, {
        instruction,
        frames,
        operationContext: operationContextFor(operations, duplicate),
        customize: async (forkClient, version) => {
          await copyDuplicatedPanelState(forkClient, parentVersionId, version.version.id, panelCopies);
          for (const patch of patches) {
            for (const panelId of patch.panelIds) {
              await forkClient.query(`
                UPDATE panel_visual_state
                SET assigned_asset_id = $3,
                    assignment_origin = $4,
                    current_asset_id = $3,
                    current_asset_origin = $4,
                    updated_at = clock_timestamp()
                WHERE storyboard_version_id = $1 AND panel_id = $2
              `, [version.version.id, panelId, patch.assetId, patch.origin]);
            }
          }
        },
      });
      await client.query("COMMIT");
      const operationResult = publicDuplicateResult(duplicate);
      return {
        ok: true,
        changed: true,
        invalidateRender,
        storyboardVersionId: next.version.id,
        ...(operationResult ? { operationResult } : {}),
      };
    });
  } catch (error) {
    if (error?.kind === "invalid-image") return failed("invalid-image");
    return failed("database", 503);
  }
}
const ANCHOR_PROVENANCE = new Set([
  "generated_from_source",
  "uploaded_as_ready_anchor",
  "refined_from_accepted_anchor",
]);

export async function acceptSessionAnchor(pool, {
  characterName,
  provenance,
  image,
  sourceImage = null,
  sourceAssetId = null,
  instruction = "",
}) {
  const reusedSourceId = typeof sourceAssetId === "string" && sourceAssetId.trim() ? sourceAssetId.trim() : null;
  const hasSourceImage = Boolean(imageBytes(sourceImage));
  if (!characterName || !ANCHOR_PROVENANCE.has(provenance) || !imageBytes(image)) return failed("invalid-request");
  if (String(instruction).length > 4000) return failed("invalid-request");
  if (provenance === "generated_from_source") {
    if (hasSourceImage === Boolean(reusedSourceId)) return failed("invalid-request");
  } else if (reusedSourceId) {
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
      const materialStateId = context.result.material_state_id;
      const cast = await castFor(client, materialStateId);
      if (!cast.characters.some((entry) => entry.name === characterName)) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      let identityAssetId = null;
      if (provenance === "generated_from_source") {
        if (reusedSourceId) {
          const current = await currentIdentity(client, materialStateId, characterName);
          if (!current || current.current_asset_id !== reusedSourceId) {
            await client.query("ROLLBACK");
            return failed("not-found", 404);
          }
          identityAssetId = current.current_asset_id;
        } else {
          identityAssetId = (await insertAsset(client, "identity-reference", sourceImage)).id;
          await client.query(`
            INSERT INTO character_identity (material_state_id, character_name, current_asset_id, comment)
            VALUES ($1, $2, $3, '')
            ON CONFLICT (material_state_id, character_name)
            DO UPDATE SET current_asset_id = EXCLUDED.current_asset_id, updated_at = clock_timestamp()
          `, [materialStateId, characterName, identityAssetId]);
        }
      } else if (provenance === "refined_from_accepted_anchor") {
        identityAssetId = (await currentIdentity(client, materialStateId, characterName))?.current_asset_id ?? null;
      }
      const output = await insertAsset(client, "base-anchor", image);
      const id = randomUUID();
      await client.query(`
        INSERT INTO character_anchor_version (
          id, material_state_id, character_name, identity_asset_id, output_asset_id,
          instruction, status, provenance, approved_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, clock_timestamp())
      `, [id, materialStateId, characterName, identityAssetId, output.id, String(instruction).trim(), provenance]);
      await setAnchorHead(client, materialStateId, characterName, id);
      await ensureStyleSeedFromApproval(client, materialStateId, id, output.id);
      await client.query("COMMIT");
      return { ok: true, anchorId: id, assetId: output.id };
    });
  } catch (error) {
    if (error?.kind === "invalid-image") return failed("invalid-image");
    return failed("database", 503);
  }
}

export async function retireCurrentAnchor(pool, { characterName }) {
  if (!characterName) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const context = await ensureVersion(client);
      if (!context) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const current = await approvedAnchor(client, context.result.material_state_id, characterName);
      if (!current) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      await client.query(
        `UPDATE character_anchor_version SET status = 'retired' WHERE id = $1 AND status = 'approved'`,
        [current.id],
      );
      await client.query(`
        UPDATE character_anchor_head
        SET anchor_version_id = NULL
        WHERE material_state_id = $1 AND character_name = $2
      `, [context.result.material_state_id, characterName]);
      await client.query("COMMIT");
      return { ok: true, anchorId: current.id };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function restoreRetiredAnchor(pool, { characterName, anchorId }) {
  if (!characterName || !anchorId) return failed("invalid-request");
  try {
    return await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const context = await ensureVersion(client);
      if (!context) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      const current = await approvedAnchor(client, context.result.material_state_id, characterName);
      if (current) {
        await client.query("ROLLBACK");
        return failed("conflict", 409);
      }
      const updated = await client.query(`
        UPDATE character_anchor_version
        SET status = 'approved', approved_at = clock_timestamp()
        WHERE id = $1
          AND material_state_id = $2
          AND character_name = $3
          AND status = 'retired'
          AND output_asset_id IS NOT NULL
        RETURNING id
      `, [anchorId, context.result.material_state_id, characterName]);
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return failed("not-found", 404);
      }
      await setAnchorHead(client, context.result.material_state_id, characterName, anchorId);
      await client.query("COMMIT");
      return { ok: true, anchorId };
    });
  } catch {
    return failed("database", 503);
  }
}

export async function carryCheckedStoryboard(client, {
  fromMaterialStateId,
  toMaterialStateId = null,
  transformFrames,
  copyApproval = true,
  preview = false,
}) {
  const result = await client.query(`
    SELECT storyboard_result.id, storyboard_result.stage_payload
    FROM storyboard_result
    WHERE storyboard_result.material_state_id = $1
      AND storyboard_result.status = 'checked'
    ORDER BY storyboard_result.created_at DESC, storyboard_result.id DESC
    LIMIT 1
  `, [fromMaterialStateId]);
  if (result.rowCount !== 1) return { ok: true, carried: false, invalidateRender: false, previewFrames: null };
  const head = await client.query(`
    SELECT storyboard_version.id, storyboard_version.frames
    FROM storyboard_head
    JOIN storyboard_version ON storyboard_version.id = storyboard_head.active_storyboard_version_id
    WHERE storyboard_head.storyboard_result_id = $1
  `, [result.rows[0].id]);
  const payload = result.rows[0].stage_payload && typeof result.rows[0].stage_payload === "object"
    ? result.rows[0].stage_payload
    : {};
  const currentFrames = head.rowCount === 1 && Array.isArray(head.rows[0].frames)
    ? head.rows[0].frames
    : (Array.isArray(payload.frames) ? payload.frames : []);
  const transformed = transformFrames(currentFrames);
  if (!transformed?.ok) return transformed || { ok: false, kind: "invalid-request" };
  const nextFrames = transformed.frames;
  if (preview || !toMaterialStateId) {
    return { ok: true, carried: false, previewFrames: nextFrames, invalidateRender: false };
  }
  const fromVersionId = head.rowCount === 1 ? head.rows[0].id : null;
  const changed = visibleFrameSignature(currentFrames) !== visibleFrameSignature(nextFrames);
  const resultId = randomUUID();
  const versionId = randomUUID();
  await client.query(
    `INSERT INTO storyboard_result (id, material_state_id, status, failures, stage_payload)
     VALUES ($1, $2, 'checked', NULL, $3::jsonb)`,
    [resultId, toMaterialStateId, JSON.stringify({ ...payload, frames: nextFrames })],
  );
  await client.query(
    `INSERT INTO storyboard_version (id, storyboard_result_id, frames)
     VALUES ($1, $2, $3::jsonb)`,
    [versionId, resultId, JSON.stringify(nextFrames)],
  );
  await client.query(
    `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id)
     VALUES ($1, $2)`,
    [resultId, versionId],
  );
  if (fromVersionId) await copyPanelState(client, fromVersionId, versionId, nextFrames);
  if (fromVersionId && copyApproval && !changed) {
    await client.query(`
      INSERT INTO visual_approval (id, storyboard_version_id, snapshot, approved_at)
      SELECT $1, $2, snapshot, approved_at
      FROM visual_approval
      WHERE storyboard_version_id = $3
      ORDER BY approved_at DESC, id DESC
      LIMIT 1
    `, [randomUUID(), versionId, fromVersionId]);
  }
  return { ok: true, carried: true, invalidateRender: changed, versionId, changed };
}

export async function carryCharacterAnchors(client, { fromMaterialStateId, toMaterialStateId, includedNames }) {
  const projectId = requireProjectId();
  await client.query(`
    INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
    SELECT $2, style_asset_id, source_anchor_version_id
    FROM project_style_seed
    WHERE material_state_id = $1
    ON CONFLICT (material_state_id) DO NOTHING
  `, [fromMaterialStateId, toMaterialStateId]);
  for (const name of includedNames || []) {
    const anchor = await client.query(`
      WITH RECURSIVE chain AS (
        SELECT id, parent_material_state_id, 0 AS depth
        FROM material_state
        WHERE id = $1
        UNION ALL
        SELECT material_state.id, material_state.parent_material_state_id, chain.depth + 1
        FROM material_state
        JOIN chain ON material_state.id = chain.parent_material_state_id
      )
      SELECT character_anchor_version.*
      FROM chain
      JOIN character_anchor_head
        ON character_anchor_head.material_state_id = chain.id
       AND character_anchor_head.character_name = $2
      JOIN character_anchor_version
        ON character_anchor_version.id = character_anchor_head.anchor_version_id
       AND character_anchor_version.status = 'approved'
      JOIN visual_asset
        ON visual_asset.id = character_anchor_version.output_asset_id
       AND visual_asset.project_id = $3
      ORDER BY chain.depth, character_anchor_version.id
      LIMIT 1
    `, [fromMaterialStateId, name, projectId]);
    if (anchor.rowCount === 1) {
      const row = anchor.rows[0];
      const anchorId = randomUUID();
      await client.query(`
        INSERT INTO character_anchor_version (
          id, material_state_id, character_name, parent_anchor_version_id,
          identity_asset_id, output_asset_id, instruction, status, error_kind,
          provider_metadata, created_at, approved_at, style_asset_id, provenance
        ) VALUES (
          $1, $2, $3, NULL, $4, $5, $6, 'approved', $7, $8::jsonb, $9, $10, $11, $12
        )
      `, [
        anchorId,
        toMaterialStateId,
        name,
        row.identity_asset_id,
        row.output_asset_id,
        row.instruction || "",
        row.error_kind,
        row.provider_metadata == null ? null : JSON.stringify(row.provider_metadata),
        row.created_at,
        row.approved_at,
        row.style_asset_id,
        row.provenance,
      ]);
      await setAnchorHead(client, toMaterialStateId, name, anchorId);
    }
    const identity = await client.query(`
      WITH RECURSIVE chain AS (
        SELECT id, parent_material_state_id, 0 AS depth
        FROM material_state
        WHERE id = $1
        UNION ALL
        SELECT material_state.id, material_state.parent_material_state_id, chain.depth + 1
        FROM material_state
        JOIN chain ON material_state.id = chain.parent_material_state_id
      )
      SELECT character_identity.current_asset_id, character_identity.comment
      FROM chain
      JOIN character_identity
        ON character_identity.material_state_id = chain.id
       AND character_identity.character_name = $2
      JOIN visual_asset
        ON visual_asset.id = character_identity.current_asset_id
       AND visual_asset.project_id = $3
      ORDER BY chain.depth
      LIMIT 1
    `, [fromMaterialStateId, name, projectId]);
    if (identity.rowCount === 1) {
      await client.query(`
        INSERT INTO character_identity (material_state_id, character_name, current_asset_id, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (material_state_id, character_name) DO NOTHING
      `, [toMaterialStateId, name, identity.rows[0].current_asset_id, identity.rows[0].comment]);
    }
  }
}

export async function carryLineageAnchors(client, { fromMaterialStateId, toMaterialStateId, links }) {
  const projectId = requireProjectId();
  await client.query(`
    INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
    SELECT $2, style_asset_id, source_anchor_version_id
    FROM project_style_seed
    WHERE material_state_id = $1
    ON CONFLICT (material_state_id) DO NOTHING
  `, [fromMaterialStateId, toMaterialStateId]);
  for (const link of links || []) {
    const extractedName = link?.extractedName;
    const nextName = link?.nextName;
    if (!extractedName || !nextName) continue;
    const anchor = await client.query(`
      WITH RECURSIVE chain AS (
        SELECT id, parent_material_state_id, 0 AS depth
        FROM material_state
        WHERE id = $1
        UNION ALL
        SELECT material_state.id, material_state.parent_material_state_id, chain.depth + 1
        FROM material_state
        JOIN chain ON material_state.id = chain.parent_material_state_id
      )
      SELECT character_anchor_version.*
      FROM chain
      JOIN canonical_character
        ON canonical_character.material_state_id = chain.id
       AND COALESCE(NULLIF(canonical_character.extracted_name, ''), canonical_character.name) = $2
      JOIN character_anchor_head
        ON character_anchor_head.material_state_id = chain.id
       AND character_anchor_head.character_name = canonical_character.name
      JOIN character_anchor_version
        ON character_anchor_version.id = character_anchor_head.anchor_version_id
       AND character_anchor_version.status = 'approved'
      JOIN visual_asset
        ON visual_asset.id = character_anchor_version.output_asset_id
       AND visual_asset.project_id = $3
      ORDER BY chain.depth, character_anchor_version.id
      LIMIT 1
    `, [fromMaterialStateId, extractedName, projectId]);
    if (anchor.rowCount === 1) {
      const row = anchor.rows[0];
      const anchorId = randomUUID();
      await client.query(`
        INSERT INTO character_anchor_version (
          id, material_state_id, character_name, parent_anchor_version_id,
          identity_asset_id, output_asset_id, instruction, status, error_kind,
          provider_metadata, created_at, approved_at, style_asset_id, provenance
        ) VALUES (
          $1, $2, $3, NULL, $4, $5, $6, 'approved', $7, $8::jsonb, $9, $10, $11, $12
        )
      `, [
        anchorId,
        toMaterialStateId,
        nextName,
        row.identity_asset_id,
        row.output_asset_id,
        row.instruction || "",
        row.error_kind,
        row.provider_metadata == null ? null : JSON.stringify(row.provider_metadata),
        row.created_at,
        row.approved_at,
        row.style_asset_id,
        row.provenance,
      ]);
      await setAnchorHead(client, toMaterialStateId, nextName, anchorId);
    }
    const identity = await client.query(`
      WITH RECURSIVE chain AS (
        SELECT id, parent_material_state_id, 0 AS depth
        FROM material_state
        WHERE id = $1
        UNION ALL
        SELECT material_state.id, material_state.parent_material_state_id, chain.depth + 1
        FROM material_state
        JOIN chain ON material_state.id = chain.parent_material_state_id
      )
      SELECT character_identity.current_asset_id, character_identity.comment
      FROM chain
      JOIN canonical_character
        ON canonical_character.material_state_id = chain.id
       AND COALESCE(NULLIF(canonical_character.extracted_name, ''), canonical_character.name) = $2
      JOIN character_identity
        ON character_identity.material_state_id = chain.id
       AND character_identity.character_name = canonical_character.name
      JOIN visual_asset
        ON visual_asset.id = character_identity.current_asset_id
       AND visual_asset.project_id = $3
      ORDER BY chain.depth
      LIMIT 1
    `, [fromMaterialStateId, extractedName, projectId]);
    if (identity.rowCount === 1) {
      await client.query(`
        INSERT INTO character_identity (material_state_id, character_name, current_asset_id, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (material_state_id, character_name) DO NOTHING
      `, [toMaterialStateId, nextName, identity.rows[0].current_asset_id, identity.rows[0].comment]);
    }
  }
}

export async function readActiveMaterialStateId(pool) {
  try {
    return await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT active_material_state_id FROM project WHERE id = $1`,
        [requireProjectId()],
      );
      return result.rows[0]?.active_material_state_id ?? null;
    });
  } catch {
    return null;
  }
}

export async function readAnchorStyle(pool) {
  try {
    return await withClient(pool, async (client) => {
      const context = await ensureVersion(client);
      if (!context) return null;
      return projectStyleAsset(client, context.result.material_state_id);
    });
  } catch {
    return null;
  }
}

function contentWrite(pool, fn) {
  return async (...args) => {
    const result = await fn(...args);
    if (result?.ok) await touchProjectContent(pool).catch(() => {});
    return result;
  };
}

export function createVisualStore(pool) {
  return {
    load: () => loadVisual(pool),
    saveIdentity: contentWrite(pool, (input) => saveIdentity(pool, input)),
    beginAnchor: contentWrite(pool, (input) => beginAnchor(pool, input)),
    finishAnchor: contentWrite(pool, (input) => finishAnchor(pool, input)),
    approveAnchor: contentWrite(pool, (input) => approveAnchor(pool, input)),
    acceptSessionAnchor: contentWrite(pool, (input) => acceptSessionAnchor(pool, input)),
    retireCurrentAnchor: contentWrite(pool, (input) => retireCurrentAnchor(pool, input)),
    restoreRetiredAnchor: contentWrite(pool, (input) => restoreRetiredAnchor(pool, input)),
    readAnchorStyle: () => readAnchorStyle(pool),
    readActiveMaterialStateId: () => readActiveMaterialStateId(pool),
    beginPanelGeneration: contentWrite(pool, (input) => beginPanelGeneration(pool, input)),
    finishPanelGeneration: contentWrite(pool, (input) => finishPanelGeneration(pool, input)),
    updatePlacement: contentWrite(pool, (input) => updatePlacement(pool, input)),
    saveStoryboardEdit: contentWrite(pool, (input) => saveStoryboardEdit(pool, input)),
    undoStoryboardEdit: contentWrite(pool, () => undoStoryboardEdit(pool)),
    previewPanelRevision: (input) => previewPanelRevision(pool, input),
    openPanelRevision: contentWrite(pool, (input) => openPanelRevision(pool, input)),
    navigatePanelRevision: contentWrite(pool, (input) => navigatePanelRevision(pool, input)),
    acceptPanelRevision: contentWrite(pool, (input) => acceptPanelRevision(pool, input)),
    cancelPanelRevision: contentWrite(pool, (input) => cancelPanelRevision(pool, input)),
    approveVisual: contentWrite(pool, () => approveVisual(pool)),
    applyOperation: contentWrite(pool, (input) => applyProductOperation(pool, input)),
    readAsset: (id) => readAsset(pool, id),
    loadStructure: () => loadStoryboardStructure(pool),
  };
}
