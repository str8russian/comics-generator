// Read-only snapshot exporter for the W1 workspace prototype.
//
// The production GET /api/visual handler is not side-effect free: its store
// path lazily forks a head version, persists dialogue modes and panel ids,
// backfills current assets and style seeds, and upserts panel rows. This
// exporter therefore reads PostgreSQL directly, inside one read-only
// transaction, and never talks to the production HTTP server.
//
// Usage:
//   node prototypes/w1-workspace/export-snapshot.mjs --list
//   node prototypes/w1-workspace/export-snapshot.mjs [--project <uuid>] [--out <dir>]
//
// Connection: W1_EXPORT_DATABASE_URL, else DATABASE_URL, else the
// docker-compose default published on 127.0.0.1:5432.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const COMPOSE_URL = "postgres://comics:comics@127.0.0.1:5432/comics";
const READ_ONLY_BEGIN = "BEGIN TRANSACTION READ ONLY";
const READ_ONLY_END = "ROLLBACK";
const SELECT_ONLY = /^\s*(SELECT|WITH)\b/i;
const MODES = new Set(["spoken", "silent", "hidden"]);
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export const SELECTION_RULE = "most recently updated project with at least one approved base anchor, at least one split frame, and at least one panel with an assigned image";

function parseArgs(argv) {
  const args = { list: false, project: null, out: join(here, "snapshot") };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--list") args.list = true;
    else if (flag === "--project") args.project = argv[++index] ?? null;
    else if (flag === "--out") args.out = resolve(argv[++index] ?? args.out);
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.username || "?"}@${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "unparseable";
  }
}

async function select(client, sql, params = []) {
  if (!SELECT_ONLY.test(sql)) throw new Error("the exporter only runs SELECT statements");
  const result = await client.query(sql, params);
  return result.rows;
}

// Ported from visual-model.mjs expandStoryboardFrames (display units only).
function expandFrames(frames) {
  const expanded = [];
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0) {
      frame.segments.forEach((segment, index) => {
        expanded.push({
          id: `${frame.id}#${index + 1}`,
          frame,
          node: segment,
          panels: Array.isArray(segment.panels) ? segment.panels : [],
          layout: segment.layout,
          dialogue: segment.quote,
          frameKind: segment.frameKind ?? frame.frameKind ?? null,
        });
      });
      continue;
    }
    expanded.push({
      id: frame?.id,
      frame,
      node: frame,
      panels: Array.isArray(frame?.panels) ? frame.panels : [],
      layout: frame?.layout,
      dialogue: frame?.dialogue,
      frameKind: frame?.frameKind ?? null,
    });
  }
  return expanded;
}

// Mirrors dialogue-mode.mjs readDialogueMode without writing anything back.
function modeOf(unit) {
  if (unit.frameKind === "text") return "text";
  if (MODES.has(unit.node?.dialogueMode)) return unit.node.dialogueMode;
  return String(unit.dialogue || "").trim() ? "spoken (inferred)" : "hidden (inferred)";
}

function placementPosition(row) {
  const x = Number(row?.position_x ?? 50);
  const y = Number(row?.position_y ?? 30);
  return `${x}% ${y}%`;
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

async function readProject(client, project) {
  const summary = {
    id: project.id,
    title: project.title,
    updatedAt: project.updated_at,
    frames: 0,
    splitFrames: 0,
    panels: 0,
    panelsWithImages: 0,
    castCount: 0,
    approvedAnchors: 0,
    dialogueModes: {},
    visualApproval: "none",
    headPresent: false,
  };
  if (!project.active_material_state_id) return { summary, detail: null };
  const [result] = await select(client, `
    SELECT id, material_state_id, stage_payload
    FROM storyboard_result
    WHERE material_state_id = $1 AND status = 'checked'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [project.active_material_state_id]);
  const cast = await select(client, `
    SELECT name FROM canonical_character
    WHERE material_state_id = $1 AND included = true
    ORDER BY ordinal, id
  `, [project.active_material_state_id]);
  const anchors = await select(client, `
    SELECT anchor_head.character_name, anchor.id, anchor.output_asset_id, anchor.provenance
    FROM character_anchor_head AS anchor_head
    JOIN character_anchor_version AS anchor ON anchor.id = anchor_head.anchor_version_id
    WHERE anchor_head.material_state_id = $1 AND anchor.status = 'approved'
  `, [project.active_material_state_id]);
  summary.castCount = cast.length;
  summary.approvedAnchors = anchors.filter((row) => cast.some((entry) => entry.name === row.character_name)).length;
  if (!result) return { summary, detail: { cast, anchors, result: null } };

  const [head] = await select(client, `
    SELECT version.id, version.parent_storyboard_version_id, version.instruction, version.frames
    FROM storyboard_head AS head
    JOIN storyboard_version AS version ON version.id = head.active_storyboard_version_id
    WHERE head.storyboard_result_id = $1
  `, [result.id]);
  summary.headPresent = Boolean(head);
  const frames = head ? head.frames : (result.stage_payload?.frames ?? []);
  const rows = head ? await select(client, `
    SELECT state.id,
           state.frame_id,
           state.panel_index,
           state.panel_id,
           state.subject,
           state.zoom,
           state.position_x,
           state.position_y,
           state.mirrored,
           state.performance_asset_id,
           COALESCE(
             state.current_asset_id,
             state.assigned_asset_id,
             CASE WHEN current_generation.status = 'ready' THEN current_generation.output_asset_id END
           ) AS effective_asset_id,
           CASE
             WHEN state.current_asset_id IS NOT NULL THEN state.current_asset_origin
             WHEN state.assigned_asset_id IS NOT NULL THEN state.assignment_origin
             WHEN current_generation.status = 'ready' AND current_generation.output_asset_id IS NOT NULL THEN 'generation'
           END AS effective_origin,
           latest.status AS latest_generation_status,
           latest.error_kind AS latest_generation_error
    FROM panel_visual_state AS state
    LEFT JOIN panel_generation AS current_generation ON current_generation.id = state.current_generation_id
    LEFT JOIN LATERAL (
      SELECT attempt.status, attempt.error_kind
      FROM panel_generation AS attempt
      WHERE attempt.panel_visual_state_id = state.id
      ORDER BY attempt.created_at DESC, attempt.id DESC
      LIMIT 1
    ) AS latest ON true
    WHERE state.storyboard_version_id = $1
  `, [head.id]) : [];
  const byAddress = new Map(rows.map((row) => [`${row.frame_id}:${row.panel_index}`, row]));
  const units = expandFrames(frames);
  const placementSnapshot = [];
  for (const unit of units) {
    summary.frames += 1;
    if (unit.panels.length > 1 || unit.layout === "split2") summary.splitFrames += 1;
    const mode = modeOf(unit);
    summary.dialogueModes[mode] = (summary.dialogueModes[mode] || 0) + 1;
    const snapshotPanels = [];
    unit.panels.forEach((panel, index) => {
      summary.panels += 1;
      const row = byAddress.get(`${unit.id}:${index}`);
      if (row?.effective_asset_id) summary.panelsWithImages += 1;
      snapshotPanels.push({
        assetId: row?.effective_asset_id ?? null,
        zoom: Number(row?.zoom ?? 1),
        position: placementPosition(row),
        mirrored: row?.mirrored === true,
      });
    });
    placementSnapshot.push({ id: unit.id, panels: snapshotPanels });
  }
  let approval = null;
  if (head) {
    [approval] = await select(client, `
      SELECT id, snapshot, approved_at
      FROM visual_approval
      WHERE storyboard_version_id = $1
      ORDER BY approved_at DESC, id DESC
      LIMIT 1
    `, [head.id]);
  }
  const matches = Boolean(approval) && JSON.stringify(normalizeApprovalSnapshot(approval.snapshot))
    === JSON.stringify(normalizeApprovalSnapshot(placementSnapshot));
  summary.visualApproval = approval ? (matches ? "approved" : "approval-stale") : "none";
  return {
    summary,
    detail: { cast, anchors, result, head, frames, rows, byAddress, units, approval, approvalMatches: matches },
  };
}

function eligible(summary) {
  return summary.approvedAnchors > 0 && summary.splitFrames > 0 && summary.panelsWithImages > 0;
}

async function exportProject(client, project, detail, outDir, reason) {
  const warnings = [];
  const [source] = project.active_source_revision_id ? await select(client, `
    SELECT id, text, created_at FROM source_revision WHERE id = $1 AND project_id = $2
  `, [project.active_source_revision_id, project.id]) : [];
  const aliases = project.active_material_state_id ? await select(client, `
    SELECT alias.surface_text, canonical_character.name
    FROM alias
    JOIN canonical_character ON canonical_character.id = alias.character_id
    WHERE alias.material_state_id = $1
    ORDER BY alias.surface_text, canonical_character.name
  `, [project.active_material_state_id]) : [];
  if (!detail.head) warnings.push("No storyboard_version head exists yet; frames come from the staged result and carry no visual state.");

  const frames = structuredClone(detail.frames || []);
  const panelStates = {};
  const wanted = new Set();
  let synthetic = 0;
  for (const unit of expandFrames(frames)) {
    unit.panels.forEach((panel, index) => {
      const row = detail.byAddress?.get(`${unit.id}:${index}`) ?? null;
      if (typeof panel.id !== "string" || !panel.id) {
        synthetic += 1;
        panel.id = `snapshot-panel-${synthetic}`;
      }
      if (!row) return;
      if (row.effective_asset_id) wanted.add(row.effective_asset_id);
      if (row.performance_asset_id) wanted.add(row.performance_asset_id);
      panelStates[panel.id] = {
        subject: row.subject ?? null,
        assetId: row.effective_asset_id ?? null,
        assetOrigin: row.effective_asset_id ? (row.effective_origin ?? null) : null,
        zoom: Number(row.zoom),
        positionX: Number(row.position_x),
        positionY: Number(row.position_y),
        mirrored: row.mirrored === true,
        performanceAssetId: row.performance_asset_id ?? null,
        generationStatus: row.latest_generation_status ?? null,
        generationError: row.latest_generation_error ?? null,
      };
    });
  }
  if (synthetic) warnings.push(`${synthetic} panel(s) had no stored id; the snapshot assigned local ids only.`);

  const characters = detail.cast.map((entry) => {
    const anchor = detail.anchors.find((row) => row.character_name === entry.name) ?? null;
    if (anchor?.output_asset_id) wanted.add(anchor.output_asset_id);
    return {
      name: entry.name,
      anchor: anchor ? {
        status: "approved",
        assetId: anchor.output_asset_id ?? null,
        provenance: anchor.provenance ?? null,
      } : { status: "none", assetId: null, provenance: null },
    };
  });

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "assets"), { recursive: true });
  const assets = {};
  const ids = [...wanted];
  const assetRows = ids.length ? await select(client, `
    SELECT id, kind, mime, width, height, bytes, provenance
    FROM visual_asset
    WHERE id = ANY($1::uuid[]) AND project_id = $2
  `, [ids, project.id]) : [];
  for (const row of assetRows) {
    const file = `assets/${row.id}.${EXTENSIONS[row.mime] || "bin"}`;
    writeFileSync(join(outDir, file), row.bytes);
    const provenance = row.provenance && typeof row.provenance === "object" ? row.provenance : null;
    assets[row.id] = {
      file,
      kind: row.kind,
      mime: row.mime,
      width: row.width,
      height: row.height,
      origin: provenance?.origin ?? null,
      submittedText: typeof provenance?.submittedText === "string" ? provenance.submittedText : null,
    };
  }
  const missing = ids.filter((id) => !assets[id]);
  if (missing.length) warnings.push(`${missing.length} referenced image(s) were not found for this project.`);

  const snapshot = {
    format: "w1-workspace-snapshot/v1",
    source: {
      method: "read-only-sql",
      exportedAt: new Date().toISOString(),
      selection: reason,
    },
    project: {
      id: project.id,
      title: project.title,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    },
    story: {
      sourceRevisionId: source?.id ?? null,
      sourceText: source?.text ?? null,
      sourceCreatedAt: source?.created_at ?? null,
      materialStateId: project.active_material_state_id ?? null,
      cast: detail.cast.map((entry) => entry.name),
      aliases: aliases.map((row) => ({ surface: row.surface_text, characterName: row.name })),
    },
    characters,
    storyboard: {
      resultId: detail.result?.id ?? null,
      versionId: detail.head?.id ?? null,
      parentVersionId: detail.head?.parent_storyboard_version_id ?? null,
      instruction: detail.head?.instruction ?? null,
      frames,
    },
    panelStates,
    approval: {
      recordedAt: detail.approval?.approved_at ?? null,
      matchesCurrent: detail.approvalMatches === true,
    },
    render: { status: "not-captured" },
    assets,
    warnings,
  };
  writeFileSync(join(outDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  return { snapshot, assetCount: assetRows.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.W1_EXPORT_DATABASE_URL || process.env.DATABASE_URL || COMPOSE_URL;
  const client = new pg.Client({
    connectionString: url,
    options: "-c default_transaction_read_only=on -c statement_timeout=15000",
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  console.log(`Connected read-only to ${redactUrl(url)}`);
  try {
    await client.query(READ_ONLY_BEGIN);
    const [guard] = await select(client, "SELECT current_setting('transaction_read_only') AS read_only");
    if (guard?.read_only !== "on") throw new Error("transaction is not read-only; refusing to continue");
    const projects = await select(client, `
      SELECT id, title, created_at, updated_at, last_opened_at,
             active_source_revision_id, active_material_state_id
      FROM project
      ORDER BY updated_at DESC, id
    `);
    const read = [];
    for (const project of projects) read.push({ project, ...(await readProject(client, project)) });
    const table = read.map(({ summary }) => ({ ...summary, eligible: eligible(summary) }));
    console.log(JSON.stringify(table, null, 2));
    if (args.list) return;

    let chosen = null;
    let reason = null;
    if (args.project) {
      chosen = read.find((entry) => entry.project.id === args.project) ?? null;
      reason = { rule: "explicit --project", projectId: args.project };
    } else {
      chosen = read.find((entry) => eligible(entry.summary)) ?? null;
      reason = { rule: SELECTION_RULE, projectId: chosen?.project.id ?? null };
    }
    if (!chosen?.detail) {
      console.log("No eligible project found. The prototype will open the synthetic fixture.");
      process.exitCode = 2;
      return;
    }
    reason.summary = table.find((row) => row.id === chosen.project.id);
    const { snapshot, assetCount } = await exportProject(client, chosen.project, chosen.detail, args.out, reason);
    writeFileSync(join(args.out, "candidates.json"), `${JSON.stringify(table, null, 2)}\n`);
    console.log(`Exported project ${snapshot.project.id} (${snapshot.project.title}) with ${assetCount} image(s) to ${args.out}`);
    if (snapshot.warnings.length) console.log(`Warnings: ${snapshot.warnings.join(" | ")}`);
  } finally {
    await client.query(READ_ONLY_END).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Export failed: ${error.message}`);
    process.exit(1);
  });
}
