import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadManifest } from "../manifest.mjs";
import { createDiagnosticServer, unsafeRequestReason } from "../server.mjs";

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "spike-a-http-"));
  const archive = join(root, "archive");
  const runDir = join(root, "output", "a1-20261023T120000Z", "item-one");
  mkdirSync(archive, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  const source = join(archive, "item.png");
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 90, g: 110, b: 134 } },
  }).png().toFile(source);
  const sha256 = createHash("sha256").update(await sharp(source).toBuffer()).digest("hex");
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    id: "fixture",
    version: 1,
    roots: { archive },
    items: [{
      id: "item-one",
      root: "archive",
      path: "item.png",
      sha256,
      corpus: "contemporary-prompt-only",
      extractionRole: "primary",
    }],
  }));
  writeFileSync(join(runDir, "..", "run.json"), JSON.stringify({
    manifestHash: "b".repeat(64),
    providerCalls: 0,
    thresholds: { version: "test" },
    summary: { statuses: { "candidate-pass": 1, review: 0, reject: 0 } },
    timing: { extractCore: { maxMs: 1 } },
    sourceImmutability: { unchanged: true, items: [] },
    items: [{
      id: "item-one",
      alias: "archive/item.png",
      corpus: "contemporary-prompt-only",
      extractionRole: "primary",
      status: "candidate-pass",
      reasons: [],
      warnings: [],
    }],
  }));
  await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).png().toFile(join(runDir, "foreground.png"));
  const secret = join(root, "secret.env");
  writeFileSync(secret, "TOPSECRET");
  symlinkSync(secret, join(runDir, "crop-hair.png"));
  const manifest = loadManifest(manifestPath);
  const server = createDiagnosticServer({ manifest, runDir: join(runDir, "..") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, port: address.port, host: address.address };
}

test("diagnostic server stays on localhost and refuses traversal", { timeout: 8000 }, async () => {
  assert.equal(unsafeRequestReason("/artifact/item-one/../../.env"), "forbidden-path");
  assert.equal(unsafeRequestReason("/source/%2e%2e/%2e%2e/secret"), "forbidden-path");
  assert.equal(unsafeRequestReason("/artifact/item-one/.env.local"), "forbidden-path");
  const { server, port, host } = await fixture();
  try {
    assert.equal(host, "127.0.0.1");
    const page = await request(port, "/");
    assert.equal(page.status, 200);
    assert.match(page.body.toString("utf8"), /Foreground extraction review/);
    const api = await request(port, "/api/run");
    assert.equal(api.status, 200);
    const payload = JSON.parse(api.body.toString("utf8"));
    assert.equal(payload.providerCalls, 0);
    assert.match(payload.ownerReview.reloadLoss, /reload/i);
    const source = await request(port, "/source/item-one");
    assert.equal(source.status, 200);
    assert.equal(source.body.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const artifact = await request(port, "/artifact/item-one/foreground.png");
    assert.equal(artifact.status, 200);
    const traversal = await request(port, "/artifact/item-one/../../.env");
    assert.equal(traversal.status, 400);
    assert.equal(traversal.body.includes(Buffer.from("TOPSECRET")), false);
    const encoded = await request(port, "/source/%2e%2e/secret.env");
    assert.equal(encoded.status, 400);
    const symlink = await request(port, "/artifact/item-one/crop-hair.png");
    assert.equal(symlink.status, 403);
    assert.equal(symlink.body.includes(Buffer.from("TOPSECRET")), false);
    const missing = await request(port, "/source/not-a-real-item");
    assert.equal(missing.status, 404);
    const queryEscape = await request(port, "/source/item-one?path=/etc/passwd");
    assert.equal(queryEscape.status, 200);
    assert.equal(queryEscape.body.includes(Buffer.from("root:")), false);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
