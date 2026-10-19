import assert from "node:assert/strict";
import test from "node:test";
import { backfillDialogueModes, dialogueStateError } from "../dialogue-mode.mjs";

test("explicit mode validation rejects inconsistent state", () => {
  assert.equal(dialogueStateError({
    dialogueMode: "spoken",
    dialogue: "   ",
    speakerPanel: 0,
    panels: [{ id: "a" }],
  }), "empty-dialogue");
  assert.equal(dialogueStateError({
    dialogueMode: "spoken",
    dialogue: "Привет",
    speakerPanel: null,
    panels: [{ id: "a" }, { id: "b" }],
  }), "speaker-required");
  assert.equal(dialogueStateError({
    dialogueMode: "silent",
    dialogue: "Привет",
    speakerPanel: 0,
    panels: [{ id: "a" }],
  }), "speaker-present");
  assert.equal(dialogueStateError({
    dialogueMode: "silent",
    dialogue: "Привет",
    speakerPanel: null,
    panels: [{ id: "a" }, { id: "b" }],
  }), null);
  assert.equal(dialogueStateError({
    dialogueMode: "hidden",
    dialogue: "Привет",
    speakerPanel: null,
    panels: [{ id: "a" }],
  }), null);
  assert.equal(dialogueStateError({ frameKind: "text", textCard: "Пауза" }), null);
  assert.equal(dialogueStateError({ frameKind: "text", dialogueMode: "spoken", textCard: "Пауза" }), "text-card");
});

test("legacy backfill is explicit, idempotent, and never chooses silent", () => {
  const legacy = [{
    id: "said",
    dialogue: "Привет",
    speakerPanel: 1,
    panels: [{ id: "a" }, { id: "b" }],
  }, {
    id: "act",
    sourceRole: "action",
    dialogue: "",
    panels: [{ id: "c" }],
  }, {
    id: "card",
    frameKind: "text",
    textCard: "Пауза",
    dialogue: "",
    panels: [],
  }, {
    id: "beat",
    directingBeat: true,
    dialogue: "Раз.Два.",
    segments: [
      { quote: "Раз.", speakerPanel: 0, panels: [{ id: "d" }] },
      { quote: "Два.", speakerPanel: 0, panels: [{ id: "e" }] },
    ],
  }];
  const first = backfillDialogueModes(legacy);
  assert.equal(first.changed, true);
  assert.equal(first.frames[0].dialogueMode, "spoken");
  assert.equal(first.frames[0].speakerPanel, 1);
  assert.equal(first.frames[0].dialogue, "Привет");
  assert.equal(first.frames[1].dialogueMode, "hidden");
  assert.equal(Object.hasOwn(first.frames[2], "dialogueMode"), false);
  assert.equal(Object.hasOwn(first.frames[3], "dialogueMode"), false);
  assert.equal(first.frames[3].segments[0].dialogueMode, "spoken");
  assert.equal(first.frames[3].segments[1].dialogueMode, "spoken");
  assert.equal(first.frames.some((frame) => frame.dialogueMode === "silent"), false);
  const second = backfillDialogueModes(first.frames);
  assert.equal(second.changed, false);
  assert.deepEqual(second.frames, first.frames);
});
