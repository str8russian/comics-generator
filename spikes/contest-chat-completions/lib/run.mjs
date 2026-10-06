import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { postChatCompletion } from './client.mjs';
import {
  assessJsonMode,
  assessOutputLimit,
  assessReasoning,
  classifyFullStoryboard,
  classifyInvalidBody,
  classifyMinimal,
  classifyResponseMetadata,
  looksLikeParameterRejection,
  storyboardSuitability,
} from './classify.mjs';
import { jsonValuesEqual, tryParseJson, validateStructureProbe } from './validate-probe.mjs';

export const MAX_LIVE_REQUESTS = 10;
export const OUTPUT_LIMIT_PROBE = 16;

export function fixtureOutputLimit(fixtureText) {
  return String(fixtureText ?? '').length + 512;
}

export const LIVE_SEQUENCE = [
  'minimal',
  'reasoning_effort_low',
  'reasoning_effort_medium',
  'output_limit_max_tokens',
  'output_limit_max_completion_tokens',
  'json_object',
  'json_schema',
  'invalid_body',
  'full_structure_storyboard',
];

const CAPABILITY_IDS = [
  'minimal',
  'reasoning_effort_low',
  'reasoning_effort_medium',
  'output_limit_max_tokens',
  'output_limit_max_completion_tokens',
  'json_object',
  'json_schema',
  'invalid_body',
  'response_metadata',
  'full_structure_storyboard',
];

const PONG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};

const pongSchemaConforms = new Ajv({ allErrors: true, strict: true }).compile(structuredClone(PONG_SCHEMA));

export function conformsToPongSchema(value) {
  return pongSchemaConforms(value) === true;
}

const probeSchema = JSON.parse(readFileSync(
  fileURLToPath(new URL('../fixture/structure-probe.schema.json', import.meta.url)),
  'utf8',
));

export function buildRequest(id, { model, extraBody = {}, fixtureText = '', responseFormat = null, outputLimit = null }) {
  const base = { ...extraBody, model };
  const user = (content) => ({ ...base, messages: [{ role: 'user', content }] });
  switch (id) {
    case 'minimal':
      return user('Reply with the single word pong.');
    case 'reasoning_effort_low':
      return { ...user('Reply with the single word pong.'), reasoning_effort: 'low' };
    case 'reasoning_effort_medium':
      return { ...user('Reply with the single word pong.'), reasoning_effort: 'medium' };
    case 'output_limit_max_tokens':
      return {
        ...user('Write the integers from 1 to 400 separated by single spaces.'),
        max_tokens: OUTPUT_LIMIT_PROBE,
      };
    case 'output_limit_max_completion_tokens':
      return {
        ...user('Write the integers from 1 to 400 separated by single spaces.'),
        max_completion_tokens: OUTPUT_LIMIT_PROBE,
      };
    case 'json_object':
      return {
        ...user('Reply with a JSON object {"ok":true} and nothing else.'),
        response_format: { type: 'json_object' },
      };
    case 'json_schema':
      return {
        ...user('Reply with JSON that matches the schema.'),
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'pong', strict: true, schema: PONG_SCHEMA },
        },
      };
    case 'invalid_body':
      return { ...base, messages: { role: 'user', content: 'ping' } };
    case 'full_structure_storyboard': {
      const body = user(`Верни ровно следующий JSON-документ и ничего больше. Не добавляй Markdown.\n${fixtureText}`);
      if (responseFormat) body.response_format = responseFormat;
      if (outputLimit?.verified && outputLimit.field && Number.isInteger(outputLimit.value)) {
        body[outputLimit.field] = outputLimit.value;
      }
      return body;
    }
    default:
      throw new Error(`unknown probe ${id}`);
  }
}

export function requestShape(body, { endpointPath, outputLimitVerified = false } = {}) {
  if (typeof endpointPath !== 'string' || !endpointPath.startsWith('/') || endpointPath.includes('?') || endpointPath.includes('://')) {
    throw new Error('request shape requires the resolved endpoint path');
  }
  const shape = {
    method: 'POST',
    path: endpointPath,
    bodyKeys: Object.keys(body).sort(),
    model: body.model ?? null,
    messagesType: Array.isArray(body.messages) ? 'array' : (body.messages == null ? null : typeof body.messages),
    messageCount: Array.isArray(body.messages) ? body.messages.length : null,
    messageRoles: Array.isArray(body.messages) ? body.messages.map((message) => message?.role ?? null) : null,
  };
  if ('reasoning_effort' in body) shape.reasoning_effort = body.reasoning_effort;
  if (body.response_format) shape.response_format = body.response_format.type ?? null;
  if ('max_completion_tokens' in body) {
    shape.outputLimit = { field: 'max_completion_tokens', value: body.max_completion_tokens, verified: outputLimitVerified === true };
  } else if ('max_tokens' in body) {
    shape.outputLimit = { field: 'max_tokens', value: body.max_tokens, verified: outputLimitVerified === true };
  } else if (outputLimitVerified === false) {
    shape.outputLimit = { field: null, value: null, verified: false };
  }
  return shape;
}

function publicObservation(id, body, result, extra = {}) {
  const { outputLimitVerified, ...rest } = extra;
  return {
    id,
    requestShape: requestShape(body, { endpointPath: result.endpointPath, outputLimitVerified }),
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    finishReason: result.finishReason,
    hasContent: result.hasContent,
    usagePresent: result.usagePresent,
    usageFields: result.usage ? Object.keys(result.usage).sort() : [],
    reasoningEffortEcho: result.reasoningEffortEcho ?? null,
    reasoningTokens: result.reasoningTokens ?? null,
    error: result.error,
    transportError: result.transportError,
    ...rest,
  };
}

export function selectVerifiedOutputLimit(effectivenessByField) {
  if (effectivenessByField.max_completion_tokens === 'OBSERVED') return 'max_completion_tokens';
  if (effectivenessByField.max_tokens === 'OBSERVED') return 'max_tokens';
  return null;
}

export function selectResponseFormat(capabilities) {
  if (capabilities.json_schema === 'SUPPORTED') return 'json_schema';
  if (capabilities.json_object === 'SUPPORTED') return 'json_object';
  return null;
}

function configuredSecrets(config) {
  const secrets = [];
  if (typeof config.token === 'string') secrets.push(config.token);
  for (const value of Object.values(config.extraBody ?? {})) {
    if (typeof value === 'string') secrets.push(value);
  }
  return secrets;
}

function sizeRejected(result) {
  if (result.httpStatus === 413) return true;
  return result.httpStatus >= 400
    && /context length|maximum context|too large|too long|payload too|request entity/i.test(result.error ?? '');
}

function responseFormatBody(kind) {
  if (kind === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: { name: 'structure_probe', strict: true, schema: probeSchema },
    };
  }
  if (kind === 'json_object') return { type: 'json_object' };
  return null;
}

export function skippedReport(config) {
  return {
    spike: 'contest-chat-completions',
    live: 'SKIPPED',
    reason: config.reason,
    missing: config.missing ?? [],
    requestsAttempted: 0,
    capabilities: Object.fromEntries(CAPABILITY_IDS.map((id) => [id, 'UNTESTED'])),
    observations: [],
    storyboardSuitability: storyboardSuitability('UNTESTED'),
  };
}

export async function runLiveMatrix({ config, fixtureText, fetchImpl }) {
  if (LIVE_SEQUENCE.length > MAX_LIVE_REQUESTS) throw new Error('live plan exceeds the request cap');
  let attempted = 0;
  const observations = [];
  const capabilities = {};

  async function send(id, body) {
    if (attempted >= MAX_LIVE_REQUESTS) throw new Error('refusing to exceed 10 live requests');
    attempted += 1;
    return postChatCompletion({
      baseUrl: config.baseUrl,
      token: config.token,
      body,
      timeoutMs: config.timeoutMs,
      fetchImpl,
      secrets: configuredSecrets(config),
    });
  }

  const ctx = { model: config.model, extraBody: config.extraBody ?? {}, fixtureText };

  const minimalBody = buildRequest('minimal', ctx);
  const minimal = await send('minimal', minimalBody);
  capabilities.minimal = classifyMinimal(minimal);
  observations.push(publicObservation('minimal', minimalBody, minimal));

  const limitEffectiveness = {};
  for (const id of ['reasoning_effort_low', 'reasoning_effort_medium']) {
    const body = buildRequest(id, ctx);
    const result = await send(id, body);
    const assessment = assessReasoning({
      transportError: result.transportError,
      httpStatus: result.httpStatus,
      error: result.error,
      parameterRejected: looksLikeParameterRejection('reasoning_effort', result.error),
      requestedEffort: body.reasoning_effort,
      reasoningEffortEcho: result.reasoningEffortEcho,
    });
    capabilities[id] = assessment.classification;
    observations.push(publicObservation(id, body, result, {
      acceptance: assessment.acceptance,
      effectiveness: assessment.effectiveness,
    }));
  }

  for (const [id, field] of [
    ['output_limit_max_tokens', 'max_tokens'],
    ['output_limit_max_completion_tokens', 'max_completion_tokens'],
  ]) {
    const body = buildRequest(id, ctx);
    const result = await send(id, body);
    const assessment = assessOutputLimit({
      field,
      transportError: result.transportError,
      httpStatus: result.httpStatus,
      error: result.error,
      parameterRejected: looksLikeParameterRejection(field, result.error),
      finishReason: result.finishReason,
      completionTokens: result.usage?.completion_tokens,
      contentLength: result.content?.length ?? 0,
      limit: OUTPUT_LIMIT_PROBE,
    });
    capabilities[id] = assessment.classification;
    limitEffectiveness[field] = assessment.effectiveness;
    observations.push(publicObservation(id, body, result, {
      acceptance: assessment.acceptance,
      effectiveness: assessment.effectiveness,
    }));
  }

  for (const id of ['json_object', 'json_schema']) {
    const body = buildRequest(id, ctx);
    const result = await send(id, body);
    const parsed = tryParseJson(result.content);
    const jsonParsed = Boolean(
      result.ok
      && parsed.jsonParsed
      && parsed.value !== null
      && typeof parsed.value === 'object'
      && !Array.isArray(parsed.value)
    );
    const schemaRequired = id === 'json_schema';
    const schemaConformed = schemaRequired && jsonParsed ? conformsToPongSchema(parsed.value) : (schemaRequired ? false : null);
    const flags = {
      transportError: result.transportError,
      httpStatus: result.httpStatus,
      error: result.error,
      parameterRejected: looksLikeParameterRejection('response_format', result.error)
        || looksLikeParameterRejection(id, result.error),
      jsonParsed,
      schemaRequired,
      schemaConformed: schemaConformed === true,
    };
    const assessment = assessJsonMode(flags);
    capabilities[id] = assessment.classification;
    observations.push(publicObservation(id, body, result, {
      jsonParsed,
      schemaConformed,
      compatibility: schemaRequired
        ? 'observed compatibility with the requested schema; one conforming response does not prove universal server-side enforcement'
        : 'parsed JSON object only; this probe cannot distinguish server enforcement from the model following the prompt',
      acceptance: assessment.acceptance,
      effectiveness: assessment.effectiveness,
    }));
  }

  const invalidBody = buildRequest('invalid_body', ctx);
  const invalid = await send('invalid_body', invalidBody);
  const secretLeaked = configuredSecrets(config).some((secret) => secret.length >= 8 && (invalid.error ?? '').includes(secret));
  capabilities.invalid_body = classifyInvalidBody({
    transportError: invalid.transportError,
    httpStatus: invalid.httpStatus,
    error: invalid.error,
    secretLeaked,
  });
  observations.push(publicObservation('invalid_body', invalidBody, invalid));

  const metadataSource = observations.find((item) => (
    item.id !== 'invalid_body'
    && item.httpStatus >= 200
    && item.httpStatus < 300
    && item.hasContent
  ));
  const metadata = classifyResponseMetadata(metadataSource ?? null);
  capabilities.response_metadata = metadata.classification;

  const outputLimitField = selectVerifiedOutputLimit(limitEffectiveness);
  const outputLimit = outputLimitField
    ? { field: outputLimitField, value: fixtureOutputLimit(fixtureText), verified: true }
    : { field: null, value: null, verified: false };
  const responseFormat = responseFormatBody(selectResponseFormat(capabilities));
  const storyBody = buildRequest('full_structure_storyboard', { ...ctx, responseFormat, outputLimit });
  const story = await send('full_structure_storyboard', storyBody);
  const parsedStory = tryParseJson(story.content);
  const expectedValue = JSON.parse(fixtureText);
  const validation = parsedStory.jsonParsed ? validateStructureProbe(parsedStory.value) : { schemaValid: false, schemaErrors: ['response was not JSON'] };
  const fixtureMatch = parsedStory.jsonParsed && jsonValuesEqual(parsedStory.value, expectedValue);
  const truncated = story.finishReason === 'length';
  const sizeWasRejected = sizeRejected(story);
  const content = story.content ?? '';
  const storyObs = {
    transportError: story.transportError,
    httpStatus: story.httpStatus,
    finishReason: story.finishReason,
    jsonParsed: parsedStory.jsonParsed,
    schemaValid: validation.schemaValid,
    fixtureMatch,
    truncated,
    sizeRejected: sizeWasRejected,
    explicitOutputLimitVerified: outputLimit.verified,
  };
  capabilities.full_structure_storyboard = classifyFullStoryboard(storyObs);
  observations.push(publicObservation('full_structure_storyboard', storyBody, story, {
    outputLimitVerified: outputLimit.verified,
    expectedByteLength: Buffer.byteLength(fixtureText),
    actualByteLength: Buffer.byteLength(content),
    expectedCharLength: fixtureText.length,
    actualCharLength: content.length,
    jsonParsed: parsedStory.jsonParsed,
    schemaValid: validation.schemaValid,
    schemaErrorCount: validation.schemaErrors.length,
    fixtureMatch,
    truncated,
    explicitOutputLimitVerified: outputLimit.verified,
    frameCount: Array.isArray(parsedStory.value?.frames) ? parsedStory.value.frames.length : null,
  }));

  if (attempted !== LIVE_SEQUENCE.length) throw new Error('live request count did not match the plan');

  return {
    spike: 'contest-chat-completions',
    live: 'EXECUTED',
    reason: null,
    missing: [],
    requestsAttempted: attempted,
    capabilities,
    responseMetadataMissing: metadata.missing,
    observations,
    storyboardSuitability: storyboardSuitability(capabilities.full_structure_storyboard, {
      explicitOutputLimitVerified: outputLimit.verified,
    }),
  };
}

export function formatReport(report) {
  const lines = [
    `LIVE ${report.live}`,
    report.reason ? `Reason: ${report.reason}` : null,
    report.missing?.length ? `Missing: ${report.missing.join(', ')}` : null,
    `Requests attempted: ${report.requestsAttempted}`,
    'Capabilities:',
    ...Object.entries(report.capabilities).map(([name, value]) => {
      const observation = (report.observations ?? []).find((item) => item.id === name);
      if (!observation?.acceptance) return `- ${name}: ${value}`;
      return `- ${name}: ${value} (acceptance ${observation.acceptance}; effectiveness ${observation.effectiveness})`;
    }),
    `Storyboard output: ${report.storyboardSuitability}`,
  ];
  if (report.live === 'SKIPPED') lines.push('No capability was verified.');
  for (const observation of report.observations ?? []) {
    lines.push(JSON.stringify(observation));
  }
  return `${lines.filter((line) => line != null).join('\n')}\n`;
}

export function assertReportHasNoSecrets(serialized, secrets) {
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8 && serialized.includes(secret)) {
      throw new Error('refusing to emit a report that still contains a configured secret');
    }
  }
}
