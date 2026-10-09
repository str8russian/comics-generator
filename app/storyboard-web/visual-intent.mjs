const COMPOSITION_MODES = new Set([
  "near-frontal-pair",
  "inward-conversation",
  "asymmetric-pair",
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

/**
 * Layered visual intent for split dialogue frames.
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
  const panelIntents = (panels.length ? panels : frame.panels || []).map((panel, index) => ({
    panelIndex: Number.isInteger(panel.panelIndex) ? panel.panelIndex : index,
    subject: panelSubject(panel, index),
    description: clean(panel.description, 800),
    role: panel.role || (frame.speakerPanel === index ? "speaker" : "listener"),
    offscreenOthers: (panel.offscreenOthers || [])
      .map((name) => clean(name, 160))
      .filter(Boolean),
  }));

  const intent = {
    project: {
      styleAuthorityRequired: true,
      styleSeedAssetId: project.styleSeedAssetId ?? null,
      renderingLanguage: project.renderingLanguage || "project-style-seed",
    },
    scene: {
      sceneKey,
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
  };

  const subjects = panelIntents.map((panel) => panel.subject).join(" / ");
  const gridDescription = clean(
    `${compositionMode}: ${subjects} against one shared ${sceneKey} scene`,
    240,
  );

  const detailLines = [
    `Composition mode: ${compositionMode}.`,
    `Shared scene (${sceneKey}): ${intent.scene.continuity}.`,
    ...panelIntents.map((panel) => {
      const others = panel.offscreenOthers.length
        ? ` Off-screen context only: ${panel.offscreenOthers.join(", ")}.`
        : "";
      return `Panel ${panel.panelIndex + 1} (${panel.role}): ${panel.subject} — ${panel.description}.${others}`;
    }),
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
