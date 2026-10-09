import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBriefsExcludeCompiledPrompt,
  buildHybridVisualIntent,
} from "../visual-intent.mjs";
import { compileCharacterStatePrompt } from "../visual-model.mjs";

test("hybrid visual intent separates layered fields, grid copy, and detailed brief", () => {
  const built = buildHybridVisualIntent({
    project: { styleSeedAssetId: "style-1", visualDirection: "graphic contour comic" },
    scene: { sceneKey: "primary", continuity: "dim Kremlin corridor", identity: "primary-corridor" },
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
  assert.equal(built.intent.project.visualDirection, "graphic contour comic");
  assert.equal(built.intent.project.renderingLanguage, "project-style-seed");
  assert.equal(built.intent.scene.sceneKey, "primary");
  assert.equal(built.intent.scene.identity, "primary-corridor");
  assert.equal(built.intent.scene.peopleFree, true);
  assert.equal(built.intent.frame.compositionMode, "inward-conversation");
  assert.equal(built.intent.panels.length, 2);
  assert.equal(built.intent.panels[0].subject, "Путин");
  assert.deepEqual(built.intent.panels[0].visibleCharacters, ["Путин"]);
  assert.deepEqual(built.intent.panels[1].visibleCharacters, ["Дуров"]);
  assert.deepEqual(built.intent.panels[0].offscreenOthers, ["Дуров"]);
  assert.equal(built.intent.panels[0].role, "speaker");
  assert.equal(built.intent.panels[1].role, "listener");
  assert.equal(built.intent.panels[0].shotScale, "chest-up");
  assert.equal(built.intent.panels[0].gazeOrScreenDirection, "subtle-inward-right");
  assert.equal(built.intent.panels[1].gazeOrScreenDirection, "subtle-inward-left");
  assert.match(built.intent.panels[0].expressionAndPose, /calm conversational/);
  assert.match(built.intent.panels[0].cropAndSafeMargins, /safe margins/);
  assert.ok(built.intent.panels[0].prohibitedContent.includes("second-visible-person"));
  assert.ok(built.intent.prohibitedContent.includes("nested-panels"));
  assert.match(built.gridDescription, /inward-conversation/);
  assert.match(built.gridDescription, /Путин/);
  assert.ok(built.gridDescription.length <= 240);
  assert.match(built.detailedBrief, /Composition mode: inward-conversation/);
  assert.match(built.detailedBrief, /dim Kremlin corridor/);
  assert.match(built.detailedBrief, /Panel 1 \(speaker\): Путин/);
  assert.match(built.detailedBrief, /Off-screen context only: Дуров/);
  assert.match(built.detailedBrief, /Visible: Путин/);
  assert.match(built.detailedBrief, /Shot: chest-up/);
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

test("visual intent defaults are deterministic and explicit values override them", () => {
  const defaults = buildHybridVisualIntent({
    frame: {
      id: "frame-defaults",
      compositionMode: "near-frontal-pair",
      speakerPanel: 0,
    },
    panels: [
      { subject: "A", description: "speaks", offscreenOthers: ["B", "A"] },
      { subject: "B", description: "listens", offscreenOthers: ["A"] },
    ],
  });
  assert.equal(defaults.intent.project.visualDirection, "project-style-seed");
  assert.equal(defaults.intent.scene.identity, "version-scoped-primary");
  assert.equal(defaults.intent.panels[0].role, "speaker");
  assert.equal(defaults.intent.panels[1].role, "listener");
  assert.equal(defaults.intent.panels[0].shotScale, "chest-up");
  assert.equal(defaults.intent.panels[0].gazeOrScreenDirection, "near-frontal-subtle-right");
  assert.equal(defaults.intent.panels[1].gazeOrScreenDirection, "near-frontal-subtle-left");
  assert.deepEqual(defaults.intent.panels[0].visibleCharacters, ["A"]);
  assert.deepEqual(defaults.intent.panels[0].offscreenOthers, ["B"]);

  const overridden = buildHybridVisualIntent({
    project: { visualDirection: "hard ink", renderingLanguage: "cel-shade" },
    scene: { identity: "office-primary", continuity: "bright office" },
    frame: { id: "frame-o", compositionMode: "asymmetric-pair", speakerPanel: 1 },
    panels: [{
      subject: "Песков",
      description: "reacts",
      role: "reaction",
      shotScale: "medium-close",
      gazeOrScreenDirection: "screen-left",
      expressionAndPose: "wide eyes, raised brows",
      cropAndSafeMargins: "tight headroom, keep chin clear",
      visibleCharacters: ["Песков", "Путин"],
      offscreenOthers: ["Путин"],
      prohibitedContent: ["nested-panels", "crowd"],
    }],
  });
  assert.equal(overridden.intent.project.visualDirection, "hard ink");
  assert.equal(overridden.intent.project.renderingLanguage, "cel-shade");
  assert.equal(overridden.intent.scene.identity, "office-primary");
  assert.equal(overridden.intent.panels[0].role, "reaction");
  assert.equal(overridden.intent.panels[0].shotScale, "medium-close");
  assert.equal(overridden.intent.panels[0].gazeOrScreenDirection, "screen-left");
  assert.equal(overridden.intent.panels[0].expressionAndPose, "wide eyes, raised brows");
  assert.equal(overridden.intent.panels[0].cropAndSafeMargins, "tight headroom, keep chin clear");
  assert.deepEqual(overridden.intent.panels[0].visibleCharacters, ["Песков"]);
  assert.deepEqual(overridden.intent.panels[0].prohibitedContent, ["nested-panels", "crowd"]);
  assert.doesNotMatch(overridden.gridDescription, /wide eyes, raised brows/);
  assert.match(overridden.detailedBrief, /wide eyes, raised brows/);
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
    assert.deepEqual(built.intent.panels[0].visibleCharacters, ["A"]);
    assert.deepEqual(built.intent.panels[1].visibleCharacters, ["B"]);
  }
});
