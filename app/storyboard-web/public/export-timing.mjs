/** Uniform overlap used only by an explicit cross-dissolve export request. */
export const CROSS_DISSOLVE_OVERLAP_FRAMES = 6;

export function normalizeExportTransition(mode) {
  if (mode == null || mode === "hard-cut") return "hard-cut";
  if (mode === "cross-dissolve") return "cross-dissolve";
  return null;
}

function eligiblePair(current, next) {
  if (!current || !next) return false;
  if (current.kind === "text" || next.kind === "text") return false;
  if (current.durationFrames < CROSS_DISSOLVE_OVERLAP_FRAMES) return false;
  if (next.durationFrames < CROSS_DISSOLVE_OVERLAP_FRAMES) return false;
  return true;
}

export function compileTransitionTimeline(frames, mode = "hard-cut") {
  const transition = normalizeExportTransition(mode);
  if (!transition) return { ok: false, kind: "invalid-transition" };
  const dissolve = transition === "cross-dissolve";
  const overlaps = frames.map((frame, index) => (
    dissolve && eligiblePair(frame, frames[index + 1]) ? CROSS_DISSOLVE_OVERLAP_FRAMES : 0
  ));
  let cursor = 0;
  const placed = frames.map((frame, index) => {
    const incoming = index > 0 ? overlaps[index - 1] : 0;
    const outgoing = overlaps[index];
    const placedFrame = {
      startFrame: cursor,
      transitionIn: incoming > 0
        ? { mode: "cross-dissolve", overlapFrames: incoming }
        : { mode: "hard-cut", overlapFrames: 0 },
      transitionOut: outgoing > 0
        ? { mode: "cross-dissolve", overlapFrames: outgoing }
        : { mode: "hard-cut", overlapFrames: 0 },
    };
    cursor += frame.durationFrames - outgoing;
    return placedFrame;
  });
  const nominalDurationFrames = frames.reduce((sum, frame) => sum + frame.durationFrames, 0);
  return {
    ok: true,
    mode: transition,
    overlapFrames: dissolve ? CROSS_DISSOLVE_OVERLAP_FRAMES : 0,
    frames: placed,
    totalDurationFrames: cursor,
    nominalDurationFrames,
  };
}

export function formatExportRuntime({
  totalDurationFrames,
  nominalDurationFrames,
  mode,
  overlapFrames = 0,
  fps = 30,
}) {
  const seconds = Math.round((totalDurationFrames / fps) * 1000) / 1000;
  if (mode === "cross-dissolve") {
    const nominal = Math.round((nominalDurationFrames / fps) * 1000) / 1000;
    return `Итого ${seconds} с · Cross dissolve ${overlapFrames} кадров · номинально ${nominal} с`;
  }
  return `Итого ${seconds} с · Жёсткая склейка`;
}
