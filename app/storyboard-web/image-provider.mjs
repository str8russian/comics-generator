import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { inspectImage } from "./image-info.mjs";

const IMAGE_MODEL = "gemini-3-pro-image-preview";

export function resolveImageModel(env = process.env) {
  return String(env.IMAGE_MODEL ?? IMAGE_MODEL).trim();
}

function failure(kind, httpStatus = 502, diagnostics = {}) {
  return { ok: false, status: "failed", kind, httpStatus, diagnostics };
}

function completionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) url.pathname = path;
  else if (path.endsWith("/v1")) url.pathname = `${path}/chat/completions`;
  else url.pathname = `${path}/v1/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function dataUrl(image) {
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}

export function buildImageRequest({ prompt, images = [], aspectRatio, model = IMAGE_MODEL }) {
  return {
    model,
    modalities: ["image", "text"],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map((image) => ({ type: "image_url", image_url: { url: dataUrl(image) } })),
      ],
    }],
    image_config: { aspect_ratio: aspectRatio },
  };
}

function decode(value) {
  if (typeof value !== "string" || value.length < 16) return null;
  const text = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    const bytes = Buffer.from(text, "base64");
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

function walk(value, found, depth = 0) {
  if (value == null || depth > 8) return;
  if (typeof value === "string") {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
    if (match) {
      const bytes = decode(match[2]);
      if (bytes) found.push({ bytes, declaredMime: match[1].toLowerCase() });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const inline = value.inlineData || value.inline_data;
  if (inline?.data) {
    const bytes = decode(inline.data);
    if (bytes) found.push({ bytes, declaredMime: String(inline.mimeType || inline.mime_type || "image/png").toLowerCase() });
  }
  if (typeof value.b64_json === "string") {
    const bytes = decode(value.b64_json);
    if (bytes) found.push({ bytes, declaredMime: "image/png" });
  }
  if (value.image_url?.url) walk(value.image_url.url, found, depth + 1);
  for (const [key, child] of Object.entries(value)) {
    if (["inlineData", "inline_data", "b64_json", "image_url"].includes(key)) continue;
    walk(child, found, depth + 1);
  }
}

export function extractGeneratedImage(payload) {
  const found = [];
  walk(payload, found);
  for (const candidate of found) {
    const info = inspectImage(candidate.bytes);
    if (!info.mime) continue;
    return { bytes: candidate.bytes, ...info };
  }
  return null;
}

function http1Fetch(url, init = {}) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) return Promise.reject(new Error("unsupported protocol"));
  const body = init.body == null ? null : Buffer.from(init.body);
  const headers = { ...(init.headers || {}) };
  if (body && headers["content-length"] == null && headers["Content-Length"] == null) {
    headers["content-length"] = String(body.length);
  }
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const req = request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: init.method || "GET",
      headers,
      ALPNProtocols: ["http/1.1"],
      servername: target.hostname,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [key, entry] of Object.entries(res.headers)) {
          if (entry != null) responseHeaders.set(key, Array.isArray(entry) ? entry.join(", ") : String(entry));
        }
        done(resolve, new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: responseHeaders }));
      });
    });
    const fail = (error) => {
      if (init.signal?.aborted) {
        const aborted = new Error("request aborted");
        aborted.name = "AbortError";
        done(reject, aborted);
        return;
      }
      done(reject, error);
    };
    req.on("error", fail);
    if (init.signal) {
      const abort = () => req.destroy(Object.assign(new Error("request aborted"), { name: "AbortError" }));
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    }
    req.end(body ?? undefined);
  });
}

export const ANCHOR_SESSION_PROVIDER_CAP_MS = 58_000;

export function anchorSessionProviderTimeoutMs(env = {}) {
  const requested = Number(env.ANCHOR_SESSION_TIMEOUT_MS ?? ANCHOR_SESSION_PROVIDER_CAP_MS);
  const ceiling = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, ANCHOR_SESSION_PROVIDER_CAP_MS)
    : ANCHOR_SESSION_PROVIDER_CAP_MS;
  const configured = Number(env.IMAGE_TIMEOUT_MS || env.CONTEST_TIMEOUT_MS || 180000);
  if (!Number.isFinite(configured) || configured <= 0) return ceiling;
  return Math.min(configured, ceiling);
}

export function assessImageTransport({
  prompt,
  images,
  aspectRatio,
  env = process.env,
  timeoutMs: timeoutOverride,
}) {
  const baseUrl = String(env.BASE_URL ?? "").trim();
  const token = String(env.CONTEST_API_TOKEN ?? "").trim();
  const model = resolveImageModel(env);
  const configured = Number(env.IMAGE_TIMEOUT_MS || env.CONTEST_TIMEOUT_MS || 180000);
  const override = Number(timeoutOverride);
  const timeoutMs = Number.isFinite(override) && override > 0 && Number.isFinite(configured) && configured > 0
    ? Math.min(configured, override)
    : configured;
  if (!baseUrl || !token || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, failure: failure("configuration", 500) };
  }
  if (!prompt || !Array.isArray(images) || images.length > 3 || !["4:5", "5:4", "16:9", "21:9"].includes(aspectRatio)) {
    return { ok: false, failure: failure("invalid-request", 400) };
  }
  return { ok: true, timeoutMs, model };
}

export async function generateImage({
  prompt,
  images,
  aspectRatio,
  serializedBody,
  env = process.env,
  fetchImpl = http1Fetch,
  timeoutMs: timeoutOverride,
  beforeProviderIo,
}) {
  const assessment = assessImageTransport({
    prompt,
    images,
    aspectRatio,
    env,
    timeoutMs: timeoutOverride,
  });
  if (!assessment.ok) return assessment.failure;
  if (typeof beforeProviderIo === "function") {
    try {
      await beforeProviderIo({ timeoutMs: assessment.timeoutMs, model: assessment.model });
    } catch {
      // Trace capture must not change or retry the provider call.
    }
  }
  const baseUrl = String(env.BASE_URL ?? "").trim();
  const token = String(env.CONTEST_API_TOKEN ?? "").trim();
  const model = assessment.model;
  const timeoutMs = assessment.timeoutMs;
  const body = typeof serializedBody === "string"
    ? serializedBody
    : JSON.stringify(buildImageRequest({ prompt, images, aspectRatio, model }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(completionsUrl(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      signal: controller.signal,
    });
    const providerStatus = response.status;
    const text = await response.text();
    if (providerStatus === 413) {
      return failure("provider-payload-too-large", 502, { providerStatus, latencyMs: Date.now() - started });
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return failure("invalid-output", 502, { providerStatus, latencyMs: Date.now() - started });
    }
    if (providerStatus < 200 || providerStatus >= 300 || payload?.error) {
      return failure("provider", 502, { providerStatus, latencyMs: Date.now() - started });
    }
    const image = extractGeneratedImage(payload);
    if (!image) return failure("invalid-output", 502, { providerStatus, latencyMs: Date.now() - started });
    return {
      ok: true,
      image,
      metadata: {
        providerStatus,
        latencyMs: Date.now() - started,
        model,
        finishReason: payload?.choices?.[0]?.finish_reason || null,
        usage: payload?.usage || null,
      },
    };
  } catch {
    return controller.signal.aborted
      ? failure("timeout", 504, { latencyMs: Date.now() - started })
      : failure("provider", 502, { latencyMs: Date.now() - started });
  } finally {
    clearTimeout(timer);
  }
}
