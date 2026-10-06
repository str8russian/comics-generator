import assert from "node:assert/strict";
import test from "node:test";
import { segmentDraft } from "../segment.mjs";

function joined(result) {
  let text = "";
  for (let index = 0; index < result.segments.length; index += 1) {
    text += result.segments[index].text;
    if (index < result.separators.length) text += result.separators[index].text;
  }
  return text;
}

test("keeps a CRLF, then LF, then a lone CR, including empty runs", () => {
  const text = "Аня: да\r\n\n \nБорис: нет";
  const result = segmentDraft(text);
  assert.deepEqual(result.segments.map((segment) => segment.text), ["Аня: да", "", " ", "Борис: нет"]);
  assert.deepEqual(result.segments.map((segment) => segment.id), ["seg-0", "seg-1", "seg-2", "seg-3"]);
  assert.deepEqual(result.separators.map((separator) => separator.text), ["\r\n", "\n", "\n"]);
  for (const segment of result.segments) {
    assert.equal(text.slice(segment.draftStart, segment.draftEnd), segment.text);
  }
  assert.equal(joined(result), text);
  assert.deepEqual(result.segments.map(({ id, text: segmentText }) => ({ id, text: segmentText })), [
    { id: "seg-0", text: "Аня: да" },
    { id: "seg-1", text: "" },
    { id: "seg-2", text: " " },
    { id: "seg-3", text: "Борис: нет" },
  ]);
});

test("chooses CR LF before LF before CR", () => {
  assert.deepEqual(segmentDraft("a\r\nb").separators.map((separator) => separator.text), ["\r\n"]);
  assert.deepEqual(segmentDraft("a\nb").separators.map((separator) => separator.text), ["\n"]);
  assert.deepEqual(segmentDraft("a\rb").separators.map((separator) => separator.text), ["\r"]);
  const mixed = segmentDraft("a\r\nb\rc");
  assert.deepEqual(mixed.separators.map((separator) => separator.text), ["\r\n", "\r"]);
  assert.equal(joined(mixed), "a\r\nb\rc");
});

test("keeps an empty draft and a trailing separator as empty text", () => {
  const empty = segmentDraft("");
  assert.deepEqual(empty.segments.map(({ id, text }) => ({ id, text })), [{ id: "seg-0", text: "" }]);
  assert.equal(joined(empty), "");
  const trailing = segmentDraft("\n");
  assert.deepEqual(trailing.segments.map(({ id, text }) => ({ id, text })), [
    { id: "seg-0", text: "" },
    { id: "seg-1", text: "" },
  ]);
  assert.equal(joined(trailing), "\n");
});
