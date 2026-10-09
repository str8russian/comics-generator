import assert from "node:assert/strict";
import test from "node:test";
import { editStoryboard } from "../storyboard-edit.mjs";
import { expandStoryboardFrames } from "../visual-model.mjs";

const text = "Первая. Вторая.";
const sourceItems = [{
  id: "item-1",
  kind: "utterance",
  segmentIds: ["segment-1"],
  speakerStatus: "explicit",
  speakerLabel: "Аня",
  sourceQuote: `Аня: ${text}`,
  draftStart: 0,
  draftEnd: 21,
  text,
}];
const stageFrame = {
  id: "frame-1",
  layout: "single",
  origin: "source",
  panels: [{ description: "Аня говорит первую фразу" }],
  sourceItemId: "item-1",
  sourceRole: "utterance",
  speakerPanel: 0,
  directingBeat: true,
  segments: [
    {
      quote: "Первая. ",
      layout: "single",
      speakerPanel: 0,
      panels: [{ description: "Аня говорит первую фразу" }],
      start: 0,
      end: 8,
    },
    {
      quote: "Вторая.",
      layout: "split2",
      speakerPanel: 0,
      panels: [{ description: "Аня продолжает" }, { description: "Борис слушает" }],
      start: 8,
      end: 15,
    },
  ],
};

const responseFrame = {
  ...stageFrame,
  segments: stageFrame.segments.map(({ start: _start, end: _end, ...segment }) => segment),
};

function response(content) {
  return {
    status: 200,
    ok: true,
    headers: { get: () => "application/json" },
    async text() {
      return JSON.stringify({
        choices: [{
          index: 0,
          message: { role: "assistant", content: JSON.stringify(content) },
          finish_reason: "stop",
        }],
      });
    },
  };
}

test("storyboard edit sends visible frame numbers without flattening the source-owned directing beat", async () => {
  let requestPayload;
  const result = await editStoryboard({
    draft: `Аня: ${text}`,
    sourceItems,
    cast: {
      characters: [{ name: "Аня" }, { name: "Борис" }],
      aliases: [],
      speakers: [{ sourceItemId: "item-1", characterName: "Аня" }],
    },
    frames: [stageFrame],
    displayFrames: expandStoryboardFrames([stageFrame]),
    instruction: "Сделай кадр 2 крупнее",
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestPayload = JSON.parse(body.messages[1].content);
      return response({ frames: [responseFrame], review: [] });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(requestPayload.currentStoryboard.frames.length, 1);
  assert.equal(requestPayload.currentStoryboard.frames[0].directingBeat, true);
  assert.deepEqual(requestPayload.numberedStoryboard.map((frame) => frame.number), [1, 2]);
  assert.deepEqual(
    requestPayload.numberedStoryboard.map((frame) => [frame.structureFrameId, frame.structureSegmentIndex]),
    [["frame-1", 0], ["frame-1", 1]],
  );
});
