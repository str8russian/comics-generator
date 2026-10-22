export const CALL_CEILING = 12;
export const INVOCATION_CEILING = 24;
export const RETRYABLE_FAILURE_KINDS = Object.freeze(["timeout", "provider", "invalid-output"]);
export const REVIEW_HOST = "127.0.0.1";
export const REVIEW_PORT = 4193;
export const ASPECT_RATIO = "4:5";
export const MAX_PROVIDER_TIMEOUT_MS = 58_000;

export const SOURCES = Object.freeze(["source-a", "source-b"]);
export const CONDITIONS = Object.freeze(["prompt-only", "style-reference-only", "hybrid"]);
export const REPETITIONS = Object.freeze(["r1", "r2"]);

export const BLIND_CODES = Object.freeze({
  "prompt-only": "C-K4",
  hybrid: "C-M9",
  "style-reference-only": "C-R2",
});

export const DISPLAY_CODE_ORDER = Object.freeze(["C-K4", "C-M9", "C-R2"]);

export const CONDITION_BY_CODE = Object.freeze({
  "C-K4": "prompt-only",
  "C-M9": "hybrid",
  "C-R2": "style-reference-only",
});

export const ATTEMPT_ORDER = Object.freeze([
  "source-a.prompt-only.r1",
  "source-a.style-reference-only.r1",
  "source-a.hybrid.r1",
  "source-b.prompt-only.r1",
  "source-b.style-reference-only.r1",
  "source-b.hybrid.r1",
  "source-a.prompt-only.r2",
  "source-a.style-reference-only.r2",
  "source-a.hybrid.r2",
  "source-b.prompt-only.r2",
  "source-b.style-reference-only.r2",
  "source-b.hybrid.r2",
]);

export const SYSTEMIC_FAILURE_KINDS = Object.freeze([
  "timeout",
  "provider",
  "provider-payload-too-large",
  "invalid-output",
  "reference-payload-too-large",
]);

export const FORBIDDEN_REFERENCE_ROLES = Object.freeze(["previous", "anchor", "performance", "current"]);

export const SAME_IDENTITY_STATEMENT = "Both source photographs depict the same person. Their different crop, background, pose, and photographic lighting measure source-photo sensitivity. Cross-identity generalization is untested.";

export const BLIND_NOTE = "Opaque condition codes are a bias-reduction aid for one owner review, not a statistically blind study.";

export const NO_WINNER_NOTE = "Categorical counts are review assistance only. They are not a winner, a quality score, a confidence percentage, or a statistical test.";

export const SEED_NOTE = "No synthetic seed is sent. Repeat variation is uncontrolled provider variation.";

export const JUDGEMENT_FIELDS = Object.freeze([
  ["overall", "Overall", ["acceptable", "reject", "uncertain"]],
  ["identity", "Identity", ["recognizable", "weakened", "wrong"]],
  ["contour", "Contour", ["too thin", "target", "too heavy"]],
  ["identityDetail", "Identity-bearing detail", ["too little", "target", "too much"]],
  ["tonalComplexity", "Tonal complexity", ["too few", "target", "too many"]],
  ["facialShadow", "Facial shadow", ["acceptable", "invented/problematic", "uncertain"]],
  ["color", "Color", ["target", "whole-image cast", "other problem"]],
  ["highlights", "Highlights", ["absent", "sparse acceptable", "excessive"]],
]);

export const ANATOMY_NOTE_MAX = 400;

export function cellId(sourceId, condition, repetition) {
  return `${sourceId}.${condition}.${repetition}`;
}

export function publicIdFor(sourceId, condition, repetition) {
  return `${sourceId}.${BLIND_CODES[condition]}.${repetition}`;
}
