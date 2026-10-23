export function assertBase(baseUrl) {
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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('BASE_URL must use http or https');
  return url;
}

export function resolveApiPath(baseUrl, apiPath) {
  const url = assertBase(baseUrl);
  const suffix = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const basePath = url.pathname.replace(/\/+$/, '');
  if (suffix === '/v1' || suffix.startsWith('/v1/')) {
    url.pathname = basePath.endsWith('/v1')
      ? `${basePath}${suffix.slice(3)}` || '/v1'
      : `${basePath}${suffix}`.replace(/\/{2,}/g, '/');
  } else {
    url.pathname = suffix;
  }
  url.search = '';
  url.hash = '';
  return { href: url.toString(), pathname: url.pathname };
}
