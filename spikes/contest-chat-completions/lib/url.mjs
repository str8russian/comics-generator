export function chatCompletionsUrl(baseUrl) {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) throw new Error('BASE_URL is empty');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('BASE_URL is not a valid URL');
  }
  if (url.username || url.password) throw new Error('BASE_URL must not contain credentials');
  if (url.search || url.hash) throw new Error('BASE_URL must not contain a query or hash');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BASE_URL must use http or https');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) {
    // The caller already named the Chat Completions path.
  } else if (path.endsWith('/v1')) {
    path += '/chat/completions';
  } else {
    path += '/v1/chat/completions';
  }
  url.pathname = path;
  return url.toString();
}
