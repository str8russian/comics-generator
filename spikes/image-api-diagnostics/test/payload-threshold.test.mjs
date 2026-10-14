import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertValidationOnlyBody,
  buildValidationProbeBody,
  MAX_PAYLOAD_THRESHOLD_REQUESTS,
  minimumValidationBodyBytes,
  runPayloadThreshold,
} from "../lib/payload-threshold.mjs";
import { runLimitCheck, MAX_LIMIT_CHECK_REQUESTS } from "../lib/probe.mjs";
import {
  bindInterrupt,
  createIncrementalReport,
  formatProgressLine,
  HEARTBEAT_INTERVAL_MS,
  postJson,
} from "../lib/transport.mjs";

const MODEL = "image-test-model";
const TOKEN = "super-secret-token";
const HOST = "https://provider.example.test/v1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function response({ status = 400, transportError = null, text = "{}", latencyMs = 7, headers = { server: "fake" } } = {}) {
  return {
    status,
    transportError,
    text,
    latencyMs,
    headers,
    timings: transportError ? { totalMs: latencyMs } : { ttfbMs: 3, totalMs: latencyMs, finishMs: 1 },
  };
}

function assertClean(value, body) {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(rendered.includes(TOKEN), false);
  assert.equal(rendered.includes("provider.example.test"), false);
  assert.equal(rendered.includes("diagnostic_padding"), false);
  assert.equal(rendered.includes("Revise the current"), false);
  assert.equal(rendered.includes("data:image"), false);
  assert.equal(rendered.includes("base64"), false);
  assert.equal(rendered.includes(PNG.toString("base64")), false);
  if (body) assert.equal(rendered.includes(body), false);
  assert.equal(rendered.includes("a".repeat(40)), false);
}

test("validation bodies have exact UTF-8 lengths and carry only padding", () => {
  const minimum = minimumValidationBodyBytes(MODEL);
  for (const target of [minimum, minimum + 1, minimum + 50, minimum + 1000]) {
    const body = buildValidationProbeBody(MODEL, target);
    assert.equal(Buffer.byteLength(body, "utf8"), target);
    const parsed = assertValidationOnlyBody(body);
    assert.equal(parsed.model, MODEL);
    assert.equal(parsed.diagnostic_padding.length, target - minimum);
  }
});

test("UTF-8 model names are included in the exact byte length", () => {
  const model = "модель";
  const minimum = minimumValidationBodyBytes(model);
  const body = buildValidationProbeBody(model, minimum + 7);
  assert.equal(Buffer.byteLength(body, "utf8"), minimum + 7);
  assert.equal(JSON.parse(body).model, model);
  assert.equal(JSON.parse(body).diagnostic_padding, "a".repeat(7));
  assert.equal(Buffer.byteLength(model) > model.length, true);
});

test("too-small targets are rejected locally with zero transport calls", async () => {
  let calls = 0;
  assert.throws(() => buildValidationProbeBody(MODEL, minimumValidationBodyBytes(MODEL) - 1), /minimum/);
  const report = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    lowBytes: 10,
    highBytes: 20,
    send: async () => {
      calls += 1;
      return response();
    },
  });
  assert.equal(calls, 0);
  assert.equal(report.requestsAttempted, 0);
  assert.equal(report.exactBoundaryConfirmed, false);
  assert.equal(report.status, "inconclusive");
});

test("probe bodies cannot request image generation", () => {
  const source = readFileSync(new URL("../lib/payload-threshold.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("buildImageRequest"), false);
  assert.equal(source.includes("image-provider"), false);
  const body = buildValidationProbeBody(MODEL, 700_000);
  const parsed = assertValidationOnlyBody(body);
  assert.deepEqual(Object.keys(parsed).sort(), ["diagnostic_padding", "model"]);
  for (const marker of ["messages", "image_url", "modalities", "data:", "prompt", "image_config"]) {
    assert.equal(body.includes(marker), false, marker);
  }
});

test("baseline failure, unexpected success, and inconclusive transport stop the scan", async () => {
  const cases = [
    [{ status: 500 }, "baseline-failed"],
    [{ status: 200, text: "not-an-image" }, "unexpected-success"],
    [{ status: 401 }, "baseline-failed"],
    [{ status: 403 }, "baseline-failed"],
    [{ status: 429 }, "baseline-failed"],
    [{ status: 503 }, "baseline-failed"],
    [{ status: 0, transportError: "timeout" }, "baseline-failed"],
    [{ status: 0, transportError: "abort" }, "baseline-failed"],
    [{ status: 0, transportError: "network" }, "baseline-failed"],
    [{ status: 0, transportError: "dns" }, "baseline-failed"],
    [{ status: 400, text: "data:image/png;base64,AAAA" }, "baseline-failed"],
  ];
  for (const [payload, reason] of cases) {
    let calls = 0;
    const report = await runPayloadThreshold({
      model: MODEL,
      baseUrl: HOST,
      token: TOKEN,
      timeoutMs: 1000,
      lowBytes: 800,
      highBytes: 1600,
      send: async () => {
        calls += 1;
        return response(payload);
      },
    });
    assert.equal(calls, 1, reason);
    assert.equal(report.status, "inconclusive", reason);
    assert.equal(report.exactBoundaryConfirmed, false, reason);
    assert.equal(report.conclusion.includes(reason), true, reason);
    assertClean(report);
  }
});

test("a deterministic threshold converges to adjacent confirmed byte values", async () => {
  const bodies = [];
  const report = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 180000,
    lowBytes: 800,
    highBytes: 1600,
    send: async (_url, request) => {
      bodies.push(request.body);
      assertValidationOnlyBody(request.body);
      const size = Buffer.byteLength(request.body);
      return response({ status: size >= 1200 ? 413 : 400, text: `SECRET-RESPONSE ${TOKEN}` });
    },
  });
  assert.equal(report.exactBoundaryConfirmed, true);
  assert.equal(report.status, "complete");
  assert.equal(report.largestNon413BodyBytes, 1199);
  assert.equal(report.smallest413BodyBytes, 1200);
  assert.equal(report.confirmationCount, 2);
  assert.equal(report.requestsAttempted <= MAX_PAYLOAD_THRESHOLD_REQUESTS, true);
  assert.deepEqual(report.confirmationObservations.map((item) => item.targetBytes), [1199, 1200]);
  assertClean(report);
  assert.equal(JSON.stringify(report).includes("SECRET-RESPONSE"), false);
});

test("boundary confirmation is required and an inconsistent confirmation stays inconclusive", async () => {
  const seen = new Map();
  const report = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    lowBytes: 800,
    highBytes: 801,
    send: async (_url, request) => {
      const size = Buffer.byteLength(request.body);
      const count = (seen.get(size) || 0) + 1;
      seen.set(size, count);
      const rejected = count > 1 ? size < 801 : size >= 801;
      return response({ status: rejected ? 413 : 400 });
    },
  });
  assert.equal(report.exactBoundaryConfirmed, false);
  assert.equal(report.status, "inconclusive");
  assert.equal(Object.hasOwn(report, "largestNon413BodyBytes"), false);
  assert.equal(Object.hasOwn(report, "smallest413BodyBytes"), false);
  assert.equal(report.conclusion.includes("inconsistent-confirmation"), true);
  assert.equal(seen.get(800) > 1, true);
});

test("an accepted ceiling is recorded and upward progress keeps the target inside the range", async () => {
  const ranges = [];
  const report = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    lowBytes: 1000,
    highBytes: 1500,
    ceiling: 3000,
    onProgress: (event) => {
      if (event.type === "before-request") ranges.push([event.rangeLow, event.targetBytes, event.rangeHigh]);
    },
    send: async () => response({ status: 400 }),
  });
  assert.equal(report.status, "inconclusive");
  assert.equal(report.conclusion.includes("no-rejected-size"), true);
  assert.equal(report.lowerAcceptedBodyBytes, 3000);
  assert.equal(report.upperRejectedBodyBytes, null);
  assert.equal(report.exactBoundaryConfirmed, false);
  assert.equal(ranges.length > 0, true);
  for (const [low, target, high] of ranges) {
    assert.equal(low <= target && target <= high, true, `${low}..${high} target ${target}`);
  }
});

test("the hard request cap cannot be exceeded", async () => {
  let calls = 0;
  const report = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    lowBytes: 800,
    highBytes: 1600,
    maxRequests: 3,
    send: async (_url, request) => {
      calls += 1;
      if (calls > 3) throw new Error("cap exceeded");
      const size = Buffer.byteLength(request.body);
      return response({ status: size >= 1200 ? 413 : 400 });
    },
  });
  assert.equal(calls, 3);
  assert.equal(report.requestsAttempted, 3);
  assert.equal(report.exactBoundaryConfirmed, false);
  assert.equal(report.reason === undefined || report.conclusion.includes("request-cap"), true);
  assert.equal(report.conclusion.includes("request-cap"), true);

  let blocked = 0;
  const none = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    lowBytes: 800,
    highBytes: 1600,
    maxRequests: 0,
    send: async () => {
      blocked += 1;
      return response();
    },
  });
  assert.equal(blocked, 0);
  assert.equal(none.requestsAttempted, 0);
});

test("limit-check still sends the control before the legacy body and stops at two calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "image-api-spike-"));
  for (const scale of ["full", "600"]) {
    mkdirSync(join(root, scale), { recursive: true });
    for (const role of ["anchor", "style", "current"]) writeFileSync(join(root, scale, `${role}.png`), PNG);
  }
  const events = [];
  const snapshots = [];
  let calls = 0;
  const report = await runLimitCheck({
    config: { baseUrl: HOST, token: TOKEN, model: MODEL, timeoutMs: 1000 },
    fixtureRoot: root,
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    onProgress: (event) => {
      events.push(event);
      assert.equal(JSON.stringify(event).includes("Revise the current"), false);
      assert.equal(JSON.stringify(event).includes(TOKEN), false);
    },
    onObservation: (snapshot) => snapshots.push(snapshot.requestsAttempted),
    send: async () => {
      calls += 1;
      if (calls > MAX_LIMIT_CHECK_REQUESTS) throw new Error("third limit-check call");
      return calls === 1
        ? { status: 200, headers: {}, text: JSON.stringify({ choices: [{ message: { content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } }] } }] }), latencyMs: 4, transportError: null }
        : { status: 413, headers: {}, text: "{}", latencyMs: 4, transportError: null };
    },
  });
  assert.equal(calls, 2);
  assert.equal(report.verdict, "legacy-rejected");
  assert.deepEqual(report.observations.map((item) => item.roles), [
    ["anchor", "current"],
    ["anchor", "style", "current"],
  ]);
  assert.deepEqual(events.filter((event) => event.type === "before-request").map((event) => event.index), [1, 2]);
  assert.equal(events[0].total, 2);
  assert.deepEqual(snapshots, [1, 2, 2]);
  const line = formatProgressLine(events[0]);
  assert.match(line, /^\[1\/2\] control-anchor-current-600 roles=anchor\+current count=2 body=\d+ sha256=[0-9a-f]{12} timeout=1000ms\n$/);
  assertClean(line);
});

test("lifecycle progress is ordered and heartbeat timers clear without real waits", async () => {
  const kinds = ["success", "payload", "timeout", "abort", "network"];
  for (const kind of kinds) {
    const events = [];
    const timers = [];
    const clears = [];
    let clock = 1_000;
    const result = await postJson("https://provider.example.test/v1/chat/completions", {
      token: TOKEN,
      body: buildValidationProbeBody(MODEL, minimumValidationBodyBytes(MODEL)),
      timeoutMs: 180000,
      now: () => clock,
      heartbeatMs: HEARTBEAT_INTERVAL_MS,
      setTimer(fn, ms) {
        const handle = { fn, ms };
        timers.push(handle);
        return handle;
      },
      clearTimer(handle) {
        clears.push(handle);
      },
      onEvent: (event) => events.push(event.type),
      requestImpl(_options, callback) {
        const req = new EventEmitter();
        const socket = new EventEmitter();
        req.destroy = (error) => req.emit("error", error || Object.assign(new Error("abort"), { name: "AbortError" }));
        req.end = () => {
          queueMicrotask(() => {
            req.emit("socket", socket);
            socket.emit("lookup", null, "203.0.113.9", 4, "provider.example.test");
            socket.emit("connect");
            socket.emit("secureConnect");
            clock = 1_200;
            req.emit("finish");
            timers[0].fn();
            clock = 11_200;
            if (kind === "timeout") req.emit("timeout");
            else if (kind === "abort") req.destroy(Object.assign(new Error("abort"), { name: "AbortError" }));
            else if (kind === "network") req.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" }));
            else {
              const res = new EventEmitter();
              res.statusCode = kind === "payload" ? 413 : 400;
              res.headers = { server: "fake", "set-cookie": TOKEN };
              callback(res);
              res.emit("end");
            }
          });
        };
        return req;
      },
    });
    assert.deepEqual(events.slice(0, 6), ["request-created", "socket", "dns", "tcp", "tls", "request-finish"]);
    assert.equal(events.includes("heartbeat"), true, kind);
    assert.equal(timers.length, 1, kind);
    assert.equal(timers[0].ms, 5000, kind);
    assert.equal(clears.length, 1, kind);
    assert.equal(clears[0], timers[0], kind);
    if (kind === "success" || kind === "payload") {
      assert.deepEqual(events.slice(6), ["heartbeat", "response-headers", "response-complete"]);
      assert.equal(result.transportError, null);
      assert.equal(result.timings.ttfbMs, 10200);
    } else {
      assert.equal(events.at(-1), kind === "network" ? "network-failure" : kind);
      assert.equal(result.transportError, kind === "network" ? "network" : kind);
    }
    assert.equal(JSON.stringify(events).includes(TOKEN), false);
    assert.equal(JSON.stringify(result.headers).includes(TOKEN), false);
  }
});

test("formatted progress and saved reports omit secrets, padding, prompts, and image data", async () => {
  const poisoned = formatProgressLine({
    type: "before-request",
    index: 1,
    total: 64,
    id: "binary-search",
    rangeLow: 700000,
    rangeHigh: 1400000,
    targetBytes: 1048576,
    byteLength: 1048576,
    sha256Prefix: "0123456789ab",
    timeoutMs: 180000,
    token: TOKEN,
    body: "a".repeat(80),
    prompt: "Revise the current character",
    url: HOST,
  });
  assert.match(poisoned, /^\[1\/64\] binary-search range=700000\.\.1400000 target=1048576 body=1048576 sha256=0123456789ab timeout=180000ms\n$/);
  assert.equal(formatProgressLine({ type: "heartbeat", index: 1, total: 2, elapsedMs: 10200 }), "[1/2 +10.2s] Still waiting for response\n");
  assertClean(poisoned);

  const lines = [];
  const report = await runPayloadThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    lowBytes: 800,
    highBytes: 801,
    onProgress: (event) => lines.push(formatProgressLine(event)),
    send: async (_url, request) => response({
      status: Buffer.byteLength(request.body) >= 801 ? 413 : 400,
      headers: { server: TOKEN },
      text: `data:image/png;base64,${PNG.toString("base64")} ${TOKEN}`,
    }),
  });
  assertClean(lines.join("\n"));
  assertClean(report);
  assert.equal(report.observations[0].headers.server.includes(TOKEN), false);
});

test("reports persist after observations and an interrupt keeps the partial result", () => {
  const resultsDir = mkdtempSync(join(tmpdir(), "payload-threshold-report-"));
  const store = createIncrementalReport({
    resultsDir,
    filename: "payload-threshold-report.json",
    initial: { spike: "image-api-diagnostics-payload-threshold", status: "running", observations: [] },
    nowIso: () => "2026-10-14T12:00:00.000Z",
  });
  store.save({
    requestsAttempted: 1,
    status: "running",
    observations: [{ purpose: "baseline", targetBytes: 4096, httpStatus: 400, classification: "size-accepted-validation-rejection" }],
  });
  let exitCode = null;
  let handler = null;
  bindInterrupt(() => store.save({ status: "interrupted" }), {
    subscribe(_event, saved) {
      handler = saved;
    },
    exit(code) {
      exitCode = code;
    },
  });
  handler();
  const saved = JSON.parse(readFileSync(store.path, "utf8"));
  assert.equal(saved.status, "interrupted");
  assert.equal(saved.requestsAttempted, 1);
  assert.equal(saved.observations[0].purpose, "baseline");
  assert.equal(saved.lastUpdatedAt, "2026-10-14T12:00:00.000Z");
  assert.equal(exitCode, 130);
  assert.equal(readdirSync(resultsDir).some((name) => name.endsWith(".tmp")), false);
  assertClean(saved);
});
