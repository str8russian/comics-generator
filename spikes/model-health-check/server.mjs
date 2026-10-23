import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicChecks, runCheck } from './lib/checks.mjs';
import { readConfig } from './lib/config.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

export function createApp(options = {}) {
  const config = options.config ?? readConfig(options.env);
  const fetchImpl = options.fetchImpl;
  return async function app(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && STATIC[url.pathname]) {
        const [filename, type] = STATIC[url.pathname];
        const file = path.join(PUBLIC, filename);
        if (!existsSync(file)) return sendJson(response, 404, { error: 'not found', code: 'not-found' });
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        response.end(readFileSync(file));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        sendJson(response, 200, {
          configured: Boolean(config.configured),
          missing: config.missing ?? [],
          checks: publicChecks(),
          transport: 'HTTP/1.1',
        });
        return;
      }
      const match = url.pathname.match(/^\/api\/checks\/([a-z0-9-]+)$/);
      if (request.method === 'POST' && match) {
        const result = await runCheck(match[1], config, { fetchImpl });
        sendJson(response, 200, result);
        return;
      }
      sendJson(response, 404, { error: 'not found', code: 'not-found' });
    } catch (error) {
      sendJson(response, error.status || 500, {
        error: error.status && error.status < 500 ? error.message : 'request failed',
        code: error.code || 'internal',
      });
    }
  };
}

export function startServer(options = {}) {
  const env = options.env ?? process.env;
  const config = options.config ?? readConfig(env);
  const app = createApp({ ...options, env, config });
  const server = createServer((request, response) => {
    app(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'request failed', code: 'internal' });
    });
  });
  const host = '127.0.0.1';
  const port = Number(options.port ?? env.MODEL_HEALTH_PORT ?? 4321);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      console.log(`model health check listening on http://${host}:${boundPort}`);
      resolve({
        server,
        baseUrl: `http://${host}:${boundPort}`,
        config,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
