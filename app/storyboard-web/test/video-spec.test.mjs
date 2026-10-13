import assert from "node:assert/strict";
import test from "node:test";
import { compileVideoSpec } from "../video-spec.mjs";

test("compiles persisted placement, order, text, and duration into one video spec", () => {
  const compiled = compileVideoSpec({
    status: "ready",
    frames: [{
      id: "frame-2",
      structureFrameId: "frame-2",
      layout: "split2",
      dialogue: "Привет",
      speakerPanel: 1,
      panels: [
        { id: "right", assetId: "asset-right", zoom: 1.4, positionX: 41, positionY: 22, position: "41% 22%", align: "41% 22%", mirrored: true },
        { id: "left", assetId: "asset-left", zoom: 1, positionX: 50, positionY: 30, position: "50% 30%", align: "50% 30%", mirrored: false },
      ],
    }, {
      id: "card-1",
      structureFrameId: "card-1",
      frameKind: "text",
      textCard: "Пояснение",
      dialogue: "",
      durationFrames: 48,
      layout: "single",
      panels: [],
    }],
  }, { assetOrigin: "http://127.0.0.1:4173" });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.spec.project.width, 1920);
  assert.equal(compiled.spec.project.height, 1080);
  assert.equal(compiled.spec.project.fps, 30);
  assert.equal(compiled.spec.theme.panelGutterPx, 48);
  assert.equal(compiled.spec.theme.dialogueBarHeightPx, 300);
  assert.equal(Object.hasOwn(compiled.spec.theme, "dialogueBarBorderColor"), false);
  assert.equal(compiled.spec.frames[0].dialogue, "Привет");
  assert.equal(compiled.spec.frames[0].speakerPanel, 1);
  assert.equal(compiled.spec.frames[0].panels[0].mirrored, true);
  assert.equal(compiled.spec.frames[0].panels[0].zoom, 1.4);
  assert.equal(compiled.spec.frames[0].panels[0].positionX, 41);
  assert.equal(compiled.spec.frames[0].panels[0].asset, "http://127.0.0.1:4173/api/visual/assets/asset-right");
  assert.equal(compiled.spec.frames[1].kind, "text");
  assert.equal(compiled.spec.frames[1].textCard, "Пояснение");
  assert.equal(compiled.spec.frames[1].dialogue, "");
  assert.equal(compiled.spec.frames[1].durationFrames, 48);
  assert.equal(compiled.spec.frames[1].startFrame, compiled.spec.frames[0].durationFrames);
  assert.equal(
    compiled.spec.project.totalDurationFrames,
    compiled.spec.frames.reduce((sum, frame) => sum + frame.durationFrames, 0),
  );
});

test("a silent frame compiles to 36 frames when no duration is stored", () => {
  const compiled = compileVideoSpec({
    status: "ready",
    frames: [{
      id: "image-1",
      frameKind: "image",
      dialogue: "",
      layout: "single",
      panels: [{ id: "panel-1", assetId: null, zoom: 1, positionX: 50, positionY: 30, mirrored: false }],
    }],
  });
  assert.equal(compiled.spec.frames[0].durationFrames, 36);
  assert.equal(compiled.spec.frames[0].kind, "image");
  assert.equal(compiled.spec.frames[0].preRollFrames, 0);
});
