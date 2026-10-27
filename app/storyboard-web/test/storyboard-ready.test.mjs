import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FONT_LADDER } from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";
import { compileOverflow } from "../overflow.mjs";
import { createServer } from "../server.mjs";
import { close, listen, request } from "./loopback-http.mjs";

const interpretPrompt = readFileSync(new URL("../prompts/interpret.md", import.meta.url), "utf8");
const stagePrompt = readFileSync(new URL("../prompts/stage.md", import.meta.url), "utf8");

const draft = "Аня: Привет.\n(пауза)\nБорис: Пока.";

function completion(content) {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: "stop",
    }],
  });
}

function interpretBody() {
  return {
    sourceItems: [
      {
        id: "anya",
        kind: "utterance",
        segmentIds: ["seg-0"],
        speakerStatus: "explicit",
        speakerLabel: "Аня",
        sourceQuote: "Аня: Привет.",
      },
      {
        id: "pause",
        kind: "action",
        segmentIds: ["seg-1"],
        speakerStatus: "none",
        sourceQuote: "(пауза)",
      },
      {
        id: "boris",
        kind: "utterance",
        segmentIds: ["seg-2"],
        speakerStatus: "explicit",
        speakerLabel: "Борис",
        sourceQuote: "Борис: Пока.",
      },
    ],
    characters: [],
    surfaceForms: [],
  };
}

function stageBody() {
  return {
    frames: [
      {
        id: "fAnya",
        layout: "single",
        origin: "source",
        panels: [{ description: "Аня говорит" }],
        sourceItemId: "anya",
        sourceRole: "utterance",
        speakerPanel: 0,
      },
      {
        id: "fPause",
        layout: "single",
        origin: "source",
        panels: [{ description: "Пауза" }],
        sourceItemId: "pause",
        sourceRole: "action",
      },
      {
        id: "fDerived",
        layout: "split2",
        origin: "derived",
        panels: [{ description: "Ждёт" }, { description: "Слушает" }],
        placement: { afterSourceItemId: "pause", beforeSourceItemId: "boris" },
      },
      {
        id: "fBoris",
        layout: "split2",
        origin: "source",
        panels: [{ description: "Борис слева" }, { description: "Борис справа" }],
        sourceItemId: "boris",
        sourceRole: "utterance",
        speakerPanel: 1,
      },
    ],
    review: [],
  };
}

async function postDraft(port, text) {
  const body = JSON.stringify({ draft: text });
  const response = await request(port, {
    method: "POST",
    path: "/api/storyboard",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
    body,
  });
  return {
    status: response.status,
    body: response.body.toString("utf8"),
  };
}

test("returns checked dialogue slices and a last frame after synchronous fitting", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const content = calls.length === 1 ? interpretBody() : stageBody();
    return {
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return completion(content);
      },
    };
  };
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, draft);
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.status, "checked");
    assert.equal(payload.status === "ready", false);
    assert.equal(Object.hasOwn(payload, "frames"), true);
    const anya = payload.frames.find((frame) => frame.sourceItemId === "anya");
    const pause = payload.frames.find((frame) => frame.sourceItemId === "pause");
    const boris = payload.frames.find((frame) => frame.sourceItemId === "boris");
    assert.equal(anya.dialogue, "Привет.");
    assert.equal(boris.dialogue, "Пока.");
    assert.equal(pause.dialogue, "");
    assert.equal(pause.outsideFrameText, "(пауза)");
    for (const frame of payload.frames) assert.equal(frame.fontSize, undefined);
    assert.equal(draft.slice(draft.indexOf("Аня: Привет.") + "Аня: ".length, draft.indexOf("Аня: Привет.") + "Аня: Привет.".length), anya.dialogue);
    const fitted = compileOverflow(payload.frames, () => true);
    assert.equal(fitted.ok, true);
    const lastIndex = fitted.frames.length - 1;
    assert.equal(fitted.frames[lastIndex].dialogue, "Пока.");
    assert.equal(fitted.frames[lastIndex].fontSize, FONT_LADDER.split2[0]);
    assert.equal(fitted.frames[lastIndex].speakerPanel, 1);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].init.body).messages[0].content, interpretPrompt);
    assert.equal(JSON.parse(calls[1].init.body).messages[0].content, stagePrompt);
  } finally {
    await close(server);
  }
});

test("does not call Stage when Interpret output is invalid", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls > 1) throw new Error("Stage was called");
    return {
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return completion({ sourceItems: [], characters: [], surfaceForms: [] });
      },
    };
  };
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, draft);
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-output" });
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});

test("does not call Stage when the anchor pass fails", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls > 1) throw new Error("Stage was called");
    return {
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return completion({
          sourceItems: [{
            id: "missing",
            kind: "utterance",
            segmentIds: ["seg-0"],
            speakerStatus: "explicit",
            speakerLabel: "Аня",
            sourceQuote: "нет такого",
          }],
          characters: [],
          surfaceForms: [],
        });
      },
    };
  };
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, "Аня: да");
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.status, "blocked");
    assert.equal(Object.hasOwn(payload, "frames"), false);
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});

test("rejects a surface quote that is absent from the draft and does not call Stage", async () => {
  const absent = "НЕТ-ТАКОЙ-ЦИТАТЫ-7781";
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls > 1) throw new Error("Stage was called");
    return {
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return completion({
          sourceItems: [{
            id: "anya",
            kind: "utterance",
            segmentIds: ["seg-0"],
            speakerStatus: "explicit",
            speakerLabel: "Аня",
            sourceQuote: "Аня: да",
          }],
          characters: [{ id: "anya", name: "Аня" }],
          surfaceForms: [{ id: "missing", quote: absent, role: "mention", characterId: "anya" }],
        });
      },
    };
  };
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, "Аня: да");
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-output" });
    assert.equal(response.body.includes(absent), false);
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});

test("rejects a surface form that names an unknown character", async () => {
  const unknownId = "missing-person";
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls > 1) throw new Error("Stage was called");
    return {
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return completion({
          sourceItems: [{
            id: "anya",
            kind: "utterance",
            segmentIds: ["seg-0"],
            speakerStatus: "explicit",
            speakerLabel: "Аня",
            sourceQuote: "Аня: да",
          }],
          characters: [{ id: "anya", name: "Аня" }],
          surfaceForms: [{ id: "label", quote: "Аня", role: "speaker-label", characterId: unknownId }],
        });
      },
    };
  };
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl,
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, "Аня: да");
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-output" });
    assert.equal(response.body.includes(unknownId), false);
    assert.equal(response.body.includes("Аня"), false);
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});
