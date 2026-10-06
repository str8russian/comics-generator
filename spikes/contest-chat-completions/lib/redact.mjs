const BEARER = /Bearer\s+\S+/gi;
const SK_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

export function redact(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8 && text.includes(secret)) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  return text.replace(BEARER, 'Bearer [REDACTED]').replace(SK_KEY, '[REDACTED]');
}

export function shorten(value, max = 240) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function redactAndShorten(value, secrets, max = 240) {
  return shorten(redact(value, secrets), max);
}
