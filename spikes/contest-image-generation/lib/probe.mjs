import { describeImage, extensionForMime, makePng } from './image-info.mjs';
import { DISCOVERY_BUDGET, MODEL } from './constants.mjs';
import { sendProviderRequest } from './client.mjs';
import { redactAndShorten } from './redact.mjs';
import { DISCOVERY_PROMPT, SHAPE_ATTEMPT_ORDER, buildRequest } from './transport.mjs';
import { documentationPaths } from './url.mjs';

export function ratioMatches(width, height, ratio) {
  if (!width || !height || !ratio) return false;
  const [w, h] = String(ratio).split(':').map(Number);
  if (!w || !h) return false;
  const expected = w / h;
  const actual = width / height;
  return Math.abs(actual - expected) / expected <= 0.04;
}

function shapeStep(item, profile) {
  const chat = item.shape === 'chat-completions';
  return {
    kind: 'shape',
    shape: item.shape,
    path: item.path,
    format: item.format,
    includeAspect: !chat && profile.aspect_ratio !== 'unsupported',
    aspectRatio: chat || profile.aspect_ratio === 'unsupported' ? null : '4:5',
  };
}

export function nextDiscoveryStep(profile, baseUrl) {
  if (profile.pending_without_aspect) {
    const pending = profile.pending_without_aspect;
    return {
      kind: 'shape',
      shape: pending.shape,
      path: pending.path,
      format: pending.format,
      includeAspect: false,
      aspectRatio: null,
      dropPending: true,
    };
  }
  if (profile.documentation === 'untested') {
    const remaining = documentationPaths(baseUrl).filter((item) => !profile.docs_paths_tried.includes(item));
    if (remaining.length) return { kind: 'docs', path: remaining[0], method: 'GET' };
  }
  if (profile.transport.status === 'verified') {
    if (profile.reference_images === 'untested') {
      return { kind: 'reference', shape: profile.transport.shape, path: profile.transport.endpoint_path, format: profile.transport.request_format, imageCount: 3 };
    }
    if (profile.error_behavior === 'untested') {
      return { kind: 'error', shape: profile.transport.shape, path: profile.transport.endpoint_path, format: profile.transport.request_format };
    }
    return null;
  }
  if (profile.transport.locked || profile.transport.status === 'unsupported') return null;
  const documented = (profile.documented_paths ?? []).find((item) => item.shape && !profile.shapes_tried.includes(item.shape));
  if (documented) {
    return shapeStep(documented, profile);
  }
  if ((profile.documented_paths ?? []).some((item) => item.shape)) {
    // Documented shapes were already attempted.
  } else if (profile.documentation === 'found' && (profile.documented_paths ?? []).length > 0 && (profile.documented_paths ?? []).every((item) => !item.shape)) {
    return { kind: 'unsupported-doc' };
  }
  const ladder = SHAPE_ATTEMPT_ORDER.find((item) => !profile.shapes_tried.includes(item.shape));
  if (!ladder) return null;
  if (profile.documentation === 'found' && (profile.documented_paths ?? []).some((item) => item.shape)) return null;
  return shapeStep(ladder, profile);
}

function logLine(step, event) {
  return {
    step: step.kind,
    method: step.method || 'POST',
    endpoint_path: event.endpointPath || step.path,
    http_status: event.httpStatus ?? null,
    error_class: event.errorClass ?? null,
  };
}

export function reduceDiscovery(profile, step, event, { docsComplete = false, redactWith } = {}) {
  const next = structuredClone(profile);
  if (step.dropPending) next.pending_without_aspect = null;
  const note = event.error ? redactAndShorten(event.error, redactWith) : null;
  if (step.kind === 'unsupported-doc') {
    next.transport = { ...next.transport, status: 'unsupported', locked: true };
    next.notes.push('documentation did not identify a supported image request shape');
    return { profile: next, stop: true };
  }
  next.log.push(logLine(step, event));
  if (event.imageDownload) {
    next.log.push({
      step: 'image-download',
      method: 'GET',
      endpoint_path: null,
      http_status: event.imageDownload.httpStatus ?? null,
      error_class: event.imageDownload.errorClass ?? null,
    });
  }
  if (step.kind === 'docs') {
    next.docs_paths_tried.push(step.path);
    if (event.openapi?.length) {
      next.documentation = 'found';
      next.documented_paths = event.openapi.map((item) => ({
        path: item.path,
        method: item.method,
        shape: item.shape,
        format: item.format,
      }));
      if (event.openapi.some((item) => /images\/edits/.test(item.path))) next.image_edit = 'documented';
      if (next.documented_paths.length && next.documented_paths.every((item) => !item.shape)) {
        next.transport = { ...next.transport, status: 'unsupported', locked: true };
        next.notes.push('documentation did not identify a supported image request shape');
        return { profile: next, stop: true };
      }
    } else if (docsComplete && !['network', 'timeout', 'abort'].includes(event.errorClass)) {
      next.documentation = 'unavailable';
    }
    if (['network', 'timeout', 'abort'].includes(event.errorClass)) {
      next.documentation = 'network-blocked';
      if (note) next.notes.push(note);
      return { profile: next, stop: false };
    }
    if (event.httpStatus === 401 || event.httpStatus === 403) {
      next.transport.locked = true;
      if (note) next.notes.push(note);
      return { profile: next, stop: true };
    }
    return { profile: next, stop: false };
  }

  if (event.errorClass === 'pending-image-download') {
    next.pending_image_download = true;
    next.output = { representation: 'pending-image-download', mime: null, width: null, height: null };
    next.notes.push('image download deferred because the request budget was exhausted');
    return { profile: next, stop: true };
  }

  const fatalTransport = ['network', 'timeout', 'abort'].includes(event.errorClass) || event.httpStatus === 401 || event.httpStatus === 403;
  if (fatalTransport) {
    next.transport.locked = true;
    if (note) next.notes.push(note);
    return { profile: next, stop: true };
  }

  if (step.kind === 'shape') {
    if (event.httpStatus === 404 || event.httpStatus === 405) {
      next.shapes_tried.push(step.shape);
      return { profile: next, stop: false };
    }
    if ((event.httpStatus === 400 || event.httpStatus === 422) && step.includeAspect && /aspect/i.test(event.error || '')) {
      next.aspect_ratio = 'unsupported';
      next.pending_without_aspect = { shape: step.shape, path: step.path, format: step.format };
      next.notes.push('aspect parameter was rejected; one retry without it is allowed');
      return { profile: next, stop: false };
    }
    if (event.images?.length) {
      next.pending_image_download = false;
      next.shapes_tried.push(step.shape);
      const image = event.images[0];
      next.transport = {
        status: 'verified',
        shape: step.shape,
        endpoint_path: event.endpointPath || step.path,
        request_format: step.format,
        locked: true,
      };
      next.output = {
        representation: event.representation || 'untested',
        mime: image.mime ?? null,
        width: image.width ?? null,
        height: image.height ?? null,
      };
      next.usage = event.usage ? 'present' : 'absent';
      if (step.includeAspect && ratioMatches(image.width, image.height, step.aspectRatio)) {
        next.aspect_ratio = 'accepted';
        if (!next.verified_aspect_ratios.includes(step.aspectRatio)) next.verified_aspect_ratios.push(step.aspectRatio);
      } else if (step.includeAspect) {
        next.aspect_ratio = 'inconclusive';
      }
      return { profile: next, stop: false };
    }
    next.shapes_tried.push(step.shape);
    next.transport = {
      ...next.transport,
      status: 'inconclusive',
      shape: step.shape,
      endpoint_path: event.endpointPath || step.path,
      request_format: step.format,
      locked: true,
    };
    if (note) next.notes.push(note);
    return { profile: next, stop: true };
  }

  if (step.kind === 'reference') {
    if (event.images?.length) {
      next.pending_image_download = false;
      next.reference_images = 'verified';
      next.reference_image_count_verified = step.imageCount;
    } else {
      next.reference_images = 'inconclusive';
      if (note) next.notes.push(note);
    }
    return { profile: next, stop: false };
  }

  if (step.kind === 'error') {
    next.error_behavior = event.httpStatus >= 400 && event.httpStatus < 500 ? 'observed' : 'inconclusive';
    if (note) next.notes.push(note);
    return { profile: next, stop: true };
  }

  return { profile: next, stop: true };
}

function phaseFor(profile) {
  return profile.discovery_requests >= DISCOVERY_BUDGET ? 'diagnostic' : 'discovery';
}

export const TRANSPORT_PROBE_STEP = {
  kind: 'shape',
  shape: 'chat-completions',
  path: '/v1/chat/completions',
  format: 'json',
  includeAspect: false,
  aspectRatio: null,
};

export function classifyAspectResult({ httpStatus, errorClass, width, height, requested = '4:5' }) {
  if (['network', 'timeout', 'abort'].includes(errorClass) || httpStatus === 401 || httpStatus === 403) {
    return { status: 'untested', honored: false, measured_ratio: null };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return { status: 'rejected', honored: false, measured_ratio: null };
  }
  if (httpStatus >= 200 && httpStatus < 300 && width && height) {
    const measuredRatio = width / height;
    const honored = ratioMatches(width, height, requested);
    return { status: honored ? 'accepted' : 'inconclusive', honored, measured_ratio: measuredRatio };
  }
  return { status: 'inconclusive', honored: false, measured_ratio: null };
}

export async function runAspectProbe({ config, store, fetchImpl, redactWith }) {
  if (!config?.configured) {
    const error = new Error(config?.reason || 'live configuration is absent');
    error.code = 'not-configured';
    error.status = 400;
    throw error;
  }
  const profile = store.readCapability();
  const requested = '4:5';
  const request = buildRequest({
    shape: 'chat-completions',
    endpointPath: '/v1/chat/completions',
    model: MODEL,
    prompt: DISCOVERY_PROMPT,
    images: [],
    aspectRatio: requested,
    includeAspect: false,
    aspectField: 'image_config',
  });
  const result = await sendProviderRequest({
    baseUrl: config.baseUrl,
    token: config.token,
    request,
    timeoutMs: config.timeoutMs,
    fetchImpl,
    redactWith,
    followImageUrl: false,
    onRequest: () => {
      const phase = phaseFor(profile);
      profile.discovery_requests += 1;
      store.bump(phase);
    },
  });
  const image = result.images?.[0] ?? null;
  let outputFilename = null;
  if (image?.buffer) {
    const described = describeImage(image.buffer);
    outputFilename = `aspect-4x5-${Date.now()}.${extensionForMime(described.mime || image.mime)}`;
    store.saveOutput(outputFilename, image.buffer);
  }
  const verdict = classifyAspectResult({
    httpStatus: result.httpStatus,
    errorClass: result.errorClass,
    width: image?.width ?? null,
    height: image?.height ?? null,
    requested,
  });
  const probe = {
    field: 'image_config.aspect_ratio',
    requested_aspect_ratio: requested,
    status: verdict.status,
    honored: verdict.honored,
    measured_width: image?.width ?? null,
    measured_height: image?.height ?? null,
    measured_ratio: verdict.measured_ratio,
    http_status: result.httpStatus,
    error_class: result.errorClass,
    error: result.error,
    representation: result.representation,
    mime: image?.mime ?? null,
    usage: result.usage ? 'present' : 'absent',
    output_filename: outputFilename,
  };
  if (verdict.status !== 'untested') {
    profile.aspect_ratio = verdict.status;
    profile.aspect_field = probe.field;
    if (verdict.honored) profile.verified_aspect_ratios = [requested];
  }
  profile.aspect_probe = probe;
  profile.log.push({
    step: 'aspect',
    method: 'POST',
    endpoint_path: '/v1/chat/completions',
    http_status: result.httpStatus,
    error_class: result.errorClass,
  });
  if (result.error) profile.notes.push(result.error);
  store.writeCapability(profile);
  store.appendAttempt({
    kind: 'aspect-probe',
    at: new Date().toISOString(),
    requests: 1,
    requested_aspect_ratio: requested,
    probe,
    profile,
  });
  return profile;
}

export async function runTransportProbe(options) {
  return runDiscovery({
    ...options,
    budget: 1,
    onlyStep: TRANSPORT_PROBE_STEP,
    attemptKind: 'transport-probe',
  });
}

export async function runDiscovery({
  config,
  store,
  fetchImpl,
  redactWith,
  budget = DISCOVERY_BUDGET,
  onlyStep = null,
  attemptKind = 'discovery',
}) {
  if (!config?.configured) {
    const error = new Error(config?.reason || 'live configuration is absent');
    error.code = 'not-configured';
    error.status = 400;
    throw error;
  }
  let profile = store.readCapability();
  let made = 0;
  let stop = false;
  while (made < budget && !stop) {
    const step = onlyStep && made === 0 ? onlyStep : (onlyStep ? null : nextDiscoveryStep(profile, config.baseUrl));
    if (!step) break;
    if (step.kind === 'unsupported-doc') {
      const reduced = reduceDiscovery(profile, step, {}, { redactWith });
      profile = reduced.profile;
      stop = reduced.stop;
      break;
    }
    const images = step.kind === 'reference'
      ? Array.from({ length: step.imageCount }, (_, index) => ({
        mime: 'image/png',
        buffer: makePng(8, 10, { red: 30 + index * 40, green: 20, blue: 20 }),
      }))
      : [];
    const request = step.kind === 'docs'
      ? { method: 'GET', path: step.path, headers: { accept: 'application/json' }, summarizeOpenApi: true }
      : buildRequest({
        shape: step.shape,
        endpointPath: step.path,
        model: MODEL,
        prompt: DISCOVERY_PROMPT,
        images,
        aspectRatio: step.aspectRatio,
        includeAspect: Boolean(step.includeAspect && step.aspectRatio),
        invalid: step.kind === 'error',
      });
    const result = await sendProviderRequest({
      baseUrl: config.baseUrl,
      token: config.token,
      request,
      timeoutMs: config.timeoutMs,
      fetchImpl,
      redactWith,
      onRequest: () => {
        if (made >= budget) return false;
        const phase = phaseFor(profile);
        made += 1;
        profile.discovery_requests += 1;
        store.bump(phase);
        return true;
      },
      followImageUrl: step.kind !== 'docs',
    });
    const docsComplete = step.kind === 'docs' && documentationPaths(config.baseUrl).every((item) => (
      item === step.path || profile.docs_paths_tried.includes(item)
    ));
    const reduced = reduceDiscovery(profile, step, {
      httpStatus: result.httpStatus,
      errorClass: result.errorClass,
      error: result.error,
      endpointPath: result.endpointPath,
      images: (result.images ?? []).map((image) => ({ mime: image.mime, width: image.width, height: image.height })),
      usage: result.usage,
      representation: result.representation,
      openapi: result.openapi ?? null,
      imageDownload: result.imageDownload ?? null,
    }, { docsComplete, redactWith });
    profile = reduced.profile;
    stop = reduced.stop || Boolean(onlyStep);
    store.writeCapability(profile);
  }
  store.writeCapability(profile);
  store.appendAttempt({
    kind: attemptKind,
    at: new Date().toISOString(),
    requests: made,
    profile,
  });
  return profile;
}
