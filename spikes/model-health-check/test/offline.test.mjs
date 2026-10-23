import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { buildProviderRequest, CHECKS, IMAGE_PROMPT, publicChecks, runCheck, TEXT_PROMPT } from '../lib/checks.mjs';
import { createApp } from '../server.mjs';

const TOKEN = 'health-test-token-never-expose';

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('exposes exactly two text, three image, one invalid, and one quota check', () => {
  const checks = publicChecks();
  assert.equal(checks.filter((check) => check.kind === 'text').length, 2);
  assert.equal(checks.filter((check) => check.kind === 'image').length, 3);
  assert.equal(checks.filter((check) => check.kind === 'invalid').length, 1);
  assert.equal(checks.filter((check) => check.kind === 'quota').length, 1);
  assert.deepEqual(checks.filter((check) => check.kind === 'text').map((check) => check.model), ['gpt-5.5', 'claude-opus-4.8']);
  assert.deepEqual(checks.filter((check) => check.kind === 'image').map((check) => check.model), [
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
  ]);
});

test('builds the hardcoded text, invalid, image, and quota requests', () => {
  const text = buildProviderRequest(CHECKS['text-gpt']);
  assert.equal(text.path, '/v1/chat/completions');
  assert.deepEqual(JSON.parse(text.body), {
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: TEXT_PROMPT }],
  });
  const invalid = JSON.parse(buildProviderRequest(CHECKS['invalid-model']).body);
  assert.equal(invalid.model, 'opus-4.8');
  const image = JSON.parse(buildProviderRequest(CHECKS['image-gemini-3-pro']).body);
  assert.equal(image.model, 'gemini-3-pro-image-preview');
  assert.deepEqual(image.modalities, ['image', 'text']);
  assert.equal(image.messages[0].content, IMAGE_PROMPT);
  assert.deepEqual(buildProviderRequest(CHECKS.quota), {
    method: 'GET', path: '/key/info', headers: { accept: 'application/json' }, body: null,
  });
});

test('text check reports an answer and sends the token only to the provider', async () => {
  const requests = [];
  await withServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ url: request.url, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '4' } }], usage: { total_tokens: 7 } }));
  }, async (baseUrl) => {
    const result = await runCheck('text-gpt', { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000 });
    assert.equal(result.ok, true);
    assert.equal(result.answer, '4');
    assert.equal(result.answer_matches_expected, true);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].authorization, `Bearer ${TOKEN}`);
});

test('invalid model HTTP error is a successful reachability control', async () => {
  await withServer(async (request, response) => {
    await readBody(request);
    response.statusCode = 400;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: { message: `unknown model ${TOKEN}` } }));
  }, async (baseUrl) => {
    const result = await runCheck('invalid-model', { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000 });
    assert.equal(result.ok, true);
    assert.equal(result.reachable, true);
    assert.equal(result.outcome, 'expected-error');
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  });
});

test('image check returns valid inline image metadata and preview data', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZAAAAABJRU5ErkJggg==', 'base64');
  await withServer(async (request, response) => {
    await readBody(request);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }));
  }, async (baseUrl) => {
    const result = await runCheck('image-gemini-3-pro', { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000 });
    assert.equal(result.ok, true);
    assert.equal(result.image.width, 1);
    assert.equal(result.image.height, 1);
    assert.match(result.image.data_url, /^data:image\/png;base64,/);
  });
});

test('quota check returns only the fields needed by the page', async () => {
  await withServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ info: { spend: 12.345, max_budget: 50, last_active: '2026-10-11T10:00:00.000Z', secret: TOKEN } }));
  }, async (baseUrl) => {
    const result = await runCheck('quota', { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.quota, {
      spend: 12.345,
      max_budget: 50,
      spent_percent: 24.69,
      left_percent: 75.31,
      last_active: '2026-10-11T10:00:00.000Z',
    });
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  });
});

test('browser status contains neither token nor provider host', async () => {
  const config = { configured: true, baseUrl: 'https://provider-secret.test/v1', token: TOKEN, timeoutMs: 5000 };
  const app = createApp({ config });
  await withServer((request, response) => app(request, response), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/status`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes('provider-secret.test'), false);
  });
});
