globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fontSizeFor, render } from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";
import { routes } from "../server.mjs";

const prototypeRoot = new URL("../../../prototypes/storyboard-viewer/", import.meta.url);
const canonicalRenderer = fileURLToPath(new URL("frame-renderer.mjs", prototypeRoot));

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

function dialogueSize(frame) {
  const canvas = render(frame, { mode: "structure", document: { createElement } });
  return byClass(canvas, "dialogue-text")[0].style.fontSize;
}

test("the prototype loads one module renderer after the classic storyboard script", () => {
  const html = readFileSync(new URL("image-storyboard.html", prototypeRoot), "utf8");
  const viewer = readFileSync(new URL("viewer.js", prototypeRoot), "utf8");
  const data = readFileSync(new URL("storyboard-data.js", prototypeRoot), "utf8");
  const classic = html.indexOf('<script src="storyboard-data.js"></script>');
  const moduleScript = html.indexOf('<script type="module" src="viewer.js"></script>');

  assert.equal(html.includes("frame-renderer.js"), false);
  assert.equal(existsSync(new URL("frame-renderer.js", prototypeRoot)), false);
  assert.equal(viewer.startsWith('import "./frame-renderer.mjs";\n'), true);
  assert.equal(classic >= 0, true);
  assert.equal(moduleScript > classic, true);
  assert.equal(html.includes('type="module" src="storyboard-data.js"'), false);
  assert.equal(/^\s*(import|export)\s/m.test(data), false);
  assert.equal(data.includes("window.STORYBOARD_DATA"), true);
});

test("fontSizeFor remains the fallback when a valid explicit fontSize is absent", () => {
  const shortLine = "Привет";
  assert.equal(dialogueSize({
    layout: "single",
    speakerPanel: 0,
    dialogue: shortLine,
    panels: [{ description: "Одна панель" }],
  }), `${fontSizeFor(shortLine, false)}px`);

  const longLine = "x".repeat(200);
  assert.equal(dialogueSize({
    layout: "split2",
    speakerPanel: 1,
    dialogue: longLine,
    fontSize: 12,
    panels: [{ description: "Левая панель" }, { description: "Правая панель" }],
  }), `${fontSizeFor(longLine, true)}px`);

  assert.equal(dialogueSize({
    layout: "single",
    speakerPanel: 0,
    dialogue: shortLine,
    fontSize: 42,
    panels: [{ description: "Одна панель" }],
  }), "42px");
  assert.notEqual(fontSizeFor(shortLine, false), 42);
});

test("the prototype and the application share one canonical renderer", () => {
  const canonical = realpathSync(canonicalRenderer);
  const overflowModule = new URL("../overflow.mjs", import.meta.url);
  const overflowRenderer = fileURLToPath(new URL("../../prototypes/storyboard-viewer/frame-renderer.mjs", overflowModule));
  const served = routes.find((route) => route.path === "/frame-renderer.mjs");
  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const overflow = readFileSync(overflowModule, "utf8");

  assert.equal(realpathSync(overflowRenderer), canonical);
  assert.equal(served.file, "prototypes/storyboard-viewer/frame-renderer.mjs");
  assert.equal(realpathSync(fileURLToPath(new URL(`../../../${served.file}`, import.meta.url))), canonical);
  assert.match(appJs, /from "\/frame-renderer\.mjs"/);
  assert.match(overflow, /new URL\("\.\.\/\.\.\/prototypes\/storyboard-viewer\/frame-renderer\.mjs", import\.meta\.url\)/);
  assert.match(overflow, /new URL\("\/frame-renderer\.mjs", import\.meta\.url\)/);
  assert.equal(existsSync(new URL("../frame-renderer.mjs", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/frame-renderer.mjs", import.meta.url)), false);
  assert.equal(existsSync(new URL("frame-renderer.js", prototypeRoot)), false);
});
