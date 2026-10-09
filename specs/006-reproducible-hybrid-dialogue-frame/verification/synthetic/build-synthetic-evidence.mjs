#!/usr/bin/env node
/**
 * Deterministic synthetic matte/composite evidence for feature 006.
 * Uses only local synthetic chromakey fixtures — not live provider output.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeRgbPng,
  encodeRgbaPng,
  extractChromakeyMatte,
  MATTE_THRESHOLDS,
  measureMatteAcceptance,
} from "../../../../app/storyboard-web/image-matte.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

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

function compositeOver(rgba, width, height, backgroundRgb) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * alpha + backgroundRgb[0] * (1 - alpha));
    out[i + 1] = Math.round(rgba[i + 1] * alpha + backgroundRgb[1] * (1 - alpha));
    out[i + 2] = Math.round(rgba[i + 2] * alpha + backgroundRgb[2] * (1 - alpha));
    out[i + 3] = 255;
  }
  return encodeRgbaPng(width, height, out);
}

const backgrounds = {
  light: [245, 245, 245],
  dark: [20, 20, 24],
  contrast: [255, 0, 128],
};

const acceptableRaw = solidRgb(48, 48, [0, 255, 0], {
  x: 12,
  y: 10,
  w: 24,
  h: 28,
  rgb: [52, 48, 44],
});
const unacceptableRaw = solidRgb(32, 32, [0, 255, 0], {
  x: 8,
  y: 8,
  w: 16,
  h: 16,
  rgb: [10, 230, 10],
});

mkdirSync(ROOT, { recursive: true });
writeFileSync(join(ROOT, "acceptable-chromakey-raw.png"), acceptableRaw);
writeFileSync(join(ROOT, "unacceptable-chromakey-raw.png"), unacceptableRaw);

const accepted = extractChromakeyMatte(acceptableRaw);
assert.equal(accepted.ok, true, "acceptable synthetic must pass matte");
writeFileSync(join(ROOT, "acceptable-cutout-rgba.png"), accepted.rgbaBytes);
const acceptance = measureMatteAcceptance(accepted.rgba, accepted.width, accepted.height);
for (const [name, rgb] of Object.entries(backgrounds)) {
  const composite = compositeOver(accepted.rgba, accepted.width, accepted.height, rgb);
  writeFileSync(join(ROOT, `acceptable-composite-${name}.png`), composite);
}

const rejected = extractChromakeyMatte(unacceptableRaw);
assert.equal(rejected.ok, false, "unacceptable synthetic must fail closed");
assert.equal(rejected.kind, "matte-failed");
if (rejected.rgbaBytes) {
  writeFileSync(join(ROOT, "unacceptable-cutout-rgba.png"), rejected.rgbaBytes);
}

const report = {
  claimScope: "synthetic-composite-inspection-only",
  notProofOf: [
    "live-provider-edge-quality",
    "human-visual-acceptance",
  ],
  thresholds: { ...MATTE_THRESHOLDS },
  acceptable: {
    ok: accepted.ok,
    observed: acceptance,
    checks: {
      opaqueGreenSpill: {
        threshold: MATTE_THRESHOLDS.maxOpaqueGreenSpill,
        observed: acceptance.opaqueGreenSpill,
        pass: acceptance.opaqueGreenSpill <= MATTE_THRESHOLDS.maxOpaqueGreenSpill,
      },
      edgeFringeRatio: {
        threshold: MATTE_THRESHOLDS.maxEdgeFringeRatio,
        observed: acceptance.edgeFringeRatio,
        pass: acceptance.edgeFringeRatio <= MATTE_THRESHOLDS.maxEdgeFringeRatio,
      },
      opaqueSubjectRatio: {
        threshold: MATTE_THRESHOLDS.minOpaqueSubjectRatio,
        observed: acceptance.opaqueSubjectRatio,
        pass: acceptance.opaqueSubjectRatio >= MATTE_THRESHOLDS.minOpaqueSubjectRatio,
      },
      transparentRatio: {
        threshold: MATTE_THRESHOLDS.minTransparentRatio,
        observed: acceptance.transparentRatio,
        pass: acceptance.transparentRatio >= MATTE_THRESHOLDS.minTransparentRatio,
      },
    },
    composites: Object.keys(backgrounds).map((name) => `acceptable-composite-${name}.png`),
  },
  unacceptable: {
    ok: rejected.ok,
    kind: rejected.kind,
    reasons: rejected.reasons || [],
    failClosed: rejected.ok === false && rejected.kind === "matte-failed",
  },
};

writeFileSync(join(ROOT, "measurements.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  acceptableOk: report.acceptable.ok,
  unacceptableFailClosed: report.unacceptable.failClosed,
  spill: report.acceptable.checks.opaqueGreenSpill,
  fringe: report.acceptable.checks.edgeFringeRatio,
  subject: report.acceptable.checks.opaqueSubjectRatio,
}, null, 2));
