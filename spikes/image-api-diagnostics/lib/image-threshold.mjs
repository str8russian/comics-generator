import sharp from "sharp";
import { buildImageRequest } from "../../../app/storyboard-web/image-provider.mjs";
import { sanitizeHeaders, sanitizeTimings, sha256 } from "./transport.mjs";

export const SCHEMA_VERSION = 1;
export const MAX_IMAGE_THRESHOLD_REQUESTS = 30;
export const MAX_SUCCESSFUL_GENERATIONS = 30;
export const HARD_BODY_CEILING = 8_000_000;
export const TARGET_GAP_BYTES = 10_240;
export const MIN_LONG_EDGE = 64;
export const BODY_MATCH_TOLERANCE = 16;
export const FIXED_ASPECT_RATIO = "5:4";
export const FIXED_PROMPT = "Revise this character on the same matte background. Make the expression slightly more alert. No text, borders, or extra people.";
export const LONG_EDGE_LADDER = Object.freeze([
  64, 96, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 600, 640, 704, 740, 768, 832, 896, 960, 1024, 1152,
]);
export const RERUN_FLAG = "IMAGE_THRESHOLD_RERUN";

const PRODUCTION_NOTE = "Production IMAGE_REFERENCE_STRATEGY remains budgeted and IMAGE_REQUEST_BUDGET_BYTES remains 850000. Neither was changed.";
const SCOPE_NOTE = "This is current endpoint behavior for these production-shaped image requests, not a universal image-file limit.";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

export function padPng(png, textBytes) {
  if (!Buffer.isBuffer(png) || png.length < 8 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw Object.assign(new Error("ancillary padding requires a png"), { code: "invalid-image" });
  }
  if (!Number.isInteger(textBytes) || textBytes < 0) {
    throw Object.assign(new Error("padding length must be a non-negative integer"), { code: "invalid-image" });
  }
  if (textBytes === 0) return { bytes: png, diagnosticPaddingBytes: 0, ancillaryTextBytes: 0 };
  let offset = 8;
  let iendAt = -1;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IEND") {
      iendAt = offset;
      break;
    }
    offset += 12 + length;
  }
  if (iendAt < 0) throw Object.assign(new Error("png is missing IEND"), { code: "invalid-image" });
  const type = Buffer.from("tEXt");
  const data = Buffer.concat([Buffer.from("Comment"), Buffer.from([0]), Buffer.alloc(textBytes, 0x61)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const chunk = Buffer.concat([length, type, data, crc]);
  const bytes = Buffer.concat([png.subarray(0, iendAt), chunk, png.subarray(iendAt)]);
  return { bytes, diagnosticPaddingBytes: bytes.length - png.length, ancillaryTextBytes: textBytes };
}

export function readAncillaryTextChunk(png) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const stored = png.readUInt32BE(offset + 8 + length);
    const actual = crc32(Buffer.concat([png.subarray(offset + 4, offset + 8), data]));
    if (type === "tEXt") {
      return { length, type, data, crcValid: stored === actual, ancillary: type[0] === type[0].toLowerCase() };
    }
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return null;
}

export function serializeImageBody({ model, prompt = FIXED_PROMPT, images }) {
  return JSON.stringify(buildImageRequest({
    prompt,
    images: images.map((image) => ({ mime: image.mime, bytes: image.bytes })),
    aspectRatio: FIXED_ASPECT_RATIO,
    model,
  }));
}

export function base64CharacterCount(bytes) {
  return bytes.toString("base64").length;
}

function longEdge(image) {
  return Math.max(Number(image.width) || 0, Number(image.height) || 0);
}

function publicImage(image) {
  return {
    role: image.role,
    mime: image.mime,
    width: image.width,
    height: image.height,
    originalBytes: image.originalBytes,
    transmittedBytes: image.bytes.length,
    diagnosticPaddingBytes: image.diagnosticPaddingBytes || 0,
    base64Chars: base64CharacterCount(image.bytes),
    sha256: sha256(image.bytes),
  };
}

function summarize(images, serialized) {
  const described = images.map(publicImage);
  return {
    roles: described.map((image) => image.role),
    images: described,
    combinedImageBytes: described.reduce((sum, image) => sum + image.transmittedBytes, 0),
    diagnosticPaddingBytes: described.reduce((sum, image) => sum + image.diagnosticPaddingBytes, 0),
    base64Chars: described.reduce((sum, image) => sum + image.base64Chars, 0),
    exactBodyBytes: Buffer.byteLength(serialized),
    requestSha256: sha256(serialized),
    serialized,
    wire: images,
  };
}

export function describeCandidate(model, images, prompt = FIXED_PROMPT) {
  const serialized = serializeImageBody({ model, prompt, images });
  const summary = summarize(images, serialized);
  if (summary.serialized !== serializeImageBody({ model, prompt, images: summary.wire })) {
    throw Object.assign(new Error("measured body differs from the production serializer"), { code: "measurement-mismatch" });
  }
  return summary;
}

async function resizePng(source, edge) {
  const current = longEdge(source);
  if (!current || edge >= current) {
    return {
      ...source,
      bytes: source.bytes,
      encodedBytes: source.bytes,
      diagnosticPaddingBytes: 0,
      mime: "image/png",
    };
  }
  const scale = edge / current;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const bytes = await sharp(source.bytes).resize(width, height, {
    fit: "fill",
    withoutEnlargement: true,
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  const meta = await sharp(bytes).metadata();
  return {
    role: source.role,
    mime: "image/png",
    width: meta.width,
    height: meta.height,
    originalBytes: source.originalBytes ?? source.bytes.length,
    bytes,
    encodedBytes: bytes,
    diagnosticPaddingBytes: 0,
  };
}

function applyPadding(image, textBytes) {
  const encoded = image.encodedBytes || image.bytes;
  if (!textBytes) {
    return { ...image, bytes: encoded, diagnosticPaddingBytes: 0 };
  }
  const padded = padPng(encoded, textBytes);
  return {
    ...image,
    bytes: padded.bytes,
    diagnosticPaddingBytes: padded.diagnosticPaddingBytes,
    mime: "image/png",
  };
}

export async function candidateNearTarget({
  model,
  images,
  targetBytes,
  minExclusive = 0,
  maxExclusive = HARD_BODY_CEILING + 1,
  ceiling = HARD_BODY_CEILING,
  prompt = FIXED_PROMPT,
}) {
  const limit = Math.min(maxExclusive, ceiling + 1);
  const base = images.map((image) => applyPadding(image, 0));
  const unpadded = describeCandidate(model, base, prompt);
  let best = null;
  const consider = (nextImages) => {
    const candidate = describeCandidate(model, nextImages, prompt);
    if (candidate.exactBodyBytes <= minExclusive || candidate.exactBodyBytes >= limit) return candidate.exactBodyBytes < targetBytes ? "low" : "high";
    const distance = Math.abs(candidate.exactBodyBytes - targetBytes);
    if (!best || distance < best.distance) best = { ...candidate, distance };
    return candidate.exactBodyBytes < targetBytes ? "low" : "high";
  };
  if (consider(base) === "high" && unpadded.exactBodyBytes >= limit) return best ? (({ distance, ...rest }) => rest)(best) : null;
  let hi = 1;
  while (hi < 3_000_000 && consider(base.map((image, index) => (
    index === base.length - 1 ? applyPadding(image, hi) : image
  ))) === "low") {
    hi *= 2;
  }
  let lo = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const verdict = consider(base.map((image, index) => (
      index === base.length - 1 ? applyPadding(image, mid) : image
    )));
    if (verdict === "low") lo = mid + 1;
    else hi = mid - 1;
  }
  for (let textBytes = Math.max(0, lo - 4); textBytes <= lo + 4; textBytes += 1) {
    consider(base.map((image, index) => (
      index === base.length - 1 ? applyPadding(image, textBytes) : image
    )));
  }
  if (!best) return null;
  const { distance, ...candidate } = best;
  return distance <= Math.max(BODY_MATCH_TOLERANCE, limit - minExclusive) ? candidate : candidate;
}

export function imageThresholdRerunRefused({ existingReportText = "", allowRerun = false } = {}) {
  if (allowRerun === true) return false;
  return String(existingReportText ?? "").trim().length > 0;
}

export function classifyImageThresholdResponse({ status = 0, transportError = null, validImage = false } = {}) {
  if (transportError) return "inconclusive";
  if (status === 413) return "size-rejected";
  if (status >= 200 && status < 300) return validImage ? "size-accepted" : "inconclusive";
  return "inconclusive";
}

function safeToken(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.:+-]/g, "").slice(0, 80);
}

export function formatImageThresholdLine(event = {}) {
  const roles = Array.isArray(event.roles) ? event.roles.map(safeToken).filter(Boolean) : [];
  const sizes = Array.isArray(event.imageBytes) ? event.imageBytes.filter((value) => Number.isInteger(value)).join("+") : "";
  const bracket = Number.isInteger(event.bracketLow) && Number.isInteger(event.bracketHigh)
    ? `${event.bracketLow}..${event.bracketHigh}`
    : "none";
  const hash = /^[0-9a-f]{8,64}$/i.test(String(event.sha256Prefix || ""))
    ? String(event.sha256Prefix).toLowerCase().slice(0, 12)
    : "unknown";
  return `[${Number.isInteger(event.index) ? event.index : 0}/${Number.isInteger(event.total) ? event.total : MAX_IMAGE_THRESHOLD_REQUESTS}] ${safeToken(event.phase) || "phase"} ${safeToken(event.id) || "case"} roles=${roles.join("+") || "none"} count=${roles.length} images=${sizes || "none"} combined=${Number.isInteger(event.combinedImageBytes) ? event.combinedImageBytes : 0} padding=${Number.isInteger(event.diagnosticPaddingBytes) ? event.diagnosticPaddingBytes : 0} body=${Number.isInteger(event.exactBodyBytes) ? event.exactBodyBytes : 0} sha256=${hash} bracket=${bracket} remainingRequests=${Number.isInteger(event.remainingRequests) ? event.remainingRequests : 0} remainingSuccesses=${Number.isInteger(event.remainingSuccesses) ? event.remainingSuccesses : 0}\n`;
}

function conclusionFor(state) {
  if (state.boundaryConfirmed) {
    const three = state.threeReferenceConsistent === true
      ? " The same body boundary held for anchor+current and anchor+style+current."
      : state.threeReferenceConfirmed
        ? " Three-reference requests needed a separate confirmed body boundary."
        : " Three-reference consistency was not confirmed.";
    return `The confirmed image-bearing body boundary is ${state.lower.exactBodyBytes} bytes successful and ${state.upper.exactBodyBytes} bytes HTTP 413, a gap of ${state.upper.exactBodyBytes - state.lower.exactBodyBytes} bytes.${three} ${SCOPE_NOTE} ${PRODUCTION_NOTE}`;
  }
  const reason = state.reason ? ` (${state.reason})` : "";
  return `No confirmed image-bearing body boundary was established${reason}. ${SCOPE_NOTE} ${PRODUCTION_NOTE}`;
}

function endpointImageSizes(candidate) {
  if (!candidate) return [];
  return candidate.images.map((image) => ({
    role: image.role,
    mime: image.mime,
    width: image.width,
    height: image.height,
    transmittedBytes: image.transmittedBytes,
    originalBytes: image.originalBytes,
    diagnosticPaddingBytes: image.diagnosticPaddingBytes,
  }));
}

export async function runImageThreshold({
  model,
  baseUrl,
  token,
  timeoutMs,
  smallPair,
  largePair,
  sources,
  send,
  extractImage = () => null,
  decodeImage,
  saveOutput = async () => null,
  onProgress,
  onObservation,
  nowIso = () => new Date().toISOString(),
  sourceVersion = null,
  maxRequests = MAX_IMAGE_THRESHOLD_REQUESTS,
  maxSuccesses = MAX_SUCCESSFUL_GENERATIONS,
  ceiling = HARD_BODY_CEILING,
  targetGap = TARGET_GAP_BYTES,
  existingReportText = "",
  allowRerun = false,
  prompt = FIXED_PROMPT,
}) {
  if (imageThresholdRerunRefused({ existingReportText, allowRerun })) {
    return {
      spike: "image-api-diagnostics-image-threshold",
      schemaVersion: SCHEMA_VERSION,
      status: "refused",
      reason: "existing-report",
      requestsAttempted: 0,
      successfulGenerations: 0,
      boundaryConfirmed: false,
      productionConfigurationUnchanged: true,
      conclusion: `Refused to start because an image-threshold report already exists. ${PRODUCTION_NOTE}`,
    };
  }

  const state = {
    startedAt: nowIso(),
    status: "running",
    reason: null,
    requests: 0,
    successes: 0,
    observations: [],
    lower: null,
    upper: null,
    boundaryConfirmed: false,
    threeReferenceConsistent: null,
    threeReferenceConfirmed: false,
    threeLower: null,
    threeUpper: null,
    usedDiagnosticPadding: false,
  };
  const sent = new Set();
  const ladderCache = new Map();

  const reportOf = () => {
    const gap = state.lower && state.upper ? state.upper.exactBodyBytes - state.lower.exactBodyBytes : null;
    const confirmed = state.boundaryConfirmed === true && Number.isInteger(gap) && gap <= targetGap && gap >= 0;
    const report = {
      spike: "image-api-diagnostics-image-threshold",
      schemaVersion: SCHEMA_VERSION,
      startedAt: state.startedAt,
      lastUpdatedAt: nowIso(),
      sourceVersion,
      model,
      aspectRatio: FIXED_ASPECT_RATIO,
      hardRequestCap: maxRequests,
      hardSuccessCap: maxSuccesses,
      hardBodyCeiling: ceiling,
      targetGapBytes: targetGap,
      requestsAttempted: state.requests,
      successfulGenerations: state.successes,
      status: state.status,
      reason: state.reason,
      observations: state.observations,
      confirmationObservations: state.observations.filter((item) => String(item.id).includes("confirm")),
      boundaryConfirmed: confirmed,
      precisionMet: confirmed,
      largestSuccessfulBodyBytes: confirmed ? state.lower.exactBodyBytes : null,
      smallest413BodyBytes: confirmed ? state.upper.exactBodyBytes : null,
      finalGapBytes: confirmed ? gap : null,
      largestSuccessfulCombinedReferenceBytes: confirmed ? state.lower.combinedImageBytes : null,
      smallestRejectedCombinedReferenceBytes: confirmed ? state.upper.combinedImageBytes : null,
      largestSuccessfulImages: confirmed ? endpointImageSizes(state.lower) : [],
      smallestRejectedImages: confirmed ? endpointImageSizes(state.upper) : [],
      currentBracket: {
        low: state.lower?.exactBodyBytes ?? null,
        high: state.upper?.exactBodyBytes ?? null,
      },
      usedDiagnosticPadding: state.usedDiagnosticPadding,
      threeReferenceConsistent: state.threeReferenceConsistent,
      threeReferenceBoundary: state.threeReferenceConfirmed ? {
        largestSuccessfulBodyBytes: state.threeLower.exactBodyBytes,
        smallest413BodyBytes: state.threeUpper.exactBodyBytes,
        finalGapBytes: state.threeUpper.exactBodyBytes - state.threeLower.exactBodyBytes,
        confirmed: true,
      } : null,
      productionConfigurationUnchanged: true,
      conclusion: state.status === "running"
        ? `Image-bearing threshold measurement is in progress. ${SCOPE_NOTE} ${PRODUCTION_NOTE}`
        : conclusionFor({ ...state, boundaryConfirmed: confirmed }),
    };
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
    if (status !== "complete") state.boundaryConfirmed = false;
    return publish();
  };

  const canSend = () => state.requests < maxRequests && state.successes < maxSuccesses;

  async function validateImages(images) {
    const decoded = [];
    for (const image of images) {
      try {
        const meta = await sharp(image.bytes).metadata();
        const raw = await sharp(image.bytes).raw().toBuffer({ resolveWithObject: true });
        if (!meta.width || !meta.height || raw.info.width !== meta.width || raw.info.height !== meta.height || raw.data.length === 0) {
          throw new Error("undecodable");
        }
        if (typeof decodeImage === "function") await decodeImage(image.bytes);
        decoded.push({ ...image, width: meta.width, height: meta.height });
      } catch {
        return null;
      }
    }
    return decoded;
  }

  async function transmit(candidate, phase, id, { replay = false } = {}) {
    if (!canSend()) {
      state.reason = state.requests >= maxRequests ? "request-cap" : "success-cap";
      return null;
    }
    if (candidate.exactBodyBytes > ceiling) {
      state.reason = "body-ceiling";
      return null;
    }
    const serialized = candidate.serialized;
    const recomputed = serializeImageBody({ model, prompt, images: candidate.wire });
    if (serialized !== recomputed || Buffer.byteLength(serialized) !== candidate.exactBodyBytes || sha256(serialized) !== candidate.requestSha256) {
      state.reason = "measurement-mismatch";
      return null;
    }
    if (!replay && sent.has(candidate.requestSha256)) {
      state.reason = "cannot-narrow";
      return null;
    }
    const decoded = await validateImages(candidate.wire);
    if (!decoded) {
      state.reason = "local-decode-failed";
      return null;
    }
    const ready = describeCandidate(model, decoded, prompt);
    if (ready.serialized !== serialized) {
      state.reason = "measurement-mismatch";
      return null;
    }
    const index = state.requests + 1;
    const progress = {
      index,
      total: maxRequests,
      phase,
      id,
      roles: ready.roles,
      imageBytes: ready.images.map((image) => image.transmittedBytes),
      combinedImageBytes: ready.combinedImageBytes,
      diagnosticPaddingBytes: ready.diagnosticPaddingBytes,
      exactBodyBytes: ready.exactBodyBytes,
      sha256Prefix: ready.requestSha256.slice(0, 12),
      bracketLow: (state.displayLower ?? state.lower)?.exactBodyBytes,
      bracketHigh: (state.displayUpper ?? state.upper)?.exactBodyBytes,
      remainingRequests: maxRequests - state.requests,
      remainingSuccesses: maxSuccesses - state.successes,
      timeoutMs,
    };
    onProgress?.({ type: "before-request", ...progress });
    state.requests += 1;
    sent.add(ready.requestSha256);
    if (ready.diagnosticPaddingBytes > 0) state.usedDiagnosticPadding = true;
    const response = await send(baseUrl, {
      token,
      body: serialized,
      timeoutMs,
      caseId: id,
      onEvent: (event) => onProgress?.({
        type: event.type,
        elapsedMs: event.elapsedMs,
        httpStatus: event.httpStatus,
        timings: sanitizeTimings(event.timings),
        index,
        total: maxRequests,
        id,
      }),
    });
    const validImage = response?.status >= 200 && response?.status < 300
      ? extractImage(response.text, id)
      : null;
    const classification = classifyImageThresholdResponse({
      status: response?.status ?? 0,
      transportError: response?.transportError ?? null,
      validImage: Boolean(validImage),
    });
    if (classification === "size-accepted") state.successes += 1;
    let output = null;
    if (classification === "size-accepted" && validImage?.bytes) {
      output = await saveOutput(id, validImage);
    }
    state.observations.push({
      phase,
      id,
      roles: ready.roles,
      images: ready.images,
      combinedImageBytes: ready.combinedImageBytes,
      diagnosticPaddingBytes: ready.diagnosticPaddingBytes,
      base64Chars: ready.base64Chars,
      exactBodyBytes: ready.exactBodyBytes,
      requestSha256: ready.requestSha256,
      httpStatus: response?.status ?? 0,
      classification,
      headers: sanitizeHeaders(response?.headers, [token]),
      transportError: response?.transportError || null,
      ttfbMs: Number.isInteger(response?.timings?.ttfbMs) ? response.timings.ttfbMs : null,
      totalMs: Number.isInteger(response?.timings?.totalMs)
        ? response.timings.totalMs
        : (Number.isInteger(response?.latencyMs) ? response.latencyMs : null),
      timings: sanitizeTimings(response?.timings),
      output,
    });
    publish();
    if (classification === "inconclusive") {
      state.reason = "inconclusive-response";
      return null;
    }
    return { classification, candidate: ready };
  }

  async function variants(roles, edge) {
    const key = `${roles.join("+")}:${edge}`;
    if (ladderCache.has(key)) return ladderCache.get(key);
    const images = [];
    for (const role of roles) {
      images.push(await resizePng(sources[role], edge));
    }
    const candidate = describeCandidate(model, images, prompt);
    ladderCache.set(key, candidate);
    return candidate;
  }

  async function candidateAtMost(roles, maxBytes) {
    const edges = [...LONG_EDGE_LADDER].filter((edge) => edge >= MIN_LONG_EDGE).sort((left, right) => right - left);
    for (const edge of edges) {
      const candidate = await variants(roles, edge);
      if (candidate.exactBodyBytes <= maxBytes && candidate.exactBodyBytes <= ceiling) {
        const closer = await candidateNearTarget({
          model,
          images: candidate.wire,
          targetBytes: maxBytes,
          minExclusive: 0,
          maxExclusive: maxBytes + 1,
          ceiling,
          prompt,
        });
        return closer && closer.exactBodyBytes <= maxBytes ? closer : candidate;
      }
    }
    return null;
  }

  async function candidateAtLeast(roles, minBytes) {
    const edges = [...LONG_EDGE_LADDER].filter((edge) => edge >= MIN_LONG_EDGE).sort((left, right) => left - right);
    let base = null;
    for (const edge of edges) {
      const candidate = await variants(roles, edge);
      if (candidate.exactBodyBytes >= minBytes && candidate.exactBodyBytes <= ceiling) return candidate;
      if (candidate.exactBodyBytes < minBytes) base = candidate;
    }
    if (!base) return null;
    return candidateNearTarget({
      model,
      images: base.wire,
      targetBytes: minBytes,
      minExclusive: minBytes - 1,
      maxExclusive: ceiling + 1,
      ceiling,
      prompt,
    });
  }

  async function between(roles, minExclusive, maxExclusive) {
    const target = minExclusive + Math.floor((maxExclusive - minExclusive) / 2);
    const edges = LONG_EDGE_LADDER.filter((edge) => edge >= MIN_LONG_EDGE);
    const ladder = [];
    for (const edge of edges) {
      const candidate = await variants(roles, edge);
      if (candidate.exactBodyBytes > minExclusive && candidate.exactBodyBytes < maxExclusive && candidate.exactBodyBytes <= ceiling) {
        ladder.push(candidate);
      }
    }
    let best = ladder.sort((left, right) => (
      Math.abs(left.exactBodyBytes - target) - Math.abs(right.exactBodyBytes - target)
    ))[0] || null;
    if (best && Math.abs(best.exactBodyBytes - target) <= BODY_MATCH_TOLERANCE) return best;
    const bases = [];
    for (const edge of edges) {
      const candidate = await variants(roles, edge);
      if (candidate.exactBodyBytes < maxExclusive && candidate.exactBodyBytes <= target) bases.push(candidate);
    }
    const base = bases.sort((left, right) => right.exactBodyBytes - left.exactBodyBytes)[0];
    if (base) {
      const padded = await candidateNearTarget({
        model,
        images: base.wire,
        targetBytes: target,
        minExclusive,
        maxExclusive,
        ceiling,
        prompt,
      });
      if (padded && padded.exactBodyBytes > minExclusive && padded.exactBodyBytes < maxExclusive) {
        if (!best || Math.abs(padded.exactBodyBytes - target) < Math.abs(best.exactBodyBytes - target)) {
          best = padded;
        }
      }
    }
    if (best && sent.has(best.requestSha256)) return null;
    return best;
  }

  async function narrow(roles, lower, upper, phase) {
    let low = lower;
    let high = upper;
    state.displayLower = low;
    state.displayUpper = high;
    while (high.exactBodyBytes - low.exactBodyBytes > targetGap) {
      if (!canSend()) return { low, high, stopped: true, reason: state.requests >= maxRequests ? "request-cap" : "success-cap" };
      const next = await between(roles, low.exactBodyBytes, high.exactBodyBytes);
      if (!next) return { low, high, stopped: true, reason: "cannot-narrow" };
      const result = await transmit(next, phase, `${phase}-search`);
      if (!result) return { low, high, stopped: true, reason: state.reason };
      if (result.classification === "size-accepted") low = result.candidate;
      else high = result.candidate;
      state.displayLower = low;
      state.displayUpper = high;
    }
    if (state.requests + 2 > maxRequests || state.successes + 1 > maxSuccesses) {
      return { low, high, stopped: true, reason: state.successes + 1 > maxSuccesses ? "success-cap" : "request-cap" };
    }
    const confirmedLow = await transmit(low, phase, `${phase}-confirm-low`, { replay: true });
    if (!confirmedLow || confirmedLow.classification !== "size-accepted") {
      return { low, high, stopped: true, reason: "inconsistent-confirmation" };
    }
    const confirmedHigh = await transmit(high, phase, `${phase}-confirm-high`, { replay: true });
    if (!confirmedHigh || confirmedHigh.classification !== "size-rejected") {
      return { low, high, stopped: true, reason: "inconsistent-confirmation" };
    }
    return { low: confirmedLow.candidate, high: confirmedHigh.candidate, confirmed: true };
  }

  const small = describeCandidate(model, smallPair.map((image) => ({ ...image, encodedBytes: image.bytes, diagnosticPaddingBytes: 0 })), prompt);
  const large = describeCandidate(model, largePair.map((image) => ({ ...image, encodedBytes: image.bytes, diagnosticPaddingBytes: 0 })), prompt);
  const smallResult = await transmit(small, "phase-a", "two-ref-small");
  if (!smallResult) return finish("inconclusive", state.reason || "inconclusive-response");

  if (smallResult.classification === "size-rejected") {
    state.upper = smallResult.candidate;
    const edges = LONG_EDGE_LADDER.filter((edge) => edge < longEdge(smallPair[0]) && edge >= MIN_LONG_EDGE).sort((left, right) => right - left);
    for (const edge of edges) {
      if (!canSend()) return finish("inconclusive", state.requests >= maxRequests ? "request-cap" : "success-cap");
      const candidate = await variants(["anchor", "current"], edge);
      const result = await transmit(candidate, "phase-a", `two-ref-shrink-${edge}`);
      if (!result) return finish("inconclusive", state.reason);
      if (result.classification === "size-accepted") {
        state.lower = result.candidate;
        break;
      }
      state.upper = result.candidate;
    }
    if (!state.lower) return finish("inconclusive", "no-successful-body");
  } else {
    state.lower = smallResult.candidate;
    const largeResult = await transmit(large, "phase-a", "two-ref-large");
    if (!largeResult) return finish("inconclusive", state.reason || "inconclusive-response");
    if (largeResult.classification === "size-rejected") {
      state.upper = largeResult.candidate;
    } else {
      state.lower = largeResult.candidate;
      const edges = LONG_EDGE_LADDER.filter((edge) => edge > longEdge(largePair[0]));
      for (const edge of edges) {
        if (!canSend()) return finish("inconclusive", state.requests >= maxRequests ? "request-cap" : "success-cap");
        const candidate = await variants(["anchor", "current"], edge);
        if (candidate.exactBodyBytes <= state.lower.exactBodyBytes || candidate.exactBodyBytes > ceiling) continue;
        const result = await transmit(candidate, "phase-a", `two-ref-expand-${edge}`);
        if (!result) return finish("inconclusive", state.reason);
        if (result.classification === "size-rejected") {
          state.upper = result.candidate;
          break;
        }
        state.lower = result.candidate;
      }
      let guard = 0;
      while (!state.upper && state.lower.exactBodyBytes < ceiling && guard < 12) {
        guard += 1;
        if (!canSend()) return finish("inconclusive", state.requests >= maxRequests ? "request-cap" : "success-cap");
        const target = Math.min(ceiling, Math.max(state.lower.exactBodyBytes + targetGap, Math.floor(state.lower.exactBodyBytes * 1.5)));
        const candidate = await candidateNearTarget({
          model,
          images: state.lower.wire,
          targetBytes: target,
          minExclusive: state.lower.exactBodyBytes,
          maxExclusive: ceiling + 1,
          ceiling,
          prompt,
        });
        if (!candidate || candidate.exactBodyBytes <= state.lower.exactBodyBytes || candidate.exactBodyBytes > ceiling) break;
        const result = await transmit(candidate, "phase-a", "two-ref-expand-pad");
        if (!result) return finish("inconclusive", state.reason);
        if (result.classification === "size-rejected") state.upper = result.candidate;
        else state.lower = result.candidate;
      }
      if (!state.upper) return finish("inconclusive", "no-rejected-body");
    }
  }

  const narrowed = await narrow(["anchor", "current"], state.lower, state.upper, "phase-b");
  if (!narrowed.confirmed) return finish("inconclusive", narrowed.reason || state.reason || "unconfirmed");
  state.lower = narrowed.low;
  state.upper = narrowed.high;
  state.boundaryConfirmed = true;

  if (state.requests + 2 > maxRequests || state.successes >= maxSuccesses) {
    state.threeReferenceConsistent = null;
    return finish("complete", "three-reference-unconfirmed");
  }
  const threeRoles = ["anchor", "style", "current"];
  const below = await candidateAtMost(threeRoles, state.lower.exactBodyBytes);
  const above = await candidateAtLeast(threeRoles, state.upper.exactBodyBytes);
  if (!below || !above || below.exactBodyBytes > state.lower.exactBodyBytes || above.exactBodyBytes < state.upper.exactBodyBytes) {
    state.threeReferenceConsistent = null;
    return finish("complete", "three-reference-unconfirmed");
  }
  const belowResult = await transmit(below, "phase-c", "three-ref-below");
  if (!belowResult) return finish("inconclusive", state.reason);
  const aboveResult = await transmit(above, "phase-c", "three-ref-above");
  if (!aboveResult) return finish("inconclusive", state.reason);
  if (belowResult.classification === "size-accepted" && aboveResult.classification === "size-rejected") {
    state.threeReferenceConsistent = true;
    return finish("complete");
  }
  state.threeReferenceConsistent = false;
  let threeLow = [belowResult, aboveResult]
    .filter((result) => result.classification === "size-accepted")
    .map((result) => result.candidate)
    .sort((left, right) => right.exactBodyBytes - left.exactBodyBytes)[0] || null;
  let threeHigh = [belowResult, aboveResult]
    .filter((result) => result.classification === "size-rejected")
    .map((result) => result.candidate)
    .sort((left, right) => left.exactBodyBytes - right.exactBodyBytes)[0] || null;
  let guard = 0;
  while ((!threeLow || !threeHigh || threeHigh.exactBodyBytes <= threeLow.exactBodyBytes) && guard < 8) {
    guard += 1;
    if (state.requests + 3 > maxRequests) return finish("complete", "three-reference-unconfirmed");
    const anchorPoint = threeLow || threeHigh || belowResult.candidate;
    const seekingSuccess = !threeLow;
    const candidate = seekingSuccess
      ? await candidateAtMost(threeRoles, Math.max(1, anchorPoint.exactBodyBytes - 1))
      : await candidateAtLeast(threeRoles, anchorPoint.exactBodyBytes + 1);
    if (!candidate || sent.has(candidate.requestSha256) || candidate.exactBodyBytes > ceiling) {
      return finish("complete", "three-reference-unconfirmed");
    }
    const result = await transmit(candidate, "phase-c", "three-ref-search");
    if (!result) return finish("inconclusive", state.reason);
    if (result.classification === "size-accepted") threeLow = result.candidate;
    else threeHigh = result.candidate;
  }
  if (!threeLow || !threeHigh || threeHigh.exactBodyBytes <= threeLow.exactBodyBytes || state.requests + 2 > maxRequests) {
    return finish("complete", "three-reference-unconfirmed");
  }
  const three = await narrow(threeRoles, threeLow, threeHigh, "phase-c");
  if (!three.confirmed) return finish("complete", three.reason === "inconsistent-confirmation" ? "inconsistent-confirmation" : "three-reference-unconfirmed");
  state.threeLower = three.low;
  state.threeUpper = three.high;
  state.threeReferenceConfirmed = true;
  return finish("complete");
}
