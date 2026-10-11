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

function panelReadyCompile(overrides = {}) {
  const frame = overrides.frame || eligibleDialogueFrame({
    panels: [
      { description: "Путин спокойно слушает", subject: "Путин" },
      { description: "Дуров отвечает", subject: "Дуров" },
    ],
  });
  const panelIndex = overrides.panelIndex ?? 0;
  const intent = compilePanelReadyIntent({
    frame,
    panelIndex,
    characterName: overrides.characterName ?? (panelIndex === 0 ? "Путин" : "Дуров"),
    description: overrides.description ?? frame.panels[panelIndex].description,
    instruction: overrides.instruction ?? "",
    hasPerformance: overrides.hasPerformance ?? false,
    partnerName: overrides.partnerName ?? frame.panels[panelIndex === 0 ? 1 : 0]?.subject ?? null,
  });
  const prompt = compilePanelReadyPrompt(intent, {
    hasPrevious: overrides.hasPrevious ?? false,
    hasPerformance: overrides.hasPerformance ?? false,
    hasStyle: overrides.hasStyle ?? true,
    identityAlsoStyle: overrides.identityAlsoStyle ?? false,
    previousDropped: overrides.previousDropped ?? false,
  });
  return { intent, prompt };
}

function panelReadyPrompt(overrides = {}) {
  return panelReadyCompile(overrides).prompt;
}

const COMPOSITE_CANARY = "CANARY_UNSUPPORTED_XYZ_7f3a";
const COMPOSITE_DESCRIPTION = [
  "Путин in a chest-up framing with upright torso and visible shoulders,",
  "right hand raised in an open-palm gesture in crop,",
  "head turned slightly toward screen-right,",
  "gaze toward screen-right,",
  "calm facial expression.",
  `Unrecognized scenery prose ${COMPOSITE_CANARY} at a meeting with a partner.`,
].join(" ");

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

test("panel-ready compiler emits solid matte, crop-safe framing, and prohibitions without relational scene labels", () => {
  const leftSpeaking = panelReadyPrompt({ panelIndex: 0, characterName: "Путин" });
  assert.match(leftSpeaking, /solid\s+matte/i);
  assert.match(leftSpeaking, /chest-up|waist-up|close-up|head-and-shoulders|medium close-up/i);
  assert.match(leftSpeaking, /crop/i);
  assert.match(leftSpeaking, /no additional people|no other people|exactly one/i);
  assert.match(leftSpeaking, /nested panel/i);
  assert.match(leftSpeaking, /border/i);
  assert.match(leftSpeaking, /caption/i);
  assert.match(leftSpeaking, /speech bubble|dialogue bubble/i);
  assert.match(leftSpeaking, /logo/i);
  assert.match(leftSpeaking, /watermark/i);
  assert.equal(/Panel description:/i.test(leftSpeaking), false);
  assert.equal(/two-character dialogue pair/i.test(leftSpeaking), false);
  assert.equal(/speaking panel/i.test(leftSpeaking), false);
  assert.equal(/listening or reaction panel/i.test(leftSpeaking), false);
  assert.equal(/\bpartner\b/i.test(leftSpeaking), false);
  assert.equal(/simple uniform non-scenic background/i.test(leftSpeaking), false);
  assert.equal(/one side of a two-panel split screen/i.test(leftSpeaking), false);
  assert.equal(/finished comic|comic page|assembled frame|split-screen comic/i.test(leftSpeaking), false);
  assert.equal(/clearly illustrated rather than photorealistic/i.test(leftSpeaking), false);

  const rightListening = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров слушает",
  });
  assert.match(rightListening, /solid\s+matte/i);
  assert.equal(/listening or reaction panel/i.test(rightListening), false);
  assert.equal(/two-character dialogue pair/i.test(rightListening), false);
});

test("panel-ready gaze fallback applies only when no explicit direction or performance staging", () => {
  const fallbackLeft = panelReadyPrompt({ panelIndex: 0, description: "Путин спокойно слушает" });
  assert.match(fallbackLeft, /screen-right|viewer'?s?\s+right/i);
  assert.match(fallbackLeft, /direct both eyes toward the viewer'?s?\s+right/i);
  assert.equal(/direct both eyes toward the viewer'?s?\s+left/i.test(fallbackLeft), false);

  const fallbackRight = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров отвечает",
  });
  assert.match(fallbackRight, /screen-left|viewer'?s?\s+left/i);
  assert.match(fallbackRight, /direct both eyes toward the viewer'?s?\s+left/i);
  assert.equal(/direct both eyes toward the viewer'?s?\s+right/i.test(fallbackRight), false);

  const descriptionDirection = panelReadyPrompt({
    panelIndex: 0,
    description: "Путин смотрит screen-left",
  });
  assert.match(descriptionDirection, /screen-left|viewer'?s?\s+left/i);
  assert.equal(/direct both eyes toward the viewer'?s?\s+right/i.test(descriptionDirection), false);

  const revisionDirection = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров отвечает",
    instruction: "look screen-right instead",
  });
  assert.equal(/direct both eyes toward the viewer'?s?\s+left/i.test(revisionDirection), false);

  const withPerformance = panelReadyPrompt({
    panelIndex: 0,
    description: "Путин спокойно слушает",
    hasPerformance: true,
  });
  assert.match(withPerformance, /performance reference/i);
  assert.equal(/direct both eyes toward the viewer'?s?\s+right/i.test(withPerformance), false);
  assert.match(withPerformance, /pose|expression|gaze|head/i);
});

test("panel-ready inward gaze names viewer-relative head and eye directions and forbids the outer edge", () => {
  const leftIntent = compilePanelReadyIntent({
    frame: eligibleDialogueFrame(),
    panelIndex: 0,
    characterName: "Путин",
    description: "Путин спокойно говорит",
    instruction: "",
    hasPerformance: false,
  });
  assert.equal(leftIntent.gaze, "screen-right");
  const left = compilePanelReadyPrompt(leftIntent, { hasStyle: true });
  assert.match(left, /viewer'?s?\s+perspective|from the viewer/i);
  assert.match(left, /head|face/i);
  assert.match(left, /eyes?/i);
  assert.match(left, /viewer'?s?\s+right|screen-right/i);
  assert.match(left, /do not point|must not point|not .*toward the viewer'?s?\s+left|not .*outer/i);
  assert.equal(/two-character dialogue pair|\bpartner\b|speaking panel/i.test(left), false);

  const rightIntent = compilePanelReadyIntent({
    frame: eligibleDialogueFrame(),
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров слушает",
    instruction: "",
    hasPerformance: false,
  });
  assert.equal(rightIntent.gaze, "screen-left");
  const right = compilePanelReadyPrompt(rightIntent, { hasStyle: true });
  assert.match(right, /viewer'?s?\s+perspective|from the viewer/i);
  assert.match(right, /head|face/i);
  assert.match(right, /eyes?/i);
  assert.match(right, /viewer'?s?\s+left|screen-left/i);
  assert.match(right, /do not point|must not point|not .*toward the viewer'?s?\s+right|not .*outer/i);
  assert.equal(/two-character dialogue pair|\bpartner\b|listening or reaction panel/i.test(right), false);

  assert.equal(/direct both eyes toward the viewer'?s?\s+left/i.test(left), false);
  assert.equal(/direct both eyes toward the viewer'?s?\s+right/i.test(right), false);
});

test("panel-ready relational look-at-partner derives inward gaze without provider-facing relational prose", () => {
  const left = panelReadyPrompt({
    panelIndex: 0,
    characterName: "Путин",
    description: "Путин looks at the other panel character while speaking",
  });
  assert.match(left, /viewer'?s?\s+right|screen-right/i);
  assert.match(left, /head|face/i);
  assert.match(left, /eyes?/i);
  assert.equal(/looks? at the other panel character/i.test(left), false);
  assert.equal(/resolves? to/i.test(left), false);
  assert.equal(/\bpartner\b/i.test(left), false);
  assert.equal(/two-character dialogue pair/i.test(left), false);
  assert.equal(/Follow any explicit gaze or head direction from the panel description/i.test(left), false);

  const right = panelReadyPrompt({
    panelIndex: 1,
    characterName: "Дуров",
    description: "Дуров смотрит на собеседника",
  });
  assert.match(right, /viewer'?s?\s+left|screen-left/i);
  assert.match(right, /head|face/i);
  assert.match(right, /eyes?/i);
  assert.equal(/смотрит на собеседника/i.test(right), false);
  assert.equal(/\bpartner\b|собеседник/i.test(right), false);

  const namedPartner = panelReadyPrompt({
    panelIndex: 0,
    characterName: "Путин",
    description: "Путин смотрит на Дурова",
    frame: eligibleDialogueFrame({
      panels: [
        { description: "Путин смотрит на Дурова", subject: "Путин" },
        { description: "Дуров слушает", subject: "Дуров" },
      ],
    }),
  });
  assert.match(namedPartner, /viewer'?s?\s+right|screen-right/i);
  assert.match(namedPartner, /head|face/i);
  assert.match(namedPartner, /eyes?/i);
  assert.equal(/смотрит на Дурова/i.test(namedPartner), false);
  assert.equal(/Дурова/i.test(namedPartner), false);
});

test("eligible compilePanelReadyIntent keeps only canonical supported values and compiler version", () => {
  const { intent, prompt } = panelReadyCompile({
    panelIndex: 0,
    characterName: "Путин",
    description: COMPOSITE_DESCRIPTION,
  });

  assert.equal(intent.compilerVersion, "constrained-panel-intent/v1");
  assert.equal(intent.characterName, "Путин");
  assert.equal(intent.framing, "chest-up");
  assert.equal(intent.upperBody, "upright torso with visible shoulders");
  assert.equal(intent.gesture, "open-palm hand raised in crop");
  assert.equal(intent.headPose, "head turned slightly screen-right");
  assert.equal(intent.gaze, "screen-right");
  assert.equal(intent.expression, "calm");
  assert.equal(intent.background, "solid-matte");
  assert.equal(Object.prototype.hasOwnProperty.call(intent, "description"), false);

  assert.equal(/Panel description:/i.test(prompt), false);
  assert.equal(prompt.includes(COMPOSITE_DESCRIPTION), false);
  assert.equal(prompt.includes(COMPOSITE_CANARY), false);
  assert.equal(/Unrecognized scenery prose/i.test(prompt), false);
  assert.equal(/at a meeting/i.test(prompt), false);
  assert.equal(/\bpartner\b/i.test(prompt), false);
  assert.match(prompt, /Путин/);
  assert.match(prompt, /chest-up/i);
  assert.match(prompt, /upright torso with visible shoulders/i);
  assert.match(prompt, /open-palm hand raised in crop/i);
  assert.match(prompt, /head turned slightly screen-right/i);
  assert.match(prompt, /screen-right|viewer'?s?\s+right/i);
  assert.match(prompt, /\bcalm\b/i);
  assert.match(prompt, /solid\s+matte/i);
});

test("eligible compiler never copies arbitrary description substrings and never falls back to full description", () => {
  const uniquePhrase = "UNIQUE_ARBITRARY_SUBSTRING_q9m2";
  const { intent, prompt } = panelReadyCompile({
    panelIndex: 0,
    characterName: "Путин",
    description: `Путин ${uniquePhrase} with no recognized optional attributes`,
  });

  assert.equal(intent.compilerVersion, "constrained-panel-intent/v1");
  assert.equal(intent.framing, "chest-up");
  assert.equal(intent.upperBody, "visible shoulders and upper torso");
  assert.equal(intent.gesture, "hands rest in crop");
  assert.equal(intent.headPose, "near-frontal head");
  assert.equal(intent.expression, "neutral");
  assert.equal(intent.background, "solid-matte");
  assert.equal(prompt.includes(uniquePhrase), false);
  assert.equal(prompt.includes("with no recognized optional attributes"), false);
  assert.equal(/Panel description:/i.test(prompt), false);
  assert.equal(/No additional description/i.test(prompt), false);
  assert.match(prompt, /solid\s+matte/i);
  assert.match(prompt, /chest-up/i);
});

test("eligible compiler supports close-up through waist-up framing names and rejects wider framing as provider intent", () => {
  for (const [description, framing] of [
    ["close-up framing, upright torso with visible shoulders, hands rest in crop, near-frontal head, gaze to-camera, neutral expression", "close-up"],
    ["head-and-shoulders framing, upright torso with visible shoulders, hands rest in crop, near-frontal head, gaze to-camera, neutral expression", "head-and-shoulders"],
    ["chest-up framing, upright torso with visible shoulders, hands rest in crop, near-frontal head, gaze to-camera, neutral expression", "chest-up"],
    ["medium close-up framing, upright torso with visible shoulders, hands rest in crop, near-frontal head, gaze to-camera, neutral expression", "medium-close-up"],
    ["waist-up framing, upright torso with visible shoulders, hands rest in crop, near-frontal head, gaze to-camera, neutral expression", "waist-up"],
  ]) {
    const { intent, prompt } = panelReadyCompile({ description: `Путин ${description}` });
    assert.equal(intent.framing, framing, description);
    assert.match(prompt, new RegExp(framing.replace(/-/g, "[- ]?"), "i"));
    assert.equal(/full-body|full length|head to toe/i.test(prompt), false);
  }

  const wide = panelReadyCompile({
    description: `Путин full-body from head to toe ${COMPOSITE_CANARY}`,
  });
  assert.equal(wide.intent.framing, "chest-up");
  assert.equal(/full-body|full length|head to toe/i.test(wide.prompt), false);
  assert.equal(wide.prompt.includes(COMPOSITE_CANARY), false);
  assert.match(wide.prompt, /chest-up/i);
});

test("eligible provider grammar forbids relational scenario prose and hard-coded competing style language", () => {
  const prompt = panelReadyPrompt({
    panelIndex: 0,
    characterName: "Путин",
    description: [
      "Путин chest-up framing upright torso with visible shoulders",
      "hands rest in crop near-frontal head gaze screen-right calm expression",
      "two-character dialogue pair meeting context partner speaking panel",
      COMPOSITE_CANARY,
    ].join(" "),
  });

  assert.equal(/Panel description:/i.test(prompt), false);
  assert.equal(/two-character dialogue pair/i.test(prompt), false);
  assert.equal(/speaking panel/i.test(prompt), false);
  assert.equal(/listening or reaction panel/i.test(prompt), false);
  assert.equal(/\bpartner\b/i.test(prompt), false);
  assert.equal(/meeting context/i.test(prompt), false);
  assert.equal(prompt.includes(COMPOSITE_CANARY), false);
  assert.match(prompt, /solid\s+matte/i);
  assert.equal(/simple uniform non-scenic background/i.test(prompt), false);
  assert.equal(/clearly illustrated rather than photorealistic/i.test(prompt), false);
  assert.equal(/heavy near-black contour/i.test(prompt), false);
  assert.match(prompt, /approved identity anchor|project style anchor/i);
  assert.match(prompt, /exactly one|no additional people/i);
});

test("optional performance stays panel-scoped and does not displace identity or style", () => {
  const left = assemblePanelReferences({
    anchor: { id: "left-anchor" },
    previous: { id: "left-prev" },
    performance: { id: "left-perf" },
    style: { id: "style" },
    panelReady: true,
  });
  const right = assemblePanelReferences({
    anchor: { id: "right-anchor" },
    previous: { id: "right-prev" },
    performance: null,
    style: { id: "style" },
    panelReady: true,
  });

  assert.deepEqual(left.images.map((image) => image.id), ["left-anchor", "style", "left-perf"]);
  assert.equal(left.previousDropped, true);
  assert.ok(left.roles.has("anchor"));
  assert.ok(left.roles.has("style"));
  assert.ok(left.roles.has("performance"));
  assert.equal(left.roles.has("previous"), false);

  assert.deepEqual(right.images.map((image) => image.id), ["right-anchor", "style", "right-prev"]);
  assert.equal(right.hasPerformance, false);
  assert.equal(right.roles.has("performance"), false);
  assert.equal(right.images.some((image) => image.id === "left-perf"), false);

  const leftPrompt = panelReadyPrompt({
    panelIndex: 0,
    characterName: "Путин",
    hasPerformance: true,
    hasStyle: true,
    hasPrevious: false,
    previousDropped: true,
  });
  assert.match(leftPrompt, /Image 1 is the approved identity anchor/);
  assert.match(leftPrompt, /Image 2 is the project style anchor/);
  assert.match(leftPrompt, /Image 3 is the performance reference/);
  assert.equal(/Image 1 is the performance reference/.test(leftPrompt), false);
  assert.equal(/Image 2 is the performance reference/.test(leftPrompt), false);
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
