import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MODEL, PROMPT_TWEAK_LIMIT, VERDICTS, TECHNIQUES, ASPECT_RATIOS } from './constants.mjs';
import { describeImage, extensionForMime } from './image-info.mjs';
import { redact } from './redact.mjs';
import { assertAssignment, readReferenceFile } from './catalog.mjs';
import { assertWorkflowInputs, sortInputs } from './prompt.mjs';
import { buildRequest } from './transport.mjs';
import { sendProviderRequest } from './client.mjs';

const RATING_KEYS = [
  'identity_preservation',
  'style_anchor_match',
  'expression',
  'gaze_direction',
  'head_angle',
  'pose_silhouette',
  'shot_crop',
  'performance_compliance',
  'identity_leakage_absent',
  'panel_scale_difference',
  'survives_crop',
];

const RATING_VALUES = new Set(['pass', 'fail', 'unsure', 'not-applicable']);
const BLOCKING_KEYS = ['identity_substitution', 'wrong_gaze', 'photorealism_drift', 'crop_loss'];

export function createRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

function httpError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function assertShapeReady(profile, imageCount) {
  if (profile.transport?.status !== 'verified') {
    throw httpError('image API request shape is not verified', 'shape-unknown', 409);
  }
  if (imageCount > 0 && profile.reference_images !== 'verified') {
    throw httpError('reference image handling is not verified', 'references-unverified', 409);
  }
  if (imageCount > (profile.reference_image_count_verified ?? 0)) {
    throw httpError('this reference count is above the verified maximum', 'references-unverified', 409);
  }
}

export function assertRetryAllowed(store, retryOf) {
  if (!retryOf) return null;
  const technique = retryOf.technique;
  if (!TECHNIQUES.includes(technique)) throw httpError('unknown retry technique', 'retry', 400);
  const failureClass = String(retryOf.failure_class ?? '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(failureClass) || failureClass.length > 60) {
    throw httpError('failure class must be a short hyphenated label', 'retry', 400);
  }
  const normalized = { technique, failure_class: failureClass, run_id: retryOf.run_id ?? null };
  if (technique !== 'prompt-tweak') return normalized;
  const count = store.listManifests().filter((item) => (
    item.retry_of?.technique === 'prompt-tweak' && item.retry_of?.failure_class === failureClass
  )).length;
  if (count >= PROMPT_TWEAK_LIMIT) {
    const limitations = store.readLimitations();
    limitations.push({
      at: new Date().toISOString(),
      failure_class: failureClass,
      attempt_count: count,
      note: 'Prompt tweaks stopped for this failure class. Change technique.',
    });
    store.writeLimitations(limitations);
    throw httpError('prompt-tweak limit reached for this failure class', 'prompt-tweak-limit', 409);
  }
  return normalized;
}

export function publicManifest(manifest) {
  const clone = structuredClone(manifest);
  clone.inputs = (clone.inputs ?? []).map((input) => {
    const { local_path: _local, ...rest } = input;
    return rest;
  });
  if (clone.output) {
    const { absolute_path: _absolute, ...rest } = clone.output;
    clone.output = rest;
  }
  return clone;
}

function isMachinePath(value) {
  return value.startsWith('/Users/')
    || value.startsWith('/home/')
    || value.startsWith('/var/')
    || value.startsWith('/tmp/')
    || value.startsWith('/private/')
    || /^[A-Za-z]:\\/.test(value);
}

function stripMachinePaths(value) {
  if (Array.isArray(value)) return value.map(stripMachinePaths);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    if (isMachinePath(value)) return '[path]';
    return value;
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'local_path' || key === 'absolute_path') continue;
    out[key] = stripMachinePaths(entry);
  }
  return out;
}

export function buildEvidence(store, redactWith) {
  const payload = {
    model: MODEL,
    campaign: store.readCampaign(),
    capability: store.readCapability(),
    attempts: store.listAttempts(),
    limitations: store.readLimitations(),
    runs: store.listManifests().map(publicManifest),
  };
  return stripMachinePaths(JSON.parse(redact(JSON.stringify(payload), redactWith)));
}

export async function executeRun({
  config,
  store,
  catalog,
  profile,
  fetchImpl,
  redactWith,
  body,
  now = new Date(),
}) {
  if (!config?.configured) throw httpError(config?.reason || 'live configuration is absent', 'not-configured', 400);
  const prompt = String(body.prompt ?? '').trim();
  if (!prompt || prompt.length > 20_000) throw httpError('prompt must be 1 to 20000 characters', 'prompt', 400);
  if (!ASPECT_RATIOS.includes(body.aspect_ratio)) throw httpError('target aspect ratio is not one of the research ratios', 'aspect-ratio', 400);
  const inputs = sortInputs(body.inputs ?? []);
  if (!inputs.length) throw httpError('at least one reference is required', 'references', 400);
  assertWorkflowInputs(body.workflow, inputs);
  assertShapeReady(profile, inputs.length);
  const retryOf = assertRetryAllowed(store, body.retry_of ?? null);
  const sendAspect = profile.aspect_ratio === 'accepted';
  const prepared = inputs.map((input) => {
    const entry = assertAssignment(catalog, input);
    const buffer = readReferenceFile(entry, catalog, readFileSync);
    const described = describeImage(buffer);
    return {
      id: entry.id,
      role: input.role,
      mime: described.mime,
      width: described.width,
      height: described.height,
      sha256: described.sha256,
      local_path: entry.local_path,
      buffer,
    };
  });
  const runId = createRunId(now);
  const request = buildRequest({
    shape: profile.transport.shape,
    endpointPath: profile.transport.endpoint_path,
    model: MODEL,
    prompt,
    images: prepared.map((input) => ({ mime: input.mime, buffer: input.buffer })),
    aspectRatio: sendAspect ? body.aspect_ratio : null,
    includeAspect: sendAspect,
  });
  const phase = body.phase || 'diagnostic';
  const result = await sendProviderRequest({
    baseUrl: config.baseUrl,
    token: config.token,
    request,
    timeoutMs: config.timeoutMs,
    fetchImpl,
    redactWith,
    onRequest: () => store.bump(phase),
  });
  let output = null;
  if (result.images[0]) {
    const image = result.images[0];
    const described = describeImage(image.buffer);
    const filename = `${runId}.${extensionForMime(described.mime || image.mime)}`;
    const absolute = store.saveOutput(filename, image.buffer);
    output = {
      mime: described.mime || image.mime,
      width: described.width,
      height: described.height,
      filename,
      sha256: described.sha256,
      absolute_path: absolute,
    };
  }
  const manifest = {
    run_id: runId,
    timestamp: now.toISOString(),
    model: MODEL,
    capability_version: profile.version ?? 1,
    recipe_id: body.experiment_id ?? null,
    recipe_version: body.recipe_version ?? null,
    prompt_template_id: body.template_id ?? null,
    prompt_template_version: body.template_version ?? null,
    prompt_edited: Boolean(body.prompt_edited),
    final_prompt: redact(prompt, redactWith),
    inputs: prepared.map(({ buffer: _buffer, ...input }) => input),
    request_parameters: {
      model: MODEL,
      endpoint_path: result.endpointPath,
      request_format: profile.transport.request_format,
      aspect_ratio: sendAspect ? body.aspect_ratio : null,
      image_count: prepared.length,
    },
    aspect_ratio: body.aspect_ratio,
    layout_purpose: body.layout_purpose ?? null,
    http: {
      status: result.httpStatus,
      error_class: result.errorClass,
      error: result.error,
    },
    latency_ms: result.latencyMs,
    usage: result.usage,
    finish_reason: result.finishReason,
    output,
    parent: {
      reference_id: body.parent_reference_id ?? null,
      run_id: body.parent_run_id ?? null,
    },
    retry_of: retryOf,
    phase,
    ratings: null,
    blocking: null,
    verdict: null,
    rationale: null,
  };
  store.saveManifest(manifest);
  return publicManifest(manifest);
}

export function saveEvaluation(store, runId, body) {
  const manifest = store.readManifest(runId);
  if (!manifest) throw httpError('run not found', 'not-found', 404);
  if (!VERDICTS.includes(body.verdict)) throw httpError('verdict must be accepted, rejected, retry, or reuse-existing', 'verdict', 400);
  const rationale = String(body.rationale ?? '').trim();
  if (!rationale || rationale.length > 500) throw httpError('rationale must be 1 to 500 characters', 'rationale', 400);
  const ratings = {};
  for (const key of RATING_KEYS) {
    if (!RATING_VALUES.has(body.ratings?.[key])) throw httpError(`rating ${key} is missing`, 'ratings', 400);
    ratings[key] = body.ratings[key];
  }
  const blocking = {};
  for (const key of BLOCKING_KEYS) {
    if (typeof body.blocking?.[key] !== 'boolean') throw httpError(`blocking finding ${key} must be true or false`, 'blocking', 400);
    blocking[key] = body.blocking[key];
  }
  if (body.verdict === 'accepted' && BLOCKING_KEYS.some((key) => blocking[key])) {
    throw httpError('an accepted image cannot carry a blocking finding', 'blocking-finding', 409);
  }
  let retry = null;
  if (body.verdict === 'retry') {
    if (!TECHNIQUES.includes(body.technique)) throw httpError('retry technique is required', 'retry', 400);
    const failureClass = String(body.failure_class ?? '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(failureClass) || failureClass.length > 60) {
      throw httpError('failure class must be a short hyphenated label', 'retry', 400);
    }
    retry = { technique: body.technique, failure_class: failureClass };
  }
  manifest.ratings = ratings;
  manifest.blocking = blocking;
  manifest.verdict = body.verdict;
  manifest.rationale = rationale;
  manifest.evaluation_retry = retry;
  store.saveManifest(manifest);
  return publicManifest(manifest);
}

export function outputFile(store, filename) {
  if (filename !== path.basename(filename)) return null;
  return store.outputPath(filename);
}
