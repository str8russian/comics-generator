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
