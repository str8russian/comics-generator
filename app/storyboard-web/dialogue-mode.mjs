const MODES = new Set(["spoken", "silent", "hidden"]);

export function isDialogueMode(value) {
  return MODES.has(value);
}

export function isTextCard(frame) {
  return frame?.frameKind === "text";
}

function unitText(node, parent) {
  if (node !== parent && typeof node?.quote === "string") return node.quote;
  if (typeof node?.dialogue === "string") return node.dialogue;
  if (typeof node?.quote === "string") return node.quote;
  return "";
}

export function inferredDialogueMode(frame, node = frame) {
  if (isTextCard(frame) || isTextCard(node)) return null;
  return unitText(node, frame).trim() ? "spoken" : "hidden";
}

export function readDialogueMode(frame, node = frame) {
  if (isDialogueMode(node?.dialogueMode)) return node.dialogueMode;
  return inferredDialogueMode(frame, node);
}

export function dialogueStateError(unit) {
  if (isTextCard(unit)) return isDialogueMode(unit?.dialogueMode) ? "text-card" : null;
  if (!isDialogueMode(unit?.dialogueMode)) return "missing-mode";
  const text = typeof unit.dialogue === "string"
    ? unit.dialogue
    : (typeof unit.quote === "string" ? unit.quote : "");
  const panels = Array.isArray(unit.panels) ? unit.panels : [];
  const speaker = Number.isInteger(unit.speakerPanel) ? unit.speakerPanel : null;
  if (unit.dialogueMode === "spoken") {
    if (!text.trim()) return "empty-dialogue";
    if (speaker == null || speaker < 0 || speaker >= panels.length) return "speaker-required";
    return null;
  }
  if (speaker != null) return "speaker-present";
  return null;
}

function assignUnit(frame, node) {
  if (isTextCard(frame) || isTextCard(node)) {
    if (Object.hasOwn(node, "dialogueMode")) {
      delete node.dialogueMode;
      return true;
    }
    return false;
  }
  if (isDialogueMode(node.dialogueMode)) return false;
  node.dialogueMode = inferredDialogueMode(frame, node);
  return true;
}

export function backfillDialogueModes(frames) {
  const next = structuredClone(Array.isArray(frames) ? frames : []);
  let changed = false;
  for (const frame of next) {
    if (!frame || typeof frame !== "object") continue;
    if (frame.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0) {
      if (Object.hasOwn(frame, "dialogueMode")) {
        delete frame.dialogueMode;
        changed = true;
      }
      for (const segment of frame.segments) {
        if (assignUnit(frame, segment)) changed = true;
      }
      continue;
    }
    if (assignUnit(frame, frame)) changed = true;
  }
  return { frames: next, changed };
}
