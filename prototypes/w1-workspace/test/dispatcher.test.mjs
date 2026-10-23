import assert from "node:assert/strict";
import test from "node:test";
import { STUBBED_OPERATIONS, WIRED_OPERATIONS } from "../public/store.mjs";
import { fixtureStore } from "./helpers.mjs";

const SPLIT = { structureFrameId: "fx-frame-2", structureSegmentIndex: null };

function frameById(store, id) {
  return store.view().storyboard.frames.find((frame) => frame.id === id);
}

function snapshotOf(store) {
  return JSON.stringify({ frames: store.view().storyboard.frames, panelStates: store.view().panelStates });
}

test("duplicateFrame inserts after the source with new ids, same content, selection, and renumbering", () => {
  const { store } = fixtureStore();
  const before = store.frames();
  const followingId = before[2].id;
  const result = store.dispatch({ op: "duplicateFrame", ...SPLIT });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  const after = store.frames();
  assert.equal(after.length, before.length + 1);

  const source = after[1];
  const copy = after[2];
  assert.equal(source.id, "fx-frame-2");
  assert.equal(copy.structureFrameId, result.operationResult.created.structureFrameId);
  assert.notEqual(copy.id, source.id);
  assert.equal(result.operationResult.createdDisplayNumber, 3);
  assert.equal(after[3].id, followingId, "the old frame 3 is now frame 4");
  assert.equal(after[3].number, 4);

  const sourceIds = source.panels.map((panel) => panel.id);
  const copyIds = copy.panels.map((panel) => panel.id);
  assert.equal(copyIds.length, sourceIds.length);
  for (const id of copyIds) assert.equal(sourceIds.includes(id), false);
  assert.equal(new Set(copyIds).size, copyIds.length);

  for (const key of ["layout", "dialogueMode", "speakerPanel", "storedDialogue", "frameKind"]) {
    assert.deepEqual(copy[key], source[key], key);
  }
  assert.equal(copy.timing.durationFrames, source.timing.durationFrames);
  copy.panels.forEach((panel, index) => {
    const original = source.panels[index];
    for (const key of ["description", "subject", "assetId", "zoom", "positionX", "positionY", "mirrored"]) {
      assert.deepEqual(panel[key], original[key], `panel ${index} ${key}`);
    }
  });
  const raw = frameById(store, copy.structureFrameId);
  assert.equal(raw.dormantSpeakerPanelId, copyIds[1], "dormant speaker is remapped onto the copy");
  assert.deepEqual(store.selection.frame, result.operationResult.created);
});

test("one Undo removes the duplicate and returns selection to the source", () => {
  const { store } = fixtureStore();
  const original = snapshotOf(store);
  store.dispatch({ op: "duplicateFrame", ...SPLIT });
  assert.equal(store.undoLabel, "duplicate frame · frame 2");
  const undone = store.dispatch({ op: "undoStoryboardEdit" });
  assert.equal(undone.ok, true);
  assert.equal(snapshotOf(store), original);
  assert.equal(store.canUndo, false);
  assert.deepEqual(store.selection.frame, SPLIT);
});

test("edits to the copy leave the source unchanged", () => {
  const { store } = fixtureStore();
  const sourceBefore = JSON.stringify(store.frames()[1]);
  const { operationResult } = store.dispatch({ op: "duplicateFrame", ...SPLIT });
  const copy = store.frames().find((frame) => frame.structureFrameId === operationResult.created.structureFrameId);
  assert.equal(store.dispatch({ op: "placement", frameId: copy.id, panelIndex: 0, zoom: 2, mirrored: true }).changed, true);
  assert.equal(store.dispatch({ op: "setFrameDialogue", ...operationResult.created, dialogueMode: "spoken", speakerPanelId: copy.panels[0].id }).changed, true);
  assert.equal(store.dispatch({ op: "setFrameDialogue", ...operationResult.created, dialogueMode: "silent" }).changed, true);
  assert.equal(JSON.stringify(store.frames()[1]), sourceBefore);
  const edited = store.frames()[2];
  assert.equal(edited.dialogueMode, "silent");
  assert.equal(edited.panels[0].zoom, 2);
});

test("duplicating a directing-beat card clones the whole structural frame and selects the same segment", () => {
  const { store } = fixtureStore();
  const before = store.frames().length;
  const result = store.dispatch({ op: "duplicateFrame", structureFrameId: "fx-frame-6", structureSegmentIndex: 1 });
  assert.equal(result.ok, true);
  assert.equal(store.frames().length, before + 2);
  assert.equal(result.operationResult.created.structureSegmentIndex, 1);
  const raw = frameById(store, result.operationResult.created.structureFrameId);
  assert.equal(raw.segments.length, 2);
});

test("dialogue mode, speaker, zoom, pan, and mirror are each one undoable step", () => {
  const { store } = fixtureStore();
  const split = store.frames()[1];
  const steps = [
    { op: "setFrameDialogue", ...SPLIT, dialogueMode: "silent" },
    { op: "setFrameDialogue", ...SPLIT, dialogueMode: "spoken", speakerPanelId: split.panels[0].id },
    { op: "placement", frameId: split.id, panelIndex: 0, zoom: 1.75 },
    { op: "placement", frameId: split.id, panelIndex: 0, positionX: 30, positionY: 40 },
    { op: "placement", frameId: split.id, panelIndex: 1, mirrored: false },
  ];
  for (const step of steps) {
    const before = snapshotOf(store);
    const result = store.dispatch(step);
    assert.equal(result.ok, true, step.op);
    assert.equal(result.changed, true, JSON.stringify(step));
    assert.notEqual(snapshotOf(store), before);
    store.dispatch({ op: "undoStoryboardEdit" });
    assert.equal(snapshotOf(store), before, `one undo reverts ${JSON.stringify(step)}`);
    store.dispatch(step);
  }
  const frame = store.frames()[1];
  assert.equal(frame.dialogueMode, "spoken");
  assert.equal(frame.speakerPanel, 0);
  assert.deepEqual([frame.panels[0].zoom, frame.panels[0].positionX, frame.panels[0].positionY], [1.75, 30, 40]);
  assert.equal(frame.panels[1].mirrored, false);
});

test("pan keeps zoom and mirror; reset restores the Feature 010 default for that panel only", () => {
  const { store } = fixtureStore();
  const split = store.frames()[1];
  store.dispatch({ op: "placement", frameId: split.id, panelIndex: 1, zoom: 2 });
  store.dispatch({ op: "placement", frameId: split.id, panelIndex: 1, positionX: 10 });
  let panel = store.frames()[1].panels[1];
  assert.deepEqual([panel.zoom, panel.positionX, panel.mirrored], [2, 10, true]);
  store.dispatch({ op: "placement", frameId: split.id, panelIndex: 1, reset: true });
  panel = store.frames()[1].panels[1];
  assert.deepEqual([panel.zoom, panel.positionX, panel.positionY, panel.mirrored], [1, 50, 30, false]);
  assert.equal(store.frames()[1].panels[0].zoom, 1);
});

test("no-op and invalid changes create no undo step", () => {
  const { store } = fixtureStore();
  const split = store.frames()[1];
  assert.equal(store.dispatch({ op: "placement", frameId: split.id, panelIndex: 0, zoom: 1 }).changed, false);
  assert.equal(store.dispatch({ op: "setFrameDialogue", ...SPLIT, dialogueMode: "spoken" }).changed, false);
  assert.equal(store.dispatch({ op: "placement", frameId: split.id, panelIndex: 0, zoom: 4 }).kind, "invalid-request");
  assert.equal(store.dispatch({ op: "setFrameDialogue", structureFrameId: "fx-frame-4", dialogueMode: "spoken" }).kind, "empty-dialogue");
  assert.equal(store.dispatch({ op: "setFrameDialogue", structureFrameId: "fx-frame-5", dialogueMode: "silent" }).kind, "not-dialogue-frame");
  assert.equal(store.dispatch({ op: "setFrameDialogue", structureFrameId: "fx-frame-3", dialogueMode: "spoken" }).kind, "empty-dialogue");
  assert.equal(store.dispatch({ op: "setFrameDialogue", structureFrameId: "fx-frame-3", dialogueMode: "spoken", text: "Ну?" }).kind, "speaker-required");
  assert.equal(store.canUndo, false);
});

test("Reset restores the snapshot after several edits", () => {
  const { store } = fixtureStore();
  const original = snapshotOf(store);
  const split = store.frames()[1];
  store.dispatch({ op: "duplicateFrame", ...SPLIT });
  store.dispatch({ op: "placement", frameId: split.id, panelIndex: 0, zoom: 2.5 });
  store.dispatch({ op: "setFrameDialogue", ...SPLIT, dialogueMode: "hidden" });
  assert.equal(store.dirty, true);
  store.dispatch({ op: "resetToSnapshot" });
  assert.equal(snapshotOf(store), original);
  assert.equal(store.canUndo, false);
});

test("Visual approval holds only while the approved state is unchanged", () => {
  const { model, store } = fixtureStore();
  model.approval.matchesCurrent = true;
  assert.equal(store.visualApproved, true);
  store.dispatch({ op: "duplicateFrame", ...SPLIT });
  assert.equal(store.visualApproved, false);
  store.dispatch({ op: "undoStoryboardEdit" });
  assert.equal(store.visualApproved, true);
});

test("every control goes through one dispatcher; unwired production names explain themselves", () => {
  const { store } = fixtureStore();
  for (const op of ["insertFrame", "deleteFrame", "reorderFrames", "panel-generation", "approveVisual", "future:refineCurrent"]) {
    const result = store.dispatch({ op });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "not-wired");
    assert.equal(result.message, STUBBED_OPERATIONS[op]);
  }
  assert.equal(store.dispatch({ op: "makeItFunnier" }).kind, "invalid-operation");
  assert.equal(store.canUndo, false);
  assert.deepEqual(new Set(store.trace.map((entry) => entry.op)).size, 7);
  for (const op of WIRED_OPERATIONS) assert.equal(Object.hasOwn(STUBBED_OPERATIONS, op), false);
});
