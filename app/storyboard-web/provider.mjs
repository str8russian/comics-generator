import Ajv from "ajv/dist/2020.js";
import { loadConfig } from "./config.mjs";

function failed(httpStatus, kind) {
  return { ok: false, httpStatus, status: "failed", kind };
}

function completionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    url.pathname = path;
  } else if (path.endsWith("/v1")) {
    url.pathname = `${path}/chat/completions`;
  } else {
    url.pathname = `${path}/v1/chat/completions`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function classifyCompletion(response, schema) {
  if (response.status < 200 || response.status > 299) return failed(502, "provider");

  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    return failed(502, "invalid-output");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return failed(502, "invalid-output");
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!choice || typeof choice !== "object") return failed(502, "invalid-output");
  if (choice.finish_reason !== "stop") return failed(502, "invalid-output");

  let value;
  try {
    value = JSON.parse(choice.message?.content);
  } catch {
    return failed(502, "invalid-output");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failed(502, "invalid-output");
  }

  const validate = new Ajv({ allErrors: true, strict: true }).compile(structuredClone(schema));
  if (!validate(value)) return failed(502, "invalid-output");
  return { ok: true, httpStatus: response.status, value };
}

async function complete(settings, config, { messages, schema, fetchImpl }) {
  const body = {
    ...settings.extra,
    model: settings.model,
    messages,
    response_format: { type: "json_object" },
    reasoning_effort: settings.reasoningEffort,
  };
  if (settings.maxCompletionTokens != null) {
    body.max_completion_tokens = settings.maxCompletionTokens;
  }
  delete body.max_tokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(completionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await classifyCompletion(response, schema);
  } catch {
    return controller.signal.aborted ? failed(504, "timeout") : failed(502, "provider");
  } finally {
    clearTimeout(timer);
  }
}

export function completeInterpret({ messages, schema, env = process.env, fetchImpl = globalThis.fetch }) {
  const config = loadConfig(env);
  if (!config.ok) return Promise.resolve(config);
  return complete(config.interpret, config, { messages, schema, fetchImpl });
}

export function completeStage({ messages, schema, env = process.env, fetchImpl = globalThis.fetch }) {
  const config = loadConfig(env);
  if (!config.ok) return Promise.resolve(config);
  return complete(config.stage, config, { messages, schema, fetchImpl });
}
