import { CONDITIONS } from "./constants.mjs";

const OPENING = [
  "Create one independent base identity anchor.",
  "This is an initial generation.",
  "Do not use a previous candidate, an accepted anchor, a performance reference, or an earlier generated result.",
].join("\n");

const IDENTITY_LINE = [
  "Image 1 is the source photograph and the identity reference.",
  "It controls identity only: facial structure, age, hair, and stable recognizable traits.",
  "Do not copy its photographic rendering, environment, clothing logo, pose dependency, or background.",
  "Do not return the source photograph.",
].join("\n");

export const COMMON_CONSTRAINTS = [
  "Common constraints:",
  "- Use neutral diffuse presentation lighting.",
  "- Broad structural light and shadow planes may remain.",
  "- Do not add decorative reflected-light bands, glossy or specular skin or hair patches, rim-light streaks, or clusters of small highlight islands.",
  "- Small natural eye catchlights and visible teeth may remain restrained and anatomically motivated.",
  "- Show exactly one person, chest-up, near-frontal, with the mouth visible and safe margins.",
  "- Keep the hands outside the crop.",
  "- Use plain unbranded clothing. Do not copy the source photograph's logo.",
  "- No props, objects, furniture, microphones, equipment, additional people, text, logo, watermark, frame, border, nested panel, vignette, or environmental context.",
  "- Use one uniform solid muted slate-blue matte filling all four edges and corners.",
  "- The identity reference controls identity only. Do not copy its photographic rendering, environment, clothing logo, pose dependency, or background.",
  "- Target aspect ratio: 4:5.",
].join("\n");

export const ACCEPTED_STYLE_BLOCK = [
  "Accepted rendering profile:",
  "- Use a clean, decisive, thick near-black contour around the character silhouette and the major facial, hair, and clothing forms.",
  "- Contour lines follow those forms. They are not a border around the canvas.",
  "- Use flat local colors and high thumbnail readability.",
  "- For the face and neck, use one dominant natural skin color plus only one or two broad secondary hard-edged tonal planes.",
  "- Keep selective identity-bearing line and form detail at the eyes, brows, nose, mouth, jaw, and major hair groups.",
  "- Use solid muted colors rather than many subtle shades.",
  "- Use vivid natural skin without a whole-image cool, gray, purple, orange, or other color cast.",
  "- No gradients, soft airbrush shading, painterly modelling, thin sketch lines, delicate outlines, excessive tonal groups, or clusters of small tonal islands.",
  "- Do not compensate for missing identity detail by adding more shading.",
].join("\n");

export const STYLE_AUTHORITY = [
  "Style-reference authority:",
  "- Image 2 controls rendering language only.",
  "- Do not copy the style-reference person's identity, facial traits, hair, clothing, pose, crop, or incidental lighting.",
].join("\n");

export const HYBRID_PRECEDENCE = "The written rendering contract wins over incidental identity, clothing, pose, crop, or lighting in the style image.";

export function referencePlan(condition) {
  if (condition === "prompt-only") return ["identity"];
  if (condition === "style-reference-only" || condition === "hybrid") return ["identity", "style"];
  throw new Error(`unknown condition: ${condition}`);
}

export function compileConditionPrompt(condition) {
  if (!CONDITIONS.includes(condition)) throw new Error(`unknown condition: ${condition}`);
  const parts = [OPENING, "", IDENTITY_LINE, "", COMMON_CONSTRAINTS];
  if (condition === "prompt-only" || condition === "hybrid") parts.push("", ACCEPTED_STYLE_BLOCK);
  if (condition === "style-reference-only" || condition === "hybrid") parts.push("", STYLE_AUTHORITY);
  if (condition === "hybrid") parts.push("", HYBRID_PRECEDENCE);
  return parts.join("\n");
}
