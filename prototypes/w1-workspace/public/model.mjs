// Snapshot loading and display derivation. Missing or partial snapshot fields
// degrade to visible labels and warnings instead of exceptions.

import {
  backfillDialogueModes,
  expandStoryboardFrames,
  frameTiming,
  PLACEMENT_DEFAULTS,
  typedDialogue,
} from "./operations.mjs";

export const SNAPSHOT_FORMAT = "w1-workspace-snapshot/v1";

function text(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function loadSnapshot(raw, { assetBase = "/data/" } = {}) {
  const warnings = [];
  const snapshot = plainObject(raw);
  if (!snapshot) warnings.push("The snapshot could not be read. Showing an empty workspace.");
  else if (snapshot.format !== SNAPSHOT_FORMAT) warnings.push(`Unexpected snapshot format "${snapshot.format ?? "missing"}". Fields are read on a best-effort basis.`);
  const source = plainObject(snapshot?.source) ?? {};
  const project = plainObject(snapshot?.project) ?? {};
  if (!text(project.title)) warnings.push("Project title is missing from the snapshot.");

  const assets = {};
  for (const [id, entry] of Object.entries(plainObject(snapshot?.assets) ?? {})) {
    const file = text(entry?.file);
    if (!file) continue;
    assets[id] = {
      url: `${assetBase}${file}`,
      kind: text(entry.kind),
      origin: text(entry.origin),
      submittedText: text(entry.submittedText),
    };
  }

  const storyboard = plainObject(snapshot?.storyboard) ?? {};
  let frames = [];
  if (Array.isArray(storyboard.frames)) {
    frames = storyboard.frames.filter((frame, index) => {
      if (plainObject(frame)) return true;
      warnings.push(`Frame entry ${index + 1} is not an object and was skipped.`);
      return false;
    });
  } else {
    warnings.push("The snapshot has no storyboard frames.");
  }
  frames = structuredClone(frames);
  let missingIds = 0;
  frames.forEach((frame, index) => {
    if (!text(frame.id)) {
      missingIds += 1;
      frame.id = `snapshot-frame-${index + 1}`;
    }
    const units = frame.directingBeat === true && Array.isArray(frame.segments) ? frame.segments : [frame];
    for (const unit of units) {
      if (unit.panels != null && !Array.isArray(unit.panels)) {
        warnings.push(`Frame ${index + 1} has an unreadable panel list; it is shown without panels.`);
        unit.panels = [];
      }
      (unit.panels || []).forEach((panel, panelIndex) => {
        if (!text(panel.id)) {
          missingIds += 1;
          panel.id = `snapshot-panel-${index + 1}-${panelIndex + 1}`;
        }
      });
    }
  });
  if (missingIds) warnings.push(`${missingIds} frame or panel id(s) were missing; local ids were assigned.`);
  const backfilled = backfillDialogueModes(frames);
  if (backfilled.filled) {
    warnings.push(`${backfilled.filled} frame(s) had no explicit dialogue mode; inferred the same way production backfills them.`);
  }

  const panelStates = {};
  for (const [panelId, entry] of Object.entries(plainObject(snapshot?.panelStates) ?? {})) {
    const state = plainObject(entry);
    if (!state) continue;
    panelStates[panelId] = {
      subject: text(state.subject),
      assetId: text(state.assetId),
      assetOrigin: text(state.assetOrigin),
      zoom: finite(state.zoom, PLACEMENT_DEFAULTS.zoom),
      positionX: finite(state.positionX, PLACEMENT_DEFAULTS.positionX),
      positionY: finite(state.positionY, PLACEMENT_DEFAULTS.positionY),
      mirrored: state.mirrored === true,
      performanceAssetId: text(state.performanceAssetId),
      generationStatus: text(state.generationStatus),
      generationError: text(state.generationError),
    };
  }

  const characters = (Array.isArray(snapshot?.characters) ? snapshot.characters : [])
    .filter((entry) => text(entry?.name))
    .map((entry) => ({
      name: entry.name,
      anchorStatus: entry.anchor?.status === "approved" ? "approved" : "none",
      anchorAssetId: text(entry.anchor?.assetId),
      anchorProvenance: text(entry.anchor?.provenance),
    }));
  const story = plainObject(snapshot?.story) ?? {};

  return {
    warnings: [...warnings, ...(Array.isArray(snapshot?.warnings) ? snapshot.warnings.filter((w) => typeof w === "string") : [])],
    model: {
      source: {
        method: text(source.method, "unknown"),
        exportedAt: text(source.exportedAt),
        selectionRule: text(source.selection?.rule),
      },
      project: {
        id: text(project.id, "unknown-project"),
        title: text(project.title, "Untitled project (title missing in snapshot)"),
      },
      story: {
        sourceText: text(story.sourceText),
        materialConfirmed: Boolean(text(story.materialStateId)),
        cast: Array.isArray(story.cast) ? story.cast.filter((name) => typeof name === "string") : [],
        aliases: Array.isArray(story.aliases) ? story.aliases.filter((alias) => text(alias?.surface)) : [],
      },
      characters,
      storyboard: {
        versionId: text(storyboard.versionId),
        frames: backfilled.frames,
      },
      panelStates,
      assets,
      approval: {
        recordedAt: text(snapshot?.approval?.recordedAt),
        matchesCurrent: snapshot?.approval?.matchesCurrent === true,
      },
      render: { status: text(snapshot?.render?.status, "not-captured") },
    },
  };
}

function roleOf(frame, panelIndex) {
  if (frame.frameKind === "text") return null;
  if (frame.dialogueMode === "silent") return "silent";
  if (frame.dialogueMode === "hidden") return "no line";
  return frame.speakerPanel === panelIndex ? "speaking" : "listening";
}

// Priority order: explicit override > specialized (panel-specific) image >
// automatic base mapping to the approved anchor > nothing yet.
export function panelBasis(state, anchor) {
  if (state?.assetId && (state.assetOrigin === "upload" || state.assetOrigin === "reuse")) {
    return { kind: "explicit", label: state.assetOrigin === "upload" ? "Explicit image · uploaded" : "Explicit image · reused" };
  }
  if (state?.assetId && state.assetOrigin === "generation") {
    return { kind: "specialized", label: "Specialized · generated for this panel" };
  }
  if (state?.assetId) return { kind: "explicit", label: "Explicit image · origin not recorded" };
  if (anchor?.url) return { kind: "base", label: "Base state · approved anchor" };
  return { kind: "missing", label: "No image yet" };
}

export function displayFrames(state) {
  const anchors = new Map(state.characters.map((character) => [character.name, character]));
  return expandStoryboardFrames(state.storyboard.frames).map((frame, index) => {
    const panels = (frame.panels || []).map((panel, panelIndex) => {
      const panelState = state.panelStates[panel.id] ?? null;
      const subject = panelState?.subject ?? text(panel.manualSubject) ?? null;
      const character = subject ? anchors.get(subject) : null;
      const anchorAsset = character?.anchorAssetId ? state.assets[character.anchorAssetId] : null;
      const asset = panelState?.assetId ? state.assets[panelState.assetId] : null;
      const basis = panelBasis(panelState, anchorAsset);
      const zoom = panelState?.zoom ?? PLACEMENT_DEFAULTS.zoom;
      const positionX = panelState?.positionX ?? PLACEMENT_DEFAULTS.positionX;
      const positionY = panelState?.positionY ?? PLACEMENT_DEFAULTS.positionY;
      return {
        ...panel,
        address: `${index + 1}.${panelIndex + 1}`,
        panelIndex,
        subject,
        role: roleOf(frame, panelIndex),
        assetId: panelState?.assetId ?? null,
        assetMissing: Boolean(panelState?.assetId && !asset),
        asset: asset?.url ?? (basis.kind === "base" ? anchorAsset.url : null),
        assetSubmittedText: asset?.submittedText ?? null,
        anchorAsset: anchorAsset?.url ?? null,
        performanceAsset: panelState?.performanceAssetId ? (state.assets[panelState.performanceAssetId]?.url ?? null) : null,
        hasState: Boolean(panelState),
        basis,
        zoom,
        positionX,
        positionY,
        mirrored: panelState?.mirrored === true,
        position: `${positionX}% ${positionY}%`,
        align: `${positionX}% ${positionY}%`,
      };
    });
    const timing = frameTiming(frame);
    const visualReady = frame.frameKind === "text"
      ? Boolean(String(frame.textCard || "").trim())
      : panels.length > 0 && panels.every((panel) => Boolean(panel.assetId) && !panel.assetMissing);
    const speaker = frame.dialogueMode === "spoken" && Number.isInteger(frame.speakerPanel)
      ? panels[frame.speakerPanel] ?? null
      : null;
    return {
      ...frame,
      number: index + 1,
      panels,
      speaker,
      visibleDialogue: typedDialogue(frame),
      storedDialogue: typeof frame.dialogue === "string" ? frame.dialogue : "",
      timing,
      visualReady,
    };
  });
}

export function sameAddress(frame, address) {
  if (!frame || !address) return false;
  const segment = Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : null;
  const wanted = Number.isInteger(address.structureSegmentIndex) ? address.structureSegmentIndex : null;
  return frame.structureFrameId === address.structureFrameId && segment === wanted;
}

export function findDisplayFrame(frames, address) {
  if (!address) return null;
  return frames.find((frame) => sameAddress(frame, address))
    ?? frames.find((frame) => frame.structureFrameId === address.structureFrameId)
    ?? null;
}
