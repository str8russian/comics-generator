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
  return `Image ${number} is a reference image.`;
}

export function compilePrototypePrompt(references, instruction) {
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
