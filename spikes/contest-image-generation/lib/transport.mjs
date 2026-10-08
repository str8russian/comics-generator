import { MODEL } from './constants.mjs';

export const SHAPE_ATTEMPT_ORDER = [
  { shape: 'chat-completions', path: '/v1/chat/completions', format: 'json' },
  { shape: 'openai-images', path: '/v1/images/generations', format: 'json' },
  {
    shape: 'gemini-generate-content',
    path: `/v1beta/models/${MODEL}:generateContent`,
    format: 'json',
  },
];

export const DISCOVERY_PROMPT = 'A flat red square centered on a white background. No text, no people.';

function dataUrl(image) {
  return `data:${image.mime};base64,${image.buffer.toString('base64')}`;
}

function multipartBody(fields, files) {
  const boundary = `----spike${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const field of fields) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`,
    ));
  }
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

export function buildRequest({
  shape,
  endpointPath,
  model = MODEL,
  prompt,
  images = [],
  aspectRatio = null,
  includeAspect = false,
  aspectField = null,
  invalid = false,
}) {
  const spec = SHAPE_ATTEMPT_ORDER.find((item) => item.shape === shape) ?? (
    shape === 'multipart-images'
      ? { shape, path: '/v1/images/edits', format: 'multipart' }
      : null
  );
  if (!spec && !endpointPath) {
    const error = new Error(`unsupported image request shape: ${shape}`);
    error.code = 'unsupported-shape';
    error.status = 409;
    throw error;
  }
  const path = endpointPath || spec.path;
  const format = spec?.format || 'json';
  if (format === 'multipart' || shape === 'multipart-images') {
    const fields = invalid
      ? [{ name: 'model', value: '' }, { name: 'prompt', value: '' }]
      : [{ name: 'model', value: model }, { name: 'prompt', value: prompt }];
    if (!invalid && includeAspect && aspectRatio) fields.push({ name: 'aspect_ratio', value: aspectRatio });
    const files = invalid ? [] : images.map((image, index) => ({
      name: 'image',
      filename: `reference-${index + 1}.png`,
      mime: image.mime,
      buffer: image.buffer,
    }));
    const encoded = multipartBody(fields, files);
    return {
      method: 'POST',
      path,
      format: 'multipart',
      headers: { 'content-type': encoded.contentType, accept: 'application/json' },
      body: encoded.body,
    };
  }

  let payload;
  if (shape === 'gemini-generate-content') {
    payload = invalid
      ? { contents: [] }
      : {
        contents: [{
          role: 'user',
          parts: [
            ...images.map((image) => ({
              inline_data: { mime_type: image.mime, data: image.buffer.toString('base64') },
            })),
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(includeAspect && aspectRatio ? { imageConfig: { aspectRatio } } : {}),
        },
      };
      } else if (shape === 'chat-completions') {
    const content = images.length
      ? [
        { type: 'text', text: prompt },
        ...images.map((image) => ({ type: 'image_url', image_url: { url: dataUrl(image) } })),
      ]
      : prompt;
    payload = invalid
      ? { model: '', messages: [] }
      : {
        model,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content }],
        ...(aspectField === 'image_config' && aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
        ...(aspectField !== 'image_config' && includeAspect && aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      };
  } else if (shape === 'openai-images') {
    payload = invalid
      ? { model: '', prompt: '' }
      : {
        model,
        prompt,
        n: 1,
        response_format: 'b64_json',
        ...(includeAspect && aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(images.length ? { image: images.map((image) => dataUrl(image)) } : {}),
      };
  } else {
    const error = new Error(`unsupported image request shape: ${shape}`);
    error.code = 'unsupported-shape';
    error.status = 409;
    throw error;
  }
  return {
    method: 'POST',
    path,
    format: 'json',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  };
}

function safeToken(value) {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(text)) return null;
  return text;
}

const USAGE_KEYS = new Set([
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'promptTokenCount',
  'candidatesTokenCount',
  'totalTokenCount',
  'thoughtsTokenCount',
]);

export function pickUsage(payload) {
  const sources = [payload?.usage, payload?.usageMetadata].filter((item) => item && typeof item === 'object');
  const usage = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (USAGE_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
    }
  }
  return Object.keys(usage).length ? usage : null;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length < 16) return null;
  const cleaned = value.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  try {
    const buffer = Buffer.from(cleaned, 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function imageFromDataUrl(url) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(url ?? ''));
  if (!match) return null;
  const buffer = decodeBase64(match[2]);
  if (!buffer) return null;
  return { buffer, mime: match[1].toLowerCase(), representation: 'data-url' };
}

function walk(value, found, depth = 0) {
  if (!value || depth > 8) return;
  if (typeof value === 'string') {
    const fromUrl = imageFromDataUrl(value);
    if (fromUrl) found.push(fromUrl);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const inline = value.inlineData || value.inline_data;
  if (inline?.data) {
    const buffer = decodeBase64(inline.data);
    if (buffer) {
      found.push({
        buffer,
        mime: String(inline.mimeType || inline.mime_type || 'image/png').toLowerCase(),
        representation: 'inline-data',
      });
    }
  }
  if (typeof value.b64_json === 'string') {
    const buffer = decodeBase64(value.b64_json);
    if (buffer) found.push({ buffer, mime: 'image/png', representation: 'base64' });
  }
  if (typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) {
    found.push({ url: value.url, representation: 'url' });
  }
  if (value.image_url?.url) walk(value.image_url.url, found, depth + 1);
  for (const key of Object.keys(value)) {
    if (key === 'inlineData' || key === 'inline_data' || key === 'b64_json' || key === 'url' || key === 'image_url') continue;
    walk(value[key], found, depth + 1);
  }
}

export function extractImagePayload(payload) {
  const found = [];
  walk(payload, found);
  const images = [];
  const urls = [];
  for (const item of found) {
    if (item.buffer) images.push(item);
    else if (item.url) urls.push(item.url);
  }
  const finish = safeToken(payload?.choices?.[0]?.finish_reason)
    || safeToken(payload?.candidates?.[0]?.finishReason)
    || safeToken(payload?.candidates?.[0]?.finish_reason);
  return {
    images,
    urls,
    usage: pickUsage(payload),
    finish_reason: finish,
  };
}

export function mapDocumentedOperation(apiPath, operation) {
  const content = operation?.requestBody?.content ?? {};
  const types = Object.keys(content);
  const jsonSchema = content['application/json']?.schema;
  const properties = jsonSchema?.properties ? Object.keys(jsonSchema.properties) : [];
  const path = String(apiPath);
  if (types.some((type) => type.includes('multipart'))) {
    return { shape: 'multipart-images', path, format: 'multipart', properties };
  }
  if (/generateContent/.test(path) || properties.includes('contents')) {
    return { shape: 'gemini-generate-content', path, format: 'json', properties };
  }
  if (/images\/generations/.test(path) || properties.includes('prompt') && /image/.test(path)) {
    return { shape: 'openai-images', path, format: 'json', properties };
  }
  if (/chat\/completions/.test(path)) {
    return { shape: 'chat-completions', path, format: 'json', properties };
  }
  return null;
}

export function summarizeOpenApi(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.paths || typeof doc.paths !== 'object') {
    return null;
  }
  const documented = [];
  for (const [apiPath, methods] of Object.entries(doc.paths)) {
    if (typeof apiPath !== 'string' || /^https?:/i.test(apiPath)) continue;
    if (!/image|generateContent|generations|chat\/completions/i.test(apiPath)) continue;
    if (!methods || typeof methods !== 'object') continue;
    for (const method of Object.keys(methods)) {
      if (method.toLowerCase() !== 'post') continue;
      const mapped = mapDocumentedOperation(apiPath, methods[method]);
      const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
      documented.push({
        path: normalizedPath,
        method: 'post',
        shape: mapped?.shape ?? (/images\/edits/.test(normalizedPath) ? 'multipart-images' : null),
        format: mapped?.format ?? (/images\/edits/.test(normalizedPath) ? 'multipart' : null),
        properties: mapped?.properties ?? [],
        content_types: Object.keys(methods[method]?.requestBody?.content ?? {}),
      });
    }
  }
  return documented;
}
