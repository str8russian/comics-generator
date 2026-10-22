import { createHash } from "node:crypto";

const UNSAFE_TEXT = /data:image\/|\/downloads\/|comicsgeneratorassets|bearer\s+|https?:\/\/|contest_api_token|"(?:\/Users\/|\/home\/|\/var\/|\/private\/|\/tmp\/)/i;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSafeEvidence(value) {
  const text = JSON.stringify(value);
  if (UNSAFE_TEXT.test(text)) {
    throw new Error("unsafe evidence");
  }
  return value;
}

export function buildCellEvidence({
  cell,
  status,
  attemptNumber = null,
  failureKind = null,
  skippedReason = null,
  providerStatus = null,
  latencyMs = null,
  prompt,
  referenceRoles = [],
  normalizedReferences = [],
  requestSha256 = null,
  requestBytes = null,
  model = null,
  transformStep = null,
  omittedRoles = [],
  output = null,
  invocations = null,
}) {
  const evidence = {
    id: cell.id,
    publicId: cell.publicId,
    blindCode: cell.blindCode,
    sourceId: cell.sourceId,
    condition: cell.condition,
    repetition: cell.repetition,
    status,
    attemptNumber,
    failureKind,
    skippedReason,
    providerStatus: Number.isInteger(providerStatus) ? providerStatus : null,
    latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null,
    promptSha256: sha256(prompt),
    promptPath: `prompts/${cell.id}.txt`,
    referenceRoles: referenceRoles.map((role) => String(role)),
    normalizedReferences: normalizedReferences.map((ref) => ({
      role: String(ref.role),
      mime: String(ref.mime || ""),
      width: Number(ref.width) || 0,
      height: Number(ref.height) || 0,
      byteLength: Number(ref.byteLength) || 0,
    })),
    requestSha256: requestSha256 || null,
    requestBytes: Number.isFinite(requestBytes) ? requestBytes : null,
    model: model || null,
    transformStep: transformStep || null,
    omittedRoles: omittedRoles.map((role) => String(role)),
    outputSha256: output?.sha256 || null,
    outputPath: output ? `outputs/${cell.id}.${output.extension}` : null,
    outputMime: output?.mime || null,
    outputWidth: output?.width ?? null,
    outputHeight: output?.height ?? null,
    invocations: Array.isArray(invocations) ? invocations.map(publicInvocation) : undefined,
  };
  if (!evidence.invocations) delete evidence.invocations;
  return assertSafeEvidence(evidence);
}

function publicInvocation(invocation) {
  return {
    attemptNumber: Number.isInteger(invocation.attemptNumber) ? invocation.attemptNumber : null,
    status: String(invocation.status || ""),
    failureKind: invocation.failureKind || null,
    providerStatus: Number.isInteger(invocation.providerStatus) ? invocation.providerStatus : null,
    latencyMs: Number.isFinite(invocation.latencyMs) ? Math.max(0, Math.round(invocation.latencyMs)) : null,
    requestSha256: invocation.requestSha256 || null,
    requestBytes: Number.isFinite(invocation.requestBytes) ? invocation.requestBytes : null,
  };
}

export function publicInputRecord(input) {
  const record = {
    logicalId: input.logicalId,
    role: input.role,
    sha256: input.sha256,
    mime: input.mime,
    width: input.width,
    height: input.height,
  };
  if (typeof input.relativePath === "string") record.path = input.relativePath;
  return assertSafeEvidence(record);
}
