// Prototype-local ports of the production frame operations. Semantics follow
// app/storyboard-web/assembly.mjs (duplicateFrame, setFrameDialogue),
// app/storyboard-web/timing.mjs, app/storyboard-web/dialogue-mode.mjs, and
// app/storyboard-web/visual-model.mjs (resolvePlacementUpdate,
// expandStoryboardFrames). Nothing here persists; callers own the state.

export const FPS = 30;
const CHARACTERS_PER_SECOND = 12;
const PRE_ROLL_FRAMES = 12;
const ORDINARY_HOLD_FRAMES = 36;
const SILENT_DEFAULT_FRAMES = 36;
const MAX_DURATION_FRAMES = 18000;
const TEXT_LIMIT = 2000;
const MODES = new Set(["spoken", "silent", "hidden"]);

export const PLACEMENT_DEFAULTS = Object.freeze({ zoom: 1, positionX: 50, positionY: 30, mirrored: false });

function fail(kind) {
  return { ok: false, kind };
}

export function defaultIdFactory() {
  return globalThis.crypto.randomUUID();
}

export function isDialogueMode(value) {
  return MODES.has(value);
}

function isDirected(frame) {
  return frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0;
}

// --- timing.mjs -------------------------------------------------------------

function graphemeCount(text) {
  return Array.from(String(text ?? "")).length;
}

export function typedDialogue(frame) {
  if (frame?.frameKind === "text") return "";
  if (frame?.dialogueMode === "silent" || frame?.dialogueMode === "hidden") return "";
  const text = typeof frame?.dialogue === "string" ? frame.dialogue : "";
  if (frame?.dialogueMode === "spoken") return text.trim() ? text : "";
  if (frame?.frameKind === "image") return "";
  return text.trim() ? text : "";
}

function revealFramesFor(text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return 0;
  return Math.ceil((graphemeCount(dialogue) / CHARACTERS_PER_SECOND) * FPS);
}

function dialogueCompletes(durationFrames, text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return true;
  const typedFrames = Math.max(0, durationFrames - 1 - PRE_ROLL_FRAMES);
  const visible = Math.floor((typedFrames / FPS) * CHARACTERS_PER_SECOND);
  return Math.min(graphemeCount(dialogue), visible) >= graphemeCount(dialogue);
}

function isPositiveFrameCount(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_DURATION_FRAMES;
}

function minimumDurationFrames(text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return 1;
  let duration = PRE_ROLL_FRAMES + revealFramesFor(dialogue);
  while (duration <= MAX_DURATION_FRAMES && !dialogueCompletes(duration, dialogue)) duration += 1;
  return duration;
}

function defaultDurationFrames(text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return SILENT_DEFAULT_FRAMES;
  return PRE_ROLL_FRAMES + revealFramesFor(dialogue) + ORDINARY_HOLD_FRAMES;
}

// presentFrameTiming in timing.mjs.
export function frameTiming(frame) {
  const dialogue = typedDialogue(frame);
  const minimum = minimumDurationFrames(dialogue);
  const explicit = frame?.durationFrames;
  if (explicit == null) {
    const value = defaultDurationFrames(dialogue);
    return { durationFrames: value, durationSeconds: value / FPS, source: "default", minimum };
  }
  if (!isPositiveFrameCount(explicit) || explicit < minimum || !dialogueCompletes(explicit, dialogue)) {
    return { durationFrames: explicit, durationSeconds: null, source: "invalid", minimum };
  }
  return { durationFrames: explicit, durationSeconds: explicit / FPS, source: "explicit", minimum };
}

// --- dialogue-mode.mjs ------------------------------------------------------

function unitText(node, parent) {
  if (node !== parent && typeof node?.quote === "string") return node.quote;
  if (typeof node?.dialogue === "string") return node.dialogue;
  if (typeof node?.quote === "string") return node.quote;
  return "";
}

function inferredDialogueMode(frame, node = frame) {
  if (frame?.frameKind === "text" || node?.frameKind === "text") return null;
  return unitText(node, frame).trim() ? "spoken" : "hidden";
}

export function readDialogueMode(frame, node = frame) {
  if (isDialogueMode(node?.dialogueMode)) return node.dialogueMode;
  return inferredDialogueMode(frame, node);
}

// backfillDialogueModes: the same one-time explicit-mode fill production
// persists on load, applied here to the in-memory copy only.
export function backfillDialogueModes(frames) {
  const next = structuredClone(Array.isArray(frames) ? frames : []);
  let filled = 0;
  const assign = (frame, node) => {
    if (frame?.frameKind === "text" || node?.frameKind === "text") {
      if (Object.hasOwn(node, "dialogueMode")) delete node.dialogueMode;
      return;
    }
    if (isDialogueMode(node.dialogueMode)) return;
    node.dialogueMode = inferredDialogueMode(frame, node);
    filled += 1;
  };
  for (const frame of next) {
    if (!frame || typeof frame !== "object") continue;
    if (isDirected(frame)) {
      delete frame.dialogueMode;
      for (const segment of frame.segments) assign(frame, segment);
      continue;
    }
    assign(frame, frame);
  }
  return { frames: next, filled };
}

// --- visual-model.mjs -------------------------------------------------------

export function expandStoryboardFrames(frames) {
  const expanded = [];
  for (const frame of frames || []) {
    if (isDirected(frame)) {
      let cursor = 0;
      frame.segments.forEach((segment, index) => {
        const start = Number.isInteger(segment.start) ? segment.start : cursor;
        const end = Number.isInteger(segment.end) ? segment.end : start + String(segment.quote || "").length;
        expanded.push({
          id: `${frame.id}#${index + 1}`,
          layout: segment.layout,
          origin: frame.origin,
          panels: (segment.panels || []).map((panel) => ({ ...panel })),
          sourceItemId: frame.sourceItemId,
          sourceRole: frame.sourceRole,
          speakerPanel: segment.dialogueMode === "silent" || segment.dialogueMode === "hidden"
            ? null
            : segment.speakerPanel,
          dialogue: segment.quote,
          dialogueMode: segment.dialogueMode,
          dormantSpeakerPanelId: segment.dormantSpeakerPanelId ?? null,
          displayBlock: { sourceItemId: frame.sourceItemId, start, end },
          structureFrameId: frame.id,
          structureSegmentIndex: index,
          frameKind: segment.frameKind ?? frame.frameKind ?? null,
          textCard: segment.textCard ?? null,
          durationFrames: Number.isInteger(segment.durationFrames) ? segment.durationFrames : null,
        });
        cursor = end;
      });
      continue;
    }
    expanded.push({
      ...frame,
      panels: (frame?.panels || []).map((panel) => ({ ...panel })),
      structureFrameId: frame?.id,
      structureSegmentIndex: null,
    });
  }
  return expanded;
}

function roundPlacement(value) {
  return Math.round(value * 1000) / 1000;
}

function finiteIn(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function resolvePlacementUpdate(current = {}, patch = {}) {
  if (patch?.reset === true) return { ...PLACEMENT_DEFAULTS };
  if (patch?.reset != null && patch.reset !== false) return null;
  const next = {
    zoom: Number(current.zoom ?? PLACEMENT_DEFAULTS.zoom),
    positionX: Number(current.positionX ?? PLACEMENT_DEFAULTS.positionX),
    positionY: Number(current.positionY ?? PLACEMENT_DEFAULTS.positionY),
    mirrored: current.mirrored === true,
  };
  if (Object.hasOwn(patch, "zoom")) next.zoom = Number(patch.zoom);
  if (Object.hasOwn(patch, "positionX")) next.positionX = Number(patch.positionX);
  if (Object.hasOwn(patch, "positionY")) next.positionY = Number(patch.positionY);
  if (Object.hasOwn(patch, "mirrored")) {
    if (typeof patch.mirrored !== "boolean") return null;
    next.mirrored = patch.mirrored;
  }
  if (!finiteIn(next.zoom, 1, 3) || !finiteIn(next.positionX, 0, 100) || !finiteIn(next.positionY, 0, 100)) {
    return null;
  }
  return {
    zoom: roundPlacement(next.zoom),
    positionX: roundPlacement(next.positionX),
    positionY: roundPlacement(next.positionY),
    mirrored: next.mirrored,
  };
}

// --- assembly.mjs -----------------------------------------------------------

function eachUnit(frames, visit) {
  frames.forEach((frame, frameIndex) => {
    if (isDirected(frame)) {
      frame.segments.forEach((segment, segmentIndex) => {
        visit({ frame, frameIndex, node: segment, panels: segment.panels, displayId: `${frame.id}#${segmentIndex + 1}` });
      });
      return;
    }
    visit({ frame, frameIndex, node: frame, panels: frame.panels, displayId: frame.id });
  });
}

export function ensurePanelIds(frames, idFactory = defaultIdFactory) {
  const next = structuredClone(Array.isArray(frames) ? frames : []);
  const seen = new Set();
  eachUnit(next, ({ panels }) => {
    for (const panel of panels || []) {
      if (typeof panel.id !== "string" || !panel.id || seen.has(panel.id)) panel.id = idFactory();
      seen.add(panel.id);
    }
  });
  return next;
}

function locate(frames, { structureFrameId, structureSegmentIndex = null } = {}) {
  if (typeof structureFrameId !== "string" || !structureFrameId) return fail("frame-not-found");
  const frameIndex = frames.findIndex((frame) => frame?.id === structureFrameId);
  if (frameIndex < 0) return fail("frame-not-found");
  const frame = frames[frameIndex];
  const directed = isDirected(frame);
  if (structureSegmentIndex == null) {
    if (directed) return fail("segment-required");
    return { frame, frameIndex, node: frame, panels: frame.panels || [] };
  }
  if (!directed || !Number.isInteger(structureSegmentIndex) || !frame.segments[structureSegmentIndex]) {
    return fail("segment-not-found");
  }
  const segment = frame.segments[structureSegmentIndex];
  return { frame, frameIndex, node: segment, panels: segment.panels || [] };
}

function panelListOk(panels) {
  if (panels == null) return true;
  if (!Array.isArray(panels)) return false;
  return panels.every((panel) => panel && typeof panel === "object" && !Array.isArray(panel));
}

function sourceShapeOk(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  if (isDirected(frame)) {
    return frame.segments.every((segment) => segment && typeof segment === "object"
      && !Array.isArray(segment) && panelListOk(segment.panels));
  }
  if (frame.segments != null && !Array.isArray(frame.segments)) return false;
  return panelListOk(frame.panels);
}

function collectUsedIds(frames) {
  const used = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && node.id) used.add(node.id);
    for (const panel of node.panels || []) {
      if (typeof panel?.id === "string" && panel.id) used.add(panel.id);
    }
    for (const segment of node.segments || []) visit(segment);
  };
  for (const frame of frames || []) visit(frame);
  return used;
}

function takeId(idFactory, used) {
  let token = idFactory();
  for (let guard = 0; guard < 8 && (typeof token !== "string" || !token || used.has(token)); guard += 1) {
    token = idFactory();
  }
  while (typeof token !== "string" || !token || used.has(token)) token = defaultIdFactory();
  used.add(token);
  return token;
}

function remapPanels(node, displayFrameId, panelCopies, idFactory, used, { record = true } = {}) {
  if (!Array.isArray(node?.panels)) return;
  const previous = node.panels;
  const next = previous.map((panel, panelIndex) => {
    const copy = structuredClone(panel);
    const sourcePanelId = typeof copy.id === "string" && copy.id ? copy.id : null;
    copy.id = takeId(idFactory, used);
    if (record && displayFrameId) {
      panelCopies.push({ sourcePanelId, panelId: copy.id, frameId: displayFrameId, panelIndex });
    }
    return copy;
  });
  if (typeof node.dormantSpeakerPanelId === "string") {
    const index = previous.findIndex((panel) => panel?.id === node.dormantSpeakerPanelId);
    if (index >= 0) node.dormantSpeakerPanelId = next[index].id;
    else delete node.dormantSpeakerPanelId;
  }
  node.panels = next;
}

export function duplicateFrame(frames, operation, idFactory = defaultIdFactory) {
  const list = Array.isArray(frames) ? frames : [];
  if (typeof operation.structureFrameId !== "string" || !operation.structureFrameId) return fail("frame-not-found");
  const found = list.findIndex((frame) => frame?.id === operation.structureFrameId);
  if (found < 0) return fail("frame-not-found");
  if (!sourceShapeOk(list[found])) return fail("invalid-request");
  const next = ensurePanelIds(list, idFactory);
  const frameIndex = next.findIndex((frame) => frame?.id === operation.structureFrameId);
  const clone = structuredClone(next[frameIndex]);
  const used = collectUsedIds(next);
  let createdId = "";
  do {
    createdId = `frame-${takeId(idFactory, used)}`;
  } while (used.has(createdId));
  used.add(createdId);
  clone.id = createdId;
  const directed = isDirected(clone);
  const panelCopies = [];
  if (directed) {
    clone.segments.forEach((segment, segmentIndex) => {
      remapPanels(segment, `${createdId}#${segmentIndex + 1}`, panelCopies, idFactory, used);
    });
    remapPanels(clone, null, panelCopies, idFactory, used, { record: false });
  } else {
    remapPanels(clone, createdId, panelCopies, idFactory, used);
  }
  const requestedSegment = Number.isInteger(operation.structureSegmentIndex) && operation.structureSegmentIndex >= 0
    ? operation.structureSegmentIndex
    : null;
  const createdSegment = directed && requestedSegment != null && clone.segments[requestedSegment]
    ? requestedSegment
    : null;
  next.splice(frameIndex + 1, 0, clone);
  return {
    ok: true,
    frames: next,
    duplicate: {
      source: { structureFrameId: operation.structureFrameId, structureSegmentIndex: requestedSegment },
      created: { structureFrameId: createdId, structureSegmentIndex: createdSegment },
      panelCopies,
    },
  };
}

function storedNodeText(frame, node) {
  if (node === frame) return typeof node?.dialogue === "string" ? node.dialogue : "";
  return typeof node?.quote === "string" ? node.quote : "";
}

function raisedSpokenDuration(explicit, text) {
  if (!isPositiveFrameCount(explicit)) return explicit ?? null;
  const minimum = minimumDurationFrames(text);
  if (explicit >= minimum && dialogueCompletes(explicit, text)) return explicit;
  return minimum;
}

export function setFrameDialogue(frames, operation) {
  const next = structuredClone(Array.isArray(frames) ? frames : []);
  const target = locate(next, operation);
  if (target.ok === false) return target;
  if (target.frame.frameKind === "text" || target.node.frameKind === "text") return fail("not-dialogue-frame");
  const mode = operation.dialogueMode;
  if (!isDialogueMode(mode)) return fail("invalid-mode");
  const stored = storedNodeText(target.frame, target.node);
  let text = stored;
  if (mode === "spoken" && typeof operation.text === "string") {
    if (operation.text.length > TEXT_LIMIT) return fail("invalid-text");
    text = operation.text;
  }
  if (mode === "spoken" && !text.trim()) return fail("empty-dialogue");

  let speakerPanel = null;
  let dormantSpeakerPanelId = typeof target.node.dormantSpeakerPanelId === "string"
    ? target.node.dormantSpeakerPanelId
    : null;
  if (mode === "spoken") {
    const panels = target.panels;
    if (!panels.length) return fail("speaker-required");
    if (panels.length === 1) {
      if (operation.speakerPanelId != null && operation.speakerPanelId !== panels[0].id) return fail("speaker-not-found");
      speakerPanel = 0;
      dormantSpeakerPanelId = panels[0].id || dormantSpeakerPanelId;
    } else {
      const requested = typeof operation.speakerPanelId === "string" && operation.speakerPanelId
        ? operation.speakerPanelId
        : dormantSpeakerPanelId;
      if (!requested) return fail("speaker-required");
      const index = panels.findIndex((panel) => panel.id === requested);
      if (index < 0) return fail(operation.speakerPanelId ? "speaker-not-found" : "speaker-required");
      speakerPanel = index;
      dormantSpeakerPanelId = panels[index].id;
    }
  } else if (readDialogueMode(target.frame, target.node) === "spoken") {
    const active = Number.isInteger(target.node.speakerPanel) ? target.panels[target.node.speakerPanel] : null;
    if (active?.id) dormantSpeakerPanelId = active.id;
  }

  const durationFrames = mode === "spoken"
    ? raisedSpokenDuration(target.node.durationFrames, text)
    : (target.node.durationFrames ?? null);
  target.node.dialogueMode = mode;
  target.node.speakerPanel = speakerPanel;
  if (dormantSpeakerPanelId) target.node.dormantSpeakerPanelId = dormantSpeakerPanelId;
  else delete target.node.dormantSpeakerPanelId;
  if (durationFrames == null) delete target.node.durationFrames;
  else target.node.durationFrames = durationFrames;
  if (target.node === target.frame) {
    target.node.dialogue = text;
    if (target.node.displayBlock && typeof target.node.displayBlock === "object") {
      target.node.displayBlock = { ...target.node.displayBlock, start: 0, end: text.length };
    }
  } else {
    target.node.quote = text;
    let cursor = 0;
    for (const segment of target.frame.segments) {
      const quote = String(segment.quote || "");
      segment.start = cursor;
      segment.end = cursor + quote.length;
      cursor += quote.length;
    }
    target.frame.dialogue = target.frame.segments.map((segment) => String(segment.quote || "")).join("");
  }
  return { ok: true, frames: next };
}
