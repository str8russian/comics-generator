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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BASE_URL must use http or https');
  }
  return url;
}

export function resolveApiPath(baseUrl, apiPath) {
  const url = assertBase(baseUrl);
  const suffix = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const basePath = url.pathname.replace(/\/+$/, '');
  let pathname;
  if (suffix === '/v1' || suffix.startsWith('/v1/')) {
    if (basePath.endsWith('/v1')) pathname = `${basePath}${suffix.slice(3)}` || '/v1';
    else pathname = `${basePath}${suffix}`.replace(/\/{2,}/g, '/');
  } else {
    pathname = suffix;
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return { href: url.toString(), pathname: url.pathname };
}

export function documentationPaths(baseUrl) {
  const url = assertBase(baseUrl);
  const paths = ['/openapi.json'];
  const basePath = url.pathname.replace(/\/+$/, '');
  if (basePath && basePath !== '/v1') {
    const parent = basePath.endsWith('/v1') ? basePath.slice(0, -3) : basePath;
    const extra = `${parent}/openapi.json`.replace(/\/{2,}/g, '/');
    if (extra !== '/openapi.json') paths.push(extra);
  }
  return paths;
}
