const DROPPED_EXTRA_KEYS = new Set([
  "model",
  "messages",
  "response_format",
  "reasoning_effort",
  "max_completion_tokens",
  "max_tokens",
]);

function configurationFailure() {
  return { ok: false, httpStatus: 500, status: "failed", kind: "configuration" };
}

function readString(env, key) {
  const value = env[key];
  if (value == null) return "";
  return String(value).trim();
}

function readModel(env, key) {
  return readString(env, key) || readString(env, "CONTEST_MODEL");
}

function readPositiveInt(env, key, fallback) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") return { ok: true, value: fallback };
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

function readOptionalPositiveInt(env, key) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") return { ok: true, value: undefined };
  return readPositiveInt(env, key);
}

function readExtra(env, key) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") return { ok: true, value: {} };
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return { ok: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const value = {};
  for (const [entryKey, entry] of Object.entries(parsed)) {
    if (!DROPPED_EXTRA_KEYS.has(entryKey)) value[entryKey] = entry;
  }
  return { ok: true, value };
}

function validBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  return url.protocol === "http:" || url.protocol === "https:";
}

export function loadConfig(env = process.env) {
  const baseUrl = readString(env, "BASE_URL");
  const token = readString(env, "CONTEST_API_TOKEN");
  const timeout = readPositiveInt(env, "CONTEST_TIMEOUT_MS", 120000);
  const interpretLimit = readOptionalPositiveInt(env, "INTERPRET_MAX_COMPLETION_TOKENS");
  const stageLimit = readOptionalPositiveInt(env, "STAGE_MAX_COMPLETION_TOKENS");
  const interpretExtra = readExtra(env, "INTERPRET_REQUEST_JSON");
  const stageExtra = readExtra(env, "STAGE_REQUEST_JSON");
  const interpretModel = readModel(env, "INTERPRET_MODEL");
  const stageModel = readModel(env, "STAGE_MODEL");

  if (!baseUrl || !validBaseUrl(baseUrl) || !token || !interpretModel || !stageModel) {
    return configurationFailure();
  }
  if (!timeout.ok || !interpretLimit.ok || !stageLimit.ok || !interpretExtra.ok || !stageExtra.ok) {
    return configurationFailure();
  }

  return {
    ok: true,
    baseUrl,
    token,
    timeoutMs: timeout.value,
    interpret: {
      model: interpretModel,
      reasoningEffort: readString(env, "INTERPRET_REASONING_EFFORT") || "low",
      maxCompletionTokens: interpretLimit.value,
      extra: interpretExtra.value,
    },
    stage: {
      model: stageModel,
      reasoningEffort: readString(env, "STAGE_REASONING_EFFORT") || "medium",
      maxCompletionTokens: stageLimit.value,
      extra: stageExtra.value,
    },
  };
}
