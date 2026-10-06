import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FONT_LADDER, FRAME_GEOMETRY, fontSizeFor, render } from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";

function createElement(tag) {
  return {
    tag,
    className: "",
    textContent: "",
    children: [],
    dataset: {},
    style: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
}

function installDocument() {
  globalThis.document = { createElement };
}

function byClass(node, className) {
  const found = [];
  const walk = (current) => {
    if (!current || typeof current !== "object") return;
    if (String(current.className).split(/\s+/).includes(className)) found.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

test("locks the geometry and the length-to-size ladder", () => {
  assert.deepEqual(FRAME_GEOMETRY, {
    width: 1920,
    height: 1080,
    dialogueBarHeight: 300,
    panelGutter: 48,
    splitPadding: "34px 44px 24px",
    singlePadding: "38px 70px 26px",
  });
  assert.deepEqual(FONT_LADDER, {
    single: [58, 51, 46, 42],
    split2: [44, 38, 34, 31],
  });
  assert.equal(fontSizeFor("коротко", false), 58);
  assert.equal(fontSizeFor("x".repeat(200), true), 31);
});

test("draws two descriptions and puts dialogue in the speaker cell", () => {
  installDocument();
  const canvas = render({
    layout: "split2",
    speakerPanel: 1,
    dialogue: "Привет",
    fontSize: 31,
    panels: [
      { description: "Левая панель" },
      { description: "Правая панель" },
    ],
  }, { mode: "structure" });
  assert.deepEqual(byClass(canvas, "panel-description").map((node) => node.textContent), [
    "Левая панель",
    "Правая панель",
  ]);
  const cells = byClass(canvas, "dialogue-cell");
  assert.equal(cells.length, 2);
  assert.equal(byClass(cells[0], "dialogue-text").length, 0);
  const spoken = byClass(cells[1], "dialogue-text");
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].textContent, "Привет");
  assert.equal(spoken[0].style.fontSize, "31px");
  assert.equal(cells[1].style.padding, FRAME_GEOMETRY.splitPadding);
});

test("uses fontSizeFor when the requested size is not in the ladder", () => {
  installDocument();
  const canvas = render({
    layout: "single",
    speakerPanel: 0,
    dialogue: "Привет",
    fontSize: 12,
    panels: [{ description: "Одна панель" }],
  }, { mode: "structure" });
  const spoken = byClass(canvas, "dialogue-text")[0];
  assert.equal(spoken.style.fontSize, fontSizeFor("Привет", false) + "px");
  assert.equal(byClass(canvas, "dialogue-cell")[0].style.padding, FRAME_GEOMETRY.singlePadding);
});

test("omits the dialogue bar when dialogue is empty", () => {
  installDocument();
  const canvas = render({
    layout: "single",
    speakerPanel: 0,
    dialogue: "   ",
    panels: [{ description: "Без реплики" }],
  }, { mode: "structure" });
  assert.equal(byClass(canvas, "panel-description").length, 1);
  assert.equal(byClass(canvas, "dialogue-bar").length, 0);
  assert.equal(byClass(canvas, "dialogue-text").length, 0);
});

test("keeps the viewer.css declarations measurement depends on", () => {
  const css = readFileSync(new URL("../../../prototypes/storyboard-viewer/viewer.css", import.meta.url), "utf8");
  for (const declaration of [
    "Arial, Helvetica, sans-serif",
    "border-box",
    "border-top: 2px solid #536064",
    "font-weight: 500",
    "letter-spacing: .1px",
    "line-height: 1.18",
    "overflow-wrap: anywhere",
  ]) {
    assert.equal(css.includes(declaration), true, declaration);
  }
});
