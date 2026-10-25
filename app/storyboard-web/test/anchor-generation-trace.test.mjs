import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import {
  ANCHOR_SESSION_COMPILER_ID,
  ANCHOR_SESSION_COMPILER_VERSION,
  compilePrototypePrompt,
} from "../anchor-prompt.mjs";
import { assembleAnchorSession } from "../anchor-session-request.mjs";
import { generateImage } from "../image-provider.mjs";
import {
  createImageGenerationTraceRecorder,
  readImageGenerationAttempts,
} from "../image-generation-trace.mjs";
import { executeImageRequest, serializeImageRequest, toReference } from "../image-reference-strategy.mjs";
import { createServer } from "../server.mjs";
import { ANCHOR_COMPILER_ID, ANCHOR_COMPILER_VERSION, anchorPrompt } from "../visual-model.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const output = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const sourceUrl = `data:image/png;base64,${png.toString("base64")}`;
const PROJECT_ID = "02100000-0000-4000-8000-000000000301";
const MATERIAL_ID = "02100000-0000-4000-8000-000000000302";
const CORRELATION_ID = "02100000-0000-4000-8000-000000000303";
const SOURCE_CLIENT = "02100000-0000-4000-8000-000000000311";
const SOURCE_SERVER = "02100000-0000-4000-8000-000000000312";
const ANCHOR_CLIENT = "02100000-0000-4000-8000-000000000313";
const ANCHOR_SERVER = "02100000-0000-4000-8000-000000000314";
const STYLE_ID = "02100000-0000-4000-8000-000000000315";
const PENDING_ID = "02100000-0000-4000-8000-000000000316";
const PREVIOUS_ID = "02100000-0000-4000-8000-000000000317";
const CANARY = "CANARY-ANCHOR-INSTRUCTION-021";
const TOKEN = "super-secret-token";

const env = {
  BASE_URL: "http://127.0.0.1:9/v1",
  CONTEST_API_TOKEN: TOKEN,
  IMAGE_MODEL: "image-test",
  IMAGE_TIMEOUT_MS: "1000",
  IMAGE_REFERENCE_STRATEGY: "passthrough",
  STORYBOARD_BUILD_ID: "build-021",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function successPayload() {
  return {
    choices: [{
      finish_reason: "stop",
      message: {
        content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${output.toString("base64")}` } }],
      },
    }],
    usage: { prompt_tokens: 2, total_tokens: 2, secret: TOKEN },
  };
}

function image(id, bytes = png) {
  return { id, mime: "image/png", bytes, width: 1, height: 1 };
}

function memoryTrace(options = {}) {
  const rows = new Map();
  const logs = [];
  const db = {
    rows,
    logs,
    async query(sql, params) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (options.fail === "prepared" && text.startsWith("INSERT")) {
        const error = new Error(`${CANARY} ${TOKEN} data:image/png;base64 exception text`);
        error.code = "23514";
        throw error;
      }
      if (options.fail === "terminal" && text.startsWith("UPDATE")) {
        const error = new Error(`${CANARY} ${TOKEN} exception text`);
        error.code = "57014";
        throw error;
      }
      if (text.startsWith("INSERT INTO image_generation_attempt")) {
        rows.set(params[0], {
          id: params[0],
          diagnostic_id: params[1],
          project_id: params[2],
          generation_kind: params[3],
          action_kind: params[4],
          panel_generation_id: params[5],
          storyboard_version_id: params[6],
          frame_id: params[7],
          panel_id: params[8],
          panel_index: params[9],
          correlation_id: params[10],
          compiler_id: params[11],
          compiler_version: params[12],
          build_id: params[13],
          prepared_at: new Date(),
          terminal_at: null,
          state: "prepared",
          prompt: params[14],
          prompt_sha256: params[15],
          model: params[16],
          aspect_ratio: params[17],
          reference_strategy: params[18],
          budget_bytes: params[19],
          original_body_bytes: params[20],
          final_body_bytes: params[21],
          request_sha256: params[22],
          sent_references: JSON.parse(params[23]),
          omissions: JSON.parse(params[24]),
          provider_io_started: null,
          timeout_ms: params[25],
          character_name: params[26] ?? null,
          material_state_id: params[27] ?? null,
          anchor_version_id: params[28] ?? null,
          basis_kind: params[29] ?? null,
          latency_ms: null,
          http_status: null,
          outcome_kind: null,
          usage: null,
          output_sha256: null,
          output_mime: null,
          output_byte_length: null,
          output_width: null,
          output_height: null,
        });
        return { rowCount: 1, rows: [] };
      }
      if (text.startsWith("UPDATE image_generation_attempt")) {
        const row = rows.get(params[0]);
        if (!row || row.state !== "prepared") return { rowCount: 0, rows: [] };
        row.state = params[1];
        row.terminal_at = new Date();
        row.provider_io_started = true;
        row.latency_ms = params[2];
        row.http_status = params[3];
        row.outcome_kind = params[4];
        row.usage = params[5] ? JSON.parse(params[5]) : null;
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("FROM image_generation_attempt")) {
        const matches = [...rows.values()].filter((row) => {
          if (text.includes("WHERE id =")) return row.id === params[0];
          if (text.includes("WHERE correlation_id =")) return row.correlation_id === params[0];
          if (text.includes("WHERE anchor_version_id =")) return row.anchor_version_id === params[0];
          return false;
        });
        return { rows: matches };
      }
      throw new Error(`unexpected sql: ${text}`);
    },
  };
  return {
    db,
    recorder: createImageGenerationTraceRecorder({
      query: db.query.bind(db),
      logger: { log(line) { logs.push(String(line)); } },
      buildId: "build-021",
    }),
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function request(port, { method = "POST", path, body }) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body ?? {}));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: { "content-type": "application/json", "content-length": bytes.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(bytes);
  });
}

function sessionPath() {
  return `/api/projects/${PROJECT_ID}/visual/characters/${encodeURIComponent("Аня")}/anchor-session`;
}

function anchorPath() {
  return `/api/projects/${PROJECT_ID}/visual/characters/${encodeURIComponent("Аня")}/anchor`;
}

function loadedAssets() {
  return {
    [SOURCE_CLIENT]: image(SOURCE_SERVER),
    [ANCHOR_CLIENT]: image(ANCHOR_SERVER),
  };
}

function sessionStore(overrides = {}) {
  const assets = overrides.assets || loadedAssets();
  return {
    async readAnchorStyle() {
      if (overrides.style === false) return null;
      return image(overrides.styleId || STYLE_ID);
    },
    async readActiveMaterialStateId() {
      if (overrides.material === false) return null;
      return overrides.material || MATERIAL_ID;
    },
    async readAsset(id) {
      return assets[id] || null;
    },
    async load() {
      return { ok: true, status: "ready", characters: [], frames: [] };
    },
    async acceptSessionAnchor() {
      return { ok: true, anchorId: PENDING_ID, assetId: "output-1" };
    },
    async retireCurrentAnchor() {
      return { ok: true, anchorId: PENDING_ID };
    },
    async restoreRetiredAnchor() {
      return { ok: true };
    },
    async approveAnchor() {
      return { ok: true, anchorId: PENDING_ID };
    },
    async saveIdentity() {
      return { ok: true, assetId: SOURCE_SERVER };
    },
    async updatePlacement() {
      return { ok: true, changed: true };
    },
    async applyOperation() {
      return { ok: true, changed: false };
    },
    async beginAnchor(input) {
      if (overrides.beginAnchor) return overrides.beginAnchor(input);
      return {
        ok: true,
        id: PENDING_ID,
        materialStateId: MATERIAL_ID,
        characterName: "Аня",
        identityComment: "",
        instruction: String(input?.instruction || ""),
        identity: image(SOURCE_SERVER),
        previous: overrides.previous === false ? null : image(PREVIOUS_ID),
        style: overrides.persistedStyle === false ? null : image(overrides.styleId || STYLE_ID),
      };
    },
    async finishAnchor({ result }) {
      return result?.ok
        ? { ok: true }
        : { ok: false, status: "failed", kind: result?.kind || "provider", httpStatus: result?.httpStatus || 502 };
    },
  };
}

async function run({
  path,
  body,
  store,
  trace = null,
  sourceEnv = env,
  fetchImpl,
  logger = null,
  imageCalls = null,
}) {
  const logs = [];
  const calls = [];
  const server = createServer({
    migrate: false,
    projectStore: {
      async duplicateProject() {
        return { ok: true, project: { id: PROJECT_ID, title: "Copy 021" } };
      },
    },
    visualStore: store,
    env: sourceEnv,
    logger: logger || { log(line) { logs.push(String(line)); } },
    traceRecorder: trace ? trace.recorder : null,
    imageGenerator: async (input) => {
      calls.push(input);
      if (imageCalls) imageCalls.push(input);
      return generateImage(input);
    },
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const response = await request(port, { path, body });
    return { response, calls, logs, port, server };
  } finally {
    await close(server);
  }
}

function comparable(response, call) {
  return {
    status: response.status,
    body: response.body,
    prompt: call?.prompt || null,
    serialized: call?.serializedBody || null,
    timeoutMs: call?.timeoutMs ?? null,
    aspectRatio: call?.aspectRatio || null,
    strategy: call?.transport?.strategy || null,
    roles: call?.transport?.referenceRoles || null,
    omitted: call?.transport?.omittedRoles || null,
    model: call?.transport ? "image-test" : null,
  };
}

test("compiler identity is not part of either anchor prompt", () => {
  const sessionSource = readFileSync(new URL("../anchor-prompt.mjs", import.meta.url), "utf8");
  const persistedSource = readFileSync(new URL("../visual-model.mjs", import.meta.url), "utf8");
  const sessionFn = sessionSource.slice(sessionSource.indexOf("export function compilePrototypePrompt"));
  const persistedFn = persistedSource.slice(persistedSource.indexOf("export function anchorPrompt"));
  assert.equal(sessionFn.includes("ANCHOR_SESSION_COMPILER"), false);
  assert.equal(persistedFn.includes("ANCHOR_COMPILER"), false);
  const sessionPrompt = compilePrototypePrompt(
    [{ role: "identity", mime: "image/png", bytes: png }],
    CANARY,
    { basis: "from-source" },
  );
  const persistedPrompt = anchorPrompt({
    characterName: "Аня",
    identityComment: "",
    instruction: CANARY,
    hasPrevious: true,
    hasStyle: true,
  });
  assert.equal(sessionPrompt.includes(ANCHOR_SESSION_COMPILER_ID), false);
  assert.equal(sessionPrompt.includes(ANCHOR_SESSION_COMPILER_VERSION), false);
  assert.equal(persistedPrompt.includes(ANCHOR_COMPILER_ID), false);
  assert.equal(persistedPrompt.includes(ANCHOR_COMPILER_VERSION), false);
  assert.equal(ANCHOR_SESSION_COMPILER_ID, "anchor-session-prompt");
  assert.equal(ANCHOR_SESSION_COMPILER_VERSION, "v1");
  assert.equal(ANCHOR_COMPILER_ID, "anchor-prompt");
  assert.equal(ANCHOR_COMPILER_VERSION, "v1");
});

test("anchor assembly keeps a server asset id through a request-budget omission", async () => {
  const styleBytes = Buffer.alloc(800, 7);
  const assembled = assembleAnchorSession({
    basis: "accepted",
    instruction: "",
    anchor: image(ANCHOR_SERVER),
    source: image(SOURCE_SERVER),
    style: { id: STYLE_ID, mime: "image/png", bytes: styleBytes },
  });
  assert.deepEqual(assembled.references.map((ref) => ref.role), ["anchor", "identity", "style"]);
  assert.equal(assembled.references[2].assetId, STYLE_ID);
  const plain = assembleAnchorSession({
    basis: "accepted",
    instruction: "",
    anchor: { bytes: png, mime: "image/png" },
    source: { bytes: png, mime: "image/png" },
    style: { mime: "image/png", bytes: styleBytes },
  });
  assert.equal(assembled.prompt, plain.prompt);
  assert.equal(assembled.prompt.includes(ANCHOR_SESSION_COMPILER_ID), false);
  const style = toReference("style", assembled.references[2]);
  style.width = 900;
  style.height = 700;
  const anchor = toReference("anchor", assembled.references[0]);
  anchor.width = 32;
  anchor.height = 32;
  const previous = toReference("previous", { bytes: png, mime: "image/png" });
  previous.width = 32;
  previous.height = 32;
  const references = [anchor, previous, style];
  const prompt = "fixed anchor prompt";
  const reduced = serializeImageRequest({
    prompt,
    references: references.filter((ref) => ref.role !== "style"),
    aspectRatio: "4:5",
    model: "image-test",
  });
  const traced = memoryTrace();
  let calls = 0;
  const result = await executeImageRequest({
    strategy: "budgeted",
    budgetBytes: Buffer.byteLength(reduced),
    references,
    generationMode: "revision",
    compilePrompt: () => prompt,
    aspectRatio: "4:5",
    model: "image-test",
    imageGenerator: generateImage,
    env,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    },
    traceContext: {
      projectId: PROJECT_ID,
      generationKind: "anchor-session",
      actionKind: "anchor-session",
      basisKind: "accepted",
      characterName: "Аня",
      materialStateId: MATERIAL_ID,
      compilerId: ANCHOR_SESSION_COMPILER_ID,
      compilerVersion: ANCHOR_SESSION_COMPILER_VERSION,
      upstreamOmissions: assembled.omissions,
    },
    traceRecorder: traced.recorder,
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  const row = [...traced.db.rows.values()][0];
  assert.deepEqual(row.sent_references.map((item) => item.role), ["anchor", "previous"]);
  assert.equal(row.sent_references[0].assetId, ANCHOR_SERVER);
  assert.equal(row.sent_references[1].assetId, null);
  assert.deepEqual(row.omissions, [{ role: "style", assetId: STYLE_ID, reason: "request-budget" }]);
});

const shapes = [
  {
    name: "from-source",
    path: sessionPath,
    body: {
      basis: "from-source",
      instruction: CANARY,
      sourceImage: sourceUrl,
      sourceAssetId: SOURCE_CLIENT,
      projectId: "client-project",
      materialStateId: "02100000-0000-4000-8000-00000000ffff",
      anchorVersionId: PENDING_ID,
      characterName: "Other",
      correlationId: CORRELATION_ID,
    },
    expect: {
      generationKind: "anchor-session",
      basisKind: "from-source",
      anchorVersionId: null,
      roles: ["identity"],
      assetIds: [null],
      compilerId: "anchor-session-prompt",
    },
  },
  {
    name: "selected",
    path: sessionPath,
    body: {
      basis: "selected",
      instruction: "тише",
      sourceAssetId: SOURCE_CLIENT,
      anchorAssetId: ANCHOR_CLIENT,
      previousImage: sourceUrl,
      projectId: "client-project",
      anchorVersionId: PENDING_ID,
      correlationId: CORRELATION_ID,
    },
    expect: {
      generationKind: "anchor-session",
      basisKind: "selected",
      anchorVersionId: null,
      roles: ["previous", "identity", "anchor"],
      assetIds: [null, SOURCE_SERVER, ANCHOR_SERVER],
      compilerId: "anchor-session-prompt",
    },
  },
  {
    name: "accepted",
    path: sessionPath,
    body: {
      basis: "accepted",
      instruction: "",
      sourceAssetId: SOURCE_CLIENT,
      anchorAssetId: ANCHOR_CLIENT,
      projectId: "client-project",
      characterName: "Other",
      correlationId: CORRELATION_ID,
    },
    expect: {
      generationKind: "anchor-session",
      basisKind: "accepted",
      anchorVersionId: null,
      roles: ["anchor", "identity", "style"],
      assetIds: [ANCHOR_SERVER, SOURCE_SERVER, STYLE_ID],
      compilerId: "anchor-session-prompt",
    },
  },
  {
    name: "persisted",
    path: anchorPath,
    body: {
      instruction: CANARY,
      projectId: "client-project",
      materialStateId: "02100000-0000-4000-8000-00000000ffff",
      anchorVersionId: "02100000-0000-4000-8000-00000000eeee",
      characterName: "Other",
      correlationId: CORRELATION_ID,
    },
    expect: {
      generationKind: "anchor",
      basisKind: "persisted",
      anchorVersionId: PENDING_ID,
      roles: ["identity", "previous", "style"],
      assetIds: [SOURCE_SERVER, PREVIOUS_ID, STYLE_ID],
      compilerId: "anchor-prompt",
    },
  },
];

test("tracing on and off keep each anchor shape equivalent", async () => {
  for (const shape of shapes) {
    const bodies = [];
    const fetchImpl = async (_url, init) => {
      bodies.push(init.body);
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    };
    const traced = memoryTrace();
    const on = await run({
      path: shape.path(),
      body: shape.body,
      store: sessionStore(),
      trace: traced,
      fetchImpl,
    });
    const off = await run({
      path: shape.path(),
      body: shape.body,
      store: sessionStore(),
      trace: null,
      fetchImpl,
    });
    assert.equal(on.calls.length, 1, shape.name);
    assert.equal(off.calls.length, 1, shape.name);
    assert.equal(bodies.length, 2, shape.name);
    assert.equal(bodies[0], bodies[1], shape.name);
    assert.equal(sha256(bodies[0]), sha256(bodies[1]), shape.name);
    assert.deepEqual(comparable(on.response, on.calls[0]), comparable(off.response, off.calls[0]), shape.name);
    assert.equal(on.response.status, 200, shape.name);
    assert.equal(on.calls[0].prompt.includes(shape.expect.compilerId), false, shape.name);
    const row = [...traced.db.rows.values()][0];
    assert.equal(row.generation_kind, shape.expect.generationKind, shape.name);
    assert.equal(row.action_kind, shape.expect.generationKind, shape.name);
    assert.equal(row.basis_kind, shape.expect.basisKind, shape.name);
    assert.equal(row.character_name, "Аня", shape.name);
    assert.equal(row.material_state_id, MATERIAL_ID, shape.name);
    assert.equal(row.anchor_version_id, shape.expect.anchorVersionId, shape.name);
    assert.equal(row.project_id, PROJECT_ID, shape.name);
    assert.equal(row.correlation_id, CORRELATION_ID, shape.name);
    assert.equal(row.panel_generation_id, null, shape.name);
    assert.equal(row.frame_id, null, shape.name);
    assert.equal(row.compiler_id, shape.expect.compilerId, shape.name);
    assert.equal(row.compiler_version, "v1", shape.name);
    assert.equal(row.model, "image-test", shape.name);
    assert.equal(row.aspect_ratio, "4:5", shape.name);
    assert.equal(row.reference_strategy, "passthrough", shape.name);
    assert.equal(row.budget_bytes, 850000, shape.name);
    assert.equal(row.timeout_ms, 1000, shape.name);
    assert.equal(row.request_sha256, sha256(bodies[0]), shape.name);
    assert.equal(row.prompt, on.calls[0].prompt, shape.name);
    assert.equal(row.prompt_sha256, sha256(on.calls[0].prompt), shape.name);
    assert.deepEqual(row.sent_references.map((item) => item.role), shape.expect.roles, shape.name);
    assert.deepEqual(row.sent_references.map((item) => item.assetId), shape.expect.assetIds, shape.name);
    assert.deepEqual(row.omissions, [], shape.name);
    assert.equal(row.state, "succeeded", shape.name);
    assert.equal(row.provider_io_started, true, shape.name);
    assert.equal(row.http_status, 200, shape.name);
    assert.deepEqual(row.usage, { prompt_tokens: 2, total_tokens: 2 }, shape.name);
    const rendered = JSON.stringify(row);
    assert.equal(rendered.includes(TOKEN), false, shape.name);
    assert.equal(rendered.includes(png.toString("base64")), false, shape.name);
    assert.equal(rendered.includes(output.toString("base64")), false, shape.name);
    const log = on.logs.join("\n");
    for (const secret of [CANARY, TOKEN, "data:image", png.toString("base64"), "exception text"]) {
      assert.equal(log.includes(secret), false, `${shape.name}:${secret}`);
    }
  }
});

test("a session source loaded by id keeps the server asset id and ignores client ownership", async () => {
  const traced = memoryTrace();
  const result = await run({
    path: sessionPath(),
    body: {
      basis: "from-source",
      instruction: "",
      sourceAssetId: SOURCE_CLIENT,
      projectId: "client-project",
      materialStateId: "not-a-uuid",
      correlationId: "not-a-uuid",
    },
    store: sessionStore(),
    trace: traced,
    fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
  });
  assert.equal(result.response.status, 200);
  const row = [...traced.db.rows.values()][0];
  assert.equal(row.sent_references[0].assetId, SOURCE_SERVER);
  assert.equal(row.sent_references[0].assetId === SOURCE_CLIENT, false);
  assert.equal(row.material_state_id, MATERIAL_ID);
  assert.equal(row.correlation_id, null);
  assert.equal(row.anchor_version_id, null);
  assert.equal(row.character_name, "Аня");
});

test("a session without an active material state records that absence", async () => {
  const traced = memoryTrace();
  const result = await run({
    path: sessionPath(),
    body: { basis: "from-source", instruction: "", sourceImage: sourceUrl },
    store: sessionStore({ material: false, style: false }),
    trace: traced,
    fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
  });
  assert.equal(result.response.status, 200);
  const row = [...traced.db.rows.values()][0];
  assert.equal(row.material_state_id, null);
  assert.equal(row.basis_kind, "from-source");
  assert.deepEqual(row.omissions, []);
});

test("persisted anchor without previous or style does not invent an omission", async () => {
  const traced = memoryTrace();
  const result = await run({
    path: anchorPath(),
    body: { instruction: "" },
    store: sessionStore({ previous: false, persistedStyle: false }),
    trace: traced,
    fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
  });
  assert.equal(result.response.status, 200);
  const row = [...traced.db.rows.values()][0];
  assert.deepEqual(row.sent_references.map((item) => item.role), ["identity"]);
  assert.equal(row.sent_references[0].assetId, SOURCE_SERVER);
  assert.deepEqual(row.omissions, []);
  assert.equal(row.anchor_version_id, PENDING_ID);
});

test("the same persisted asset used for identity and style is not an omission", async () => {
  const traced = memoryTrace();
  const result = await run({
    path: anchorPath(),
    body: { instruction: "" },
    store: sessionStore({ previous: false, styleId: SOURCE_SERVER }),
    trace: traced,
    fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
  });
  assert.equal(result.response.status, 200);
  const row = [...traced.db.rows.values()][0];
  assert.deepEqual(row.sent_references.map((item) => item.role), ["identity"]);
  assert.deepEqual(row.omissions, []);
});

test("anchor routes record provider success, http failure, timeout, and network failure", async () => {
  const cases = [
    {
      name: "success",
      fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
      state: "succeeded",
      outcome: "stop",
      http: 200,
      product: 200,
    },
    {
      name: "provider",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: CANARY } }), { status: 500 }),
      state: "failed",
      outcome: "provider",
      http: 500,
      product: 502,
    },
    {
      name: "timeout",
      timeoutEnv: true,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        const abort = () => {
          const error = new Error("request aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      }),
      state: "failed",
      outcome: "timeout",
      http: null,
      product: 504,
    },
    {
      name: "network",
      fetchImpl: async () => {
        throw new Error(`${CANARY} network down`);
      },
      state: "failed",
      outcome: "provider",
      http: null,
      product: 502,
    },
  ];
  for (const route of [
    { name: "session", path: sessionPath(), body: { basis: "from-source", instruction: CANARY, sourceImage: sourceUrl } },
    { name: "persisted", path: anchorPath(), body: { instruction: CANARY } },
  ]) {
    for (const item of cases) {
      const traced = memoryTrace();
      let sawPrepared = false;
      const result = await run({
        path: route.path,
        body: route.body,
        store: sessionStore(),
        trace: traced,
        sourceEnv: item.timeoutEnv ? { ...env, IMAGE_TIMEOUT_MS: "40", ANCHOR_SESSION_TIMEOUT_MS: "40" } : env,
        fetchImpl: async (...args) => {
          const prepared = [...traced.db.rows.values()];
          assert.equal(prepared.length, 1, `${route.name}:${item.name}`);
          assert.equal(prepared[0].state, "prepared", `${route.name}:${item.name}`);
          assert.equal(prepared[0].provider_io_started, null, `${route.name}:${item.name}`);
          sawPrepared = true;
          return item.fetchImpl(...args);
        },
      });
      assert.equal(sawPrepared, true, `${route.name}:${item.name}`);
      assert.equal(result.calls.length, 1, `${route.name}:${item.name}`);
      assert.equal(result.response.status, item.product, `${route.name}:${item.name}`);
      const row = [...traced.db.rows.values()][0];
      assert.equal(row.state, item.state, `${route.name}:${item.name}`);
      assert.equal(row.outcome_kind, item.outcome, `${route.name}:${item.name}`);
      assert.equal(row.http_status, item.http, `${route.name}:${item.name}`);
      assert.equal(row.provider_io_started, true, `${route.name}:${item.name}`);
      const presented = await readImageGenerationAttempts(traced.db, { attemptId: row.id });
      assert.equal(presented[0].providerIoStarted, true, `${route.name}:${item.name}`);
      assert.equal(presented[0].providerHttpStatus, item.http, `${route.name}:${item.name}`);
      const log = result.logs.join("\n");
      assert.equal(log.includes(CANARY), false, `${route.name}:${item.name}`);
      assert.equal(log.includes("network down"), false, `${route.name}:${item.name}`);
    }
  }
});

test("a blocked anchor provider leaves the prepared row non-terminal", async () => {
  const traced = memoryTrace();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let during = null;
  const pending = run({
    path: sessionPath(),
    body: { basis: "from-source", instruction: "", sourceImage: sourceUrl, correlationId: CORRELATION_ID },
    store: sessionStore(),
    trace: traced,
    fetchImpl: async () => {
      during = await readImageGenerationAttempts(traced.db, { correlationId: CORRELATION_ID });
      await gate;
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    },
  });
  const started = Date.now();
  while (!during && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(during.length, 1);
  assert.equal(during[0].state, "prepared");
  assert.equal(during[0].providerIoStarted, null);
  assert.equal(during[0].providerHttpStatus, null);
  assert.equal(during[0].outcomeKind, null);
  assert.equal(during[0].basisKind, "from-source");
  release();
  const result = await pending;
  assert.equal(result.response.status, 200);
  const after = await readImageGenerationAttempts(traced.db, { attemptId: during[0].attemptId });
  assert.equal(after[0].state, "succeeded");
  assert.equal(after[0].providerIoStarted, true);
});

test("anchor trace write failures preserve the product result and do not retry", async () => {
  for (const route of [
    { name: "session", path: sessionPath(), body: { basis: "from-source", instruction: CANARY, sourceImage: sourceUrl } },
    { name: "persisted", path: anchorPath(), body: { instruction: CANARY } },
  ]) {
    for (const fail of ["prepared", "terminal"]) {
      const traced = memoryTrace({ fail });
      const result = await run({
        path: route.path,
        body: route.body,
        store: sessionStore(),
        trace: traced,
        fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
      });
      assert.equal(result.calls.length, 1, `${route.name}:${fail}`);
      assert.equal(result.response.status, 200, `${route.name}:${fail}`);
      if (route.name === "session") {
        assert.equal(result.response.body.includes(output.toString("base64")), true, `${route.name}:${fail}`);
      } else {
        assert.equal(JSON.parse(result.response.body).status, "ready", `${route.name}:${fail}`);
      }
      if (fail === "terminal") {
        const row = [...traced.db.rows.values()][0];
        assert.equal(row.state, "prepared", route.name);
        assert.equal(row.provider_io_started, null, route.name);
        const presented = await readImageGenerationAttempts(traced.db, { attemptId: row.id });
        assert.equal(presented[0].providerIoStarted, null, route.name);
      } else {
        assert.equal(traced.db.rows.size, 0, route.name);
      }
      const log = traced.db.logs.join("\n");
      assert.match(log, /event=image-generation-trace/);
      for (const secret of [CANARY, TOKEN, "data:image", "exception text"]) {
        assert.equal(log.includes(secret), false, `${route.name}:${fail}:${secret}`);
      }
    }
  }
});

test("anchor failures before provider I/O create no attempt row", async () => {
  const cases = [
    {
      name: "session-invalid",
      path: sessionPath(),
      body: { basis: "sideways" },
      status: 400,
    },
    {
      name: "session-image",
      path: sessionPath(),
      body: { basis: "from-source", sourceImage: "data:image/png;base64,%%%" },
      status: 400,
    },
    {
      name: "session-missing-source",
      path: sessionPath(),
      body: { basis: "from-source", instruction: "" },
      status: 400,
    },
    {
      name: "session-config",
      path: sessionPath(),
      body: { basis: "from-source", sourceImage: sourceUrl },
      env: { ...env, IMAGE_REFERENCE_STRATEGY: "shrink" },
      status: 500,
    },
    {
      name: "session-payload",
      path: sessionPath(),
      body: { basis: "from-source", sourceImage: sourceUrl },
      env: { ...env, IMAGE_REFERENCE_STRATEGY: "budgeted", IMAGE_REQUEST_BUDGET_BYTES: "1" },
      status: 422,
    },
    {
      name: "session-unknown-asset",
      path: sessionPath(),
      body: { basis: "from-source", sourceAssetId: "02100000-0000-4000-8000-000000000399" },
      status: 400,
    },
    {
      name: "persisted-invalid",
      path: anchorPath(),
      body: null,
      raw: true,
      status: 400,
    },
    {
      name: "persisted-precondition",
      path: anchorPath(),
      body: { instruction: CANARY },
      beginAnchor: () => ({ ok: false, status: "failed", kind: "identity-required", httpStatus: 409 }),
      status: 409,
    },
    {
      name: "persisted-config",
      path: anchorPath(),
      body: { instruction: "" },
      env: { ...env, CONTEST_API_TOKEN: "" },
      status: 500,
    },
  ];
  for (const item of cases) {
    const traced = memoryTrace();
    let calls = 0;
    const store = sessionStore({
      beginAnchor: item.beginAnchor,
    });
    const logs = [];
    const server = createServer({
      migrate: false,
      projectStore: {},
      visualStore: store,
      env: item.env || env,
      logger: { log(line) { logs.push(String(line)); } },
      traceRecorder: traced.recorder,
      imageGenerator: generateImage,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(successPayload()), { status: 200 });
      },
    });
    const port = await listen(server);
    try {
      const response = item.raw
        ? await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: "127.0.0.1",
            port,
            method: "POST",
            path: item.path,
            headers: { "content-type": "application/json", "content-length": 1 },
          }, (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode }));
          });
          req.on("error", reject);
          req.end("{");
        })
        : await request(port, { path: item.path, body: item.body });
      assert.equal(response.status, item.status, item.name);
    } finally {
      await close(server);
    }
    assert.equal(calls, 0, item.name);
    assert.equal(traced.db.rows.size, 0, item.name);
    assert.equal(logs.join("\n").includes(CANARY), false, item.name);
  }
});

test("non-generative anchor actions create no attempt and make no provider call", async () => {
  const traced = memoryTrace();
  let calls = 0;
  const server = createServer({
    migrate: false,
    projectStore: {
      async duplicateProject() {
        return { ok: true, project: { id: PROJECT_ID, title: "Copy 021" } };
      },
    },
    visualStore: sessionStore(),
    env,
    logger: { log() {} },
    traceRecorder: traced.recorder,
    imageGenerator: async () => {
      calls += 1;
      throw new Error("provider was called");
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("provider was called");
    },
  });
  const port = await listen(server);
  const character = encodeURIComponent("Аня");
  const routes = [
    ["POST", `/api/projects/${PROJECT_ID}/visual/characters/${character}/anchor-accept`, {
      provenance: "uploaded_as_ready_anchor",
      imageDataUrl: sourceUrl,
      instruction: "",
    }],
    ["POST", `/api/projects/${PROJECT_ID}/visual/characters/${character}/anchor-retire`, {}],
    ["POST", `/api/projects/${PROJECT_ID}/visual/characters/${character}/anchors/${PENDING_ID}/restore`, {}],
    ["POST", `/api/projects/${PROJECT_ID}/visual/characters/${character}/anchors/${PENDING_ID}/approve`, {}],
    ["POST", `/api/projects/${PROJECT_ID}/visual/characters/${character}/identity`, {
      imageDataUrl: sourceUrl,
      comment: "",
    }],
    ["PATCH", `/api/projects/${PROJECT_ID}/visual/frames/frame-1/panels/0/placement`, { zoom: 1.2 }],
    ["POST", `/api/projects/${PROJECT_ID}/visual/operations`, { op: "assignAsset" }],
    ["POST", `/api/projects/${PROJECT_ID}/visual/operations`, { op: "uploadAsset" }],
    ["POST", `/api/projects/${PROJECT_ID}/visual/operations`, { op: "duplicateFrame" }],
    ["POST", `/api/projects/${PROJECT_ID}/duplicate`, { title: "Copy 021" }],
  ];
  try {
    for (const [method, path, body] of routes) {
      const response = await request(port, { method, path, body });
      assert.equal(response.status >= 200 && response.status < 300, true, `${method} ${path} ${response.status} ${response.body}`);
    }
  } finally {
    await close(server);
  }
  assert.equal(calls, 0);
  assert.equal(traced.db.rows.size, 0);
});
