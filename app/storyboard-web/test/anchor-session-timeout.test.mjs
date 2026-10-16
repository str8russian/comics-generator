import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeImageRequest } from "../image-reference-strategy.mjs";
import {
  ANCHOR_SESSION_PROVIDER_CAP_MS,
  anchorSessionProviderTimeoutMs,
  generateImage,
} from "../image-provider.mjs";
import { createServer } from "../server.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const sourceUrl = `data:image/png;base64,${png.toString("base64")}`;

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

function send(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/characters/Mira/anchor-session",
      headers: { "content-type": "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("anchor-session provider budget stays under one minute and keeps a lower configured timeout", () => {
  assert.equal(ANCHOR_SESSION_PROVIDER_CAP_MS, 58_000);
  assert.equal(anchorSessionProviderTimeoutMs({ IMAGE_TIMEOUT_MS: "180000" }), 58_000);
  assert.equal(anchorSessionProviderTimeoutMs({ IMAGE_TIMEOUT_MS: "1000" }), 1000);
  assert.equal(anchorSessionProviderTimeoutMs({
    IMAGE_TIMEOUT_MS: "180000",
    ANCHOR_SESSION_TIMEOUT_MS: "120000",
  }), 58_000);
  assert.equal(anchorSessionProviderTimeoutMs({
    IMAGE_TIMEOUT_MS: "180000",
    ANCHOR_SESSION_TIMEOUT_MS: "40",
  }), 40);
});

test("panel image requests do not receive the anchor-session timeout cap", async () => {
  let seen;
  await executeImageRequest({
    strategy: "passthrough",
    budgetBytes: 850000,
    references: [{ role: "identity", mime: "image/png", bytes: png }],
    generationMode: "initial",
    compilePrompt: () => "panel prompt",
    aspectRatio: "16:9",
    model: "image-test",
    env: { IMAGE_TIMEOUT_MS: "180000", IMAGE_REFERENCE_STRATEGY: "passthrough" },
    imageGenerator: async (input) => {
      seen = input.timeoutMs;
      return { ok: false, kind: "provider", httpStatus: 502 };
    },
  });
  assert.equal(seen, undefined);
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const panel = server.slice(server.indexOf("async function deliverPreparedImage"), server.indexOf("async function resolveSessionImage"));
  const anchor = server.slice(server.indexOf("async function handleAnchorSession"), server.indexOf("async function handleAnchorAccept"));
  assert.equal(panel.includes("timeoutMs"), false);
  assert.match(anchor, /timeoutMs/);
});

test("a hung anchor-session provider request is aborted once and returns timeout", async () => {
  const calls = [];
  const logs = [];
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    calls.push(init.signal);
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const server = createServer({
    migrate: false,
    env: {
      BASE_URL: "https://gateway.invalid.example/v1",
      CONTEST_API_TOKEN: "test-token",
      IMAGE_MODEL: "image-test",
      IMAGE_TIMEOUT_MS: "180000",
      ANCHOR_SESSION_TIMEOUT_MS: "40",
      IMAGE_REFERENCE_STRATEGY: "passthrough",
    },
    fetchImpl,
    imageGenerator: generateImage,
    visualStore: {
      async readAnchorStyle() {
        return null;
      },
    },
    logger: { log(line) { logs.push(line); } },
  });
  const port = await listen(server);
  try {
    const started = Date.now();
    const response = await send(port, {
      basis: "from-source",
      instruction: "",
      sourceImage: sourceUrl,
    });
    const elapsed = Date.now() - started;
    assert.equal(response.status, 504);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "timeout" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].aborted, true);
    assert.ok(elapsed < 1000);
    const rendered = logs.join("\n");
    assert.match(rendered, /kind=timeout/);
    assert.equal(rendered.includes("data:image"), false);
    assert.equal(rendered.includes(sourceUrl), false);
    assert.equal(rendered.includes("test-token"), false);
  } finally {
    await close(server);
  }
});

test("anchor accept forwards one source authority and rejects both", async () => {
  const seen = [];
  const server = createServer({
    migrate: false,
    visualStore: {
      async acceptSessionAnchor(input) {
        seen.push(input);
        if (input.sourceImage && input.sourceAssetId) return { ok: false, kind: "invalid-request", httpStatus: 400 };
        return { ok: true, anchorId: "anchor-1", assetId: "output-1" };
      },
      async load() {
        return { ok: true, status: "ready", characters: [], frames: [] };
      },
    },
    logger: { log() {} },
  });
  const port = await listen(server);
  try {
    const reused = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/characters/Mira/anchor-accept",
        headers: { "content-type": "application/json" },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({
        provenance: "generated_from_source",
        imageDataUrl: sourceUrl,
        sourceAssetId: "source-1",
        instruction: "",
      }));
    });
    assert.equal(reused.status, 200);
    assert.equal(seen[0].sourceAssetId, "source-1");
    assert.equal(seen[0].sourceImage, null);
    assert.equal(seen[0].provenance, "generated_from_source");
    const conflict = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/characters/Mira/anchor-accept",
        headers: { "content-type": "application/json" },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({
        provenance: "generated_from_source",
        imageDataUrl: sourceUrl,
        sourceImageDataUrl: sourceUrl,
        sourceAssetId: "source-1",
      }));
    });
    assert.equal(conflict.status, 400);
    assert.equal(JSON.parse(conflict.body).kind, "invalid-request");
  } finally {
    await close(server);
  }
});
