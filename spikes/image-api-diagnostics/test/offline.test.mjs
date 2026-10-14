import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runLimitCheck,
  runMatrix,
  runThresholdConfirmation,
  runUnderLimit,
  sha256,
  MAX_LIMIT_CHECK_REQUESTS,
  MAX_LIVE_REQUESTS,
  MAX_THRESHOLD_REQUESTS,
  MAX_UNDER_LIMIT_REQUESTS,
} from "../lib/probe.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const IMAGE_RESPONSE = JSON.stringify({
  choices: [{
    message: {
      content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } }],
    },
  }],
});

function fixtures() {
  const root = mkdtempSync(join(tmpdir(), "image-api-spike-"));
  for (const scale of ["full", "1024", "768", "740", "600"]) {
    const dir = join(root, scale);
    mkdirSync(dir, { recursive: true });
    for (const role of ["anchor", "style", "current"]) writeFileSync(join(dir, `${role}.png`), PNG);
  }
  return root;
}

const config = {
  baseUrl: "https://provider.example.test/v1",
  token: "not-a-real-token",
  model: "image-test-model",
  timeoutMs: 1000,
};

test("matrix reproduces 413 and tests smaller three-reference fixtures without retries", async () => {
  const statuses = [200, 200, 200, 413, 200];
  const calls = [];
  const send = async (_url, request) => {
    calls.push(request);
    const status = statuses[calls.length - 1];
    return {
      status,
      headers: { server: "fake" },
      text: status === 200 ? IMAGE_RESPONSE : JSON.stringify({ error: { type: "payload", code: "too_large", message: "payload too large" } }),
      latencyMs: 1,
      transportError: null,
    };
  };
  const report = await runMatrix({ config, fixtureRoot: fixtures(), resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")), send });
  assert.equal(report.requestsAttempted, 5);
  assert.deepEqual(report.observations.map((item) => item.id), [
    "health-no-refs",
    "initial-anchor-style-full",
    "revision-anchor-current-full",
    "revision-three-full",
    "revision-three-1024",
  ]);
  assert.equal(report.observations[3].response.error.code, "too_large");
  assert.equal(calls.length <= MAX_LIVE_REQUESTS, true);
});

test("health failure stops the live matrix after one call", async () => {
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { status: 503, headers: {}, text: JSON.stringify({ error: { message: "unavailable" } }), latencyMs: 1, transportError: null };
  };
  const report = await runMatrix({ config, fixtureRoot: fixtures(), resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")), send });
  assert.equal(calls, 1);
  assert.equal(report.stopped, "health-failed");
});

test("request evidence is deterministic and excludes prompt, token, host, and image bytes", async () => {
  const report = await runMatrix({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async () => ({ status: 200, headers: {}, text: IMAGE_RESPONSE, latencyMs: 1, transportError: null }),
  });
  const rendered = JSON.stringify(report);
  assert.equal(rendered.includes(config.token), false);
  assert.equal(rendered.includes("provider.example.test"), false);
  assert.equal(rendered.includes("Generate a simple"), false);
  assert.equal(rendered.includes(PNG.toString("base64")), false);
  assert.match(report.observations[0].request.sha256, /^[0-9a-f]{64}$/);
  assert.equal(sha256("same"), sha256("same"));
});

test("provider errors redact configured secrets and provider coordinates", async () => {
  const report = await runMatrix({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async () => ({
      status: 413,
      headers: {},
      text: JSON.stringify({ error: { message: `${config.token} ${config.baseUrl} provider.example.test` } }),
      latencyMs: 1,
      transportError: null,
    }),
  });
  const rendered = JSON.stringify(report);
  assert.equal(rendered.includes(config.token), false);
  assert.equal(rendered.includes("provider.example.test"), false);
});

function imageResponse() {
  return { status: 200, headers: {}, text: IMAGE_RESPONSE, latencyMs: 1, transportError: null };
}

test("live matrix stops at six calls when every reference request is rejected", async () => {
  let calls = 0;
  const send = async () => {
    calls += 1;
    if (calls > MAX_LIVE_REQUESTS) throw new Error("seventh live call");
    if (calls === 1) return imageResponse();
    return { status: 413, headers: {}, text: JSON.stringify({ error: { message: "payload too large" } }), latencyMs: 1, transportError: null };
  };
  const report = await runMatrix({ config, fixtureRoot: fixtures(), resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")), send });
  assert.equal(calls, MAX_LIVE_REQUESTS);
  assert.equal(report.requestsAttempted, MAX_LIVE_REQUESTS);
});

test("under-limit check makes exactly one call", async () => {
  let calls = 0;
  const report = await runUnderLimit({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async () => {
      calls += 1;
      if (calls > MAX_UNDER_LIMIT_REQUESTS) throw new Error("second under-limit call");
      return imageResponse();
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.requestsAttempted, MAX_UNDER_LIMIT_REQUESTS);
  assert.deepEqual(report.observations[0].roles, ["anchor", "current"]);
});

test("limit-check stops after a failed control and does not send the legacy probe", async () => {
  let calls = 0;
  const report = await runLimitCheck({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async () => {
      calls += 1;
      if (calls > 1) throw new Error("legacy probe was sent after control failure");
      return { status: 503, headers: {}, text: JSON.stringify({ error: { message: `${config.token} provider.example.test` } }), latencyMs: 1, transportError: null };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.requestsAttempted, 1);
  assert.equal(report.stopped, "control-failed");
  assert.equal(report.verdict, "provider-unhealthy");
  assert.equal(JSON.stringify(report).includes(config.token), false);
  assert.equal(JSON.stringify(report).includes("provider.example.test"), false);
});

test("limit-check sends the legacy body only after a successful control and stays within two calls", async () => {
  const statuses = [200, 413];
  const calls = [];
  const report = await runLimitCheck({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async () => {
      calls.push(statuses[calls.length] ?? 500);
      if (calls.length > MAX_LIMIT_CHECK_REQUESTS) throw new Error("third limit-check call");
      const status = calls.at(-1);
      return {
        status,
        headers: {},
        text: status === 200 ? IMAGE_RESPONSE : JSON.stringify({ error: { message: "payload too large" } }),
        latencyMs: 1,
        transportError: null,
      };
    },
  });
  assert.equal(report.requestsAttempted, 2);
  assert.equal(report.verdict, "legacy-rejected");
  assert.deepEqual(report.observations.map((item) => item.roles), [
    ["anchor", "current"],
    ["anchor", "style", "current"],
  ]);
  assert.equal(JSON.stringify(report).includes("Generate"), false);
  assert.equal(JSON.stringify(report).includes(PNG.toString("base64")), false);
});

test("limit-check reports a relaxed gateway only when both calls succeed", async () => {
  const report = await runLimitCheck({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async () => imageResponse(),
  });
  assert.equal(report.requestsAttempted, MAX_LIMIT_CHECK_REQUESTS);
  assert.equal(report.verdict, "limit-relaxed");
});

test("threshold confirmation makes exactly two calls with the approved role sets", async () => {
  const calls = [];
  const report = await runThresholdConfirmation({
    config,
    fixtureRoot: fixtures(),
    resultsDir: mkdtempSync(join(tmpdir(), "image-api-results-")),
    send: async (_url, request) => {
      calls.push(request);
      return { status: 200, headers: {}, text: IMAGE_RESPONSE, latencyMs: 1, transportError: null };
    },
  });
  assert.equal(report.requestsAttempted, MAX_THRESHOLD_REQUESTS);
  assert.equal(calls.length, 2);
  assert.deepEqual(report.observations.map((item) => item.roles), [
    ["anchor", "current"],
    ["anchor", "style", "current"],
  ]);
});
