export const MODEL = 'gemini-3-pro-image-preview';

export const ASPECT_RATIOS = ['4:5', '3:4', '5:4', '16:9', '21:9'];

export const DISCOVERY_BUDGET = 4;

export const CAMPAIGN_ENVELOPE = 50;

export const PROMPT_TWEAK_LIMIT = 2;

export const BATCH_LIMIT = 3;

export const FRAME = {
  width: 1920,
  height: 1080,
  dialogueBar: 300,
  gutter: 48,
  visualHeight: 780,
  splitPanelWidth: 936,
};

export const WORKFLOWS = ['base-anchor', 'derived-state', 'performance-heavy', 'layout-rendition'];

export const VERDICTS = ['accepted', 'rejected', 'retry', 'reuse-existing'];

export const TECHNIQUES = [
  'prompt-tweak',
  'different-reference-composition',
  'edit-accepted',
  'layout-from-accepted',
  'other',
];

export const ROLES = [
  'identity-reference',
  'identity-anchor',
  'style-anchor',
  'supporting-style-reference',
  'performance-reference',
  'authoritative-staging-source',
];

export const ROLE_ORDER = ROLES;

export const PHASES = {
  anchor: 9,
  derived: 18,
  layout: 10,
  repetition: 6,
  diagnostic: 3,
  discovery: DISCOVERY_BUDGET,
};
