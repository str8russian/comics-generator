import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { foregroundChip, foregroundPresentation } from "../public/panel-basis.mjs";

function createElement(tag) {
  const node = {
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
  return node;
}

function textOf(node) {
  const parts = [];
  const walk = (current) => {
    if (!current) return;
    if (current.textContent) parts.push(current.textContent);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return parts.join(" ");
}

test("the panel editor names a separated foreground and a neutral fallback", () => {
  assert.deepEqual(foregroundPresentation({
    assetId: "asset-1",
    extraction: {
      status: "candidate-pass",
      usesForeground: true,
      findings: [{ code: "canvas-edge-contact", level: "warning" }],
    },
  }), {
    label: "Фон отделён",
    status: "candidate-pass",
    codes: ["canvas-edge-contact"],
  });
  assert.equal(foregroundPresentation({
    assetId: "asset-2",
    extraction: {
      status: "review",
      usesForeground: false,
      findings: [{ code: "non-uniform-matte", level: "review" }],
    },
  }).label, "Фон не отделён");
  assert.deepEqual(foregroundPresentation({ assetId: "asset-3" }), {
    label: "Фон не отделён",
    status: "not-extracted",
    codes: ["not-extracted"],
  });
  assert.equal(foregroundPresentation({ assetId: null }), null);

  globalThis.document = { createElement };
  const chip = foregroundChip({
    assetId: "asset-2",
    extraction: {
      status: "reject",
      usesForeground: false,
      findings: [{ code: "inset-or-nested-canvas", level: "reject" }],
    },
  });
  assert.equal(chip.dataset.status, "reject");
  assert.equal(textOf(chip).includes("Фон не отделён"), true);
  assert.equal(textOf(chip).includes("inset-or-nested-canvas"), true);
  assert.equal(chip.querySelector ? false : chip.children.some((child) => child.tag === "details"), true);
});

test("the panel editor renders the extraction label beside the basis label", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.equal(source.includes("foregroundChip(frame.panels[panelIndex])"), true);
  assert.equal(source.includes("panel-basis-line"), true);
});
