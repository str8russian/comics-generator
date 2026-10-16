import assert from "node:assert/strict";
import test from "node:test";
import { compilePrototypePrompt } from "../lib/prompt.mjs";

const POSITIVE_BORDER = /\b(add|draw|include|paint|use|create) (a |an |the )?(clean |canvas |black |stroke )*border\b/i;

function assertStyleContract(prompt) {
  assert.match(prompt, /thick, solid, clean near-black contour lines/);
  assert.match(prompt, /not a border around the canvas/);
  assert.match(prompt, /small number of large, defined, hard-edged light and shadow blocks/);
  assert.match(prompt, /solid muted colors rather than many subtle shades/);
  assert.match(prompt, /No thin sketch lines, delicate outlines, soft airbrush shading, gradients, painterly texture, or excessive tonal groups/);
  assert.match(prompt, /uniform solid muted slate-blue matte/);
  assert.match(prompt, /fills the entire canvas edge-to-edge and reaches all four edges and corners/);
  assert.match(prompt, /No white margins, exposed canvas, incomplete background rectangle, inset background, vignette, frame, border/);
  assert.match(prompt, /No microphone, microphone stand, desk, chair, recording equipment, or studio setup/);
  assert.match(prompt, /plain unbranded clothing with no logo, emblem, symbol, lettering, or generated text/);
  assert.match(prompt, /controls identity only: facial structure, age, hair, and stable recognizable traits/);
  assert.match(prompt, /Do not copy its background, crop, room, props, microphone, equipment, pose dependencies, clothing logo, frame, or photographic rendering/);
  assert.match(prompt, /accepted anchor controls accepted identity and style continuity/);
  assert.match(prompt, /selected previous candidate is only the visual draft to revise/);
  assert.match(prompt, /remove any forbidden frame, margin, incomplete matte, prop, microphone, logo, excess tonal detail, or thin-line treatment/);
  assert.match(prompt, /Target aspect ratio: 4:5/);
  assert.equal(POSITIVE_BORDER.test(prompt), false);
  assert.equal(prompt.includes("clean black stroke borders"), false);
}

test("the system style stays in force when the revision request is empty or custom", () => {
  const empty = compilePrototypePrompt([
    { role: "anchor" },
    { role: "identity" },
    { role: "previous" },
  ], "   ");
  const custom = compilePrototypePrompt([{ role: "identity" }], "soften the jaw");
  assert.match(empty, /Revision request: Create another stylized variant\./);
  assert.match(custom, /Revision request: soften the jaw/);
  assert.match(custom, /does not replace the rendering rules/);
  assertStyleContract(empty);
  assertStyleContract(custom);
  assert.match(empty, /Image 1 is the current accepted illustrated anchor/);
  assert.match(empty, /Image 2 is the real source photograph/);
  assert.match(empty, /Image 3 is the selected previous candidate and only the visual draft to revise/);
});
