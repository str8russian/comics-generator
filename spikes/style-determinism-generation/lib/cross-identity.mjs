import { JUDGEMENT_FIELDS, REPETITIONS, SOURCES } from "./constants.mjs";
import { sha256 } from "./evidence.mjs";
import { IDENTITY_COLOR_SAFEGUARD, compileConditionPrompt } from "./prompts.mjs";

export const CROSS_IDENTITY_PLANNED = 8;
export const CROSS_IDENTITY_INVOCATION_CEILING = 16;
export const CROSS_IDENTITY_REVIEW_PORT = 4194;

export const CROSS_CONDITIONS = Object.freeze(["prompt-baseline", "prompt-identity-color"]);

export const CROSS_BLIND_CODES = Object.freeze({
  "prompt-baseline": "C-H6",
  "prompt-identity-color": "C-N8",
});

export const CROSS_DISPLAY_CODE_ORDER = Object.freeze(["C-N8", "C-H6"]);

export const CROSS_CONDITION_BY_CODE = Object.freeze({
  "C-N8": "prompt-identity-color",
  "C-H6": "prompt-baseline",
});

export const CROSS_ATTEMPT_ORDER = Object.freeze([
  "source-a.prompt-baseline.r1",
  "source-a.prompt-identity-color.r1",
  "source-b.prompt-baseline.r1",
  "source-b.prompt-identity-color.r1",
  "source-a.prompt-baseline.r2",
  "source-a.prompt-identity-color.r2",
  "source-b.prompt-baseline.r2",
  "source-b.prompt-identity-color.r2",
]);

export const CROSS_IDENTITY_STATEMENT = "The two source photographs depict different people. Each generation uses only that cell's identity photograph. Two identities and two repetitions give directional evidence, not statistical proof.";

export const CROSS_INPUT_IDS = Object.freeze(["source-a", "source-b"]);

export const CROSS_IDENTITY_JUDGEMENT_FIELDS = Object.freeze([
  ...JUDGEMENT_FIELDS,
  ["apparentAge", "Apparent age", ["target", "younger", "older", "uncertain"]],
]);

export function buildCrossIdentityMatrix() {
  const byId = new Map();
  for (const sourceId of SOURCES) {
    for (const condition of CROSS_CONDITIONS) {
      for (const repetition of REPETITIONS) {
        const id = `${sourceId}.${condition}.${repetition}`;
        byId.set(id, {
          id,
          sourceId,
          condition,
          repetition,
          blindCode: CROSS_BLIND_CODES[condition],
          publicId: `${sourceId}.${CROSS_BLIND_CODES[condition]}.${repetition}`,
          roles: ["identity"],
        });
      }
    }
  }
  if (byId.size !== CROSS_IDENTITY_PLANNED || byId.size !== CROSS_ATTEMPT_ORDER.length) {
    throw new Error("cross-identity matrix must contain 8 cells");
  }
  return CROSS_ATTEMPT_ORDER.map((id) => {
    const cell = byId.get(id);
    if (!cell) throw new Error(`missing planned cell ${id}`);
    return cell;
  });
}

export function crossIdentityPromptHashes() {
  return {
    "prompt-baseline": sha256(compileConditionPrompt("prompt-baseline")),
    "prompt-identity-color": sha256(compileConditionPrompt("prompt-identity-color")),
    safeguard: sha256(IDENTITY_COLOR_SAFEGUARD),
  };
}
