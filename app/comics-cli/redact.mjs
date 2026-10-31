const ASSIGNMENT = /\b(?:PGPASSWORD|DATABASE_URL|CONTEST_API_TOKEN|token|password|secret)=[^\s]+/gi;
const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s'"]+/gi;

export function secretsFromEnv(env = {}) {
  const secrets = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length < 12) continue;
    if (/(token|password|secret|url)/i.test(key) || value.includes("://")) secrets.push(value);
  }
  return secrets;
}

export function redact(text, secrets = []) {
  let output = String(text ?? "");
  const values = secrets.filter((value) => typeof value === "string" && value.length >= 12);
  values.sort((left, right) => right.length - left.length);
  for (const secret of values) output = output.split(secret).join("[redacted]");
  output = output.replace(POSTGRES_URL, "[redacted]");
  output = output.replace(ASSIGNMENT, "[redacted]");
  return output;
}
