import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer, DEFAULT_MAX_BODY_BYTES, routes } from "../server.mjs";

const files = {
  "app/storyboard-web/public/index.html": "<!doctype html><title>injected</title>",
  "app/storyboard-web/public/app.js": "export const injectedApp = true;\n",
  "app/storyboard-web/public/app.css": "body { margin: 0; }\n",
  "app/storyboard-web/public/draft-autosave.mjs": "export function bindDraftAutosave() {}\n",
  "app/storyboard-web/public/research-dock.mjs": "export function bindResearchDock() {}\n",
  "app/storyboard-web/public/anchor-session.mjs": "export function createState() { return {}; }\n",
  "app/storyboard-web/public/anchor-session-ui.mjs": "export function renderAnchorWorkspace() {}\n",
  "app/storyboard-web/overflow.mjs": "export function compileOverflow() {}\n",
  "prototypes/storyboard-viewer/frame-renderer.mjs": "export const injectedRenderer = true;\n",
  "prototypes/storyboard-viewer/viewer.css": ".frame-canvas { font-family: Arial, Helvetica, sans-serif; }\n",
  "app/storyboard-web/public/visual-anchors.mjs": "export function presentVisualFrame() { return null; }\n",
  "app/storyboard-web/public/asset-picker.mjs": "export function openAssetPicker() {}\n",
  "app/storyboard-web/public/export-timing.mjs": "export const CROSS_DISSOLVE_OVERLAP_FRAMES = 6;\n",
  "app/storyboard-web/public/character-anchors/putin.png": "putin-anchor",
  "app/storyboard-web/public/character-anchors/durov.png": "durov-anchor",
  "app/storyboard-web/public/character-anchors/peskov.png": "peskov-anchor",
};

function readFile(filePath) {
  if (!Object.hasOwn(files, filePath)) {
    throw new Error("unexpected file read: " + filePath);
  }
  return files[filePath];
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function send(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

test("names the static allowlist from the storyboard contract", () => {
  assert.equal(DEFAULT_MAX_BODY_BYTES, 262144);
  const actual = routes.map((route) => [route.method, route.path, route.file]);
  assert.deepEqual(actual, [
    ["GET", "/", "app/storyboard-web/public/index.html"],
    ["GET", "/app.js", "app/storyboard-web/public/app.js"],
    ["GET", "/app.css", "app/storyboard-web/public/app.css"],
    ["GET", "/draft-autosave.mjs", "app/storyboard-web/public/draft-autosave.mjs"],
    ["GET", "/research-dock.mjs", "app/storyboard-web/public/research-dock.mjs"],
    ["GET", "/anchor-session.mjs", "app/storyboard-web/public/anchor-session.mjs"],
    ["GET", "/anchor-session-ui.mjs", "app/storyboard-web/public/anchor-session-ui.mjs"],
    ["GET", "/overflow.mjs", "app/storyboard-web/overflow.mjs"],
    ["GET", "/frame-renderer.mjs", "prototypes/storyboard-viewer/frame-renderer.mjs"],
    ["GET", "/viewer.css", "prototypes/storyboard-viewer/viewer.css"],
    ["GET", "/visual-anchors.mjs", "app/storyboard-web/public/visual-anchors.mjs"],
    ["GET", "/asset-picker.mjs", "app/storyboard-web/public/asset-picker.mjs"],
    ["GET", "/export-timing.mjs", "app/storyboard-web/public/export-timing.mjs"],
    ["GET", "/character-anchors/putin.png", "app/storyboard-web/public/character-anchors/putin.png"],
    ["GET", "/character-anchors/durov.png", "app/storyboard-web/public/character-anchors/durov.png"],
    ["GET", "/character-anchors/peskov.png", "app/storyboard-web/public/character-anchors/peskov.png"],
  ]);
});

test("serves injected bytes for allowlisted paths only", async () => {
  const seen = [];
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    readFile(filePath) {
      seen.push(filePath);
      return readFile(filePath);
    },
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  });
  const port = await listen(server);
  try {
    for (const route of routes) {
      const response = await send(port, { path: route.path });
      assert.equal(response.status, 200, route.path);
      assert.equal(response.body, files[route.file], route.path);
    }
    assert.deepEqual(seen, routes.map((route) => route.file));
    const unknown = await send(port, { path: "/app/storyboard-web/public/index.html" });
    assert.equal(unknown.status, 404);
    const escaped = await send(port, { path: "/%2e%2e/%2e%2e/package.json" });
    assert.equal(escaped.status, 404);
    const slash = await send(port, { path: "/..\\..\\package.json" });
    assert.equal(slash.status, 404);
  } finally {
    await close(server);
  }
});

test("rejects the wrong method with Allow and no storyboard body", async () => {
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    readFile,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  });
  const port = await listen(server);
  try {
    const file = await send(port, { method: "POST", path: "/app.js", body: "{}" });
    assert.equal(file.status, 405);
    assert.equal(file.headers.allow, "GET");
    assert.equal(file.body, "");
    const api = await send(port, { method: "GET", path: "/api/storyboard" });
    assert.equal(api.status, 405);
    assert.equal(api.headers.allow, "POST");
    assert.equal(api.body, "");
  } finally {
    await close(server);
  }
});

test("rejects a non-JSON content type, malformed JSON, and a body above the ceiling", async () => {
  const server = createServer({
    enableLegacyStoryboardRoute: true,
    migrate: false,
    readFile,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  });
  const port = await listen(server);
  try {
    const text = await send(port, {
      method: "POST",
      path: "/api/storyboard",
      headers: { "content-type": "text/plain" },
      body: "привет",
    });
    assert.equal(text.status, 415);
    assert.equal(text.body, "");

    const malformed = await send(port, {
      method: "POST",
      path: "/api/storyboard",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(JSON.parse(malformed.body), { status: "failed", kind: "invalid-request" });

    const notDraft = await send(port, {
      method: "POST",
      path: "/api/storyboard",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: "{\"draft\":1}",
    });
    assert.equal(notDraft.status, 400);
    assert.deepEqual(JSON.parse(notDraft.body), { status: "failed", kind: "invalid-request" });

    const oversized = await send(port, {
      method: "POST",
      path: "/api/storyboard",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(DEFAULT_MAX_BODY_BYTES + 1, 0x61),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body, "");

    const declared = await send(port, {
      method: "POST",
      path: "/api/storyboard",
      headers: {
        "content-type": "application/json",
        "content-length": String(DEFAULT_MAX_BODY_BYTES + 1),
      },
      body: "{}",
    });
    assert.equal(declared.status, 413);
    assert.equal(declared.body, "");

    const atCeiling = await send(port, {
      method: "POST",
      path: "/api/storyboard",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(DEFAULT_MAX_BODY_BYTES, 0x7b),
    });
    assert.equal(atCeiling.status, 400);
  } finally {
    await close(server);
  }
});
