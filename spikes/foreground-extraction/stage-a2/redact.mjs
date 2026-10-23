const SENSITIVE_KEY = /authorization|token|secret|password|cookie|api[-_]?key|bearer|credential/i;
const SENSITIVE_ENV = /TOKEN|SECRET|PASSWORD|AUTHORIZATION|API_KEY|ACCESS_KEY/i;

export function secretValuesFromEnv(env = {}) {
  const values = [];
  for (const [key, value] of Object.entries(env || {})) {
    if (!SENSITIVE_ENV.test(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length < 12) continue;
    values.push(trimmed);
  }
  return values;
}

function scrubString(value, secrets) {
  let next = value;
  for (const secret of secrets) {
    if (secret && next.includes(secret)) next = next.split(secret).join("[redacted]");
  }
  if (/bearer\s+\S+/i.test(next)) next = next.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  return next;
}

export function redactValue(value, secrets = []) {
  if (typeof value === "string") return scrubString(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (typeof value === "object") {
    if (Buffer.isBuffer(value)) return undefined;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      if (key === "env" || key === "headers" || key === "serializedBody") continue;
      const redacted = redactValue(child, secrets);
      if (redacted !== undefined) output[key] = redacted;
    }
    return output;
  }
  return undefined;
}
