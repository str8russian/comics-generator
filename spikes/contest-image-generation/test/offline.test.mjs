import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { readImageConfig } from '../lib/config.mjs';
import { buildEvidence, executeRun, saveEvaluation } from '../lib/execute.mjs';
import { assertPathAllowed } from '../lib/forbidden.mjs';
import { makePng } from '../lib/image-info.mjs';
import { sendProviderRequest } from '../lib/client.mjs';
import { http1RequestOptions } from '../lib/http1.mjs';
import { classifyAspectResult, runDiscovery } from '../lib/probe.mjs';
import { extractImagePayload, buildRequest, DISCOVERY_PROMPT } from '../lib/transport.mjs';
import { buildDurovAnchorRequest, IDENTITY_TEXT, STYLE_TEXT, TASK_TEXT } from '../lib/durov-anchor.mjs';
import { buildMatrixRequest, promptText, REMAINING_CELLS, PRESERVED_DUROV_V3, V1_FORBIDDEN } from '../lib/anchor-matrix.mjs';
import { assemblePrompt } from '../lib/prompt.mjs';
import { redact } from '../lib/redact.mjs';
import { createStore, emptyCapability } from '../lib/store.mjs';
import { resolveApiPath } from '../lib/url.mjs';
import { createApp, startServer } from '../server.mjs';

const TOKEN = 'test-token-do-not-log-at-all';
const HOST = 'https://image-provider.test/v1';
const SPIKE = fileURLToPath(new URL('..', import.meta.url));

function readRequest(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    return await fn(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function verifiedProfile() {
  return {
    ...emptyCapability(),
    transport: {
      status: 'verified',
      shape: 'openai-images',
      endpoint_path: '/v1/images/generations',
      request_format: 'json',
      locked: true,
    },
    reference_images: 'verified',
    reference_image_count_verified: 3,
    aspect_ratio: 'accepted',
    verified_aspect_ratios: ['4:5'],
  };
}

function tempInputs(dir) {
  const identity = path.join(dir, 'identity.png');
  const style = path.join(dir, 'style.png');
  writeFileSync(identity, makePng(4, 5));
  writeFileSync(style, makePng(4, 5, { red: 10, green: 10, blue: 10 }));
  const rules = {
    basenames: [
      'peskov base.jpeg',
      '2vV3Qq9hXkCAICkAEHskTrVYCD9ISy9Z.jpg.avif',
      'putin-state-s01-speaking-to-durov-v1.png',
      'putin-state-s03-attention-to-peskov-v1.png',
    ],
    paths: [],
  };
  return {
    rules,
    references: [
      {
        id: 'putin-identity-photo',
        basename: 'identity.png',
        eligible_roles: ['identity-reference'],
        local_path: identity,
        blocked: null,
      },
      {
        id: 'peskov-approved-anchor',
        basename: 'style.png',
        eligible_roles: ['style-anchor', 'identity-anchor'],
        local_path: style,
        blocked: null,
      },
    ],
  };
}

function runBody() {
  return {
    experiment_id: 'anchor-putin',
    recipe_version: 1,
    workflow: 'base-anchor',
    phase: 'anchor',
    aspect_ratio: '4:5',
    layout_purpose: 'anchor-review',
    template_id: 'base-anchor',
    template_version: 1,
    prompt_edited: false,
    parent_reference_id: null,
    inputs: [
      { id: 'putin-identity-photo', role: 'identity-reference' },
      { id: 'peskov-approved-anchor', role: 'style-anchor' },
    ],
    prompt: 'Draw Putin in the approved rendering language. Preserve his identity.',
  };
}

test('resolves image paths without duplicating a /v1 mount', () => {
  assert.equal(resolveApiPath('https://image-provider.test/v1', '/v1/images/generations').pathname, '/v1/images/generations');
  assert.equal(resolveApiPath('https://image-provider.test/proxy/v1', '/v1/chat/completions').pathname, '/proxy/v1/chat/completions');
  assert.equal(
    resolveApiPath('https://image-provider.test/v1', '/v1beta/models/gemini-3-pro-image-preview:generateContent').pathname,
    '/v1beta/models/gemini-3-pro-image-preview:generateContent',
  );
  assert.throws(() => resolveApiPath('https://user:secret@image-provider.test/v1', '/v1/images/generations'), /credentials/);
});

test('redacts the token, host, query, and image data', () => {
  const text = `Bearer ${TOKEN} failed at https://image-provider.test/v1/images/generations?api_key=${TOKEN} data:image/png;base64,${'A'.repeat(40)}`;
  const cleaned = redact(text, { secrets: [TOKEN], baseUrl: HOST });
  assert.equal(cleaned.includes(TOKEN), false);
  assert.equal(cleaned.includes('image-provider.test'), false);
  assert.equal(cleaned.includes('api_key'), false);
  assert.equal(cleaned.includes('AAAA'), false);
  assert.match(cleaned, /\[REDACTED\]/);
  assert.match(cleaned, /\[url\]\/v1\/images\/generations/);
});

test('operational prompts describe the drawing and keep authority order', () => {
  const promptDir = path.join(SPIKE, 'prompts');
  for (const name of readdirSync(promptDir)) {
    assert.equal(/gta/i.test(readFileSync(path.join(promptDir, name), 'utf8')), false);
  }
  const assembled = assemblePrompt({
    workflow: 'performance-heavy',
    character: 'peskov',
    stateIntent: 'Deep sleep.',
    gaze: 'eyes closed; no directed gaze',
    aspectRatio: '4:5',
    layoutPurpose: 'anchor-review',
    inputs: [
      { id: 'peskov-perf-sleep', role: 'performance-reference' },
      { id: 'peskov-approved-anchor', role: 'identity-anchor' },
      { id: 'peskov-approved-anchor', role: 'style-anchor' },
    ],
  });
  assert.match(assembled.prompt, /1\. The performance reference controls staging/);
  assert.match(assembled.prompt, /2\. The identity anchor controls who the person is/);
  assert.match(assembled.prompt, /3\. The style anchor controls how the image is rendered/);
  assert.match(assembled.prompt, /heavy near-black contour/);
  assert.equal(/gta/i.test(assembled.prompt), false);
});

test('rejects forbidden inputs by basename, normalized path, and real path', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-forbidden-'));
  const nested = path.join(dir, 'nested');
  const locked = path.join(dir, 'locked');
  mkdirSync(nested);
  mkdirSync(locked);
  const forbiddenName = path.join(nested, 'peskov base.jpeg');
  const forbiddenV1 = path.join(locked, 'putin-state-s03-attention-to-peskov-v1.png');
  writeFileSync(forbiddenName, makePng(1, 1));
  writeFileSync(forbiddenV1, makePng(1, 1));
  writeFileSync(path.join(dir, 'ok.png'), makePng(1, 1));
  const alias = path.join(dir, 'alias.png');
  symlinkSync(forbiddenName, alias);
  const rules = {
    basenames: ['peskov base.jpeg', 'putin-state-s01-speaking-to-durov-v1.png'],
    paths: [forbiddenV1],
  };
  assert.throws(() => assertPathAllowed(path.join(nested, '..', 'nested', 'peskov base.jpeg'), rules), /forbidden input/);
  assert.throws(() => assertPathAllowed(alias, rules), /forbidden input/);
  assert.throws(() => assertPathAllowed(forbiddenV1, rules), /forbidden input/);
  assert.equal(assertPathAllowed(path.join(dir, 'ok.png'), rules).basename, 'ok.png');
});

test('discovery verifies one shape and counts docs, success, references, and the error call', async () => {
  const hits = [];
  const profile = await withServer(async (req, res) => {
    const raw = await readRequest(req);
    hits.push({ method: req.method, url: req.url, authorization: req.headers.authorization, raw });
    if (req.url === '/openapi.json') {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: `no docs ${TOKEN}` } }));
      return;
    }
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    if (body.model === '') {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: `bad ${TOKEN} https://image-provider.test/v1/images/generations?api_key=${TOKEN}` } }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      data: [{ b64_json: makePng(8, 10).toString('base64') }],
      usage: { prompt_tokens: 3, completion_tokens: 9, total_tokens: 12 },
    }));
  }, async (baseUrl) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-discovery-'));
    const store = createStore(dir);
    const config = { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000, model: 'gemini-3-pro-image-preview' };
    const found = await runDiscovery({
      config,
      store,
      redactWith: { secrets: [TOKEN], baseUrl },
    });
    assert.equal(store.readCampaign().live_requests, 4);
    return found;
  });

  assert.equal(hits.length, 4);
  assert.equal(hits[0].url, '/openapi.json');
  assert.equal(hits[1].url, '/v1/chat/completions');
  assert.equal(hits.every((hit) => hit.authorization === `Bearer ${TOKEN}`), true);
  const shape = JSON.parse(hits[1].raw.toString('utf8'));
  assert.equal(shape.model, 'gemini-3-pro-image-preview');
  assert.deepEqual(shape.modalities, ['image', 'text']);
  assert.equal(typeof shape.messages[0].content, 'string');
  assert.equal(shape.aspect_ratio, undefined);
  const reference = JSON.parse(hits[2].raw.toString('utf8'));
  const referenceImages = reference.messages[0].content.filter((part) => part.type === 'image_url');
  assert.equal(referenceImages.length, 3);
  const failure = JSON.parse(hits[3].raw.toString('utf8'));
  assert.equal(failure.model, '');
  assert.equal(profile.transport.status, 'verified');
  assert.equal(profile.transport.shape, 'chat-completions');
  assert.equal(profile.transport.endpoint_path, '/v1/chat/completions');
  assert.equal(profile.reference_images, 'verified');
  assert.equal(profile.reference_image_count_verified, 3);
  assert.equal(profile.error_behavior, 'observed');
  assert.equal(profile.aspect_ratio, 'untested');
  assert.deepEqual(profile.verified_aspect_ratios, []);
  assert.equal(JSON.stringify(profile).includes(TOKEN), false);
  assert.equal(JSON.stringify(profile).includes('image-provider.test'), false);
  assert.equal(JSON.stringify(profile).includes('api_key'), false);
});

test('an unknown or unsupported shape makes no generation request', async () => {
  let calls = 0;
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-unknown-'));
  const store = createStore(dir);
  const config = {
    configured: true,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 5000,
    missing: [],
  };
  const app = createApp({
    root: SPIKE,
    store,
    config,
    quiet: true,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('fetch should not run');
    },
  });
  const server = http.createServer(app);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: 'run-one',
        experiment_id: 'anchor-putin',
        workflow: 'base-anchor',
        aspect_ratio: '4:5',
        inputs: [
          { id: 'putin-identity-photo', role: 'identity-reference' },
          { id: 'peskov-approved-anchor', role: 'style-anchor' },
        ],
        prompt: 'A portrait.',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.code, 'shape-unknown');
    assert.equal(calls, 0);
    assert.equal(store.readCampaign().live_requests, 0);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('a failed provider response is counted, redacted, and stored without base64 or the token', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-fail-'));
  const store = createStore(dir);
  store.writeCapability(verifiedProfile());
  const catalog = tempInputs(dir);
  const config = { configured: true, baseUrl: HOST, token: TOKEN, timeoutMs: 5000 };
  const manifest = await executeRun({
    config,
    store,
    catalog,
    profile: store.readCapability(),
    redactWith: { secrets: [TOKEN], baseUrl: HOST },
    fetchImpl: async () => {
      throw new Error(`connect failed ${TOKEN} https://image-provider.test/v1/images/generations?api_key=${TOKEN}`);
    },
    body: runBody(),
  });
  assert.equal(store.readCampaign().live_requests, 1);
  assert.equal(store.readCampaign().by_phase.anchor, 1);
  assert.equal(manifest.http.error_class, 'network');
  assert.equal(JSON.stringify(manifest).includes(TOKEN), false);
  assert.equal(JSON.stringify(manifest).includes('image-provider.test'), false);
  assert.equal(manifest.final_prompt.includes('Putin'), true);
  assert.deepEqual(manifest.inputs.map((input) => input.role), ['identity-reference', 'style-anchor']);
  assert.equal(manifest.inputs.every((input) => input.sha256 && input.mime === 'image/png' && input.width === 4), true);
  assert.equal(Object.hasOwn(manifest.inputs[0], 'local_path'), false);
  assert.match(manifest.http.error, /\[REDACTED\]/);
  assert.equal(manifest.http.error.includes('image-provider.test'), false);
  const saved = JSON.parse(readFileSync(store.manifestPath(manifest.run_id), 'utf8'));
  assert.equal(typeof saved.inputs[0].local_path, 'string');
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);
});

test('a successful fake response persists output metadata and a sanitized export', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-ok-'));
  const store = createStore(dir);
  store.writeCapability(verifiedProfile());
  const png = makePng(8, 10);
  const manifest = await executeRun({
    config: { configured: true, baseUrl: HOST, token: TOKEN, timeoutMs: 5000 },
    store,
    catalog: tempInputs(dir),
    profile: store.readCapability(),
    redactWith: { secrets: [TOKEN], baseUrl: HOST },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
      const body = JSON.parse(init.body);
      assert.equal(body.image.length, 2);
      assert.equal(body.aspect_ratio, '4:5');
      return new Response(JSON.stringify({
        data: [{ b64_json: png.toString('base64') }],
        usage: { total_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    body: runBody(),
  });
  assert.equal(manifest.output.mime, 'image/png');
  assert.equal(manifest.output.width, 8);
  assert.equal(manifest.output.height, 10);
  assert.equal(manifest.output.sha256.length, 64);
  assert.equal(JSON.stringify(manifest).includes(png.toString('base64').slice(0, 40)), false);
  assert.equal(readFileSync(store.outputPath(manifest.output.filename)).equals(png), true);
  const evidence = buildEvidence(store, { secrets: [TOKEN], baseUrl: HOST });
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes('image-provider.test'), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('/var/'), false);
  assert.equal(serialized.includes('/private/'), false);
  assert.equal(serialized.includes(manifest.final_prompt), true);
  assert.equal(evidence.capability.transport.endpoint_path, '/v1/images/generations');
});

test('server logs omit the token and provider host when a call fails', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-log-'));
  const store = createStore(dir);
  store.writeCapability(verifiedProfile());
  const server = http.createServer(createApp({
    root: SPIKE,
    store,
    catalog: tempInputs(dir),
    quiet: true,
    config: { configured: true, baseUrl: HOST, token: TOKEN, timeoutMs: 5000, missing: [] },
    fetchImpl: async () => {
      throw new Error(`connect failed ${TOKEN} https://image-provider.test/v1/images?api_key=${TOKEN}`);
    },
  }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'run-one', ...runBody() }),
    });
    const payload = await response.json();
    const log = readFileSync(store.logFile, 'utf8');
    assert.equal(payload.http.error_class, 'network');
    assert.equal(JSON.stringify(payload).includes(TOKEN), false);
    assert.equal(JSON.stringify(payload).includes('image-provider.test'), false);
    assert.equal(log.includes(TOKEN), false);
    assert.equal(log.includes('image-provider.test'), false);
    assert.equal(store.readCampaign().live_requests, 1);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('prompt tweaks stop after two attempts for one failure class', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-retry-'));
  const store = createStore(dir);
  store.writeCapability(verifiedProfile());
  const catalog = tempInputs(dir);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('network down');
  };
  const config = { configured: true, baseUrl: HOST, token: TOKEN, timeoutMs: 5000 };
  const common = {
    config,
    store,
    catalog,
    profile: store.readCapability(),
    redactWith: { secrets: [TOKEN], baseUrl: HOST },
    fetchImpl,
  };
  await executeRun({ ...common, body: { ...runBody(), retry_of: { technique: 'prompt-tweak', failure_class: 'photorealism-drift' } } });
  await executeRun({ ...common, body: { ...runBody(), retry_of: { technique: 'prompt-tweak', failure_class: 'photorealism-drift' } } });
  await assert.rejects(
    () => executeRun({ ...common, body: { ...runBody(), retry_of: { technique: 'prompt-tweak', failure_class: 'photorealism-drift' } } }),
    /prompt-tweak limit/,
  );
  assert.equal(calls, 2);
  assert.equal(store.readCampaign().live_requests, 2);
  assert.equal(store.readLimitations().length, 1);
});

test('acceptance is refused while a blocking finding is present', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-eval-'));
  const store = createStore(dir);
  const runId = '20261008T000000Z-abc123';
  store.saveManifest({
    run_id: runId,
    inputs: [],
    final_prompt: 'A portrait.',
    ratings: null,
    verdict: null,
  });
  const ratings = {
    identity_preservation: 'fail',
    style_anchor_match: 'fail',
    expression: 'unsure',
    gaze_direction: 'fail',
    head_angle: 'unsure',
    pose_silhouette: 'unsure',
    shot_crop: 'unsure',
    performance_compliance: 'not-applicable',
    identity_leakage_absent: 'fail',
    panel_scale_difference: 'not-applicable',
    survives_crop: 'fail',
  };
  assert.throws(() => saveEvaluation(store, runId, {
    verdict: 'accepted',
    rationale: 'Looks close enough.',
    ratings,
    blocking: { identity_substitution: true, wrong_gaze: false, photorealism_drift: true, crop_loss: false },
  }), /blocking finding/);
  const saved = saveEvaluation(store, runId, {
    verdict: 'rejected',
    rationale: 'Identity and rendering drifted.',
    ratings,
    blocking: { identity_substitution: true, wrong_gaze: true, photorealism_drift: true, crop_loss: true },
  });
  assert.equal(saved.verdict, 'rejected');
  assert.equal(saved.final_prompt, 'A portrait.');
});

test('the browser payload never receives the token or provider host', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-browser-'));
  const started = await startServer({
    port: 0,
    quiet: true,
    runsDir: dir,
    env: {},
    config: { configured: true, baseUrl: HOST, token: TOKEN, timeoutMs: 5000, missing: [] },
    fetchImpl: async () => {
      throw new Error('startup or page load must not call the provider');
    },
  });
  try {
    const pages = ['/', '/app.js', '/app.css', '/api/status', '/api/experiments'];
    for (const page of pages) {
      const response = await fetch(`${started.baseUrl}${page}`);
      const text = await response.text();
      assert.equal(response.status, 200, page);
      assert.equal(text.includes(TOKEN), false, page);
      assert.equal(text.includes('image-provider.test'), false, page);
      assert.equal(text.includes('CONTEST_API_TOKEN'), false, page);
      assert.equal(text.includes('/Users/'), false, page);
    }
    assert.equal(readFileSync(path.join(SPIKE, 'public', 'app.js'), 'utf8').includes('localStorage'), false);
  } finally {
    await started.close();
  }
});

test('env loading does not require a hardcoded path and ignores an empty process value', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-env-'));
  const file = path.join(dir, 'secret.env');
  writeFileSync(file, `BASE_URL=${HOST}\nCONTEST_API_TOKEN=${TOKEN}\n`);
  const loaded = readImageConfig({ CONTEST_ENV_FILE: file }, { layered: true, cwd: dir, exists: () => true, readFile: () => readFileSync(file, 'utf8') });
  assert.equal(loaded.configured, true);
  assert.equal(loaded.model, 'gemini-3-pro-image-preview');
  const kept = readImageConfig({ CONTEST_ENV_FILE: file, CONTEST_API_TOKEN: '' }, {
    layered: true,
    exists: () => true,
    readFile: () => readFileSync(file, 'utf8'),
  });
  assert.equal(kept.configured, false);
  assert.equal(JSON.stringify(kept).includes(TOKEN), false);
});

test('a same-host signed image URL is fetched and its query never leaves the provider call', async () => {
  const query = 'signed-query-secret-do-not-store';
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-signed-'));
  const store = createStore(dir);
  store.writeCapability(verifiedProfile());
  const png = makePng(8, 10);
  const baseUrl = HOST;
  const imageUrl = `https://image-provider.test/v1/files/out.png?sig=${query}`;
  const calls = [];
  const server = http.createServer(createApp({
    root: SPIKE,
    store,
    catalog: tempInputs(dir),
    quiet: true,
    config: { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000, missing: [] },
    fetchImpl: async (url, init) => {
      calls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === '/v1/images/generations' && !parsed.search) {
        return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      assert.equal(parsed.host, 'image-provider.test');
      assert.equal(parsed.pathname, '/v1/files/out.png');
      assert.equal(parsed.searchParams.get('sig'), query);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers?.Authorization, undefined);
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'run-one', ...runBody() }),
    });
    const payload = await response.json();
    const exported = await fetch(`http://127.0.0.1:${server.address().port}/api/exports`, { method: 'POST' });
    const evidence = await exported.json();
    const saved = readFileSync(store.manifestPath(payload.run_id), 'utf8');
    const leaked = [JSON.stringify(payload), JSON.stringify(evidence), saved, readFileSync(store.logFile, 'utf8')].join('\n');
    assert.equal(calls.length, 2);
    assert.equal(store.readCampaign().live_requests, 2);
    assert.equal(payload.output.width, 8);
    assert.equal(payload.output.height, 10);
    assert.equal(leaked.includes(query), false);
    assert.equal(leaked.includes(imageUrl), false);
    assert.equal(leaked.includes('sig='), false);
    assert.equal(leaked.includes('image-provider.test'), false);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  let offHostFetches = 0;
  const offHost = await sendProviderRequest({
    baseUrl,
    token: TOKEN,
    timeoutMs: 5000,
    redactWith: { secrets: [TOKEN], baseUrl },
    request: {
      method: 'POST',
      path: '/v1/images/generations',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    },
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: `https://evil.example/img.png?sig=${query}` }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      offHostFetches += 1;
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(offHostFetches, 0);
  assert.equal(offHost.errorClass, 'off-host-url');
  assert.equal(JSON.stringify(offHost).includes(query), false);

  const redirected = await sendProviderRequest({
    baseUrl,
    token: TOKEN,
    timeoutMs: 5000,
    redactWith: { secrets: [TOKEN], baseUrl },
    request: {
      method: 'POST',
      path: '/v1/images/generations',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    },
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', {
        status: 302,
        headers: { location: `https://evil.example/follow?sig=${query}` },
      });
    },
  });
  assert.equal(redirected.errorClass, 'redirect');
  assert.equal(JSON.stringify(redirected).includes(query), false);
  assert.equal(JSON.stringify(redirected).includes('evil.example'), false);

  const failedDownload = await sendProviderRequest({
    baseUrl,
    token: TOKEN,
    timeoutMs: 5000,
    redactWith: { secrets: [TOKEN], baseUrl },
    request: {
      method: 'POST',
      path: '/v1/images/generations',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    },
    fetchImpl: async (url) => {
      if (new URL(url).pathname === '/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`connect failed ${url}`);
    },
  });
  assert.equal(failedDownload.errorClass, 'network');
  assert.equal(failedDownload.error.includes(query), false);
  assert.equal(failedDownload.error.includes('sig='), false);
  assert.equal(failedDownload.error.includes('image-provider.test'), false);
});

test('discovery counts every outbound request and defers an image download past four', async () => {
  const query = 'signed-query-secret-do-not-store';
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-budget-'));
  const store = createStore(dir);
  const baseUrl = HOST;
  const imageUrl = `https://image-provider.test/v1/files/out.png?sig=${query}`;
  const png = makePng(8, 10);
  let outbound = 0;
  const fetchImpl = async (url, init) => {
    outbound += 1;
    assert.equal(outbound <= 4, true);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.has('sig'), false);
    if (parsed.pathname === '/openapi.json') {
      return new Response(JSON.stringify({ error: { message: 'missing' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    if (parsed.pathname === '/v1/chat/completions' || parsed.pathname === '/v1/images/generations') {
      return new Response(JSON.stringify({ error: { message: 'missing' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    if (parsed.pathname.includes('generateContent')) {
      return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected request ${parsed.pathname}`);
  };
  const deferred = await runDiscovery({
    config: { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000 },
    store,
    fetchImpl,
    redactWith: { secrets: [TOKEN], baseUrl },
  });
  assert.equal(outbound, 4);
  assert.equal(store.readCampaign().live_requests, 4);
  assert.equal(deferred.discovery_requests, 4);
  assert.equal(deferred.log.length, 4);
  assert.equal(deferred.pending_image_download, true);
  assert.equal(deferred.output.representation, 'pending-image-download');
  assert.equal(deferred.transport.status, 'unverified');
  assert.equal(deferred.shapes_tried.includes('gemini-generate-content'), false);
  const deferredText = JSON.stringify(deferred);
  assert.equal(deferredText.includes(query), false);
  assert.equal(deferredText.includes('sig='), false);
  assert.equal(deferredText.includes(imageUrl), false);

  const continued = await runDiscovery({
    config: { configured: true, baseUrl, token: TOKEN, timeoutMs: 5000 },
    store,
    fetchImpl: async (url, init) => {
      outbound += 1;
      const parsed = new URL(url);
      if (parsed.searchParams.get('sig') === query) {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      const body = init?.body ? JSON.parse(init.body) : {};
      if (Array.isArray(body.contents) && body.contents.length === 0) {
        return new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      const parts = body.contents?.[0]?.parts;
      const hasImage = Array.isArray(parts) && parts.some((part) => part.inline_data);
      if (hasImage) {
        return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    redactWith: { secrets: [TOKEN], baseUrl },
  });
  assert.equal(outbound, 8);
  assert.equal(store.readCampaign().live_requests, 8);
  assert.equal(continued.discovery_requests, 8);
  assert.equal(continued.log.length, 8);
  assert.equal(continued.log.filter((entry) => entry.step === 'image-download').length, 1);
  assert.equal(continued.pending_image_download, false);
  assert.equal(continued.transport.status, 'verified');
  assert.equal(continued.reference_images, 'verified');
  assert.equal(continued.error_behavior, 'observed');
  const continuedText = `${JSON.stringify(continued)}\n${readFileSync(store.capabilityFile, 'utf8')}\n${readFileSync(store.campaignFile, 'utf8')}`;
  assert.equal(continuedText.includes(query), false);
  assert.equal(continuedText.includes('sig='), false);
  assert.equal(continuedText.includes(imageUrl), false);
});

test('parses the confirmed chat image path from a data URL', () => {
  const png = makePng(6, 4);
  const encoded = png.toString('base64');
  const extracted = extractImagePayload({
    model: 'gemini-3-pro-image-preview',
    choices: [{
      finish_reason: 'stop',
      message: { images: [{ image_url: { url: `data:image/png;base64,${encoded}` } }] },
    }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  });
  assert.equal(extracted.images.length, 1);
  assert.equal(extracted.images[0].representation, 'data-url');
  assert.equal(extracted.images[0].mime, 'image/png');
  assert.equal(extracted.images[0].buffer.equals(png), true);
  assert.equal(extracted.usage.total_tokens, 5);
  assert.equal(extracted.urls.length, 0);
  const sniffed = extracted.images[0].buffer;
  assert.equal(sniffed.length, png.length);
});

test('the HTTP/1.1 client requests only HTTP/1.1', () => {
  const options = http1RequestOptions(new URL('https://image-provider.test/v1/chat/completions'), { method: 'POST' });
  assert.deepEqual(options.ALPNProtocols, ['http/1.1']);
  assert.equal(options.path, '/v1/chat/completions');
});

test('a documentation network failure is network-blocked and does not stop Chat Completions', async () => {
  let calls = 0;
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-docs-network-'));
  const store = createStore(dir);
  const profile = await runDiscovery({
    config: { configured: true, baseUrl: HOST, token: TOKEN, timeoutMs: 5000 },
    store,
    redactWith: { secrets: [TOKEN], baseUrl: HOST },
    budget: 2,
    fetchImpl: async (url) => {
      calls += 1;
      if (new URL(url).pathname === '/openapi.json') throw new Error('fetch failed');
      return new Response(JSON.stringify({
        data: [{ b64_json: makePng(8, 10).toString('base64') }],
        usage: { total_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(calls, 2);
  assert.equal(profile.documentation, 'network-blocked');
  assert.notEqual(profile.documentation, 'unavailable');
  assert.equal(profile.transport.shape, 'chat-completions');
  assert.equal(profile.transport.status, 'verified');
});

test('one HTTP/1.1 transport probe decodes the confirmed image and omits base64 from evidence', async () => {
  const png = makePng(6, 4);
  const encoded = png.toString('base64');
  const provider = http.createServer(async (req, res) => {
    const raw = await readRequest(req);
    assert.equal(req.httpVersion, '1.1');
    const body = JSON.parse(raw.toString('utf8'));
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(body.model, 'gemini-3-pro-image-preview');
    assert.deepEqual(body.modalities, ['image', 'text']);
    assert.equal(typeof body.messages[0].content, 'string');
    assert.match(body.messages[0].content, /red square/);
    assert.equal(body.aspect_ratio, undefined);
    assert.equal(JSON.stringify(body).includes('image_url'), false);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      model: 'gemini-3-pro-image-preview',
      choices: [{
        finish_reason: 'stop',
        message: { images: [{ image_url: { url: `data:image/png;base64,${encoded}` } }] },
      }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }));
  });
  await new Promise((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerBase = `http://127.0.0.1:${provider.address().port}/v1`;
  const dir = mkdtempSync(path.join(tmpdir(), 'image-spike-http1-'));
  const store = createStore(dir);
  const app = createApp({
    root: SPIKE,
    store,
    quiet: true,
    config: { configured: true, baseUrl: providerBase, token: TOKEN, timeoutMs: 5000, missing: [] },
  });
  const server = http.createServer(app);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'run-transport-probe' }),
    });
    const payload = await response.json();
    const exported = await fetch(`http://127.0.0.1:${server.address().port}/api/exports`, { method: 'POST' });
    const evidence = await exported.json();
    const attemptText = store.listAttempts().map((item) => JSON.stringify(item)).join('\n');
    const saved = [
      JSON.stringify(payload),
      JSON.stringify(evidence),
      readFileSync(store.capabilityFile, 'utf8'),
      readFileSync(store.logFile, 'utf8'),
      attemptText,
    ].join('\n');
    assert.equal(response.status, 200);
    assert.equal(payload.transport.status, 'verified');
    assert.equal(payload.transport.shape, 'chat-completions');
    assert.equal(payload.transport.endpoint_path, '/v1/chat/completions');
    assert.equal(payload.output.representation, 'data-url');
    assert.equal(payload.output.mime, 'image/png');
    assert.equal(payload.output.width, 6);
    assert.equal(payload.output.height, 4);
    assert.equal(payload.usage, 'present');
    assert.equal(store.readCampaign().live_requests, 1);
    assert.equal(saved.includes(encoded), false);
    assert.equal(saved.includes('base64,'), false);
    assert.equal(saved.includes(TOKEN), false);
  } finally {
    server.closeAllConnections?.();
    provider.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
    await new Promise((resolveClose) => provider.close(resolveClose));
  }
});

test('the aspect candidate is image_config and does not change the verified chat body', () => {
  const candidate = JSON.parse(buildRequest({
    shape: 'chat-completions',
    prompt: DISCOVERY_PROMPT,
    images: [],
    aspectRatio: '4:5',
    aspectField: 'image_config',
  }).body);
  assert.deepEqual(candidate.image_config, { aspect_ratio: '4:5' });
  assert.equal(candidate.aspect_ratio, undefined);
  assert.deepEqual(candidate.modalities, ['image', 'text']);
  assert.equal(typeof candidate.messages[0].content, 'string');
  assert.equal(candidate.messages[0].content.includes('image_url'), false);
  const verified = JSON.parse(buildRequest({
    shape: 'chat-completions',
    prompt: DISCOVERY_PROMPT,
    images: [],
  }).body);
  assert.equal(verified.image_config, undefined);
  assert.equal(verified.aspect_ratio, undefined);
  assert.equal(classifyAspectResult({ httpStatus: 200, width: 800, height: 1000 }).status, 'accepted');
  assert.equal(classifyAspectResult({ httpStatus: 200, width: 1408, height: 768 }).status, 'inconclusive');
  assert.equal(classifyAspectResult({ httpStatus: 400 }).status, 'rejected');
  assert.equal(classifyAspectResult({ httpStatus: 422 }).status, 'rejected');
  assert.equal(classifyAspectResult({ errorClass: 'network' }).status, 'untested');
});

test('the Durov anchor request binds each reference and does not include the evaluation anchor', () => {
  const identity = makePng(2, 2, { red: 10, green: 20, blue: 30 });
  const style = makePng(2, 2, { red: 200, green: 10, blue: 10 });
  const evaluation = makePng(2, 2, { red: 0, green: 0, blue: 255 });
  const request = buildDurovAnchorRequest({
    identity: { mime: 'image/png', buffer: identity },
    style: { mime: 'image/png', buffer: style },
  });
  const body = JSON.parse(request.body);
  const content = body.messages[0].content;
  assert.equal(request.path, '/v1/chat/completions');
  assert.equal(body.model, 'gemini-3-pro-image-preview');
  assert.deepEqual(body.modalities, ['image', 'text']);
  assert.deepEqual(body.image_config, { aspect_ratio: '4:5' });
  assert.equal(body.aspect_ratio, undefined);
  assert.deepEqual(content.map((part) => part.type), ['text', 'image_url', 'text', 'image_url', 'text']);
  assert.equal(content[0].text, IDENTITY_TEXT);
  assert.equal(content[2].text, STYLE_TEXT);
  assert.equal(content[4].text, TASK_TEXT);
  assert.equal(content[1].image_url.url.includes(identity.toString('base64')), true);
  assert.equal(content[3].image_url.url.includes(style.toString('base64')), true);
  assert.equal(request.body.includes(evaluation.toString('base64')), false);
  assert.match(content[0].text, /microphone/i);
  assert.match(content[2].text, /moustache/i);
  assert.equal(/gta/i.test(request.body), false);
});

test('the anchor matrix keeps V1 free of style language and does not regenerate Durov V3', () => {
  assert.equal(REMAINING_CELLS.length, 8);
  assert.equal(REMAINING_CELLS.some(([character, variant]) => character === 'durov' && variant === 'V3'), false);
  assert.equal(PRESERVED_DUROV_V3.label, 'Durov — V3 image anchor + text');
  assert.equal(PRESERVED_DUROV_V3.status, 'Accepted capability baseline; not yet an approved identity anchor.');
  const identity = makePng(2, 2, { red: 10, green: 20, blue: 30 });
  const style = makePng(2, 2, { red: 200, green: 10, blue: 10 });
  for (const character of ['putin', 'durov', 'peskov']) {
    const v1 = promptText(character, 'V1');
    for (const pattern of V1_FORBIDDEN) assert.equal(pattern.test(v1), false, `${character} ${pattern.source}`);
    const v1Body = JSON.parse(buildMatrixRequest({
      variant: 'V1',
      identity: { mime: 'image/png', buffer: identity, character },
      style: { mime: 'image/png', buffer: style },
    }).body);
    assert.equal(v1Body.messages[0].content.filter((part) => part.type === 'image_url').length, 2);
    const v2Request = buildMatrixRequest({
      variant: 'V2',
      identity: { mime: 'image/png', buffer: identity, character },
    });
    assert.equal(v2Request.body.includes(style.toString('base64')), false);
    assert.equal(JSON.parse(v2Request.body).messages[0].content.filter((part) => part.type === 'image_url').length, 1);
    assert.match(promptText(character, 'V2'), /heavy near-black outer contour/);
    assert.match(promptText(character, 'V3'), /heavy near-black outer contour/);
    assert.equal(promptText(character, 'V2').split('Rendering direction:')[1], promptText(character, 'V3').split('Rendering direction:')[1]);
  }
});

test('catalog responses omit absolute paths', async () => {
  const catalog = loadCatalog(SPIKE);
  const serialized = JSON.stringify(catalog.references.map((entry) => ({
    id: entry.id,
    purpose: entry.purpose,
    basename: entry.basename,
    eligible_roles: entry.eligible_roles,
    available: entry.available,
    blocked: entry.blocked,
  })));
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(catalog.references.some((entry) => entry.blocked), false);
});
