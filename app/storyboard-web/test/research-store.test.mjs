globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
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
    panelId: null,
    transitionMode: null,
    transitionOverlapFrames: null,
    introTemplateId: null,
    introTemplateVersion: null,
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

function storyboardTarget(overrides = {}) {
  return {
    kind: "storyboard",
    displayFrameNumber: null,
    displayFrameId: null,
    structureFrameId: null,
    structureSegmentIndex: null,
    panelIndex: null,
    zoom: null,
    positionX: null,
    positionY: null,
    mirrored: null,
    characterName: null,
    anchorVersionId: null,
    panelId: null,
    ...overrides,
  };
}

async function rejectNote(research, context) {
  const result = await research.appendNote({ submittedText: "ok", context });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "invalid-request");
}

async function rejectStart(research, overrides) {
  const result = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "structure_edit",
    correlationId: randomUUID(),
    surface: "dock_commands",
    submittedText: "ok",
    commandTarget: storyboardTarget(),
    editTarget: null,
    context: nullContext({ workflowPhase: "structure" }),
    ...overrides,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "invalid-request");
}

test("context rejects unknown keys, invalid enums, wrong types, and invalid minima", async () => {
  const research = store();
  await rejectNote(research, nullContext({ workflowPhase: "invented" }));
  await rejectNote(research, nullContext({ displayFrameNumber: "3" }));
  await rejectNote(research, nullContext({ displayFrameNumber: 0 }));
  await rejectNote(research, nullContext({ panelIndex: -1 }));
  await rejectNote(research, { ...nullContext(), extra: true });
});

test("commandTarget rejects invalid kind, types, minima, and unknown keys", async () => {
  const research = store();
  await rejectStart(research, { commandTarget: storyboardTarget({ kind: "invented" }) });
  await rejectStart(research, { commandTarget: storyboardTarget({ panelIndex: "0" }) });
  await rejectStart(research, { commandTarget: storyboardTarget({ displayFrameNumber: 0 }) });
  await rejectStart(research, { commandTarget: { ...storyboardTarget(), unknown: 1 } });
});

test("editTarget rejects invalid enums, types, and unknown keys", async () => {
  const research = store();
  const castStart = {
    eventKind: "action_start",
    semanticAction: "cast_edit",
    correlationId: randomUUID(),
    surface: "product_control",
    submittedText: "Песков",
    commandTarget: null,
    editTarget: {
      editKind: "speaker_assignment",
      castPhase: "pending_reading",
      characterName: "Песков",
      previousCharacterName: null,
      surfaceForm: null,
      sourceItemId: "u1",
    },
    context: nullContext({ workflowPhase: "material" }),
  };
  const badKind = await research.appendEvent({
    ...castStart,
    editTarget: { ...castStart.editTarget, editKind: "invented" },
  });
  assert.equal(badKind.ok, false);
  assert.equal(badKind.kind, "invalid-request");

  const badPhase = await research.appendEvent({
    ...castStart,
    correlationId: randomUUID(),
    editTarget: { ...castStart.editTarget, castPhase: "invented" },
  });
  assert.equal(badPhase.ok, false);
  assert.equal(badPhase.kind, "invalid-request");

  const badType = await research.appendEvent({
    ...castStart,
    correlationId: randomUUID(),
    editTarget: { ...castStart.editTarget, characterName: 1 },
  });
  assert.equal(badType.ok, false);
  assert.equal(badType.kind, "invalid-request");

  const unknown = await research.appendEvent({
    ...castStart,
    correlationId: randomUUID(),
    editTarget: { ...castStart.editTarget, dump: "no" },
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.kind, "invalid-request");
});

test("outcomeKind accepts only compact safe codes and never echoes secret-like values", async () => {
  const research = store();
  const correlationId = randomUUID();
  const start = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "structure_edit",
    correlationId,
    surface: "product_control",
    submittedText: null,
    commandTarget: storyboardTarget(),
    editTarget: null,
    context: nullContext({ workflowPhase: "structure" }),
  });
  assert.equal(start.ok, true);

  const secret = "Bearer fake-secret-token-value";
  const secretTerminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "failure",
    outcomeKind: secret,
    outcomeFlags: {},
  });
  assert.equal(secretTerminal.ok, false);
  assert.equal(secretTerminal.kind, "invalid-request");
  assert.equal(JSON.stringify(secretTerminal).includes(secret), false);

  const tooLong = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "failure",
    outcomeKind: "a".repeat(65),
    outcomeFlags: {},
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.kind, "invalid-request");

  const okKind = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "failure",
    outcomeKind: "provider",
    outcomeFlags: {},
  });
  assert.equal(okKind.ok, true);
  assert.equal(okKind.event.outcomeKind, "provider");
});

test("evidenceIncomplete is server-derived from start presence", async () => {
  const research = store();
  const pairedId = randomUUID();
  assert.equal((await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "structure_edit",
    correlationId: pairedId,
    surface: "dock_commands",
    submittedText: "x",
    commandTarget: storyboardTarget(),
    editTarget: null,
    context: nullContext({ workflowPhase: "structure" }),
  })).ok, true);

  const paired = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId: pairedId,
    outcome: "success",
    outcomeFlags: { evidenceIncomplete: true },
  });
  assert.equal(paired.ok, true);
  assert.notEqual(paired.event.outcomeFlags.evidenceIncomplete, true);

  const incompleteId = randomUUID();
  const incomplete = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId: incompleteId,
    outcome: "success",
    outcomeFlags: { evidenceIncomplete: false },
    startSnapshot: {
      semanticAction: "structure_edit",
      surface: "dock_commands",
      submittedText: "snap",
      commandTarget: storyboardTarget(),
      editTarget: null,
      context: nullContext({ workflowPhase: "structure" }),
    },
  });
  assert.equal(incomplete.ok, true);
  assert.equal(incomplete.event.outcomeFlags.evidenceIncomplete, true);
});

test("memory store requires explicit { memory: true }; invalid pools fail configuration", () => {
  assert.throws(() => createResearchStore(), { kind: "configuration" });
  assert.throws(() => createResearchStore({}), { kind: "configuration" });
  assert.throws(() => createResearchStore({ query() {} }), { kind: "configuration" });
  const memory = createResearchStore({ memory: true });
  assert.equal(typeof memory.appendNote, "function");
});

function castEditTarget(overrides = {}) {
  return {
    editKind: "character_rename",
    castPhase: "pending_reading",
    characterName: "А",
    previousCharacterName: "Б",
    surfaceForm: null,
    sourceItemId: null,
    ...overrides,
  };
}

test("cast_edit starts reject non-product_control surfaces and add no rows", async () => {
  const research = store();
  for (const surface of ["dock_commands", "dock_notes"]) {
    const before = await research.listTrace();
    const rejected = await research.appendEvent({
      eventKind: "action_start",
      semanticAction: "cast_edit",
      correlationId: randomUUID(),
      surface,
      submittedText: "А",
      commandTarget: null,
      editTarget: castEditTarget(),
      context: nullContext({ workflowPhase: "material" }),
    });
    assert.equal(rejected.ok, false, surface);
    assert.equal(rejected.kind, "invalid-request", surface);
    const after = await research.listTrace();
    assert.equal(after.events.length, before.events.length, surface);
  }
});

test("cast_edit startSnapshot with non-product_control surface is rejected", async () => {
  const research = store();
  const before = await research.listTrace();
  const rejected = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId: randomUUID(),
    outcome: "success",
    outcomeFlags: {},
    startSnapshot: {
      semanticAction: "cast_edit",
      surface: "dock_commands",
      submittedText: "А",
      commandTarget: null,
      editTarget: castEditTarget(),
      context: nullContext({ workflowPhase: "material" }),
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, "invalid-request");
  const after = await research.listTrace();
  assert.equal(after.events.length, before.events.length);
});

test("valid cast_edit on product_control is accepted", async () => {
  const research = store();
  const correlationId = randomUUID();
  const start = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "cast_edit",
    correlationId,
    surface: "product_control",
    submittedText: "А",
    commandTarget: null,
    editTarget: castEditTarget(),
    context: nullContext({ workflowPhase: "material" }),
  });
  assert.equal(start.ok, true);
  assert.equal(start.event.surface, "product_control");
  assert.equal(start.event.semanticAction, "cast_edit");

  const terminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "success",
    outcomeFlags: {},
  });
  assert.equal(terminal.ok, true);
  assert.equal(terminal.event.surface, "product_control");
  assert.equal(terminal.event.semanticAction, "cast_edit");
});

test("T023 baseline: navigation rewrite on terminal is ignored; unmatched start remains extractable non-running evidence", async () => {
  const research = store();
  const correlationId = randomUUID();
  const startContext = nullContext({
    workflowPhase: "structure",
    displayFrameNumber: 1,
    displayFrameId: "display-1",
    structureFrameId: "structure-1",
    structureSegmentIndex: 0,
  });
  const start = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "panel_generate",
    correlationId,
    surface: "product_control",
    submittedText: "frozen panel instruction",
    commandTarget: {
      kind: "panel",
      displayFrameNumber: 1,
      displayFrameId: "display-1",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      panelIndex: 0,
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

  const unmatchedId = randomUUID();
  assert.equal((await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "frame_generate",
    correlationId: unmatchedId,
    surface: "product_control",
    submittedText: null,
    commandTarget: {
      kind: "frame",
      displayFrameNumber: 2,
      displayFrameId: "display-2",
      structureFrameId: "structure-2",
      structureSegmentIndex: 1,
      panelIndex: null,
      zoom: null,
      positionX: null,
      positionY: null,
      characterName: null,
      anchorVersionId: null,
    },
    editTarget: null,
    context: nullContext({ displayFrameId: "display-2", structureFrameId: "structure-2" }),
  })).ok, true);

  const terminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    semanticAction: "structure_edit",
    surface: "dock_commands",
    submittedText: "rewritten",
    commandTarget: { kind: "storyboard" },
    editTarget: null,
    context: nullContext({ displayFrameId: "navigated", structureFrameId: "navigated-s" }),
    outcome: "success",
    outcomeFlags: {},
  });
  assert.equal(terminal.ok, true);
  assert.equal(terminal.event.semanticAction, "panel_generate");
  assert.equal(terminal.event.surface, "product_control");
  assert.equal(terminal.event.submittedText, "frozen panel instruction");
  assert.equal(terminal.event.commandTarget.kind, "panel");
  assert.equal(terminal.event.commandTarget.structureSegmentIndex, 0);
  assert.deepEqual(terminal.event.context, startContext);
  assert.equal(typeof terminal.event.durationMs, "number");

  const listed = await research.listTrace();
  assert.equal(listed.ok, true);
  const unmatched = listed.events.find((event) => (
    event.eventKind === "action_start" && event.correlationId === unmatchedId
  ));
  assert.ok(unmatched);
  assert.equal(listed.events.some((event) => (
    event.eventKind === "action_terminal" && event.correlationId === unmatchedId
  )), false);

  const { projectOperations } = await import("../public/research-dock.mjs");
  const projection = projectOperations({ live: null, events: listed.events });
  assert.equal(projection.some((item) => item.status === "running"), false);
  assert.equal(projection.some((item) => (
    item.correlationId === unmatchedId && (item.historical === true || item.status === "interrupted")
  )), true);
});

test("frame dialogue records the mode transition and not the line", async () => {
  const research = store();
  const correlationId = randomUUID();
  const commandTarget = {
    kind: "frame",
    displayFrameNumber: 1,
    displayFrameId: "frame-1",
    structureFrameId: "frame-1",
    structureSegmentIndex: null,
    panelIndex: null,
    zoom: null,
    positionX: null,
    positionY: null,
    characterName: null,
    anchorVersionId: null,
    panelId: "left",
  };
  const start = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "frame_dialogue",
    correlationId,
    surface: "product_control",
    submittedText: null,
    commandTarget,
    editTarget: null,
    context: nullContext({ structureFrameId: "frame-1", panelId: "left" }),
  });
  assert.equal(start.ok, true);
  const terminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "success",
    outcomeFlags: { dialogueMode: "silent", previousDialogueMode: "spoken" },
  });
  assert.equal(terminal.ok, true);
  assert.equal(terminal.event.semanticAction, "frame_dialogue");
  assert.equal(terminal.event.submittedText, null);
  assert.deepEqual(terminal.event.outcomeFlags, {
    dialogueMode: "silent",
    previousDialogueMode: "spoken",
  });
  assert.equal(JSON.stringify(terminal.event).includes("Привет"), false);
  const rejected = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId: randomUUID(),
    outcome: "success",
    outcomeFlags: { dialogueMode: "Привет" },
  });
  assert.equal(rejected.ok, false);
});
