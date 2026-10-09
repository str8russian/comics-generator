import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImageRequest,
  extractGeneratedImage,
  normalizeProviderOutcome,
  resolveImageProviderConfig,
} from "../image-provider.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");

test("resolveImageProviderConfig exposes safe model/settings without credentials", () => {
  const config = resolveImageProviderConfig({
    env: { IMAGE_MODEL: "cfg-model", IMAGE_TIMEOUT_MS: "9000", CONTEST_API_TOKEN: "secret" },
    aspectRatio: "21:9",
    component: "scene-background",
  });
  assert.equal(config.ok, true);
  assert.equal(config.model, "cfg-model");
  assert.equal(config.generationSettings.timeoutMs, 9000);
  assert.equal(config.generationSettings.component, "scene-background");
  assert.equal(JSON.stringify(config).includes("secret"), false);
  assert.equal(JSON.stringify(config).includes("CONTEST_API_TOKEN"), false);
});

test("normalizeProviderOutcome reads success metadata and failure diagnostics", () => {
  assert.deepEqual(normalizeProviderOutcome({
    ok: true,
    image: { bytes: png },
    metadata: { providerStatus: 200, latencyMs: 15, model: "m" },
  }), {
    ok: true,
    image: { bytes: png },
    providerStatus: 200,
    latencyMs: 15,
    model: "m",
  });
  assert.deepEqual(normalizeProviderOutcome({
    ok: false,
    kind: "timeout",
    diagnostics: { providerStatus: 504, latencyMs: 2 },
  }), {
    ok: false,
    kind: "timeout",
    providerStatus: 504,
    latencyMs: 2,
  });
});

test("image request sends prompt before reference images and requests the chosen aspect", () => {
  const request = buildImageRequest({
    prompt: "panel prompt",
    images: [{ mime: "image/png", bytes: png }],
    aspectRatio: "5:4",
    model: "image-test",
  });
  assert.equal(request.model, "image-test");
  assert.deepEqual(request.modalities, ["image", "text"]);
  assert.equal(request.image_config.aspect_ratio, "5:4");
  assert.equal(request.messages[0].content[0].text, "panel prompt");
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
});

test("image extraction accepts a nested provider data URL and validates its bytes", () => {
  const result = extractGeneratedImage({
    choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] } }],
  });
  assert.equal(result.mime, "image/png");
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.deepEqual(result.bytes, png);
});
