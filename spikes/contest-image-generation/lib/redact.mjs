const BEARER = /Bearer\s+\S+/gi;
const SK_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const DATA_URL = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{16,}/g;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

export function shorten(value, max = 240) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function hostNames(baseUrl) {
  if (!baseUrl) return [];
  try {
    const url = new URL(baseUrl);
    const names = [url.host, url.hostname, url.origin];
    return names.filter((name) => name && name.length >= 5);
  } catch {
    return [];
  }
}

export function redact(value, options = {}) {
  const secrets = Array.isArray(options) ? options : (options.secrets ?? []);
  const baseUrl = Array.isArray(options) ? '' : (options.baseUrl ?? '');
  let text = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4 && text.includes(secret)) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  text = text.replace(BEARER, 'Bearer [REDACTED]').replace(SK_KEY, '[REDACTED]');
  text = text.replace(DATA_URL, 'data:image;base64,[omitted]');
  text = text.replace(URL_PATTERN, (match) => {
    try {
      const url = new URL(match);
      return `[url]${url.pathname}`;
    } catch {
      return '[url]';
    }
  });
  for (const name of hostNames(baseUrl)) {
    if (text.includes(name)) text = text.split(name).join('[host]');
  }
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4 && text.includes(secret)) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  return text;
}

export function redactAndShorten(value, options, max = 240) {
  return shorten(redact(value, options), max);
}

export function redactJson(value, options) {
  return JSON.parse(redact(JSON.stringify(value), options));
}
