import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ASPECT_RATIOS, ROLE_ORDER } from './constants.mjs';
import { spikeRoot } from './catalog.mjs';

export const WORKFLOW_RULES = {
  'base-anchor': {
    label: 'Base identity/style anchor',
    template: 'base-anchor',
    requires: ['identity-reference', 'style-anchor'],
    forbids: ['performance-reference', 'authoritative-staging-source'],
  },
  'derived-state': {
    label: 'Derived state without a performance reference',
    template: 'derived-state',
    requires: ['identity-anchor', 'style-anchor'],
    forbids: ['performance-reference'],
  },
  'performance-heavy': {
    label: 'Performance-heavy derived state',
    template: 'performance-heavy',
    requires: ['performance-reference', 'identity-anchor', 'style-anchor'],
    forbids: [],
  },
  'layout-rendition': {
    label: 'Layout rendition',
    template: 'layout-rendition',
    requires: ['authoritative-staging-source', 'identity-anchor', 'style-anchor'],
    forbids: [],
  },
};

const ROLE_LINES = {
  'identity-reference': 'identity reference. Defines the person: age, facial structure, hair, and other stable traits.',
  'identity-anchor': 'identity anchor. Preserves the already approved stylized identity.',
  'style-anchor': 'style anchor. Controls only the rendering language. Do not transfer this depicted person\'s facial geometry, hair, moustache, age, clothing, or identity.',
  'supporting-style-reference': 'supporting style reference. Rendering language only. Do not transfer any depicted person\'s identity.',
  'performance-reference': 'performance reference. Controls staging for this state only. It must not replace the target person\'s identity.',
  'authoritative-staging-source': 'authoritative staging source. Controls staging for this layout rendition.',
};

const CHARACTER_NAMES = { putin: 'Putin', durov: 'Durov', peskov: 'Peskov' };

const LAYOUT_LABELS = {
  'wide-single': 'wide single-frame',
  'split-panel': 'split-panel',
  'anchor-review': 'base portrait',
};

export function characterName(id) {
  return CHARACTER_NAMES[id] ?? id;
}

export function sortInputs(inputs) {
  return [...inputs].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.id.localeCompare(b.id));
}

export function referenceList(inputs) {
  return sortInputs(inputs).map((input, index) => (
    `- Image ${index + 1}, ${input.id}: ${ROLE_LINES[input.role] ?? input.role}`
  )).join('\n');
}

export function loadTemplate(root, templateId) {
  const file = path.join(root, 'prompts', `${templateId}-v1.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadStyleLanguage(root) {
  return JSON.parse(readFileSync(path.join(root, 'prompts', 'style-language-v1.json'), 'utf8'));
}

export function assemblePrompt({
  root = spikeRoot(),
  workflow,
  character,
  stateIntent = '',
  gaze = '',
  aspectRatio = '',
  layoutPurpose = '',
  inputs,
} = {}) {
  const rules = WORKFLOW_RULES[workflow];
  if (!rules) {
    const error = new Error(`unknown workflow: ${workflow}`);
    error.code = 'unknown-workflow';
    error.status = 400;
    throw error;
  }
  const template = loadTemplate(root, rules.template);
  const style = loadStyleLanguage(root);
  const replacements = {
    CHARACTER_NAME: characterName(character),
    STATE_INTENT: stateIntent || 'not specified',
    GAZE: gaze || 'not specified',
    ASPECT_RATIO: aspectRatio || 'not specified',
    LAYOUT_LABEL: LAYOUT_LABELS[layoutPurpose] ?? (layoutPurpose || 'not specified'),
    STYLE_LANGUAGE: style.text.trim(),
    REFERENCE_LIST: referenceList(inputs),
  };
  const text = template.text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match
  ));
  return {
    prompt: text.trim(),
    template_id: template.id,
    template_version: template.version,
    style_version: style.version,
  };
}

export function assertWorkflowInputs(workflow, inputs) {
  const rules = WORKFLOW_RULES[workflow];
  if (!rules) {
    const error = new Error(`unknown workflow: ${workflow}`);
    error.code = 'unknown-workflow';
    error.status = 400;
    throw error;
  }
  const roles = new Set(inputs.map((input) => input.role));
  const missing = rules.requires.filter((role) => !roles.has(role));
  const presentForbidden = rules.forbids.filter((role) => roles.has(role));
  if (missing.length || presentForbidden.length) {
    const error = new Error('reference roles do not match the selected workflow');
    error.code = 'workflow-roles';
    error.status = 400;
    error.missing = missing;
    error.forbidden_roles = presentForbidden;
    throw error;
  }
}

export function assertAspectRatio(value, { required = false } = {}) {
  if (!value) {
    if (!required) return null;
    const error = new Error('aspect ratio is required');
    error.code = 'aspect-ratio';
    error.status = 400;
    throw error;
  }
  if (!ASPECT_RATIOS.includes(value)) {
    const error = new Error(`unsupported aspect ratio: ${value}`);
    error.code = 'aspect-ratio';
    error.status = 400;
    throw error;
  }
  return value;
}

export function loadCampaign(root = spikeRoot()) {
  return JSON.parse(readFileSync(path.join(root, 'experiments', 'campaign-v1.json'), 'utf8'));
}

export function experimentById(campaign, id) {
  const experiment = campaign.experiments.find((item) => item.id === id);
  if (!experiment) {
    const error = new Error(`unknown experiment: ${id}`);
    error.code = 'unknown-experiment';
    error.status = 404;
    throw error;
  }
  return experiment;
}
