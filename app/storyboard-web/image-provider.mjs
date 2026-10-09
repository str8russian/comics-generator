import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { inspectImage } from "./image-info.mjs";

export const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const IMAGE_MODEL = DEFAULT_IMAGE_MODEL;
const ALLOWED_ASPECT_RATIOS = new Set(["4:5", "5:4", "16:9", "21:9"]);

function failure(kind, httpStatus = 502, diagnostics = {}) {
  return { ok: false, status: "failed", kind, httpStatus, diagnostics };
}

/**
 * Shared safe provider-configuration boundary used by provenance and generateImage.
 * Never includes credentials, Authorization material, or secret-bearing URLs.
 */
export function resolveImageProviderConfig({
  env = process.env,
  aspectRatio,
  component,
  panelIndex = null,
  model = null,
  timeoutMs = null,
} = {}) {
  const resolvedModel = String(model ?? env?.IMAGE_MODEL ?? IMAGE_MODEL).trim();
  const resolvedTimeout = Number(
    timeoutMs ?? env?.IMAGE_TIMEOUT_MS ?? env?.CONTEST_TIMEOUT_MS ?? 180000,
  );
  if (!resolvedModel) return { ok: false, kind: "configuration" };
  if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
    return { ok: false, kind: "configuration" };
  }
  if (!ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
    return { ok: false, kind: "invalid-request" };
  }
  if (!component || typeof component !== "string") {
    return { ok: false, kind: "invalid-request" };
  }
  const generationSettings = {
    aspectRatio,
    component,
    modalities: ["image", "text"],
    timeoutMs: resolvedTimeout,
  };
  if (Number.isInteger(panelIndex)) generationSettings.panelIndex = panelIndex;
  return {
    ok: true,
    model: resolvedModel,
    timeoutMs: resolvedTimeout,
    generationSettings,
  };
}

/** Normalize success metadata and failure diagnostics into one outcome shape. */
export function normalizeProviderOutcome(providerResult) {
  if (!providerResult) {
    return { ok: false, kind: "provider", providerStatus: null, latencyMs: null };
  }
  const meta = providerResult.metadata && typeof providerResult.metadata === "object"
    ? providerResult.metadata
    : {};
  const diag = providerResult.diagnostics && typeof providerResult.diagnostics === "object"
    ? providerResult.diagnostics
    : {};
  const providerStatus = Number.isInteger(providerResult.providerStatus)
    ? providerResult.providerStatus
    : (Number.isInteger(meta.providerStatus)
      ? meta.providerStatus
      : (Number.isInteger(diag.providerStatus) ? diag.providerStatus : null));
  const latencyMs = Number.isFinite(providerResult.latencyMs)
    ? providerResult.latencyMs
    : (Number.isFinite(meta.latencyMs)
      ? meta.latencyMs
      : (Number.isFinite(diag.latencyMs) ? diag.latencyMs : null));
  if (providerResult.ok) {
    return {
      ok: true,
      image: providerResult.image,
      providerStatus,
      latencyMs,
      model: typeof meta.model === "string" ? meta.model : null,
    };
  }
  return {
    ok: false,
    kind: providerResult.kind || "provider",
    providerStatus,
    latencyMs,
  };
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

export async function generateImage({
  prompt,
  images,
  aspectRatio,
  env = process.env,
  fetchImpl = http1Fetch,
  component = "panel-image",
  panelIndex = null,
  model = null,
  timeoutMs = null,
} = {}) {
  const baseUrl = String(env.BASE_URL ?? "").trim();
  const token = String(env.CONTEST_API_TOKEN ?? "").trim();
  const config = resolveImageProviderConfig({
    env,
    aspectRatio,
    component,
    panelIndex,
    model,
    timeoutMs,
  });
  if (!baseUrl || !token || !config.ok) {
    return failure(config.ok ? "configuration" : config.kind, config.ok ? 500 : 400);
  }
  if (!prompt || !Array.isArray(images) || images.length > 3) {
    return failure("invalid-request", 400);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(completionsUrl(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(buildImageRequest({
        prompt,
        images,
        aspectRatio,
        model: config.model,
      })),
      signal: controller.signal,
    });
    const providerStatus = response.status;
    let payload;
    try {
      payload = JSON.parse(await response.text());
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
        model: config.model,
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
