import { acceptedIntroSegment } from "./intro-templates.mjs";
import { compileTransitionTimeline } from "./public/export-timing.mjs";
import {
  CHARACTERS_PER_SECOND,
  FPS,
  ORDINARY_HOLD_FRAMES,
  PRE_ROLL_FRAMES,
  presentFrameTiming,
  revealFramesFor,
  typedDialogue,
} from "./timing.mjs";

export function compileVideoSpec(visual, { assetOrigin = "", transition = "hard-cut", intro = null } = {}) {
  const frames = Array.isArray(visual?.frames) ? visual.frames : null;
  if (!visual || visual.status !== "ready" || !frames?.length) return { ok: false, kind: "no-storyboard" };
  const compiled = [];
  for (const frame of frames) {
    const timing = presentFrameTiming(frame);
    if (timing.durationError) return { ok: false, kind: "invalid-duration" };
    const dialogue = typedDialogue(frame);
    const dialogueMode = frame.frameKind === "text"
      ? null
      : (frame.dialogueMode === "spoken" || frame.dialogueMode === "silent" || frame.dialogueMode === "hidden"
        ? frame.dialogueMode
        : (dialogue ? "spoken" : "hidden"));
    const kind = frame.frameKind === "text" || frame.frameKind === "image"
      ? frame.frameKind
      : (dialogue ? "dialogue" : "image");
    const preRollFrames = dialogue ? PRE_ROLL_FRAMES : 0;
    const revealFrames = revealFramesFor(dialogue);
    compiled.push({
      id: frame.id,
      structureFrameId: frame.structureFrameId || frame.id,
      kind,
      durationFrames: timing.durationFrames,
      preRollFrames,
      revealFrames,
      holdFrames: Math.max(0, timing.durationFrames - preRollFrames - revealFrames),
      dialogue,
      dialogueMode,
      textCard: kind === "text" ? String(frame.textCard || "") : "",
      speakerPanel: dialogueMode === "silent" || dialogueMode === "hidden"
        ? null
        : (Number.isInteger(frame.speakerPanel) ? frame.speakerPanel : 0),
      layout: frame.layout === "split2" ? "split2" : "single",
      panels: (frame.panels || []).map((panel) => ({
        id: panel.id ?? null,
        subject: panel.subject || "",
        assetId: panel.assetId || null,
        asset: panel.assetId && assetOrigin
          ? `${assetOrigin}/visual/assets/${panel.assetId}`
          : (typeof panel.asset === "string" ? panel.asset : null),
        position: panel.position,
        align: panel.align,
        zoom: panel.zoom,
        positionX: panel.positionX,
        positionY: panel.positionY,
        mirrored: panel.mirrored === true,
      })),
    });
  }
  const timeline = compileTransitionTimeline(compiled, transition);
  if (!timeline.ok) return timeline;
  const introSegment = intro == null ? null : acceptedIntroSegment(intro);
  if (intro != null && !introSegment) return { ok: false, kind: "unknown-intro" };
  const offset = introSegment ? introSegment.durationFrames : 0;
  const timed = compiled.map((frame, index) => ({
    ...frame,
    startFrame: timeline.frames[index].startFrame + offset,
    transitionIn: timeline.frames[index].transitionIn,
    transitionOut: timeline.frames[index].transitionOut,
  }));
  const spec = {
    schemaVersion: "storyboard-video-spec-1",
    project: {
      width: 1920,
      height: 1080,
      fps: FPS,
      totalDurationFrames: timeline.totalDurationFrames + offset,
      nominalDurationFrames: timeline.nominalDurationFrames + offset,
      exportTransition: {
        mode: timeline.mode,
        overlapFrames: timeline.overlapFrames,
      },
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
    frames: timed,
  };
  if (introSegment) {
    spec.intro = {
      templateId: introSegment.templateId,
      version: introSegment.version,
      durationFrames: introSegment.durationFrames,
      text: { ...introSegment.text },
      characters: introSegment.characters.map((character) => ({ ...character })),
      shards: introSegment.shards.map((shard) => ({ ...shard })),
      sequence: { ...introSegment.sequence },
    };
  }
  return { ok: true, spec };
}
