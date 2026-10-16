const STYLE = [
  "The output must be a new illustrated portrait, not a photograph and not a copy of any reference image.",
  "Use a heavy near-black contour, a few large tonal groups, hard-edged light and shadow, simplified graphic shapes, and a plain background.",
  "Frame the person chest-up with the mouth visible.",
  "No text, logo, or watermark.",
].join(" ");

export function compilePrototypePrompt(references, instruction) {
  const lines = (references || []).map((reference, index) => {
    const number = index + 1;
    if (reference.role === "identity") {
      return `Image ${number} is the real source photograph. It controls who the person is. Do not return this photograph.`;
    }
    if (reference.role === "anchor") {
      return `Image ${number} is the current accepted illustrated anchor and the image to revise.`;
    }
    if (reference.role === "previous") {
      return `Image ${number} is a previous generated candidate from this draft. Preserve what still works and apply the new request.`;
    }
    return `Image ${number} is a reference image.`;
  });
  const request = String(instruction || "").trim() || "Create another stylized variant.";
  return [
    "Create one stylized base identity anchor.",
    "",
    lines.join("\n"),
    "",
    `Revision request: ${request}`,
    "",
    STYLE,
    "Target aspect ratio: 4:5.",
  ].join("\n");
}
