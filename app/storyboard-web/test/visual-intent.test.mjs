import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBriefsExcludeCompiledPrompt,
  buildHybridVisualIntent,
} from "../visual-intent.mjs";
import { compileCharacterStatePrompt } from "../visual-model.mjs";

test("hybrid visual intent separates layered fields, grid copy, and detailed brief", () => {
  const built = buildHybridVisualIntent({
    project: { styleSeedAssetId: "style-1" },
    scene: { sceneKey: "primary", continuity: "dim Kremlin corridor" },
    frame: {
      id: "frame-1#1",
      layout: "split2",
      compositionMode: "inward-conversation",
      speakerPanel: 0,
      dialogue: "Привет",
    },
    panels: [
      {
        panelIndex: 0,
        subject: "Путин",
        description: "говорит спокойно",
        role: "speaker",
        offscreenOthers: ["Дуров"],
      },
      {
        panelIndex: 1,
        subject: "Дуров",
        description: "слушает напряжённо",
        role: "listener",
        offscreenOthers: ["Путин"],
      },
    ],
  });

  assert.equal(built.intent.project.styleAuthorityRequired, true);
  assert.equal(built.intent.project.styleSeedAssetId, "style-1");
  assert.equal(built.intent.scene.sceneKey, "primary");
  assert.equal(built.intent.scene.peopleFree, true);
  assert.equal(built.intent.frame.compositionMode, "inward-conversation");
  assert.equal(built.intent.panels.length, 2);
  assert.equal(built.intent.panels[0].subject, "Путин");
  assert.match(built.gridDescription, /inward-conversation/);
  assert.match(built.gridDescription, /Путин/);
  assert.match(built.detailedBrief, /Composition mode: inward-conversation/);
  assert.match(built.detailedBrief, /dim Kremlin corridor/);
  assert.match(built.detailedBrief, /Panel 1 \(speaker\): Путин/);
  assert.match(built.detailedBrief, /Off-screen context only: Дуров/);
  assert.ok(built.gridDescription.length < built.detailedBrief.length);

  const compiled = compileCharacterStatePrompt({
    characterName: "Путин",
    description: "говорит спокойно",
    identityAsset: { id: "id-1" },
    styleAsset: { id: "style-1" },
  });
  assert.equal(compiled.ok, true);
  assert.equal(
    assertBriefsExcludeCompiledPrompt(built, compiled.prompt),
    true,
    "ordinary UI briefs must never embed the full compiled provider prompt",
  );
  assert.equal(built.detailedBrief.includes(compiled.prompt), false);
  assert.equal(built.gridDescription.includes("#00FF00"), false);
});

test("composition modes include the approved pair variants", () => {
  for (const compositionMode of ["near-frontal-pair", "inward-conversation", "asymmetric-pair"]) {
    const built = buildHybridVisualIntent({
      frame: { id: "frame-x", compositionMode, panels: [{ description: "a" }, { description: "b" }] },
      panels: [
        { subject: "A", description: "left" },
        { subject: "B", description: "right" },
      ],
    });
    assert.equal(built.intent.frame.compositionMode, compositionMode);
    assert.match(built.gridDescription, new RegExp(compositionMode));
  }
});
