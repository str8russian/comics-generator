import assert from "node:assert/strict";
import test from "node:test";
import { canonicalReview, editStoryboard } from "../storyboard-edit.mjs";
import { expandStoryboardFrames } from "../visual-model.mjs";
import { putinBoard, supportedPanelDescription } from "./visual-repair-fixtures.mjs";

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
  panels: [{ description: supportedPanelDescription("Аня") }],
  sourceItemId: "item-1",
  sourceRole: "utterance",
  speakerPanel: 0,
  directingBeat: true,
  segments: [
    {
      quote: "Первая. ",
      layout: "single",
      speakerPanel: 0,
      panels: [{ description: supportedPanelDescription("Аня") }],
      start: 0,
      end: 8,
    },
    {
      quote: "Вторая.",
      layout: "split2",
      speakerPanel: 0,
      panels: [
        { description: supportedPanelDescription("Аня", "крупный план") },
        { description: supportedPanelDescription("Борис", "chest-up") },
      ],
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

function env() {
  return {
    BASE_URL: "https://provider.example.test",
    CONTEST_API_TOKEN: "test-token",
    CONTEST_MODEL: "test-model",
  };
}

test("canonical review keeps unstaged context items", () => {
  assert.deepEqual(canonicalReview(putinBoard().sourceItems), ["item-1"]);
});

test("frame 14 only-Putin full-frame command preserves dialogue and review without a provider call", async () => {
  const board = putinBoard();
  assert.equal(board.displayFrames.length, 14);
  assert.equal(board.displayFrames[13].structureFrameId, "frame-12");
  assert.equal(board.displayFrames[13].dialogue, undefined);
  let called = false;
  const result = await editStoryboard({
    ...board,
    instruction: "в кадре 14 должен быть только Путин на весь кадр",
    env: env(),
    fetchImpl: async () => {
      called = true;
      throw new Error("provider must not be called");
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, true);
  const checked = result.body.frames;
  const visible = expandStoryboardFrames(checked);
  assert.equal(visible.length, 14);
  assert.equal(visible[13].layout, "single");
  assert.equal(visible[13].panels.length, 1);
  assert.match(visible[13].panels[0].description, /Путин/);
  assert.match(visible[13].panels[0].description, /поясной план|waist-up|матовый|matte/i);
  assert.equal(visible[13].dialogue, "Пожалуйста, не выкладывайте фотографии с голым торсом.");
  assert.equal(visible[0].dialogue, "Первая. ");
  assert.deepEqual(result.body.review.map((entry) => entry.sourceItemId), ["item-1"]);
  assert.equal(visible[12].layout, "split2");
});

test("a visible directing-beat number is the unit a full-frame command changes", async () => {
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
    instruction: "в кадре 2 должен быть только Аня на весь кадр",
    env: env(),
    fetchImpl: async () => {
      throw new Error("provider must not be called");
    },
  });
  assert.equal(result.ok, true);
  const visible = expandStoryboardFrames(result.body.frames);
  assert.equal(visible.length, 2);
  assert.equal(visible[1].layout, "single");
  assert.equal(visible[1].panels.length, 1);
  assert.match(visible[1].panels[0].description, /Аня/);
  assert.equal(visible[1].dialogue, "Вторая.");
  assert.equal(visible[0].layout, "single");
  assert.equal(visible[0].dialogue, "Первая. ");
});

test("model edits restore context review and do not flatten the directing beat", async () => {
  let requestPayload;
  const context = {
    id: "item-c",
    kind: "context",
    segmentIds: ["seg-c"],
    speakerStatus: "none",
    sourceQuote: "(зал)",
    draftStart: 0,
    draftEnd: 5,
    text: "(зал)",
  };
  const result = await editStoryboard({
    draft: `Аня: ${text}`,
    sourceItems: [context, ...sourceItems],
    cast: {
      characters: [{ name: "Аня" }, { name: "Борис" }],
      aliases: [],
      speakers: [{ sourceItemId: "item-1", characterName: "Аня" }],
    },
    frames: [stageFrame],
    displayFrames: expandStoryboardFrames([stageFrame]),
    instruction: "Сделай кадр 2 крупнее",
    env: env(),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestPayload = JSON.parse(body.messages[1].content);
      return response({ frames: [responseFrame], review: [] });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(requestPayload.currentStoryboard.review, ["item-c"]);
  assert.deepEqual(result.body.review.map((entry) => entry.sourceItemId), ["item-c"]);
  assert.equal(result.body.frames[0].directingBeat, true);
});

function assertConstrainedPanelPromptContract(systemPrompt) {
  const text = String(systemPrompt);
  assert.match(text, /exactly one|ровно один|one assigned|одного назначенного/i);
  assert.match(text, /close-up|крупн|waist-up|поясн|chest-up|head-and-shoulders|по грудь/i);
  assert.match(text, /upper[-\s]?body|верхн|торс|shoulders|плеч|gesture|жест/i);
  assert.match(text, /head turn|наклон|поворот.*голов|gaze|взгляд|facial expression|выражение/i);
  assert.match(text, /solid matte|сплошн.*матов|матов.*фон/i);
  assert.match(text, /sitting|сидя|standing|стоя|lying|леж|sleeping|сп|waking|просыпа|continuing to speak|продолжа|meeting|встреч/i);
  assert.match(text, /omit|omission|не включа|без локац|locations|интерьер|furniture|мебел|props|предмет|additional people|взаимодейств|visible text|надпис|rendering-style|стиль отрисов|narrative|причин/i);
}

test("Structure-edit system prompt requires constrained one-character panel grammar", async () => {
  let system;
  await editStoryboard({
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
    env: env(),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      system = body.messages[0].content;
      return response({ frames: [responseFrame], review: [] });
    },
  });
  assertConstrainedPanelPromptContract(system);
});

test("a fidelity conflict is a structure-rejected failure", async () => {
  const result = await editStoryboard({
    draft: `Аня: ${text}`,
    sourceItems,
    cast: {
      characters: [{ name: "Аня" }],
      aliases: [],
      speakers: [{ sourceItemId: "item-1", characterName: "Аня" }],
    },
    frames: [stageFrame],
    displayFrames: expandStoryboardFrames([stageFrame]),
    instruction: "Сделай кадр 2 крупнее",
    env: env(),
    fetchImpl: async () => response({
      frames: [{
        id: "orphan",
        layout: "single",
        origin: "source",
        panels: [{ description: "пусто" }],
        sourceItemId: "missing",
        sourceRole: "utterance",
        speakerPanel: 0,
      }],
      review: [],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "structure-rejected");
  assert.equal(result.httpStatus, 409);
  assert.equal(result.status, "blocked");
});
