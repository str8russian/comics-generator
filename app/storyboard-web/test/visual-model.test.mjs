import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorPrompt,
  aspectRatioForFrame,
  assembleAnchorReferences,
  assemblePanelReferences,
  compileCharacterStatePrompt,
  compileSceneBackgroundPrompt,
  expandStoryboardFrames,
  HYBRID_PROMPT_COMPILER_VERSION,
  panelPrompt,
  resolvePanelSubject,
  validateAnchorRequired,
  validateStyleRequired,
} from "../visual-model.mjs";

const characters = [{ name: "Путин" }, { name: "Дуров" }, { name: "Песков" }];
const aliases = [{ surface: "Дмитрий Сергеевич", characterName: "Песков" }];

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
  });
  assert.ok(assembled.roles.has("anchor"));
  assert.ok(assembled.roles.has("previous"));
  assert.ok(assembled.roles.has("performance"));
  assert.equal(assembled.roles.has("style"), false);
  assert.equal(assembled.images[0].id, "anchor");
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

test("hybrid background compiler is style-only, people-free, and self-contained", () => {
  assert.deepEqual(validateStyleRequired(null), { ok: false, kind: "style-required" });
  assert.deepEqual(validateAnchorRequired(null), { ok: false, kind: "anchor-required" });

  const missing = compileSceneBackgroundPrompt({
    sceneContinuity: "corridor",
    styleAsset: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.kind, "style-required");

  const style = { id: "style-seed", mime: "image/png" };
  const compiled = compileSceneBackgroundPrompt({
    sceneContinuity: "dim shared corridor",
    compositionMode: "near-frontal-pair",
    styleAsset: style,
  });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.promptCompilerVersion, HYBRID_PROMPT_COMPILER_VERSION);
  assert.match(compiled.prompt, /people-free scene background/i);
  assert.match(compiled.prompt, /Do not depict any people/i);
  assert.match(compiled.prompt, /project style authority/i);
  assert.doesNotMatch(compiled.prompt, /identity anchor/i);
  assert.match(compiled.prompt, /No nested comic panels/i);
  assert.doesNotMatch(compiled.prompt, /Layout:\s*one side of a two-panel split screen/i);
  assert.doesNotMatch(compiled.prompt, /full-scene dialogue panel/i);
  assert.deepEqual(compiled.referenceManifest, [{ role: "style", assetId: "style-seed", required: true }]);
  assert.equal(compiled.images.length, 1);
});

test("hybrid character-state compiler requires #00FF00 backing and distinct identity/style roles", () => {
  const identity = { id: "anchor-1", mime: "image/png" };
  const style = { id: "style-seed", mime: "image/png" };
  const missingAnchor = compileCharacterStatePrompt({
    characterName: "Путин",
    description: "говорит",
    identityAsset: null,
    styleAsset: style,
  });
  assert.equal(missingAnchor.ok, false);
  assert.equal(missingAnchor.kind, "anchor-required");

  const compiled = compileCharacterStatePrompt({
    characterName: "Путин",
    description: "говорит спокойно, addressing Дуров",
    compositionMode: "inward-conversation",
    panelIndex: 0,
    speakerPanel: 0,
    role: "speaker",
    expressionAndPose: "calm conversational near-frontal performance with mouth visible",
    shotScale: "chest-up",
    gazeOrScreenDirection: "subtle-inward-right",
    cropAndSafeMargins: "safe margins around head and shoulders for later placement zoom and pan",
    offscreenOthers: ["Дуров"],
    identityAsset: identity,
    styleAsset: style,
  });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.promptCompilerVersion, HYBRID_PROMPT_COMPILER_VERSION);
  assert.match(compiled.prompt, /#00FF00/);
  assert.match(compiled.prompt, /Exactly one visible assigned person/i);
  assert.match(compiled.prompt, /subtle screen-right/i);
  assert.doesNotMatch(compiled.prompt, /Дуров/);
  assert.doesNotMatch(compiled.prompt, /Panel description:/i);
  assert.match(compiled.prompt, /Image 1 is the approved identity anchor/);
  assert.match(compiled.prompt, /Image 2 is the approved project style authority/);
  assert.match(compiled.prompt, /No nested comic panels/i);
  assert.doesNotMatch(compiled.prompt, /Layout:\s*one side of a two-panel split screen/i);
  assert.match(compiled.prompt, /No dialogue, speech bubbles/);
  assert.deepEqual(compiled.referenceManifest, [
    { role: "identity", assetId: "anchor-1", required: true },
    { role: "style", assetId: "style-seed", required: true },
  ]);
  assert.equal(compiled.images.length, 2);

  const sameAsset = compileCharacterStatePrompt({
    characterName: "Путин",
    description: "слушает",
    identityAsset: style,
    styleAsset: style,
  });
  assert.equal(sameAsset.ok, true);
  assert.deepEqual(sameAsset.referenceManifest.map((entry) => entry.role), ["identity", "style"]);
  assert.equal(sameAsset.referenceManifest[0].assetId, sameAsset.referenceManifest[1].assetId);
  assert.equal(sameAsset.images.length, 1);
  assert.match(sameAsset.prompt, /distinct required role/);
});

test("hybrid character prompts exclude raw panel descriptions, interlocutor names, and scene nouns", () => {
  const identityPutin = { id: "anchor-putin", mime: "image/png" };
  const identityDurov = { id: "anchor-durov", mime: "image/png" };
  const style = { id: "style-seed", mime: "image/png" };
  const putinDescription =
    "Путин сидит за столом переговоров в строгом кабинете, спокойно обращаясь к Дурову.";
  const durovDescription =
    "Дуров напротив Путина внимательно слушает, на столе лежат папки и телефон.";

  const putin = compileCharacterStatePrompt({
    characterName: "Путин",
    description: putinDescription,
    role: "speaker",
    expressionAndPose: "calm conversational near-frontal performance with mouth visible",
    shotScale: "chest-up",
    gazeOrScreenDirection: "near-frontal-subtle-right",
    cropAndSafeMargins: "safe margins around head and shoulders for later placement zoom and pan",
    panelIndex: 0,
    speakerPanel: 0,
    offscreenOthers: ["Дуров"],
    identityAsset: identityPutin,
    styleAsset: style,
  });
  const durov = compileCharacterStatePrompt({
    characterName: "Дуров",
    description: durovDescription,
    role: "listener",
    expressionAndPose: "calm conversational near-frontal performance with mouth visible",
    shotScale: "chest-up",
    gazeOrScreenDirection: "near-frontal-subtle-left",
    cropAndSafeMargins: "safe margins around head and shoulders for later placement zoom and pan",
    panelIndex: 1,
    speakerPanel: 0,
    offscreenOthers: ["Путин"],
    identityAsset: identityDurov,
    styleAsset: style,
  });

  assert.equal(putin.ok, true);
  assert.equal(durov.ok, true);
  assert.equal(putin.promptCompilerVersion, "hybrid-dialogue-v2");
  assert.equal(durov.promptCompilerVersion, "hybrid-dialogue-v2");

  assert.match(putin.prompt, /Путин/);
  assert.doesNotMatch(putin.prompt, /Дуров/);
  assert.doesNotMatch(putin.prompt, /кабинет/i);
  assert.doesNotMatch(putin.prompt, /стол/i);
  assert.equal(putin.prompt.includes(putinDescription), false);
  assert.match(putin.prompt, /subtle screen-right/i);
  assert.match(putin.prompt, /speaking/i);
  assert.match(putin.prompt, /chest-up/i);
  assert.match(putin.prompt, /safe margins/i);
  assert.match(putin.prompt, /#00FF00/);
  assert.match(putin.prompt, /identity anchor/i);
  assert.match(putin.prompt, /style authority/i);
  assert.match(putin.prompt, /furniture|props|foreground|other (faces|heads|body)|silhouette/i);

  assert.match(durov.prompt, /Дуров/);
  assert.doesNotMatch(durov.prompt, /Путин/);
  assert.doesNotMatch(durov.prompt, /стол/i);
  assert.doesNotMatch(durov.prompt, /папк/i);
  assert.doesNotMatch(durov.prompt, /телефон/i);
  assert.equal(durov.prompt.includes(durovDescription), false);
  assert.match(durov.prompt, /subtle screen-left/i);
  assert.match(durov.prompt, /listening|reaction/i);
  assert.match(durov.prompt, /chest-up/i);
  assert.match(durov.prompt, /safe margins/i);
  assert.match(durov.prompt, /#00FF00/);
  assert.match(durov.prompt, /identity anchor/i);
  assert.match(durov.prompt, /style authority/i);

  const background = compileSceneBackgroundPrompt({
    sceneContinuity: "strict negotiation office with desk folders and telephone on the table",
    compositionMode: "near-frontal-pair",
    styleAsset: style,
  });
  assert.equal(background.ok, true);
  assert.match(background.prompt, /desk folders and telephone/i);
  assert.doesNotMatch(background.prompt, /Путин|Дуров/);
  assert.match(background.prompt, /people-free/i);
  assert.equal(background.promptCompilerVersion, "hybrid-dialogue-v2");
});

test("ordinary dialogue helpers no longer request split-layout nesting wording", () => {
  const panel = panelPrompt({
    characterName: "Песков",
    description: "Песков смотрит",
    instruction: "",
    layout: "split2",
    panelIndex: 0,
    speakerPanel: 0,
    hasPrevious: false,
    hasPerformance: false,
    hasStyle: true,
  });
  assert.doesNotMatch(panel, /one side of a two-panel split screen/i);
  assert.match(panel, /nested panels|split-screen layout/i);
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
