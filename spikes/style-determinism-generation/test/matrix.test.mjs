import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ATTEMPT_ORDER,
  CONDITIONS,
  DISPLAY_CODE_ORDER,
} from "../lib/constants.mjs";
import { buildMatrix, displayGroups } from "../lib/matrix.mjs";
import {
  ACCEPTED_STYLE_BLOCK,
  COMMON_CONSTRAINTS,
  HYBRID_PRECEDENCE,
  STYLE_AUTHORITY,
  compileConditionPrompt,
  referencePlan,
} from "../lib/prompts.mjs";

test("matrix is the stable 2 by 3 by 2 plan in interleaved attempt order", () => {
  const cells = buildMatrix();
  assert.equal(cells.length, 12);
  assert.deepEqual(cells.map((cell) => cell.id), ATTEMPT_ORDER);
  assert.equal(new Set(cells.map((cell) => cell.id)).size, 12);
  assert.equal(new Set(cells.map((cell) => cell.publicId)).size, 12);
  for (const sourceId of ["source-a", "source-b"]) {
    for (const condition of CONDITIONS) {
      for (const repetition of ["r1", "r2"]) {
        assert.equal(cells.filter((cell) => cell.sourceId === sourceId && cell.condition === condition && cell.repetition === repetition).length, 1);
      }
    }
  }
  const conditions = cells.map((cell) => cell.condition);
  for (let index = 1; index < conditions.length; index += 1) {
    assert.notEqual(conditions[index], conditions[index - 1]);
  }
});

test("blinded display order is predeclared and differs from condition definition order", () => {
  const firstGroup = displayGroups(buildMatrix())[0];
  assert.deepEqual(firstGroup.cells.map((cell) => cell.blindCode), [...DISPLAY_CODE_ORDER]);
  assert.deepEqual(DISPLAY_CODE_ORDER, ["C-K4", "C-M9", "C-R2"]);
  assert.notDeepEqual(DISPLAY_CODE_ORDER, ["C-K4", "C-R2", "C-M9"]);
});

test("common constraints are identical and the style block is only in prompt-only and hybrid", () => {
  const prompts = Object.fromEntries(CONDITIONS.map((condition) => [condition, compileConditionPrompt(condition)]));
  for (const prompt of Object.values(prompts)) {
    assert.equal(prompt.includes(COMMON_CONSTRAINTS), true);
    assert.equal(prompt.includes("Target aspect ratio: 4:5."), true);
    assert.equal(prompt.includes("neutral diffuse presentation lighting"), true);
    assert.equal(prompt.includes("decorative reflected-light bands"), true);
    assert.equal(/gta|grand theft|san andreas/i.test(prompt), false);
  }
  assert.equal(prompts["prompt-only"].includes(ACCEPTED_STYLE_BLOCK), true);
  assert.equal(prompts.hybrid.includes(ACCEPTED_STYLE_BLOCK), true);
  assert.equal(prompts["style-reference-only"].includes(ACCEPTED_STYLE_BLOCK), false);
  assert.equal(prompts["style-reference-only"].includes("thick near-black contour"), false);
  assert.equal(prompts["prompt-only"].includes("Image 2"), false);
  assert.equal(prompts["style-reference-only"].includes(STYLE_AUTHORITY), true);
  assert.equal(prompts.hybrid.includes(STYLE_AUTHORITY), true);
  assert.equal(prompts.hybrid.includes(HYBRID_PRECEDENCE), true);
  assert.equal(prompts["prompt-only"].includes(HYBRID_PRECEDENCE), false);
  assert.equal(prompts["style-reference-only"].includes(HYBRID_PRECEDENCE), false);
  assert.equal(prompts["prompt-only"], compileConditionPrompt("prompt-only"));
});

test("identity is first and style is present only for the style-bearing conditions", () => {
  assert.deepEqual(referencePlan("prompt-only"), ["identity"]);
  assert.deepEqual(referencePlan("style-reference-only"), ["identity", "style"]);
  assert.deepEqual(referencePlan("hybrid"), ["identity", "style"]);
  for (const cell of buildMatrix()) {
    assert.equal(cell.roles[0], "identity");
    assert.equal(cell.roles.includes("style"), cell.condition !== "prompt-only");
    assert.equal(cell.roles.some((role) => ["previous", "anchor", "performance", "current"].includes(role)), false);
  }
});

test("the tracked template has logical fields and the approved hashes only", async () => {
  const template = JSON.parse(await readFile(new URL("../manifest.template.json", import.meta.url), "utf8"));
  assert.equal(template.samePerson, true);
  assert.equal(template.inputs["source-a"].sha256, "b4e3eec69f14c21e910ba45f6cf80d23098026a70f5258cf5c8c509f5c364827");
  assert.equal(template.inputs["source-b"].sha256, "59f457cc2f66d675e2198f56e45c93aa23f3200fd09b38d546442f9f217be2d1");
  assert.equal(template.inputs["style-reference"].sha256, "2b4faa44c888c5282781bf10c83d4fcd41301c9a0903c2b68dec8d8e47a13fdb");
  assert.deepEqual([template.inputs["source-a"].width, template.inputs["source-a"].height], [640, 640]);
  assert.deepEqual([template.inputs["style-reference"].width, template.inputs["style-reference"].height], [928, 1152]);
  const text = JSON.stringify(template);
  assert.equal(text.includes("Downloads"), false);
  assert.equal(text.includes("\"path\""), false);
});
