import { readFileSync } from "node:fs";
import { completeStage } from "./provider.mjs";
import { buildChecked } from "./stage.mjs";

const schema = JSON.parse(readFileSync(
  new URL("../../specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json", import.meta.url),
  "utf8",
));
const systemPrompt = readFileSync(new URL("./prompts/edit-storyboard.md", import.meta.url), "utf8");

function modelItem(item) {
  const copy = {
    id: item.id,
    kind: item.kind,
    segmentIds: item.segmentIds,
    speakerStatus: item.speakerStatus,
    sourceQuote: item.sourceQuote,
    text: item.text,
  };
  if (item.speakerLabel) copy.speakerLabel = item.speakerLabel;
  return copy;
}

function stageFrame(frame) {
  const copy = {
    id: frame.id,
    layout: frame.layout,
    origin: frame.origin,
    panels: frame.panels.map((panel) => ({ description: panel.description })),
  };
  if (frame.placement) copy.placement = frame.placement;
  if (frame.sourceItemId) copy.sourceItemId = frame.sourceItemId;
  if (frame.sourceRole) copy.sourceRole = frame.sourceRole;
  if (Number.isInteger(frame.speakerPanel)) copy.speakerPanel = frame.speakerPanel;
  if (frame.directingBeat === true && Array.isArray(frame.segments)) {
    copy.directingBeat = true;
    copy.segments = frame.segments.map((segment) => ({
      quote: segment.quote,
      layout: segment.layout,
      speakerPanel: segment.speakerPanel,
      panels: segment.panels.map((panel) => ({ description: panel.description })),
    }));
  }
  return copy;
}

export async function editStoryboard({ draft, sourceItems, cast, frames, displayFrames, instruction, env, fetchImpl }) {
  const text = String(instruction ?? "").trim();
  if (!text || text.length > 4000) {
    return { ok: false, httpStatus: 400, status: "failed", kind: "invalid-request" };
  }
  const result = await completeStage({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          instruction: text,
          sourceItems: sourceItems.map(modelItem),
          cast,
          currentStoryboard: { frames: frames.map(stageFrame), review: [] },
          numberedStoryboard: (displayFrames || []).map((frame, index) => ({
            number: index + 1,
            id: frame.id,
            structureFrameId: frame.structureFrameId || frame.id,
            structureSegmentIndex: Number.isInteger(frame.structureSegmentIndex)
              ? frame.structureSegmentIndex
              : null,
            layout: frame.layout,
            panels: frame.panels.map((panel) => ({ description: panel.description })),
            dialogue: frame.dialogue || "",
          })),
        }),
      },
    ],
    schema,
    env,
    fetchImpl,
  });
  if (!result.ok) return { ok: false, httpStatus: result.httpStatus, status: "failed", kind: result.kind };
  return buildChecked(draft, sourceItems, result.value);
}
