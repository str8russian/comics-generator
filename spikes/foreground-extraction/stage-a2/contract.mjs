import { createHash } from "node:crypto";

export const MATTE_CONTRACT_VERSION = "stage-a2-matte-contract-v1";

/**
 * Immutable extraction-matte suffix. Appended only by the Stage A2 runner.
 * It does not replace identity authority, style authority, panel intent,
 * framing, expression, gesture, aspect ratio, or the accepted rendering profile.
 */
export const MATTE_CONTRACT_TEXT = [
  "Extraction-matte contract stage-a2-matte-contract-v1:",
  "- Use one uniform solid muted slate-blue technical matte filling every edge and corner.",
  "- No gradient, texture, lighting variation, vignette, frame, border, card, nested panel, or incomplete matte.",
  "- No glow, rim light, halo, soft shadow, or drop shadow on the matte.",
  "- Use a clean decisive near-black outer contour around the complete character silhouette.",
  "- No sticker outline or second outer border.",
  "- No hair strand, clothing detail, gesture fragment, or other subject material outside the outer contour.",
  "- Keep exactly one character and the existing constrained composition and prohibitions.",
].join("\n");

export const MATTE_CONTRACT_SHA256 = createHash("sha256").update(MATTE_CONTRACT_TEXT).digest("hex");

export function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function appendMatteContract(prompt) {
  const base = String(prompt ?? "").replace(/\s+$/, "");
  return `${base}\n\n${MATTE_CONTRACT_TEXT}`;
}
