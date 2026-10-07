import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer } from "../server.mjs";

const token = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const nextToken = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

function send(port, { method, path, body }) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: payload == null ? {} : {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
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
    if (payload != null) req.write(payload);
    req.end();
  });
}

test("draft routes stay available and a reading without provider settings does not call fetch", async () => {
  let fetched = false;
  const server = createServer({
    migrate: false,
    env: {},
    fetchImpl: async () => {
      fetched = true;
      throw new Error("provider was called");
    },
    projectStore: {
      async loadProject() {
        return {
          draft: { text: "Путин: да", revisionToken: token },
          activeSourceRevisionId: null,
          activeMaterialStateId: null,
          reading: null,
          sourceRevisions: [],
          storyboards: [],
        };
      },
      async saveDraft() {
        return { ok: true, httpStatus: 200, revisionToken: nextToken };
      },
    },
  });
  const port = await listen(server);
  try {
    const loaded = await send(port, { method: "GET", path: "/api/project" });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.includes("configuration"), false);
    const project = JSON.parse(loaded.body);
    assert.equal(project.draft.text, "Путин: да");

    const saved = await send(port, {
      method: "PUT",
      path: "/api/draft",
      body: { text: "Путин: да", revisionToken: token },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.includes("configuration"), false);
    assert.deepEqual(JSON.parse(saved.body), { revisionToken: nextToken });

    const reading = await send(port, { method: "POST", path: "/api/readings" });
    assert.equal(reading.status, 500);
    assert.deepEqual(JSON.parse(reading.body), { status: "failed", kind: "configuration" });
    assert.equal(fetched, false);
  } finally {
    await close(server);
  }
});
