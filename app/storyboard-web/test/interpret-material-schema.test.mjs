import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("../../../specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json", import.meta.url), "utf8"));

function compile(value) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  return ajv.compile(structuredClone(value));
}

const validate = compile(schema);

function materialResponse(overrides = {}) {
  return {
    sourceItems: [{
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Путин",
      sourceQuote: "Путин: да",
    }],
    characters: [{ id: "c1", name: "Путин" }],
    surfaceForms: [{
      id: "s1",
      quote: "Путин",
      role: "speaker-label",
      characterId: "c1",
    }],
    ...overrides,
  };
}

test("compiles the material interpret schema in strict mode", () => {
  assert.equal(typeof validate, "function");
  assert.equal(validate(materialResponse()), true, JSON.stringify(validate.errors));
});

test("requires sourceItems, characters, and surfaceForms", () => {
  for (const key of ["sourceItems", "characters", "surfaceForms"]) {
    const missing = materialResponse();
    delete missing[key];
    assert.equal(validate(missing), false, key);
  }
});

test("rejects a surface form without quote, an unknown property, and a numeric offset", () => {
  const missingQuote = materialResponse();
  delete missingQuote.surfaceForms[0].quote;
  assert.equal(validate(missingQuote), false);

  assert.equal(validate(materialResponse({ note: "extra" })), false);
  assert.equal(validate(materialResponse({
    surfaceForms: [{
      id: "s1",
      quote: "Путин",
      role: "speaker-label",
      start: 0,
    }],
  })), false);

  const offset = materialResponse();
  offset.sourceItems[0].draftStart = 0;
  assert.equal(validate(offset), false);
  offset.sourceItems[0].end = 4;
  assert.equal(validate(offset), false);
});
