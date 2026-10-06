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
