export const PRIMARY_CEILING = 9;
export const ABSOLUTE_CEILING = 11;
export const PHASE_RETRY_LIMIT = 1;

export function failureStatus(result) {
  if (!result || typeof result !== "object") return null;
  const status = result.diagnostics?.providerStatus ?? result.providerStatus ?? null;
  return Number.isInteger(status) ? status : null;
}

export function isTransientFailure(result) {
  if (!result || result.ok) return false;
  const kind = result.kind || "provider";
  const status = failureStatus(result);
  if (kind === "timeout") return true;
  if (status === 429) return true;
  if (status != null && status >= 500 && status <= 599) return true;
  if (kind === "provider" && status == null) return true;
  return false;
}

export function stopReasonForFailure(result) {
  if (!result || result.ok) return null;
  const kind = result.kind || "provider";
  const status = failureStatus(result);
  if (kind === "configuration" || status === 401 || status === 403) return "credential-or-configuration";
  if (status === 413 || kind === "provider-payload-too-large") return "http-413";
  return null;
}

/**
 * Decide whether the next adapter call may be sent.
 * A retry is one extra call for a single transient anchor failure and, separately,
 * a single transient panel failure. The serialized request hash must match.
 */
export function evaluateInvocation({
  invocations = 0,
  ceiling = ABSOLUTE_CEILING,
  isRetry = false,
  phase = "anchor",
  phaseRetries = { anchor: 0, panel: 0 },
  failure = null,
  priorRequestSha256 = null,
  retryRequestSha256 = null,
} = {}) {
  if (invocations >= ceiling) {
    return { allow: false, stop: "absolute-ceiling", consumesRetry: false };
  }
  if (!isRetry) return { allow: true, stop: null, consumesRetry: false };
  if ((phaseRetries[phase] || 0) >= PHASE_RETRY_LIMIT) {
    return { allow: false, stop: null, consumesRetry: false, reason: "phase-retry-exhausted" };
  }
  if (!isTransientFailure(failure)) {
    return { allow: false, stop: null, consumesRetry: false, reason: "not-eligible" };
  }
  if (!priorRequestSha256 || priorRequestSha256 !== retryRequestSha256) {
    return { allow: false, stop: "request-contract-mismatch", consumesRetry: false, reason: "request-hash-mismatch" };
  }
  return { allow: true, stop: null, consumesRetry: true };
}
