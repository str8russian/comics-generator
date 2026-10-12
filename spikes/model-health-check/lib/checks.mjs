import { http1Fetch } from '../../contest-image-generation/lib/http1.mjs';
import { sniffImage } from '../../contest-image-generation/lib/image-info.mjs';
import { redactAndShorten } from '../../contest-image-generation/lib/redact.mjs';
import { extractImagePayload, pickUsage } from '../../contest-image-generation/lib/transport.mjs';
import { resolveApiPath } from '../../contest-image-generation/lib/url.mjs';

export const TEXT_PROMPT = 'Ответь одним словом: сколько будет 2+2?';
export const IMAGE_PROMPT = 'A flat red square centered on a white background. No text, no people.';

export const CHECKS = Object.freeze({
  'text-gpt': { id: 'text-gpt', kind: 'text', label: 'GPT 5.5', model: 'gpt-5.5' },
  'text-claude': { id: 'text-claude', kind: 'text', label: 'Claude Opus 4.8', model: 'claude-opus-4.8' },
  'image-gemini-3-pro': { id: 'image-gemini-3-pro', kind: 'image', label: 'Gemini 3 Pro Image Preview', model: 'gemini-3-pro-image-preview' },
  'image-gemini-2-5-flash': { id: 'image-gemini-2-5-flash', kind: 'image', label: 'Gemini 2.5 Flash Image', model: 'gemini-2.5-flash-image' },
  'image-gemini-3-1-flash': { id: 'image-gemini-3-1-flash', kind: 'image', label: 'Gemini 3.1 Flash Image Preview', model: 'gemini-3.1-flash-image-preview' },
  'invalid-model': { id: 'invalid-model', kind: 'invalid', label: 'Invalid model control', model: 'opus-4.8' },
  quota: { id: 'quota', kind: 'quota', label: 'API key quota', model: null },
});

export function publicChecks() {
  return Object.values(CHECKS).map(({ id, kind, label, model }) => ({ id, kind, label, model }));
}

export function buildProviderRequest(check) {
  if (check.kind === 'quota') {
    return { method: 'GET', path: '/key/info', headers: { accept: 'application/json' }, body: null };
  }
  const payload = check.kind === 'image'
    ? {
      model: check.model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: IMAGE_PROMPT }],
    }
    : {
      model: check.model,
      messages: [{ role: 'user', content: TEXT_PROMPT }],
    };
  return {
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function extractText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => typeof part === 'string' ? part : (part?.text ?? ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function errorText(payload, fallback, redactWith) {
  const raw = payload?.error?.message ?? payload?.error ?? payload?.message ?? fallback ?? 'request failed';
  return redactAndShorten(typeof raw === 'string' ? raw : 'request failed', redactWith);
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function quotaSummary(payload) {
  const info = payload?.info;
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  const spend = numeric(info.spend);
  const maxBudget = numeric(info.max_budget);
  const spentPercent = spend != null && maxBudget != null && maxBudget > 0
    ? Math.round((spend / maxBudget) * 10_000) / 100
    : null;
  return {
    spend,
    max_budget: maxBudget,
    spent_percent: spentPercent,
    left_percent: spentPercent == null ? null : Math.max(0, Math.round((100 - spentPercent) * 100) / 100),
    last_active: typeof info.last_active === 'string' ? info.last_active : null,
  };
}

function classifyNetworkError(error, timedOut, started, check, redactWith) {
  return {
    id: check.id,
    kind: check.kind,
    model: check.model,
    checked_at: new Date().toISOString(),
    latency_ms: Date.now() - started,
    http_status: null,
    outcome: timedOut ? 'timeout' : 'network-error',
    reachable: false,
    ok: false,
    error: timedOut ? 'request timed out' : redactAndShorten(error?.message || 'network request failed', redactWith),
  };
}

export async function runCheck(checkId, config, options = {}) {
  const check = CHECKS[checkId];
  if (!check) {
    const error = new Error('unknown check');
    error.status = 404;
    error.code = 'unknown-check';
    throw error;
  }
  if (!config?.configured) {
    const error = new Error(config?.reason || 'server is not configured');
    error.status = 503;
    error.code = 'not-configured';
    throw error;
  }
  const fetchImpl = options.fetchImpl ?? http1Fetch;
  const request = buildProviderRequest(check);
  const target = resolveApiPath(config.baseUrl, request.path);
  const redactWith = { secrets: [config.token], baseUrl: config.baseUrl };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(target.href, {
      method: request.method,
      headers: { ...request.headers, Authorization: `Bearer ${config.token}` },
      body: request.body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    let payload = null;
    if (contentType === 'application/json' || contentType.endsWith('+json') || bytes[0] === 0x7b) {
      try {
        payload = JSON.parse(bytes.toString('utf8'));
      } catch {
        payload = null;
      }
    }
    const base = {
      id: check.id,
      kind: check.kind,
      model: check.model,
      checked_at: new Date().toISOString(),
      latency_ms: latencyMs,
      http_status: response.status,
      reachable: true,
    };
    if (check.kind === 'invalid') {
      const expected = response.status >= 400 || Boolean(payload?.error);
      return {
        ...base,
        ok: expected,
        outcome: expected ? 'expected-error' : 'unexpected-success',
        error: expected ? errorText(payload, bytes.toString('utf8'), redactWith) : 'invalid model unexpectedly succeeded',
      };
    }
    if (response.status >= 300 || payload?.error) {
      return {
        ...base,
        ok: false,
        outcome: 'http-error',
        error: errorText(payload, bytes.toString('utf8'), redactWith),
      };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ...base, ok: false, outcome: 'invalid-response', error: 'response was not valid JSON' };
    }
    if (check.kind === 'quota') {
      const quota = quotaSummary(payload);
      return quota
        ? { ...base, ok: true, outcome: 'available', quota }
        : { ...base, ok: false, outcome: 'invalid-response', error: 'response did not contain quota information' };
    }
    if (check.kind === 'text') {
      const answer = extractText(payload);
      return {
        ...base,
        ok: Boolean(answer),
        outcome: answer ? 'available' : 'invalid-response',
        answer: answer || null,
        answer_matches_expected: /^(4|четыре)[.!?]?$/iu.test(answer),
        usage: pickUsage(payload),
        error: answer ? null : 'response did not contain assistant text',
      };
    }
    const extracted = extractImagePayload(payload);
    const source = extracted.images[0];
    if (!source?.buffer) {
      return {
        ...base,
        ok: false,
        outcome: extracted.urls.length ? 'unsupported-image-url' : 'invalid-response',
        usage: extracted.usage,
        error: extracted.urls.length ? 'response contained an image URL instead of inline image data' : 'response did not contain an image',
      };
    }
    const image = sniffImage(source.buffer);
    if (!image.mime) {
      return { ...base, ok: false, outcome: 'invalid-image', usage: extracted.usage, error: 'returned image bytes were not recognized' };
    }
    return {
      ...base,
      ok: true,
      outcome: 'available',
      usage: extracted.usage,
      image: {
        mime: image.mime,
        width: image.width,
        height: image.height,
        data_url: `data:${image.mime};base64,${source.buffer.toString('base64')}`,
      },
    };
  } catch (error) {
    return classifyNetworkError(error, timedOut, started, check, redactWith);
  } finally {
    clearTimeout(timer);
  }
}
