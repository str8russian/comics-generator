import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import { createServer } from "../server.mjs";

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

function postStoryboard(port) {
  return new Promise((resolve, reject) => {
    const body = "not-json";
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/storyboard",
      headers: {
        "content-type": "text/plain",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve({
        status: res.statusCode,
        allow: res.headers.allow,
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("default createServer hides POST /api/storyboard without a database", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const server = createServer({
    migrate: false,
    fetchImpl: async () => {
      throw new Error("provider was called");
    },
  });
  try {
    const port = await listen(server);
    const response = await postStoryboard(port);
    assert.equal(response.status, 404);
    assert.equal(response.allow, undefined);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await close(server);
  }
});

test("enableLegacyStoryboardRoute true keeps POST /api/storyboard off 404", async () => {
  const server = createServer({
    migrate: false,
    enableLegacyStoryboardRoute: true,
    fetchImpl: async () => {
      throw new Error("provider was called");
    },
  });
  try {
    const port = await listen(server);
    const response = await postStoryboard(port);
    assert.notEqual(response.status, 404);
  } finally {
    await close(server);
  }
});

test("entrypoint does not skip migration or enable the legacy route", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const marker = "if (process.argv[1]";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1);
  const entry = source.slice(start);
  assert.equal(entry.includes("migrate: false"), false);
  assert.equal(entry.includes("enableLegacyStoryboardRoute"), false);
  assert.match(entry, /startServer\(/);
});
