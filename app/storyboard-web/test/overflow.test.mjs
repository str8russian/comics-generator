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
      asset: "/api/visual/assets/asset-1",
      zoom: 1.25,
      position: "40% 35%",
      align: "40% 35%",
      subject: "Путин",
      generationStatus: "ready",
      performanceAssetId: "perf-1",
      performanceAssetUrl: "/api/visual/assets/perf-1",
    }],
  });
  const result = compileOverflow([frame], () => true);
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 1);
  const panel = result.frames[0].panels[0];
  assert.equal(panel.assetId, "asset-1");
  assert.equal(panel.asset, "/api/visual/assets/asset-1");
  assert.equal(panel.zoom, 1.25);
  assert.equal(panel.position, "40% 35%");
  assert.equal(panel.generationStatus, "ready");
  assert.equal(panel.performanceAssetId, "perf-1");
  assert.equal(result.frames[0].visualReady, true);
});

test("keeps the same panel assets on every dialogue overflow piece", () => {
  const dialogue = "аб вг";
  const panels = [
    {
      description: "Левая",
      assetId: "left",
      asset: "/api/visual/assets/left",
      zoom: 1.1,
      position: "50% 30%",
      subject: "Путин",
      generationStatus: "ready",
    },
    {
      description: "Правая",
      assetId: "right",
      asset: "/api/visual/assets/right",
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

function hybridReadyFrame(overrides = {}) {
  const dialogue = overrides.dialogue ?? "аб вг де";
  return {
    id: "f-hybrid",
    layout: "split2",
    origin: "source",
    sourceItemId: "u-hybrid",
    sourceRole: "utterance",
    speakerPanel: 1,
    dialogue,
    displayBlock: { sourceItemId: "u-hybrid", start: 0, end: dialogue.length },
    fitMode: "manual",
    visualReady: true,
    hybrid: {
      sceneKey: "primary",
      compositionMode: "near-frontal-pair",
      assemblyStatus: "ready",
      activeOperationId: null,
      background: {
        status: "ready",
        assetId: "bg-shared",
        asset: "/api/visual/assets/bg-shared",
        generationId: "bg-gen-1",
      },
      panels: [
        {
          panelIndex: 0,
          subject: "Путин",
          status: "ready",
          assetId: "char-0",
          generationId: "char-gen-0",
          zoom: 1.25,
          positionX: 40,
          positionY: 20,
          fitMode: "manual",
        },
        {
          panelIndex: 1,
          subject: "Дуров",
          status: "ready",
          assetId: "char-1",
          generationId: "char-gen-1",
          zoom: 1.1,
          positionX: 55,
          positionY: 25,
          fitMode: "fit",
        },
      ],
      operation: { status: "complete", phase: "complete", operationId: "op-done" },
    },
    panels: [
      {
        description: "Путин",
        subject: "Путин",
        characterAssetId: "char-0",
        characterAsset: "/api/visual/assets/char-0",
        zoom: 1.25,
        positionX: 40,
        positionY: 20,
        position: "40% 20%",
        align: "40% 20%",
        fitMode: "manual",
        hybrid: { status: "ready", assetId: "char-0", generationId: "char-gen-0" },
      },
      {
        description: "Дуров",
        subject: "Дуров",
        characterAssetId: "char-1",
        characterAsset: "/api/visual/assets/char-1",
        zoom: 1.1,
        positionX: 55,
        positionY: 25,
        position: "55% 25%",
        align: "55% 25%",
        fitMode: "fit",
        hybrid: { status: "ready", assetId: "char-1", generationId: "char-gen-1" },
      },
    ],
    ...overrides,
  };
}

test("fitting a ready hybrid frame preserves assembly identity, placement, and visualReady", () => {
  const frame = hybridReadyFrame({ dialogue: "Нет." });
  const result = compileOverflow([frame], () => true);
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 1);
  const piece = result.frames[0];
  assert.equal(piece.id, "f-hybrid");
  assert.equal(piece.dialogue, "Нет.");
  assert.equal(piece.speakerPanel, 1);
  assert.equal(piece.sourceItemId, "u-hybrid");
  assert.equal(piece.sourceRole, "utterance");
  assert.equal(piece.fitMode, "manual");
  assert.equal(piece.hybrid.sceneKey, "primary");
  assert.equal(piece.hybrid.assemblyStatus, "ready");
  assert.equal(piece.hybrid.background.assetId, "bg-shared");
  assert.equal(piece.hybrid.background.generationId, "bg-gen-1");
  assert.equal(piece.hybrid.panels[0].assetId, "char-0");
  assert.equal(piece.hybrid.panels[1].assetId, "char-1");
  assert.equal(piece.hybrid.panels[0].fitMode, "manual");
  assert.equal(piece.hybrid.panels[1].fitMode, "fit");
  assert.equal(piece.panels[0].characterAssetId, "char-0");
  assert.equal(piece.panels[1].characterAssetId, "char-1");
  assert.equal(piece.panels[0].fitMode, "manual");
  assert.equal(piece.panels[1].fitMode, "fit");
  assert.equal(piece.panels[0].zoom, 1.25);
  assert.equal(piece.panels[1].positionX, 55);
  assert.equal(piece.visualReady, true);
});

test("overflow pieces preserve hybrid state, shared background, character assets, and dialogue order", () => {
  const dialogue = "аб вг де";
  const frame = hybridReadyFrame({ dialogue });
  const minimum = FONT_LADDER.split2.at(-1);
  const result = compileOverflow([frame], (text, options) => {
    if (text.length <= 2) return true;
    return options.fontSize === minimum && text.length <= 3;
  });
  assert.equal(result.ok, true);
  assert.ok(result.frames.length >= 2);
  assert.equal(result.frames.map((piece) => piece.dialogue).join(""), dialogue);
  assert.deepEqual(
    result.frames.map((piece) => [piece.displayBlock.start, piece.displayBlock.end]),
    result.frames.map((piece) => {
      const start = piece.displayBlock.start;
      return [start, start + piece.dialogue.length];
    }),
  );
  for (const piece of result.frames) {
    assert.equal(piece.layout, "split2");
    assert.equal(piece.speakerPanel, 1);
    assert.equal(piece.origin, "source");
    assert.equal(piece.sourceItemId, "u-hybrid");
    assert.equal(piece.hybrid.assemblyStatus, "ready");
    assert.equal(piece.hybrid.background.assetId, "bg-shared");
    assert.equal(piece.hybrid.background.generationId, "bg-gen-1");
    assert.equal(piece.hybrid.panels[0].assetId, "char-0");
    assert.equal(piece.hybrid.panels[0].generationId, "char-gen-0");
    assert.equal(piece.hybrid.panels[1].assetId, "char-1");
    assert.equal(piece.hybrid.panels[1].generationId, "char-gen-1");
    assert.equal(piece.panels[0].characterAssetId, "char-0");
    assert.equal(piece.panels[1].characterAssetId, "char-1");
    assert.equal(piece.panels[0].fitMode, "manual");
    assert.equal(piece.panels[1].fitMode, "fit");
    assert.equal(piece.visualReady, true);
    assert.equal(
      piece.dialogue,
      dialogue.slice(piece.displayBlock.start, piece.displayBlock.end),
    );
  }
});

test("incomplete or failed hybrid attempts stay non-Visual unless a ready assembly is retained", () => {
  const incomplete = hybridReadyFrame({
    dialogue: "Нет.",
    visualReady: false,
    hybrid: {
      ...hybridReadyFrame().hybrid,
      assemblyStatus: "not-ready",
      background: { status: "ready", assetId: "bg-shared", generationId: "bg-gen-1" },
      panels: [
        { panelIndex: 0, subject: "Путин", status: "ready", assetId: "char-0", fitMode: "manual" },
        { panelIndex: 1, subject: "Дуров", status: "pending", assetId: null, fitMode: "fit" },
      ],
      operation: { status: "running", phase: "character-states", operationId: "op-run" },
      activeOperationId: "op-run",
    },
    panels: [
      {
        description: "Путин",
        subject: "Путин",
        characterAssetId: "char-0",
        fitMode: "manual",
        hybrid: { status: "ready", assetId: "char-0" },
      },
      {
        description: "Дуров",
        subject: "Дуров",
        characterAssetId: null,
        fitMode: "fit",
        hybrid: { status: "pending", assetId: null },
      },
    ],
  });
  const incompleteFitted = compileOverflow([incomplete], () => true);
  assert.equal(incompleteFitted.ok, true);
  assert.equal(incompleteFitted.frames[0].visualReady, false);
  assert.equal(incompleteFitted.frames[0].hybrid.assemblyStatus, "not-ready");
  assert.equal(incompleteFitted.frames[0].hybrid.activeOperationId, "op-run");
  assert.equal(incompleteFitted.frames[0].hybrid.background.assetId, "bg-shared");

  const failedWithPrior = hybridReadyFrame({
    dialogue: "Нет.",
    visualReady: true,
    hybrid: {
      ...hybridReadyFrame().hybrid,
      assemblyStatus: "ready",
      operation: { status: "failed", phase: "failed", operationId: "op-fail", errorKind: "provider" },
      activeOperationId: null,
    },
  });
  const retained = compileOverflow([failedWithPrior], () => true);
  assert.equal(retained.ok, true);
  assert.equal(retained.frames[0].visualReady, true);
  assert.equal(retained.frames[0].hybrid.assemblyStatus, "ready");
  assert.equal(retained.frames[0].hybrid.background.assetId, "bg-shared");
  assert.equal(retained.frames[0].hybrid.operation.status, "failed");
  assert.equal(retained.frames[0].panels[0].characterAssetId, "char-0");
  assert.equal(retained.frames[0].panels[1].characterAssetId, "char-1");

  const historicalFullPanelOnly = {
    id: "f-hist",
    layout: "split2",
    origin: "source",
    sourceItemId: "u-hist",
    sourceRole: "utterance",
    speakerPanel: 0,
    dialogue: "Да.",
    displayBlock: { sourceItemId: "u-hist", start: 0, end: 3 },
    visualReady: false,
    hybrid: {
      sceneKey: "primary",
      assemblyStatus: "not-ready",
      activeOperationId: "op-hist",
      background: { status: "pending", assetId: null },
      panels: [
        { panelIndex: 0, status: "pending", assetId: null },
        { panelIndex: 1, status: "pending", assetId: null },
      ],
    },
    panels: [
      { description: "A", subject: "Путин", assetId: "legacy-0", fitMode: "manual" },
      { description: "B", subject: "Дуров", assetId: "legacy-1", fitMode: "fit" },
    ],
  };
  const histFitted = compileOverflow([historicalFullPanelOnly], () => true);
  assert.equal(histFitted.ok, true);
  assert.equal(histFitted.frames[0].visualReady, false, "hybrid attempt must not fall back to full-panel assetId readiness");
  assert.equal(histFitted.frames[0].hybrid.assemblyStatus, "not-ready");
  assert.equal(histFitted.frames[0].panels[0].assetId, "legacy-0");
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
