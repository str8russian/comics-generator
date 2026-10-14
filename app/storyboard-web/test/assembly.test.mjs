import assert from "node:assert/strict";
import test from "node:test";
import { applyOperation, ensurePanelIds, preservePanelIdentity } from "../assembly.mjs";
import {
  defaultDurationFrames,
  dialogueCompletes,
  minimumDurationFrames,
  revealFramesFor,
  SILENT_DEFAULT_FRAMES,
} from "../timing.mjs";

let serial = 0;
const ids = () => {
  serial += 1;
  return `id-${serial}`;
};

function board() {
  return [{
    id: "frame-1",
    layout: "split2",
    origin: "source",
    dialogue: "Привет",
    speakerPanel: 0,
    sourceItemId: "item-1",
    sourceRole: "utterance",
    panels: [
      { id: "left", description: "Левая речь", ownerDescription: "заметка слева" },
      { id: "right", description: "Правая реакция", ownerDescription: "заметка справа" },
    ],
  }, {
    id: "frame-2",
    layout: "single",
    origin: "source",
    dialogue: "",
    panels: [{ id: "solo", description: "Один" }],
  }];
}

test("panel ids survive reorder and the speaker follows the semantic panel", () => {
  const result = applyOperation(board(), {
    op: "reorderPanels",
    structureFrameId: "frame-1",
    panelIds: ["right", "left"],
  }, { idFactory: ids });
  assert.equal(result.ok, true);
  assert.deepEqual(result.frames[0].panels.map((panel) => panel.id), ["right", "left"]);
  assert.equal(result.frames[0].speakerPanel, 1);
  assert.equal(result.frames[0].dialogue, "Привет");
  assert.equal(result.frames[0].sourceItemId, "item-1");
  assert.equal(result.frames[0].panels[0].description, "Правая реакция");
  assert.equal(result.frames[0].panels[0].ownerDescription, "заметка справа");
  assert.equal(result.frames[1].id, "frame-2");
});

test("single becomes split2 and split2 can return to single without replacing the remaining panel", () => {
  const added = applyOperation(board(), {
    op: "addPanel",
    structureFrameId: "frame-2",
  }, { idFactory: ids });
  assert.equal(added.ok, true);
  assert.equal(added.frames[1].layout, "split2");
  assert.equal(added.frames[1].panels[0].id, "solo");
  assert.equal(added.frames[1].panels[0].description, "Один");
  assert.equal(added.frames[1].panels[1].description, "");
  const removed = applyOperation(added.frames, {
    op: "deletePanel",
    panelId: added.frames[1].panels[1].id,
  }, { idFactory: ids });
  assert.equal(removed.ok, true);
  assert.equal(removed.frames[1].layout, "single");
  assert.equal(removed.frames[1].panels.length, 1);
  assert.equal(removed.frames[1].panels[0].id, "solo");
});

test("confirmed speaker deletion keeps the dialogue and moves ownership to the survivor", () => {
  const result = applyOperation(board(), {
    op: "deletePanel",
    panelId: "left",
    confirmSpeakerTransfer: true,
  }, { idFactory: ids });
  assert.equal(result.ok, true);
  assert.equal(result.frames[0].layout, "single");
  assert.equal(result.frames[0].panels[0].id, "right");
  assert.equal(result.frames[0].speakerPanel, 0);
  assert.equal(result.frames[0].dialogue, "Привет");
  assert.equal(result.frames[0].sourceItemId, "item-1");
});

test("deleting the speaking panel without confirmation leaves the frame unchanged", () => {
  const original = board();
  const result = applyOperation(original, { op: "deletePanel", panelId: "left" }, { idFactory: ids });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "speaker-transfer-required");
  assert.equal(original[0].speakerPanel, 0);
  assert.equal(original[0].dialogue, "Привет");
});

test("frame reorder keeps ids and a partial order is rejected", () => {
  const moved = applyOperation(board(), {
    op: "reorderFrames",
    structureFrameIds: ["frame-2", "frame-1"],
  }, { idFactory: ids });
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.frames.map((frame) => frame.id), ["frame-2", "frame-1"]);
  assert.equal(moved.frames[1].dialogue, "Привет");
  const rejected = applyOperation(board(), {
    op: "reorderFrames",
    structureFrameIds: ["frame-1", "frame-1"],
  }, { idFactory: ids });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, "invalid-order");
});

test("insert gives a new frame id and delete refuses the last frame", () => {
  const inserted = applyOperation(board(), {
    op: "insertFrame",
    afterStructureFrameId: "frame-1",
    kind: "text",
  }, { idFactory: ids });
  assert.equal(inserted.ok, true);
  assert.equal(inserted.frames[1].frameKind, "text");
  assert.equal(inserted.frames[1].textCard, "");
  assert.equal(inserted.frames[1].dialogue, "");
  assert.notEqual(inserted.frames[1].id, "frame-1");
  assert.equal(inserted.frames[2].id, "frame-2");
  const image = applyOperation(board(), {
    op: "insertFrame",
    index: 0,
    kind: "image",
  }, { idFactory: ids });
  assert.equal(image.frames[0].frameKind, "image");
  assert.equal(image.frames[0].durationFrames, 36);
  assert.equal(image.frames[0].panels.length, 1);
  const only = [{ id: "frame-1", layout: "single", dialogue: "", panels: [{ id: "solo", description: "" }] }];
  const deleted = applyOperation(only, { op: "deleteFrame", structureFrameId: "frame-1" }, { idFactory: ids });
  assert.equal(deleted.kind, "last-frame");
  assert.equal(only[0].id, "frame-1");
});

test("a directing beat requires a segment index before a panel edit", () => {
  const frames = [{
    id: "beat",
    directingBeat: true,
    dialogue: "РазДва",
    sourceItemId: "item-9",
    segments: [
      { quote: "Раз", layout: "single", speakerPanel: 0, panels: [{ id: "a", description: "А" }] },
      { quote: "Два", layout: "single", speakerPanel: 0, panels: [{ id: "b", description: "Б" }] },
    ],
  }];
  const missing = applyOperation(frames, { op: "addPanel", structureFrameId: "beat" }, { idFactory: ids });
  assert.equal(missing.kind, "segment-required");
  assert.equal(frames[0].segments[0].panels.length, 1);
  const added = applyOperation(frames, {
    op: "addPanel",
    structureFrameId: "beat",
    structureSegmentIndex: 1,
  }, { idFactory: ids });
  assert.equal(added.ok, true);
  assert.equal(added.frames[0].segments[0].panels.length, 1);
  assert.equal(added.frames[0].segments[1].layout, "split2");
  assert.equal(added.frames[0].segments[1].panels[0].id, "b");
  assert.equal(added.frames[0].segments[1].quote, "Два");
});

test("duration and text-card edits do not rewrite dialogue", () => {
  const tooShort = applyOperation(board(), {
    op: "setDuration",
    structureFrameId: "frame-1",
    durationFrames: 12,
  }, { idFactory: ids });
  assert.equal(tooShort.kind, "duration-truncates-dialogue");
  const original = board();
  const silent = applyOperation(original, {
    op: "setDuration",
    structureFrameId: "frame-2",
    durationFrames: 48,
  }, { idFactory: ids });
  assert.equal(silent.ok, true);
  assert.equal(silent.frames[1].durationFrames, 48);
  assert.equal(silent.frames[0].dialogue, "Привет");
  const minimum = minimumDurationFrames("Привет");
  const accepted = applyOperation(board(), {
    op: "setDuration",
    structureFrameId: "frame-1",
    durationFrames: minimum,
  }, { idFactory: ids });
  assert.equal(accepted.ok, true);
  assert.equal(dialogueCompletes(minimum, "Привет"), true);
  const card = applyOperation(board(), {
    op: "insertFrame",
    index: 2,
    kind: "text",
  }, { idFactory: ids });
  const written = applyOperation(card.frames, {
    op: "setTextCard",
    structureFrameId: card.frameId,
    text: "Пояснение",
  }, { idFactory: ids });
  assert.equal(written.ok, true);
  assert.equal(written.frames[2].textCard, "Пояснение");
  assert.equal(written.frames[2].dialogue, "");
  assert.equal(written.frames[0].dialogue, "Привет");
  const noted = applyOperation(board(), {
    op: "setOwnerDescription",
    panelId: "left",
    ownerDescription: "только заметка",
  }, { idFactory: ids });
  assert.equal(noted.frames[0].panels[0].ownerDescription, "только заметка");
  assert.equal(noted.frames[0].panels[0].description, "Левая речь");
});

test("invalid duration values are rejected", () => {
  for (const durationFrames of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = applyOperation(board(), {
      op: "setDuration",
      structureFrameId: "frame-2",
      durationFrames,
    }, { idFactory: ids });
    assert.equal(result.ok, false, String(durationFrames));
  }
});

test("silent default is 36 frames and dialogue default keeps the hold", () => {
  assert.equal(SILENT_DEFAULT_FRAMES, 36);
  assert.equal(defaultDurationFrames(""), 36);
  assert.equal(defaultDurationFrames("Привет"), 12 + revealFramesFor("Привет") + 36);
  assert.equal(dialogueCompletes(defaultDurationFrames("Привет"), "Привет"), true);
  assert.equal(dialogueCompletes(minimumDurationFrames("Привет") - 1, "Привет"), false);
});

test("backfill assigns missing panel ids once and preserves them", () => {
  const first = ensurePanelIds([{
    id: "frame-1",
    layout: "single",
    panels: [{ description: "Без id" }],
  }], ids);
  assert.equal(first.changed, true);
  assert.equal(typeof first.frames[0].panels[0].id, "string");
  const second = ensurePanelIds(first.frames, ids);
  assert.equal(second.changed, false);
  assert.equal(second.frames[0].panels[0].id, first.frames[0].panels[0].id);
});

test("copy-forward matches a moved panel by description when the editor drops ids", () => {
  const previous = board();
  const edited = structuredClone(previous);
  edited[0].panels = [
    { description: "Правая реакция" },
    { description: "Левая речь" },
  ];
  const preserved = preservePanelIdentity(previous, edited, ids);
  assert.deepEqual(preserved[0].panels.map((panel) => panel.id), ["right", "left"]);
  assert.equal(preserved[0].panels[1].ownerDescription, "заметка слева");
});
