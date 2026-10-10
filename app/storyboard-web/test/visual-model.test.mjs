import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorPrompt,
  aspectRatioForFrame,
  assembleAnchorReferences,
  assemblePanelReferences,
  compilePanelReadyIntent,
  compilePanelReadyPrompt,
  expandStoryboardFrames,
  isEligiblePanelReadyDialogueFrame,
  panelPrompt,
  resolvePanelSubject,
} from "../visual-model.mjs";

const characters = [{ name: "Путин" }, { name: "Дуров" }, { name: "Песков" }];
const aliases = [{ surface: "Дмитрий Сергеевич", characterName: "Песков" }];

function eligibleDialogueFrame(overrides = {}) {
  return {
    id: "f1",
    layout: "split2",
    dialogue: "Привет.",
    speakerPanel: 0,
    sourceRole: "utterance",
    panels: [
      { description: "Путин спокойно слушает" },
      { description: "Дуров отвечает" },
    ],
    ...overrides,
  };
}

function panelReadyPrompt(overrides = {}) {
  const frame = overrides.frame || eligibleDialogueFrame();
  const panelIndex = overrides.panelIndex ?? 0;
  const intent = compilePanelReadyIntent({
    frame,
    panelIndex,
    characterName: overrides.characterName ?? "Путин",
    description: overrides.description ?? frame.panels[panelIndex].description,
    instruction: overrides.instruction ?? "",
    hasPerformance: overrides.hasPerformance ?? false,
  });
  return compilePanelReadyPrompt(intent, {
    hasPrevious: overrides.hasPrevious ?? false,
    hasPerformance: overrides.hasPerformance ?? false,
    hasStyle: overrides.hasStyle ?? true,
    identityAlsoStyle: overrides.identityAlsoStyle ?? false,
    previousDropped: overrides.previousDropped ?? false,
  });
}

test("panel subject follows the earliest character surface and understands an alias", () => {
  assert.equal(resolvePanelSubject("Путин смотрит на Дурова", characters, aliases), "Путин");
  assert.equal(resolvePanelSubject("Дуров напротив Путина", characters, aliases), "Дуров");
  assert.equal(resolvePanelSubject("Проснувшийся Дмитрий Сергеевич в панике", characters, aliases), "Песков");
  assert.equal(resolvePanelSubject("Пустой кабинет", characters, aliases), null);
});

test("prompts keep identity, performance, and style authority separate", () => {
  const anchor = anchorPrompt({ characterName: "Песков", identityComment: "less realistic", instruction: "heavier contour", hasPrevious: true, hasStyle: true });
  assert.match(anchor, /real identity reference/);
  assert.match(anchor, /previous anchor candidate/);
  assert.match(anchor, /project style anchor/);
  assert.match(anchor, /sole authority for rendering language/);
  assert.match(anchor, /do not preserve its rendering language/);
  const panel = panelPrompt({
    characterName: "Песков",
    description: "Песков просыпается в панике",
    instruction: "eyes wider",
    layout: "single",
    panelIndex: 0,
    speakerPanel: 0,
    hasPrevious: true,
    hasPerformance: true,
    hasStyle: false,
  });
  assert.match(panel, /performance reference/);
  assert.match(panel, /never identity/);
  assert.match(panel, /eyes wider/);
});

test("anchor reference assembly keeps identity first and style when distinct", () => {
  const identity = { id: "id-1", mime: "image/png" };
  const previous = { id: "prev-1", mime: "image/png" };
  const style = { id: "style-1", mime: "image/png" };
  const first = assembleAnchorReferences({ identity, style });
  assert.deepEqual([...first.roles], ["identity", "style"]);
  assert.equal(first.hasStyle, true);
  const revision = assembleAnchorReferences({ identity, previous, style });
  assert.deepEqual([...revision.roles], ["identity", "previous", "style"]);
  assert.equal(revision.hasPrevious, true);
  assert.equal(revision.hasStyle, true);
  const seedRevision = assembleAnchorReferences({
    identity,
    previous: style,
    style,
  });
  assert.deepEqual([...seedRevision.roles], ["identity", "previous"]);
  assert.equal(seedRevision.hasStyle, true);
  assert.equal(seedRevision.styleDropped, false);
});

test("panel reference assembly never drops identity for style under the three-image limit", () => {
  const assembled = assemblePanelReferences({
    anchor: { id: "anchor" },
    previous: { id: "prev" },
    performance: { id: "perf" },
    style: { id: "style" },
    panelReady: true,
  });
  assert.ok(assembled.roles.has("anchor"));
  assert.ok(assembled.roles.has("style"));
  assert.ok(assembled.roles.has("performance"));
  assert.equal(assembled.roles.has("previous"), false);
  assert.equal(assembled.previousDropped, true);
  assert.deepEqual(assembled.images.map((image) => image.id), ["anchor", "style", "perf"]);
  assert.equal(assembled.hasStyle, true);
  assert.equal(assembled.hasPrevious, false);
});

test("historical panel reference assembly keeps previous before performance and style", () => {
  const assembled = assemblePanelReferences({
    anchor: { id: "anchor" },
    previous: { id: "prev" },
    performance: { id: "perf" },
    style: { id: "style" },
  });
  assert.deepEqual(assembled.images.map((image) => image.id), ["anchor", "prev", "perf"]);
  assert.deepEqual([...assembled.roles], ["anchor", "previous", "performance"]);
  assert.equal(assembled.hasPrevious, true);
  assert.equal(assembled.hasPerformance, true);
  assert.equal(assembled.hasStyle, false);
  assert.equal(assembled.previousDropped, false);
});

test("isEligiblePanelReadyDialogueFrame accepts ordinary dialogue split2 only", () => {
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame()), true);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ speakerPanel: 1 })), true);

  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ layout: "single", panels: [{ description: "Один" }] })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ sourceRole: "action", dialogue: "" })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ dialogue: "" })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ dialogue: "   " })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ speakerPanel: null })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ speakerPanel: 2 })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({ panels: [{ description: "Только один" }] })), false);
  assert.equal(isEligiblePanelReadyDialogueFrame(eligibleDialogueFrame({
    panels: [{ description: "A" }, { description: "B" }, { description: "C" }],
  })), false);
});

test("panel-ready compiler states side, speaking role, uniform background, crop, and prohibitions", () => {
  const leftSpeaking = panelReadyPrompt({ panelIndex: 0, characterName: "Путин" });
  assert.match(leftSpeaking, /left/i);
  assert.match(leftSpeaking, /speaking/i);
  assert.match(leftSpeaking, /uniform/i);
  assert.match(leftSpeaking, /non-scenic|plain/i);
  assert.match(leftSpeaking, /chest-up/i);
  assert.match(leftSpeaking, /crop/i);
  assert.match(leftSpeaking, /no additional people|no other people|exactly one/i);
  assert.match(leftSpeaking, /nested panel/i);
  assert.match(leftSpeaking, /split/i);
  assert.match(leftSpeaking, /border/i);
  assert.match(leftSpeaking, /caption/i);
  assert.match(leftSpeaking, /speech bubble|dialogue bubble/i);
  assert.match(leftSpeaking, /logo/i);
  assert.match(leftSpeaking, /watermark/i);
  assert.match(leftSpeaking, /text/i);
  assert.match(leftSpeaking, /unwanted|no .*object/i);
  assert.equal(/one side of a two-panel split screen/i.test(leftSpeaking), false);
  assert.equal(/finished comic|comic page|assembled frame|split-screen comic/i.test(leftSpeaking), false);

  const rightListening = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров слушает",
  });
  assert.match(rightListening, /right/i);
  assert.match(rightListening, /listening|reaction/i);
});

test("panel-ready gaze fallback applies only when no explicit direction or performance staging", () => {
  const fallbackLeft = panelReadyPrompt({ panelIndex: 0, description: "Путин спокойно слушает" });
  assert.match(fallbackLeft, /screen-right/i);
  assert.equal(/screen-left/i.test(fallbackLeft), false);

  const fallbackRight = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров отвечает",
  });
  assert.match(fallbackRight, /screen-left/i);
  assert.equal(/screen-right/i.test(fallbackRight), false);

  const descriptionDirection = panelReadyPrompt({
    panelIndex: 0,
    description: "Путин смотрит screen-left на дверь",
  });
  assert.equal(/subtle screen-right|gaze .*screen-right|look .*screen-right/i.test(descriptionDirection), false);

  const revisionDirection = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров отвечает",
    instruction: "look screen-right instead",
  });
  assert.equal(/subtle screen-left|gaze .*screen-left|look .*screen-left/i.test(revisionDirection), false);

  const withPerformance = panelReadyPrompt({
    panelIndex: 0,
    description: "Путин спокойно слушает",
    hasPerformance: true,
  });
  assert.match(withPerformance, /performance reference/i);
  assert.equal(/subtle screen-right|gaze .*screen-right/i.test(withPerformance), false);
  assert.match(withPerformance, /pose|expression|gaze|head/i);
});

test("panel reference assembly prefers identity style performance and drops previous first", () => {
  const full = assemblePanelReferences({
    anchor: { id: "anchor" },
    previous: { id: "prev" },
    performance: { id: "perf" },
    style: { id: "style" },
    panelReady: true,
  });
  assert.deepEqual([...full.roles], ["anchor", "style", "performance"]);
  assert.equal(full.previousDropped, true);
  assert.equal(full.hasPrevious, false);

  const withPreviousSlot = assemblePanelReferences({
    anchor: { id: "anchor" },
    previous: { id: "prev" },
    performance: null,
    style: { id: "style" },
    panelReady: true,
  });
  assert.deepEqual([...withPreviousSlot.roles], ["anchor", "style", "previous"]);
  assert.equal(withPreviousSlot.previousDropped, false);
  assert.equal(withPreviousSlot.hasPrevious, true);

  const sameIdentityStyle = assemblePanelReferences({
    anchor: { id: "shared" },
    previous: { id: "prev" },
    performance: { id: "perf" },
    style: { id: "shared" },
    panelReady: true,
  });
  assert.deepEqual(sameIdentityStyle.images.map((image) => image.id), ["shared", "perf", "prev"]);
  assert.equal(sameIdentityStyle.hasStyle, true);
  assert.equal(sameIdentityStyle.previousDropped, false);

  const promptWithoutPrevious = panelReadyPrompt({
    hasPrevious: false,
    previousDropped: true,
    hasStyle: true,
    hasPerformance: true,
  });
  assert.match(promptWithoutPrevious, /Image 1 is the approved identity anchor/);
  assert.match(promptWithoutPrevious, /Image 2 is the project style anchor/);
  assert.match(promptWithoutPrevious, /Image 3 is the performance reference/);
  assert.equal(/previous (result|candidate|reference)/i.test(promptWithoutPrevious), false);
  assert.equal(/preserve .*previous|continuity from .*previous/i.test(promptWithoutPrevious), false);
});

test("single and split panels request panel-compatible aspect ratios", () => {
  assert.equal(aspectRatioForFrame({ layout: "single", panels: [{}] }), "21:9");
  assert.equal(aspectRatioForFrame({ layout: "split2", panels: [{}, {}] }), "5:4");
});

test("directing-beat segments become the same numbered frames used for visual assignments", () => {
  const result = expandStoryboardFrames([{
    id: "frame-1",
    origin: "source",
    sourceItemId: "item-1",
    sourceRole: "utterance",
    dialogue: "Первая. Вторая.",
    directingBeat: true,
    panels: [{ description: "Первая композиция" }],
    segments: [
      {
        quote: "Первая. ",
        start: 0,
        end: 8,
        layout: "single",
        speakerPanel: 0,
        panels: [{ description: "Первая композиция" }],
      },
      {
        quote: "Вторая.",
        start: 8,
        end: 15,
        layout: "split2",
        speakerPanel: 1,
        panels: [{ description: "Слушатель" }, { description: "Говорящий" }],
      },
    ],
  }]);

  assert.deepEqual(result.map((frame) => frame.id), ["frame-1#1", "frame-1#2"]);
  assert.deepEqual(result.map((frame) => frame.structureFrameId), ["frame-1", "frame-1"]);
  assert.deepEqual(result.map((frame) => frame.structureSegmentIndex), [0, 1]);
  assert.equal(result[1].speakerPanel, 1);
  assert.deepEqual(result[1].displayBlock, { sourceItemId: "item-1", start: 8, end: 15 });
});

test("visible frame 14 maps to structure frame-12 when the opening directing beat has three segments", () => {
  const frames = [{
    id: "frame-1",
    origin: "source",
    directingBeat: true,
    panels: [{ description: "a" }, { description: "b" }],
    segments: [
      { quote: "A", layout: "split2", speakerPanel: 0, panels: [{ description: "a" }, { description: "b" }] },
      { quote: "B", layout: "split2", speakerPanel: 0, panels: [{ description: "a" }, { description: "b" }] },
      { quote: "C", layout: "split2", speakerPanel: 0, panels: [{ description: "a" }, { description: "b" }] },
    ],
  }];
  for (let index = 2; index <= 16; index += 1) {
    frames.push({
      id: `frame-${index}`,
      origin: "source",
      layout: "split2",
      panels: [{ description: "Путин" }, { description: "Дуров" }],
    });
  }
  const visible = expandStoryboardFrames(frames);
  assert.equal(visible.length, 18);
  assert.equal(visible[13].id, "frame-12");
  assert.equal(visible[13].structureFrameId, "frame-12");
  assert.equal(visible[13].structureSegmentIndex, null);
  assert.equal(visible[0].structureFrameId, "frame-1");
  assert.equal(visible[0].structureSegmentIndex, 0);
});
