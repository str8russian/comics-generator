import assert from "node:assert/strict";
import test from "node:test";
import { anchorDraft } from "../fidelity.mjs";

function codes(result) {
  assert.equal(result.ok, false);
  return result.failures.map((failure) => failure.code);
}

function explicit(id, label, quote, segmentIds = ["seg-0"]) {
  return {
    id,
    kind: "utterance",
    segmentIds,
    speakerStatus: "explicit",
    speakerLabel: label,
    sourceQuote: quote,
  };
}

function inferred(id, label, quote, segmentIds = ["seg-0"]) {
  return {
    id,
    kind: "utterance",
    segmentIds,
    speakerStatus: "inferred",
    speakerLabel: label,
    sourceQuote: quote,
  };
}

test("blocks a quote with no scalar-boundary match", () => {
  const result = anchorDraft("Аня: да", [explicit("u", "Аня", "нет такого")]);
  assert.deepEqual(codes(result), ["invalid-anchor"]);
});

test("blocks two Да quotes inside Да Да Да as ambiguous", () => {
  const result = anchorDraft("Да Да Да", [
    inferred("first", "Аня", "Да"),
    inferred("second", "Борис", "Да"),
  ]);
  assert.deepEqual(codes(result), ["ambiguous-anchor"]);
});

test("blocks overlapping quotes that cannot be packed", () => {
  const result = anchorDraft("абв", [
    inferred("left", "Аня", "аб"),
    inferred("right", "Борис", "бв"),
  ]);
  assert.deepEqual(codes(result), ["overlapping-anchor"]);
});

test("blocks quotes that pack only after they are reordered", () => {
  const draft = "Аня: да Борис: нет";
  const result = anchorDraft(draft, [
    explicit("boris", "Борис", "Борис: нет"),
    explicit("anya", "Аня", "Аня: да"),
  ]);
  assert.deepEqual(codes(result), ["reordered-dialogue"]);
});

test("blocks a period left outside every quote", () => {
  const result = anchorDraft("Аня: да.", [explicit("anya", "Аня", "Аня: да")]);
  assert.deepEqual(codes(result), ["invalid-coverage"]);
});

test("blocks an explicit slice that does not start with the label prefix", () => {
  const result = anchorDraft("привет", [explicit("anya", "Аня", "привет")]);
  assert.deepEqual(codes(result), ["invalid-speaker-label"]);
});

test("blocks a surrogate fragment and a combining mark left outside the quote", () => {
  const emoji = anchorDraft("Аня: 😀", [explicit("anya", "Аня", "\uD83D")]);
  assert.deepEqual(codes(emoji), ["invalid-anchor"]);
  const mark = anchorDraft("е\u0308", [inferred("mark", "Аня", "е")]);
  assert.deepEqual(codes(mark), ["invalid-coverage"]);
});

test("collects duplicate ids and a missing quote without dropping either", () => {
  const result = anchorDraft("Аня: да", [
    explicit("same", "Аня", "нет"),
    explicit("same", "Борис", "тоже"),
  ]);
  assert.deepEqual(codes(result), ["duplicate-id", "invalid-anchor"]);
});

test("classifies a repetitive ambiguous draft without enumerating every assignment", { timeout: 1000 }, () => {
  const draft = Array.from({ length: 8000 }, () => "Да").join(" ");
  const started = Date.now();
  const result = anchorDraft(draft, [
    inferred("first", "Аня", "Да"),
    inferred("second", "Борис", "Да"),
  ]);
  assert.deepEqual(codes(result), ["ambiguous-anchor"]);
  assert.equal(Date.now() - started < 500, true);
});
