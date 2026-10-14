import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FONT_LADDER,
  FRAME_GEOMETRY,
  fontSizeFor,
  panByPointer,
  panelContentSize,
  render,
} from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";

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

test("pan follows the pointer at the rendered frame scale and stays on one panel", () => {
  const size = panelContentSize(2, true);
  assert.equal(size.width, (FRAME_GEOMETRY.width - FRAME_GEOMETRY.panelGutter) / 2);
  assert.equal(size.height, FRAME_GEOMETRY.height - FRAME_GEOMETRY.dialogueBarHeight);
  const scaled = panByPointer({
    positionX: 50,
    positionY: 30,
    deltaX: 46.8,
    deltaY: 39,
    frameScale: 0.5,
    panelWidth: size.width,
    panelHeight: size.height,
    mirrored: false,
  });
  const unscaled = panByPointer({
    positionX: 50,
    positionY: 30,
    deltaX: 93.6,
    deltaY: 78,
    frameScale: 1,
    panelWidth: size.width,
    panelHeight: size.height,
    mirrored: false,
  });
  assert.equal(scaled.positionX, 40);
  assert.equal(scaled.positionY, 20);
  assert.deepEqual(scaled, unscaled);
  const mirrored = panByPointer({
    positionX: 50,
    positionY: 30,
    deltaX: 46.8,
    deltaY: 0,
    frameScale: 0.5,
    panelWidth: size.width,
    panelHeight: size.height,
    mirrored: true,
  });
  assert.equal(mirrored.positionX, 60);
  assert.equal(mirrored.positionY, 30);
  const other = panByPointer({
    positionX: 10,
    positionY: 80,
    deltaX: 0,
    deltaY: 0,
    frameScale: 0.5,
    panelWidth: size.width,
    panelHeight: size.height,
  });
  assert.deepEqual(other, { positionX: 10, positionY: 80 });
  assert.equal(panByPointer({
    positionX: 50,
    positionY: 30,
    deltaX: Number.NaN,
    deltaY: 0,
    frameScale: 0.5,
    panelWidth: size.width,
    panelHeight: size.height,
  }), null);
  const clamped = panByPointer({
    positionX: 1,
    positionY: 99,
    deltaX: 10000,
    deltaY: -10000,
    frameScale: 0.5,
    panelWidth: size.width,
    panelHeight: size.height,
  });
  assert.equal(clamped.positionX, 0);
  assert.equal(clamped.positionY, 100);
});

test("keeps the viewer.css declarations measurement depends on", () => {
  const css = readFileSync(new URL("../../../prototypes/storyboard-viewer/viewer.css", import.meta.url), "utf8");
  for (const declaration of [
    "Arial, Helvetica, sans-serif",
    "border-box",
    "font-weight: 500",
    "letter-spacing: .1px",
    "line-height: 1.18",
    "overflow-wrap: anywhere",
  ]) {
    assert.equal(css.includes(declaration), true, declaration);
  }
});

test("removes the horizontal hairline and keeps the 48px split divider", () => {
  const css = readFileSync(new URL("../../../prototypes/storyboard-viewer/viewer.css", import.meta.url), "utf8");
  const dialogueBar = css.match(/\.dialogue-bar\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.equal(/border-top\s*:/.test(dialogueBar), false);
  assert.equal(css.includes("border-top: 2px solid #536064"), false);
  installDocument();
  const split = render({
    layout: "split2",
    speakerPanel: 0,
    dialogue: "Привет",
    panels: [
      {
        description: "Левая",
        asset: "/left.png",
        subject: "Левая",
        role: "Говорит",
        position: "40% 20%",
        align: "40% 20%",
        zoom: 1.4,
        mirrored: true,
      },
      {
        description: "Правая",
        asset: "/right.png",
        subject: "Правая",
        role: "Слушает",
        position: "70% 55%",
        align: "70% 55%",
        zoom: 1.1,
        mirrored: false,
      },
    ],
  }, { mode: "visual" });
  const panels = byClass(split, "panel");
  const cells = byClass(split, "dialogue-cell");
  const images = byClass(split, "panel-asset");
  assert.equal(panels[0].style.borderLeft, undefined);
  assert.equal(panels[1].style.borderLeft, `${FRAME_GEOMETRY.panelGutter}px solid #02090b`);
  assert.equal(cells[0].style.borderLeft, undefined);
  assert.equal(cells[1].style.borderLeft, `${FRAME_GEOMETRY.panelGutter}px solid #02090b`);
  assert.equal(images[0].style.objectPosition, "40% 20%");
  assert.equal(images[0].style.transform, "scaleX(-1) scale(1.4)");
  assert.equal(images[1].style.objectPosition, "70% 55%");
  assert.equal(images[1].style.transform, "scale(1.1)");
  assert.equal(images[0].draggable, false);

  const single = render({
    layout: "single",
    speakerPanel: 0,
    dialogue: "Одна",
    panels: [{
      description: "Одна",
      asset: "/one.png",
      subject: "Одна",
      role: "Говорит",
      position: "50% 30%",
      align: "50% 30%",
      zoom: 1,
    }],
  }, { mode: "visual" });
  assert.equal(byClass(single, "panel")[0].style.borderLeft, undefined);
  assert.equal(byClass(single, "dialogue-cell")[0].style.borderLeft, undefined);
  assert.equal(byClass(single, "panel-asset")[0].style.transform, "scale(1)");
  assert.equal(byClass(single, "dialogue-bar").length, 1);
});

test("a visual frame shows a ready panel beside an empty placeholder", () => {
  installDocument();
  const mixed = render({
    layout: "split2",
    dialogue: "",
    panels: [
      { description: "Есть", asset: "/one.png", subject: "А", role: "Действие", position: "50% 30%", align: "50% 30%", zoom: 1 },
      { description: "Нет", subject: "Б", role: "Действие" },
    ],
  }, { mode: "visual" });
  assert.equal(byClass(mixed, "panel-asset").length, 1);
  assert.equal(byClass(mixed, "panel-placeholder")[0].textContent, "Нет изображения");
  assert.equal(byClass(mixed, "panel")[1].style.borderLeft, `${FRAME_GEOMETRY.panelGutter}px solid #02090b`);
});

test("text cards render owner text without a dialogue bar", () => {
  installDocument();
  const card = render({
    frameKind: "text",
    textCard: "Пояснение",
    dialogue: "",
    layout: "single",
    panels: [],
  }, { mode: "visual" });
  assert.equal(card.dataset.kind, "text");
  assert.equal(byClass(card, "text-card")[0].textContent, "Пояснение");
  assert.equal(byClass(card, "dialogue-bar").length, 0);
});

test("remotion frame drops the horizontal hairline and keeps mirror plus the gutter", () => {
  const source = readFileSync(new URL("../../../prototypes/remotion-rough/src/Video.jsx", import.meta.url), "utf8");
  assert.equal(source.includes("borderTop"), false);
  assert.equal(source.includes("2px solid"), false);
  assert.match(source, /panel\.mirrored \? 'scaleX\(-1\) '/);
  assert.match(source, /theme\.panelGutterPx/);
  assert.match(source, /frame\.kind === 'text'/);
});
