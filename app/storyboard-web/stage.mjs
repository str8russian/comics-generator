import { readFileSync } from "node:fs";
import { assessStage } from "./fidelity.mjs";
import { assessDialogue } from "./overflow.mjs";
import { completeStage } from "./provider.mjs";

const stageSchema = JSON.parse(readFileSync(new URL("../../specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json", import.meta.url), "utf8"));
const systemPrompt = readFileSync(new URL("./prompts/stage.md", import.meta.url), "utf8");

function failure(httpStatus, kind) {
  return { ok: false, httpStatus, status: "failed", kind };
}

function blocked(code, sourceItemId) {
  const entry = { code };
  if (sourceItemId) entry.sourceItemId = sourceItemId;
  return { ok: false, httpStatus: 200, status: "blocked", failures: [entry] };
}

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

function publicItem(item) {
  const copy = {
    id: item.id,
    kind: item.kind,
    segmentIds: item.segmentIds,
    speakerStatus: item.speakerStatus,
    sourceQuote: item.sourceQuote,
    draftStart: item.draftStart,
    draftEnd: item.draftEnd,
    text: item.text,
  };
  if (item.speakerLabel) copy.speakerLabel = item.speakerLabel;
  return copy;
}

function copyPanels(panels) {
  return panels.map((panel) => ({ description: panel.description }));
}

function partition(dialogue, segments) {
  let cursor = 0;
  const ranges = [];
  for (const segment of segments) {
    if (typeof segment.quote !== "string" || !dialogue.startsWith(segment.quote, cursor)) return null;
    ranges.push({ start: cursor, end: cursor + segment.quote.length });
    cursor += segment.quote.length;
  }
  if (cursor !== dialogue.length) return null;
  return ranges;
}

function buildChecked(draft, sourceItems, stage) {
  const assessment = assessStage(sourceItems, stage);
  if (!assessment.ok) {
    return { ok: false, httpStatus: 200, status: "blocked", failures: assessment.failures };
  }
  const byId = new Map(sourceItems.map((item) => [item.id, item]));
  const frames = [];
  for (const frame of stage.frames) {
    if (frame.origin === "derived") {
      frames.push({
        id: frame.id,
        layout: frame.layout,
        origin: "derived",
        panels: copyPanels(frame.panels),
        placement: frame.placement,
        dialogue: "",
      });
      continue;
    }
    const item = byId.get(frame.sourceItemId);
    if (!item) return blocked("unknown-source-item", frame.sourceItemId);
    if (frame.sourceRole !== item.kind) return blocked("invalid-source-role", item.id);
    if (frame.sourceRole === "action") {
      frames.push({
        id: frame.id,
        layout: frame.layout,
        origin: "source",
        panels: copyPanels(frame.panels),
        sourceItemId: item.id,
        sourceRole: "action",
        dialogue: "",
        outsideFrameText: item.text,
      });
      continue;
    }
    const checked = {
      id: frame.id,
      layout: frame.layout,
      origin: "source",
      panels: copyPanels(frame.panels),
      sourceItemId: item.id,
      sourceRole: "utterance",
      speakerPanel: frame.speakerPanel,
      dialogue: item.text,
      displayBlock: { sourceItemId: item.id, start: 0, end: item.text.length },
    };
    if (frame.directingBeat === true) {
      const ranges = partition(item.text, frame.segments);
      if (!ranges) return blocked("invalid-directing-beat", item.id);
      checked.directingBeat = true;
      checked.segments = frame.segments.map((segment, index) => ({
        quote: segment.quote,
        layout: segment.layout,
        speakerPanel: segment.speakerPanel,
        panels: copyPanels(segment.panels),
        start: ranges[index].start,
        end: ranges[index].end,
      }));
    }
    frames.push(checked);
  }

  const review = [];
  for (const sourceItemId of stage.review) {
    const item = byId.get(sourceItemId);
    if (!item) return blocked("unknown-source-item", sourceItemId);
    review.push({ sourceItemId, kind: item.kind, text: item.text });
  }
  const dialogue = assessDialogue(sourceItems, frames);
  if (!dialogue.ok) {
    return { ok: false, httpStatus: 200, status: "blocked", failures: dialogue.failures };
  }

  return {
    ok: true,
    httpStatus: 200,
    body: {
      status: "checked",
      draft,
      sourceItems: sourceItems.map(publicItem),
      frames,
      review,
    },
  };
}

export async function stageStoryboard({ draft, sourceItems, env, fetchImpl }) {
  const result = await completeStage({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ sourceItems: sourceItems.map(modelItem) }) },
    ],
    schema: stageSchema,
    env,
    fetchImpl,
  });
  if (!result.ok) return { ...failure(result.httpStatus, result.kind), diagnostics: result.diagnostics };
  return { ...buildChecked(draft, sourceItems, result.value), diagnostics: result.diagnostics };
}
