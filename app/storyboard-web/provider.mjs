import Ajv from "ajv/dist/2020.js";
import { loadConfig } from "./config.mjs";

function failed(httpStatus, kind) {
  return { ok: false, httpStatus, status: "failed", kind };
}

function schemaIssues(errors) {
  if (!Array.isArray(errors)) return [];
  const issues = [];
  for (const error of errors) {
    if (!error || typeof error.keyword !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(error.keyword)) continue;
    const rawPath = typeof error.instancePath === "string" ? error.instancePath : "";
    if (rawPath !== "" && !/^\/[A-Za-z0-9/_-]*$/.test(rawPath)) continue;
    issues.push({ instancePath: rawPath || "/", keyword: error.keyword });
    if (issues.length === 8) break;
  }
  return issues;
}

function withDiagnostics(result, diagnostics = {}) {
  const clean = {};
  if (Number.isInteger(diagnostics.providerStatus) && diagnostics.providerStatus >= 100 && diagnostics.providerStatus <= 599) {
    clean.providerStatus = diagnostics.providerStatus;
  }
  if (typeof diagnostics.finishReason === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(diagnostics.finishReason)) {
    clean.finishReason = diagnostics.finishReason;
  }
  if (Array.isArray(diagnostics.schemaIssues) && diagnostics.schemaIssues.length > 0) {
    clean.schemaIssues = diagnostics.schemaIssues;
  }
  if (Object.keys(clean).length === 0) return result;
  return { ...result, diagnostics: clean };
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
  const observed = { providerStatus: response.status };
  if (response.status < 200 || response.status > 299) return withDiagnostics(failed(502, "provider"), observed);

  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    return withDiagnostics(failed(502, "invalid-output"), observed);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return withDiagnostics(failed(502, "invalid-output"), observed);
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!choice || typeof choice !== "object") return withDiagnostics(failed(502, "invalid-output"), observed);
  observed.finishReason = choice.finish_reason;
  if (choice.finish_reason !== "stop") return withDiagnostics(failed(502, "invalid-output"), observed);

  let value;
  try {
    value = JSON.parse(choice.message?.content);
  } catch {
    return withDiagnostics(failed(502, "invalid-output"), observed);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return withDiagnostics(failed(502, "invalid-output"), observed);
  }

  const validate = new Ajv({ allErrors: true, strict: true }).compile(structuredClone(schema));
  if (!validate(value)) {
    observed.schemaIssues = schemaIssues(validate.errors);
    return withDiagnostics(failed(502, "invalid-output"), observed);
  }
  return withDiagnostics({ ok: true, httpStatus: response.status, value }, observed);
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
