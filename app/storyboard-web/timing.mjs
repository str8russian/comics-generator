export const FPS = 30;
export const CHARACTERS_PER_SECOND = 12;
export const PRE_ROLL_FRAMES = 12;
export const ORDINARY_HOLD_FRAMES = 36;
export const SILENT_DEFAULT_FRAMES = 36;
export const MAX_DURATION_FRAMES = 18000;

export function graphemeCount(text) {
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

export function revealFramesFor(text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return 0;
  return Math.ceil((graphemeCount(dialogue) / CHARACTERS_PER_SECOND) * FPS);
}

function charactersVisibleAt(typedFrames, text) {
  const count = graphemeCount(text);
  if (!String(text ?? "").trim()) return 0;
  const visible = Math.floor((Math.max(0, typedFrames) / FPS) * CHARACTERS_PER_SECOND);
  return Math.min(count, visible);
}

export function dialogueCompletes(durationFrames, text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return true;
  const lastFrame = durationFrames - 1;
  const typedFrames = Math.max(0, lastFrame - PRE_ROLL_FRAMES);
  return charactersVisibleAt(typedFrames, dialogue) >= graphemeCount(dialogue);
}

export function isPositiveFrameCount(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_DURATION_FRAMES;
}

export function minimumDurationFrames(text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return 1;
  let duration = PRE_ROLL_FRAMES + revealFramesFor(dialogue);
  while (duration <= MAX_DURATION_FRAMES && !dialogueCompletes(duration, dialogue)) duration += 1;
  return duration;
}

export function defaultDurationFrames(text) {
  const dialogue = String(text ?? "");
  if (!dialogue.trim()) return SILENT_DEFAULT_FRAMES;
  return PRE_ROLL_FRAMES + revealFramesFor(dialogue) + ORDINARY_HOLD_FRAMES;
}

export function resolveDuration(frame) {
  const dialogue = typedDialogue(frame);
  const minimum = minimumDurationFrames(dialogue);
  const explicit = frame?.durationFrames;
  if (explicit == null) {
    return {
      ok: true,
      durationFrames: defaultDurationFrames(dialogue),
      durationSeconds: defaultDurationFrames(dialogue) / FPS,
      durationSource: "default",
      minimumDurationFrames: minimum,
    };
  }
  if (!isPositiveFrameCount(explicit) || explicit < minimum || !dialogueCompletes(explicit, dialogue)) {
    return { ok: false, kind: "invalid-duration", minimumDurationFrames: minimum };
  }
  return {
    ok: true,
    durationFrames: explicit,
    durationSeconds: explicit / FPS,
    durationSource: "explicit",
    minimumDurationFrames: minimum,
  };
}

export function presentFrameTiming(frame) {
  const resolved = resolveDuration(frame);
  if (!resolved.ok) {
    return {
      durationFrames: frame.durationFrames,
      durationSeconds: null,
      durationSource: "invalid",
      minimumDurationFrames: resolved.minimumDurationFrames,
      durationError: resolved.kind,
    };
  }
  return {
    durationFrames: resolved.durationFrames,
    durationSeconds: resolved.durationSeconds,
    durationSource: resolved.durationSource,
    minimumDurationFrames: resolved.minimumDurationFrames,
    durationError: null,
  };
}
