globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
import assert from "node:assert/strict";
import test from "node:test";
import { buildAssetPicker } from "../public/asset-picker.mjs";
import { projectOperations } from "../public/research-dock.mjs";
import { compilePanelReadyIntent, compilePanelReadyPrompt, validateCharacterGeneration } from "../visual-model.mjs";

function createElement(tag) {
  const node = {
    tag,
    className: "",
    textContent: "",
    type: "",
    src: "",
    alt: "",
    children: [],
    append(...items) { this.children.push(...items); },
    addEventListener(type, listener) {
      this.listeners = this.listeners || {};
      this.listeners[type] = listener;
    },
    setAttribute() {},
  };
  return node;
}

test("the asset picker shows thumbnails, the current asset, and disk upload", () => {
  const selected = [];
  const uploads = [];
  const popover = buildAssetPicker({
    document: { createElement },
    currentAssetId: "asset-1",
    assets: [
      { id: "asset-1", url: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-1", kind: "uploaded-image", width: 10, height: 20 },
      { id: "asset-2", url: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-2", kind: "panel-image", width: 30, height: 40, provenance: "кадр 2" },
    ],
    onSelect: (asset) => selected.push(asset.id),
    onUpload: () => uploads.push(true),
  });
  assert.equal(popover.children[0].textContent, "Загрузить с диска…");
  const items = popover.children[1].children;
  assert.equal(items.length, 2);
  assert.match(items[0].className, /is-current/);
  assert.equal(items[0].children[0].src, "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-1");
  assert.equal(/×|Ш /.test(items[1].children[1].textContent), false);
  assert.match(items[1].children[1].textContent, /кадр 2/);
  assert.match(items[0].children[1].textContent, /текущее/);
  items[1].listeners.click();
  assert.deepEqual(selected, ["asset-2"]);
  popover.children[0].listeners.click();
  assert.deepEqual(uploads, [true]);
});

test("operations keep the submitted prompt from the start or the terminal snapshot", () => {
  const fromStart = projectOperations({
    events: [
      { eventKind: "action_start", correlationId: "c1", semanticAction: "panel_generate", submittedText: "сделай удивлённым", seq: 1 },
      { eventKind: "action_terminal", correlationId: "c1", semanticAction: "panel_generate", outcome: "success", submittedText: null, seq: 2 },
    ],
  });
  assert.equal(fromStart.at(-1).submittedText, "сделай удивлённым");
  const fromSnapshot = projectOperations({
    events: [
      {
        eventKind: "action_terminal",
        correlationId: "c2",
        semanticAction: "structure_edit",
        outcome: "success",
        seq: 3,
        startSnapshot: { submittedText: "сделай кадры плотнее" },
      },
    ],
  });
  assert.equal(fromSnapshot.at(-1).submittedText, "сделай кадры плотнее");
});

test("a manual character revision stays on the constrained prompt and blocks a missing subject", () => {
  const frame = {
    layout: "single",
    origin: "derived",
    frameKind: "image",
    panels: [{ manualSubject: "Дуров", description: "" }],
  };
  const blocked = validateCharacterGeneration({
    frame: { ...frame, panels: [{ description: "" }] },
    characters: [],
    styleSeedAssetId: "style",
    panelIndex: 0,
  });
  assert.equal(blocked.kind, "subject-required");
  const prompt = compilePanelReadyPrompt(compilePanelReadyIntent({
    frame,
    panelIndex: 0,
    characterName: "Дуров",
    description: "",
    instruction: "Измени на удивлённо-раздражённое",
  }), { hasPrevious: true, hasStyle: true });
  assert.match(prompt, /approved identity anchor for Дуров/);
  assert.match(prompt, /project style anchor/);
  assert.match(prompt, /previous result for this panel/);
  assert.match(prompt, /solid matte fill/);
  assert.match(prompt, /no nested panels/);
  assert.match(prompt, /Измени на удивлённо-раздражённое/);
});
