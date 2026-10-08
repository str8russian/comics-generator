import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

export function http1RequestOptions(target, { method = 'GET', headers = {} } = {}) {
  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method,
    headers,
    ALPNProtocols: ['http/1.1'],
    servername: target.hostname,
  };
}

export function http1Fetch(url, init = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return Promise.reject(new Error('unsupported protocol'));
  }
  const body = init.body == null ? null : (Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body));
  const headers = {};
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    if (value != null) headers[key] = value;
  }
  if (body && headers['content-length'] == null && headers['Content-Length'] == null) {
    headers['content-length'] = String(body.length);
  }
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const options = http1RequestOptions(target, { method: init.method || 'GET', headers });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const req = request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value == null || HOP_BY_HOP.has(key)) continue;
          responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        finish(resolve, new Response(buffer, { status: res.statusCode ?? 0, headers: responseHeaders }));
      });
    });
    const fail = (error) => {
      if (init.signal?.aborted || error?.name === 'AbortError') {
        const abortError = new Error('request aborted');
        abortError.name = 'AbortError';
        finish(reject, abortError);
        return;
      }
      const safe = new Error(error?.code || 'network');
      safe.code = error?.code;
      finish(reject, safe);
    };
    req.on('error', fail);
    if (init.signal) {
      const onAbort = () => {
        req.destroy();
        fail(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (init.signal.aborted) onAbort();
      else init.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.end(body ?? undefined);
  });
}
