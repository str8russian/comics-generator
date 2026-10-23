const BEARER = /Bearer\s+\S+/gi;
const SK_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const DATA_URL = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{16,}/g;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

export function redactAndShorten(value, options = {}, max = 240) {
  const secrets = options.secrets ?? [];
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('[REDACTED]');
  }
  text = text.replace(BEARER, 'Bearer [REDACTED]').replace(SK_KEY, '[REDACTED]');
  text = text.replace(DATA_URL, 'data:image;base64,[omitted]');
  text = text.replace(URL_PATTERN, (match) => {
    try {
      return `[url]${new URL(match).pathname}`;
    } catch {
      return '[url]';
    }
  });
  try {
    const base = new URL(options.baseUrl);
    for (const name of [base.host, base.hostname, base.origin]) {
      if (name.length >= 5) text = text.split(name).join('[host]');
    }
  } catch {
    // An invalid base URL is reported by configuration validation.
  }
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
