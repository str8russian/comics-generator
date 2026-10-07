import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { pageState } from "../overflow.mjs";
import { createServer } from "../server.mjs";

const env = {
  BASE_URL: "https://provider.example.test",
  CONTEST_API_TOKEN: "test-token",
  CONTEST_MODEL: "test-model",
};

function completion(content, finishReason = "stop") {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) },
      finish_reason: finishReason,
    }],
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function post(port, body, headers = { "content-type": "application/json" }) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/storyboard",
      headers: { ...headers, "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

async function withServer(fetchImpl, envOverride = env) {
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: envOverride,
    fetchImpl,
  });
  const port = await listen(server);
  return { port, close: () => close(server) };
}

test("a blocked response has failures, omits frames, and is not ready", () => {
  const httpBody = { status: "blocked", failures: [{ code: "invalid-anchor", sourceItemId: "u" }] };
  const view = pageState({ http: httpBody });
  assert.equal(view.state, "blocked");
  assert.equal(view.ready, false);
  assert.deepEqual(view.codes, ["invalid-anchor"]);
});

test("provider, timeout, and invalid-output are failed rather than blocked", async () => {
  const thrown = await withServer(async () => {
    throw new Error("socket closed");
  });
  try {
    const response = await post(thrown.port, { draft: "Аня: да" });
    assert.equal(response.status, 502);
    const payload = JSON.parse(response.body);
    assert.deepEqual(payload, { status: "failed", kind: "provider" });
    const view = pageState({ http: payload });
    assert.equal(view.state, "failed");
    assert.equal(view.kind, "provider");
    assert.equal(view.ready, false);
  } finally {
    await thrown.close();
  }

  const timed = await withServer((url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hung")), 2000);
    init.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }), { ...env, CONTEST_TIMEOUT_MS: "20" });
  try {
    const response = await post(timed.port, { draft: "Аня: да" });
    assert.equal(response.status, 504);
    const payload = JSON.parse(response.body);
    assert.equal(payload.kind, "timeout");
    assert.equal(pageState({ http: payload }).state, "failed");
    assert.equal(pageState({ http: payload }).kind, "timeout");
  } finally {
    await timed.close();
  }

  const invalid = await withServer(async () => ({
    status: 200,
    headers: { get: () => "application/json" },
    async text() {
      return completion({ sourceItems: [], characters: [], surfaceForms: [] });
    },
  }));
  try {
    const response = await post(invalid.port, { draft: "Аня: да" });
    assert.equal(response.status, 502);
    const payload = JSON.parse(response.body);
    assert.equal(payload.kind, "invalid-output");
    assert.equal(Object.hasOwn(payload, "failures"), false);
    const view = pageState({ http: payload });
    assert.equal(view.state, "failed");
    assert.equal(view.kind, "invalid-output");
    assert.equal(view.ready, false);
  } finally {
    await invalid.close();
  }
});

test("configuration and invalid-request stay distinct failed kinds", async () => {
  const missing = pageState({ http: { status: "failed", kind: "configuration" } });
  assert.equal(missing.state, "failed");
  assert.equal(missing.kind, "configuration");
  assert.equal(missing.ready, false);

  const request = pageState({ http: { status: "failed", kind: "invalid-request" } });
  assert.equal(request.state, "failed");
  assert.equal(request.kind, "invalid-request");
  assert.equal(request.state === "blocked", false);

  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: {},
    fetchImpl: async () => {
      throw new Error("provider was called");
    },
  });
  const port = await listen(server);
  try {
    const response = await post(port, { draft: "Аня: да" });
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "configuration" });
    const malformed = await post(port, "{");
    assert.equal(malformed.status, 400);
    assert.equal(JSON.parse(malformed.body).kind, "invalid-request");
  } finally {
    await close(server);
  }
});

test("a measurement failure is failed measurement and is not ready", () => {
  const view = pageState({ measurementError: true, http: { status: "checked", frames: [{ id: "f1" }] } });
  assert.equal(view.state, "failed");
  assert.equal(view.kind, "measurement");
  assert.equal(view.ready, false);
  const blockedFit = pageState({
    http: { status: "checked", frames: [] },
    fitted: { ok: false, failures: [{ code: "invalid-display-block" }] },
  });
  assert.equal(blockedFit.state, "blocked");
  assert.equal(blockedFit.ready, false);
});
