import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog, readReferenceFile, referenceById, spikeRoot } from './catalog.mjs';
import { sendProviderRequest } from './client.mjs';
import { MODEL } from './constants.mjs';
import { createRunId } from './execute.mjs';
import { describeImage, extensionForMime } from './image-info.mjs';
import { ratioMatches } from './probe.mjs';

export const IDENTITY_TEXT = [
  'Reference 1 — identity authority.',
  'This image controls who the person is: contemporary facial structure, hairstyle, beard, age, and stable facial proportions.',
  'The microphone, original pose, crop, background, and photographic rendering are not identity traits and must not transfer.',
].join('\n');

export const STYLE_TEXT = [
  'Reference 2 — style-only authority.',
  'This image controls only the rendering language: stylization strength, contour treatment, tonal grouping, hard-edged light and shadow, degree of simplification, and thumbnail readability.',
  'It must not transfer this person\'s face, age, hair, moustache, clothing, expression, or identity.',
].join('\n');

export const TASK_TEXT = `Create one reusable base identity anchor for the person in Reference 1.

Authority rules:

- Reference 1 controls the person’s identity: facial structure, current hairstyle, beard, age, and stable proportions.
- Reference 2 controls only the illustration language.
- Never transfer the identity, facial geometry, moustache, age, hair, clothing, or expression of the person in Reference 2.
- Do not preserve the microphone, original photographic pose, background, or crop from Reference 1.

Rendering direction:

- clearly illustrated rather than photorealistic;
- heavy near-black outer contour and economical internal lines;
- a small number of large tonal groups;
- broad hard-edged light and shadow masses;
- simplified graphic shapes for the face, hair, beard, and clothing;
- minimal fine texture;
- strong readability at small comic-panel size;
- stylization strength must visibly match Reference 2 rather than drifting back toward portrait photography.

Composition:

- reusable chest-up character anchor;
- neutral but alive expression;
- face unobstructed;
- enough space above the head and around both shoulders;
- upper torso safely visible;
- no microphone;
- no destructive close crop;
- simple unobtrusive background;
- portrait 4:5.

Generate one image only.`;

export const REVIEW_FINDINGS = [
  'Durov identity preserved',
  'current hair and beard preserved',
  'microphone and source pose removed',
  'no Peskov identity leakage',
  'style strength matches the Peskov anchor',
  'clearly non-photorealistic',
  'safe reusable 4:5 composition',
  'suitable as the parent anchor for later derived states',
];

function dataUrl(image) {
  return `data:${image.mime};base64,${image.buffer.toString('base64')}`;
}

export function buildDurovAnchorRequest({ identity, style }) {
  return {
    method: 'POST',
    path: '/v1/chat/completions',
    format: 'json',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '4:5' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: IDENTITY_TEXT },
          { type: 'image_url', image_url: { url: dataUrl(identity) } },
          { type: 'text', text: STYLE_TEXT },
          { type: 'image_url', image_url: { url: dataUrl(style) } },
          { type: 'text', text: TASK_TEXT },
        ],
      }],
    }),
  };
}

function requireReference(catalog, id, basename) {
  const entry = referenceById(catalog, id);
  if (entry.basename !== basename) {
    const error = new Error(`reference ${id} does not have the expected file name`);
    error.code = 'reference-mismatch';
    error.status = 400;
    throw error;
  }
  const buffer = readReferenceFile(entry, catalog, readFileSync);
  const described = describeImage(buffer);
  if (!described.mime) {
    const error = new Error(`reference ${id} is not an image`);
    error.code = 'not-image';
    error.status = 400;
    throw error;
  }
  return { entry, buffer, described };
}

function writeContactSheet({ directory, files }) {
  mkdirSync(directory, { recursive: true });
  const figures = files.map((file) => {
    const filename = path.basename(file.filename);
    writeFileSync(path.join(directory, filename), file.buffer);
    const mark = file.evaluationOnly ? ' class="evaluation"' : '';
    return `<figure${mark}><img src="${filename}" alt=""><figcaption>${file.caption}</figcaption></figure>`;
  }).join('\n');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Durov base anchor comparison</title>
  <style>
    body { margin: 24px; background: #f3efe4; color: #1c1915; font: 16px/1.4 Georgia, serif; }
    h1 { font-size: 28px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
    img { width: 100%; height: 720px; object-fit: contain; background: #111; }
    figcaption { margin-top: 8px; }
    .evaluation { outline: 4px solid #8c2f2a; outline-offset: 4px; }
  </style>
</head>
<body>
  <h1>Durov base anchor</h1>
  <p>Local comparison only. No further provider request was made to build this sheet.</p>
  <div class="grid">
    ${figures}
  </div>
</body>
</html>
`;
  writeFileSync(path.join(directory, 'index.html'), html);
  return 'index.html';
}

export async function runDurovBaseAnchor({
  config,
  store,
  fetchImpl,
  redactWith,
  catalog = loadCatalog(spikeRoot()),
  now = new Date(),
}) {
  if (!config?.configured) {
    const error = new Error(config?.reason || 'live configuration is absent');
    error.code = 'not-configured';
    error.status = 400;
    throw error;
  }
  const identity = requireReference(catalog, 'durov-identity-photo', 'images-8.jpeg');
  const style = requireReference(catalog, 'peskov-approved-anchor', 'peskov-identity-anchor-v1.png');
  const evaluation = referenceById(catalog, 'durov-approved-anchor');
  if (evaluation.basename !== 'durov-identity-anchor-v1.png') {
    const error = new Error('evaluation anchor does not have the expected file name');
    error.code = 'reference-mismatch';
    error.status = 400;
    throw error;
  }
  const request = buildDurovAnchorRequest({
    identity: { mime: identity.described.mime, buffer: identity.buffer },
    style: { mime: style.described.mime, buffer: style.buffer },
  });
  if (request.body.includes(readFileSync(evaluation.local_path).toString('base64'))) {
    const error = new Error('evaluation anchor was included in the request');
    error.code = 'evaluation-leaked';
    error.status = 400;
    throw error;
  }
  const result = await sendProviderRequest({
    baseUrl: config.baseUrl,
    token: config.token,
    request,
    timeoutMs: config.timeoutMs,
    fetchImpl,
    redactWith,
    followImageUrl: false,
    onRequest: () => store.bump('anchor'),
  });
  const runId = createRunId(now);
  const image = result.images?.[0] ?? null;
  let output = null;
  if (image?.buffer) {
    const described = describeImage(image.buffer);
    const filename = `${runId}.${extensionForMime(described.mime || image.mime)}`;
    store.saveOutput(filename, image.buffer);
    const measuredRatio = described.width && described.height ? described.width / described.height : null;
    output = {
      mime: described.mime || image.mime,
      width: described.width,
      height: described.height,
      filename,
      sha256: described.sha256,
      measured_ratio: measuredRatio,
      requested_aspect_ratio: '4:5',
      aspect_honored: ratioMatches(described.width, described.height, '4:5'),
    };
    const sheetDir = path.join(store.root, 'contact-sheets', runId);
    const evaluationBuffer = readFileSync(evaluation.local_path);
    writeContactSheet({
      directory: sheetDir,
      files: [
        { filename: `01-identity.${extensionForMime(identity.described.mime)}`, buffer: identity.buffer, caption: '1. Durov identity input' },
        { filename: `02-style.${extensionForMime(style.described.mime)}`, buffer: style.buffer, caption: '2. Peskov style authority' },
        { filename: '03-evaluation-only.png', buffer: evaluationBuffer, caption: '3. Existing approved Durov anchor — evaluation only, not sent', evaluationOnly: true },
        { filename: `04-candidate.${extensionForMime(output.mime)}`, buffer: image.buffer, caption: '4. New API candidate' },
      ],
    });
    output.contact_sheet = `contact-sheets/${runId}/index.html`;
  }
  const manifest = {
    run_id: runId,
    timestamp: now.toISOString(),
    model: MODEL,
    recipe_id: 'anchor-durov',
    recipe_version: 1,
    workflow: 'base-anchor',
    final_prompt: [IDENTITY_TEXT, STYLE_TEXT, TASK_TEXT].join('\n\n'),
    content_order: [
      { type: 'text', role: 'identity-authority-label' },
      { type: 'image', role: 'identity-reference', id: 'durov-identity-photo' },
      { type: 'text', role: 'style-authority-label' },
      { type: 'image', role: 'style-anchor', id: 'peskov-approved-anchor' },
      { type: 'text', role: 'task' },
    ],
    inputs: [
      {
        id: 'durov-identity-photo',
        role: 'identity-reference',
        mime: identity.described.mime,
        width: identity.described.width,
        height: identity.described.height,
        sha256: identity.described.sha256,
        local_path: identity.entry.local_path,
      },
      {
        id: 'peskov-approved-anchor',
        role: 'style-anchor',
        mime: style.described.mime,
        width: style.described.width,
        height: style.described.height,
        sha256: style.described.sha256,
        local_path: style.entry.local_path,
      },
    ],
    not_sent: [{
      id: 'durov-approved-anchor',
      role: 'evaluation-only',
      note: 'evaluation only — not sent',
      local_path: evaluation.local_path,
    }],
    request_parameters: {
      model: MODEL,
      endpoint_path: '/v1/chat/completions',
      request_format: 'json',
      modalities: ['image', 'text'],
      aspect_ratio: '4:5',
      aspect_field: 'image_config.aspect_ratio',
      image_count: 2,
    },
    aspect_ratio: '4:5',
    layout_purpose: 'anchor-review',
    http: { status: result.httpStatus, error_class: result.errorClass, error: result.error },
    usage: result.usage,
    output,
    verdict: null,
    human_review: { status: 'pending', findings: REVIEW_FINDINGS },
  };
  store.saveManifest(manifest);
  store.appendAttempt({
    kind: 'durov-base-anchor',
    at: now.toISOString(),
    requests: 1,
    run_id: runId,
    manifest,
  });
  return manifest;
}
