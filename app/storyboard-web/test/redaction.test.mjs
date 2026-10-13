import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer, DEFAULT_MAX_BODY_BYTES } from "../server.mjs";

const sentinel = "УНИКАЛЬНАЯ-РЕПЛИКА-7781";
const token = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const databaseUrl = "postgres://comics:super-secret-db@127.0.0.1:9/comics_test";

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

function send(port, { method = "PUT", path = "/api/draft", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : body;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        ...headers,
        ...(payload == null ? {} : { "content-length": Buffer.byteLength(payload) }),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function json(value) {
  return JSON.stringify(value);
}

test("draft-save logs and the stale body omit the draft and secrets", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const logs = [];
  let calls = 0;
  const server = createServer({
    migrate: false,
    logger: { log(line) { logs.push(String(line)); } },
    projectStore: {
      async loadProject() {
        return {
          draft: { text: "", revisionToken: token },
          activeSourceRevisionId: null,
          activeMaterialStateId: null,
          reading: null,
          sourceRevisions: [],
          storyboards: [],
        };
      },
      async saveDraft() {
        calls += 1;
        return { ok: false, httpStatus: 409, kind: "stale-draft" };
      },
    },
  });
  try {
    const port = await listen(server);
    const response = await send(port, {
      headers: {
        "content-type": "application/json",
        authorization: "Bearer super-secret",
      },
      body: json({ text: `${sentinel} Bearer super-secret`, revisionToken: token }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "stale-draft" });
    assert.equal(calls, 1);
    const captured = [...logs, response.body].join("\n");
    for (const secret of [sentinel, "Bearer", "super-secret", databaseUrl, "DATABASE_URL", token]) {
      assert.equal(captured.includes(secret), false, secret);
    }
    assert.match(logs.join("\n"), /event=draft-save/);
    assert.match(logs.join("\n"), /kind=stale-draft/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await close(server);
  }
});

test("draft writes reject the wrong shape, NUL, an unpaired surrogate, and an oversized body", async () => {
  let calls = 0;
  const server = createServer({
    migrate: false,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    projectStore: {
      async loadProject() {
        throw new Error("load was called");
      },
      async saveDraft() {
        calls += 1;
        throw new Error("invalid draft was stored");
      },
    },
  });
  try {
    const port = await listen(server);
    const wrongType = await send(port, {
      headers: { "content-type": "application/json" },
      body: json({ text: 1, revisionToken: token }),
    });
    assert.equal(wrongType.status, 400);
    assert.deepEqual(JSON.parse(wrongType.body), { status: "failed", kind: "invalid-request" });

    const nul = await send(port, {
      headers: { "content-type": "application/json" },
      body: json({ text: "a\u0000b", revisionToken: token }),
    });
    assert.equal(nul.status, 400);
    assert.deepEqual(JSON.parse(nul.body), { status: "failed", kind: "invalid-request" });

    const surrogate = await send(port, {
      headers: { "content-type": "application/json" },
      body: json({ text: "a\uD800b", revisionToken: token }),
    });
    assert.equal(surrogate.status, 400);
    assert.deepEqual(JSON.parse(surrogate.body), { status: "failed", kind: "invalid-request" });

    const oversized = await send(port, {
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(DEFAULT_MAX_BODY_BYTES + 1, 0x61),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body, "");
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test("material-state logs and the HTTP body omit the draft, names, and aliases", async () => {
  const characterName = "Имя-Персонажа-7781";
  const aliasText = "Обращение-7781";
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const logs = [];
  const server = createServer({
    migrate: false,
    logger: { log(line) { logs.push(String(line)); } },
    projectStore: {
      async reviseMaterialState() {
        return {
          ok: true,
          httpStatus: 200,
          materialStateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sourceRevisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          interpretationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        };
      },
    },
  });
  try {
    const port = await listen(server);
    const response = await send(port, {
      method: "POST",
      path: "/api/material-states",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer super-secret",
      },
      body: json({
        characters: [{ name: characterName }],
        aliases: [{ surface: `${sentinel} ${aliasText}`, characterName }],
        speakers: [{ sourceItemId: "u1", characterName }],
      }),
    });
    assert.equal(response.status, 200);
    const captured = [...logs, response.body].join("\n");
    for (const secret of [sentinel, characterName, aliasText, "Bearer", "super-secret", databaseUrl, "DATABASE_URL"]) {
      assert.equal(captured.includes(secret), false, secret);
    }
    const line = logs.find((entry) => entry.includes("event=material-state"));
    assert.equal(typeof line, "string");
    const keys = line.slice("storyboard ".length).split(" ").map((part) => part.split("=")[0]);
    for (const key of keys) {
      assert.equal(["request", "event", "status", "kind", "http", "codes"].includes(key), true, key);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await close(server);
  }
});

const providerRaw = "PROVIDER-RAW-7781";
const providerHost = "provider.example.test";
const apiToken = "test-token";

function storyboardEnv(timeout) {
  return {
    BASE_URL: `https://${providerHost}`,
    CONTEST_API_TOKEN: apiToken,
    CONTEST_MODEL: "test-model",
    ...(timeout ? { CONTEST_TIMEOUT_MS: timeout } : {}),
  };
}

function assertPersistRedaction(logs, body) {
  const captured = [...logs, body].join("\n");
  for (const secret of [sentinel, providerRaw, "Bearer", "super-secret", apiToken, providerHost, databaseUrl, "DATABASE_URL"]) {
    assert.equal(captured.includes(secret), false, secret);
  }
  const line = logs.find((entry) => entry.includes("event=storyboard-persist"));
  assert.equal(typeof line, "string");
  const keys = line.slice("storyboard ".length).split(" ").map((part) => part.split("=")[0]);
  for (const key of keys) {
    assert.equal(["request", "event", "status", "kind", "http", "codes", "providerStatus", "finishReason", "schema"].includes(key), true, key);
  }
}

test("storyboard-persist logs and the 502 body omit dialogue, provider text, and credentials", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const logs = [];
  const server = createServer({
    migrate: false,
    env: storyboardEnv(),
    logger: { log(line) { logs.push(String(line)); } },
    fetchImpl: async () => ({
      status: 502,
      async text() {
        return json({ error: sentinel, body: providerRaw, token: apiToken });
      },
    }),
    projectStore: {
      async stageActiveMaterial({ stage }) {
        const staged = await stage({
          draftText: sentinel,
          sourceItems: [{
            id: "u1",
            kind: "utterance",
            segmentIds: ["seg-0"],
            speakerStatus: "explicit",
            speakerLabel: "Путин",
            sourceQuote: sentinel,
            text: sentinel,
          }],
          cast: {
            characters: [{ id: "11111111-1111-4111-8111-111111111111", name: "Песков" }],
            aliases: [{ surface: "Дмитрий Сергеевич", characterId: "11111111-1111-4111-8111-111111111111" }],
            speakers: [{ sourceItemId: "u1", characterId: "11111111-1111-4111-8111-111111111111" }],
          },
        });
        return { ...staged, dialogue: sentinel, providerBody: providerRaw };
      },
    },
  });
  try {
    const port = await listen(server);
    const response = await send(port, {
      method: "POST",
      path: "/api/storyboard-results",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer super-secret",
      },
      body: json({ draft: sentinel, note: providerRaw }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "provider" });
    assertPersistRedaction(logs, response.body);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await close(server);
  }
});

test("storyboard-persist logs and the 504 body omit dialogue, exception text, and credentials", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const logs = [];
  const server = createServer({
    migrate: false,
    env: storyboardEnv("30"),
    logger: { log(line) { logs.push(String(line)); } },
    fetchImpl: (_url, init) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`hung ${sentinel} ${providerRaw}`)), 2000);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error(`aborted ${sentinel} ${providerRaw}`);
        error.name = "AbortError";
        reject(error);
      });
    }),
    projectStore: {
      async stageActiveMaterial({ stage }) {
        const staged = await stage({
          draftText: sentinel,
          sourceItems: [{
            id: "u1",
            kind: "utterance",
            segmentIds: ["seg-0"],
            speakerStatus: "explicit",
            speakerLabel: "Путин",
            sourceQuote: sentinel,
            text: sentinel,
          }],
          cast: null,
        });
        return { ...staged, dialogue: sentinel, exceptionText: `aborted ${sentinel}` };
      },
    },
  });
  try {
    const port = await listen(server);
    const response = await send(port, {
      method: "POST",
      path: "/api/storyboard-results",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer super-secret",
      },
      body: json({ draft: sentinel }),
    });
    assert.equal(response.status, 504);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "timeout" });
    assertPersistRedaction(logs, response.body);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await close(server);
  }
});

test("research note protected-content rejection never echoes secrets in body or operational logs", async () => {
  const { createResearchStore } = await import("../research-store.mjs");
  const secret = "Bearer redaction-research-canary-token";
  const logs = [];
  const researchStore = createResearchStore({ memory: true });
  const server = createServer({
    migrate: false,
    researchStore,
    logger: { log(line) { logs.push(String(line)); } },
    projectStore: {
      async loadProject() {
        throw new Error("project store unused for research canary");
      },
    },
  });
  try {
    const port = await listen(server);
    const before = await send(port, { method: "GET", path: "/api/research/trace" });
    assert.equal(before.status, 200);
    const beforeCount = JSON.parse(before.body).events.length;
    const response = await send(port, {
      method: "POST",
      path: "/api/research/notes",
      headers: { "content-type": "application/json" },
      body: json({
        submittedText: secret,
        context: {
          workflowPhase: null,
          storyboardVersionId: null,
          displayFrameNumber: null,
          displayFrameId: null,
          structureFrameId: null,
          structureSegmentIndex: null,
          panelIndex: null,
          panelSubject: null,
          imageAssetId: null,
          generationId: null,
          characterName: null,
          anchorVersionId: null,
        },
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "protected-content" });
    const captured = [...logs, response.body].join("\n");
    assert.equal(captured.includes(secret), false);
    assert.equal(captured.includes("redaction-research-canary-token"), false);
    const after = await send(port, { method: "GET", path: "/api/research/trace" });
    assert.equal(JSON.parse(after.body).events.length, beforeCount);
  } finally {
    await close(server);
  }
});
