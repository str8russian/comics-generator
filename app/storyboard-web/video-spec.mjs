import {
  CHARACTERS_PER_SECOND,
  FPS,
  ORDINARY_HOLD_FRAMES,
  PRE_ROLL_FRAMES,
  presentFrameTiming,
  revealFramesFor,
  typedDialogue,
} from "./timing.mjs";

export function compileVideoSpec(visual, { assetOrigin = "" } = {}) {
  const frames = Array.isArray(visual?.frames) ? visual.frames : null;
  if (!visual || visual.status !== "ready" || !frames?.length) return { ok: false, kind: "no-storyboard" };
  let cursor = 0;
  const compiled = [];
  for (const frame of frames) {
    const timing = presentFrameTiming(frame);
    if (timing.durationError) return { ok: false, kind: "invalid-duration" };
    const dialogue = typedDialogue(frame);
    const kind = frame.frameKind === "text" || frame.frameKind === "image"
      ? frame.frameKind
      : (dialogue ? "dialogue" : "image");
    const preRollFrames = dialogue ? PRE_ROLL_FRAMES : 0;
    const revealFrames = revealFramesFor(dialogue);
    compiled.push({
      id: frame.id,
      structureFrameId: frame.structureFrameId || frame.id,
      kind,
      startFrame: cursor,
      durationFrames: timing.durationFrames,
      preRollFrames,
      revealFrames,
      holdFrames: Math.max(0, timing.durationFrames - preRollFrames - revealFrames),
      dialogue,
      textCard: kind === "text" ? String(frame.textCard || "") : "",
      speakerPanel: Number.isInteger(frame.speakerPanel) ? frame.speakerPanel : 0,
      layout: frame.layout === "split2" ? "split2" : "single",
      panels: (frame.panels || []).map((panel) => ({
        id: panel.id ?? null,
        subject: panel.subject || "",
        assetId: panel.assetId || null,
        asset: panel.assetId && assetOrigin
          ? `${assetOrigin}/api/visual/assets/${panel.assetId}`
          : (typeof panel.asset === "string" ? panel.asset : null),
        position: panel.position,
        align: panel.align,
        zoom: panel.zoom,
        positionX: panel.positionX,
        positionY: panel.positionY,
        mirrored: panel.mirrored === true,
      })),
    });
    cursor += timing.durationFrames;
  }
  return {
    ok: true,
    spec: {
      schemaVersion: "storyboard-video-spec-1",
      project: {
        width: 1920,
        height: 1080,
        fps: FPS,
        totalDurationFrames: cursor,
      },
      timing: {
        mode: "typed-dialogue",
        charactersPerSecond: CHARACTERS_PER_SECOND,
        preRollFrames: PRE_ROLL_FRAMES,
        ordinaryHoldFrames: ORDINARY_HOLD_FRAMES,
      },
      theme: {
        backgroundColor: "#02090b",
        panelGutterPx: 48,
        dialogueBarHeightPx: 300,
        dialogueBarColor: "#030607",
        textColor: "#f6f4ed",
        fontFamily: "Arial, Helvetica, sans-serif",
      },
      frames: compiled,
    },
  };
}
