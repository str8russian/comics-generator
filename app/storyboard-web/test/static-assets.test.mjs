import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import { compileOverflow } from "../overflow.mjs";
import { createServer, routes } from "../server.mjs";

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

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method: "GET", path }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves the real static assets byte for byte", async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    for (const route of routes) {
      const response = await get(port, route.path);
      const disk = readFileSync(new URL(`../../../${route.file}`, import.meta.url));
      assert.equal(response.status, 200, route.path);
      assert.deepEqual(response.bytes, disk, route.path);
    }
  } finally {
    await close(server);
  }
});

test("browser module URLs stay on the static allowlist and Node can import the compiler", () => {
  assert.equal(typeof compileOverflow, "function");
  const allow = new Set(routes.map((route) => route.path));
  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const overflow = readFileSync(new URL("../overflow.mjs", import.meta.url), "utf8");
  for (const specifier of ["/app.js", "/overflow.mjs", "/frame-renderer.mjs"]) {
    assert.equal(allow.has(specifier), true, specifier);
  }
  assert.match(appJs, /from "\/overflow\.mjs"/);
  assert.match(appJs, /from "\/frame-renderer\.mjs"/);
  assert.match(overflow, /new URL\("\/frame-renderer\.mjs", import\.meta\.url\)/);
  assert.equal(appJs.includes("document.fonts"), true);
  assert.equal(appJs.includes("await compileOverflow"), false);
  assert.equal(appJs.includes("await FrameRenderer.measureDialogue"), false);
});
