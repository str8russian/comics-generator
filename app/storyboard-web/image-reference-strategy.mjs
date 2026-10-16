import { createHash } from "node:crypto";
import sharp from "sharp";
import { inspectImage } from "./image-info.mjs";
import { buildImageRequest } from "./image-provider.mjs";

export const DEFAULT_REFERENCE_STRATEGY = "budgeted";
export const DEFAULT_REQUEST_BUDGET_BYTES = 850_000;
export const LONG_EDGE_LADDER = Object.freeze([1024, 896, 768, 640, 600, 512, 448]);
export const IMAGE_ENCODING = Object.freeze({
  png: Object.freeze({ compressionLevel: 9, adaptiveFiltering: false, palette: false }),
  jpeg: Object.freeze({ quality: 80, mozjpeg: true, progressive: false, chromaSubsampling: "4:4:4" }),
  webp: Object.freeze({ quality: 80, effort: 4, smartSubsample: false }),
});

const STRATEGIES = new Set(["budgeted", "passthrough"]);
const ROLES = new Set(["anchor", "identity", "style", "previous", "current", "performance"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneReference(ref) {
  return {
    role: ref.role,
    assetId: ref.assetId ?? null,
    mime: ref.mime,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
  };
}

export function loadImageReferenceConfig(env = process.env) {
  const rawStrategy = env?.IMAGE_REFERENCE_STRATEGY;
  const strategy = rawStrategy == null || String(rawStrategy).trim() === ""
    ? DEFAULT_REFERENCE_STRATEGY
    : String(rawStrategy).trim();
  if (!STRATEGIES.has(strategy)) {
    return { ok: false, kind: "configuration", reason: "image-reference-strategy" };
  }
  const rawBudget = env?.IMAGE_REQUEST_BUDGET_BYTES;
  if (rawBudget == null || String(rawBudget).trim() === "") {
    return { ok: true, strategy, budgetBytes: DEFAULT_REQUEST_BUDGET_BYTES };
  }
  const budgetBytes = Number(String(rawBudget).trim());
  if (!Number.isInteger(budgetBytes) || budgetBytes <= 0) {
    return { ok: false, kind: "configuration", reason: "image-request-budget" };
  }
  return { ok: true, strategy, budgetBytes };
}

export function toReference(role, asset) {
  const raw = asset?.bytes ?? asset?.buffer ?? null;
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
  const inspected = inspectImage(bytes);
  const width = Number(asset?.width ?? inspected.width ?? 0);
  const height = Number(asset?.height ?? inspected.height ?? 0);
  return {
    role,
    assetId: asset?.id ?? asset?.assetId ?? null,
    mime: asset?.mime || inspected.mime || null,
    bytes,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

export function serializeImageRequest({ prompt, references, aspectRatio, model }) {
  return JSON.stringify(buildImageRequest({
    prompt,
    images: references.map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
    aspectRatio,
    model,
  }));
}

function measure(references, compilePrompt, aspectRatio, model) {
  const prompt = compilePrompt(references);
  const serializedBody = serializeImageRequest({ prompt, references, aspectRatio, model });
  return { prompt, serializedBody, bodyBytes: Buffer.byteLength(serializedBody) };
}

function safeDiagnostics({
  strategy,
  originalReferences,
  references,
  originalBodyBytes,
  finalBodyBytes,
  transforms,
  omittedRoles,
  requestSha256,
}) {
  const originalByRole = new Map(originalReferences.map((ref) => [ref.role, ref]));
  const fields = {
    strategy,
    referenceRoles: references.map((ref) => ref.role).join(","),
    originalRoles: originalReferences.map((ref) => ref.role).join(","),
    referenceCount: references.length,
    originalBodyBytes,
    finalBodyBytes,
    transformStep: transforms.length ? transforms.map((item) => item.step).join("+") : "none",
    omittedRoles: omittedRoles.length ? omittedRoles.join(",") : "none",
  };
  if (requestSha256) fields.requestSha256 = requestSha256;
  originalReferences.forEach((ref, index) => {
    fields[`orig${index}`] = `${ref.role}:${ref.width}x${ref.height}:${ref.bytes.length}`;
  });
  references.forEach((ref, index) => {
    const original = originalByRole.get(ref.role) || ref;
    fields[`ref${index}`] = `${ref.role}:${original.width}x${original.height}:${original.bytes.length}>${ref.width}x${ref.height}:${ref.bytes.length}`;
  });
  fields.references = references.map((ref) => {
    const original = originalByRole.get(ref.role) || ref;
    return {
      role: ref.role,
      assetId: ref.assetId ?? null,
      mime: ref.mime,
      width: ref.width,
      height: ref.height,
      byteLength: ref.bytes.length,
      originalWidth: original.width,
      originalHeight: original.height,
      originalByteLength: original.bytes.length,
    };
  });
  return fields;
}

function accepted({
  strategy,
  originalReferences,
  references,
  prompt,
  serializedBody,
  originalBodyBytes,
  transforms,
  omittedRoles,
}) {
  const finalBodyBytes = Buffer.byteLength(serializedBody);
  const requestSha256 = sha256(serializedBody);
  return {
    ok: true,
    strategy,
    prompt,
    references,
    serializedBody,
    originalBodyBytes,
    finalBodyBytes,
    transforms,
    omittedRoles,
    requestSha256,
    diagnostics: safeDiagnostics({
      strategy,
      originalReferences,
      references,
      originalBodyBytes,
      finalBodyBytes,
      transforms,
      omittedRoles,
      requestSha256,
    }),
  };
}

function rejected({
  strategy,
  originalReferences,
  references,
  originalBodyBytes,
  finalBodyBytes,
  transforms,
  omittedRoles,
}) {
  return {
    ok: false,
    status: "failed",
    kind: "reference-payload-too-large",
    httpStatus: 422,
    strategy,
    references,
    serializedBody: null,
    originalBodyBytes,
    finalBodyBytes,
    transforms,
    omittedRoles,
    diagnostics: safeDiagnostics({
      strategy,
      originalReferences,
      references,
      originalBodyBytes,
      finalBodyBytes,
      transforms,
      omittedRoles,
    }),
  };
}

function configurationFailure(strategy = "invalid") {
  return {
    ok: false,
    status: "failed",
    kind: "configuration",
    httpStatus: 500,
    diagnostics: { strategy },
  };
}

function styleOmissionAllowed(references, generationMode) {
  if (generationMode !== "revision") return false;
  const roles = new Set(references.map((ref) => ref.role));
  const authority = roles.has("anchor") || roles.has("identity");
  const current = roles.has("current") || roles.has("previous");
  return authority && current && roles.has("style") && !roles.has("performance");
}

export async function transcodeReference(ref, maxLongEdge, encoding = IMAGE_ENCODING) {
  const sourceLongEdge = Math.max(Number(ref.width) || 0, Number(ref.height) || 0);
  if (!sourceLongEdge || sourceLongEdge <= maxLongEdge) return null;
  const scale = maxLongEdge / sourceLongEdge;
  const width = Math.max(1, Math.round(ref.width * scale));
  const height = Math.max(1, Math.round(ref.height * scale));
  if (width >= ref.width && height >= ref.height) return null;
  const mime = ref.mime === "image/jpg" ? "image/jpeg" : ref.mime;
  try {
    let pipeline = sharp(ref.bytes, { failOn: "none" }).resize(width, height, {
      fit: "fill",
      withoutEnlargement: true,
      kernel: "lanczos3",
    });
    if (mime === "image/jpeg") pipeline = pipeline.jpeg(encoding.jpeg);
    else if (mime === "image/webp") pipeline = pipeline.webp(encoding.webp);
    else pipeline = pipeline.png(encoding.png);
    const bytes = await pipeline.toBuffer();
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    const outWidth = meta.width || width;
    const outHeight = meta.height || height;
    if (Math.max(outWidth, outHeight) > sourceLongEdge) return null;
    return {
      role: ref.role,
      assetId: ref.assetId ?? null,
      mime,
      bytes,
      width: outWidth,
      height: outHeight,
    };
  } catch {
    return null;
  }
}

async function applyLadderStep(references, maxLongEdge, transcode) {
  let changed = false;
  const next = [];
  for (const ref of references) {
    const longEdge = Math.max(Number(ref.width) || 0, Number(ref.height) || 0);
    if (!longEdge || longEdge <= maxLongEdge) {
      next.push(cloneReference(ref));
      continue;
    }
    const transformed = await transcode(ref, maxLongEdge);
    if (!transformed?.bytes || transformed.bytes === ref.bytes) {
      next.push(cloneReference(ref));
      continue;
    }
    changed = true;
    next.push({
      role: ref.role,
      assetId: ref.assetId ?? null,
      mime: transformed.mime || ref.mime,
      bytes: transformed.bytes,
      width: transformed.width,
      height: transformed.height,
    });
  }
  return changed ? next : null;
}

async function fitGroup({
  references,
  compilePrompt,
  aspectRatio,
  model,
  budgetBytes,
  transcode,
  priorTransforms,
  omittedRoles,
  originalReferences,
  originalBodyBytes,
}) {
  const baseline = measure(references, compilePrompt, aspectRatio, model);
  if (baseline.bodyBytes <= budgetBytes) {
    return accepted({
      strategy: "budgeted",
      originalReferences,
      references,
      prompt: baseline.prompt,
      serializedBody: baseline.serializedBody,
      originalBodyBytes,
      transforms: priorTransforms,
      omittedRoles,
    });
  }
  let last = baseline;
  let lastRefs = references;
  for (const edge of LONG_EDGE_LADDER) {
    const transformed = await applyLadderStep(references, edge, transcode);
    if (!transformed) continue;
    const measured = measure(transformed, compilePrompt, aspectRatio, model);
    last = measured;
    lastRefs = transformed;
    if (measured.bodyBytes <= budgetBytes) {
      return accepted({
        strategy: "budgeted",
        originalReferences,
        references: transformed,
        prompt: measured.prompt,
        serializedBody: measured.serializedBody,
        originalBodyBytes,
        transforms: [...priorTransforms, { step: `long-edge:${edge}` }],
        omittedRoles,
      });
    }
  }
  return { fitted: false, last, lastRefs };
}

export async function prepareImageRequest({
  strategy,
  budgetBytes,
  references,
  generationMode = "initial",
  compilePrompt,
  aspectRatio,
  model,
  transcode = transcodeReference,
}) {
  if (!STRATEGIES.has(strategy)) return configurationFailure("invalid");
  if (!Number.isInteger(budgetBytes) || budgetBytes <= 0) return configurationFailure(strategy);
  if (typeof compilePrompt !== "function" || !model || !aspectRatio) return configurationFailure(strategy);
  if (!Array.isArray(references) || references.some((ref) => !ROLES.has(ref?.role) || !Buffer.isBuffer(ref?.bytes))) {
    return configurationFailure(strategy);
  }
  const originalReferences = references.map(cloneReference);
  const baseline = measure(originalReferences, compilePrompt, aspectRatio, model);
  if (strategy === "passthrough") {
    return accepted({
      strategy,
      originalReferences,
      references: originalReferences,
      prompt: baseline.prompt,
      serializedBody: baseline.serializedBody,
      originalBodyBytes: baseline.bodyBytes,
      transforms: [],
      omittedRoles: [],
    });
  }
  const fitted = await fitGroup({
    references: originalReferences,
    compilePrompt,
    aspectRatio,
    model,
    budgetBytes,
    transcode,
    priorTransforms: [],
    omittedRoles: [],
    originalReferences,
    originalBodyBytes: baseline.bodyBytes,
  });
  if (fitted.ok) return fitted;
  if (styleOmissionAllowed(originalReferences, generationMode)) {
    const reduced = originalReferences.filter((ref) => ref.role !== "style").map(cloneReference);
    const omitted = await fitGroup({
      references: reduced,
      compilePrompt,
      aspectRatio,
      model,
      budgetBytes,
      transcode,
      priorTransforms: [{ step: "omit-role:style" }],
      omittedRoles: ["style"],
      originalReferences,
      originalBodyBytes: baseline.bodyBytes,
    });
    if (omitted.ok) return omitted;
    return rejected({
      strategy,
      originalReferences,
      references: omitted.lastRefs,
      originalBodyBytes: baseline.bodyBytes,
      finalBodyBytes: omitted.last.bodyBytes,
      transforms: [{ step: "omit-role:style" }],
      omittedRoles: ["style"],
    });
  }
  return rejected({
    strategy,
    originalReferences,
    references: fitted.lastRefs,
    originalBodyBytes: baseline.bodyBytes,
    finalBodyBytes: fitted.last.bodyBytes,
    transforms: [],
    omittedRoles: [],
  });
}

export async function executeImageRequest(input) {
  const prepared = await prepareImageRequest(input);
  if (!prepared.ok) return prepared;
  const result = await input.imageGenerator({
    prompt: prepared.prompt,
    images: prepared.references.map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
    aspectRatio: input.aspectRatio,
    serializedBody: prepared.serializedBody,
    env: input.env,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    transport: prepared.diagnostics,
  });
  const diagnostics = {
    ...prepared.diagnostics,
    ...(result?.diagnostics || {}),
  };
  if (result?.ok) {
    return {
      ...result,
      diagnostics,
      metadata: {
        ...(result.metadata || {}),
        strategy: prepared.strategy,
        referenceRoles: prepared.diagnostics.referenceRoles,
        referenceCount: prepared.diagnostics.referenceCount,
        originalBodyBytes: prepared.originalBodyBytes,
        finalBodyBytes: prepared.finalBodyBytes,
        transformStep: prepared.diagnostics.transformStep,
        omittedRoles: prepared.diagnostics.omittedRoles,
        requestSha256: prepared.requestSha256,
      },
    };
  }
  return {
    ok: false,
    status: "failed",
    kind: result?.kind || "provider",
    httpStatus: result?.httpStatus || 502,
    diagnostics,
  };
}

export function transportLogFields(diagnostics = {}) {
  const fields = {};
  for (const key of [
    "strategy",
    "referenceRoles",
    "originalRoles",
    "referenceCount",
    "originalBodyBytes",
    "finalBodyBytes",
    "transformStep",
    "omittedRoles",
    "requestSha256",
    "providerStatus",
    "latencyMs",
  ]) {
    const value = diagnostics[key];
    if (value == null || value === "") continue;
    if (typeof value === "string" && value.length > 120) continue;
    fields[key] = value;
  }
  for (let index = 0; index < 3; index += 1) {
    for (const prefix of ["orig", "ref"]) {
      const key = `${prefix}${index}`;
      const value = diagnostics[key];
      if (typeof value === "string" && value.length > 0 && value.length <= 120) fields[key] = value;
    }
  }
  return fields;
}
