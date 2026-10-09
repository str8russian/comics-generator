import { readFileSync } from "node:fs";
import { completeStage } from "./provider.mjs";
import { buildChecked } from "./stage.mjs";
import { expandStoryboardFrames, resolvePanelSubject } from "./visual-model.mjs";

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

export function canonicalReview(sourceItems) {
  return (sourceItems || [])
    .filter((item) => item?.kind === "context" || item?.kind === "note")
    .map((item) => item.id);
}

function structureRejected(result) {
  if (result?.ok) return result;
  if (result?.status === "blocked") {
    return { ...result, httpStatus: 409, kind: "structure-rejected" };
  }
  return result;
}

export function parseFullFrameOnlyCommand(instruction, characters = []) {
  const text = String(instruction ?? "").trim();
  if (!text) return null;
  const numberMatch = text.match(/кадр(?:а|е|у)?\s+(\d+)/iu);
  if (!numberMatch) return null;
  if (!/только/iu.test(text)) return null;
  if (!/на весь кадр|во весь кадр|одним кадром|полн(?:ый|ым) кадр/iu.test(text)) return null;
  const names = [...characters]
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && name.trim())
    .sort((left, right) => right.length - left.length);
  const lower = text.toLocaleLowerCase("ru");
  const characterName = names.find((name) => lower.includes(name.toLocaleLowerCase("ru")));
  if (!characterName) return null;
  return { frameNumber: Number(numberMatch[1]), characterName };
}

function panelForCharacter(panels, characterName, characters) {
  const existing = (panels || []).find((panel) => {
    const subject = resolvePanelSubject(panel.description, characters, []);
    if (subject === characterName) return true;
    return String(panel.description || "").toLocaleLowerCase("ru").includes(characterName.toLocaleLowerCase("ru"));
  });
  return { description: existing?.description || `${characterName} на весь кадр.` };
}

function cloneStructure(frames) {
  return JSON.parse(JSON.stringify(frames.map(stageFrame)));
}

export function applyFullFrameOnlyCharacter({ frames, displayFrames, frameNumber, characterName, characters }) {
  const visible = displayFrames[frameNumber - 1];
  if (!visible) return { ok: false, httpStatus: 409, status: "failed", kind: "structure-rejected" };
  const next = cloneStructure(frames);
  const structure = next.find((frame) => frame.id === (visible.structureFrameId || visible.id));
  if (!structure) return { ok: false, httpStatus: 409, status: "failed", kind: "structure-rejected" };
  const panel = panelForCharacter(
    Number.isInteger(visible.structureSegmentIndex) && structure.segments?.[visible.structureSegmentIndex]
      ? structure.segments[visible.structureSegmentIndex].panels
      : structure.panels,
    characterName,
    characters,
  );
  if (Number.isInteger(visible.structureSegmentIndex) && Array.isArray(structure.segments)) {
    const segment = structure.segments[visible.structureSegmentIndex];
    if (!segment) return { ok: false, httpStatus: 409, status: "failed", kind: "structure-rejected" };
    segment.layout = "single";
    segment.speakerPanel = 0;
    segment.panels = [panel];
    if (visible.structureSegmentIndex === 0) {
      structure.layout = "single";
      structure.speakerPanel = 0;
      structure.panels = [{ description: panel.description }];
    }
  } else {
    if (structure.sourceRole === "action") {
      structure.layout = "single";
      delete structure.speakerPanel;
      structure.panels = [panel];
    } else {
      structure.layout = "single";
      structure.speakerPanel = 0;
      structure.panels = [panel];
    }
  }
  return { ok: true, frames: next };
}

export async function editStoryboard({ draft, sourceItems, cast, frames, displayFrames, instruction, env, fetchImpl }) {
  const text = String(instruction ?? "").trim();
  if (!text || text.length > 4000) {
    return { ok: false, httpStatus: 400, status: "failed", kind: "invalid-request" };
  }
  const numbered = (displayFrames && displayFrames.length > 0)
    ? displayFrames
    : expandStoryboardFrames(frames);
  const review = canonicalReview(sourceItems);
  const characters = cast?.characters || [];
  const simple = parseFullFrameOnlyCommand(text, characters);
  if (simple) {
    const applied = applyFullFrameOnlyCharacter({
      frames,
      displayFrames: numbered,
      frameNumber: simple.frameNumber,
      characterName: simple.characterName,
      characters,
    });
    if (!applied.ok) return applied;
    return structureRejected(buildChecked(draft, sourceItems, { frames: applied.frames, review }));
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
          currentStoryboard: { frames: frames.map(stageFrame), review },
          numberedStoryboard: numbered.map((frame, index) => ({
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
  return structureRejected(buildChecked(draft, sourceItems, {
    ...result.value,
    review,
  }));
}
