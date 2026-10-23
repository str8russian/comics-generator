// Stage status and the single next action for each stage, derived only from
// the snapshot plus in-memory prototype edits.

import { FPS } from "./operations.mjs";

export const STAGES = Object.freeze([
  { id: "story", label: "Story" },
  { id: "storyboard", label: "Storyboard" },
  { id: "characters", label: "Characters" },
  { id: "visual", label: "Visual" },
  { id: "video", label: "Video" },
]);

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function modeCounts(frames) {
  const counts = { spoken: 0, silent: 0, hidden: 0, text: 0 };
  for (const frame of frames) {
    if (frame.frameKind === "text") counts.text += 1;
    else if (counts[frame.dialogueMode] != null) counts[frame.dialogueMode] += 1;
  }
  return counts;
}

export function totalSeconds(frames) {
  const total = frames.reduce((sum, frame) => sum + (Number(frame.timing?.durationFrames) || 0), 0);
  return Math.round((total / FPS) * 10) / 10;
}

export function deriveStages({ model, frames, visualApproved, dirty }) {
  const counts = modeCounts(frames);
  const split = frames.filter((frame) => frame.panels.length > 1).length;
  const ready = frames.filter((frame) => frame.visualReady).length;
  const firstNotReady = frames.find((frame) => !frame.visualReady) ?? null;
  const approvedAnchors = model.characters.filter((character) => character.anchorStatus === "approved");
  const missingAnchor = model.characters.find((character) => character.anchorStatus !== "approved") ?? null;
  const allAnchors = model.characters.length > 0 && !missingAnchor;
  const complete = frames.length > 0 && ready === frames.length;
  const lines = model.story.sourceText ? model.story.sourceText.split(/\n+/).filter((line) => line.trim()).length : 0;

  const story = {
    id: "story",
    tone: model.story.materialConfirmed ? "done" : "todo",
    chip: model.story.materialConfirmed ? "Confirmed" : "Not confirmed",
    status: model.story.sourceText
      ? `Source revision · ${plural(lines, "line", "lines")} · cast of ${model.story.cast.length} ${model.story.materialConfirmed ? "confirmed" : "not yet confirmed"}`
      : "No source text in the snapshot",
    next: { label: "Review the storyboard", goto: "storyboard" },
  };

  const storyboard = {
    id: "storyboard",
    tone: frames.length ? "done" : "todo",
    chip: plural(frames.length, "frame", "frames"),
    status: `${plural(frames.length, "frame", "frames")} · ${split} split · ${counts.spoken} spoken, ${counts.silent} silent, ${counts.hidden} no line${counts.text ? `, ${counts.text} text card` : ""}${dirty ? " · edited in prototype" : ""}`,
    next: frames.length
      ? { label: "Continue to Characters", goto: "characters" }
      : { label: "Stage the storyboard", stub: "stage_storyboard" },
  };

  const characters = {
    id: "characters",
    tone: allAnchors ? "done" : "todo",
    chip: `${approvedAnchors.length}/${model.characters.length} approved`,
    status: `${approvedAnchors.length} of ${model.characters.length} base images approved`,
    next: missingAnchor
      ? { label: `Create base image for ${missingAnchor.name}`, stub: "anchor_generate" }
      : { label: "Continue to Visual", goto: "visual" },
  };

  let visualNext;
  if (!allAnchors) visualNext = { label: "Approve every base image first", goto: "characters" };
  else if (!complete) visualNext = { label: `Create images for frame ${firstNotReady.number}`, stub: "frame_generate" };
  else if (!visualApproved) visualNext = { label: "Approve Visual storyboard", stub: "approveVisual" };
  else visualNext = { label: "Continue to Video", goto: "video" };
  const visual = {
    id: "visual",
    tone: visualApproved ? "done" : "gate",
    chip: visualApproved ? "Approved" : (complete ? "Needs approval" : `${ready}/${frames.length} ready`),
    status: `${ready} of ${frames.length} frames have images · Visual approval: ${visualApproved ? "approved for this version" : (model.approval.recordedAt ? "recorded for an earlier state, not current" : "not approved")}`,
    next: visualNext,
  };

  const video = {
    id: "video",
    tone: visualApproved ? "todo" : "locked",
    chip: visualApproved ? "Ready to render" : "Locked",
    status: visualApproved
      ? `Ready to render · ${totalSeconds(frames)} s of frames · render status not captured in the snapshot`
      : "Locked until the Visual storyboard is approved (required gate)",
    next: visualApproved
      ? { label: "Render video", stub: "render" }
      : { label: "Go to the Visual approval gate", goto: "visual" },
  };

  return { story, storyboard, characters, visual, video };
}
