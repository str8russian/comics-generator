import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SYSTEM_PANEL_BACKGROUND, SYSTEM_PANEL_BACKGROUND_RGB } from "../panel-background.mjs";
import { compileVideoSpec } from "../video-spec.mjs";
import { render } from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";

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

function placedPanel(overrides = {}) {
  return {
    subject: "Путин",
    role: "Говорит",
    description: "Крупный план",
    asset: "/original.png",
    position: "50% 30%",
    align: "50% 30%",
    zoom: 1.4,
    mirrored: true,
    ...overrides,
  };
}

test("the system panel background is the reference slate", () => {
  assert.deepEqual([...SYSTEM_PANEL_BACKGROUND_RGB], [93, 110, 134]);
  assert.equal(SYSTEM_PANEL_BACKGROUND, "#5d6e86");
});

test("FrameRenderer draws the foreground or the original with the same placement", () => {
  installDocument();
  const placement = {
    position: "41% 22%",
    align: "41% 22%",
    zoom: 1.6,
    mirrored: true,
  };
  const today = render({
    layout: "single",
    dialogueMode: "hidden",
    panels: [placedPanel({ asset: "/original.png", ...placement })],
  }, { mode: "visual" });
  const fallback = render({
    layout: "single",
    dialogueMode: "hidden",
    panels: [placedPanel({
      asset: "/original.png",
      backgroundColor: SYSTEM_PANEL_BACKGROUND,
      ...placement,
    })],
  }, { mode: "visual" });
  const foreground = render({
    layout: "single",
    dialogueMode: "hidden",
    panels: [placedPanel({
      asset: "/foreground.png",
      backgroundColor: SYSTEM_PANEL_BACKGROUND,
      ...placement,
    })],
  }, { mode: "visual" });
  const imageOf = (canvas) => byClass(canvas, "panel-asset")[0];
  const columnOf = (canvas) => byClass(canvas, "panel")[0];
  const todayImage = imageOf(today);
  const fallbackImage = imageOf(fallback);
  const foregroundImage = imageOf(foreground);
  assert.equal(fallbackImage.src, todayImage.src);
  assert.equal(fallbackImage.style.objectPosition, todayImage.style.objectPosition);
  assert.equal(fallbackImage.style.transform, todayImage.style.transform);
  assert.equal(fallbackImage.style.transformOrigin, todayImage.style.transformOrigin);
  assert.equal(columnOf(fallback).style.background, SYSTEM_PANEL_BACKGROUND);
  assert.equal(foregroundImage.src, "/foreground.png");
  assert.equal(foregroundImage.style.transform, todayImage.style.transform);
  assert.equal(columnOf(foreground).style.background, SYSTEM_PANEL_BACKGROUND);
  assert.equal(columnOf(today).style.background || "", "");
});

test("the video spec chooses the draw asset and carries the background", () => {
  const compiled = compileVideoSpec({
    status: "ready",
    frames: [{
      id: "frame-1",
      layout: "single",
      dialogueMode: "hidden",
      dialogue: "",
      durationFrames: 36,
      panels: [{
        id: "panel-1",
        assetId: "original-id",
        drawAssetId: "foreground-id",
        backgroundColor: SYSTEM_PANEL_BACKGROUND,
        extraction: { status: "candidate-pass", usesForeground: true },
        zoom: 1.2,
        positionX: 40,
        positionY: 20,
        position: "40% 20%",
        align: "40% 20%",
        mirrored: false,
      }, {
        id: "panel-2",
        assetId: "opaque-id",
        drawAssetId: "opaque-id",
        backgroundColor: SYSTEM_PANEL_BACKGROUND,
        extraction: { status: "review", usesForeground: false },
        zoom: 1,
        positionX: 50,
        positionY: 30,
        position: "50% 30%",
        align: "50% 30%",
        mirrored: true,
      }],
    }],
  }, { assetOrigin: "http://127.0.0.1:4180/api/projects/project-1" });
  assert.equal(compiled.ok, true);
  const [passed, review] = compiled.spec.frames[0].panels;
  assert.equal(passed.asset, "http://127.0.0.1:4180/api/projects/project-1/visual/assets/foreground-id");
  assert.equal(passed.sourceAssetId, "original-id");
  assert.equal(passed.usesForeground, true);
  assert.equal(passed.backgroundColor, SYSTEM_PANEL_BACKGROUND);
  assert.equal(passed.extractionStatus, "candidate-pass");
  assert.equal(review.asset, "http://127.0.0.1:4180/api/projects/project-1/visual/assets/opaque-id");
  assert.equal(review.usesForeground, false);
  assert.equal(review.extractionStatus, "review");
  assert.equal(review.backgroundColor, SYSTEM_PANEL_BACKGROUND);
  assert.equal(review.mirrored, true);
});

test("both Remotion compositions accept the foreground fields", () => {
  const video = readFileSync(new URL("../../../prototypes/remotion-rough/src/Video.jsx", import.meta.url), "utf8");
  const storyboard = readFileSync(new URL("../../../renderer-remotion/Storyboard.tsx", import.meta.url), "utf8");
  const types = readFileSync(new URL("../../../renderer-remotion/types.ts", import.meta.url), "utf8");
  assert.equal(video.includes("SYSTEM_PANEL_BACKGROUND"), true);
  assert.equal(video.includes("panel.backgroundColor"), true);
  assert.equal(storyboard.includes("panel.backgroundColor"), true);
  assert.equal(storyboard.includes("panel.drawAsset"), true);
  assert.equal(types.includes("extractionStatus"), true);
  assert.equal(types.includes("drawAsset"), true);
});
