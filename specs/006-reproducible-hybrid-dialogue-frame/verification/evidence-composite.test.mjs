import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePngRgba } from "../../../app/storyboard-web/image-matte.mjs";
import {
  assembleRepresentativeHybridFrame,
  blitAgainstFill,
  blitSourceOver,
  hasOpaqueRectangularBackplate,
} from "./evidence-composite.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROUND2 = join(ROOT, "live", "round-2");

test("blitSourceOver keeps destination under transparent pixels and blends partial alpha", () => {
  const dest = Buffer.from([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]);
  const src = Buffer.from([
    0, 0, 0, 0, // fully transparent → leave dest
    200, 100, 50, 128, // 50% over second pixel
  ]);
  blitSourceOver(dest, 2, 1, src, 2, 1, 0, 0);
  assert.deepEqual([...dest.slice(0, 4)], [10, 20, 30, 255]);
  assert.equal(dest[4], Math.round(200 * 0.5 + 40 * 0.5));
  assert.equal(dest[5], Math.round(100 * 0.5 + 50 * 0.5));
  assert.equal(dest[6], Math.round(50 * 0.5 + 60 * 0.5));
  assert.equal(dest[7], 255);
});

test("blitSourceOver replaces destination under fully opaque source pixels", () => {
  const dest = Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]);
  const src = Buffer.from([9, 8, 7, 255, 0, 0, 0, 0]);
  blitSourceOver(dest, 2, 1, src, 2, 1, 0, 0);
  assert.deepEqual([...dest.slice(0, 4)], [9, 8, 7, 255]);
  assert.deepEqual([...dest.slice(4, 8)], [4, 5, 6, 255]);
});

test("blitAgainstFill intentionally paints fill under transparent source (matte-check path)", () => {
  const dest = Buffer.from([10, 20, 30, 255]);
  const src = Buffer.from([0, 0, 0, 0]);
  blitAgainstFill(dest, 1, 1, src, 1, 1, 0, 0, [32, 32, 36, 255]);
  assert.deepEqual([...dest], [32, 32, 36, 255]);
});

test("round-2 representative assembly does not introduce opaque rectangular backplates", () => {
  const required = [
    "shared-background.png",
    "panel-0-cutout-rgba.png",
    "panel-1-cutout-rgba.png",
  ];
  for (const name of required) {
    assert.equal(existsSync(join(ROUND2, name)), true, `missing ${name}`);
  }
  const background = decodePngRgba(readFileSync(join(ROUND2, "shared-background.png")));
  const panel0 = decodePngRgba(readFileSync(join(ROUND2, "panel-0-cutout-rgba.png")));
  const panel1 = decodePngRgba(readFileSync(join(ROUND2, "panel-1-cutout-rgba.png")));
  const assembled = assembleRepresentativeHybridFrame({ background, panel0, panel1 });

  // Sample a mid-gray office pixel from the shared background (away from desk wood).
  const bgSample = [
    background.rgba[((Math.floor(background.height / 2) * background.width) + Math.floor(background.width * 0.7)) * 4],
    background.rgba[((Math.floor(background.height / 2) * background.width) + Math.floor(background.width * 0.7)) * 4 + 1],
    background.rgba[((Math.floor(background.height / 2) * background.width) + Math.floor(background.width * 0.7)) * 4 + 2],
  ];

  assert.equal(
    hasOpaqueRectangularBackplate({
      assembled,
      cutout: panel0,
      placement: assembled.placements.left,
      backgroundSampleRgb: bgSample,
    }),
    false,
    "panel 0 transparent regions must not become opaque dark rectangles",
  );
  assert.equal(
    hasOpaqueRectangularBackplate({
      assembled,
      cutout: panel1,
      placement: assembled.placements.right,
      backgroundSampleRgb: bgSample,
    }),
    false,
    "panel 1 transparent regions must not become opaque dark rectangles",
  );

  // Contrast: the old fill-based path does create backplates.
  const broken = Buffer.from(assembled.rgba);
  // Rebuild with fill-based character blit to prove the detector fires.
  const brokenPlate = Buffer.alloc(assembled.width * assembled.height * 4, 0);
  for (let i = 0; i < brokenPlate.length; i += 4) {
    brokenPlate[i] = 20;
    brokenPlate[i + 1] = 20;
    brokenPlate[i + 2] = 24;
    brokenPlate[i + 3] = 255;
  }
  blitSourceOver(
    brokenPlate,
    assembled.width,
    assembled.height,
    background.rgba,
    background.width,
    background.height,
    0,
    0,
  );
  // Intentionally wrong: fill under transparent cutout pixels.
  const { width: lw, height: lh } = assembled.placements.left;
  // Use a synthetic fully-transparent rect the size of the left placement.
  const empty = Buffer.alloc(lw * lh * 4, 0);
  blitAgainstFill(
    brokenPlate,
    assembled.width,
    assembled.height,
    empty,
    lw,
    lh,
    assembled.placements.left.x,
    assembled.placements.left.y,
    [32, 32, 36, 255],
  );
  assert.equal(
    hasOpaqueRectangularBackplate({
      assembled: { rgba: brokenPlate, width: assembled.width, height: assembled.height },
      cutout: { rgba: empty, width: lw, height: lh },
      placement: { x: assembled.placements.left.x, y: assembled.placements.left.y },
      backgroundSampleRgb: bgSample,
    }),
    true,
    "detector must catch fill-based opaque rectangles",
  );
  assert.ok(broken.length > 0);
});
