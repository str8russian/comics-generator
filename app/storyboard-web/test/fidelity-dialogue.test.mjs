import assert from "node:assert/strict";
import test from "node:test";
import { assessDialogue } from "../overflow.mjs";

function codes(result) {
  assert.equal(result.ok, false);
  return result.failures.map((failure) => failure.code);
}

const sourceItems = [{ id: "anya", kind: "utterance", text: "Привет." }];

function piece(start, end, dialogue = sourceItems[0].text.slice(start, end), id = "f1") {
  return {
    id,
    sourceItemId: "anya",
    sourceRole: "utterance",
    dialogue,
    displayBlock: { sourceItemId: "anya", start, end },
  };
}

test("blocks spoken text that no display block covers", () => {
  const result = assessDialogue(sourceItems, [piece(0, 3)]);
  assert.deepEqual(codes(result), ["lost-dialogue"]);
  assert.equal(codes(result).includes("schema-invalid"), false);
});

test("blocks a spoken span shown twice", () => {
  const result = assessDialogue(sourceItems, [
    piece(0, 7, "Привет.", "f1"),
    piece(0, 7, "Привет.", "f2"),
  ]);
  assert.deepEqual(codes(result), ["duplicated-dialogue"]);
});

test("blocks display blocks that are not in spoken order", () => {
  const result = assessDialogue(sourceItems, [
    piece(4, 7, "ет.", "f1"),
    piece(0, 4, "Прив", "f2"),
  ]);
  assert.deepEqual(codes(result), ["reordered-dialogue"]);
});

test("blocks schema-valid wording that is not the server slice", () => {
  const result = assessDialogue(sourceItems, [piece(0, 7, "Пока!!!")]);
  assert.deepEqual(codes(result), ["changed-wording"]);
  assert.equal(JSON.stringify(result).includes("schema-invalid"), false);
});

test("blocks an empty or reversed display range", () => {
  assert.deepEqual(codes(assessDialogue(sourceItems, [piece(0, 0), piece(0, 7, "Привет.", "f2")])), ["invalid-display-block"]);
  assert.deepEqual(codes(assessDialogue(sourceItems, [piece(0, 7, "Привет.", "f1"), piece(7, 7, "", "f2")])), ["invalid-display-block"]);
  assert.deepEqual(codes(assessDialogue(sourceItems, [piece(5, 2)])), ["invalid-display-block"]);
});

test("blocks a display block whose source id does not match the frame", () => {
  const mismatched = piece(0, 7, "Привет.");
  mismatched.displayBlock.sourceItemId = "boris";
  const known = [{ ...sourceItems[0] }, { id: "boris", kind: "action", text: "(пауза)" }];
  assert.deepEqual(codes(assessDialogue(known, [mismatched])), ["invalid-display-block"]);

  const unknown = piece(0, 7, "Привет.");
  unknown.displayBlock.sourceItemId = "ghost";
  assert.deepEqual(codes(assessDialogue(sourceItems, [unknown])), ["invalid-display-block"]);
});

test("blocks a display range that splits a grapheme", () => {
  const emoji = [{ id: "anya", kind: "utterance", text: "а😀" }];
  const result = assessDialogue(emoji, [{
    id: "f1",
    sourceItemId: "anya",
    sourceRole: "utterance",
    dialogue: emoji[0].text.slice(0, 2),
    displayBlock: { sourceItemId: "anya", start: 0, end: 2 },
  }, {
    id: "f2",
    sourceItemId: "anya",
    sourceRole: "utterance",
    dialogue: emoji[0].text.slice(2),
    displayBlock: { sourceItemId: "anya", start: 2, end: emoji[0].text.length },
  }]);
  assert.deepEqual(codes(result), ["invalid-display-block"]);
});
