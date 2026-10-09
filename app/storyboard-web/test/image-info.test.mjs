import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  IDENTITY_MAX_BODY_BYTES,
  IDENTITY_MAX_BYTES,
  inspectPngAlpha,
  parseIdentityImage,
  parseImageDataUrl,
  pngHasUsableAlpha,
} from "../image-info.mjs";
import { encodeRgbPng, encodeRgbaPng } from "../image-matte.mjs";
import { heicLike, PNG, tinyJpeg } from "./visual-repair-fixtures.mjs";

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

const sampleDir = fileURLToPath(new URL(
  "../../../specs/006-reproducible-hybrid-dialogue-frame/research/asset-alpha-samples/",
  import.meta.url,
));
const cutoutPath = fileURLToPath(new URL(
  "../../../specs/006-reproducible-hybrid-dialogue-frame/research/provider-alpha-probe/R2-chromakey-cutout.png",
  import.meta.url,
));
const opaqueSamplePath = fileURLToPath(new URL(
  "../../../specs/006-reproducible-hybrid-dialogue-frame/research/asset-alpha-samples/panel-image-8b57ddb2.png",
  import.meta.url,
));

test("valid PNG and JPEG identity photos return bytes", () => {
  const png = parseIdentityImage(dataUrl("image/png", PNG));
  assert.equal(png.ok, true);
  assert.equal(png.mime, "image/png");
  assert.deepEqual(png.bytes, PNG);
  const jpeg = parseIdentityImage(dataUrl("image/jpeg", tinyJpeg()));
  assert.equal(jpeg.ok, true);
  assert.equal(jpeg.mime, "image/jpeg");
  assert.deepEqual(jpeg.bytes, tinyJpeg());
  const alias = parseIdentityImage(dataUrl("image/jpg", tinyJpeg()));
  assert.equal(alias.ok, true);
  assert.equal(alias.mime, "image/jpeg");
  const parsed = parseImageDataUrl(dataUrl("image/png", PNG));
  assert.ok(Buffer.isBuffer(parsed.bytes));
});

test("HEIC, oversize, and unreadable identity images return specific kinds", () => {
  assert.equal(parseIdentityImage(dataUrl("image/heic", heicLike())).kind, "unsupported-image-format");
  assert.equal(parseIdentityImage(dataUrl("image/heif", heicLike())).kind, "unsupported-image-format");
  assert.equal(parseIdentityImage(dataUrl("image/jpeg", heicLike())).kind, "unsupported-image-format");
  const padded = Buffer.concat([PNG, Buffer.alloc((IDENTITY_MAX_BYTES + 1) - PNG.length)]);
  assert.equal(parseIdentityImage(dataUrl("image/png", padded)).kind, "image-too-large");
  assert.equal(parseIdentityImage(dataUrl("image/png", Buffer.from("not-an-image"))).kind, "invalid-image");
});

test("raw size and encoded JSON body limits stay consistent", () => {
  const encodedLength = Math.ceil(IDENTITY_MAX_BYTES * 4 / 3);
  const wrapper = Buffer.byteLength(JSON.stringify({ imageDataUrl: "data:image/jpeg;base64,", comment: "" }));
  assert.equal(IDENTITY_MAX_BYTES, 12 * 1024 * 1024);
  assert.equal(IDENTITY_MAX_BODY_BYTES >= encodedLength + wrapper, true);
});

test("PNG inspection reports color type, alpha channel, and transparent samples", () => {
  const opaqueRgb = encodeRgbPng(2, 2, Buffer.from([
    10, 20, 30, 40, 50, 60,
    70, 80, 90, 100, 110, 120,
  ]));
  const opaqueInfo = inspectPngAlpha(opaqueRgb);
  assert.equal(opaqueInfo.isPng, true);
  assert.equal(opaqueInfo.colorType, 2);
  assert.equal(opaqueInfo.hasAlphaChannel, false);
  assert.equal(opaqueInfo.transparentSampleCount, 0);
  assert.equal(pngHasUsableAlpha(opaqueRgb), false);
  assert.equal(opaqueInfo.mime, "image/png");

  const rgba = Buffer.alloc(2 * 2 * 4);
  rgba.set([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0]);
  const alphaPng = encodeRgbaPng(2, 2, rgba);
  const alphaInfo = inspectPngAlpha(alphaPng);
  assert.equal(alphaInfo.colorType, 6);
  assert.equal(alphaInfo.hasAlphaChannel, true);
  assert.equal(alphaInfo.transparentSampleCount, 2);
  assert.equal(alphaInfo.opaqueSampleCount, 2);
  assert.equal(alphaInfo.minAlpha, 0);
  assert.equal(alphaInfo.maxAlpha, 255);
  assert.equal(pngHasUsableAlpha(alphaPng), true);

  const researchOpaque = inspectPngAlpha(readFileSync(opaqueSamplePath));
  assert.equal(researchOpaque.colorType, 2);
  assert.equal(researchOpaque.hasAlphaChannel, false);
  assert.equal(pngHasUsableAlpha(readFileSync(opaqueSamplePath)), false);

  const researchCutout = inspectPngAlpha(readFileSync(cutoutPath));
  assert.equal(researchCutout.colorType, 6);
  assert.equal(researchCutout.hasAlphaChannel, true);
  assert.ok(researchCutout.transparentSampleCount > 0);
  assert.equal(pngHasUsableAlpha(readFileSync(cutoutPath)), true);

  // MIME/image/png alone must never imply usable transparency.
  assert.equal(parseIdentityImage(dataUrl("image/png", opaqueRgb)).mime, "image/png");
  assert.equal(pngHasUsableAlpha(opaqueRgb), false);
  assert.ok(sampleDir.endsWith("asset-alpha-samples/"));
});
