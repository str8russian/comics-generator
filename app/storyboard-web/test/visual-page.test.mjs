import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { ANCHOR_ASSETS } from "../public/visual-anchors.mjs";

function createElement() {
  const listeners = new Map();
  return {
    hidden: false,
    textContent: "",
    value: "",
    dataset: {},
    style: {},
    className: "",
    disabled: false,
    children: [],
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    replaceChildren(...nodes) {
      this.children = nodes.slice();
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    querySelectorAll() {
      return [];
    },
  };
}

function installDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], createElement());
  }
  const body = createElement();
  globalThis.document = {
    body,
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      return elements.get(selector.slice(1)) ?? null;
    },
    createElement,
  };
  return elements;
}

async function loadVisualPage() {
  installDocument(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"));
  register(new URL("./draft-page-loader.mjs", import.meta.url));
  return import("../public/app.js");
}

test("generationFailures block full-success copy even when visualReady remains true", async () => {
  const page = await loadVisualPage();
  const notice = page.frameAttemptNotice({
    generationFailures: [{ panelIndex: 1, kind: "provider" }],
    visualReady: true,
  });
  assert.equal(notice.kind, "error");
  assert.match(notice.text, /частично|Не удалось/i);
  assert.equal(/Кадр готов\. Проверьте изображения\./.test(notice.text), false);
});

test("failed replacement keeps retained previous copy and asset id visible", async () => {
  const page = await loadVisualPage();
  const attempt = page.describePanelAttempt({
    generationStatus: "failed",
    generationError: "timeout",
    assetId: "prev-ready",
    asset: "/api/visual/assets/prev-ready",
  });
  assert.equal(attempt.retained, true);
  assert.equal(attempt.retainedAssetId, "prev-ready");
  assert.match(attempt.failureText, /предыдущ/i);
  assert.match(attempt.failureText, /слишком много времени|Генерация/i);
});

test("style-required and subject-required have clear Russian actionable messages", async () => {
  const page = await loadVisualPage();
  const style = page.actionMessage("style-required");
  const subject = page.actionMessage("subject-required");
  assert.match(style, /стил/i);
  assert.match(style, /утверд|нужен|нужно|сначала/i);
  assert.match(subject, /персонаж|субъект|герой|кто/i);
  assert.match(subject, /укаж|назнач|сначала|нужн/i);
  assert.equal(style.includes("Не удалось выполнить действие"), false);
  assert.equal(subject.includes("Не удалось выполнить действие"), false);
});

test("matched demo frame uses reusable anchors without generated Visual state", async () => {
  const page = await loadVisualPage();
  const frame = {
    layout: "split2",
    speakerPanel: 0,
    dialogue: "Значит, Павел Валерьевич, мы решили.",
    visualReady: false,
    panels: [
      { description: "Путин за столом" },
      { description: "Дуров напротив" },
    ],
  };
  const presented = page.presentFrameForMount(frame);
  assert.equal(presented.source, "demo-anchor");
  assert.equal(presented.mode, "visual");
  assert.deepEqual(presented.frame.panels.map((panel) => panel.asset), [
    ANCHOR_ASSETS.putin,
    ANCHOR_ASSETS.durov,
  ]);
  assert.equal(frame.visualReady, false);
});

test("generated ready assets take precedence over reusable demo anchors", async () => {
  const page = await loadVisualPage();
  const frame = {
    layout: "split2",
    speakerPanel: 1,
    dialogue: "А что с блокировкой?",
    visualReady: true,
    panels: [
      {
        description: "Путин за столом",
        assetId: "gen-putin",
        asset: "/api/visual/assets/gen-putin",
        generationStatus: "ready",
      },
      {
        description: "Дуров напротив",
        assetId: "gen-durov",
        asset: "/api/visual/assets/gen-durov",
        generationStatus: "ready",
      },
    ],
  };
  const presented = page.presentFrameForMount(frame);
  assert.equal(presented.source, "generated");
  assert.equal(presented.mode, "visual");
  assert.deepEqual(presented.frame.panels.map((panel) => panel.asset), [
    "/api/visual/assets/gen-putin",
    "/api/visual/assets/gen-durov",
  ]);
  assert.equal(presented.frame.panels.some((panel) => String(panel.asset || "").includes("/character-anchors/")), false);
});

test("partial generated frame does not fill missing panels with demo anchors", async () => {
  const page = await loadVisualPage();
  const frame = {
    layout: "split2",
    speakerPanel: 0,
    dialogue: "Значит, Павел Валерьевич, мы решили.",
    visualReady: false,
    panels: [
      {
        description: "Путин за столом",
        assetId: "gen-putin",
        asset: "/api/visual/assets/gen-putin",
        generationStatus: "ready",
      },
      {
        description: "Дуров напротив",
        assetId: null,
        asset: null,
        generationStatus: "failed",
        generationError: "provider",
      },
    ],
  };
  const presented = page.presentFrameForMount(frame);
  assert.equal(presented.source, "generated");
  assert.equal(presented.mode, "structure");
  assert.equal(presented.frame.panels[1].asset, null);
  assert.equal(String(presented.frame.panels[1].asset || "").includes("/character-anchors/"), false);
  const notice = page.frameAttemptNotice({
    generationFailures: [{ panelIndex: 1, kind: "provider" }],
    visualReady: false,
  });
  assert.equal(notice.kind, "error");
  assert.equal(/Кадр готов\. Проверьте изображения\./.test(notice.text), false);
});

test("unmatched demo frame stays in Structure presentation", async () => {
  const page = await loadVisualPage();
  const frame = {
    layout: "split2",
    speakerPanel: 0,
    dialogue: "Значит, Павел Валерьевич, мы решили.",
    visualReady: false,
    panels: [
      { description: "Путин за столом" },
      { description: "Слушатель без имени" },
    ],
  };
  const presented = page.presentFrameForMount(frame);
  assert.equal(presented.source, "structure");
  assert.equal(presented.mode, "structure");
  assert.equal(presented.frame.panels[0].asset, undefined);
});

test("captureResearchContext keeps distinct display and structure frame identity for open detail", async () => {
  const page = await loadVisualPage();
  page.setResearchDetailState([{
    id: "display-2",
    structureFrameId: "structure-1",
    structureSegmentIndex: 0,
    dialogue: "Реплика",
    panels: [{ description: "Кадр" }],
  }], 0);

  const context = page.captureResearchContext();
  assert.equal(context.displayFrameId, "display-2");
  assert.equal(context.structureFrameId, "structure-1");
  assert.equal(context.structureSegmentIndex, 0);
  assert.equal(context.displayFrameNumber, 1);
  assert.notEqual(context.displayFrameId, context.structureFrameId);

  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(appJs, /getContext:\s*captureResearchContext/);
});

test("research context keeps frame identity null when no detail frame is active", async () => {
  const page = await loadVisualPage();
  page.setResearchDetailState([
    {
      id: "display-2",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
    },
  ], -1);
  const context = page.captureResearchContext();
  assert.equal(context.displayFrameId, null);
  assert.equal(context.structureFrameId, null);
  assert.equal(context.structureSegmentIndex, null);
  assert.equal(context.displayFrameNumber, null);
});
