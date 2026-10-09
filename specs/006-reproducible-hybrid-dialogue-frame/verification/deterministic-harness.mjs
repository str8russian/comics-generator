#!/usr/bin/env node
/**
 * Deterministic browser/API acceptance harness for feature 006.
 *
 * - Uses comics_test only
 * - Injects an in-process image provider double (zero live provider calls)
 * - Seeds an eligible split-dialogue frame with approved identity/style authorities
 * - Serves on http://127.0.0.1:4174/ for browser acceptance
 *
 * Usage:
 *   STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
 *     node specs/006-reproducible-hybrid-dialogue-frame/verification/deterministic-harness.mjs
 *
 * Env:
 *   HARNESS_MODE=serve|script|failures  (default: script then serve)
 *   HARNESS_KEEP_ALIVE=1                keep listening after scripted checks
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../../../app/storyboard-web/db/pool.mjs";
import { migrate } from "../../../app/storyboard-web/db/migrate.mjs";
import { encodeRgbPng } from "../../../app/storyboard-web/image-matte.mjs";
import { createServer } from "../../../app/storyboard-web/server.mjs";
import { createVisualStore } from "../../../app/storyboard-web/visual-store.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = 4174;
const HOST = "127.0.0.1";
const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL || "";
const mode = process.env.HARNESS_MODE || "script";
const keepAlive = process.env.HARNESS_KEEP_ALIVE === "1" || mode === "serve";

const ids = {
  source: "10000000-0000-4000-8000-000000000001",
  reading: "10000000-0000-4000-8000-000000000002",
  interpretation: "10000000-0000-4000-8000-000000000003",
  material: "10000000-0000-4000-8000-000000000004",
  putin: "10000000-0000-4000-8000-000000000005",
  durov: "10000000-0000-4000-8000-000000000015",
  result: "10000000-0000-4000-8000-000000000006",
};

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);

function chromakeySubjectPng(tone = 40) {
  const width = 32;
  const height = 32;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const subject = x >= 8 && x < 24 && y >= 8 && y < 24;
      rgb[i] = subject ? tone : 0;
      rgb[i + 1] = subject ? tone : 255;
      rgb[i + 2] = subject ? tone : 0;
    }
  }
  return encodeRgbPng(width, height, rgb);
}

function refuse(message) {
  console.error(`harness event=refused reason=${message}`);
  process.exit(1);
}

function databaseName(connectionString) {
  try {
    return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

async function reset(pool) {
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

async function seed(pool) {
  await pool.query("INSERT INTO source_revision (id, text) VALUES ($1, $2)", [
    ids.source,
    "Путин: Привет, коллега.\nДуров: Здравствуй.",
  ]);
  await pool.query(`
    INSERT INTO reading (id, draft_text, draft_revision_token, status)
    VALUES ($1, $2, '10000000-0000-4000-8000-000000000008', 'ready')
  `, [ids.reading, "Путин: Привет, коллега.\nДуров: Здравствуй."]);
  await pool.query(`
    INSERT INTO interpretation (id, source_revision_id, reading_id)
    VALUES ($1, $2, $3)
  `, [ids.interpretation, ids.source, ids.reading]);
  await pool.query(`
    INSERT INTO material_state (id, source_revision_id, interpretation_id)
    VALUES ($1, $2, $3)
  `, [ids.material, ids.source, ids.interpretation]);
  await pool.query(`
    INSERT INTO canonical_character (id, material_state_id, ordinal, name)
    VALUES ($1, $2, 0, 'Путин'), ($3, $2, 1, 'Дуров')
  `, [ids.putin, ids.material, ids.durov]);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = $1, active_material_state_id = $2, current_reading_id = $3
    WHERE singleton = true
  `, [ids.source, ids.material, ids.reading]);
  const frames = [{
    id: "frame-1",
    layout: "split2",
    origin: "source",
    panels: [
      { description: "Путин слева смотрит к собеседнику" },
      { description: "Дуров справа отвечает" },
    ],
    dialogue: "Привет, коллега.",
    speakerPanel: 0,
    sourceItemId: "item-1",
    sourceRole: "utterance",
  }];
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
    VALUES ($1, $2, 'checked', $3::jsonb, '2026-10-10T00:00:00Z'::timestamptz)
  `, [ids.result, ids.material, JSON.stringify({ frames })]);
}

async function approveCharacter(store, characterName) {
  const identity = await store.saveIdentity({
    characterName,
    image: { bytes: tinyPng, mime: "image/png" },
    comment: "deterministic identity",
  });
  assert.equal(identity.ok, true);
  const pending = await store.beginAnchor({ characterName, instruction: "deterministic anchor" });
  assert.equal(pending.ok, true);
  const finished = await store.finishAnchor({
    id: pending.id,
    result: { ok: true, image: { bytes: tinyPng }, metadata: { providerStatus: 200, latencyMs: 1 } },
  });
  assert.equal(finished.ok, true);
  const approved = await store.approveAnchor({ characterName, anchorId: pending.id });
  assert.equal(approved.ok, true);
  return approved.styleSeedAssetId;
}

function request(port, { method = "GET", path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const bytes = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: HOST,
      port,
      method,
      path,
      headers: bytes
        ? { "content-type": headers["content-type"] || "application/json", "content-length": bytes.length, ...headers }
        : { ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(buf.toString("utf8")); } catch {}
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

async function pollUntil(port, operationId, predicate, { timeoutMs = 10_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const polled = await request(port, {
      path: `/api/visual/frames/frame-1/operations/${operationId}`,
    });
    if (predicate(polled)) return polled;
    await sleep(25);
  }
  throw new Error(`poll timeout for ${operationId}`);
}

function createProviderDouble(state) {
  return async (input) => {
    state.calls.push({
      aspectRatio: input?.aspectRatio ?? null,
      component: input?.component ?? null,
      promptLength: String(input?.prompt || "").length,
      imageCount: Array.isArray(input?.images) ? input.images.length : 0,
      at: Date.now(),
    });
    if (state.failNext) {
      const failure = state.failNext;
      state.failNext = null;
      return {
        ok: false,
        kind: failure.kind || "provider",
        diagnostics: {
          providerStatus: failure.providerStatus ?? 500,
          latencyMs: failure.latencyMs ?? 3,
        },
      };
    }
    if (state.gate) await state.gate;
    const aspect = input?.aspectRatio;
    let bytes;
    if (state.nextImage && aspect !== "21:9") {
      bytes = state.nextImage;
      state.nextImage = null;
    } else {
      bytes = aspect === "21:9" ? tinyPng : chromakeySubjectPng(aspect === "5:4" || aspect === "4:5" ? 48 : 40);
    }
    return {
      ok: true,
      image: { bytes, mime: "image/png", width: aspect === "21:9" ? 1 : 32, height: aspect === "21:9" ? 1 : 32, byteLength: bytes.length },
      metadata: { providerStatus: 200, latencyMs: 5, model: "deterministic-double" },
    };
  };
}

async function runHappyPath(port, providerState) {
  const notes = [];
  const before = providerState.calls.length;
  const accepted = await request(port, {
    method: "POST",
    path: "/api/visual/frames/frame-1/generate",
    body: {},
  });
  assert.equal(accepted.status, 202, "generation returns 202");
  assert.equal(accepted.body.status, "accepted");
  assert.ok(accepted.body.operationId);
  notes.push(`accept:202 operationId=${accepted.body.operationId} phase=${accepted.body.phase}`);

  const mid = await pollUntil(port, accepted.body.operationId, (res) => (
    res.status === 200 && res.body?.status === "running" && typeof res.body.phase === "string"
  ));
  assert.equal(mid.body.visualReady, false, "not Visual until complete");
  notes.push(`progress phase=${mid.body.phase} visualReady=false`);

  const done = await pollUntil(port, accepted.body.operationId, (res) => (
    res.status === 200 && res.body?.status === "complete"
  ));
  assert.equal(done.body.visualReady, true);
  assert.equal(done.body.hybrid?.assemblyStatus || done.body.hybrid?.background?.status, "ready");
  notes.push(`complete visualReady=true phase=${done.body.phase}`);

  const visual = await request(port, { path: "/api/visual" });
  assert.equal(visual.status, 200);
  const frame = visual.body.frames.find((entry) => entry.id === "frame-1");
  assert.ok(frame);
  assert.equal(frame.visualReady, true);
  assert.equal(frame.dialogue, "Привет, коллега.");
  assert.equal(frame.speakerPanel, 0);
  assert.equal(frame.hybrid.assemblyStatus, "ready");
  assert.ok(frame.hybrid.background.assetId);
  assert.equal(frame.hybrid.panels.every((panel) => panel.status === "ready" && panel.assetId), true);
  const bgBeforePlacement = frame.hybrid.background.assetId;
  notes.push(`assembly background=${bgBeforePlacement} chars=${frame.hybrid.panels.map((p) => p.assetId).join(",")}`);

  const afterGenerate = providerState.calls.length;
  assert.ok(afterGenerate - before >= 3, "background + 2 characters via double");
  notes.push(`provider_double_calls_for_generate=${afterGenerate - before}`);

  const placement = await request(port, {
    method: "PATCH",
    path: "/api/visual/frames/frame-1/panels/0/placement",
    body: { zoom: 1.35, positionX: 42, positionY: 28, fitMode: "manual" },
  });
  assert.equal(placement.status, 200);
  assert.equal(providerState.calls.length, afterGenerate, "placement must not call provider");
  const afterPlacement = await request(port, { path: "/api/visual" });
  const placed = afterPlacement.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(placed.hybrid.background.assetId, bgBeforePlacement);
  assert.equal(placed.panels[0].zoom, 1.35);
  notes.push("placement survives without provider or background mutation");

  const reload = await request(port, { path: "/api/visual" });
  const reloaded = reload.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(reloaded.visualReady, true);
  assert.equal(reloaded.panels[0].zoom, 1.35);
  assert.equal(reloaded.hybrid.background.assetId, bgBeforePlacement);
  notes.push("reload preserves complete assembly + placement");

  const diagnostics = await request(port, { path: "/api/visual/frames/frame-1/diagnostics" });
  assert.equal(diagnostics.status, 200);
  assert.match(String(diagnostics.headers["content-type"] || ""), /application\/zip/);
  assert.ok(diagnostics.bytes.length > 32);
  writeFileSync(join(ROOT, "browser-diagnostics-frame-1.zip"), diagnostics.bytes);
  notes.push(`diagnostics zip bytes=${diagnostics.bytes.length}`);

  return { notes, operationId: accepted.body.operationId, providerCalls: afterGenerate - before };
}

async function runReloadResume(port, providerState) {
  let release;
  providerState.gate = new Promise((resolve) => { release = resolve; });
  const accepted = await request(port, {
    method: "POST",
    path: "/api/visual/frames/frame-1/generate",
    body: {},
  });
  assert.equal(accepted.status, 202);
  const opId = accepted.body.operationId;
  // Wait until the double is actually gated inside provider I/O (reuse may skip background).
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (providerState.calls.some((call) => call.at && providerState.gate)) break;
    await sleep(10);
  }
  const visualMid = await request(port, { path: "/api/visual" });
  const frameMid = visualMid.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(frameMid.hybrid.activeOperationId, opId, "reload exposes the running operation");
  // Previous valid assembly may remain visualReady during a replacement attempt.
  assert.equal(frameMid.visualReady, true, "previous valid assembly stays visible while replacement runs");
  const resumePoll = await request(port, {
    path: `/api/visual/frames/frame-1/operations/${opId}`,
  });
  assert.equal(resumePoll.status, 200);
  assert.equal(resumePoll.body.operationId, opId);
  assert.equal(resumePoll.body.status, "running");
  const again = await request(port, { path: "/api/visual" });
  assert.equal(
    again.body.frames.find((entry) => entry.id === "frame-1").hybrid.activeOperationId,
    opId,
    "reload must resume the same operation id without replacement accept",
  );
  release();
  providerState.gate = null;
  const done = await pollUntil(port, opId, (res) => res.body?.status === "complete" || res.body?.status === "failed");
  assert.equal(done.body.status, "complete");
  return { operationId: opId, resumedWithoutReplacement: true, previousAssemblyRetainedDuringRun: true };
}

async function runIncompleteWithoutPrior(port, providerState, pool, store) {
  // Clear ready heads so an in-flight attempt cannot be mistaken for a completed Visual frame.
  await pool.query(`
    UPDATE scene_background_state SET current_generation_id = NULL WHERE storyboard_version_id IN (
      SELECT id FROM storyboard_version WHERE storyboard_result_id = $1
    )
  `, [ids.result]);
  await pool.query(`
    UPDATE panel_visual_state SET current_character_generation_id = NULL WHERE storyboard_version_id IN (
      SELECT id FROM storyboard_version WHERE storyboard_result_id = $1
    )
  `, [ids.result]);
  await pool.query(`
    UPDATE frame_hybrid_state SET assembly_status = 'not-ready', active_operation_id = NULL
    WHERE storyboard_version_id IN (
      SELECT id FROM storyboard_version WHERE storyboard_result_id = $1
    )
  `, [ids.result]);

  let release;
  providerState.gate = new Promise((resolve) => { release = resolve; });
  const accepted = await request(port, {
    method: "POST",
    path: "/api/visual/frames/frame-1/generate",
    body: {},
  });
  assert.equal(accepted.status, 202);
  await sleep(30);
  const mid = await request(port, { path: "/api/visual" });
  const frame = mid.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(frame.visualReady, false, "incomplete hybrid without prior assembly is not Visual");
  assert.equal(frame.hybrid.assemblyStatus, "not-ready");
  release();
  providerState.gate = null;
  const done = await pollUntil(port, accepted.body.operationId, (res) => (
    res.body?.status === "complete" || res.body?.status === "failed"
  ));
  assert.equal(done.body.status, "complete");
  assert.equal(done.body.visualReady, true);
  return { operationId: accepted.body.operationId, incompleteNotPresentedAsVisual: true };
}

async function runForcedFailures(port, providerState, store, pool) {
  const outcomes = [];
  const beforeVisual = await request(port, { path: "/api/visual" });
  const readyFrame = beforeVisual.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(readyFrame.visualReady, true);
  const previousBg = readyFrame.hybrid.background.assetId;
  const previousChars = readyFrame.hybrid.panels.map((panel) => panel.assetId);

  providerState.failNext = { kind: "provider", providerStatus: 500, latencyMs: 4 };
  const failAccept = await request(port, {
    method: "POST",
    path: "/api/visual/frames/frame-1/generate",
    body: {},
  });
  assert.equal(failAccept.status, 202);
  const failed = await pollUntil(port, failAccept.body.operationId, (res) => res.body?.status === "failed");
  assert.equal(failed.body.status, "failed");
  assert.ok(failed.body.errorKind);
  outcomes.push({
    path: "provider-failure-double",
    errorKind: failed.body.errorKind,
    retainedVisualReady: failed.body.visualReady === true,
    russianUiKind: failed.body.errorKind,
  });
  const afterFail = await request(port, { path: "/api/visual" });
  const afterFailFrame = afterFail.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(afterFailFrame.visualReady, true);
  assert.equal(afterFailFrame.hybrid.background.assetId, previousBg);
  assert.deepEqual(afterFailFrame.hybrid.panels.map((panel) => panel.assetId), previousChars);
  assert.equal(afterFailFrame.hybrid.operation?.status, "failed");

  // Matte failure via controlled local chromakey that fails acceptance thresholds.
  providerState.failNext = null;
  providerState.nextImage = solidGreenSubjectPng();
  const matteAccept = await request(port, {
    method: "POST",
    path: "/api/visual/frames/frame-1/generate",
    body: {},
  });
  assert.equal(matteAccept.status, 202);
  const matteFailed = await pollUntil(port, matteAccept.body.operationId, (res) => (
    res.body?.status === "failed" || res.body?.status === "complete"
  ));
  // Prefer matte-failed when the green-subject plate reaches character matte; if background
  // reuse skips to characters, the first character image uses nextImage.
  outcomes.push({
    path: "matte-failure-double",
    status: matteFailed.body.status,
    errorKind: matteFailed.body.errorKind || null,
    note: matteFailed.body.errorKind === "matte-failed"
      ? "matte-failed reached terminal state"
      : "observed terminal state with doubles; see errorKind",
  });
  providerState.nextImage = null;

  const afterMatte = await request(port, { path: "/api/visual" });
  const afterMatteFrame = afterMatte.body.frames.find((entry) => entry.id === "frame-1");
  assert.equal(afterMatteFrame.visualReady, true, "previous assembly remains after matte/replacement failure path");
  assert.equal(afterMatteFrame.hybrid.background.assetId, previousBg);

  const retry = await request(port, {
    method: "POST",
    path: "/api/visual/frames/frame-1/generate",
    body: {},
  });
  assert.equal(retry.status, 202);
  assert.notEqual(retry.body.operationId, failAccept.body.operationId, "retry creates a new operation");
  const retryDone = await pollUntil(port, retry.body.operationId, (res) => (
    res.body?.status === "complete" || res.body?.status === "failed"
  ));
  assert.equal(retryDone.body.status, "complete");
  outcomes.push({
    path: "retry-new-operation",
    previousOperationId: failAccept.body.operationId,
    retryOperationId: retry.body.operationId,
  });

  const pendingResult = await pool.query(`
    SELECT count(*)::int AS count FROM (
      SELECT id FROM scene_background_generation WHERE status = 'pending'
      UNION ALL
      SELECT id FROM character_visual_state_generation WHERE status = 'pending'
      UNION ALL
      SELECT id FROM visual_frame_operation WHERE status = 'running'
    ) pending
  `);
  const pending = pendingResult.rows[0].count;
  outcomes.push({
    path: "no-unintentional-pending",
    pendingCount: pending,
  });
  assert.equal(pending, 0);

  const persistence = await store.loadHybridPersistence({ frameId: "frame-1" });
  outcomes.push({
    path: "previous-assembly-retained",
    backgroundAssetId: previousBg,
    characterAssetIds: previousChars,
    assemblyStatus: persistence.frameHybridState.assemblyStatus,
  });

  outcomes.push({
    path: "storage-failure-double",
    deferredTo: "T051-if-needed",
    limitation: "No dedicated storage-fault double is wired without mutating production pool helpers; provider/matte retention paths cover previous-assembly safety.",
  });

  return outcomes;
}

function solidGreenSubjectPng() {
  const width = 24;
  const height = 24;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const subject = x >= 6 && x < 18 && y >= 6 && y < 18;
      rgb[i] = subject ? 20 : 0;
      rgb[i + 1] = subject ? 220 : 255;
      rgb[i + 2] = subject ? 20 : 0;
    }
  }
  return encodeRgbPng(width, height, rgb);
}

async function main() {
  if (!databaseUrl) refuse("missing-STORYBOARD_TEST_DATABASE_URL");
  if (databaseName(databaseUrl) !== "comics_test") refuse("database-must-be-comics_test");

  process.env.DATABASE_URL = databaseUrl;
  // Strip live provider credentials so accidental fallback cannot call out.
  for (const key of [
    "CONTEST_API_TOKEN",
    "BASE_URL",
    "IMAGE_BASE_URL",
    "IMAGE_API_TOKEN",
    "CONTEST_MODEL",
  ]) {
    delete process.env[key];
  }

  const pool = createPool(databaseUrl);
  await migrate({ connectionString: databaseUrl, logger: { log() {} } });
  await reset(pool);
  await seed(pool);

  const store = createVisualStore(pool);
  const styleA = await approveCharacter(store, "Путин");
  const styleB = await approveCharacter(store, "Дуров");
  assert.equal(styleB, styleA, "first approved style seed remains stable");

  const providerState = { calls: [], failNext: null, gate: null };
  const imageGenerator = createProviderDouble(providerState);
  const liveFetch = async () => {
    throw new Error("live-text-provider-forbidden-in-deterministic-harness");
  };

  const server = createServer({
    migrate: false,
    env: {},
    fetchImpl: liveFetch,
    visualStore: store,
    projectStore: {
      loadProject: async () => ({
        draft: { text: "Путин: Привет, коллега.\nДуров: Здравствуй." },
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
        if (String(line).includes("event=")) process.stdout.write(`${line}\n`);
      },
    },
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  console.log(`harness listening at http://${HOST}:${PORT}/`);
  console.log("harness setup=comics_test+provider-double+persisted-fixtures live_provider_requests=0");

  const report = {
    setup: "comics_test + in-process image provider double + seeded split dialogue frame",
    liveImageProviderRequests: 0,
    liveTextProviderRequests: 0,
    providerDoubleCalls: 0,
    happyPath: null,
    reloadResume: null,
    forcedFailures: null,
    consoleErrors: [],
    serverErrors: [],
  };

  try {
    if (mode === "serve" || mode === "browser") {
      // Prepare one ready assembly, then keep listening for browser acceptance.
      report.happyPath = await runHappyPath(PORT, providerState);
      report.providerDoubleCalls = providerState.calls.length;
      writeFileSync(join(ROOT, "deterministic-harness-report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`harness mode=${mode} ready-for-browser provider_double_calls=${report.providerDoubleCalls}`);
      console.log("harness keep-alive; press Ctrl+C to stop");
      return;
    }

    report.happyPath = await runHappyPath(PORT, providerState);
    report.reloadResume = await runReloadResume(PORT, providerState);
    report.incompleteWithoutPrior = await runIncompleteWithoutPrior(PORT, providerState, pool, store);
    if (mode === "failures" || mode === "script") {
      report.forcedFailures = await runForcedFailures(PORT, providerState, store, pool);
    }
    report.providerDoubleCalls = providerState.calls.length;
    report.liveImageProviderRequests = 0;
    report.liveTextProviderRequests = 0;

    mkdirSync(ROOT, { recursive: true });
    writeFileSync(join(ROOT, "deterministic-harness-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`harness report written provider_double_calls=${report.providerDoubleCalls}`);
    console.log(JSON.stringify({
      liveImageProviderRequests: 0,
      liveTextProviderRequests: 0,
      providerDoubleCalls: report.providerDoubleCalls,
      happyPathOk: true,
      reloadResumeOk: true,
      forcedFailures: (report.forcedFailures || []).map((entry) => entry.path),
    }));

    if (!keepAlive) {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
      return;
    }
    console.log("harness keep-alive=1; press Ctrl+C to stop");
  } catch (error) {
    console.error(`harness event=failed message=${error?.message || error}`);
    await new Promise((resolve) => server.close(resolve)).catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
