import assert from "node:assert/strict";
import test from "node:test";
import { buildImageRequest, extractGeneratedImage, generateImage } from "../image-provider.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");

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

test("provider HTTP 413 becomes a payload-size failure without retaining the response body", async () => {
  const token = "super-secret-token";
  const result = await generateImage({
    prompt: "panel prompt",
    images: [{ mime: "image/png", bytes: png }],
    aspectRatio: "5:4",
    serializedBody: "{\"already\":\"measured\"}",
    env: {
      BASE_URL: "https://gateway.invalid.example/v1",
      CONTEST_API_TOKEN: token,
      IMAGE_MODEL: "image-test",
      IMAGE_TIMEOUT_MS: "1000",
    },
    fetchImpl: async (_url, init) => {
      assert.equal(init.body, "{\"already\":\"measured\"}");
      return new Response(`${token} gateway.invalid.example payload`, { status: 413 });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "provider-payload-too-large");
  assert.equal(result.diagnostics.providerStatus, 413);
  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes(token), false);
  assert.equal(rendered.includes("gateway.invalid.example"), false);
  assert.equal(rendered.includes("panel prompt"), false);
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
