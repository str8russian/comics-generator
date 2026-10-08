import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog, readReferenceFile, referenceById, spikeRoot } from './catalog.mjs';
import { sendProviderRequest } from './client.mjs';
import { MODEL } from './constants.mjs';
import { createRunId } from './execute.mjs';
import { describeImage, extensionForMime } from './image-info.mjs';
import { ratioMatches } from './probe.mjs';
import { reviewPageHtml } from './blind-review.mjs';

export const PRESERVED_DUROV_V3 = {
  character: 'durov',
  variant: 'V3',
  label: 'Durov — V3 image anchor + text',
  status: 'Accepted capability baseline; not yet an approved identity anchor.',
  run_id: '20261008T002855Z-33c25d',
  output_filename: '20261008T002855Z-33c25d.png',
  regenerated: false,
  style_image_sent: true,
  operational_style_text_present: true,
  supporting_style_references_sent: false,
  self_anchor_confound: false,
  blind: false,
  blind_limitation: 'The owner already saw this candidate before the matrix review.',
};

export const REMAINING_CELLS = [
  ['putin', 'V1'],
  ['putin', 'V2'],
  ['putin', 'V3'],
  ['durov', 'V1'],
  ['durov', 'V2'],
  ['peskov', 'V1'],
  ['peskov', 'V2'],
  ['peskov', 'V3'],
];

export const OPERATIONAL_STYLE_TEXT = [
  'Rendering direction:',
  '- clearly illustrated and strongly non-photorealistic;',
  '- heavy near-black outer contour;',
  '- economical, slightly hand-inked internal lines;',
  '- very few large connected tonal groups;',
  '- broad hard-edged light and shadow masses;',
  '- simplified graphic construction of the face, hair, facial hair, and clothing;',
  '- minimal fine texture;',
  '- no visible pores or photographic skin detail;',
  '- no smooth airbrushed gradients;',
  '- no large number of small polygonal facial facets;',
  '- strong silhouette and immediate readability at small comic-panel size;',
  '- rougher and more graphic than a polished digital portrait;',
  '- restrained color palette with clear separation between light, midtone, and shadow.',
].join('\n');

export const SHARED_TASK_TEXT = [
  'Create one reusable chest-up base identity anchor.',
  '- neutral but alive expression;',
  '- face unobstructed;',
  '- upper torso visible;',
  '- safe space above the head and around both shoulders;',
  '- no destructive close crop;',
  '- no source background;',
  '- no source microphone or incidental object;',
  '- simple unobtrusive background;',
  '- portrait 4:5;',
  '- one output image.',
].join('\n');

const IDENTITY_NOTES = {
  putin: 'Preserve age, head shape, hairline, eyes, nose, lips, and recognizable facial proportions.',
  durov: 'Preserve contemporary facial structure, hairstyle, beard, and proportions. The microphone, source pose, crop, and background are not identity traits.',
  peskov: 'Preserve current age, grey hair, moustache, facial structure, and recognizable proportions.',
};

const IDENTITY_IDS = {
  putin: 'putin-identity-photo',
  durov: 'durov-identity-photo',
  peskov: 'peskov-identity-photo',
};

const EVALUATION_IDS = {
  putin: 'putin-approved-anchor',
  durov: 'durov-approved-anchor',
  peskov: 'peskov-approved-anchor',
};

export const V1_FORBIDDEN = [
  /gta/i,
  /heavy near-black/i,
  /heavy contour/i,
  /tonal group/i,
  /hard-edged/i,
  /simplified graphic/i,
  /minimal fine texture/i,
  /minimal texture/i,
  /non-photoreal/i,
  /photoreal/i,
  /thumbnail/i,
  /hand-inked/i,
  /\bpores\b/i,
  /airbrushed/i,
  /polygonal/i,
  /illustrated/i,
  /silhouette/i,
];

function dataUrl(image) {
  return `data:${image.mime};base64,${image.buffer.toString('base64')}`;
}

export function identityText(character) {
  return [
    'Reference 1 is the identity authority.',
    IDENTITY_NOTES[character],
    'It controls who the person is.',
  ].join('\n');
}

export function styleRoleText() {
  return [
    'Reference 2 is the style authority.',
    'Use it only for the rendering.',
    'Do not transfer the identity, age, hair, moustache, clothing, expression, or facial geometry of the person shown in Reference 2.',
  ].join('\n');
}

export function taskText(variant) {
  if (variant === 'V1') return SHARED_TASK_TEXT;
  if (variant === 'V2' || variant === 'V3') return `${OPERATIONAL_STYLE_TEXT}\n\n${SHARED_TASK_TEXT}`;
  throw new Error(`unknown variant ${variant}`);
}

export function promptText(character, variant) {
  const parts = [identityText(character)];
  if (variant !== 'V2') parts.push(styleRoleText());
  parts.push(taskText(variant));
  return parts.join('\n\n');
}

export function assertV1HasNoStyleLanguage(text) {
  const hits = V1_FORBIDDEN.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  if (hits.length) {
    const error = new Error(`V1 prompt contains style language: ${hits.join(', ')}`);
    error.code = 'v1-style-language';
    throw error;
  }
}

export function buildMatrixRequest({ variant, identity, style }) {
  if (!['V1', 'V2', 'V3'].includes(variant)) throw new Error(`unknown variant ${variant}`);
  const content = [
    { type: 'text', text: identityText(identity.character) },
    { type: 'image_url', image_url: { url: dataUrl(identity) } },
  ];
  if (variant !== 'V2') {
    content.push({ type: 'text', text: styleRoleText() });
    content.push({ type: 'image_url', image_url: { url: dataUrl(style) } });
  }
  content.push({ type: 'text', text: taskText(variant) });
  if (variant === 'V1') assertV1HasNoStyleLanguage(content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));
  return {
    method: 'POST',
    path: '/v1/chat/completions',
    format: 'json',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '4:5' },
      messages: [{ role: 'user', content }],
    }),
  };
}

function loadDescribed(catalog, id) {
  const entry = referenceById(catalog, id);
  const buffer = readReferenceFile(entry, catalog, readFileSync);
  const described = describeImage(buffer);
  return { entry, buffer, described };
}

export function contentOrder(character, variant) {
  const order = [
    { type: 'text', role: 'identity-authority-label' },
    { type: 'image', role: 'identity-reference', id: IDENTITY_IDS[character] },
  ];
  if (variant !== 'V2') {
    order.push({ type: 'text', role: 'style-authority-label' });
    order.push({ type: 'image', role: 'style-anchor', id: 'peskov-approved-anchor' });
  }
  order.push({ type: 'text', role: 'task' });
  return order;
}

export function stopReason(manifest) {
  const status = manifest.http?.status;
  const errorClass = manifest.http?.error_class;
  if (['network', 'timeout', 'abort'].includes(errorClass) || status == null) return errorClass || 'malformed';
  if (status === 401 || status === 403) return 'authentication';
  if (status >= 500) return 'http-5xx';
  if (status === 400 || status === 422) return 'rejected';
  if (!manifest.output) return 'missing-image';
  if (status < 200 || status >= 300) return 'http-other';
  return null;
}

export async function runMatrixCell({
  character,
  variant,
  config,
  store,
  fetchImpl,
  redactWith,
  catalog = loadCatalog(spikeRoot()),
  now = new Date(),
}) {
  const identity = loadDescribed(catalog, IDENTITY_IDS[character]);
  const style = variant === 'V2' ? null : loadDescribed(catalog, 'peskov-approved-anchor');
  const evaluation = referenceById(catalog, EVALUATION_IDS[character]);
  const request = buildMatrixRequest({
    variant,
    identity: { ...identity.described, buffer: identity.buffer, character },
    style: style ? { ...style.described, buffer: style.buffer } : null,
  });
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
    const filename = `${character}-${variant.toLowerCase()}-${runId}.${extensionForMime(described.mime || image.mime)}`;
    store.saveOutput(filename, image.buffer);
    output = {
      mime: described.mime || image.mime,
      width: described.width,
      height: described.height,
      filename,
      sha256: described.sha256,
      measured_ratio: described.width && described.height ? described.width / described.height : null,
      requested_aspect_ratio: '4:5',
      aspect_honored: ratioMatches(described.width, described.height, '4:5'),
    };
  }
  const styleImageSent = variant !== 'V2';
  const manifest = {
    run_id: runId,
    timestamp: now.toISOString(),
    model: MODEL,
    character,
    variant,
    label: `${character} — ${variant}`,
    recipe_id: `anchor-${character}-${variant.toLowerCase()}`,
    workflow: 'base-anchor',
    final_prompt: promptText(character, variant),
    content_order: contentOrder(character, variant),
    inputs: [
      {
        id: IDENTITY_IDS[character],
        role: 'identity-reference',
        mime: identity.described.mime,
        width: identity.described.width,
        height: identity.described.height,
        sha256: identity.described.sha256,
        local_path: identity.entry.local_path,
      },
      ...(style ? [{
        id: 'peskov-approved-anchor',
        role: 'style-anchor',
        mime: style.described.mime,
        width: style.described.width,
        height: style.described.height,
        sha256: style.described.sha256,
        local_path: style.entry.local_path,
      }] : []),
    ],
    not_sent: [{
      id: evaluation.id,
      role: 'evaluation-only',
      note: 'evaluation only — not sent',
      sent: false,
    }],
    style_image_sent: styleImageSent,
    operational_style_text_present: variant !== 'V1',
    supporting_style_references_sent: false,
    self_anchor_confound: character === 'peskov' && variant !== 'V2',
    request_parameters: {
      model: MODEL,
      endpoint_path: '/v1/chat/completions',
      request_format: 'json',
      modalities: ['image', 'text'],
      aspect_ratio: '4:5',
      aspect_field: 'image_config.aspect_ratio',
      image_count: styleImageSent ? 2 : 1,
    },
    aspect_ratio: '4:5',
    http: { status: result.httpStatus, error_class: result.errorClass, error: result.error },
    usage: result.usage,
    output,
    verdict: null,
    human_review: { status: 'pending' },
  };
  store.saveManifest(manifest);
  store.appendAttempt({
    kind: 'anchor-matrix',
    at: now.toISOString(),
    requests: 1,
    character,
    variant,
    run_id: runId,
    manifest,
  });
  return manifest;
}

export async function runAnchorMatrix({ config, store, fetchImpl, redactWith, catalog, onCell }) {
  const completed = [];
  for (const [character, variant] of REMAINING_CELLS) {
    const manifest = await runMatrixCell({
      character,
      variant,
      config,
      store,
      fetchImpl,
      redactWith,
      catalog,
    });
    completed.push(manifest);
    if (onCell) onCell(manifest);
    const reason = stopReason(manifest);
    if (reason) return { completed, stopped: { character, variant, reason } };
  }
  return { completed, stopped: null };
}

function shuffleVariants() {
  const variants = ['V1', 'V2', 'V3'];
  for (let index = variants.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [variants[index], variants[swap]] = [variants[swap], variants[index]];
  }
  return { A: variants[0], B: variants[1], C: variants[2] };
}

export function buildBlindReviews({ store, cells, evaluationBuffers, identityBuffers, styleBuffer }) {
  const mapping = {};
  const pages = [];
  const root = path.join(store.root, 'matrix', 'review');
  for (const character of ['putin', 'durov', 'peskov']) {
    const letters = shuffleVariants();
    mapping[character] = letters;
    const directory = path.join(root, character);
    mkdirSync(directory, { recursive: true });
    const identity = identityBuffers[character];
    writeFileSync(path.join(directory, 'identity.jpg'), identity.buffer);
    writeFileSync(path.join(directory, 'evaluation-only.png'), evaluationBuffers[character]);
    writeFileSync(path.join(directory, 'style-authority.png'), styleBuffer);
    for (const letter of ['A', 'B', 'C']) {
      const variant = letters[letter];
      const cell = cells.find((item) => item.character === character && item.variant === variant);
      const filename = cell.output_filename || cell.output?.filename;
      const buffer = readFileSync(path.join(store.root, 'outputs', filename));
      writeFileSync(path.join(directory, `candidate-${letter.toLowerCase()}.png`), buffer);
    }
    const blindLimitation = character === 'durov'
      ? 'This review is not fully blind. One candidate was already shown before this page was made. This page does not say which one.'
      : '';
    const html = reviewPageHtml({ character, blindLimitation });
    if (/V[123]/.test(html)) throw new Error('review page revealed a variant id');
    writeFileSync(path.join(directory, 'index.html'), html);
    pages.push(path.join(directory, 'index.html'));
  }
  const mappingFile = path.join(store.root, 'matrix', 'blind-mapping.json');
  writeFileSync(mappingFile, `${JSON.stringify({
    note: 'Hidden until blind ratings are complete. Do not open this file first.',
    mapping,
  }, null, 2)}\n`);
  return { pages, mappingFile };
}
