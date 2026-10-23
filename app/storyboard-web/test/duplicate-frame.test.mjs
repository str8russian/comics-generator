import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { applyOperation } from "../assembly.mjs";
import { createResearchStore } from "../research-store.mjs";
import { projectOperations } from "../public/research-dock.mjs";

let serial = 0;
const ids = () => {
  serial += 1;
  return `id-${serial}`;
};

function panelIds(frame) {
  const found = [];
  const visit = (node) => {
    for (const panel of node?.panels || []) found.push(panel.id);
    for (const segment of node?.segments || []) visit(segment);
  };
  visit(frame);
  return found;
}

function spokenSplit() {
  return {
    id: "frame-1",
    layout: "split2",
    origin: "source",
    frameKind: "image",
    dialogueMode: "spoken",
    dialogue: "Привет",
    speakerPanel: 1,
    dormantSpeakerPanelId: "right",
    durationFrames: 120,
    sourceItemId: "item-1",
    sourceRole: "utterance",
    displayBlock: { sourceItemId: "item-1", start: 0, end: 6 },
    futureMarker: { keep: "yes" },
    panels: [
      {
        id: "left",
        description: "Левая речь",
        ownerDescription: "заметка слева",
        manualSubject: "Аня",
        panelMarker: "left-keep",
      },
      {
        id: "right",
        description: "Правая реакция",
        ownerDescription: "заметка справа",
        manualSubject: "Боря",
        panelMarker: "right-keep",
      },
    ],
  };
}

function neighbor() {
  return {
    id: "frame-2",
    layout: "single",
    origin: "derived",
    frameKind: "image",
    dialogueMode: "hidden",
    dialogue: "",
    durationFrames: 36,
    panels: [{ id: "solo", description: "Сосед", manualSubject: "Аня" }],
  };
}

test("ordinary single and split frames duplicate immediately after the source", () => {
  const original = [spokenSplit(), neighbor()];
  const split = applyOperation(original, {
    op: "duplicateFrame",
    structureFrameId: "frame-1",
    structureSegmentIndex: null,
    displayFrameNumber: 4,
  }, { idFactory: ids });
  assert.equal(split.ok, true);
  assert.equal(split.mode, "version");
  assert.deepEqual(split.frames.map((frame) => frame.id), ["frame-1", split.frameId, "frame-2"]);
  assert.notEqual(split.frameId, "frame-1");
  assert.equal(original[0].id, "frame-1");
  assert.equal(original[0].panels[0].id, "left");
  assert.equal(original.length, 2);

  const copy = split.frames[1];
  const source = split.frames[0];
  assert.equal(source.id, "frame-1");
  assert.deepEqual(source.panels.map((panel) => panel.id), ["left", "right"]);
  assert.equal(split.frames[2].id, "frame-2");
  assert.deepEqual(panelIds(copy).filter((id) => ["left", "right", "solo"].includes(id)), []);
  assert.equal(new Set([copy.id, ...panelIds(copy)]).size, 1 + panelIds(copy).length);
  assert.equal(copy.layout, "split2");
  assert.equal(copy.frameKind, "image");
  assert.equal(copy.dialogueMode, "spoken");
  assert.equal(copy.dialogue, "Привет");
  assert.equal(copy.speakerPanel, 1);
  assert.equal(copy.dormantSpeakerPanelId, copy.panels[1].id);
  assert.notEqual(copy.dormantSpeakerPanelId, "right");
  assert.equal(copy.durationFrames, 120);
  assert.equal(copy.sourceItemId, "item-1");
  assert.equal(copy.sourceRole, "utterance");
  assert.deepEqual(copy.displayBlock, { sourceItemId: "item-1", start: 0, end: 6 });
  assert.deepEqual(copy.futureMarker, { keep: "yes" });
  assert.deepEqual(copy.panels.map((panel) => panel.description), ["Левая речь", "Правая реакция"]);
  assert.deepEqual(copy.panels.map((panel) => panel.ownerDescription), ["заметка слева", "заметка справа"]);
  assert.deepEqual(copy.panels.map((panel) => panel.manualSubject), ["Аня", "Боря"]);
  assert.deepEqual(copy.panels.map((panel) => panel.panelMarker), ["left-keep", "right-keep"]);
  assert.equal(split.duplicate.source.structureFrameId, "frame-1");
  assert.equal(split.duplicate.source.structureSegmentIndex, null);
  assert.equal(split.duplicate.created.structureFrameId, copy.id);
  assert.equal(copy.panels[0].id, split.duplicate.panelCopies[0].panelId);
  assert.equal(split.duplicate.panelCopies[0].sourcePanelId, "left");
  assert.equal(split.duplicate.panelCopies[0].frameId, copy.id);
  assert.equal(split.duplicate.panelCopies[1].sourcePanelId, "right");

  const single = applyOperation([neighbor(), spokenSplit()], {
    op: "duplicateFrame",
    structureFrameId: "frame-2",
  }, { idFactory: ids });
  assert.equal(single.ok, true);
  assert.deepEqual(single.frames.map((frame) => frame.id), ["frame-2", single.frameId, "frame-1"]);
  assert.equal(single.frames[1].layout, "single");
  assert.equal(single.frames[1].dialogueMode, "hidden");
  assert.equal(single.frames[1].panels.length, 1);
  assert.notEqual(single.frames[1].panels[0].id, "solo");
  assert.equal(single.frames[1].panels[0].description, "Сосед");
  assert.equal(single.frames[2].panels[1].id, "right");
});

test("a text card duplicates text and duration and invents no panels", () => {
  const card = {
    id: "card-1",
    layout: "single",
    origin: "derived",
    frameKind: "text",
    textCard: "Пауза",
    dialogue: "",
    durationFrames: 48,
    futureMarker: "card",
    panels: [],
  };
  const result = applyOperation([spokenSplit(), card], {
    op: "duplicateFrame",
    structureFrameId: "card-1",
  }, { idFactory: ids });
  assert.equal(result.ok, true);
  assert.equal(result.frames[1].id, "card-1");
  assert.equal(result.frames[2].id, result.frameId);
  assert.equal(result.frames[2].frameKind, "text");
  assert.equal(result.frames[2].textCard, "Пауза");
  assert.equal(result.frames[2].durationFrames, 48);
  assert.equal(result.frames[2].futureMarker, "card");
  assert.deepEqual(result.frames[2].panels, []);
  assert.equal(Object.hasOwn(result.frames[2], "dialogueMode"), false);
  assert.deepEqual(result.duplicate.panelCopies, []);
  assert.equal(result.frames[0].id, "frame-1");
});

test("a compound directing beat duplicates as one structural node", () => {
  const beat = {
    id: "beat",
    directingBeat: true,
    origin: "source",
    sourceItemId: "item-9",
    sourceRole: "utterance",
    dialogue: "Раз.Два.",
    futureMarker: { beat: true },
    segments: [
      {
        quote: "Раз.",
        layout: "split2",
        dialogueMode: "spoken",
        speakerPanel: 0,
        dormantSpeakerPanelId: "a",
        durationFrames: 80,
        start: 0,
        end: 4,
        panels: [
          { id: "a", description: "А", manualSubject: "Аня", ownerDescription: "первая" },
          { id: "b", description: "Б", manualSubject: "Боря" },
        ],
      },
      {
        quote: "Два.",
        layout: "single",
        dialogueMode: "silent",
        speakerPanel: null,
        dormantSpeakerPanelId: "c",
        durationFrames: 36,
        start: 4,
        end: 8,
        panels: [{ id: "c", description: "В", ownerDescription: "тишина" }],
      },
    ],
  };
  const original = structuredClone(beat);
  const result = applyOperation([neighbor(), beat, spokenSplit()], {
    op: "duplicateFrame",
    structureFrameId: "beat",
    structureSegmentIndex: 1,
  }, { idFactory: ids });
  assert.equal(result.ok, true);
  assert.deepEqual(result.frames.map((frame) => frame.id), ["frame-2", "beat", result.frameId, "frame-1"]);
  assert.deepEqual(result.frames[1], original);
  const copy = result.frames[2];
  assert.equal(copy.directingBeat, true);
  assert.equal(copy.segments.length, 2);
  assert.equal(copy.dialogue, "Раз.Два.");
  assert.equal(copy.sourceItemId, "item-9");
  assert.deepEqual(copy.futureMarker, { beat: true });
  assert.deepEqual(copy.segments.map((segment) => segment.quote), ["Раз.", "Два."]);
  assert.equal(copy.segments[0].layout, "split2");
  assert.equal(copy.segments[0].dialogueMode, "spoken");
  assert.equal(copy.segments[0].speakerPanel, 0);
  assert.equal(copy.segments[0].dormantSpeakerPanelId, copy.segments[0].panels[0].id);
  assert.notEqual(copy.segments[0].panels[0].id, "a");
  assert.notEqual(copy.segments[0].panels[1].id, "b");
  assert.equal(copy.segments[0].panels[0].description, "А");
  assert.equal(copy.segments[0].panels[0].manualSubject, "Аня");
  assert.equal(copy.segments[0].durationFrames, 80);
  assert.equal(copy.segments[1].dialogueMode, "silent");
  assert.equal(copy.segments[1].speakerPanel, null);
  assert.equal(copy.segments[1].dormantSpeakerPanelId, copy.segments[1].panels[0].id);
  assert.notEqual(copy.segments[1].panels[0].id, "c");
  assert.equal(copy.segments[1].panels[0].ownerDescription, "тишина");
  assert.deepEqual(
    result.duplicate.panelCopies.map((entry) => entry.frameId),
    [`${copy.id}#1`, `${copy.id}#1`, `${copy.id}#2`],
  );
  assert.equal(result.duplicate.created.structureSegmentIndex, 1);
  assert.equal(result.duplicate.source.structureSegmentIndex, 1);
  assert.deepEqual(result.frames[3].panels.map((panel) => panel.id), ["left", "right"]);
});

test("a stale or invalid source address fails without changing the input", () => {
  const original = [spokenSplit()];
  const stale = applyOperation(original, {
    op: "duplicateFrame",
    structureFrameId: "missing",
  }, { idFactory: ids });
  assert.equal(stale.ok, false);
  assert.equal(stale.kind, "frame-not-found");
  assert.equal(original.length, 1);
  assert.equal(original[0].panels[0].id, "left");

  const invalid = [{ id: "frame-1", layout: "single", panels: "not-panels", dialogue: "Привет" }];
  const rejected = applyOperation(invalid, {
    op: "duplicateFrame",
    structureFrameId: "frame-1",
  }, { idFactory: ids });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, "invalid-request");
  assert.equal(invalid[0].panels, "not-panels");
  assert.equal(invalid[0].dialogue, "Привет");
});

test("later edits of the duplicate do not modify the source", () => {
  const duplicated = applyOperation([spokenSplit(), neighbor()], {
    op: "duplicateFrame",
    structureFrameId: "frame-1",
  }, { idFactory: ids });
  assert.equal(duplicated.ok, true);
  const sourceBefore = structuredClone(duplicated.frames[0]);
  const copy = duplicated.frames[1];
  const noted = applyOperation(duplicated.frames, {
    op: "setOwnerDescription",
    panelId: copy.panels[0].id,
    ownerDescription: "только копия",
  }, { idFactory: ids });
  assert.equal(noted.ok, true);
  assert.deepEqual(noted.frames[0], sourceBefore);
  assert.equal(noted.frames[1].panels[0].ownerDescription, "только копия");
  assert.equal(noted.frames[0].panels[0].ownerDescription, "заметка слева");

  const silenced = applyOperation(noted.frames, {
    op: "setFrameDialogue",
    structureFrameId: copy.id,
    dialogueMode: "silent",
  }, { idFactory: ids });
  assert.equal(silenced.ok, true);
  assert.equal(silenced.frames[1].dialogueMode, "silent");
  assert.equal(silenced.frames[0].dialogueMode, "spoken");
  assert.equal(silenced.frames[0].dialogue, "Привет");
  assert.equal(silenced.frames[0].speakerPanel, 1);

  const removed = applyOperation(silenced.frames, {
    op: "deleteFrame",
    structureFrameId: copy.id,
  }, { idFactory: ids });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.frames.map((frame) => frame.id), ["frame-1", "frame-2"]);
  assert.equal(removed.frames[0].panels[1].id, "right");
});

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

test("frame_duplicate trace keeps the source and adds the created address on success", async () => {
  const research = createResearchStore({ memory: true });
  const correlationId = randomUUID();
  const start = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "frame_duplicate",
    correlationId,
    surface: "product_control",
    submittedText: null,
    commandTarget: {
      kind: "frame",
      displayFrameNumber: 2,
      displayFrameId: "display-2",
      structureFrameId: "source-frame",
      structureSegmentIndex: 1,
    },
    editTarget: null,
    context: nullContext({
      workflowPhase: "visual",
      displayFrameNumber: 2,
      displayFrameId: "display-2",
      structureFrameId: "source-frame",
      structureSegmentIndex: 1,
    }),
  });
  assert.equal(start.ok, true);
  assert.equal(start.event.context.structureFrameId, "source-frame");
  assert.equal(start.event.context.createdStructureFrameId, undefined);

  const terminal = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId,
    outcome: "success",
    outcomeFlags: {},
    resultContext: {
      createdStructureFrameId: "frame-copy",
      createdDisplayFrameId: "frame-copy#2",
      createdDisplayFrameNumber: 4,
      createdStructureSegmentIndex: 1,
    },
  });
  assert.equal(terminal.ok, true);
  assert.equal(terminal.event.semanticAction, "frame_duplicate");
  assert.equal(terminal.event.context.structureFrameId, "source-frame");
  assert.equal(terminal.event.context.structureSegmentIndex, 1);
  assert.equal(terminal.event.context.displayFrameNumber, 2);
  assert.equal(terminal.event.context.createdStructureFrameId, "frame-copy");
  assert.equal(terminal.event.context.createdDisplayFrameId, "frame-copy#2");
  assert.equal(terminal.event.context.createdDisplayFrameNumber, 4);
  assert.equal(terminal.event.context.createdStructureSegmentIndex, 1);
  assert.equal(terminal.event.outcome, "success");

  const failedId = randomUUID();
  const failedStart = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "frame_duplicate",
    correlationId: failedId,
    surface: "product_control",
    commandTarget: { kind: "frame", structureFrameId: "source-frame", displayFrameNumber: 2 },
    context: nullContext({ structureFrameId: "source-frame", displayFrameNumber: 2 }),
  });
  assert.equal(failedStart.ok, true);
  const failed = await research.appendEvent({
    eventKind: "action_terminal",
    correlationId: failedId,
    outcome: "failure",
    outcomeKind: "frame-not-found",
    outcomeFlags: {},
    resultContext: { createdStructureFrameId: "should-not-stick" },
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.event.outcome, "failure");
  assert.equal(failed.event.context.createdStructureFrameId, undefined);

  const prior = await research.appendEvent({
    eventKind: "action_start",
    semanticAction: "frame_insert",
    correlationId: randomUUID(),
    surface: "product_control",
    commandTarget: { kind: "frame" },
    context: nullContext(),
  });
  assert.equal(prior.ok, true);

  const projection = projectOperations({
    events: [start.event, terminal.event],
  });
  const success = projection.find((item) => item.status === "success");
  assert.ok(success);
  assert.equal(success.semanticAction, "frame_duplicate");
  assert.match(success.label, /frame_duplicate/);
  assert.match(success.label, /source-frame/);
  assert.match(success.label, /frame-copy/);
  assert.match(success.label, /кадр 2/);
  assert.match(success.label, /кадр 4/);
});
