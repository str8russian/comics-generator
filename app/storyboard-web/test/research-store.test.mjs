import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createResearchStore } from "../research-store.mjs";

function nullContext(overrides = {}) {
  return {
    workflowPhase: null,
    storyboardVersionId: null,
    displayFrameNumber: null,
    displayFrameId: null,
    structureFrameId: null,
    structureSegmentIndex: null,
    panelIndex: null,
    panelSubject: null,
    imageAssetId: null,
    generationId: null,
    characterName: null,
    anchorVersionId: null,
    ...overrides,
  };
}

function store() {
  return createResearchStore({ memory: true });
}

test("appendNote lists notes in monotonic seq order", async () => {
  const research = store();
  const first = await research.appendNote({
    submittedText: "первая",
    context: nullContext({ workflowPhase: "structure" }),
  });
  const second = await research.appendNote({
    submittedText: "вторая",
    context: nullContext({ workflowPhase: "visual" }),
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.event.eventKind, "note");
  assert.equal(first.event.semanticAction, "note");
  assert.equal(first.event.surface, "dock_notes");
  assert.equal(first.event.correlationId, null);
  assert.ok(second.event.seq > first.event.seq);
  const listed = await research.listTrace({ kind: "note" });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.events.map((event) => event.submittedText), ["первая", "вторая"]);
});

test("fixed context keys keep explicit nulls and separate display vs structure identity", async () => {
  const research = store();
  const context = nullContext({
    workflowPhase: "visual",
    displayFrameNumber: 3,
    displayFrameId: "display-3",
    structureFrameId: "struct-1",
    structureSegmentIndex: 0,
    panelIndex: 1,
  });
  const saved = await research.appendNote({ submittedText: "контекст", context });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.event.context, context);
  assert.notEqual(saved.event.context.displayFrameId, saved.event.context.structureFrameId);
  for (const key of Object.keys(nullContext())) {
    assert.ok(Object.hasOwn(saved.event.context, key), key);
  }
});

test("one start and one terminal per correlation; terminal derives identity from start", async () => {
  const research = store();
  const correlationId = randomUUID();
  const startContext = nullContext({
    workflowPhase: "structure",
    displayFrameNumber: 2,
    displayFrameId: "d2",
    structureFrameId: "s1",
  });
  const start = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "structure_edit",
    correlationId,
    surface: "dock_commands",
    submittedText: "сделай кадр плотнее",
    commandTarget: {
      kind: "storyboard",
      displayFrameNumber: null,
      displayFrameId: null,
      structureFrameId: null,
      structureSegmentIndex: null,
      panelIndex: null,
      zoom: null,
      positionX: null,
      positionY: null,
      characterName: null,
      anchorVersionId: null,
    },
    editTarget: null,
    context: startContext,
  });
  assert.equal(start.ok, true);

  const terminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    semanticAction: "panel_generate",
    surface: "product_control",
    submittedText: "rewritten after navigation",
    commandTarget: { kind: "panel" },
    editTarget: null,
    context: nullContext({ displayFrameNumber: 99, displayFrameId: "nav", structureFrameId: "nav-s" }),
    outcome: "success",
    outcomeKind: null,
    outcomeFlags: {},
  });
  assert.equal(terminal.ok, true);
  assert.equal(terminal.event.semanticAction, "structure_edit");
  assert.equal(terminal.event.surface, "dock_commands");
  assert.equal(terminal.event.submittedText, "сделай кадр плотнее");
  assert.equal(terminal.event.commandTarget.kind, "storyboard");
  assert.deepEqual(terminal.event.context, startContext);
  assert.equal(typeof terminal.event.durationMs, "number");
  assert.ok(terminal.event.durationMs >= 0);

  const dupStart = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "structure_edit",
    correlationId,
    surface: "dock_commands",
    submittedText: "dup",
    commandTarget: { kind: "storyboard" },
    editTarget: null,
    context: startContext,
  });
  assert.equal(dupStart.ok, false);
  assert.equal(dupStart.kind, "invalid-request");

  const dupTerminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "failure",
    outcomeFlags: {},
  });
  assert.equal(dupTerminal.ok, false);
  assert.equal(dupTerminal.kind, "invalid-request");
});

test("absent-start terminal requires startSnapshot, sets evidenceIncomplete, null duration", async () => {
  const research = store();
  const correlationId = randomUUID();
  const snapshotContext = nullContext({ workflowPhase: "visual", panelIndex: 0 });
  const missing = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "success",
    outcomeFlags: {},
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.kind, "invalid-request");

  const incomplete = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "success",
    outcomeKind: null,
    outcomeFlags: {},
    startSnapshot: {
      semanticAction: "panel_generate",
      surface: "dock_commands",
      submittedText: "перерисуй панель",
      commandTarget: {
        kind: "panel",
        displayFrameNumber: 1,
        displayFrameId: "d1",
        structureFrameId: "s1",
        structureSegmentIndex: null,
        panelIndex: 0,
        zoom: null,
        positionX: null,
        positionY: null,
        characterName: null,
        anchorVersionId: null,
      },
      editTarget: null,
      context: snapshotContext,
    },
  });
  assert.equal(incomplete.ok, true);
  assert.equal(incomplete.event.semanticAction, "panel_generate");
  assert.equal(incomplete.event.surface, "dock_commands");
  assert.equal(incomplete.event.submittedText, "перерисуй панель");
  assert.deepEqual(incomplete.event.context, snapshotContext);
  assert.equal(incomplete.event.durationMs, null);
  assert.equal(incomplete.event.outcomeFlags.evidenceIncomplete, true);
});
