import { randomUUID } from "node:crypto";
import { isPositiveFrameCount, minimumDurationFrames, typedDialogue } from "./timing.mjs";

const TEXT_LIMIT = 2000;
const NOTE_LIMIT = 500;

function fail(kind) {
  return { ok: false, kind };
}

function cloneFrames(frames) {
  return structuredClone(frames);
}

function eachUnit(frames, visit) {
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    if (frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0) {
      frame.segments.forEach((segment, structureSegmentIndex) => {
        visit({
          frame,
          frameIndex,
          node: segment,
          panels: segment.panels,
          structureSegmentIndex,
          displayId: `${frame.id}#${structureSegmentIndex + 1}`,
        });
      });
      continue;
    }
    visit({
      frame,
      frameIndex,
      node: frame,
      panels: frame.panels,
      structureSegmentIndex: null,
      displayId: frame.id,
    });
  }
}

export function ensurePanelIds(frames, idFactory = randomUUID) {
  const next = cloneFrames(Array.isArray(frames) ? frames : []);
  let changed = false;
  const seen = new Set();
  eachUnit(next, ({ panels }) => {
    for (const panel of panels || []) {
      if (typeof panel.id !== "string" || !panel.id || seen.has(panel.id)) {
        panel.id = idFactory();
        changed = true;
      }
      seen.add(panel.id);
    }
  });
  return { frames: next, changed };
}

function locate(frames, { structureFrameId, structureSegmentIndex = null } = {}) {
  if (typeof structureFrameId !== "string" || !structureFrameId) return fail("frame-not-found");
  const frameIndex = frames.findIndex((frame) => frame?.id === structureFrameId);
  if (frameIndex < 0) return fail("frame-not-found");
  const frame = frames[frameIndex];
  const directed = frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0;
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

function newPanel(idFactory) {
  return { id: idFactory(), description: "", ownerDescription: "" };
}

function retargetSpeaker(node, previousPanels, nextPanels) {
  if (!Number.isInteger(node.speakerPanel)) return;
  const speaker = previousPanels[node.speakerPanel];
  if (!speaker?.id) {
    node.speakerPanel = 0;
    return;
  }
  const nextIndex = nextPanels.findIndex((panel) => panel.id === speaker.id);
  node.speakerPanel = nextIndex >= 0 ? nextIndex : 0;
}

export function applyOperation(frames, operation = {}, options = {}) {
  const idFactory = options.idFactory || randomUUID;
  const identified = ensurePanelIds(frames, idFactory);
  const next = identified.frames;
  const op = operation.op;
  if (op === "insertFrame") return insertFrame(next, operation, idFactory);
  if (op === "deleteFrame") return deleteFrame(next, operation);
  if (op === "reorderFrames") return reorderFrames(next, operation);
  if (op === "addPanel") return addPanel(next, operation, idFactory);
  if (op === "deletePanel") return deletePanel(next, operation);
  if (op === "reorderPanels") return reorderPanels(next, operation);
  if (op === "setDuration") return setDuration(next, operation);
  if (op === "setTextCard") return setTextCard(next, operation);
  if (op === "setOwnerDescription") return setOwnerDescription(next, operation);
  if (op === "setManualSubject") return setManualSubject(next, operation);
  return fail("invalid-operation");
}

export function persistenceMode(op) {
  if (op === "setDuration" || op === "setTextCard" || op === "setOwnerDescription") return "current";
  return "version";
}

function insertFrame(frames, operation, idFactory) {
  const kind = operation.kind === "text" ? "text" : operation.kind === "image" ? "image" : null;
  if (!kind) return fail("invalid-kind");
  let index = frames.length;
  if (operation.afterStructureFrameId != null) {
    const found = frames.findIndex((frame) => frame?.id === operation.afterStructureFrameId);
    if (found < 0) return fail("frame-not-found");
    index = found + 1;
  } else if (operation.index != null) {
    if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > frames.length) {
      return fail("invalid-position");
    }
    index = operation.index;
  }
  const frame = {
    id: `frame-${idFactory()}`,
    layout: "single",
    origin: "derived",
    frameKind: kind,
    durationFrames: 36,
    dialogue: "",
    panels: kind === "text" ? [] : [newPanel(idFactory)],
  };
  if (kind === "text") frame.textCard = "";
  frames.splice(index, 0, frame);
  return { ok: true, frames, frameId: frame.id, mode: "version" };
}

function deleteFrame(frames, operation) {
  if (typeof operation.structureFrameId !== "string") return fail("frame-not-found");
  const index = frames.findIndex((frame) => frame?.id === operation.structureFrameId);
  if (index < 0) return fail("frame-not-found");
  if (frames.length <= 1) return fail("last-frame");
  frames.splice(index, 1);
  return { ok: true, frames, mode: "version" };
}

function reorderFrames(frames, operation) {
  const ids = operation.structureFrameIds;
  if (!Array.isArray(ids) || ids.length !== frames.length) return fail("invalid-order");
  if (new Set(ids).size !== ids.length) return fail("invalid-order");
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  if (ids.some((id) => !byId.has(id))) return fail("invalid-order");
  return { ok: true, frames: ids.map((id) => byId.get(id)), mode: "version" };
}

function addPanel(frames, operation, idFactory) {
  const target = locate(frames, operation);
  if (target.ok === false) return target;
  if (target.frame.frameKind === "text") return fail("not-panel-frame");
  if (target.panels.length !== 1 || target.node.layout === "split2") return fail("layout-full");
  const panels = target.panels.map((panel) => ({ ...panel }));
  panels.push(newPanel(idFactory));
  target.node.layout = "split2";
  target.node.panels = panels;
  return { ok: true, frames, mode: "version" };
}

function deletePanel(frames, operation) {
  if (typeof operation.panelId !== "string" || !operation.panelId) return fail("panel-not-found");
  let removed = false;
  let error = null;
  eachUnit(frames, ({ frame, node, panels }) => {
    if (removed || error || !Array.isArray(panels)) return;
    const index = panels.findIndex((panel) => panel.id === operation.panelId);
    if (index < 0) return;
    if (frame.frameKind === "text") {
      error = fail("not-panel-frame");
      return;
    }
    if (panels.length !== 2) {
      error = fail("last-panel");
      return;
    }
    const dialogue = node === frame ? typedDialogue(frame) : String(node.quote || "");
    if (dialogue.trim() && node.speakerPanel === index && operation.confirmSpeakerTransfer !== true) {
      error = fail("speaker-transfer-required");
      return;
    }
    const nextPanels = panels.filter((panel) => panel.id !== operation.panelId);
    retargetSpeaker(node, panels, nextPanels);
    node.layout = "single";
    node.panels = nextPanels;
    removed = true;
  });
  if (error) return error;
  if (!removed) return fail("panel-not-found");
  return { ok: true, frames, mode: "version" };
}

function reorderPanels(frames, operation) {
  const target = locate(frames, operation);
  if (target.ok === false) return target;
  const ids = operation.panelIds;
  if (!Array.isArray(ids) || ids.length !== target.panels.length) return fail("invalid-order");
  if (new Set(ids).size !== ids.length) return fail("invalid-order");
  const byId = new Map(target.panels.map((panel) => [panel.id, panel]));
  if (ids.some((id) => !byId.has(id))) return fail("invalid-order");
  const nextPanels = ids.map((id) => byId.get(id));
  retargetSpeaker(target.node, target.panels, nextPanels);
  target.node.panels = nextPanels;
  return { ok: true, frames, mode: "version" };
}

function setDuration(frames, operation) {
  const target = locate(frames, operation);
  if (target.ok === false) return target;
  if (!isPositiveFrameCount(operation.durationFrames)) return fail("invalid-duration");
  const dialogue = target.node === target.frame
    ? typedDialogue(target.frame)
    : (target.frame.frameKind === "text" || target.frame.frameKind === "image" ? "" : String(target.node.quote || ""));
  const minimum = minimumDurationFrames(dialogue);
  if (operation.durationFrames < minimum) return fail("duration-truncates-dialogue");
  target.node.durationFrames = operation.durationFrames;
  return { ok: true, frames, mode: "current" };
}

function setTextCard(frames, operation) {
  if (typeof operation.structureFrameId !== "string") return fail("frame-not-found");
  const frame = frames.find((item) => item?.id === operation.structureFrameId);
  if (!frame) return fail("frame-not-found");
  if (frame.frameKind !== "text") return fail("not-text-card");
  if (typeof operation.text !== "string" || operation.text.length > TEXT_LIMIT) return fail("invalid-text");
  frame.textCard = operation.text;
  if (frame.dialogue) frame.dialogue = "";
  return { ok: true, frames, mode: "current" };
}

function setManualSubject(frames, operation) {
  const name = typeof operation.characterName === "string" ? operation.characterName.trim() : "";
  if (typeof operation.panelId !== "string" || !name || name.length > 160) return fail("invalid-request");
  let found = false;
  let locked = false;
  eachUnit(frames, ({ frame, panels }) => {
    for (const panel of panels || []) {
      if (panel.id !== operation.panelId) continue;
      found = true;
      const described = String(panel.description || "").trim();
      const manualFrame = frame.origin === "derived" || frame.frameKind === "image";
      if (described && !manualFrame) {
        locked = true;
        return;
      }
      panel.manualSubject = name;
    }
  });
  if (locked) return fail("subject-locked");
  if (!found) return fail("panel-not-found");
  return { ok: true, frames, mode: "version" };
}

function setOwnerDescription(frames, operation) {
  if (typeof operation.panelId !== "string" || typeof operation.ownerDescription !== "string") {
    return fail("invalid-request");
  }
  if (operation.ownerDescription.length > NOTE_LIMIT) return fail("invalid-text");
  let found = false;
  eachUnit(frames, ({ panels }) => {
    for (const panel of panels || []) {
      if (panel.id !== operation.panelId) continue;
      panel.ownerDescription = operation.ownerDescription;
      found = true;
    }
  });
  if (!found) return fail("panel-not-found");
  return { ok: true, frames, mode: "current" };
}

function nodeSignature(node) {
  return {
    id: node?.id ?? null,
    frameKind: node?.frameKind ?? null,
    layout: node?.layout ?? null,
    durationFrames: node?.durationFrames ?? null,
    textCard: node?.textCard ?? "",
    dialogue: node?.dialogue ?? node?.quote ?? "",
    speakerPanel: Number.isInteger(node?.speakerPanel) ? node.speakerPanel : null,
    panels: (node?.panels || []).map((panel) => ({
      id: panel?.id ?? null,
      description: panel?.description ?? "",
      manualSubject: typeof panel?.manualSubject === "string" ? panel.manualSubject : "",
      ownerDescription: typeof panel?.ownerDescription === "string" ? panel.ownerDescription : "",
    })),
    segments: Array.isArray(node?.segments) ? node.segments.map(nodeSignature) : [],
  };
}

export function visibleFrameSignature(frames) {
  return JSON.stringify((Array.isArray(frames) ? frames : []).map(nodeSignature));
}

export function metadataCarryDecision({
  frame,
  panel,
  provenance = null,
  castNames = [],
  carryMetadata = false,
} = {}) {
  const storedSubject = typeof provenance?.subject === "string" ? provenance.subject : "";
  const accepted = castNames.includes(storedSubject) ? storedSubject : null;
  const description = typeof provenance?.description === "string" ? provenance.description.trim() : "";
  const intent = provenance?.intent && typeof provenance.intent === "object" ? provenance.intent : null;
  const manual = frame?.origin === "derived" || frame?.frameKind === "image";
  const currentDescription = String(panel?.description || "").trim();
  const currentSubject = String(panel?.manualSubject || "").trim();
  const blank = manual && !currentDescription && !currentSubject;
  const nonblankManual = manual && !blank;
  if (!manual) return { mode: "bytes" };
  if (blank && accepted) {
    return { mode: "carry", subject: accepted, description: description || null, intent };
  }
  if (carryMetadata === true && nonblankManual) {
    return {
      mode: "carry",
      subject: accepted,
      description: description || null,
      intent,
    };
  }
  return { mode: "bytes" };
}

export function preservePanelIdentity(previousFrames, nextFrames, idFactory = randomUUID) {
  const previous = ensurePanelIds(previousFrames, idFactory).frames;
  const next = cloneFrames(nextFrames);
  const oldByDisplay = new Map();
  eachUnit(previous, ({ displayId, panels }) => {
    oldByDisplay.set(displayId, panels || []);
  });
  const used = new Set();
  eachUnit(next, ({ displayId, panels }) => {
    const oldPanels = oldByDisplay.get(displayId) || [];
    const oldIds = new Set(oldPanels.map((panel) => panel.id));
    for (const panel of panels || []) {
      if (typeof panel.id === "string" && oldIds.has(panel.id) && !used.has(panel.id)) {
        const old = oldPanels.find((item) => item.id === panel.id);
        if (panel.ownerDescription == null && old?.ownerDescription) panel.ownerDescription = old.ownerDescription;
        used.add(panel.id);
        continue;
      }
      panel.id = "";
    }
    for (const panel of panels || []) {
      if (panel.id) continue;
      const matches = oldPanels.filter((old) => (
        !used.has(old.id)
        && old.description === panel.description
        && typeof panel.description === "string"
        && panel.description.length > 0
      ));
      if (matches.length === 1) {
        panel.id = matches[0].id;
        panel.ownerDescription = panel.ownerDescription ?? matches[0].ownerDescription ?? "";
        used.add(panel.id);
      }
    }
    for (const panel of panels || []) {
      if (!panel.id || used.has(panel.id) === false) {
        if (!panel.id || used.has(panel.id)) {
          panel.id = idFactory();
        }
        used.add(panel.id);
      }
    }
  });
  return next;
}
