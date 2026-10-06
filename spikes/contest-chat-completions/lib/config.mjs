export function readLiveConfig(env = process.env) {
  const missing = [];
  const baseUrl = String(env.BASE_URL ?? '').trim();
  const token = String(env.CONTEST_API_TOKEN ?? '').trim();
  const model = String(env.CONTEST_MODEL ?? '').trim();
  if (!baseUrl) missing.push('BASE_URL');
  if (!token) missing.push('CONTEST_API_TOKEN');
  if (!model) missing.push('CONTEST_MODEL');
  if (missing.length > 0) {
    return { live: false, status: 'SKIPPED', missing, reason: 'required live configuration is absent' };
  }

  let timeoutMs = 120_000;
  if (env.CONTEST_TIMEOUT_MS != null && String(env.CONTEST_TIMEOUT_MS).trim() !== '') {
    const parsed = Number(env.CONTEST_TIMEOUT_MS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        live: false,
        status: 'NOT_RUN',
        missing: [],
        reason: 'CONTEST_TIMEOUT_MS must be a positive number',
      };
    }
    timeoutMs = parsed;
  }

  let extraBody = {};
  if (env.CONTEST_REQUEST_JSON != null && String(env.CONTEST_REQUEST_JSON).trim() !== '') {
    try {
      const parsed = JSON.parse(env.CONTEST_REQUEST_JSON);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          live: false,
          status: 'NOT_RUN',
          missing: [],
          reason: 'CONTEST_REQUEST_JSON must be a JSON object',
        };
      }
      extraBody = parsed;
    } catch {
      return {
        live: false,
        status: 'NOT_RUN',
        missing: [],
        reason: 'CONTEST_REQUEST_JSON is not valid JSON',
      };
    }
  }

  return {
    live: true,
    status: 'READY',
    missing: [],
    reason: null,
    baseUrl,
    token,
    model,
    timeoutMs,
    extraBody,
  };
}
