import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

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
