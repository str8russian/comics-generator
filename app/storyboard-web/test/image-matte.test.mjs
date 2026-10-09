import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { after, before } from "node:test";
import { inspectPngAlpha } from "../image-info.mjs";
import {
  encodeRgbPng,
  encodeRgbaPng,
  extractChromakeyMatte,
  MATTE_THRESHOLDS,
  measureMatteAcceptance,
} from "../image-matte.mjs";

let tempDir;

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), "hybrid-matte-"));
});

after(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function solidRgb(width, height, rgb, subjectRect = null) {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const inSubject = subjectRect
        && x >= subjectRect.x
        && y >= subjectRect.y
        && x < subjectRect.x + subjectRect.w
        && y < subjectRect.y + subjectRect.h;
      const color = inSubject ? subjectRect.rgb : rgb;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }
  return encodeRgbPng(width, height, buf);
}

test("chromakey matte removes green backing, preserves subject, and rejects spill/fringe failures", () => {
  const raw = solidRgb(32, 32, [0, 255, 0], {
    x: 8,
    y: 8,
    w: 16,
    h: 16,
    rgb: [40, 40, 40],
  });
  const matte = extractChromakeyMatte(raw);
  assert.equal(matte.ok, true);
  assert.equal(matte.kind, null);
  const alpha = inspectPngAlpha(matte.rgbaBytes);
  assert.equal(alpha.colorType, 6);
  assert.ok(alpha.transparentSampleCount > 0);
  assert.ok(matte.acceptance.opaqueSubjectRatio >= MATTE_THRESHOLDS.minOpaqueSubjectRatio);
  assert.equal(matte.acceptance.opaqueGreenSpill, 0);
  assert.ok(matte.acceptance.edgeFringeRatio <= MATTE_THRESHOLDS.maxEdgeFringeRatio);

  const compositePath = join(tempDir, "composite-light.png");
  const composite = Buffer.from(matte.rgba);
  for (let i = 0; i < composite.length; i += 4) {
    if (composite[i + 3] === 0) {
      composite[i] = 240;
      composite[i + 1] = 240;
      composite[i + 2] = 240;
      composite[i + 3] = 255;
    }
  }
  writeFileSync(compositePath, encodeRgbaPng(matte.width, matte.height, composite));
  assert.ok(compositePath.startsWith(tempDir));

  // Green-dominant "subject" is keyed away → subject-erased / fail-closed.
  const greenSubject = solidRgb(24, 24, [0, 255, 0], {
    x: 6,
    y: 6,
    w: 12,
    h: 12,
    rgb: [20, 220, 20],
  });
  const erased = extractChromakeyMatte(greenSubject);
  assert.equal(erased.ok, false);
  assert.equal(erased.kind, "matte-failed");
  assert.ok(
    erased.reasons.includes("subject-erased")
    || erased.reasons.includes("fully-opaque-or-insufficient-transparency")
    || erased.reasons.includes("green-spill"),
  );

  const acceptance = measureMatteAcceptance(matte.rgba, matte.width, matte.height);
  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.opaqueGreenSpill, 0);
});

test("edge cleanup removes residual fringe-class greens that are not fully keyed", () => {
  // Reproduces the live-provider failure mode: silhouette edge pixels with moderate
  // green dominance survive keyed-green removal and previously failed edge-fringe acceptance.
  const width = 48;
  const height = 48;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const inCore = x >= 14 && x < 34 && y >= 12 && y < 38;
      const inFringeRing = !inCore && x >= 12 && x < 36 && y >= 10 && y < 40;
      if (inCore) {
        rgb[i] = 52;
        rgb[i + 1] = 48;
        rgb[i + 2] = 44;
      } else if (inFringeRing) {
        rgb[i] = 40;
        rgb[i + 1] = 90;
        rgb[i + 2] = 45;
      } else {
        rgb[i] = 0;
        rgb[i + 1] = 255;
        rgb[i + 2] = 0;
      }
    }
  }
  const raw = encodeRgbPng(width, height, rgb);
  const matte = extractChromakeyMatte(raw);
  assert.equal(matte.ok, true, `expected fringe cleanup to accept, got ${matte.reasons?.join(",")}`);
  assert.ok(matte.acceptance.edgeFringeRatio <= MATTE_THRESHOLDS.maxEdgeFringeRatio);
  assert.equal(matte.acceptance.opaqueGreenSpill, 0);
  assert.ok(matte.acceptance.opaqueSubjectRatio >= MATTE_THRESHOLDS.minOpaqueSubjectRatio);
});

test("invalid provider output fails closed as matte-failed", () => {
  const opaqueSubject = solidRgb(16, 16, [30, 30, 30]);
  const opaque = extractChromakeyMatte(opaqueSubject);
  assert.equal(opaque.ok, false);
  assert.equal(opaque.kind, "matte-failed");
  assert.ok(opaque.reasons.includes("non-green-backing"));

  const checker = Buffer.alloc(16 * 16 * 3);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const on = ((x >> 2) + (y >> 2)) % 2 === 0;
      const i = (y * 16 + x) * 3;
      const v = on ? 220 : 40;
      checker[i] = v;
      checker[i + 1] = v;
      checker[i + 2] = v;
    }
  }
  const fakeAlpha = extractChromakeyMatte(encodeRgbPng(16, 16, checker));
  assert.equal(fakeAlpha.ok, false);
  assert.equal(fakeAlpha.kind, "matte-failed");
  assert.ok(
    fakeAlpha.reasons.includes("checkerboard-or-fake-alpha")
    || fakeAlpha.reasons.includes("non-green-backing"),
  );

  const blueBacking = solidRgb(20, 20, [0, 0, 255], {
    x: 5,
    y: 5,
    w: 10,
    h: 10,
    rgb: [50, 50, 50],
  });
  const nonGreen = extractChromakeyMatte(blueBacking);
  assert.equal(nonGreen.ok, false);
  assert.equal(nonGreen.kind, "matte-failed");
  assert.ok(nonGreen.reasons.includes("non-green-backing"));
});
