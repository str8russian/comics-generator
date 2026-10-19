import assert from "node:assert/strict";
import test from "node:test";
import { FONT_LADDER } from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";
import { compileOverflow } from "../overflow.mjs";

function utterance(overrides = {}) {
  const dialogue = overrides.dialogue ?? "Привет";
  return {
    id: "f1",
    layout: "single",
    origin: "source",
    sourceItemId: "u1",
    sourceRole: "utterance",
    speakerPanel: 0,
    panels: [{ description: "Крупный план" }],
    dialogue,
    displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
    fontSize: 17,
    ...overrides,
  };
}

function graphemeCount(text) {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

test("keeps the largest accepted ladder size when the line fits", () => {
  const seen = [];
  const result = compileOverflow([utterance()], (text, options) => {
    seen.push(options.fontSize);
    assert.equal(typeof options.layout, "string");
    assert.equal(typeof options.speakerPanel, "number");
    return options.fontSize === FONT_LADDER.single[0] || options.fontSize === FONT_LADDER.single[1];
  });
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].id, "f1");
  assert.equal(result.frames[0].fontSize, FONT_LADDER.single[0]);
  assert.equal(result.frames[0].dialogue, "Привет");
  assert.equal(seen[0], FONT_LADDER.single[0]);
  assert.equal(result.frames[0].fontSize === 17, false);
});

test("splits at the minimum size and concatenates the spoken text", () => {
  const dialogue = "аб вг";
  const frame = utterance({
    dialogue,
    layout: "split2",
    speakerPanel: 1,
    panels: [{ description: "Левая" }, { description: "Правая" }],
    displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
  });
  const minimum = FONT_LADDER.split2.at(-1);
  const result = compileOverflow([frame], (text, options) => {
    if (text.length <= 2) return true;
    return options.fontSize === minimum && text.length <= 4;
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.frames.map((piece) => piece.dialogue), ["аб ", "вг"]);
  assert.equal(result.frames.map((piece) => piece.dialogue).join(""), dialogue);
  assert.deepEqual(result.frames.map((piece) => piece.id), ["f1#1", "f1#2"]);
  assert.equal(result.frames[0].fontSize, minimum);
  assert.equal(result.frames[1].fontSize, FONT_LADDER.split2[0]);
  for (const piece of result.frames) {
    assert.equal(piece.layout, "split2");
    assert.equal(piece.speakerPanel, 1);
    assert.equal(piece.origin, "source");
    assert.deepEqual(piece.panels, frame.panels);
    assert.deepEqual(
      piece.dialogue,
      dialogue.slice(piece.displayBlock.start, piece.displayBlock.end),
    );
  }
  assert.deepEqual(result.frames.map((piece) => [piece.displayBlock.start, piece.displayBlock.end]), [
    [0, 3],
    [3, 5],
  ]);
});

test("overflow fitting preserves structureFrameId and structureSegmentIndex on every display piece", () => {
  const dialogue = "аб вг";
  const frame = utterance({
    id: "structure-1",
    dialogue,
    layout: "split2",
    speakerPanel: 1,
    panels: [{ description: "Левая" }, { description: "Правая" }],
    displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
    structureFrameId: "structure-1",
    structureSegmentIndex: 0,
  });
  const minimum = FONT_LADDER.split2.at(-1);
  const result = compileOverflow([frame], (text, options) => {
    if (text.length <= 2) return true;
    return options.fontSize === minimum && text.length <= 4;
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.frames.map((piece) => piece.id), ["structure-1#1", "structure-1#2"]);
  for (const piece of result.frames) {
    assert.notEqual(piece.id, piece.structureFrameId);
    assert.equal(piece.structureFrameId, "structure-1");
    assert.equal(piece.structureSegmentIndex, 0);
  }
});

test("silent frames retain honest structural identity without rewriting display id", () => {
  const withExplicit = compileOverflow([{
    id: "display-silent",
    dialogue: "",
    layout: "single",
    speakerPanel: 0,
    panels: [{ description: "Тишина" }],
    structureFrameId: "structure-silent",
    structureSegmentIndex: 0,
  }], () => true);
  assert.equal(withExplicit.ok, true);
  assert.equal(withExplicit.frames.length, 1);
  assert.equal(withExplicit.frames[0].id, "display-silent");
  assert.equal(withExplicit.frames[0].structureFrameId, "structure-silent");
  assert.equal(withExplicit.frames[0].structureSegmentIndex, 0);

  const rawStructure = compileOverflow([{
    id: "frame-7",
    dialogue: "",
    layout: "single",
    speakerPanel: 0,
    panels: [{ description: "Без реплики" }],
  }], () => true);
  assert.equal(rawStructure.ok, true);
  assert.equal(rawStructure.frames[0].id, "frame-7");
  assert.equal(rawStructure.frames[0].structureFrameId, "frame-7");
  assert.equal(rawStructure.frames[0].structureSegmentIndex, null);
});

test("keeps a directing segment's composition when that segment splits further", () => {
  const dialogue = "аа бббб";
  const frame = utterance({
    id: "beat",
    dialogue,
    directingBeat: true,
    segments: [
      {
        quote: "аа ",
        layout: "single",
        speakerPanel: 0,
        panels: [{ description: "Первый жест" }],
      },
      {
        quote: "бббб",
        layout: "split2",
        speakerPanel: 1,
        panels: [{ description: "Лево" }, { description: "Право" }],
      },
    ],
    displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
  });
  const splitMinimum = FONT_LADDER.split2.at(-1);
  const result = compileOverflow([frame], (text, options) => {
    if (options.layout === "single") return options.fontSize === FONT_LADDER.single[0];
    return options.fontSize === splitMinimum && text.length <= 2;
  });
  assert.equal(result.ok, true);
  assert.equal(result.frames.map((piece) => piece.dialogue).join(""), dialogue);
  assert.equal(result.frames[0].layout, "single");
  assert.equal(result.frames[0].speakerPanel, 0);
  assert.deepEqual(result.frames[0].panels, [{ description: "Первый жест" }]);
  assert.equal(result.frames[0].dialogue, "аа ");
  const split = result.frames.slice(1);
  assert.deepEqual(split.map((piece) => piece.dialogue), ["бб", "бб"]);
  for (const piece of split) {
    assert.equal(piece.layout, "split2");
    assert.equal(piece.speakerPanel, 1);
    assert.deepEqual(piece.panels, [{ description: "Лево" }, { description: "Право" }]);
    assert.equal(piece.fontSize, splitMinimum);
    assert.equal(piece.origin, "source");
  }
  assert.deepEqual(result.frames.map((piece) => piece.id), ["beat#1", "beat#2", "beat#3"]);
});

test("preserves panel visual metadata when dialogue already fits", () => {
  const frame = utterance({
    dialogue: "Нет.",
    visualReady: true,
    panels: [{
      description: "Путин отвечает",
      assetId: "asset-1",
      asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-1",
      zoom: 1.25,
      position: "40% 35%",
      align: "40% 35%",
      subject: "Путин",
      generationStatus: "ready",
      performanceAssetId: "perf-1",
      performanceAssetUrl: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/perf-1",
    }],
  });
  const result = compileOverflow([frame], () => true);
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 1);
  const panel = result.frames[0].panels[0];
  assert.equal(panel.assetId, "asset-1");
  assert.equal(panel.asset, "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-1");
  assert.equal(panel.zoom, 1.25);
  assert.equal(panel.position, "40% 35%");
  assert.equal(panel.generationStatus, "ready");
  assert.equal(panel.performanceAssetId, "perf-1");
  assert.equal(result.frames[0].visualReady, true);
});

test("eligible split2 ready panels keep FrameRenderer dialogue geometry across overflow pieces", () => {
  const dialogue = "аб вг";
  const panels = [
    {
      description: "Путин спокойно слушает",
      assetId: "left-ready",
      asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/left-ready",
      zoom: 1.15,
      position: "48% 32%",
      align: "48% 32%",
      subject: "Путин",
      generationStatus: "ready",
    },
    {
      description: "Дуров отвечает",
      assetId: "right-ready",
      asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/right-ready",
      zoom: 1,
      position: "52% 30%",
      align: "52% 30%",
      subject: "Дуров",
      generationStatus: "ready",
    },
  ];
  const frame = utterance({
    dialogue,
    layout: "split2",
    speakerPanel: 0,
    sourceRole: "utterance",
    panels,
    displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
    visualReady: true,
  });
  const minimum = FONT_LADDER.split2.at(-1);
  const result = compileOverflow([frame], (text, options) => {
    if (text.length <= 2) return true;
    return options.fontSize === minimum && text.length <= 4;
  });
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 2);
  for (const piece of result.frames) {
    assert.equal(piece.layout, "split2");
    assert.equal(piece.speakerPanel, 0);
    assert.equal(piece.visualReady, true);
    assert.ok(FONT_LADDER.split2.includes(piece.fontSize));
    assert.equal(piece.panels[0].assetId, "left-ready");
    assert.equal(piece.panels[1].assetId, "right-ready");
    assert.equal(piece.panels[0].zoom, 1.15);
    assert.equal(piece.panels[1].position, "52% 30%");
  }
});

test("keeps the same panel assets on every dialogue overflow piece", () => {
  const dialogue = "аб вг";
  const panels = [
    {
      description: "Левая",
      assetId: "left",
      asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/left",
      zoom: 1.1,
      position: "50% 30%",
      subject: "Путин",
      generationStatus: "ready",
    },
    {
      description: "Правая",
      assetId: "right",
      asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/right",
      zoom: 1,
      position: "50% 30%",
      subject: "Дуров",
      generationStatus: "ready",
    },
  ];
  const frame = utterance({
    dialogue,
    layout: "split2",
    speakerPanel: 1,
    panels,
    displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
    visualReady: true,
  });
  const minimum = FONT_LADDER.split2.at(-1);
  const result = compileOverflow([frame], (text, options) => {
    if (text.length <= 2) return true;
    return options.fontSize === minimum && text.length <= 4;
  });
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 2);
  for (const piece of result.frames) {
    assert.equal(piece.visualReady, true);
    assert.equal(piece.panels[0].assetId, "left");
    assert.equal(piece.panels[1].assetId, "right");
    assert.equal(piece.panels[0].zoom, 1.1);
    assert.equal(piece.panels[1].subject, "Дуров");
  }
});

test("does not split an emoji grapheme and leaves a silent frame without a font size", () => {
  const dialogue = "а😀";
  const silent = {
    id: "a1",
    layout: "single",
    origin: "source",
    sourceItemId: "act",
    sourceRole: "action",
    panels: [{ description: "Жест" }],
    dialogue: "",
    outsideFrameText: "(пауза)",
  };
  const result = compileOverflow([
    utterance({
      dialogue,
      displayBlock: { sourceItemId: "u1", start: 0, end: dialogue.length },
    }),
    silent,
  ], (text, options) => options.fontSize === FONT_LADDER.single.at(-1) && graphemeCount(text) <= 1);
  assert.equal(result.ok, true);
  const spoken = result.frames.filter((frame) => frame.sourceRole === "utterance");
  assert.deepEqual(spoken.map((frame) => frame.dialogue), ["а", "😀"]);
  assert.equal(spoken[1].dialogue.length, 2);
  const action = result.frames.find((frame) => frame.id === "a1");
  assert.equal(action.dialogue, "");
  assert.equal(action.outsideFrameText, "(пауза)");
  assert.equal(Object.hasOwn(action, "fontSize"), false);
});

test("dormant text on a silent or hidden frame stays one unmeasured unit", () => {
  let measured = 0;
  const result = compileOverflow([
    utterance({
      dialogueMode: "silent",
      dialogue: "Очень длинная спрятанная реплика, которую нельзя резать",
      speakerPanel: null,
    }),
    utterance({
      id: "f2",
      dialogueMode: "hidden",
      dialogue: "Тоже спрятана",
      speakerPanel: null,
    }),
  ], () => {
    measured += 1;
    return false;
  });
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].dialogueMode, "silent");
  assert.equal(result.frames[0].dialogue.includes("спрятанная"), true);
  assert.equal(result.frames[1].dialogueMode, "hidden");
  assert.equal(measured, 0);
});
