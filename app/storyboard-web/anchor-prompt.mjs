/** Stable compiler identity for the Characters-stage anchor session prompt. Not interpolated into prompt text. */
export const ANCHOR_SESSION_COMPILER_ID = "anchor-session-prompt";
export const ANCHOR_SESSION_COMPILER_VERSION = "v1";

const RENDERING = [
  "Rendering language:",
  "- Use thick, solid, clean near-black contour lines around the character silhouette, facial features, hair, and clothing shapes.",
  "- Character contour lines follow those shapes. They are not a border around the canvas.",
  "- Use high contrast and a flat color treatment.",
  "- Use a small number of large, defined, hard-edged light and shadow blocks.",
  "- Use solid muted colors rather than many subtle shades.",
  "- Use a vivid natural skin tone.",
  "- No thin sketch lines, delicate outlines, soft airbrush shading, gradients, painterly texture, or excessive tonal groups.",
].join("\n");

const CANVAS = [
  "Background and canvas:",
  "- Use one uniform solid muted slate-blue matte.",
  "- The matte fills the entire canvas edge-to-edge and reaches all four edges and corners.",
  "- No white margins, exposed canvas, incomplete background rectangle, inset background, vignette, frame, border, card, panel, split layout, picture-within-picture, or nested image.",
].join("\n");

const SUBJECT = [
  "Subject and composition:",
  "- Show exactly one person.",
  "- Make a chest-up portrait with the mouth visible and safe margins.",
  "- No additional people.",
  "- No props, objects, furniture, equipment, or environmental context.",
  "- No microphone, microphone stand, desk, chair, recording equipment, or studio setup.",
  "- Use plain unbranded clothing with no logo, emblem, symbol, lettering, or generated text.",
  "- Keep the hands outside the crop unless an explicit supported request requires a visible gesture.",
].join("\n");

const AUTHORITY = [
  "Reference authority:",
  "- A real source photograph controls identity only: facial structure, age, hair, and stable recognizable traits.",
  "- Do not copy its background, crop, room, props, microphone, equipment, pose dependencies, clothing logo, frame, or photographic rendering.",
  "- The accepted anchor controls accepted identity and style continuity during refinement.",
  "- The selected previous candidate is only the visual draft to revise.",
  "- Preserve useful compliant qualities from the previous candidate, but remove any forbidden frame, margin, incomplete matte, prop, microphone, logo, excess tonal detail, or thin-line treatment even if it appears in that candidate.",
].join("\n");

const DIRECT_SOURCE_TASK = [
  "Create one independent base identity anchor.",
  "This is an initial generation.",
  "",
  "The sole image is the source photograph and the identity reference.",
  "It controls facial structure, apparent age, hair, and stable recognizable traits only.",
  "Do not copy its photographic rendering, environment, background, clothing logo, or pose dependency.",
  "Do not return the source photograph.",
].join("\n");

const DIRECT_SOURCE_CONSTRAINTS = [
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

const DIRECT_SOURCE_RENDERING = [
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

function directSourcePrompt(instruction) {
  const trimmed = String(instruction || "").trim();
  const parts = [DIRECT_SOURCE_TASK];
  if (trimmed) {
    parts.push([
      "Scoped adjustment:",
      trimmed,
      "This adjustment does not replace the fixed authority, composition, canvas, lighting, or rendering rules.",
    ].join("\n"));
  }
  parts.push(DIRECT_SOURCE_CONSTRAINTS, DIRECT_SOURCE_RENDERING);
  return parts.join("\n\n");
}

function isDirectSource(references, basis) {
  if (basis === "from-source") return true;
  if (basis) return false;
  const roles = (references || []).map((reference) => reference?.role);
  return roles.length > 0 && roles.every((role) => role === "identity");
}

function roleLine(reference, index) {
  const number = index + 1;
  if (reference.role === "identity") {
    return `Image ${number} is the real source photograph. It controls identity only: facial structure, age, hair, and stable recognizable traits. Do not copy its background, props, microphone, equipment, clothing logo, frame, or photographic rendering. Do not return this photograph.`;
  }
  if (reference.role === "anchor") {
    return `Image ${number} is the current accepted illustrated anchor. It controls accepted identity and style continuity. Do not keep a forbidden frame, margin, prop, microphone, logo, or thin-line treatment from it.`;
  }
  if (reference.role === "previous") {
    return `Image ${number} is the selected previous candidate and only the visual draft to revise. Preserve useful compliant qualities and remove any forbidden frame, margin, incomplete matte, prop, microphone, logo, excess tonal detail, or thin-line treatment.`;
  }
  if (reference.role === "style") {
    return `Image ${number} is the project style reference. It may inform line weight only inside the required rendering language. It never supplies identity, a background, props, a microphone, a logo, or a frame.`;
  }
  return `Image ${number} is a reference image.`;
}

export function compilePrototypePrompt(references, instruction, options = {}) {
  if (isDirectSource(references, options.basis)) return directSourcePrompt(instruction);
  const lines = (references || []).map(roleLine);
  const request = String(instruction || "").trim() || "Create another stylized variant.";
  return [
    "Create one stylized base identity anchor.",
    "",
    lines.join("\n"),
    "",
    `Revision request: ${request}`,
    "The revision request adjusts the selected draft. It does not replace the rendering rules below.",
    "",
    RENDERING,
    "",
    CANVAS,
    "",
    SUBJECT,
    "",
    AUTHORITY,
    "",
    "Target aspect ratio: 4:5.",
  ].join("\n");
}
