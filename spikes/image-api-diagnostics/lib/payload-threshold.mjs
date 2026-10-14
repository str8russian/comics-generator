import {
  chatCompletionsUrl,
  postJson,
  sanitizeHeaders,
  sanitizeTimings,
  sha256,
} from "./transport.mjs";

export const SCHEMA_VERSION = 1;
export const DEFAULT_LOW_BYTES = 700_000;
export const DEFAULT_HIGH_BYTES = 1_400_000;
export const HARD_BODY_CEILING = 8_000_000;
export const MAX_PAYLOAD_THRESHOLD_REQUESTS = 64;
export const PRODUCTION_BUDGET_BYTES = 850_000;

const FORBIDDEN_BODY_MARKERS = [
  "messages",
  "image_url",
  "modalities",
  "data:",
  "prompt",
  "image_config",
  "inline_data",
  "inlineData",
  "b64_json",
];
const BOUNDARY_NOTE = "This is an HTTP JSON request-body boundary, not a maximum source-image size.";
const BUDGET_NOTE = `Production IMAGE_REQUEST_BUDGET_BYTES remains ${PRODUCTION_BUDGET_BYTES} and was not changed.`;

function prefixFor(model) {
  return `{"model":${JSON.stringify(model)},"diagnostic_padding":"`;
}

export function minimumValidationBodyBytes(model) {
  return Buffer.byteLength(`${prefixFor(model)}"}`);
}

export function buildValidationProbeBody(model, targetBytes) {
  if (typeof model !== "string" || model.trim() === "") {
    throw Object.assign(new Error("model is required"), { code: "configuration" });
  }
  const minimumBytes = minimumValidationBodyBytes(model);
  if (!Number.isInteger(targetBytes) || targetBytes < minimumBytes) {
    throw Object.assign(new Error("target is below the minimum validation body"), {
      code: "target-too-small",
      minimumBytes,
    });
  }
  const body = `${prefixFor(model)}${"a".repeat(targetBytes - minimumBytes)}"}`;
  if (Buffer.byteLength(body) !== targetBytes) {
    throw Object.assign(new Error("body length mismatch"), { code: "target-too-small", minimumBytes });
  }
  return body;
}

export function assertValidationOnlyBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw Object.assign(new Error("validation-only body rejected locally"), { code: "invalid-body" });
  }
  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== "diagnostic_padding,model") {
    throw Object.assign(new Error("validation-only body rejected locally"), { code: "invalid-body" });
  }
  if (typeof parsed.model !== "string" || typeof parsed.diagnostic_padding !== "string" || !/^a*$/.test(parsed.diagnostic_padding)) {
    throw Object.assign(new Error("validation-only body rejected locally"), { code: "invalid-body" });
  }
  for (const marker of FORBIDDEN_BODY_MARKERS) {
    if (body.includes(marker)) {
      throw Object.assign(new Error("validation-only body rejected locally"), { code: "invalid-body" });
    }
  }
  return parsed;
}

function readPositiveInteger(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: fallback };
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

export function loadPayloadThresholdRange(env = process.env, model = "") {
  const minimumBytes = minimumValidationBodyBytes(model);
  const low = readPositiveInteger(env.IMAGE_PAYLOAD_THRESHOLD_LOW_BYTES, DEFAULT_LOW_BYTES);
  const high = readPositiveInteger(env.IMAGE_PAYLOAD_THRESHOLD_HIGH_BYTES, DEFAULT_HIGH_BYTES);
  if (!low.ok || !high.ok || low.value >= high.value || high.value > HARD_BODY_CEILING || low.value < minimumBytes) {
    return { ok: false, reason: "invalid-range", minimumBytes };
  }
  return { ok: true, low: low.value, high: high.value, minimumBytes };
}

export function classifyPayloadResponse({ status = 0, transportError = null, generatedImage = false } = {}) {
  if (transportError) return "inconclusive";
  if (generatedImage) return "inconclusive";
  if (status === 413) return "size-rejected";
  if (status === 401 || status === 403 || status === 429) return "inconclusive";
  if (status >= 500 && status <= 599) return "inconclusive";
  if (status >= 200 && status < 300) return "inconclusive";
  if (status === 400 || status === 422) return "size-accepted-validation-rejection";
  return "inconclusive";
}

function containsGeneratedImage(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return /data:image\//i.test(text) || /"b64_json"/.test(text) || /inline_data|inlineData/.test(text);
}

function conclusionFor(state) {
  if (state.exactBoundaryConfirmed === true) {
    return `The exact HTTP JSON request-body boundary is between ${state.lowAccepted} bytes, which reached validation without HTTP 413, and ${state.highRejected} bytes, which was rejected with HTTP 413. The adjacent sizes were confirmed with separate probes. ${BOUNDARY_NOTE} ${BUDGET_NOTE}`;
  }
  const reason = state.reason ? ` (${state.reason})` : "";
  return `The experiment is inconclusive${reason}. No exact HTTP JSON body boundary is claimed. ${BOUNDARY_NOTE} ${BUDGET_NOTE}`;
}

function baselineTarget(minimumBytes, lowBytes) {
  return Math.max(minimumBytes, Math.min(4096, lowBytes));
}

export async function runPayloadThreshold({
  model,
  baseUrl,
  token,
  timeoutMs,
  lowBytes,
  highBytes,
  maxRequests = MAX_PAYLOAD_THRESHOLD_REQUESTS,
  ceiling = HARD_BODY_CEILING,
  send = postJson,
  onProgress,
  onObservation,
  nowIso = () => new Date().toISOString(),
}) {
  const minimumBytes = minimumValidationBodyBytes(model);
  const state = {
    startedAt: nowIso(),
    status: "running",
    reason: null,
    requests: 0,
    observations: [],
    baselineStatus: null,
    lowAccepted: null,
    highRejected: null,
    exactBoundaryConfirmed: false,
    confirmationCount: 0,
  };
  const cache = new Map();

  const reportOf = () => {
    const adjacent = Number.isInteger(state.lowAccepted)
      && Number.isInteger(state.highRejected)
      && state.highRejected === state.lowAccepted + 1;
    const confirmed = state.exactBoundaryConfirmed === true && adjacent;
    const confirmationObservations = state.observations.filter((item) => String(item.purpose).startsWith("confirm-"));
    const report = {
      spike: "image-api-diagnostics-payload-threshold",
      schemaVersion: SCHEMA_VERSION,
      startedAt: state.startedAt,
      lastUpdatedAt: nowIso(),
      model,
      initialRange: { low: lowBytes, high: highBytes },
      hardRequestCap: maxRequests,
      hardBodyCeiling: ceiling,
      requestsAttempted: state.requests,
      status: state.status,
      observations: state.observations,
      lowerAcceptedBodyBytes: state.lowAccepted,
      upperRejectedBodyBytes: state.highRejected,
      plannedConfirmationCount: 2,
      confirmationCount: confirmationObservations.length,
      confirmationObservations,
      exactBoundaryConfirmed: confirmed,
      conclusion: state.status === "running"
        ? `Validation-only HTTP JSON body measurement is in progress. ${BOUNDARY_NOTE} ${BUDGET_NOTE}`
        : conclusionFor({ ...state, exactBoundaryConfirmed: confirmed }),
    };
    if (confirmed) {
      report.largestNon413BodyBytes = state.lowAccepted;
      report.smallest413BodyBytes = state.highRejected;
    }
    return report;
  };

  const publish = () => {
    const report = reportOf();
    onObservation?.(report);
    return report;
  };

  const finish = (status, reason) => {
    state.status = status;
    if (reason) state.reason = reason;
    if (status !== "complete") state.exactBoundaryConfirmed = false;
    return publish();
  };

  if (!Number.isInteger(lowBytes) || !Number.isInteger(highBytes) || lowBytes >= highBytes || highBytes > ceiling || lowBytes < minimumBytes) {
    return finish("inconclusive", "invalid-range");
  }

  const interpret = (observation) => {
    if (!observation) return "inconclusive";
    if (observation.classification === "size-rejected") return "size-rejected";
    if (observation.classification === "size-accepted-validation-rejection" && observation.httpStatus === state.baselineStatus) {
      return "size-accepted-validation-rejection";
    }
    return "inconclusive";
  };

  const observe = async (targetBytes, purpose, { force = false } = {}) => {
    if (!force && cache.has(targetBytes)) return cache.get(targetBytes);
    if (state.requests >= maxRequests) {
      state.reason = "request-cap";
      return null;
    }
    let body;
    try {
      body = buildValidationProbeBody(model, targetBytes);
      assertValidationOnlyBody(body);
    } catch (error) {
      state.reason = error?.code === "target-too-small" ? "target-too-small" : "invalid-body";
      return null;
    }
    const index = state.requests + 1;
    const hash = sha256(body);
    const progress = {
      index,
      total: maxRequests,
      id: purpose,
      purpose,
      rangeLow: state.lowAccepted ?? lowBytes,
      rangeHigh: state.highRejected ?? Math.max(highBytes, targetBytes),
      targetBytes,
    };
    onProgress?.({
      type: "before-request",
      ...progress,
      byteLength: Buffer.byteLength(body),
      sha256Prefix: hash.slice(0, 12),
      timeoutMs,
    });
    state.requests += 1;
    const response = await send(chatCompletionsUrl(baseUrl), {
      token,
      body,
      timeoutMs,
      onEvent: (event) => onProgress?.({
        type: event.type,
        elapsedMs: event.elapsedMs,
        httpStatus: event.httpStatus,
        timings: sanitizeTimings(event.timings),
        ...progress,
      }),
    });
    const generatedImage = containsGeneratedImage(response?.text);
    const classification = classifyPayloadResponse({
      status: response?.status ?? 0,
      transportError: response?.transportError ?? null,
      generatedImage,
    });
    const observation = {
      purpose,
      targetBytes,
      actualBodyBytes: Buffer.byteLength(body),
      sha256: hash,
      httpStatus: response?.status ?? 0,
      classification,
      headers: sanitizeHeaders(response?.headers, [token]),
      transportError: response?.transportError || null,
      ttfbMs: Number.isInteger(response?.timings?.ttfbMs) ? response.timings.ttfbMs : null,
      totalMs: Number.isInteger(response?.timings?.totalMs)
        ? response.timings.totalMs
        : (Number.isInteger(response?.latencyMs) ? response.latencyMs : null),
      timings: sanitizeTimings(response?.timings),
    };
    state.observations.push(observation);
    cache.set(targetBytes, observation);
    onProgress?.({
      type: "timings",
      ...progress,
      elapsedMs: observation.totalMs ?? 0,
      timings: observation.timings,
    });
    publish();
    return observation;
  };

  const baseline = await observe(baselineTarget(minimumBytes, lowBytes), "baseline");
  if (!baseline) return finish("inconclusive", state.reason || "baseline-failed");
  if (baseline.httpStatus >= 200 && baseline.httpStatus < 300) {
    return finish("inconclusive", "unexpected-success");
  }
  if (baseline.classification !== "size-accepted-validation-rejection") {
    return finish("inconclusive", "baseline-failed");
  }
  state.baselineStatus = baseline.httpStatus;

  let low = lowBytes;
  let lowObservation = await observe(low, "bracket-low");
  if (!lowObservation) return finish("inconclusive", state.reason || "bracket-failed");
  let lowKind = interpret(lowObservation);
  if (lowKind === "inconclusive") return finish("inconclusive", "inconclusive-observation");
  while (lowKind === "size-rejected") {
    const next = Math.max(minimumBytes, Math.floor(low / 2));
    if (next >= low) return finish("inconclusive", "no-accepted-size");
    state.highRejected = low;
    low = next;
    lowObservation = await observe(low, "expand-low");
    if (!lowObservation) return finish("inconclusive", state.reason || "expand-failed");
    lowKind = interpret(lowObservation);
    if (lowKind === "inconclusive") return finish("inconclusive", "inconclusive-observation");
  }
  state.lowAccepted = low;

  let high = highBytes;
  if (state.highRejected != null) high = state.highRejected;
  let highObservation = await observe(high, state.highRejected != null ? "expand-high" : "bracket-high");
  if (!highObservation) return finish("inconclusive", state.reason || "bracket-failed");
  let highKind = interpret(highObservation);
  if (highKind === "inconclusive") return finish("inconclusive", "inconclusive-observation");
  while (highKind === "size-accepted-validation-rejection") {
    const next = Math.min(ceiling, high * 2);
    state.lowAccepted = high;
    if (next <= high) return finish("inconclusive", "no-rejected-size");
    low = high;
    high = next;
    highObservation = await observe(high, "expand-high");
    if (!highObservation) return finish("inconclusive", state.reason || "expand-failed");
    highKind = interpret(highObservation);
    if (highKind === "inconclusive") return finish("inconclusive", "inconclusive-observation");
  }
  if (highKind !== "size-rejected") return finish("inconclusive", "no-rejected-size");
  state.highRejected = high;

  while (state.highRejected - state.lowAccepted > 1) {
    const mid = state.lowAccepted + Math.floor((state.highRejected - state.lowAccepted) / 2);
    if (mid <= state.lowAccepted || mid >= state.highRejected) break;
    const observation = await observe(mid, "binary-search");
    if (!observation) return finish("inconclusive", state.reason || "search-failed");
    const kind = interpret(observation);
    if (kind === "size-accepted-validation-rejection") state.lowAccepted = mid;
    else if (kind === "size-rejected") state.highRejected = mid;
    else return finish("inconclusive", "inconclusive-observation");
  }
  if (state.highRejected !== state.lowAccepted + 1) return finish("inconclusive", "bounds-not-adjacent");

  const confirmedLow = await observe(state.lowAccepted, "confirm-low", { force: true });
  if (!confirmedLow) return finish("inconclusive", state.reason || "confirmation-failed");
  const confirmedHigh = await observe(state.highRejected, "confirm-high", { force: true });
  if (!confirmedHigh) return finish("inconclusive", state.reason || "confirmation-failed");
  state.confirmationCount = 2;
  if (interpret(confirmedLow) !== "size-accepted-validation-rejection" || interpret(confirmedHigh) !== "size-rejected") {
    return finish("inconclusive", "inconsistent-confirmation");
  }
  state.exactBoundaryConfirmed = true;
  return finish("complete");
}
