import assert from "node:assert/strict";
import test from "node:test";
import { anchorDraft } from "../fidelity.mjs";

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

function silent(id, kind, quote, segmentIds = ["seg-0"]) {
  return {
    id,
    kind,
    segmentIds,
    speakerStatus: "none",
    sourceQuote: quote,
  };
}

function assertSlice(draft, item) {
  assert.equal(draft.slice(item.draftStart, item.draftEnd), item.sourceQuote);
  assert.equal(item.draftEnd - item.draftStart, item.sourceQuote.length);
}

test("reads two utterances and one action on one line", () => {
  const draft = "Путин: Привет. (пауза) Дуров: Пока.";
  const result = anchorDraft(draft, [
    explicit("putin", "Путин", "Путин: Привет."),
    silent("pause", "action", "(пауза)"),
    explicit("durov", "Дуров", "Дуров: Пока."),
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceItems.map((item) => item.text), ["Привет.", "(пауза)", "Пока."]);
  for (const item of result.sourceItems) assertSlice(draft, item);
  assert.deepEqual(result.sourceItems.map((item) => item.segmentIds), [
    ["seg-0"],
    ["seg-0"],
    ["seg-0"],
  ]);
});

test("reads an utterance and an action on one line", () => {
  const draft = "Аня: Смотри. (машет)";
  const result = anchorDraft(draft, [
    explicit("anya", "Аня", "Аня: Смотри."),
    silent("wave", "action", "(машет)"),
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceItems.map((item) => item.text), ["Смотри.", "(машет)"]);
  for (const item of result.sourceItems) assertSlice(draft, item);
});

test("reads context and then dialogue on one line", () => {
  const draft = "[утро] Аня: Пора.";
  const result = anchorDraft(draft, [
    silent("morning", "context", "[утро]"),
    explicit("anya", "Аня", "Аня: Пора."),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.sourceItems[0].text, "[утро]");
  assert.equal(result.sourceItems[1].text, "Пора.");
  for (const item of result.sourceItems) assertSlice(draft, item);
});

test("accepts one quote that contains the separator between two segments", () => {
  const draft = "Аня: да\r\nпродолжение";
  const result = anchorDraft(draft, [
    explicit("anya", "Аня", draft, ["seg-0", "seg-1"]),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.sourceItems[0].sourceQuote.includes("\r\n"), true);
  assert.equal(result.sourceItems[0].text, "да\r\nпродолжение");
  assertSlice(draft, result.sourceItems[0]);
});

test("assigns two identical quotes in order as one assignment", () => {
  const draft = "Да. Да.";
  const result = anchorDraft(draft, [
    inferred("first", "Аня", "Да."),
    inferred("second", "Борис", "Да."),
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceItems.map((item) => item.text), ["Да.", "Да."]);
  assert.equal(result.sourceItems[0].draftEnd <= result.sourceItems[1].draftStart, true);
  for (const item of result.sourceItems) assertSlice(draft, item);
});

test("keeps Cyrillic, an emoji surrogate pair, and a combining mark inside the slice", () => {
  const cyrillic = "Борис: нет";
  const cyrillicResult = anchorDraft(cyrillic, [explicit("boris", "Борис", cyrillic)]);
  assert.equal(cyrillicResult.ok, true);
  assert.equal(cyrillicResult.sourceItems[0].text, "нет");
  assertSlice(cyrillic, cyrillicResult.sourceItems[0]);

  const emoji = "Аня: привет 😀";
  const emojiResult = anchorDraft(emoji, [explicit("anya", "Аня", emoji)]);
  assert.equal(emojiResult.ok, true);
  assert.equal(emojiResult.sourceItems[0].text, "привет 😀");
  assert.equal(emojiResult.sourceItems[0].text.includes("😀"), true);
  assertSlice(emoji, emojiResult.sourceItems[0]);

  const marked = "Аня: е\u0308";
  const markedResult = anchorDraft(marked, [explicit("anya", "Аня", marked)]);
  assert.equal(markedResult.ok, true);
  assert.equal(markedResult.sourceItems[0].text, "е\u0308");
  assertSlice(marked, markedResult.sourceItems[0]);
});

test("leaves the gap in a CRLF draft server-owned", () => {
  const draft = "Аня: да\r\n\n \nБорис: нет";
  const result = anchorDraft(draft, [
    explicit("anya", "Аня", "Аня: да", ["seg-0"]),
    explicit("boris", "Борис", "Борис: нет", ["seg-3"]),
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceItems.map((item) => item.text), ["да", "нет"]);
  for (const item of result.sourceItems) assertSlice(draft, item);
  const covered = new Array(draft.length).fill(false);
  for (const item of result.sourceItems) {
    for (let index = item.draftStart; index < item.draftEnd; index += 1) covered[index] = true;
  }
  let gap = "";
  for (let index = 0; index < draft.length; index += 1) {
    if (!covered[index]) gap += draft[index];
  }
  assert.equal(gap, "\r\n\n \n");
});

test("drops only one leading label prefix from explicit spoken text", () => {
  const spaced = anchorDraft("Аня: да", [explicit("spaced", "Аня", "Аня: да")]);
  const tight = anchorDraft("Аня:да", [explicit("tight", "Аня", "Аня:да")]);
  const inferredQuote = anchorDraft("Борис: нет", [
    inferred("kept", "Борис", "Борис: нет"),
  ]);
  assert.equal(spaced.ok, true);
  assert.equal(tight.ok, true);
  assert.equal(inferredQuote.ok, true);
  assert.equal(spaced.sourceItems[0].text, "да");
  assert.equal(tight.sourceItems[0].text, "да");
  assert.equal(inferredQuote.sourceItems[0].text, "Борис: нет");
});
