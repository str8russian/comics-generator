import { chatCompletionsUrl } from './url.mjs';
import { redactAndShorten } from './redact.mjs';

function emptyResult(error, transportError, endpointPath) {
  return {
    ok: false,
    httpStatus: null,
    contentType: null,
    finishReason: null,
    content: null,
    hasContent: false,
    usage: null,
    usagePresent: false,
    reasoningEffortEcho: null,
    reasoningTokens: null,
    error,
    transportError,
    endpointPath,
  };
}

function reasoningEvidence(payload, choice) {
  const candidates = [payload?.reasoning_effort, choice?.reasoning_effort, payload?.reasoning?.effort];
  const reasoningEffortEcho = candidates.find((value) => typeof value === 'string') ?? null;
  const details = payload?.usage?.completion_tokens_details;
  const reasoningTokens = typeof payload?.usage?.reasoning_tokens === 'number'
    ? payload.usage.reasoning_tokens
    : (typeof details?.reasoning_tokens === 'number' ? details.reasoning_tokens : null);
  return { reasoningEffortEcho, reasoningTokens };
}

export function parseChatCompletion({ httpStatus, contentType, text, secrets }) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const result = {
    ok: httpStatus >= 200 && httpStatus < 300,
    httpStatus,
    contentType: contentType ? String(contentType).split(';')[0].trim() : null,
    finishReason: null,
    content: null,
    hasContent: false,
    usage: null,
    usagePresent: false,
    reasoningEffortEcho: null,
    reasoningTokens: null,
    error: null,
    transportError: null,
  };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    result.ok = false;
    result.error = redactAndShorten(text || 'response was not JSON', secrets);
    return result;
  }
  if (httpStatus >= 400 || payload.error) {
    const message = payload.error?.message || payload.message || text;
    result.ok = false;
    result.error = redactAndShorten(message, secrets);
    return result;
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  result.finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  result.content = typeof choice?.message?.content === 'string' ? choice.message.content : null;
  result.hasContent = Boolean(result.content && result.content.trim());
  if (payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)) {
    result.usage = payload.usage;
    result.usagePresent = true;
  }
  const evidence = reasoningEvidence(payload, choice);
  result.reasoningEffortEcho = evidence.reasoningEffortEcho;
  result.reasoningTokens = evidence.reasoningTokens;
  if (!result.finishReason && !result.hasContent) {
    result.ok = false;
    result.error = redactAndShorten(JSON.stringify(payload), secrets);
  }
  return result;
}

export async function postChatCompletion({
  baseUrl,
  token,
  body,
  timeoutMs = 120_000,
  signal,
  fetchImpl = globalThis.fetch,
  secrets = [token],
}) {
  const url = chatCompletionsUrl(baseUrl);
  const endpointPath = new URL(url).pathname;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ...parseChatCompletion({
        httpStatus: response.status,
        contentType: response.headers.get('content-type'),
        text,
        secrets,
      }),
      endpointPath,
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError' || controller.signal.aborted;
    const transportError = aborted ? (timedOut ? 'timeout' : 'abort') : 'network';
    const message = transportError === 'timeout'
      ? 'request timed out'
      : (transportError === 'abort' ? 'request aborted' : (err?.message || 'request failed'));
    return emptyResult(redactAndShorten(message, secrets), transportError, endpointPath);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
