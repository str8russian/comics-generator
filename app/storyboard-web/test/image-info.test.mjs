import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_MAX_BODY_BYTES,
  IDENTITY_MAX_BYTES,
  parseIdentityImage,
  parseImageDataUrl,
} from "../image-info.mjs";
import { heicLike, PNG, tinyJpeg } from "./visual-repair-fixtures.mjs";

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

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
