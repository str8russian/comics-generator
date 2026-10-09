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

test("hybrid visual mode layers shared background under clipped character panels", () => {
  installDocument();
  const canvas = render({
    layout: "split2",
    speakerPanel: 0,
    dialogue: "Слой проверка",
    fontSize: 31,
    compositionMode: "near-frontal-pair",
    hybrid: {
      sceneKey: "primary",
      compositionMode: "near-frontal-pair",
      background: { status: "ready", assetId: "bg-1", asset: "/api/visual/assets/bg-1" },
    },
    panels: [
      {
        subject: "Путин",
        role: "Говорит",
        description: "слева",
        characterAsset: "/api/visual/assets/c0",
        zoom: 1.5,
        position: "40% 20%",
        align: "40% 20%",
        positionX: 40,
        positionY: 20,
      },
      {
        subject: "Дуров",
        role: "Слушает",
        description: "справа",
        characterAsset: "/api/visual/assets/c1",
        zoom: 1.25,
        position: "60% 25%",
        align: "60% 25%",
        positionX: 60,
        positionY: 25,
      },
    ],
  }, { mode: "visual" });

  assert.equal(canvas.dataset.compositionMode, "near-frontal-pair");
  const background = byClass(canvas, "scene-background");
  assert.equal(background.length, 1);
  assert.equal(background[0].src, "/api/visual/assets/bg-1");
  assert.equal(background[0].tag, "img");

  const strip = byClass(canvas, "panel-strip");
  assert.equal(strip.length, 1);
  assert.equal(canvas.children[0], background[0], "background is drawn below the panel strip");
  assert.equal(canvas.children[1], strip[0]);

  const panels = byClass(canvas, "panel");
  assert.equal(panels.length, 2);
  assert.equal(panels[0].style.overflow, "hidden");
  assert.equal(panels[1].style.overflow, "hidden");
  assert.equal(panels[1].style.borderLeft, `${FRAME_GEOMETRY.panelGutter}px solid #02090b`);

  const characters = byClass(canvas, "character-layer");
  assert.equal(characters.length, 2);
  assert.equal(characters[0].src, "/api/visual/assets/c0");
  assert.equal(characters[0].style.objectPosition, "40% 20%");
  assert.equal(characters[0].style.transformOrigin, "40% 20%");
  assert.equal(characters[0].style.transform, "scale(1.5)");
  assert.equal(characters[1].style.transform, "scale(1.25)");
  assert.equal(byClass(canvas, "panel-asset").length, 0, "hybrid mode uses character layers, not full-panel assets");

  const spoken = byClass(canvas, "dialogue-text");
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].textContent, "Слой проверка");
  const cells = byClass(canvas, "dialogue-cell");
  assert.equal(byClass(cells[0], "dialogue-text").length, 1);
  assert.equal(byClass(cells[1], "dialogue-text").length, 0);
});

test("historical visual mode still draws one opaque panel asset when hybrid layers are absent", () => {
  installDocument();
  const canvas = render({
    layout: "split2",
    speakerPanel: 1,
    dialogue: "История",
    fontSize: 31,
    panels: [
      {
        subject: "Путин",
        role: "Слушает",
        description: "слева",
        asset: "/api/visual/assets/full-0",
        zoom: 1,
        position: "50% 30%",
        align: "50% 30%",
      },
      {
        subject: "Дуров",
        role: "Говорит",
        description: "справа",
        asset: "/api/visual/assets/full-1",
        zoom: 1.2,
        position: "45% 28%",
        align: "45% 28%",
      },
    ],
  }, { mode: "visual" });
  assert.equal(byClass(canvas, "scene-background").length, 0);
  assert.equal(byClass(canvas, "character-layer").length, 0);
  const assets = byClass(canvas, "panel-asset");
  assert.equal(assets.length, 2);
  assert.equal(assets[1].style.transform, "scale(1.2)");
  assert.equal(byClass(canvas, "dialogue-text")[0].textContent, "История");
});
