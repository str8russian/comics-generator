import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requestStageCandidate } from "../stage.mjs";

const stagePrompt = readFileSync(new URL("../prompts/stage.md", import.meta.url));
const STAGE_PROMPT_SHA256 = "ec9d6f64c844905940d0b6e54247b35888b1fde5056f800ba617c795dbf9b8df";

const env = {
  BASE_URL: "https://provider.example.test",
  CONTEST_API_TOKEN: "test-token",
  CONTEST_MODEL: "test-model",
};

const sourceItems = [{
  id: "u1",
  kind: "utterance",
  segmentIds: ["seg-0"],
  speakerStatus: "explicit",
  speakerLabel: "Путин",
  sourceQuote: "Путин: Дмитрий Сергеевич, это Песков.",
  text: "Дмитрий Сергеевич, это Песков.",
}];

const peskovId = "11111111-1111-4111-8111-111111111111";

function completion() {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify({ frames: [], review: [] }) },
      finish_reason: "stop",
    }],
  });
}

async function captureUser(cast) {
  let body;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return {
      status: 200,
      async text() {
        return completion();
      },
    };
  };
  await requestStageCandidate({ sourceItems, cast, env, fetchImpl });
  const messages = body.messages;
  return {
    format: body.response_format,
    system: messages[0].content,
    user: JSON.parse(messages[1].content),
  };
}

test("stage prompt bytes stay identical to the current file", () => {
  assert.equal(createHash("sha256").update(stagePrompt).digest("hex"), STAGE_PROMPT_SHA256);
});

test("a persistent Stage call sends characters, aliases, and speakers", async () => {
  const captured = await captureUser({
    characters: [{ id: peskovId, name: "Песков" }],
    aliases: [{ surface: "Дмитрий Сергеевич", characterId: peskovId }],
    speakers: [{ sourceItemId: "u1", characterId: peskovId }],
  });
  assert.equal(captured.system, stagePrompt.toString("utf8"));
  assert.deepEqual(captured.format, { type: "json_object" });
  assert.deepEqual(Object.keys(captured.user).sort(), ["cast", "sourceItems"]);
  const peskov = captured.user.cast.characters.find((character) => character.name === "Песков");
  const alias = captured.user.cast.aliases.find((entry) => entry.surface === "Дмитрий Сергеевич");
  assert.equal(peskov.id, peskovId);
  assert.equal(alias.characterId, peskov.id);
  assert.deepEqual(captured.user.cast.speakers, [{ sourceItemId: "u1", characterId: peskovId }]);
  assert.equal(captured.user.sourceItems[0].text.includes("Дмитрий Сергеевич"), true);
});

test("a Stage call without cast keeps the legacy user message", async () => {
  const captured = await captureUser(undefined);
  assert.equal(captured.system, stagePrompt.toString("utf8"));
  assert.deepEqual(captured.user, {
    sourceItems: [{
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Путин",
      sourceQuote: "Путин: Дмитрий Сергеевич, это Песков.",
      text: "Дмитрий Сергеевич, это Песков.",
    }],
  });
  assert.equal(Object.hasOwn(captured.user, "cast"), false);
});
