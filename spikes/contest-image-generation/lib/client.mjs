import { http1Fetch } from './http1.mjs';
import { sniffImage } from './image-info.mjs';
import { redactAndShorten } from './redact.mjs';
import { extractImagePayload, summarizeOpenApi } from './transport.mjs';
import { resolveApiPath } from './url.mjs';

function statusClass(status) {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 405 || status === 413 || status === 422 || status === 429) {
    return `http-${status}`;
  }
  if (status >= 400 && status < 500) return 'http-4xx';
  if (status >= 500) return 'http-5xx';
  return null;
}

function errorMessage(payload, text, redactWith) {
  const message = payload?.error?.message || payload?.error || payload?.message || text || 'request failed';
  return redactAndShorten(typeof message === 'string' ? message : 'request failed', redactWith);
}

export async function sendProviderRequest({
  baseUrl,
  token,
  request,
  timeoutMs = 180_000,
  fetchImpl = http1Fetch,
  redactWith,
  onRequest,
  followImageUrl = true,
}) {
  const target = resolveApiPath(baseUrl, request.path);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const started = Date.now();
  try {
    if (onRequest && await onRequest() === false) {
      return {
        ok: false,
        httpStatus: null,
        contentType: null,
        endpointPath: target.pathname,
        latencyMs: 0,
        errorClass: 'budget',
        error: 'request budget exhausted',
        images: [],
        usage: null,
        finishReason: null,
        representation: null,
        imageDownload: null,
      };
    }
    const response = await fetchImpl(target.href, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${token}`,
      },
      body: request.body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        httpStatus: response.status,
        contentType: null,
        endpointPath: target.pathname,
        latencyMs,
        errorClass: 'redirect',
        error: 'provider redirected the request',
        images: [],
        usage: null,
        finishReason: null,
        representation: null,
        imageDownload: null,
      };
    }
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (contentType.startsWith('image/')) {
      const sniffed = sniffImage(bytes);
      return {
        ok: response.status >= 200 && response.status < 300 && Boolean(sniffed.mime),
        httpStatus: response.status,
        contentType,
        endpointPath: target.pathname,
        latencyMs,
        errorClass: response.status >= 400 ? statusClass(response.status) : null,
        error: response.status >= 400 ? errorMessage(null, 'image error response', redactWith) : null,
        images: sniffed.mime ? [{ buffer: bytes, mime: sniffed.mime, width: sniffed.width, height: sniffed.height }] : [],
        usage: null,
        finishReason: null,
        representation: 'binary',
        imageDownload: null,
      };
    }
    const text = bytes.toString('utf8');
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        httpStatus: response.status,
        contentType,
        endpointPath: target.pathname,
        latencyMs,
        errorClass: response.status >= 400 ? statusClass(response.status) : 'non-json',
        error: redactAndShorten(text || 'response was not JSON', redactWith),
        images: [],
        usage: null,
        finishReason: null,
        representation: null,
        imageDownload: null,
      };
    }
    if (response.status >= 400 || payload.error) {
      return {
        ok: false,
        httpStatus: response.status,
        contentType,
        endpointPath: target.pathname,
        latencyMs,
        errorClass: statusClass(response.status) || 'http-error',
        error: errorMessage(payload, text, redactWith),
        images: [],
        usage: extractImagePayload(payload).usage,
        finishReason: null,
        representation: null,
        imageDownload: null,
      };
    }
    if (request.summarizeOpenApi) {
      const openapi = summarizeOpenApi(payload);
      return {
        ok: Boolean(openapi?.length),
        httpStatus: response.status,
        contentType,
        endpointPath: target.pathname,
        latencyMs,
        errorClass: openapi?.length ? null : 'not-openapi',
        error: openapi?.length ? null : 'response was not image API documentation',
        images: [],
        usage: null,
        finishReason: null,
        representation: null,
        openapi,
        imageDownload: null,
      };
    }
    const extracted = extractImagePayload(payload);
    let images = extracted.images.map((image) => {
      const sniffed = sniffImage(image.buffer);
      return {
        buffer: image.buffer,
        mime: sniffed.mime || image.mime,
        width: sniffed.width,
        height: sniffed.height,
        representation: image.representation,
      };
    }).filter((image) => image.mime);
    let representation = images[0]?.representation ?? null;
    let imageDownload = null;
    if (!images.length && extracted.urls.length && followImageUrl) {
      const fetched = await fetchResultUrl({
        url: extracted.urls[0],
        baseUrl,
        fetchImpl,
        timeoutMs,
        onRequest,
        redactWith,
      });
      if (fetched.image) {
        images = [fetched.image];
        representation = 'url';
        imageDownload = { httpStatus: fetched.httpStatus, errorClass: null };
      } else if (fetched.errorClass) {
        return {
          ok: false,
          httpStatus: response.status,
          contentType,
          endpointPath: target.pathname,
          latencyMs: Date.now() - started,
          errorClass: fetched.errorClass,
          error: fetched.error,
          images: [],
          usage: extracted.usage,
          finishReason: extracted.finish_reason,
          representation: fetched.errorClass === 'pending-image-download' ? 'pending-image-download' : 'url',
          imageDownload: fetched.attempted
            ? { httpStatus: fetched.httpStatus ?? null, errorClass: fetched.errorClass }
            : null,
        };
      }
    }
    return {
      ok: images.length > 0,
      httpStatus: response.status,
      contentType,
      endpointPath: target.pathname,
      latencyMs,
      errorClass: images.length ? null : 'no-image',
      error: images.length ? null : 'response did not contain an image',
      images,
      usage: extracted.usage,
      finishReason: extracted.finish_reason,
      representation,
      imageDownload,
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError' || controller.signal.aborted;
    const errorClass = aborted ? (timedOut ? 'timeout' : 'abort') : 'network';
    const message = errorClass === 'timeout' ? 'request timed out' : (errorClass === 'abort' ? 'request aborted' : (err?.message || 'request failed'));
    return {
      ok: false,
      httpStatus: null,
      contentType: null,
      endpointPath: target.pathname,
      latencyMs: Date.now() - started,
      errorClass,
      error: redactAndShorten(message, redactWith),
      images: [],
      usage: null,
      finishReason: null,
      representation: null,
      imageDownload: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function imageUrlRedact(url, parsed, baseUrl, redactWith) {
  const secrets = [...(redactWith?.secrets ?? [])];
  if (url.length >= 4) secrets.push(url);
  if (parsed.search.length >= 4) secrets.push(parsed.search);
  for (const value of parsed.searchParams.values()) {
    if (typeof value === 'string' && value.length >= 4) secrets.push(value);
  }
  return { secrets, baseUrl: redactWith?.baseUrl || baseUrl };
}

async function fetchResultUrl({ url, baseUrl, fetchImpl, timeoutMs, onRequest, redactWith }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { errorClass: 'off-host-url', error: 'image URL was not usable', attempted: false };
  }
  let allowed;
  try {
    allowed = new URL(baseUrl);
  } catch {
    return { errorClass: 'off-host-url', error: 'image URL was not usable', attempted: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { errorClass: 'off-host-url', error: 'image URL scheme was not allowed', attempted: false };
  }
  if (parsed.username || parsed.password || parsed.host !== allowed.host) {
    return { errorClass: 'off-host-url', error: 'image URL host did not match the provider', attempted: false };
  }
  if (onRequest && await onRequest() === false) {
    return {
      errorClass: 'pending-image-download',
      error: 'image download deferred because the request budget was exhausted',
      attempted: false,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const redactDownload = imageUrlRedact(url, parsed, baseUrl, redactWith);
  try {
    const response = await fetchImpl(parsed.toString(), { redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      return { errorClass: 'redirect', error: 'image URL redirected', attempted: true, httpStatus: response.status };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const sniffed = sniffImage(bytes);
    if (!sniffed.mime) {
      return { errorClass: 'no-image', error: 'image URL was not an image', attempted: true, httpStatus: response.status };
    }
    return {
      image: { buffer: bytes, mime: sniffed.mime, width: sniffed.width, height: sniffed.height, representation: 'url' },
      attempted: true,
      httpStatus: response.status,
    };
  } catch (err) {
    return {
      errorClass: 'network',
      error: redactAndShorten(err?.message || 'image fetch failed', redactDownload),
      attempted: true,
      httpStatus: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
