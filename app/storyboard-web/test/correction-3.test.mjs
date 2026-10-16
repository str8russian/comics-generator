globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { metadataCarryDecision, visibleFrameSignature } from "../assembly.mjs";
import {
  anchorIntersectsViewport,
  closeAssetPicker,
  openAssetPicker,
  placeAssetPicker,
} from "../public/asset-picker.mjs";
import { projectOperations } from "../public/research-dock.mjs";

test("the image picker flips, clamps, and closes when the anchor leaves", () => {
  const viewport = { width: 1000, height: 700 };
  const below = placeAssetPicker({
    anchor: { top: 40, bottom: 80, left: 20, right: 180, width: 160, height: 40 },
    popoverHeight: 240,
    viewport,
  });
  assert.equal(below.placement, "below");
  assert.equal(below.width, 600);
  const above = placeAssetPicker({
    anchor: { top: 640, bottom: 680, left: 20, right: 180, width: 160, height: 40 },
    popoverHeight: 240,
    viewport,
  });
  assert.equal(above.placement, "above");
  assert.ok(above.top + above.height <= viewport.height);
  const right = placeAssetPicker({
    anchor: { top: 40, bottom: 80, left: 940, right: 990, width: 50, height: 40 },
    popoverHeight: 200,
    viewport,
  });
  assert.equal(right.left + right.width <= viewport.width - 8, true);
  assert.equal(anchorIntersectsViewport(
    { top: -40, bottom: -1, left: 0, right: 10, width: 10, height: 10 },
    viewport,
  ), false);
});

test("the picker focuses the current asset, closes on select, and restores the anchor", () => {
  const focused = [];
  const listeners = new Map();
  function element(tag) {
    const node = {
      tag,
      className: "",
      textContent: "",
      type: "",
      src: "",
      alt: "",
      dataset: {},
      style: {},
      children: [],
      parentNode: null,
      isConnected: true,
      append(...items) {
        for (const item of items) {
          item.parentNode = node;
          node.children.push(item);
        }
      },
      addEventListener(type, listener) {
        node.listeners = node.listeners || {};
        node.listeners[type] = listener;
      },
      setAttribute() {},
      focus() { focused.push(node); },
      querySelectorAll() {
        const found = [];
        const visit = (current) => {
          for (const child of current.children || []) {
            if (child.tag === "button") found.push(child);
            visit(child);
          }
        };
        visit(node);
        return found;
      },
      contains(target) {
        if (target === node) return true;
        return (node.children || []).some((child) => child === target || child.contains?.(target));
      },
      remove() { node.parentNode = null; },
    };
    return node;
  }
  const body = element("body");
  const anchor = element("button");
  anchor.getBoundingClientRect = () => ({ top: 40, bottom: 70, left: 20, right: 160, width: 140, height: 30 });
  const document = {
    body,
    activeElement: null,
    createElement: element,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const window = {
    innerWidth: 1000,
    innerHeight: 700,
    addEventListener() {},
    removeEventListener() {},
  };
  const selected = [];
  const popover = openAssetPicker({
    document,
    window,
    anchor,
    currentAssetId: "asset-2",
    assets: [
      { id: "asset-1", url: "/a", provenance: { subject: "Дуров", origin: "generation" } },
      { id: "asset-2", url: "/b", provenance: { subject: "Дуров", origin: "generation" } },
      { id: "asset-3", url: "/c", provenance: { origin: "upload" } },
    ],
    onSelect: (asset) => selected.push(asset.id),
  });
  assert.equal(popover.children[0].textContent, "Загрузить с диска…");
  assert.equal(popover.children[1].className, "asset-picker-list");
  assert.equal(focused.at(-1).dataset.assetId, "asset-2");
  assert.equal(/×/.test(popover.textContent || focused.at(-1).textContent), false);
  focused.at(-1).listeners.click();
  assert.deepEqual(selected, ["asset-2"]);
  assert.equal(focused.at(-1), anchor);
  closeAssetPicker();
});

test("operations distinguish the same action on two panels and keep revision text", () => {
  const events = [1, 2].flatMap((panel) => ([
    {
      eventKind: "action_start",
      correlationId: `panel-${panel}`,
      semanticAction: "asset_assign",
      submittedText: null,
      commandTarget: { kind: "panel", displayFrameNumber: 13, panelIndex: panel - 1, panelId: `panel-${panel}` },
      seq: panel,
    },
    {
      eventKind: "action_terminal",
      correlationId: `panel-${panel}`,
      semanticAction: "asset_assign",
      outcome: "success",
      submittedText: null,
      commandTarget: { kind: "panel", displayFrameNumber: 13, panelIndex: panel - 1 },
      seq: panel + 2,
    },
  ]));
  events.push(
    {
      eventKind: "action_start",
      correlationId: "revision",
      semanticAction: "panel_generate",
      submittedText: "Измени текущее изображение Дурова на удивлённо-раздражённое",
      commandTarget: { kind: "panel", displayFrameNumber: 4, panelIndex: 0 },
      seq: 5,
    },
    {
      eventKind: "action_terminal",
      correlationId: "revision",
      semanticAction: "panel_generate",
      outcome: "success",
      seq: 6,
    },
  );
  const items = projectOperations({ events });
  const labels = items.map((item) => `${item.label} ${item.submittedText || ""}`.trim());
  assert.match(labels.join("\n"), /кадр 13, панель 1/);
  assert.match(labels.join("\n"), /кадр 13, панель 2/);
  assert.match(labels.join("\n"), /Измени текущее изображение Дурова на удивлённо-раздражённое/);
  const unchanged = projectOperations({
    events: [{
      eventKind: "action_terminal",
      correlationId: "same",
      semanticAction: "frame_duration",
      outcome: "no-change",
      seq: 1,
    }],
  });
  assert.equal(unchanged[0].status, "no-change");
  assert.match(unchanged[0].label, /Без изменений/);
});

test("blank manual panels carry an accepted subject, and source intent does not", () => {
  const provenance = {
    origin: "generation",
    subject: "Дуров",
    description: "Дуров смотрит в камеру",
    submittedText: "сделай спокойным",
  };
  const blank = metadataCarryDecision({
    frame: { origin: "derived", frameKind: "image" },
    panel: { description: "", manualSubject: "" },
    provenance,
    castNames: ["Дуров"],
  });
  assert.equal(blank.mode, "carry");
  assert.equal(blank.subject, "Дуров");
  const source = metadataCarryDecision({
    frame: { origin: "source", frameKind: null },
    panel: { description: "Исходный замысел", manualSubject: "" },
    provenance,
    castNames: ["Дуров"],
    carryMetadata: true,
  });
  assert.equal(source.mode, "bytes");
  const explicit = metadataCarryDecision({
    frame: { origin: "derived", frameKind: "image" },
    panel: { description: "свой текст", manualSubject: "Дуров" },
    provenance,
    castNames: ["Дуров"],
    carryMetadata: true,
  });
  assert.equal(explicit.mode, "carry");
  const unknown = metadataCarryDecision({
    frame: { origin: "derived", frameKind: "image" },
    panel: { description: "", manualSubject: "" },
    provenance: { origin: "upload" },
    castNames: ["Дуров"],
  });
  assert.equal(unknown.mode, "bytes");
  const before = visibleFrameSignature([{ id: "a", panels: [{ id: "p", description: "" }] }]);
  const after = visibleFrameSignature([{ id: "a", panels: [{ id: "p", description: "" }] }]);
  assert.equal(before, after);
});

test("the primary assembly files do not keep a second undo or the panel note", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.equal(html.includes("undo-structure"), false);
  assert.equal(app.includes("undo-structure"), false);
  assert.equal(app.includes("Заметка к панели"), false);
  assert.equal(app.includes("Предыдущая структура восстановлена"), false);
  assert.match(css, /grid-template-columns:\s*repeat\(3/);
  assert.match(css, /position:\s*sticky/);
  assert.equal(/^\s*margin:\s*-12px/m.test(css.slice(css.indexOf(".asset-picker-meta"))), false);
});
