import assert from "node:assert/strict";
import test from "node:test";
import { completeInterpret, completeStage } from "../provider.mjs";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { const: true } },
};

const messages = [
  { role: "system", content: "system text supplied by the caller" },
  { role: "user", content: "{\"segments\":[]}" },
];

function baseEnv(overrides = {}) {
  return {
    BASE_URL: "https://api.example.test",
    CONTEST_API_TOKEN: "test-token",
    CONTEST_MODEL: "contest-model",
    ...overrides,
  };
}

function completionEnvelope(content, finishReason = "stop") {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: finishReason,
    }],
  });
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    async text() {
      return body;
    },
  };
}

async function capture(env, response, fn = completeInterpret) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (typeof response === "function") return response(url, init, calls);
    return response;
  };
  const result = await fn({ messages, schema, env, fetchImpl });
  return { calls, result };
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

test("serializes one json_object chat completion for Interpret and Stage", async () => {
  const ok = jsonResponse(200, completionEnvelope("{\"ok\":true}"));
  const interpret = await capture(baseEnv({
    INTERPRET_MODEL: "interpret-model",
    INTERPRET_REASONING_EFFORT: "low",
  }), ok);
  const stage = await capture(baseEnv({
    STAGE_MODEL: "stage-model",
    STAGE_REASONING_EFFORT: "medium",
  }), ok, completeStage);

  assert.equal(interpret.calls.length, 1);
  assert.equal(stage.calls.length, 1);
  for (const call of [interpret.calls[0], stage.calls[0]]) {
    assert.equal(call.init.method, "POST");
    assert.equal(new URL(call.url).pathname, "/v1/chat/completions");
    assert.equal(call.init.headers.Authorization, "Bearer test-token");
    assert.equal(bodyOf(call).response_format.type, "json_object");
    assert.deepEqual(bodyOf(call).messages, messages);
  }
  assert.equal(interpret.result.ok, true);
  assert.deepEqual(interpret.result.value, { ok: true });
  assert.equal(stage.result.ok, true);
});

test("uses each function model or CONTEST_MODEL and the default reasoning effort", async () => {
  const ok = jsonResponse(200, completionEnvelope("{\"ok\":true}"));
  const interpretSpecific = await capture(baseEnv({ INTERPRET_MODEL: "interpret-model" }), ok);
  const interpretFallback = await capture(baseEnv({ INTERPRET_MODEL: "  " }), ok);
  const stageSpecific = await capture(baseEnv({ STAGE_MODEL: "stage-model" }), ok, completeStage);
  const stageFallback = await capture(baseEnv(), ok, completeStage);

  assert.equal(bodyOf(interpretSpecific.calls[0]).model, "interpret-model");
  assert.equal(bodyOf(interpretSpecific.calls[0]).reasoning_effort, "low");
  assert.equal(bodyOf(interpretFallback.calls[0]).model, "contest-model");
  assert.equal(bodyOf(interpretFallback.calls[0]).reasoning_effort, "low");
  assert.equal(bodyOf(stageSpecific.calls[0]).model, "stage-model");
  assert.equal(bodyOf(stageSpecific.calls[0]).reasoning_effort, "medium");
  assert.equal(bodyOf(stageFallback.calls[0]).model, "contest-model");
  assert.equal(bodyOf(stageFallback.calls[0]).reasoning_effort, "medium");
});

test("sends max_completion_tokens only for the function whose limit is set", async () => {
  const ok = jsonResponse(200, completionEnvelope("{\"ok\":true}"));
  const interpret = await capture(baseEnv({ INTERPRET_MAX_COMPLETION_TOKENS: "400" }), ok);
  const stage = await capture(baseEnv({
    INTERPRET_MAX_COMPLETION_TOKENS: "400",
    STAGE_MAX_COMPLETION_TOKENS: "800",
  }), ok, completeStage);
  const unlimited = await capture(baseEnv(), ok, completeStage);

  assert.equal(bodyOf(interpret.calls[0]).max_completion_tokens, 400);
  assert.equal(bodyOf(interpret.calls[0]).max_tokens, undefined);
  assert.equal(bodyOf(stage.calls[0]).max_completion_tokens, 800);
  assert.equal(bodyOf(stage.calls[0]).max_tokens, undefined);
  assert.equal(Object.hasOwn(bodyOf(unlimited.calls[0]), "max_completion_tokens"), false);
  assert.equal(Object.hasOwn(bodyOf(unlimited.calls[0]), "max_tokens"), false);
});

test("does not read CONTEST_REQUEST_JSON and drops protected extra keys", async () => {
  const seen = new Set();
  const env = new Proxy(baseEnv({
    CONTEST_REQUEST_JSON: "{\"temperature\":1,\"model\":\"hijack\"}",
    INTERPRET_REQUEST_JSON: "{\"temperature\":0.2,\"model\":\"hijack\",\"messages\":[],\"response_format\":{\"type\":\"text\"},\"reasoning_effort\":\"high\",\"max_completion_tokens\":9,\"max_tokens\":3,\"extra_probe\":true}",
    INTERPRET_MAX_COMPLETION_TOKENS: "400",
  }), {
    get(target, prop, receiver) {
      if (typeof prop === "string") seen.add(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  const { calls, result } = await capture(env, jsonResponse(200, completionEnvelope("{\"ok\":true}")));
  const body = bodyOf(calls[0]);
  assert.equal(result.ok, true);
  assert.equal(seen.has("CONTEST_REQUEST_JSON"), false);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.extra_probe, true);
  assert.equal(body.model, "contest-model");
  assert.deepEqual(body.messages, messages);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.max_completion_tokens, 400);
  assert.equal(body.max_tokens, undefined);
});

test("classifies timeout, thrown fetch, and non-2xx as provider failures without retry", async () => {
  const timeout = await capture(baseEnv({ CONTEST_TIMEOUT_MS: "20" }), (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hung")), 2000);
    init.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));
  assert.equal(timeout.result.httpStatus, 504);
  assert.equal(timeout.result.status, "failed");
  assert.equal(timeout.result.kind, "timeout");
  assert.equal(timeout.calls.length, 1);

  let thrownCalls = 0;
  const thrown = await capture(baseEnv(), () => {
    thrownCalls += 1;
    throw new Error("socket closed");
  });
  assert.equal(thrown.result.httpStatus, 502);
  assert.equal(thrown.result.kind, "provider");
  assert.equal(thrownCalls, 1);

  const denied = await capture(baseEnv(), jsonResponse(401, "{\"error\":\"no\"}"));
  assert.equal(denied.result.httpStatus, 502);
  assert.equal(denied.result.kind, "provider");
  assert.equal(denied.calls.length, 1);
});

test("classifies unusable completions as invalid-output and does not continue", async () => {
  const cases = [
    [JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), "missing finish_reason"],
    [completionEnvelope("{\"ok\":true}", "length"), "length"],
    [completionEnvelope("{\"ok\":true}", "content_filter"), "other"],
    [completionEnvelope("[]"), "array"],
    [completionEnvelope("not json"), "unparsed"],
    [completionEnvelope("```json\n{\"ok\":true}\n```"), "markdown"],
    [completionEnvelope("{\"ok\":false}"), "schema"],
    [JSON.stringify({ choices: [] }), "no choice"],
    ["not-json", "envelope"],
  ];
  for (const [body, label] of cases) {
    const { calls, result } = await capture(baseEnv(), jsonResponse(200, body));
    assert.equal(result.httpStatus, 502, label);
    assert.equal(result.status, "failed", label);
    assert.equal(result.kind, "invalid-output", label);
    assert.equal(calls.length, 1, label);
  }
});

test("does not call fetch when required configuration is missing", async () => {
  let calls = 0;
  const result = await completeStage({
    messages,
    schema,
    env: { BASE_URL: "https://api.example.test", CONTEST_API_TOKEN: "test-token" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("fetch should not run");
    },
  });
  assert.equal(result.httpStatus, 500);
  assert.equal(result.status, "failed");
  assert.equal(result.kind, "configuration");
  assert.equal(calls, 0);
});
