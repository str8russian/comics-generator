import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { createServer, startServer } from "../server.mjs";

const token = "storyboard-test-token";
const hostName = "provider.example.test";
const draftMarker = "УНИКАЛЬНАЯ-РЕПЛИКА-7781";
const modelMarker = "MODEL-ONLY-7781";
const promptMarker = "Do not paraphrase, translate, trim, or normalize it.";

function completion(content, finishReason = "stop", leaked = {}) {
  return JSON.stringify({
    ...leaked,
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: finishReason,
    }],
  });
}

function jsonResponse(body) {
  return {
    status: 200,
    headers: { get: () => "application/json" },
    async text() {
      return body;
    },
  };
}

function interpretBody(sourceQuote) {
  return {
    sourceItems: [{
      id: "anya",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Аня",
      sourceQuote,
    }],
  };
}

function stageBody(description) {
  return {
    frames: [{
      id: "f1",
      layout: "single",
      origin: "source",
      panels: [{ description }],
      sourceItemId: "anya",
      sourceRole: "utterance",
      speakerPanel: 0,
    }],
    review: [],
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function postDraft(port, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ draft: text });
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
      res.on("end", () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function capturingLogger() {
  const lines = [];
  return { lines, log(line) { lines.push(line); } };
}

test("prints the bound URL after listen, including a non-default port", async () => {
  const port = await reservePort();
  assert.notEqual(port, 4173);
  const logger = capturingLogger();
  const server = await startServer({ port, logger });
  try {
    assert.equal(server.address().port, port);
    assert.deepEqual(logger.lines, [`Storyboard server listening at http://127.0.0.1:${port}/`]);
  } finally {
    await close(server);
  }
});

test("logs Interpret invalid-output without starting Stage", async () => {
  const logger = capturingLogger();
  let calls = 0;
  const server = createServer({
    logger,
    env: {
      BASE_URL: `https://${hostName}`,
      CONTEST_API_TOKEN: token,
      CONTEST_MODEL: "gpt-5.5",
    },
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(completion({ sourceItems: [] }));
    },
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, "Аня: да");
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.deepEqual(logger.lines, [
      "storyboard request=1 event=interpret-start",
      "storyboard request=1 event=interpret-outcome status=failed kind=invalid-output http=502 providerStatus=200 finishReason=stop schema=/sourceItems:minItems",
      "storyboard request=1 event=terminal status=failed kind=invalid-output during=interpret http=502",
    ]);
  } finally {
    await close(server);
  }
});

test("logs Stage invalid-output after Interpret succeeds", async () => {
  const logger = capturingLogger();
  const bodies = [completion(interpretBody("Аня: да")), completion({ frames: [], review: [] })];
  let calls = 0;
  const server = createServer({
    logger,
    env: {
      BASE_URL: `https://${hostName}`,
      CONTEST_API_TOKEN: token,
      CONTEST_MODEL: "gpt-5.5",
    },
    fetchImpl: async () => jsonResponse(bodies[calls++]),
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, "Аня: да");
    assert.equal(response.status, 502);
    assert.equal(calls, 2);
    assert.equal(logger.lines[0], "storyboard request=1 event=interpret-start");
    assert.match(logger.lines[1], /event=interpret-outcome status=ok providerStatus=200 finishReason=stop$/);
    assert.equal(logger.lines[2], "storyboard request=1 event=stage-start");
    assert.equal(logger.lines[3], "storyboard request=1 event=stage-outcome status=failed kind=invalid-output http=502 providerStatus=200 finishReason=stop schema=/frames:minItems");
    assert.equal(logger.lines[4], "storyboard request=1 event=terminal status=failed kind=invalid-output during=stage http=502");
  } finally {
    await close(server);
  }
});

test("logs a checked storyboard without source text or secrets", async () => {
  const logger = capturingLogger();
  const draft = `Аня: ${draftMarker}`;
  const bodies = [
    completion(interpretBody(draft), "stop", { leakedToken: token, leakedDraft: draft, leakedModel: modelMarker }),
    completion(stageBody("Аня говорит"), "stop", { leakedToken: token, leakedDraft: draft, leakedModel: modelMarker }),
  ];
  let calls = 0;
  const server = createServer({
    logger,
    env: {
      BASE_URL: `https://${hostName}/v1`,
      CONTEST_API_TOKEN: token,
      CONTEST_MODEL: "gpt-5.5",
    },
    fetchImpl: async () => jsonResponse(bodies[calls++]),
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, draft);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).status, "checked");
    assert.equal(calls, 2);
    assert.deepEqual(logger.lines, [
      "storyboard request=1 event=interpret-start",
      "storyboard request=1 event=interpret-outcome status=ok providerStatus=200 finishReason=stop",
      "storyboard request=1 event=stage-start",
      "storyboard request=1 event=stage-outcome status=ok providerStatus=200 finishReason=stop",
      "storyboard request=1 event=terminal status=checked http=200",
    ]);
    const captured = logger.lines.join("\n");
    for (const secret of [token, hostName, "Bearer", draft, draftMarker, modelMarker, promptMarker, "Authorization"]) {
      assert.equal(captured.includes(secret), false, secret);
    }
  } finally {
    await close(server);
  }
});

test("logs one configuration terminal when the handler rejects after interpret-start", async () => {
  const secret = "UNEXPECTED-HANDLER-SECRET-4f91c2";
  const logger = capturingLogger();
  let calls = 0;
  const env = new Proxy({
    BASE_URL: `https://${hostName}`,
    CONTEST_API_TOKEN: token,
    CONTEST_MODEL: "gpt-5.5",
  }, {
    get(target, prop, receiver) {
      if (prop === "CONTEST_MODEL") throw new Error(`configuration exploded ${secret}`);
      return Reflect.get(target, prop, receiver);
    },
  });
  const server = createServer({
    logger,
    env,
    fetchImpl: async () => {
      calls += 1;
      throw new Error(`provider should not be called ${secret}`);
    },
  });
  const port = await listen(server);
  try {
    const response = await postDraft(port, `Аня: ${draftMarker}`);
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "configuration" });
    assert.equal(calls, 0);
    assert.deepEqual(logger.lines, [
      "storyboard request=1 event=interpret-start",
      "storyboard request=1 event=terminal status=failed kind=configuration http=500",
    ]);
    const captured = logger.lines.join("\n");
    for (const hidden of [secret, "exploded", token, hostName, draftMarker, "Bearer"]) {
      assert.equal(captured.includes(hidden), false, hidden);
    }
  } finally {
    await close(server);
  }
});
