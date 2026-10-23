import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer } from "../server.mjs";

const PROJECT = "/api/projects/00000000-0000-4000-8000-000000000001";

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

function send(port, { method = "GET", path: requestPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

test("duplicateFrame stays on the operations route and does not call an image provider", async () => {
  let generatorCalls = 0;
  let dropped = 0;
  let received = null;
  const server = createServer({
    migrate: false,
    imageGenerator: async () => {
      generatorCalls += 1;
      return { ok: true, image: { bytes: Buffer.from("nope"), mime: "image/png" } };
    },
    renderController: {
      async dropCurrent() {
        dropped += 1;
      },
    },
    visualStore: {
      async applyOperation(input) {
        received = input;
        return {
          ok: true,
          changed: true,
          invalidateRender: true,
          operationResult: {
            op: "duplicateFrame",
            source: { structureFrameId: "source-frame", structureSegmentIndex: null },
            created: { structureFrameId: "frame-copy", structureSegmentIndex: null },
          },
        };
      },
      async load() {
        return {
          ok: true,
          status: "ready",
          storyboardVersionId: "version-2",
          approved: false,
          readyForVideo: false,
          frames: [
            { id: "source-frame", structureFrameId: "source-frame" },
            { id: "frame-copy", structureFrameId: "frame-copy" },
          ],
        };
      },
    },
  });
  const port = await listen(server);
  try {
    const response = await send(port, {
      method: "POST",
      path: `${PROJECT}/visual/operations`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "duplicateFrame",
        structureFrameId: "source-frame",
        structureSegmentIndex: null,
        displayFrameNumber: 2,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ready");
    assert.equal(response.body.changed, true);
    assert.equal(response.body.approved, false);
    assert.deepEqual(response.body.operationResult, {
      op: "duplicateFrame",
      source: { structureFrameId: "source-frame", structureSegmentIndex: null },
      created: { structureFrameId: "frame-copy", structureSegmentIndex: null },
    });
    assert.equal(received.op, "duplicateFrame");
    assert.equal(received.structureFrameId, "source-frame");
    assert.equal(generatorCalls, 0);
    assert.equal(dropped, 1);
  } finally {
    await close(server);
  }
});

test("a rejected duplicate leaves the route without a created address or a provider call", async () => {
  let generatorCalls = 0;
  let dropped = 0;
  const server = createServer({
    migrate: false,
    imageGenerator: async () => {
      generatorCalls += 1;
      return { ok: true, image: { bytes: Buffer.from("nope"), mime: "image/png" } };
    },
    renderController: {
      async dropCurrent() {
        dropped += 1;
      },
    },
    visualStore: {
      async applyOperation() {
        return { ok: false, httpStatus: 400, kind: "frame-not-found" };
      },
      async load() {
        throw new Error("load should not run after a rejected duplicate");
      },
    },
  });
  const port = await listen(server);
  try {
    const response = await send(port, {
      method: "POST",
      path: `${PROJECT}/visual/operations`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "duplicateFrame", structureFrameId: "missing" }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.kind, "frame-not-found");
    assert.equal(response.body.operationResult, undefined);
    assert.equal(generatorCalls, 0);
    assert.equal(dropped, 0);
  } finally {
    await close(server);
  }
});
