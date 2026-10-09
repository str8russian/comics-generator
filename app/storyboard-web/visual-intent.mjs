const COMPOSITION_MODES = new Set([
  "near-frontal-pair",
  "inward-conversation",
  "asymmetric-pair",
]);

const DEFAULT_PROHIBITED = Object.freeze([
  "nested-panels",
  "split-screen-layout",
  "second-visible-person",
  "dialogue-text",
  "speech-bubbles",
  "captions",
  "logos",
  "watermarks",
  "gutters",
  "borders",
]);

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function defaultCompositionMode(frame) {
  if (COMPOSITION_MODES.has(frame?.compositionMode)) return frame.compositionMode;
  return "near-frontal-pair";
}

function panelSubject(panel, fallbackIndex) {
  return clean(panel?.subject || panel?.characterName || `panel-${fallbackIndex}`, 160);
}

function defaultRole(panel, index, speakerPanel) {
  if (panel?.role === "speaker" || panel?.role === "listener" || panel?.role === "reaction") {
    return panel.role;
  }
  if (Number.isInteger(speakerPanel)) {
    return index === speakerPanel ? "speaker" : "listener";
  }
  return "reaction";
}

function defaultGaze(compositionMode, panelIndex, panelCount) {
  if (compositionMode === "inward-conversation") {
    if (panelCount >= 2 && panelIndex === 0) return "subtle-inward-right";
    if (panelCount >= 2 && panelIndex === panelCount - 1) return "subtle-inward-left";
  }
  if (compositionMode === "asymmetric-pair") {
    return panelIndex === 0 ? "near-frontal-right-bias" : "near-frontal-left-bias";
  }
  // near-frontal-pair and fallback
  if (panelCount >= 2 && panelIndex === 0) return "near-frontal-subtle-right";
  if (panelCount >= 2 && panelIndex === panelCount - 1) return "near-frontal-subtle-left";
  return "near-frontal";
}

function namesList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((name) => clean(name, 160)).filter(Boolean);
}

/**
 * Layered visual intent for split dialogue frames (FR-026).
 * Produces structured intent plus concise grid copy and an expanded human brief.
 * Ordinary UI-facing briefs never embed the full compiled provider prompt.
 */
export function buildHybridVisualIntent({
  project = {},
  scene = {},
  frame = {},
  panels = [],
} = {}) {
  const compositionMode = defaultCompositionMode(frame);
  const sceneKey = scene.sceneKey || "primary";
  const sourcePanels = panels.length ? panels : frame.panels || [];
  const panelCount = sourcePanels.length;

  const panelIntents = sourcePanels.map((panel, index) => {
    const subject = panelSubject(panel, index);
    const role = defaultRole(panel, index, frame.speakerPanel);
    const offscreenOthers = namesList(panel.offscreenOthers)
      .filter((name) => name !== subject);
    const visibleCharacters = namesList(panel.visibleCharacters).length
      ? namesList(panel.visibleCharacters).filter((name) => name === subject)
      : [subject];
    // Ordinary character-state panels expose only the assigned subject as visible.
    if (!visibleCharacters.includes(subject)) visibleCharacters.unshift(subject);
    const uniqueVisible = [...new Set(visibleCharacters.filter((name) => name === subject))];

    return {
      panelIndex: Number.isInteger(panel.panelIndex) ? panel.panelIndex : index,
      subject,
      description: clean(panel.description, 800),
      role,
      visibleCharacters: uniqueVisible,
      offscreenOthers,
      shotScale: clean(panel.shotScale || "chest-up", 80),
      gazeOrScreenDirection: clean(
        panel.gazeOrScreenDirection || defaultGaze(compositionMode, index, panelCount),
        160,
      ),
      expressionAndPose: clean(
        panel.expressionAndPose || "calm conversational near-frontal performance with mouth visible",
        400,
      ),
      cropAndSafeMargins: clean(
        panel.cropAndSafeMargins
          || "safe margins around head and shoulders for later placement zoom and pan",
        400,
      ),
      prohibitedContent: namesList(panel.prohibitedContent).length
        ? namesList(panel.prohibitedContent)
        : [...DEFAULT_PROHIBITED],
    };
  });

  const intent = {
    project: {
      visualDirection: clean(project.visualDirection || "project-style-seed", 200),
      styleAuthorityRequired: true,
      styleSeedAssetId: project.styleSeedAssetId ?? null,
      renderingLanguage: project.renderingLanguage || "project-style-seed",
    },
    scene: {
      sceneKey,
      identity: clean(scene.identity || `version-scoped-${sceneKey}`, 200),
      peopleFree: true,
      continuity: clean(scene.continuity || frame.sceneDescription || "shared dialogue interior", 800),
    },
    frame: {
      frameId: frame.id || frame.frameId || null,
      layout: frame.layout || "split2",
      compositionMode,
      speakerPanel: Number.isInteger(frame.speakerPanel) ? frame.speakerPanel : null,
      dialoguePresent: Boolean(clean(frame.dialogue, 200)),
    },
    panels: panelIntents,
    prohibitedContent: namesList(frame.prohibitedContent).length
      ? namesList(frame.prohibitedContent)
      : [...DEFAULT_PROHIBITED],
  };

  const subjects = panelIntents.map((panel) => panel.subject).join(" / ");
  const gridDescription = clean(
    `${compositionMode}: ${subjects} against one shared ${sceneKey} scene`,
    240,
  );

  const detailLines = [
    `Project direction: ${intent.project.visualDirection}.`,
    `Composition mode: ${compositionMode}.`,
    `Shared scene (${sceneKey} / ${intent.scene.identity}): ${intent.scene.continuity}.`,
    ...panelIntents.map((panel) => {
      const others = panel.offscreenOthers.length
        ? ` Off-screen context only: ${panel.offscreenOthers.join(", ")}.`
        : "";
      return [
        `Panel ${panel.panelIndex + 1} (${panel.role}): ${panel.subject} — ${panel.description}.`,
        `Visible: ${panel.visibleCharacters.join(", ")}.`,
        `Shot: ${panel.shotScale}; gaze: ${panel.gazeOrScreenDirection};`,
        `expression/pose: ${panel.expressionAndPose};`,
        `crop: ${panel.cropAndSafeMargins}.${others}`,
      ].join(" ");
    }),
    `Prohibited: ${intent.prohibitedContent.join(", ")}.`,
    "Visual assembly uses one people-free background plus one character cutout per panel.",
    "Dialogue, gutters, and borders are added by the renderer, not by the image provider.",
  ];
  const detailedBrief = detailLines.join(" ");

  return {
    intent,
    gridDescription,
    detailedBrief,
  };
}

export function assertBriefsExcludeCompiledPrompt(briefs, compiledPrompt) {
  const prompt = String(compiledPrompt ?? "");
  if (!prompt) return true;
  const grid = String(briefs?.gridDescription ?? "");
  const detail = String(briefs?.detailedBrief ?? "");
  return !grid.includes(prompt) && !detail.includes(prompt);
}
