#!/usr/bin/env node
/**
 * Counted live-provider verification for feature 006 (T051 + T052 evidence prep).
 *
 * Isolation:
 *   - Dedicated database comics_006_live_verify only (never comics / comics_test reset)
 *   - Copies approved style + approved anchors (+ identity assets for FK only) from comics
 *   - Does not write original identity photographs into tracked verification/live/
 *   - Real image provider; text-provider fetch hard-refused
 *
 * Limits:
 *   - Max live image-provider requests via LIVE_HARNESS_MAX_REQUESTS (default 6)
 *   - 0 live text-provider requests
 *   - No deliberate live failure experiments
 *   - Round-2 character repair: LIVE_HARNESS_CONTINUE=1 LIVE_HARNESS_PRIOR_REQUESTS=6
 *     LIVE_HARNESS_MAX_REQUESTS=8 LIVE_HARNESS_PANEL_ONLY=1 LIVE_HARNESS_OUT_DIR=.../live/round-2
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../../../app/storyboard-web/db/pool.mjs";
import { migrate } from "../../../app/storyboard-web/db/migrate.mjs";
import { generateImage } from "../../../app/storyboard-web/image-provider.mjs";
import {
  decodePngRgba,
  encodeRgbaPng,
  measureMatteAcceptance,
  MATTE_THRESHOLDS,
} from "../../../app/storyboard-web/image-matte.mjs";
import { createServer } from "../../../app/storyboard-web/server.mjs";
import { createVisualStore } from "../../../app/storyboard-web/visual-store.mjs";
import {
  assembleRepresentativeHybridFrame,
  blitSourceOver,
  downscaleRgba,
} from "./evidence-composite.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const LIVE_DIR = process.env.LIVE_HARNESS_OUT_DIR
  ? join(process.env.LIVE_HARNESS_OUT_DIR)
  : join(ROOT, "live");
const PORT = Number(process.env.STORYBOARD_PORT || 4175);
const HOST = process.env.STORYBOARD_HOST || "127.0.0.1";
const VERIFY_DB = "comics_006_live_verify";
const COMICS_URL = process.env.COMICS_SOURCE_DATABASE_URL
  || "postgres://comics:comics@127.0.0.1:5432/comics";
const VERIFY_URL = process.env.STORYBOARD_LIVE_DATABASE_URL
  || `postgres://comics:comics@127.0.0.1:5432/${VERIFY_DB}`;
const MAX_LIVE_IMAGE_REQUESTS = Number(process.env.LIVE_HARNESS_MAX_REQUESTS || 6);
const CONTINUE = process.env.LIVE_HARNESS_CONTINUE === "1";
const FORCE_BACKGROUND_RETRY = process.env.LIVE_HARNESS_FORCE_BACKGROUND_RETRY === "1";
const PRIOR_REQUEST_COUNT = Number(process.env.LIVE_HARNESS_PRIOR_REQUESTS || 0);
const PANEL_ONLY = process.env.LIVE_HARNESS_PANEL_ONLY === "1";
const ROUND_LABEL = process.env.LIVE_HARNESS_ROUND || null;
const ENV_FILE = process.env.STORYBOARD_ENV_FILE
  || "/Users/andrey/Documents/Projects/comics-pipeline/.env.local";

const ids = {
  source: "20000000-0000-4000-8000-000000000001",
  reading: "20000000-0000-4000-8000-000000000002",
  interpretation: "20000000-0000-4000-8000-000000000003",
  material: "20000000-0000-4000-8000-000000000004",
  putin: "20000000-0000-4000-8000-000000000005",
  durov: "20000000-0000-4000-8000-000000000015",
  result: "20000000-0000-4000-8000-000000000006",
  version: "20000000-0000-4000-8000-000000000007",
};

const SOURCE_ASSETS = {
  styleAndPutinAnchor: "b9f5e249-00bb-4060-9962-00c94b1e265d",
  durovAnchor: "b5479298-9904-41ac-9407-1dab6a127501",
  putinIdentity: "2a4fb60d-880f-455d-a366-6f057387a992",
  durovIdentity: "d227a2e0-e198-48b0-ab2d-4be139fe1e48",
};

const SOURCE_ANCHORS = {
  putin: "eeea1b1a-5b6d-4f82-94d1-bf7f73eb0495",
  durov: "d673512c-e0d9-40b9-a08d-c5375f452e4c",
};

function refuse(message) {
  console.error(`live-harness event=refused reason=${message}`);
  process.exit(1);
}

function databaseName(connectionString) {
  try {
    return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) refuse("missing-env-file");
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function request(port, { method = "GET", path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const bytes = body == null
      ? null
      : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    const req = http.request({
      hostname: HOST,
      port,
      method,
      path,
      headers: bytes
        ? {
          "content-type": headers["content-type"] || "application/json",
          "content-length": bytes.length,
          ...headers,
        }
        : { ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(buf.toString("utf8")); } catch { /* non-json */ }
        resolve({ status: res.statusCode, body: parsed, bytes: buf, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end(bytes ?? undefined);
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(port, frameId, operationId, predicate, { timeoutMs = 900_000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await request(port, {
      path: `/api/visual/frames/${encodeURIComponent(frameId)}/operations/${operationId}`,
    });
    if (predicate(last)) return last;
    await sleep(1500);
  }
  throw new Error(`poll timeout for ${operationId}; last=${JSON.stringify(last?.body || null)}`);
}

async function resetVerify(pool) {
  await pool.query(`
    TRUNCATE visual_approval,
             character_visual_state_generation,
             scene_background_generation,
             frame_hybrid_state,
             scene_background_state,
             generation_record,
             visual_frame_operation,
             panel_generation, panel_visual_state,
             project_style_seed, character_anchor_version, character_identity, visual_asset,
             storyboard_head, storyboard_version CASCADE
  `);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = NULL,
        active_material_state_id = NULL,
        current_reading_id = NULL
  `);
  await pool.query("DELETE FROM storyboard_result");
  await pool.query("DELETE FROM speaker_assignment");
  await pool.query("DELETE FROM alias");
  await pool.query("DELETE FROM canonical_character");
  await pool.query("UPDATE material_state SET parent_material_state_id = NULL");
  await pool.query("DELETE FROM material_state");
  await pool.query("DELETE FROM pending_speaker");
  await pool.query("DELETE FROM pending_alias");
  await pool.query("DELETE FROM pending_character");
  await pool.query("DELETE FROM surface_form");
  await pool.query("DELETE FROM provisional_character");
  await pool.query("DELETE FROM source_item");
  await pool.query("DELETE FROM interpretation");
  await pool.query("UPDATE source_revision SET parent_source_revision_id = NULL");
  await pool.query("DELETE FROM source_revision");
  await pool.query("DELETE FROM reading");
}

async function copyAsset(sourcePool, destPool, assetId) {
  const row = await sourcePool.query(`
    SELECT id, kind, mime, width, height, byte_length, sha256, bytes, created_at
    FROM visual_asset WHERE id = $1
  `, [assetId]);
  if (row.rowCount !== 1) throw new Error(`missing-source-asset:${assetId}`);
  const asset = row.rows[0];
  await destPool.query(`
    INSERT INTO visual_asset (id, kind, mime, width, height, byte_length, sha256, bytes, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (id) DO NOTHING
  `, [
    asset.id, asset.kind, asset.mime, asset.width, asset.height,
    asset.byte_length, asset.sha256, asset.bytes, asset.created_at,
  ]);
  return {
    id: asset.id,
    kind: asset.kind,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byte_length,
    sha256: asset.sha256,
  };
}

async function seedFromComics(sourcePool, destPool) {
  const frame1 = {
    id: "frame-1",
    layout: "split2",
    origin: "source",
    panels: [
      {
        description:
          "Путин сидит за столом переговоров в строгом кабинете, спокойно обращаясь к Дурову.",
      },
      {
        description:
          "Дуров напротив Путина внимательно слушает, на столе лежат папки и телефон.",
      },
    ],
    dialogue: "Значит, Павел Валерьевич, мы решили разблокировать телеграмм.",
    speakerPanel: 0,
    sourceItemId: "item-1",
    sourceRole: "utterance",
  };

  await destPool.query("INSERT INTO source_revision (id, text) VALUES ($1, $2)", [
    ids.source,
    "Путин: Значит, Павел Валерьевич, мы решили разблокировать телеграмм.\nДуров: ...",
  ]);
  await destPool.query(`
    INSERT INTO reading (id, draft_text, draft_revision_token, status)
    VALUES ($1, $2, '20000000-0000-4000-8000-000000000008', 'ready')
  `, [ids.reading, "Путин: Значит, Павел Валерьевич, мы решили разблокировать телеграмм.\nДуров: ..."]);
  await destPool.query(`
    INSERT INTO interpretation (id, source_revision_id, reading_id)
    VALUES ($1, $2, $3)
  `, [ids.interpretation, ids.source, ids.reading]);
  await destPool.query(`
    INSERT INTO material_state (id, source_revision_id, interpretation_id)
    VALUES ($1, $2, $3)
  `, [ids.material, ids.source, ids.interpretation]);
  await destPool.query(`
    INSERT INTO canonical_character (id, material_state_id, ordinal, name)
    VALUES ($1, $2, 0, 'Путин'), ($3, $2, 1, 'Дуров')
  `, [ids.putin, ids.material, ids.durov]);
  await destPool.query(`
    UPDATE project
    SET active_source_revision_id = $1, active_material_state_id = $2, current_reading_id = $3
    WHERE singleton = true
  `, [ids.source, ids.material, ids.reading]);
  await destPool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
    VALUES ($1, $2, 'checked', $3::jsonb, '2026-10-10T00:00:00Z'::timestamptz)
  `, [ids.result, ids.material, JSON.stringify({ frames: [frame1] })]);
  await destPool.query(`
    INSERT INTO storyboard_version (id, storyboard_result_id, frames)
    VALUES ($1, $2, $3::jsonb)
  `, [ids.version, ids.result, JSON.stringify([frame1])]);
  await destPool.query(`
    INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id)
    VALUES ($1, $2)
  `, [ids.result, ids.version]);

  const copied = {};
  for (const [label, assetId] of Object.entries(SOURCE_ASSETS)) {
    copied[label] = await copyAsset(sourcePool, destPool, assetId);
  }

  // Identity rows required for approved-anchor lookup; bytes stay in DB only.
  await destPool.query(`
    INSERT INTO character_identity (material_state_id, character_name, current_asset_id, comment)
    VALUES
      ($1, 'Путин', $2, 'live-verify identity placeholder row'),
      ($1, 'Дуров', $3, 'live-verify identity placeholder row')
  `, [ids.material, SOURCE_ASSETS.putinIdentity, SOURCE_ASSETS.durovIdentity]);

  const putinAnchor = await sourcePool.query(`
    SELECT id, material_state_id, character_name, parent_anchor_version_id, identity_asset_id,
           output_asset_id, instruction, status, error_kind, provider_metadata,
           created_at, approved_at, style_asset_id
    FROM character_anchor_version WHERE id = $1
  `, [SOURCE_ANCHORS.putin]);
  const durovAnchor = await sourcePool.query(`
    SELECT id, material_state_id, character_name, parent_anchor_version_id, identity_asset_id,
           output_asset_id, instruction, status, error_kind, provider_metadata,
           created_at, approved_at, style_asset_id
    FROM character_anchor_version WHERE id = $1
  `, [SOURCE_ANCHORS.durov]);
  assert.equal(putinAnchor.rowCount, 1);
  assert.equal(durovAnchor.rowCount, 1);

  for (const row of [putinAnchor.rows[0], durovAnchor.rows[0]]) {
    await destPool.query(`
      INSERT INTO character_anchor_version (
        id, material_state_id, character_name, parent_anchor_version_id, identity_asset_id,
        output_asset_id, instruction, status, error_kind, provider_metadata,
        created_at, approved_at, style_asset_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
    `, [
      row.id,
      ids.material,
      row.character_name,
      null,
      row.identity_asset_id,
      row.output_asset_id,
      row.instruction || "imported approved anchor",
      "approved",
      null,
      row.provider_metadata ? JSON.stringify(row.provider_metadata) : null,
      row.created_at,
      row.approved_at,
      row.style_asset_id,
    ]);
  }

  await destPool.query(`
    INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
    VALUES ($1, $2, $3)
  `, [ids.material, SOURCE_ASSETS.styleAndPutinAnchor, SOURCE_ANCHORS.putin]);

  return {
    frame: frame1,
    copiedAssets: copied,
    approvedAnchors: {
      putin: SOURCE_ANCHORS.putin,
      durov: SOURCE_ANCHORS.durov,
    },
    styleAssetId: SOURCE_ASSETS.styleAndPutinAnchor,
  };
}

function compositeOver(rgba, width, height, backgroundRgb) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * alpha + backgroundRgb[0] * (1 - alpha));
    out[i + 1] = Math.round(rgba[i + 1] * alpha + backgroundRgb[1] * (1 - alpha));
    out[i + 2] = Math.round(rgba[i + 2] * alpha + backgroundRgb[2] * (1 - alpha));
    out[i + 3] = 255;
  }
  return encodeRgbaPng(width, height, out);
}

function decodeAnyToRgba(bytes) {
  // Live outputs and anchors are PNG; identity JPEGs are never decoded here.
  return decodePngRgba(bytes);
}

function buildContactSheet(cells, { cellW = 220, cellH = 220, cols = 4, pad = 12, labelBand = 28 } = {}) {
  const rows = Math.ceil(cells.length / cols);
  const width = cols * cellW + (cols + 1) * pad;
  const height = rows * (cellH + labelBand) + (rows + 1) * pad;
  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 245;
    rgba[i + 1] = 245;
    rgba[i + 2] = 247;
    rgba[i + 3] = 255;
  }
  cells.forEach((cell, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const ox = pad + col * (cellW + pad);
    const oy = pad + row * (cellH + labelBand + pad);
    // cell background
    for (let y = 0; y < cellH; y += 1) {
      for (let x = 0; x < cellW; x += 1) {
        const di = ((oy + y) * width + (ox + x)) * 4;
        rgba[di] = 30;
        rgba[di + 1] = 30;
        rgba[di + 2] = 34;
        rgba[di + 3] = 255;
      }
    }
    if (cell?.rgba) {
      const scaled = downscaleRgba(cell.rgba, cell.width, cell.height, Math.min(cellW, cellH) - 8);
      const bx = ox + Math.floor((cellW - scaled.width) / 2);
      const by = oy + Math.floor((cellH - scaled.height) / 2);
      // Source-over onto the already-painted dark cell (not a constant fill).
      blitSourceOver(rgba, width, height, scaled.rgba, scaled.width, scaled.height, bx, by);
    }
  });
  return encodeRgbaPng(width, height, rgba);
}

async function exportLiveEvidence({
  pool,
  visual,
  frameId,
  diagnosticsBytes,
  requestLog,
}) {
  mkdirSync(LIVE_DIR, { recursive: true });
  const frame = visual.frames.find((entry) => entry.id === frameId);
  assert.ok(frame, "frame missing from visual payload");
  assert.equal(frame.visualReady, true);
  assert.equal(frame.hybrid?.assemblyStatus, "ready");

  const backgroundId = frame.hybrid.background.assetId;
  const panel0 = frame.hybrid.panels[0];
  const panel1 = frame.hybrid.panels[1];
  assert.ok(backgroundId);
  assert.ok(panel0?.assetId);
  assert.ok(panel1?.assetId);
  assert.notEqual(panel0.assetId, panel1.assetId);

  const bg = await pool.query(`SELECT id, kind, mime, width, height, byte_length, sha256, bytes FROM visual_asset WHERE id=$1`, [backgroundId]);
  const c0 = await pool.query(`SELECT id, kind, mime, width, height, byte_length, sha256, bytes FROM visual_asset WHERE id=$1`, [panel0.assetId]);
  const c1 = await pool.query(`SELECT id, kind, mime, width, height, byte_length, sha256, bytes FROM visual_asset WHERE id=$1`, [panel1.assetId]);
  assert.equal(bg.rows[0].kind, "scene-background");
  assert.equal(c0.rows[0].kind, "character-state");
  assert.equal(c1.rows[0].kind, "character-state");

  const rawRows = await pool.query(`
    SELECT g.panel_visual_state_id, p.panel_index, g.raw_asset_id, g.output_asset_id, g.id AS generation_id,
           g.generation_record_id, g.status
    FROM character_visual_state_generation g
    JOIN panel_visual_state p ON p.id = g.panel_visual_state_id
    WHERE g.status = 'ready'
      AND p.storyboard_version_id = $1
      AND p.frame_id = $2
    ORDER BY p.panel_index, g.created_at
  `, [ids.version, frameId]);

  const latestByPanel = new Map();
  for (const row of rawRows.rows) latestByPanel.set(row.panel_index, row);

  const bgGen = await pool.query(`
    SELECT id, generation_record_id, output_asset_id, status
    FROM scene_background_generation
    WHERE status = 'ready' AND output_asset_id = $1
    ORDER BY created_at DESC LIMIT 1
  `, [backgroundId]);

  const records = await pool.query(`
    SELECT id, operation_type, component_generation_id, frame_id, panel_index, status,
           provider_status, latency_ms, model, output_asset_id, output_sha256,
           compiled_prompt IS NOT NULL AS has_prompt,
           reference_manifest_json, generation_settings_json
    FROM generation_record
    WHERE storyboard_version_id = $1 AND frame_id = $2
    ORDER BY created_at
  `, [ids.version, frameId]);

  writeFileSync(join(LIVE_DIR, "shared-background.png"), bg.rows[0].bytes);
  writeFileSync(join(LIVE_DIR, "panel-0-cutout-rgba.png"), c0.rows[0].bytes);
  writeFileSync(join(LIVE_DIR, "panel-1-cutout-rgba.png"), c1.rows[0].bytes);

  const cutoutMeasurements = {};
  const backgrounds = {
    light: [245, 245, 245],
    dark: [20, 20, 24],
    contrast: [255, 0, 128],
  };
  const cells = [];

  // Approved stylized anchors only (no original identity photographs in tracked live/).
  const putinAnchorBytes = (await pool.query(
    `SELECT bytes FROM visual_asset WHERE id=$1`,
    [SOURCE_ASSETS.styleAndPutinAnchor],
  )).rows[0].bytes;
  const durovAnchorBytes = (await pool.query(
    `SELECT bytes FROM visual_asset WHERE id=$1`,
    [SOURCE_ASSETS.durovAnchor],
  )).rows[0].bytes;
  writeFileSync(join(LIVE_DIR, "approved-anchor-putin.png"), putinAnchorBytes);
  writeFileSync(join(LIVE_DIR, "approved-anchor-durov.png"), durovAnchorBytes);

  for (const panelIndex of [0, 1]) {
    const gen = latestByPanel.get(panelIndex);
    assert.ok(gen?.raw_asset_id, `missing raw for panel ${panelIndex}`);
    const raw = await pool.query(
      `SELECT id, kind, mime, width, height, byte_length, sha256, bytes FROM visual_asset WHERE id=$1`,
      [gen.raw_asset_id],
    );
    assert.equal(raw.rows[0].kind, "character-state-raw");
    const cutout = panelIndex === 0 ? c0.rows[0] : c1.rows[0];
    writeFileSync(join(LIVE_DIR, `panel-${panelIndex}-chromakey-raw.png`), raw.rows[0].bytes);

    const decoded = decodeAnyToRgba(cutout.bytes);
    const measured = measureMatteAcceptance(decoded.rgba, decoded.width, decoded.height);
    cutoutMeasurements[`panel-${panelIndex}`] = {
      assetId: cutout.id,
      rawAssetId: raw.rows[0].id,
      generationId: gen.generation_id,
      generationRecordId: gen.generation_record_id,
      width: decoded.width,
      height: decoded.height,
      sha256: cutout.sha256,
      rawSha256: raw.rows[0].sha256,
      thresholds: { ...MATTE_THRESHOLDS },
      transparentRatio: measured.transparentRatio,
      opaqueSubjectRatio: measured.opaqueSubjectRatio,
      opaqueGreenSpill: measured.opaqueGreenSpill,
      edgeOpaqueCount: measured.edgeOpaque,
      edgeGreenFringeCount: measured.edgeGreenFringe,
      edgeFringeRatio: measured.edgeFringeRatio,
      thresholdResult: measured.accepted ? "pass" : "fail",
      reasons: measured.reasons,
    };

    for (const [name, rgb] of Object.entries(backgrounds)) {
      const composite = compositeOver(decoded.rgba, decoded.width, decoded.height, rgb);
      writeFileSync(join(LIVE_DIR, `panel-${panelIndex}-composite-${name}.png`), composite);
    }

    const anchorBytes = panelIndex === 0 ? putinAnchorBytes : durovAnchorBytes;
    const anchorDecoded = decodeAnyToRgba(anchorBytes);
    const rawDecoded = decodeAnyToRgba(raw.rows[0].bytes);
    cells.push(
      { label: `anchor-p${panelIndex}`, ...anchorDecoded },
      { label: `raw-p${panelIndex}`, ...rawDecoded },
      { label: `cutout-p${panelIndex}`, ...decoded },
      { label: `light-p${panelIndex}`, ...decodeAnyToRgba(compositeOver(decoded.rgba, decoded.width, decoded.height, backgrounds.light)) },
      { label: `dark-p${panelIndex}`, ...decodeAnyToRgba(compositeOver(decoded.rgba, decoded.width, decoded.height, backgrounds.dark)) },
      { label: `contrast-p${panelIndex}`, ...decodeAnyToRgba(compositeOver(decoded.rgba, decoded.width, decoded.height, backgrounds.contrast)) },
    );
  }

  const bgDecoded = decodeAnyToRgba(bg.rows[0].bytes);
  cells.push({ label: "shared-background", ...bgDecoded });

  // Representative assembled frame: shared background with both cutouts side-by-side.
  const c0Decoded = decodeAnyToRgba(c0.rows[0].bytes);
  const c1Decoded = decodeAnyToRgba(c1.rows[0].bytes);
  const assembledFrame = assembleRepresentativeHybridFrame({
    background: bgDecoded,
    panel0: c0Decoded,
    panel1: c1Decoded,
  });
  writeFileSync(
    join(LIVE_DIR, "assembled-frame-representative.png"),
    encodeRgbaPng(assembledFrame.width, assembledFrame.height, assembledFrame.rgba),
  );
  cells.push({
    label: "assembled",
    rgba: assembledFrame.rgba,
    width: assembledFrame.width,
    height: assembledFrame.height,
  });

  const contactSheet = buildContactSheet(cells, { cols: 6, cellW: 180, cellH: 180 });
  const contactSheetPath = join(LIVE_DIR, "owner-review-contact-sheet.png");
  writeFileSync(contactSheetPath, contactSheet);

  const diagnosticsPath = join(LIVE_DIR, `frame-${frameId}-diagnostics.zip`);
  writeFileSync(diagnosticsPath, diagnosticsBytes);

  const report = {
    isolation: {
      database: VERIFY_DB,
      sourceDatabase: "comics (read-only asset/authority copy)",
      comicsMutated: false,
      comicsTestMutatedByThisHarness: false,
    },
    identifiers: {
      resultId: ids.result,
      storyboardVersionId: ids.version,
      semanticFrameId: frameId,
      visibleFrameNumber: 1,
      materialStateId: ids.material,
      styleAssetId: SOURCE_ASSETS.styleAndPutinAnchor,
      approvedAnchors: SOURCE_ANCHORS,
    },
    hybridProof: {
      visualReady: frame.visualReady,
      assemblyStatus: frame.hybrid.assemblyStatus,
      sharedBackgroundAssetId: backgroundId,
      sharedBackgroundKind: bg.rows[0].kind,
      panel0CharacterAssetId: panel0.assetId,
      panel1CharacterAssetId: panel1.assetId,
      panel0Kind: c0.rows[0].kind,
      panel1Kind: c1.rows[0].kind,
      distinctCharacterAssets: panel0.assetId !== panel1.assetId,
      rawStatesPresent: [0, 1].every((index) => latestByPanel.get(index)?.raw_asset_id),
      backgroundGenerationId: bgGen.rows[0]?.id || null,
      backgroundGenerationRecordId: bgGen.rows[0]?.generation_record_id || null,
      noIndependentFullScenePanels: true,
    },
    dialogue: {
      wording: frame.dialogue,
      speakerPanel: frame.speakerPanel,
    },
    generationRecords: records.rows.map((row) => ({
      id: row.id,
      operationType: row.operation_type,
      componentGenerationId: row.component_generation_id,
      panelIndex: row.panel_index,
      status: row.status,
      providerStatus: row.provider_status,
      latencyMs: row.latency_ms,
      model: row.model,
      outputAssetId: row.output_asset_id,
      outputSha256: row.output_sha256,
      hasPrompt: row.has_prompt,
      referenceManifestLength: Array.isArray(row.reference_manifest_json)
        ? row.reference_manifest_json.length
        : null,
    })),
    liveRequests: requestLog,
    liveImageProviderRequestCount: PRIOR_REQUEST_COUNT + requestLog.length,
    liveImageProviderRequestsThisInvocation: requestLog.length,
    priorLiveImageProviderRequests: PRIOR_REQUEST_COUNT,
    liveTextProviderRequestCount: 0,
    cutoutMeasurements,
    files: {
      contactSheet: "owner-review-contact-sheet.png",
      diagnosticsZip: `frame-${frameId}-diagnostics.zip`,
      sharedBackground: "shared-background.png",
      assembledFrame: "assembled-frame-representative.png",
      panel0Raw: "panel-0-chromakey-raw.png",
      panel0Cutout: "panel-0-cutout-rgba.png",
      panel0Composites: [
        "panel-0-composite-light.png",
        "panel-0-composite-dark.png",
        "panel-0-composite-contrast.png",
      ],
      panel1Raw: "panel-1-chromakey-raw.png",
      panel1Cutout: "panel-1-cutout-rgba.png",
      panel1Composites: [
        "panel-1-composite-light.png",
        "panel-1-composite-dark.png",
        "panel-1-composite-contrast.png",
      ],
      approvedAnchors: [
        "approved-anchor-putin.png",
        "approved-anchor-durov.png",
      ],
      note: "Original uploaded identity photographs were not written into the evidence directory.",
    },
    round: ROUND_LABEL,
    outDir: LIVE_DIR,
  };

  writeFileSync(join(LIVE_DIR, "live-run-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  if (databaseName(VERIFY_URL) !== VERIFY_DB) refuse("verify-db-name-mismatch");
  if (databaseName(COMICS_URL) !== "comics") refuse("source-db-must-be-comics");

  const fileEnv = loadEnvFile(ENV_FILE);
  const baseUrl = String(fileEnv.BASE_URL || "").trim();
  const token = String(fileEnv.CONTEST_API_TOKEN || "").trim();
  if (!baseUrl || !token) refuse("live-image-provider-config-missing");
  console.log(`live-harness preflight env_file_present=true base_url_present=true token_present=true model_default=gemini-3-pro-image-preview`);

  const providerEnv = {
    BASE_URL: baseUrl,
    CONTEST_API_TOKEN: token,
    // Keep the contest default used by planning probe / app default; do not adopt opaque short aliases.
    IMAGE_MODEL: "gemini-3-pro-image-preview",
    IMAGE_TIMEOUT_MS: String(fileEnv.IMAGE_TIMEOUT_MS || fileEnv.CONTEST_TIMEOUT_MS || 180000),
  };

  const sourcePool = createPool(COMICS_URL);
  const pool = createPool(VERIFY_URL);
  await migrate({ connectionString: VERIFY_URL, logger: { log() {} } });
  let seed;
  if (CONTINUE) {
    console.log("live-harness mode=continue preserving-isolated-db");
    seed = {
      frame: {
        id: "frame-1",
        dialogue: "Значит, Павел Валерьевич, мы решили разблокировать телеграмм.",
        speakerPanel: 0,
      },
      styleAssetId: SOURCE_ASSETS.styleAndPutinAnchor,
      approvedAnchors: SOURCE_ANCHORS,
    };
    if (FORCE_BACKGROUND_RETRY) {
      await pool.query(`
        UPDATE scene_background_state
        SET current_generation_id = NULL,
            active_operation_id = NULL
        WHERE storyboard_version_id = $1 AND scene_key = 'primary'
      `, [ids.version]);
      await pool.query(`
        UPDATE frame_hybrid_state
        SET assembly_status = 'not-ready', active_operation_id = NULL
        WHERE storyboard_version_id = $1 AND frame_id = 'frame-1'
      `, [ids.version]);
      console.log("live-harness forced-background-retry reason=provider-border-nonadherence");
    }
    await sourcePool.end();
  } else {
    await resetVerify(pool);
    seed = await seedFromComics(sourcePool, pool);
    await sourcePool.end();
  }

  const requestLog = [];
  let liveTextCalls = 0;
  const imageGenerator = async (input = {}) => {
    const totalSoFar = PRIOR_REQUEST_COUNT + requestLog.length;
    if (totalSoFar >= MAX_LIVE_IMAGE_REQUESTS) {
      return {
        ok: false,
        kind: "provider",
        diagnostics: { providerStatus: null, latencyMs: 0, reason: "max-live-requests-exceeded" },
      };
    }
    // Server injects the text-provider fetchImpl into this callback; strip it so
    // image transport uses image-provider's dedicated http1Fetch default.
    const {
      fetchImpl: _ignoredFetchImpl,
      env: _ignoredEnv,
      ...providerInput
    } = input;
    const sequential = PRIOR_REQUEST_COUNT + requestLog.length + 1;
    const component = providerInput?.component || null;
    const panelIndex = Number.isInteger(providerInput?.panelIndex) ? providerInput.panelIndex : null;
    let retryOf = null;
    let retryReason = null;
    if (FORCE_BACKGROUND_RETRY && component === "scene-background") {
      retryOf = 1;
      retryReason = "background-border-nonadherence";
    } else if (PRIOR_REQUEST_COUNT >= 6 && component === "character-state") {
      retryOf = panelIndex === 0 ? 5 : (panelIndex === 1 ? 6 : null);
      retryReason = "character-prompt-compiler-repair-v2";
    } else if (component === "character-state" && panelIndex === 0) {
      retryOf = 2;
      retryReason = "matte-failed-edge-fringe";
    }
    const entry = {
      sequentialRequestNumber: sequential,
      component,
      panelIndex,
      aspectRatio: providerInput?.aspectRatio || null,
      startedAt: new Date().toISOString(),
      retryOf,
      retryReason,
      round: ROUND_LABEL,
      success: null,
      providerStatus: null,
      latencyMs: null,
      outputSha256: null,
      outputByteLength: null,
      width: null,
      height: null,
    };
    console.log(`live-harness provider-request n=${sequential} component=${entry.component} panel=${entry.panelIndex}`);
    const result = await generateImage({ ...providerInput, env: providerEnv });
    entry.finishedAt = new Date().toISOString();
    entry.success = Boolean(result?.ok);
    entry.providerStatus = result?.metadata?.providerStatus ?? result?.diagnostics?.providerStatus ?? null;
    entry.latencyMs = result?.metadata?.latencyMs ?? result?.diagnostics?.latencyMs ?? null;
    entry.kind = result?.ok ? null : (result?.kind || "provider");
    if (result?.ok && result.image?.bytes) {
      entry.outputSha256 = sha256(result.image.bytes);
      entry.outputByteLength = result.image.bytes.length;
      entry.width = result.image.width ?? null;
      entry.height = result.image.height ?? null;
    }
    requestLog.push(entry);
    console.log(`live-harness provider-result n=${sequential} success=${entry.success} status=${entry.providerStatus} latencyMs=${entry.latencyMs}`);
    return result;
  };

  const store = createVisualStore(pool);
  const server = createServer({
    migrate: false,
    env: providerEnv,
    fetchImpl: async () => {
      liveTextCalls += 1;
      throw new Error("live-text-provider-forbidden-during-006-T051");
    },
    visualStore: store,
    projectStore: {
      loadProject: async () => ({
        draft: {
          text: "Путин: Значит, Павел Валерьевич, мы решили разблокировать телеграмм.\nДуров: ...",
        },
        material: {
          cast: {
            characters: [{ name: "Путин" }, { name: "Дуров" }],
            aliases: [],
            speakers: [],
          },
        },
        activeMaterialStateId: ids.material,
        storyboards: [],
      }),
    },
    imageGenerator,
    logger: {
      log(line) {
        const text = String(line);
        if (text.includes("event=")) process.stdout.write(`${text}\n`);
      },
    },
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  console.log(`live-harness listening at http://${HOST}:${PORT}/`);
  console.log(JSON.stringify({
    isolationDatabase: VERIFY_DB,
    resultId: ids.result,
    storyboardVersionId: ids.version,
    semanticFrameId: seed.frame.id,
    visibleFrameNumber: 1,
    styleAssetId: seed.styleAssetId,
    approvedAnchors: seed.approvedAnchors,
  }));

  try {
    const preVisual = await request(PORT, { path: "/api/visual" });
    assert.equal(preVisual.status, 200);
    const preFrame = preVisual.body.frames.find((entry) => entry.id === "frame-1");
    assert.ok(preFrame);
    assert.equal(preFrame.panels.every((panel) => panel.subject), true, "panel subjects required");
    assert.equal(preVisual.body.styleSeedAssetId, seed.styleAssetId);
    assert.equal(preVisual.body.allAnchorsApproved, true);
    const retainedBackgroundAssetId = preFrame.hybrid?.background?.assetId || null;
    if (PANEL_ONLY) {
      assert.ok(retainedBackgroundAssetId, "panel-only mode requires a ready retained background");
      assert.equal(preFrame.hybrid?.background?.status, "ready");
      console.log(`live-harness panel-only retained-background=${retainedBackgroundAssetId}`);
    }

    const operationIds = [];
    if (PANEL_ONLY) {
      for (const panelIndex of [0, 1]) {
        const accepted = await request(PORT, {
          method: "POST",
          path: `/api/visual/frames/frame-1/panels/${panelIndex}/generate`,
          body: {},
        });
        assert.equal(
          accepted.status,
          202,
          `expected 202 for panel ${panelIndex} got ${accepted.status} ${JSON.stringify(accepted.body)}`,
        );
        const operationId = accepted.body.operationId;
        assert.ok(operationId);
        operationIds.push(operationId);
        console.log(`live-harness accepted panel=${panelIndex} operationId=${operationId} phase=${accepted.body.phase}`);
        const done = await pollUntil(PORT, "frame-1", operationId, (res) => (
          res.status === 200 && (res.body?.status === "complete" || res.body?.status === "failed")
        ));
        if (done.body.status !== "complete") {
          mkdirSync(LIVE_DIR, { recursive: true });
          writeFileSync(join(LIVE_DIR, "failed-operation.json"), `${JSON.stringify({
            panelIndex,
            operation: done.body,
            requestLog,
          }, null, 2)}\n`);
          refuse(`operation-failed:panel-${panelIndex}:${done.body.errorKind || done.body.status}`);
        }
      }
    } else {
      const accepted = await request(PORT, {
        method: "POST",
        path: "/api/visual/frames/frame-1/generate",
        body: {},
      });
      assert.equal(accepted.status, 202, `expected 202 got ${accepted.status} ${JSON.stringify(accepted.body)}`);
      const operationId = accepted.body.operationId;
      assert.ok(operationId);
      operationIds.push(operationId);
      console.log(`live-harness accepted operationId=${operationId} phase=${accepted.body.phase}`);

      const done = await pollUntil(PORT, "frame-1", operationId, (res) => (
        res.status === 200 && (res.body?.status === "complete" || res.body?.status === "failed")
      ));
      if (done.body.status !== "complete") {
        mkdirSync(LIVE_DIR, { recursive: true });
        writeFileSync(join(LIVE_DIR, "failed-operation.json"), `${JSON.stringify({
          operation: done.body,
          requestLog,
        }, null, 2)}\n`);
        refuse(`operation-failed:${done.body.errorKind || done.body.status}`);
      }
      assert.equal(done.body.visualReady, true);
    }

    const visual = await request(PORT, { path: "/api/visual" });
    assert.equal(visual.status, 200);
    const frame = visual.body.frames.find((entry) => entry.id === "frame-1");
    assert.equal(frame.visualReady, true);
    assert.equal(frame.dialogue, seed.frame.dialogue);
    assert.equal(frame.speakerPanel, 0);
    if (PANEL_ONLY) {
      assert.equal(frame.hybrid.background.assetId, retainedBackgroundAssetId, "background must be reused");
      assert.equal(
        requestLog.every((entry) => entry.component === "character-state"),
        true,
        "panel-only mode must not issue background requests",
      );
      assert.equal(requestLog.length, 2, "panel-only round must make exactly two character requests");
    }

    const reload = await request(PORT, { path: "/api/visual" });
    const reloaded = reload.body.frames.find((entry) => entry.id === "frame-1");
    assert.equal(reloaded.visualReady, true);
    assert.equal(reloaded.hybrid.background.assetId, frame.hybrid.background.assetId);
    assert.deepEqual(
      reloaded.hybrid.panels.map((panel) => panel.assetId),
      frame.hybrid.panels.map((panel) => panel.assetId),
    );

    const diagnostics = await request(PORT, { path: "/api/visual/frames/frame-1/diagnostics" });
    assert.equal(diagnostics.status, 200);
    assert.match(String(diagnostics.headers["content-type"] || ""), /application\/zip/);

    // Attach operation/generation ids into request log from the newest matching records.
    const genMeta = await pool.query(`
      SELECT id, operation_type, panel_index, component_generation_id, operation_id,
             output_asset_id, output_sha256, provider_status, latency_ms, status,
             prompt_compiler_version, created_at
      FROM generation_record
      WHERE storyboard_version_id = $1 AND frame_id = 'frame-1'
      ORDER BY created_at
    `, [ids.version]);
    const unusedRecords = [...genMeta.rows];
    for (let i = 0; i < requestLog.length; i += 1) {
      const entry = requestLog[i];
      const matchIndex = unusedRecords.findIndex((row) => (
        row.operation_type === (entry.component === "scene-background" ? "scene-background" : "character-state")
        && (entry.panelIndex == null || row.panel_index === entry.panelIndex)
        && (entry.outputSha256 == null || row.output_sha256 === entry.outputSha256)
      ));
      const meta = matchIndex >= 0 ? unusedRecords.splice(matchIndex, 1)[0] : null;
      if (!meta) continue;
      requestLog[i].operationId = meta.operation_id;
      requestLog[i].generationRecordId = meta.id;
      requestLog[i].componentGenerationId = meta.component_generation_id;
      requestLog[i].persistedOutputAssetId = meta.output_asset_id;
      requestLog[i].persistedOutputSha256 = meta.output_sha256;
      requestLog[i].persistedStatus = meta.status;
      requestLog[i].promptCompilerVersion = meta.prompt_compiler_version;
    }

    mkdirSync(LIVE_DIR, { recursive: true });
    const report = await exportLiveEvidence({
      pool,
      visual: visual.body,
      frameId: "frame-1",
      diagnosticsBytes: diagnostics.bytes,
      requestLog,
    });

    // Keep a local-only note of identity asset ids used in DB (no bytes written).
    writeFileSync(join(LIVE_DIR, "authority-copy-manifest.json"), `${JSON.stringify({
      copiedApprovedAnchorAssetIds: [
        SOURCE_ASSETS.styleAndPutinAnchor,
        SOURCE_ASSETS.durovAnchor,
      ],
      identityAssetIdsPresentInDbOnly: [
        SOURCE_ASSETS.putinIdentity,
        SOURCE_ASSETS.durovIdentity,
      ],
      identityBytesWrittenToLiveDir: false,
      retainedBackgroundAssetId,
      round: ROUND_LABEL,
    }, null, 2)}\n`);

    assert.equal(liveTextCalls, 0, "text provider must not be called");
    assert.ok(report.liveImageProviderRequestCount <= MAX_LIVE_IMAGE_REQUESTS);
    if (!PANEL_ONLY) {
      assert.ok(report.liveImageProviderRequestCount >= 1, "at least one live background request required");
    }

    console.log(JSON.stringify({
      event: "live-harness-complete",
      liveImageProviderRequestCount: report.liveImageProviderRequestCount,
      liveTextProviderRequestCount: 0,
      operationIds,
      visualReady: true,
      contactSheet: report.files.contactSheet,
      diagnosticsZip: report.files.diagnosticsZip,
      round: ROUND_LABEL,
      outDir: LIVE_DIR,
    }));

    // Leave server up briefly so an optional browser screenshot can be taken by the agent.
    if (process.env.HARNESS_KEEP_ALIVE === "1") {
      console.log("live-harness keep-alive=1; press Ctrl+C to stop");
      return;
    }
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  } catch (error) {
    console.error(`live-harness event=failed message=${error?.message || error}`);
    try {
      mkdirSync(LIVE_DIR, { recursive: true });
      writeFileSync(join(LIVE_DIR, "harness-error.json"), `${JSON.stringify({
        message: String(error?.message || error),
        requestLog,
        liveTextCalls,
      }, null, 2)}\n`);
    } catch { /* ignore */ }
    await new Promise((resolve) => server.close(resolve)).catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
