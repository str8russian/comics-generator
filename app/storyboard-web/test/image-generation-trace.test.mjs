import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import test from "node:test";
import { generateImage } from "../image-provider.mjs";
import {
  createImageGenerationTraceRecorder,
  readImageGenerationAttempts,
} from "../image-generation-trace.mjs";
import { executeImageRequest, serializeImageRequest } from "../image-reference-strategy.mjs";
import { createServer } from "../server.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const PROJECT_ID = "02100000-0000-4000-8000-0000000000a1";
const GENERATION_ID = "02100000-0000-4000-8000-0000000000a2";
const OTHER_GENERATION_ID = "02100000-0000-4000-8000-0000000000a3";
const VERSION_ID = "02100000-0000-4000-8000-0000000000a4";
const CORRELATION_ID = "02100000-0000-4000-8000-0000000000a5";
const ANCHOR_ASSET = "02100000-0000-4000-8000-0000000000b1";
const STYLE_ASSET = "02100000-0000-4000-8000-0000000000b2";
const CURRENT_ASSET = "02100000-0000-4000-8000-0000000000b3";
const PREVIOUS_ASSET = "02100000-0000-4000-8000-0000000000b4";
const CANARY = "CANARY-PROMPT-021";
const TOKEN = "super-secret-token";

const env = {
  BASE_URL: "http://127.0.0.1:9/v1",
  CONTEST_API_TOKEN: TOKEN,
  IMAGE_MODEL: "image-test",
  IMAGE_TIMEOUT_MS: "1000",
  STORYBOARD_BUILD_ID: "build-021",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reference(role, assetId, bytes = png) {
  return { role, assetId, mime: "image/png", bytes, width: 1, height: 1 };
}

function successPayload(usage = { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4, prompt: CANARY }) {
  return {
    choices: [{
      finish_reason: "stop",
      message: {
        content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }],
      },
    }],
    usage,
  };
}

function memoryTrace(options = {}) {
  const rows = new Map();
  const logs = [];
  const queries = [];
  const db = {
    rows,
    logs,
    queries,
    async query(sql, params) {
      const text = sql.replace(/\s+/g, " ").trim();
      queries.push(text);
      if (options.fail === "prepared" && text.startsWith("INSERT")) {
        const error = new Error(`${CANARY} ${TOKEN} data:image/png;base64 exception text`);
        error.code = "23503";
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
        return { rowCount: 1, rows: [{ id: params[0] }] };
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
        row.output_sha256 = params[6];
        row.output_mime = params[7];
        row.output_byte_length = params[8];
        row.output_width = params[9];
        row.output_height = params[10];
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("FROM image_generation_attempt")) {
        const matches = [...rows.values()].filter((row) => {
          if (text.includes("WHERE id =")) return row.id === params[0];
          if (text.includes("WHERE panel_generation_id =")) return row.panel_generation_id === params[0];
          if (text.includes("WHERE correlation_id =")) return row.correlation_id === params[0];
          return false;
        });
        matches.sort((left, right) => String(left.prepared_at).localeCompare(String(right.prepared_at)) || String(left.id).localeCompare(String(right.id)));
        return { rows: matches };
      }
      throw new Error(`unexpected sql: ${text}`);
    },
  };
  const recorder = createImageGenerationTraceRecorder({
    query: db.query.bind(db),
    logger: { log(line) { logs.push(String(line)); } },
    buildId: "build-021",
  });
  return { db, recorder };
}

function context(overrides = {}) {
  return {
    diagnosticId: "7",
    projectId: PROJECT_ID,
    generationKind: "panel",
    actionKind: "panel",
    panelGenerationId: GENERATION_ID,
    storyboardVersionId: VERSION_ID,
    frameId: "frame-1",
    panelId: "panel-1",
    panelIndex: 0,
    correlationId: CORRELATION_ID,
    compilerId: "historical-panel-prompt",
    compilerVersion: "v1",
    upstreamOmissions: [],
    ...overrides,
  };
}

async function runGeneration({
  trace = false,
  recorder = null,
  references = [reference("anchor", ANCHOR_ASSET)],
  generationMode = "initial",
  aspectRatio = "4:5",
  timeoutMs = 1000,
  sourceEnv = env,
  fetchImpl,
  compilePrompt = () => CANARY,
  strategy = "passthrough",
  budgetBytes = 850_000,
  traceContext = context(),
  model = "image-test",
}) {
  return executeImageRequest({
    strategy,
    budgetBytes,
    references,
    generationMode,
    compilePrompt,
    aspectRatio,
    model,
    imageGenerator: generateImage,
    env: sourceEnv,
    fetchImpl,
    timeoutMs,
    traceContext: trace ? traceContext : null,
    traceRecorder: trace ? recorder : null,
  });
}

function comparable(result) {
  const copy = structuredClone({
    ok: result.ok,
    kind: result.kind || null,
    httpStatus: result.httpStatus || null,
    mime: result.image?.mime || null,
    bytes: result.image?.bytes ? result.image.bytes.toString("base64") : null,
    strategy: result.metadata?.strategy || result.diagnostics?.strategy || null,
    referenceRoles: result.diagnostics?.referenceRoles || null,
    requestSha256: result.metadata?.requestSha256 || result.diagnostics?.requestSha256 || null,
    model: result.metadata?.model || null,
    omittedRoles: result.diagnostics?.omittedRoles || null,
  });
  return copy;
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

function request(port, { path, body }) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body ?? {}));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
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

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "test" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

test("production image calls converge on executeImageRequest", () => {
  const root = new URL("..", import.meta.url);
  const files = walk(root.pathname);
  const generatorCalls = [];
  const imageCalls = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (source.includes("imageGenerator(")) generatorCalls.push(file.split("/").at(-1));
    if (source.includes("generateImage(")) imageCalls.push(file.split("/").at(-1));
  }
  assert.deepEqual(generatorCalls, ["image-reference-strategy.mjs"]);
  assert.deepEqual(imageCalls, ["image-provider.mjs"]);
  const strategy = readFileSync(new URL("../image-reference-strategy.mjs", import.meta.url), "utf8");
  assert.equal(strategy.match(/input\.imageGenerator\(/g).length, 1);
  const provider = readFileSync(new URL("../image-provider.mjs", import.meta.url), "utf8");
  const fetchAt = provider.indexOf("fetchImpl(completionsUrl");
  const hookAt = provider.indexOf("beforeProviderIo({");
  assert.equal(fetchAt > hookAt && hookAt > 0, true);
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.equal(server.includes("imageGenerator({"), false);
  assert.equal(server.includes("input.imageGenerator("), false);
});

test("tracing on and off keep the same provider request and product result", async () => {
  const traced = memoryTrace();
  const bodies = { on: [], off: [] };
  const fetchFor = (bucket) => async (_url, init) => {
    bodies[bucket].push(init.body);
    return new Response(JSON.stringify(successPayload()), { status: 200 });
  };
  const references = [reference("anchor", ANCHOR_ASSET), reference("style", STYLE_ASSET)];
  const on = await runGeneration({
    trace: true,
    recorder: traced.recorder,
    references,
    fetchImpl: fetchFor("on"),
    timeoutMs: 640,
  });
  const off = await runGeneration({
    trace: false,
    references,
    fetchImpl: fetchFor("off"),
    timeoutMs: 640,
  });
  assert.equal(bodies.on.length, 1);
  assert.equal(bodies.off.length, 1);
  assert.equal(bodies.on[0], bodies.off[0]);
  assert.equal(sha256(bodies.on[0]), sha256(bodies.off[0]));
  assert.deepEqual(comparable(on), comparable(off));
  assert.equal(on.ok, true);
  const attempts = await readImageGenerationAttempts(traced.db, { attemptId: [...traced.db.rows.keys()][0] });
  assert.equal(attempts.length, 1);
  assert.deepEqual(attempts[0].sentReferences.map((item) => item.role), ["anchor", "style"]);
  assert.equal(attempts[0].model, "image-test");
  assert.equal(attempts[0].aspectRatio, "4:5");
  assert.equal(attempts[0].timeoutMs, 640);
  assert.equal(attempts[0].referenceStrategy, "passthrough");
  assert.equal(attempts[0].requestSha256, sha256(bodies.on[0]));
  assert.equal(attempts[0].prompt, CANARY);
  assert.equal(attempts[0].promptSha256, sha256(CANARY));
  const rendered = JSON.stringify(attempts[0]);
  assert.equal(rendered.includes(TOKEN), false);
  assert.equal(rendered.includes("data:image"), false);
  assert.equal(rendered.includes(png.toString("base64")), false);
  assert.equal(attempts[0].sentReferences[0].sha256, sha256(png));
  assert.equal(attempts[0].sentReferences[0].assetId, ANCHOR_ASSET);
  assert.equal(attempts[0].output.sha256, sha256(png));
  assert.equal(attempts[0].output.mime, "image/png");
  assert.equal(attempts[0].output.byteLength, png.length);
  assert.deepEqual(attempts[0].usage, { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });
  assert.equal(rendered.includes("nested"), false);
});

test("success, provider failure, and timeout record truthful terminal evidence", async () => {
  const cases = [
    {
      name: "success",
      fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
      state: "succeeded",
      outcome: "stop",
      http: 200,
      productHttp: 200,
    },
    {
      name: "provider",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: CANARY } }), { status: 500 }),
      state: "failed",
      outcome: "provider",
      http: 500,
      productHttp: 502,
    },
    {
      name: "payload",
      fetchImpl: async () => new Response("payload", { status: 413 }),
      state: "failed",
      outcome: "provider-payload-too-large",
      http: 413,
      productHttp: 502,
    },
    {
      name: "timeout",
      timeoutMs: 40,
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
      productHttp: 504,
    },
    {
      name: "network",
      fetchImpl: async () => {
        throw new Error(`${CANARY} network down`);
      },
      state: "failed",
      outcome: "provider",
      http: null,
      productHttp: 502,
    },
  ];
  for (const item of cases) {
    const traced = memoryTrace();
    let sawPrepared = false;
    const fetchImpl = async (...args) => {
      const prepared = [...traced.db.rows.values()];
      assert.equal(prepared.length, 1);
      assert.equal(prepared[0].state, "prepared");
      assert.equal(prepared[0].provider_io_started, null);
      assert.equal(prepared[0].terminal_at, null);
      sawPrepared = true;
      return item.fetchImpl(...args);
    };
    const result = await runGeneration({
      trace: true,
      recorder: traced.recorder,
      fetchImpl,
      timeoutMs: item.timeoutMs || 1000,
    });
    assert.equal(sawPrepared, true, item.name);
    const row = [...traced.db.rows.values()][0];
    assert.equal(row.state, item.state, item.name);
    assert.equal(row.outcome_kind, item.outcome, item.name);
    assert.equal(row.http_status, item.http, item.name);
    assert.equal(row.provider_io_started, true, item.name);
    if (!result.ok) assert.equal(result.httpStatus, item.productHttp, item.name);
    assert.equal(result.ok, item.state === "succeeded", item.name);
    const presented = await readImageGenerationAttempts(traced.db, { attemptId: row.id });
    assert.equal(presented[0].providerIoStarted, true, item.name);
    assert.equal(presented[0].providerHttpStatus, item.http, item.name);
    assert.equal(Object.hasOwn(presented[0], "httpStatus"), false, item.name);
    if (item.name !== "success") assert.equal(row.output_sha256, null);
    const log = traced.db.logs.join("\n");
    assert.equal(log.includes(CANARY), false, item.name);
    assert.equal(log.includes("network down"), false, item.name);
  }
});

test("a blocked provider leaves the prepared row readable before release", async () => {
  const traced = memoryTrace();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let during = null;
  const pending = runGeneration({
    trace: true,
    recorder: traced.recorder,
    fetchImpl: async () => {
      during = await readImageGenerationAttempts(traced.db, { panelGenerationId: GENERATION_ID });
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
  assert.equal(during[0].terminalAt, null);
  release();
  const result = await pending;
  assert.equal(result.ok, true);
  const after = await readImageGenerationAttempts(traced.db, { correlationId: CORRELATION_ID });
  assert.equal(after[0].state, "succeeded");
  assert.equal(after[0].providerIoStarted, true);
});

test("trace write failures preserve the product result and do not retry the provider", async () => {
  for (const fail of ["prepared", "terminal"]) {
    const traced = memoryTrace({ fail });
    let calls = 0;
    const result = await runGeneration({
      trace: true,
      recorder: traced.recorder,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(successPayload()), { status: 200 });
      },
    });
    assert.equal(calls, 1, fail);
    assert.equal(result.ok, true, fail);
    assert.equal(result.image.bytes.equals(png), true, fail);
    if (fail === "terminal") {
      const row = [...traced.db.rows.values()][0];
      assert.equal(row.state, "prepared");
      assert.equal(row.provider_io_started, null);
      assert.equal(row.terminal_at, null);
      const presented = await readImageGenerationAttempts(traced.db, { attemptId: row.id });
      assert.equal(presented[0].providerIoStarted, null);
      assert.equal(presented[0].providerHttpStatus, null);
    } else {
      assert.equal(traced.db.rows.size, 0);
    }
    const log = traced.db.logs.join("\n");
    assert.match(log, /event=image-generation-trace/);
    assert.match(log, new RegExp(`stage=${fail === "prepared" ? "prepared" : "terminal"}`));
    for (const secret of [CANARY, TOKEN, "data:image", "exception text", "Bearer"]) {
      assert.equal(log.includes(secret), false, `${fail}:${secret}`);
    }
  }
});

test("strategy and upstream omissions are compact and ordered references keep their asset ids", async () => {
  const anchor = reference("anchor", ANCHOR_ASSET, Buffer.alloc(400, 4));
  const style = reference("style", STYLE_ASSET, Buffer.alloc(400, 5));
  const current = reference("current", CURRENT_ASSET, Buffer.alloc(400, 6));
  anchor.width = 900;
  anchor.height = 700;
  style.width = 900;
  style.height = 700;
  current.width = 900;
  current.height = 700;
  const prompt = "fixed prompt";
  const reduced = serializeImageRequest({
    prompt,
    references: [anchor, current],
    aspectRatio: "5:4",
    model: "image-test",
  });
  const traced = memoryTrace();
  const result = await runGeneration({
    trace: true,
    recorder: traced.recorder,
    references: [anchor, style, current],
    generationMode: "revision",
    strategy: "budgeted",
    budgetBytes: Buffer.byteLength(reduced),
    aspectRatio: "5:4",
    compilePrompt: () => prompt,
    traceContext: context({
      upstreamOmissions: [{ role: "previous", assetId: PREVIOUS_ASSET, reason: "reference-priority" }],
    }),
    fetchImpl: async (_url, init) => {
      assert.equal(init.body, reduced);
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  const row = [...traced.db.rows.values()][0];
  assert.deepEqual(row.sent_references.map((item) => item.role), ["anchor", "current"]);
  assert.equal(row.sent_references[0].assetId, ANCHOR_ASSET);
  assert.equal(row.sent_references[0].sha256, sha256(anchor.bytes));
  assert.deepEqual(row.omissions, [
    { role: "previous", assetId: PREVIOUS_ASSET, reason: "reference-priority" },
    { role: "style", assetId: STYLE_ASSET, reason: "request-budget" },
  ]);
});

test("configuration, invalid request, and payload rejection create no attempt row", async () => {
  const traced = memoryTrace();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("provider was called");
  };
  const shared = {
    trace: true,
    recorder: traced.recorder,
    fetchImpl,
    references: [reference("anchor", ANCHOR_ASSET)],
  };
  const configuration = await runGeneration({
    ...shared,
    sourceEnv: { ...env, CONTEST_API_TOKEN: "" },
  });
  const invalid = await runGeneration({ ...shared, aspectRatio: "1:1" });
  const rejected = await runGeneration({
    ...shared,
    strategy: "budgeted",
    budgetBytes: 80,
    generationMode: "initial",
    references: [reference("anchor", ANCHOR_ASSET, Buffer.alloc(4000, 9))],
    compilePrompt: () => "x",
  });
  assert.equal(configuration.kind, "configuration");
  assert.equal(invalid.kind, "invalid-request");
  assert.equal(rejected.kind, "reference-payload-too-large");
  assert.equal(calls, 0);
  assert.equal(traced.db.rows.size, 0);
  assert.equal(traced.db.logs.length, 0);
});

function panelStore({ frame, generations, refsFor }) {
  let cursor = 0;
  return {
    async load() {
      return {
        ok: true,
        status: "ready",
        frames: [frame],
        characters: [
          { name: "Аня", approvedAnchorId: "anchor-a" },
          { name: "Боря", approvedAnchorId: "anchor-b" },
        ],
        styleSeedAssetId: "style-1",
      };
    },
    async beginPanelGeneration({ panelIndex }) {
      const id = generations[cursor] || generations[0];
      cursor += 1;
      return {
        ok: true,
        id,
        frame,
        panel: frame.panels[panelIndex],
        panelIndex,
        subject: frame.panels[panelIndex].subject,
        instruction: "",
        storyboardVersionId: VERSION_ID,
        refs: refsFor(panelIndex),
      };
    },
    async finishPanelGeneration({ result }) {
      return result?.ok
        ? { ok: true }
        : { ok: false, status: "failed", kind: result?.kind || "provider", httpStatus: result?.httpStatus || 502 };
    },
    async beginAnchor() {
      return {
        ok: true,
        id: "anchor-gen",
        identityComment: "",
        instruction: "",
        identity: reference("identity", ANCHOR_ASSET),
        previous: null,
        style: reference("style", STYLE_ASSET),
      };
    },
    async finishAnchor({ result }) {
      return result?.ok
        ? { ok: true }
        : { ok: false, status: "failed", kind: result?.kind || "provider", httpStatus: result?.httpStatus || 502 };
    },
  };
}

function asset(id) {
  return { id, mime: "image/png", bytes: png, width: 1, height: 1 };
}

test("panel and frame attempts keep server identity and ignore client ids", async () => {
  const traced = memoryTrace();
  const logs = [];
  let calls = 0;
  const historical = {
    id: "frame-historical",
    layout: "single",
    panels: [{ id: "panel-historical", description: "спокойный портрет", subject: "Аня" }],
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: panelStore({
      frame: historical,
      generations: [GENERATION_ID],
      refsFor: () => ({
        anchor: asset(ANCHOR_ASSET),
        previous: asset(PREVIOUS_ASSET),
        performance: asset(CURRENT_ASSET),
        style: asset(STYLE_ASSET),
      }),
    }),
    env,
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
    const response = await request(port, {
      path: `/api/projects/${PROJECT_ID}/visual/frames/frame-historical/panels/0/generate`,
      body: {
        instruction: "не записывать как источник",
        correlationId: CORRELATION_ID,
        projectId: "02100000-0000-4000-8000-00000000ffff",
        frameId: "client-frame",
        panelGenerationId: "02100000-0000-4000-8000-00000000eeee",
      },
    });
    assert.equal(response.status, 200);
    const invalid = await request(port, {
      path: `/api/projects/${PROJECT_ID}/visual/frames/frame-historical/panels/0/generate`,
      body: { correlationId: "not-a-uuid" },
    });
    assert.equal(invalid.status, 200);
    const missing = await request(port, {
      path: `/api/projects/${PROJECT_ID}/visual/frames/frame-historical/panels/0/generate`,
      body: {},
    });
    assert.equal(missing.status, 200);
  } finally {
    await close(server);
  }
  assert.equal(calls, 3);
  const rows = [...traced.db.rows.values()];
  assert.equal(rows.length, 3);
  assert.equal(rows.every((row) => row.generation_kind === "panel" && row.action_kind === "panel"), true);
  assert.equal(rows.every((row) => row.project_id === PROJECT_ID), true);
  assert.equal(rows.every((row) => row.panel_generation_id === GENERATION_ID), true);
  assert.equal(rows[0].correlation_id, CORRELATION_ID);
  assert.equal(rows[1].correlation_id, null);
  assert.equal(rows[2].correlation_id, null);
  assert.equal(rows[0].compiler_id, "historical-panel-prompt");
  assert.equal(rows[0].compiler_version, "v1");
  assert.equal(rows[0].frame_id, "frame-historical");
  assert.equal(rows[0].panel_id, "panel-historical");
  assert.deepEqual(rows[0].omissions, [
    { role: "style", assetId: STYLE_ASSET, reason: "reference-limit" },
  ]);
  assert.deepEqual(rows[0].sent_references.map((item) => item.role), ["anchor", "previous", "performance"]);
  const captured = logs.join("\n");
  for (const secret of [CANARY, TOKEN, "data:image", png.toString("base64"), "не записывать"]) {
    assert.equal(captured.includes(secret), false, secret);
  }
});

test("frame attempts share one correlation and each keeps its own generation", async () => {
  const traced = memoryTrace();
  const frame = {
    id: "frame-ready",
    layout: "split2",
    dialogue: "Привет",
    speakerPanel: 0,
    sourceRole: "utterance",
    panels: [
      { id: "panel-a", description: "поясной план", subject: "Аня" },
      { id: "panel-b", description: "поясной план", subject: "Боря" },
    ],
  };
  let calls = 0;
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: panelStore({
      frame,
      generations: [GENERATION_ID, OTHER_GENERATION_ID],
      refsFor: () => ({
        anchor: asset(ANCHOR_ASSET),
        style: asset(STYLE_ASSET),
        performance: asset(CURRENT_ASSET),
        previous: asset(PREVIOUS_ASSET),
      }),
    }),
    env,
    logger: { log() {} },
    traceRecorder: traced.recorder,
    imageGenerator: generateImage,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    },
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      path: `/api/projects/${PROJECT_ID}/visual/frames/frame-ready/generate`,
      body: { correlationId: CORRELATION_ID, projectId: "client-project" },
    });
    assert.equal(response.status, 200);
  } finally {
    await close(server);
  }
  assert.equal(calls, 2);
  const rows = [...traced.db.rows.values()];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.generation_kind), ["frame-panel", "frame-panel"]);
  assert.deepEqual(rows.map((row) => row.correlation_id), [CORRELATION_ID, CORRELATION_ID]);
  assert.deepEqual(rows.map((row) => row.panel_generation_id), [GENERATION_ID, OTHER_GENERATION_ID]);
  assert.deepEqual(rows.map((row) => row.compiler_id), ["constrained-panel-intent", "constrained-panel-intent"]);
  assert.equal(rows[0].omissions.some((item) => item.role === "previous" && item.reason === "reference-priority"), true);
  assert.equal(rows[0].omissions.some((item) => item.role === "style"), false);
  assert.deepEqual(rows[0].sent_references.map((item) => item.role), ["anchor", "style", "performance"]);
});

test("anchor generation still reaches the provider without an attempt row", async () => {
  const traced = memoryTrace();
  let calls = 0;
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: panelStore({
      frame: { id: "unused", layout: "single", panels: [{ id: "unused", description: "x", subject: "Аня" }] },
      generations: [GENERATION_ID],
      refsFor: () => ({}),
    }),
    env,
    logger: { log() {} },
    traceRecorder: traced.recorder,
    imageGenerator: generateImage,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    },
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      path: `/api/projects/${PROJECT_ID}/visual/characters/${encodeURIComponent("Аня")}/anchor`,
      body: { instruction: "" },
    });
    assert.equal(response.status, 200);
  } finally {
    await close(server);
  }
  assert.equal(calls, 1);
  assert.equal(traced.db.rows.size, 0);
});

test("same-asset style authority is not recorded as an omission", async () => {
  const traced = memoryTrace();
  const frame = {
    id: "frame-shared",
    layout: "single",
    panels: [{ id: "panel-shared", description: "спокойный портрет", subject: "Аня" }],
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: panelStore({
      frame,
      generations: [GENERATION_ID],
      refsFor: () => ({
        anchor: asset(ANCHOR_ASSET),
        previous: null,
        performance: null,
        style: asset(ANCHOR_ASSET),
      }),
    }),
    env,
    logger: { log() {} },
    traceRecorder: traced.recorder,
    imageGenerator: generateImage,
    fetchImpl: async () => new Response(JSON.stringify(successPayload()), { status: 200 }),
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      path: `/api/projects/${PROJECT_ID}/visual/frames/frame-shared/panels/0/generate`,
      body: {},
    });
    assert.equal(response.status, 200);
  } finally {
    await close(server);
  }
  const row = [...traced.db.rows.values()][0];
  assert.deepEqual(row.omissions, []);
  assert.deepEqual(row.sent_references.map((item) => item.role), ["anchor"]);
});
