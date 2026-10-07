import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prompt = readFileSync(new URL("../prompts/interpret.md", import.meta.url), "utf8");

test("interpret prompt requires characters, surface forms, utterance speaker status, and no numeric offsets", () => {
  assert.match(prompt, /"characters"/);
  assert.match(prompt, /"surfaceForms"/);
  assert.match(prompt, /explicit/);
  assert.match(prompt, /inferred/);
  assert.match(prompt, /unresolved/);
  assert.match(prompt, /numeric offsets/);
  assert.match(prompt, /draftStart/);
  assert.equal(prompt.includes("prompts/stage.md"), false);
});
