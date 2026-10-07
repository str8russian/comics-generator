import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { anchorDraft, assessStage } from "../fidelity.mjs";
import { createServer } from "../server.mjs";

const env = {
  BASE_URL: "https://provider.example.test",
  CONTEST_API_TOKEN: "test-token",
  CONTEST_MODEL: "test-model",
};

function codes(result) {
  assert.equal(result.ok, false);
  return result.failures.map((failure) => failure.code);
}

function utterance(id, label, quote) {
  return {
    id,
    kind: "utterance",
    segmentIds: ["seg-0"],
    speakerStatus: "explicit",
    speakerLabel: label,
    sourceQuote: quote,
  };
}

function anchored(draft, items) {
  const result = anchorDraft(draft, items);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  return result.sourceItems;
}

function frame(id, sourceItemId, sourceRole, layout = "single") {
  const panels = layout === "split2"
    ? [{ description: "Слева" }, { description: "Справа" }]
    : [{ description: "Кадр" }];
  const next = {
    id,
    layout,
    origin: "source",
    panels,
    sourceItemId,
    sourceRole,
  };
  if (sourceRole === "utterance") next.speakerPanel = layout === "split2" ? 1 : 0;
  return next;
}

function completion(content) {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: "stop",
    }],
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function postDraft(port, draft) {
  const body = JSON.stringify({ draft });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/storyboard",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("blocks an empty or whitespace-only draft before the provider", async () => {
  let calls = 0;
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("provider was called");
    },
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, " \n\t");
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.status, "blocked");
    assert.deepEqual(payload.failures.map((failure) => failure.code), ["empty-draft"]);
    assert.equal(Object.hasOwn(payload, "frames"), false);
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test("blocks a duplicated source id and a duplicated frame id", () => {
  const draft = "Аня: да\nБорис: нет";
  const duplicatedItems = anchorDraft(draft, [
    { ...utterance("same", "Аня", "Аня: да"), segmentIds: ["seg-0"] },
    { ...utterance("same", "Борис", "Борис: нет"), segmentIds: ["seg-1"] },
  ]);
  assert.deepEqual(codes(duplicatedItems), ["duplicate-id"]);

  const unique = anchored(draft, [
    { ...utterance("anya", "Аня", "Аня: да"), segmentIds: ["seg-0"] },
    { ...utterance("boris", "Борис", "Борис: нет"), segmentIds: ["seg-1"] },
  ]);
  assert.deepEqual(codes(assessStage(unique, {
    frames: [frame("f1", "anya", "utterance"), frame("f1", "boris", "utterance")],
    review: [],
  })), ["duplicate-id"]);
});

test("blocks an unresolved speaker and does not call Stage", async () => {
  let calls = 0;
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    env,
    fetchImpl: async () => {
      calls += 1;
      if (calls > 1) throw new Error("Stage was called");
      return {
        status: 200,
        headers: { get: () => "application/json" },
        async text() {
          return completion({
            sourceItems: [{
              id: "who",
              kind: "utterance",
              segmentIds: ["seg-0"],
              speakerStatus: "unresolved",
              sourceQuote: "кто говорит",
            }],
          });
        },
      };
    },
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, "кто говорит");
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.status, "blocked");
    assert.deepEqual(payload.failures.map((failure) => failure.code), ["unresolved-speaker"]);
    assert.equal(Object.hasOwn(payload, "frames"), false);
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});

test("blocks an unknown source id without blaming the accounted item", () => {
  const items = anchored("Аня: да", [utterance("anya", "Аня", "Аня: да")]);
  assert.deepEqual(codes(assessStage(items, {
    frames: [frame("f1", "anya", "utterance"), frame("f2", "missing", "utterance")],
    review: [],
  })), ["unknown-source-item"]);
});

test("blocks a source role that does not match the source item", () => {
  const items = anchored("Аня: да", [utterance("anya", "Аня", "Аня: да")]);
  assert.deepEqual(codes(assessStage(items, {
    frames: [frame("f1", "anya", "action")],
    review: [],
  })), ["invalid-source-role"]);
});

test("blocks a context item missing from review", () => {
  const draft = "Аня: да\n[утро]";
  const items = anchored(draft, [
    { ...utterance("anya", "Аня", "Аня: да"), segmentIds: ["seg-0"] },
    {
      id: "morning",
      kind: "context",
      segmentIds: ["seg-1"],
      speakerStatus: "none",
      sourceQuote: "[утро]",
    },
  ]);
  assert.deepEqual(codes(assessStage(items, {
    frames: [frame("f1", "anya", "utterance")],
    review: [],
  })), ["unaccounted-source-item"]);
});

test("blocks utterance and action ids in review", () => {
  const spoken = anchored("Аня: да", [utterance("anya", "Аня", "Аня: да")]);
  assert.deepEqual(codes(assessStage(spoken, {
    frames: [frame("f1", "anya", "utterance")],
    review: ["anya"],
  })), ["reordered-review"]);

  const silent = anchored("(пауза)", [{
    id: "pause",
    kind: "action",
    segmentIds: ["seg-0"],
    speakerStatus: "none",
    sourceQuote: "(пауза)",
  }]);
  assert.deepEqual(codes(assessStage(silent, {
    frames: [frame("f1", "pause", "action")],
    review: ["pause"],
  })), ["reordered-review"]);

  const draft = "[утро]\nАня: да";
  const withContext = anchored(draft, [
    {
      id: "morning",
      kind: "context",
      segmentIds: ["seg-0"],
      speakerStatus: "none",
      sourceQuote: "[утро]",
    },
    { ...utterance("anya", "Аня", "Аня: да"), segmentIds: ["seg-1"] },
  ]);
  assert.deepEqual(codes(assessStage(withContext, {
    frames: [frame("f1", "anya", "utterance")],
    review: ["morning", "anya"],
  })), ["reordered-review"]);
});

test("blocks a second frame for the same source item", () => {
  const items = anchored("Аня: да", [utterance("anya", "Аня", "Аня: да")]);
  assert.deepEqual(codes(assessStage(items, {
    frames: [frame("f1", "anya", "utterance"), frame("f2", "anya", "utterance")],
    review: [],
  })), ["unaccounted-source-item"]);
});

test("requires context and note ids in resolved source order", () => {
  const draft = "[утро]\nзаметка\nАня: да";
  const items = anchored(draft, [
    {
      id: "morning",
      kind: "context",
      segmentIds: ["seg-0"],
      speakerStatus: "none",
      sourceQuote: "[утро]",
    },
    {
      id: "note",
      kind: "note",
      segmentIds: ["seg-1"],
      speakerStatus: "none",
      sourceQuote: "заметка",
    },
    { ...utterance("anya", "Аня", "Аня: да"), segmentIds: ["seg-2"] },
  ]);
  const stage = {
    frames: [frame("f1", "anya", "utterance")],
    review: ["morning", "note"],
  };
  assert.equal(assessStage(items, stage).ok, true);
  assert.deepEqual(codes(assessStage(items, {
    frames: stage.frames,
    review: ["note", "morning"],
  })), ["reordered-review"]);
});
