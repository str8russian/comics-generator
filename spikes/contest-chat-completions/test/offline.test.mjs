import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseChatCompletion, postChatCompletion } from '../lib/client.mjs';
import { readLiveConfig } from '../lib/config.mjs';
import {
  assessJsonMode,
  assessOutputLimit,
  assessReasoning,
  classifyAcceptedParameter,
  classifyFullStoryboard,
  classifyInvalidBody,
  classifyJsonMode,
  classifyMinimal,
  classifyResponseMetadata,
  looksLikeParameterRejection,
  outputLimitEffectiveness,
  storyboardSuitability,
} from '../lib/classify.mjs';
import { fixtureJson, structureStoryboardFixture } from '../lib/fixture.mjs';
import { redact } from '../lib/redact.mjs';
import {
  LIVE_SEQUENCE,
  MAX_LIVE_REQUESTS,
  assertReportHasNoSecrets,
  buildRequest,
  conformsToPongSchema,
  fixtureOutputLimit,
  formatReport,
  requestShape,
  runLiveMatrix,
  selectResponseFormat,
  selectVerifiedOutputLimit,
  skippedReport,
} from '../lib/run.mjs';
import { jsonValuesEqual } from '../lib/validate-probe.mjs';
import { chatCompletionsUrl } from '../lib/url.mjs';
import { validateStructureProbe } from '../lib/validate-probe.mjs';

const TOKEN = 'test-token-do-not-log';
const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function readRequest(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function completionBody(content, { finishReason = 'stop', usage = { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } } = {}) {
  return JSON.stringify({
    id: 'chatcmpl-offline',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage,
  });
}

test('builds one /v1/chat/completions URL from a base URL', () => {
  const cases = [
    ['https://api.example.test', 'https://api.example.test/v1/chat/completions'],
    ['https://api.example.test/', 'https://api.example.test/v1/chat/completions'],
    ['https://api.example.test/v1', 'https://api.example.test/v1/chat/completions'],
    ['https://api.example.test/v1/', 'https://api.example.test/v1/chat/completions'],
    ['https://api.example.test/v1/chat/completions', 'https://api.example.test/v1/chat/completions'],
    ['https://api.example.test/openai/v1', 'https://api.example.test/openai/v1/chat/completions'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(chatCompletionsUrl(input), expected);
  }
  assert.throws(() => chatCompletionsUrl('https://user:secret@api.example.test'), /credentials/);
  assert.throws(() => chatCompletionsUrl('https://api.example.test/v1?token=secret'), /query/);
});

test('posts the Chat Completions path, headers, and body once', async () => {
  let hits = 0;
  let seen = null;
  const result = await withServer(async (req, res) => {
    hits += 1;
    const raw = await readRequest(req);
    seen = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      accept: req.headers.accept,
      body: JSON.parse(raw),
    };
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(completionBody('pong'));
  }, (baseUrl) => postChatCompletion({
    baseUrl,
    token: TOKEN,
    body: { model: 'probe-model', messages: [{ role: 'user', content: 'Reply with the single word pong.' }] },
    timeoutMs: 2000,
  }));

  assert.equal(hits, 1);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/v1/chat/completions');
  assert.equal(seen.authorization, `Bearer ${TOKEN}`);
  assert.equal(seen.contentType, 'application/json');
  assert.equal(seen.accept, 'application/json');
  assert.equal(seen.body.model, 'probe-model');
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'Reply with the single word pong.' }]);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.contentType, 'application/json');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usagePresent, true);
  assert.equal(result.hasContent, true);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('parses an error body and redacts a secret', async () => {
  const parsed = parseChatCompletion({
    httpStatus: 400,
    contentType: 'application/json',
    text: JSON.stringify({ error: { message: `messages must be an array (${TOKEN})`, type: 'invalid_request_error' } }),
    secrets: [TOKEN],
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.httpStatus, 400);
  assert.match(parsed.error, /messages must be an array/);
  assert.equal(parsed.error.includes(TOKEN), false);
  assert.match(parsed.error, /\[REDACTED\]/);

  const result = await withServer((req, res) => {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: `invalid body near ${TOKEN}` } }));
  }, (baseUrl) => postChatCompletion({
    baseUrl,
    token: TOKEN,
    body: { model: 'probe-model', messages: { role: 'user' } },
    timeoutMs: 2000,
  }));
  assert.equal(result.httpStatus, 400);
  assert.equal(result.error.includes(TOKEN), false);
  assert.match(result.error, /invalid body/);
});

test('redacts bearer values and sk- keys outside the configured token', () => {
  const bearerValue = 'abcdefghijklmnop';
  const keyValue = ['sk', 'live-secret-value'].join('-');
  const text = redact(`Authorization: Bearer ${bearerValue} and ${keyValue}`, []);
  assert.equal(text.includes(bearerValue), false);
  assert.equal(text.includes(keyValue), false);
  assert.match(text, /Bearer \[REDACTED\]/);
});

test('times out a hanging server without a second request', async () => {
  let hits = 0;
  const result = await withServer((req) => {
    hits += 1;
    req.socket.setTimeout(0);
  }, (baseUrl) => postChatCompletion({
    baseUrl,
    token: TOKEN,
    body: { model: 'probe-model', messages: [{ role: 'user', content: 'ping' }] },
    timeoutMs: 150,
  }));
  assert.equal(result.transportError, 'timeout');
  assert.equal(result.httpStatus, null);
  assert.equal(hits, 1);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('aborts before the request is sent again', async () => {
  let hits = 0;
  const controller = new AbortController();
  controller.abort();
  const result = await withServer(() => {
    hits += 1;
  }, (baseUrl) => postChatCompletion({
    baseUrl,
    token: TOKEN,
    body: { model: 'probe-model', messages: [{ role: 'user', content: 'ping' }] },
    timeoutMs: 2000,
    signal: controller.signal,
  }));
  assert.equal(result.transportError, 'abort');
  assert.equal(hits, 0);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('classifies capabilities without implying an untested success', () => {
  assert.equal(classifyMinimal(null), 'UNTESTED');
  assert.equal(classifyMinimal({ transportError: 'timeout' }), 'INCONCLUSIVE');
  assert.equal(classifyMinimal({ httpStatus: 200, hasContent: true, finishReason: 'stop' }), 'SUPPORTED');
  assert.equal(classifyMinimal({ httpStatus: 404 }), 'UNSUPPORTED');

  assert.equal(looksLikeParameterRejection('reasoning_effort', 'Unrecognized request argument supplied: reasoning_effort'), true);
  assert.equal(classifyAcceptedParameter({ httpStatus: 200, effectivenessObserved: true }), 'SUPPORTED');
  assert.equal(classifyAcceptedParameter({ httpStatus: 200, parameterRejected: false, parameterIgnored: false }), 'INCONCLUSIVE');
  assert.equal(classifyAcceptedParameter({ httpStatus: 200, parameterIgnored: true }), 'INCONCLUSIVE');
  assert.equal(classifyAcceptedParameter({
    httpStatus: 400,
    parameterRejected: true,
    error: 'unsupported parameter reasoning_effort',
  }), 'UNSUPPORTED');
  assert.deepEqual(assessReasoning({ httpStatus: 200, requestedEffort: 'low', reasoningEffortEcho: null }), {
    classification: 'INCONCLUSIVE',
    acceptance: 'ACCEPTED',
    effectiveness: 'NOT_OBSERVABLE',
  });
  assert.equal(assessReasoning({ httpStatus: 200, requestedEffort: 'medium', reasoningEffortEcho: 'medium' }).effectiveness, 'OBSERVED');
  assert.equal(outputLimitEffectiveness({ httpStatus: 200, finishReason: 'length', limit: 16 }), 'OBSERVED');
  assert.equal(assessOutputLimit({ httpStatus: 200, finishReason: 'stop', completionTokens: 4, limit: 16 }).effectiveness, 'NOT_OBSERVABLE');
  assert.equal(assessOutputLimit({ httpStatus: 200, finishReason: 'stop', completionTokens: 40, limit: 16 }).effectiveness, 'NOT_APPLIED');
  assert.equal(selectVerifiedOutputLimit({ max_completion_tokens: 'OBSERVED', max_tokens: 'OBSERVED' }), 'max_completion_tokens');
  assert.equal(selectVerifiedOutputLimit({ max_completion_tokens: 'NOT_OBSERVABLE', max_tokens: 'OBSERVED' }), 'max_tokens');
  assert.equal(selectVerifiedOutputLimit({ max_completion_tokens: 'NOT_OBSERVABLE', max_tokens: 'NOT_APPLIED' }), null);
  assert.equal(selectResponseFormat({ json_schema: 'SUPPORTED', json_object: 'SUPPORTED' }), 'json_schema');
  assert.equal(selectResponseFormat({ json_schema: 'UNSUPPORTED', json_object: 'SUPPORTED' }), 'json_object');
  assert.equal(selectResponseFormat({ json_schema: 'INCONCLUSIVE', json_object: 'SUPPORTED' }), 'json_object');

  assert.equal(classifyJsonMode({ httpStatus: 200, jsonParsed: true }), 'SUPPORTED');
  assert.equal(classifyJsonMode({ httpStatus: 200, jsonParsed: false }), 'INCONCLUSIVE');
  assert.equal(classifyJsonMode({ httpStatus: 200, jsonParsed: true, schemaRequired: true, schemaConformed: true }), 'SUPPORTED');
  assert.equal(classifyJsonMode({ httpStatus: 200, jsonParsed: true, schemaRequired: true, schemaConformed: false }), 'INCONCLUSIVE');
  assert.deepEqual(assessJsonMode({ httpStatus: 200, jsonParsed: true, schemaRequired: true, schemaConformed: false }), {
    classification: 'INCONCLUSIVE',
    acceptance: 'ACCEPTED',
    effectiveness: 'NOT_OBSERVABLE',
  });
  assert.equal(conformsToPongSchema({ ok: true }), true);
  assert.equal(conformsToPongSchema({ wrong: true }), false);
  assert.equal(classifyJsonMode({ httpStatus: 400, error: 'response_format is not supported' }), 'UNSUPPORTED');

  assert.equal(classifyInvalidBody({ httpStatus: 400, error: 'messages must be an array' }), 'SUPPORTED');
  assert.equal(classifyInvalidBody({ httpStatus: 200 }), 'UNSUPPORTED');
  assert.equal(classifyInvalidBody({ httpStatus: 400, error: 'x', secretLeaked: true }), 'INCONCLUSIVE');
  assert.equal(classifyInvalidBody(null), 'UNTESTED');

  assert.deepEqual(
    classifyResponseMetadata({
      httpStatus: 200,
      contentType: 'application/json',
      finishReason: 'stop',
      usagePresent: true,
    }),
    { classification: 'SUPPORTED', missing: [] },
  );
  assert.equal(classifyResponseMetadata({ httpStatus: 200, finishReason: 'stop', usagePresent: false, contentType: 'application/json' }).classification, 'INCONCLUSIVE');
  assert.equal(classifyResponseMetadata(null).classification, 'UNTESTED');

  assert.equal(classifyFullStoryboard(null), 'UNTESTED');
  assert.equal(classifyFullStoryboard({
    truncated: true,
    httpStatus: 200,
    finishReason: 'length',
    fixtureMatch: false,
    explicitOutputLimitVerified: false,
  }), 'INCONCLUSIVE');
  assert.equal(classifyFullStoryboard({
    truncated: true,
    httpStatus: 200,
    finishReason: 'length',
    fixtureMatch: false,
    explicitOutputLimitVerified: true,
  }), 'UNSUPPORTED');
  assert.equal(classifyFullStoryboard({
    httpStatus: 200,
    finishReason: 'stop',
    jsonParsed: true,
    schemaValid: true,
    fixtureMatch: false,
    truncated: false,
    explicitOutputLimitVerified: true,
  }), 'INCONCLUSIVE');
  assert.equal(classifyFullStoryboard({
    httpStatus: 200,
    finishReason: 'stop',
    jsonParsed: true,
    schemaValid: true,
    fixtureMatch: true,
    truncated: false,
  }), 'SUPPORTED');
  assert.equal(jsonValuesEqual({ b: 1, a: { d: 2, c: 3 } }, { a: { c: 3, d: 2 }, b: 1 }), true);
  assert.equal(jsonValuesEqual({ frames: [{ dialogue: 'long' }] }, { frames: [{ dialogue: 'short' }] }), false);
  assert.match(storyboardSuitability('UNTESTED'), /Not observed/);
  assert.match(storyboardSuitability('UNSUPPORTED', { explicitOutputLimitVerified: true }), /Chunking or continuation may be required/);
  assert.doesNotMatch(storyboardSuitability('INCONCLUSIVE'), /Chunking or continuation may be required/);
  assert.match(storyboardSuitability('SUPPORTED'), /not an application architecture decision/);
});

test('keeps the synthetic storyboard fixture representative and non-sensitive', () => {
  const document = structureStoryboardFixture();
  const validation = validateStructureProbe(document);
  assert.equal(validation.schemaValid, true, validation.schemaErrors.join('; '));
  const json = fixtureJson();
  const bytes = Buffer.byteLength(json);
  assert.ok(bytes >= 24_000 && bytes <= 36_000, `fixture bytes ${bytes}`);
  assert.match(json, /[А-Яа-яЁё]/);
  assert.equal(document.frames.length, 19);
  assert.equal(document.frames.filter((frame) => frame.derived).length, 2);
  assert.doesNotMatch(json, /Путин|Дуров|Песков|Telegram/);
});

test('plans at most ten live requests and does not put a token in the request shape', () => {
  assert.ok(LIVE_SEQUENCE.length <= MAX_LIVE_REQUESTS);
  assert.equal(LIVE_SEQUENCE.length, 9);
  assert.equal(new Set(LIVE_SEQUENCE).size, LIVE_SEQUENCE.length);
  const body = buildRequest('reasoning_effort_low', { model: 'probe-model', extraBody: { temperature: 0 } });
  const shape = requestShape(body, { endpointPath: '/openai/v1/chat/completions' });
  assert.equal(shape.path, '/openai/v1/chat/completions');
  assert.throws(() => requestShape(body), /resolved endpoint path/);
  assert.equal(shape.reasoning_effort, 'low');
  assert.deepEqual(shape.bodyKeys, ['messages', 'model', 'reasoning_effort', 'temperature']);
  assert.equal(JSON.stringify(shape).includes(TOKEN), false);
  const invalid = buildRequest('invalid_body', { model: 'probe-model' });
  assert.equal(Array.isArray(invalid.messages), false);
  assert.equal(requestShape(invalid, { endpointPath: '/v1/chat/completions' }).messagesType, 'object');
});

const EXTRA_SECRET = 'configured-extra-secret';

function probeId(body) {
  const content = Array.isArray(body.messages) ? body.messages[0]?.content ?? '' : '';
  if (content.startsWith('Верни ровно')) return 'full_structure_storyboard';
  if (!Array.isArray(body.messages)) return 'invalid_body';
  if (body.response_format?.type === 'json_schema') return 'json_schema';
  if (body.response_format?.type === 'json_object') return 'json_object';
  if (body.max_completion_tokens === 16) return 'output_limit_max_completion_tokens';
  if ('max_tokens' in body) return 'output_limit_max_tokens';
  if (body.reasoning_effort === 'low') return 'reasoning_effort_low';
  if (body.reasoning_effort === 'medium') return 'reasoning_effort_medium';
  return 'minimal';
}

function writeChat(res, content, { finishReason = 'stop', completionTokens = 1, status = 200, error } = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  if (status >= 400) {
    res.end(JSON.stringify({ error: { message: error } }));
    return;
  }
  res.end(JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 8, completion_tokens: completionTokens, total_tokens: 8 + completionTokens },
  }));
}

async function runMatrixAgainst(responder) {
  const fixtureText = fixtureJson();
  const seen = [];
  const report = await withServer(async (req, res) => {
    const body = JSON.parse(await readRequest(req));
    seen.push({ url: req.url, body });
    responder(probeId(body), body, res, fixtureText);
  }, (baseUrl) => runLiveMatrix({
    config: {
      baseUrl: `${baseUrl}/gateway`,
      token: TOKEN,
      model: 'probe-model',
      timeoutMs: 2000,
      extraBody: { tenant: EXTRA_SECRET },
    },
    fixtureText,
    fetchImpl: globalThis.fetch,
  }));
  return { report, seen, fixtureText };
}

function assertNineInOrder(seen) {
  assert.deepEqual(seen.map((item) => probeId(item.body)), LIVE_SEQUENCE);
  assert.equal(seen.length, 9);
  for (const item of seen) {
    assert.equal(item.url, '/gateway/v1/chat/completions');
  }
}

function assertReportHidesSecrets(report) {
  const rendered = `${formatReport(report)}\n${JSON.stringify(report)}`;
  assert.equal(rendered.includes(TOKEN), false);
  assert.equal(rendered.includes(EXTRA_SECRET), false);
  assert.equal(rendered.includes('127.0.0.1'), false);
  assertReportHasNoSecrets(rendered, [TOKEN, EXTRA_SECRET]);
  for (const observation of report.observations) {
    assert.equal(observation.requestShape.path, '/gateway/v1/chat/completions');
  }
}

test('runs the live matrix once against a fake server', async () => {
  const exact = await runMatrixAgainst((id, body, res, fixtureText) => {
    if (id === 'invalid_body') {
      writeChat(res, '', { status: 400, error: `bad ${TOKEN} ${EXTRA_SECRET}` });
      return;
    }
    if (id === 'output_limit_max_tokens' || id === 'output_limit_max_completion_tokens') {
      writeChat(res, '1 2 3', { finishReason: 'length', completionTokens: 16 });
      return;
    }
    if (id === 'json_object' || id === 'json_schema') {
      writeChat(res, '{"ok":true}');
      return;
    }
    if (id === 'full_structure_storyboard') {
      writeChat(res, fixtureText);
      return;
    }
    writeChat(res, 'pong');
  });
  assertNineInOrder(exact.seen);
  const story = exact.seen.at(-1).body;
  assert.equal(story.max_completion_tokens, fixtureOutputLimit(exact.fixtureText));
  assert.equal(story.response_format.type, 'json_schema');
  assert.equal('max_tokens' in story, false);
  assert.equal(exact.report.requestsAttempted, 9);
  assert.equal(exact.report.capabilities.full_structure_storyboard, 'SUPPORTED');
  assert.equal(exact.report.capabilities.reasoning_effort_low, 'INCONCLUSIVE');
  const reasoning = exact.report.observations.find((item) => item.id === 'reasoning_effort_low');
  assert.equal(reasoning.acceptance, 'ACCEPTED');
  assert.equal(reasoning.effectiveness, 'NOT_OBSERVABLE');
  const measured = exact.report.observations.find((item) => item.id === 'full_structure_storyboard_strict');
  assert.equal(exact.report.observations.some((item) => item.id === 'full_structure_storyboard_json_object_fallback'), false);
  assert.equal(measured.fixtureMatch, true);
  assert.equal(measured.schemaValid, true);
  assert.equal(measured.truncated, false);
  assert.equal(measured.frameCount, 19);
  assert.equal(measured.actualByteLength, measured.expectedByteLength);
  assert.equal(measured.actualCharLength, measured.expectedCharLength);
  assert.equal(measured.requestShape.outputLimit.field, 'max_completion_tokens');
  assert.equal(measured.requestShape.outputLimit.verified, true);
  assert.equal(exact.report.compatibleFullPayloadFormat, 'json_schema');
  assert.equal(exact.report.capabilities.json_schema, 'SUPPORTED');
  assertReportHidesSecrets(exact.report);

  const shorter = await runMatrixAgainst((id, body, res, fixtureText) => {
    if (id === 'invalid_body') {
      writeChat(res, '', { status: 400, error: 'messages must be an array' });
      return;
    }
    if (id === 'output_limit_max_tokens' || id === 'output_limit_max_completion_tokens') {
      writeChat(res, '1 2 3', { finishReason: 'length', completionTokens: 16 });
      return;
    }
    if (id === 'json_object' || id === 'json_schema') {
      writeChat(res, '{"ok":true}');
      return;
    }
    if (id === 'full_structure_storyboard') {
      const document = JSON.parse(fixtureText);
      document.frames[0].dialogue = 'Коротко.';
      writeChat(res, JSON.stringify(document));
      return;
    }
    writeChat(res, 'pong');
  });
  assert.equal(shorter.seen.length, 10);
  assert.equal(shorter.report.requestsAttempted, 10);
  assert.equal(shorter.seen.at(-2).body.response_format.type, 'json_schema');
  assert.equal(shorter.seen.at(-1).body.response_format.type, 'json_object');
  assert.equal(shorter.seen.at(-1).body.max_completion_tokens, fixtureOutputLimit(shorter.fixtureText));
  assert.equal(shorter.seen.at(-1).body.messages[0].content, shorter.seen.at(-2).body.messages[0].content);
  const shortened = shorter.report.observations.find((item) => item.id === 'full_structure_storyboard_strict');
  const shortenedFallback = shorter.report.observations.find((item) => item.id === 'full_structure_storyboard_json_object_fallback');
  assert.equal(shortened.schemaValid, true);
  assert.equal(shortened.fixtureMatch, false);
  assert.equal(shortened.truncated, false);
  assert.equal(shortenedFallback.fixtureMatch, false);
  assert.ok(shortened.actualByteLength < shortened.expectedByteLength);
  assert.equal(shorter.report.capabilities.full_structure_storyboard, 'INCONCLUSIVE');
  assert.equal(shorter.report.capabilities.json_schema, 'SUPPORTED');
  assert.equal(shorter.report.compatibleFullPayloadFormat, null);
  assert.doesNotMatch(shorter.report.storyboardSuitability, /Chunking or continuation may be required/);
  assertReportHidesSecrets(shorter.report);

  const cappedByDefault = await runMatrixAgainst((id, body, res, fixtureText) => {
    if (id === 'output_limit_max_tokens') {
      writeChat(res, '', { status: 400, error: 'Unsupported parameter: max_tokens' });
      return;
    }
    if (id === 'output_limit_max_completion_tokens') {
      writeChat(res, '', { status: 400, error: 'Unsupported parameter: max_completion_tokens' });
      return;
    }
    if (id === 'invalid_body') {
      writeChat(res, '', { status: 400, error: 'messages must be an array' });
      return;
    }
    if (id === 'json_object' || id === 'json_schema') {
      writeChat(res, '{"ok":true}');
      return;
    }
    if (id === 'full_structure_storyboard') {
      writeChat(res, fixtureText.slice(0, 40), { finishReason: 'length', completionTokens: 12 });
      return;
    }
    writeChat(res, 'pong');
  });
  assert.equal(cappedByDefault.seen.length, 10);
  const defaultStory = cappedByDefault.seen.at(-2).body;
  const defaultFallback = cappedByDefault.seen.at(-1).body;
  assert.equal('max_tokens' in defaultStory, false);
  assert.equal('max_completion_tokens' in defaultStory, false);
  assert.equal('max_completion_tokens' in defaultFallback, false);
  assert.equal(defaultStory.response_format.type, 'json_schema');
  assert.equal(defaultFallback.response_format.type, 'json_object');
  const truncated = cappedByDefault.report.observations.find((item) => item.id === 'full_structure_storyboard_strict');
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.explicitOutputLimitVerified, false);
  assert.equal(truncated.fixtureMatch, false);
  assert.equal(cappedByDefault.report.capabilities.full_structure_storyboard, 'INCONCLUSIVE');
  assert.equal(cappedByDefault.report.capabilities.output_limit_max_completion_tokens, 'UNSUPPORTED');
  assert.doesNotMatch(cappedByDefault.report.storyboardSuitability, /Chunking or continuation may be required/);
  assertReportHidesSecrets(cappedByDefault.report);
});

test('does not treat a non-conforming json_schema object as verified', async () => {
  const run = await runMatrixAgainst((id, body, res, fixtureText) => {
    if (id === 'invalid_body') {
      writeChat(res, '', { status: 400, error: 'messages must be an array' });
      return;
    }
    if (id === 'output_limit_max_tokens' || id === 'output_limit_max_completion_tokens') {
      writeChat(res, '1 2 3', { finishReason: 'length', completionTokens: 16 });
      return;
    }
    if (id === 'json_schema') {
      writeChat(res, '{"wrong":true}');
      return;
    }
    if (id === 'json_object') {
      writeChat(res, '{"ok":true}');
      return;
    }
    if (id === 'full_structure_storyboard') {
      writeChat(res, fixtureText);
      return;
    }
    writeChat(res, 'pong');
  });
  assertNineInOrder(run.seen);
  const schemaProbe = run.report.observations.find((item) => item.id === 'json_schema');
  assert.equal(schemaProbe.schemaConformed, false);
  assert.equal(schemaProbe.jsonParsed, true);
  assert.equal(schemaProbe.acceptance, 'ACCEPTED');
  assert.equal(schemaProbe.effectiveness, 'NOT_OBSERVABLE');
  assert.notEqual(schemaProbe.effectiveness, 'OBSERVED');
  assert.equal(run.report.capabilities.json_schema, 'INCONCLUSIVE');
  assert.equal(run.report.capabilities.json_object, 'SUPPORTED');
  assert.equal(run.seen.at(-1).body.response_format.type, 'json_object');
  assert.equal(run.report.observations.some((item) => item.id === 'full_structure_storyboard_json_object_fallback'), false);
  assertReportHidesSecrets(run.report);
});

test('uses one json_object fallback after a failed strict full storyboard', async () => {
  const failedStrict = await runMatrixAgainst((id, body, res, fixtureText) => {
    if (id === 'invalid_body') {
      writeChat(res, '', { status: 400, error: 'messages must be an array' });
      return;
    }
    if (id === 'output_limit_max_tokens' || id === 'output_limit_max_completion_tokens') {
      writeChat(res, '1 2 3', { finishReason: 'length', completionTokens: 16 });
      return;
    }
    if (id === 'json_object' || id === 'json_schema') {
      writeChat(res, '{"ok":true}');
      return;
    }
    if (id === 'full_structure_storyboard' && body.response_format?.type === 'json_schema') {
      writeChat(res, '', { status: 400, error: 'Invalid JSON' });
      return;
    }
    if (id === 'full_structure_storyboard' && body.response_format?.type === 'json_object') {
      writeChat(res, fixtureText);
      return;
    }
    writeChat(res, 'pong');
  });
  assert.equal(failedStrict.seen.length, 10);
  assert.equal(failedStrict.report.requestsAttempted, 10);
  const strictBody = failedStrict.seen.at(-2).body;
  const fallbackBody = failedStrict.seen.at(-1).body;
  assert.equal(strictBody.response_format.type, 'json_schema');
  assert.equal(fallbackBody.response_format.type, 'json_object');
  assert.equal(fallbackBody.max_completion_tokens, strictBody.max_completion_tokens);
  assert.equal(fallbackBody.max_completion_tokens, fixtureOutputLimit(failedStrict.fixtureText));
  assert.equal(fallbackBody.messages[0].content, strictBody.messages[0].content);
  const strictObs = failedStrict.report.observations.find((item) => item.id === 'full_structure_storyboard_strict');
  const fallbackObs = failedStrict.report.observations.find((item) => item.id === 'full_structure_storyboard_json_object_fallback');
  assert.equal(strictObs.httpStatus, 400);
  assert.equal(strictObs.fixtureMatch, false);
  assert.equal(fallbackObs.fixtureMatch, true);
  assert.equal(fallbackObs.schemaValid, true);
  assert.equal(fallbackObs.truncated, false);
  assert.equal(fallbackObs.finishReason, 'stop');
  assert.equal(fallbackObs.usagePresent, true);
  assert.equal(fallbackObs.outputLimitField, strictObs.outputLimitField);
  assert.equal(fallbackObs.outputLimitValue, strictObs.outputLimitValue);
  assert.equal(failedStrict.report.capabilities.full_structure_storyboard, 'SUPPORTED');
  assert.equal(failedStrict.report.capabilities.json_schema, 'SUPPORTED');
  assert.match(failedStrict.report.largeStrictSchemaNote, /Small json_schema compatibility was observed/);
  assert.match(failedStrict.report.largeStrictSchemaNote, /Large strict-schema compatibility was not/);
  assert.equal(failedStrict.report.compatibleFullPayloadFormat, 'json_object');
  assert.match(failedStrict.report.planningNote, /local validation and bounded repair/);
  assertReportHidesSecrets(failedStrict.report);

  const alteredFallback = await runMatrixAgainst((id, body, res, fixtureText) => {
    if (id === 'invalid_body') {
      writeChat(res, '', { status: 400, error: 'messages must be an array' });
      return;
    }
    if (id === 'output_limit_max_tokens' || id === 'output_limit_max_completion_tokens') {
      writeChat(res, '1 2 3', { finishReason: 'length', completionTokens: 16 });
      return;
    }
    if (id === 'json_object' || id === 'json_schema') {
      writeChat(res, '{"ok":true}');
      return;
    }
    if (id === 'full_structure_storyboard' && body.response_format?.type === 'json_schema') {
      writeChat(res, '', { status: 400, error: 'Invalid JSON' });
      return;
    }
    if (id === 'full_structure_storyboard' && body.response_format?.type === 'json_object') {
      const document = JSON.parse(fixtureText);
      document.frames[0].dialogue = 'Коротко.';
      writeChat(res, JSON.stringify(document));
      return;
    }
    writeChat(res, 'pong');
  });
  assert.equal(alteredFallback.seen.length, 10);
  assert.equal(alteredFallback.report.capabilities.full_structure_storyboard, 'INCONCLUSIVE');
  assert.equal(alteredFallback.report.compatibleFullPayloadFormat, null);
  assert.equal(alteredFallback.report.capabilities.json_schema, 'SUPPORTED');
  const altered = alteredFallback.report.observations.find((item) => item.id === 'full_structure_storyboard_json_object_fallback');
  assert.equal(altered.schemaValid, true);
  assert.equal(altered.fixtureMatch, false);
  assertReportHidesSecrets(alteredFallback.report);
});

test('skips the live suite when configuration is absent', () => {
  assert.equal(readLiveConfig({}).status, 'SKIPPED');
  assert.deepEqual(readLiveConfig({}).missing, ['BASE_URL', 'CONTEST_API_TOKEN', 'CONTEST_MODEL']);
  const report = skippedReport(readLiveConfig({}));
  const rendered = formatReport(report);
  assert.match(rendered, /LIVE SKIPPED/);
  assert.match(rendered, /No capability was verified/);
  assert.equal(rendered.includes('SUPPORTED'), false);
  assert.equal(report.requestsAttempted, 0);
  for (const value of Object.values(report.capabilities)) assert.equal(value, 'UNTESTED');

  const reportPath = join(mkdtempSync(join(tmpdir(), 'contest-spike-')), 'report.json');
  const env = { ...process.env };
  for (const name of ['BASE_URL', 'CONTEST_API_TOKEN', 'CONTEST_MODEL', 'CONTEST_REQUEST_JSON', 'CONTEST_TIMEOUT_MS']) {
    delete env[name];
  }
  env.CONTEST_REPORT_PATH = reportPath;
  const result = spawnSync(process.execPath, ['spikes/contest-chat-completions/live.mjs'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LIVE SKIPPED/);
  assert.equal(result.stdout.includes('SUPPORTED'), false);
  assert.equal(result.stdout.includes(TOKEN), false);
  assertReportHasNoSecrets(result.stdout, [TOKEN, 'super-secret-token-value']);
  assert.throws(
    () => assertReportHasNoSecrets('leaked super-secret-token-value', ['super-secret-token-value']),
    /configured secret/,
  );
});
