import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const BACKGROUNDS = [
  ["composite-black.png", [0, 0, 0]],
  ["composite-white.png", [255, 255, 255]],
  ["composite-magenta.png", [255, 0, 255]],
  ["composite-green.png", [0, 255, 0]],
  ["composite-slate.png", [93, 110, 134]],
];

function checker(x, y) {
  const tile = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) === 0;
  return tile ? [236, 236, 236] : [168, 168, 168];
}

function compositeRgb(rgba, width, height, background) {
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0, p = 0, o = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, p += 4, o += 3) {
      const alpha = rgba[p + 3] / 255;
      const bg = typeof background === "function" ? background(x, y) : background;
      out[o] = Math.round(rgba[p] * alpha + bg[0] * (1 - alpha));
      out[o + 1] = Math.round(rgba[p + 1] * alpha + bg[1] * (1 - alpha));
      out[o + 2] = Math.round(rgba[p + 2] * alpha + bg[2] * (1 - alpha));
    }
  }
  return out;
}

async function writeRgbPng(file, rgb, width, height) {
  await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(file);
}

function clampRect(width, height, rect) {
  const rectWidth = Math.max(1, Math.min(width, Math.round(rect.width)));
  const rectHeight = Math.max(1, Math.min(height, Math.round(rect.height)));
  const left = Math.max(0, Math.min(width - rectWidth, Math.round(rect.x)));
  const top = Math.max(0, Math.min(height - rectHeight, Math.round(rect.y)));
  return { left, top, width: rectWidth, height: rectHeight };
}

function cropRgb(rgb, width, rect) {
  const out = Buffer.alloc(rect.width * rect.height * 3);
  for (let y = 0; y < rect.height; y += 1) {
    const src = ((rect.top + y) * width + rect.left) * 3;
    rgb.copy(out, y * rect.width * 3, src, src + rect.width * 3);
  }
  return out;
}

async function writeEnlarged(file, rgb, width, height, rect) {
  const clamped = clampRect(width, height, rect);
  const cropped = cropRgb(rgb, width, clamped);
  await sharp(cropped, { raw: { width: clamped.width, height: clamped.height, channels: 3 } })
    .resize(clamped.width * 2, clamped.height * 2, { kernel: "nearest" })
    .png()
    .toFile(file);
  return clamped;
}

function stitchHorizontal(left, leftWidth, leftHeight, right, rightWidth, rightHeight) {
  const gap = 8;
  const width = leftWidth + gap + rightWidth;
  const height = Math.max(leftHeight, rightHeight);
  const out = Buffer.alloc(width * height * 3, 32);
  for (let y = 0; y < leftHeight; y += 1) {
    left.copy(out, (y * width) * 3, y * leftWidth * 3, (y + 1) * leftWidth * 3);
  }
  for (let y = 0; y < rightHeight; y += 1) {
    right.copy(out, (y * width + leftWidth + gap) * 3, y * rightWidth * 3, (y + 1) * rightWidth * 3);
  }
  return { rgb: out, width, height };
}

export async function writeItemDirectory(directory, { rgba, source, boundary, report }) {
  mkdirSync(directory, { recursive: true });
  const crops = {};
  if (rgba && source) {
    const { width, height, data, channels } = source;
    await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(join(directory, "foreground.png"));
    const alpha = Buffer.alloc(width * height);
    for (let p = 0; p < alpha.length; p += 1) alpha[p] = rgba[p * 4 + 3];
    await sharp(alpha, { raw: { width, height, channels: 1 } }).png().toFile(join(directory, "alpha.png"));
    const overlay = Buffer.from(data.subarray(0, width * height * channels));
    const overlayRgb = Buffer.alloc(width * height * 3);
    for (let p = 0, s = 0, o = 0; p < width * height; p += 1, s += channels, o += 3) {
      if (boundary?.[p]) {
        overlayRgb[o] = 255;
        overlayRgb[o + 1] = 214;
        overlayRgb[o + 2] = 0;
      } else {
        overlayRgb[o] = overlay[s];
        overlayRgb[o + 1] = overlay[s + 1];
        overlayRgb[o + 2] = overlay[s + 2];
      }
    }
    await writeRgbPng(join(directory, "boundary-overlay.png"), overlayRgb, width, height);
    const checkerRgb = compositeRgb(rgba, width, height, checker);
    await writeRgbPng(join(directory, "composite-checkerboard.png"), checkerRgb, width, height);
    for (const [name, color] of BACKGROUNDS) {
      await writeRgbPng(join(directory, name), compositeRgb(rgba, width, height, color), width, height);
    }
    const bbox = report.metrics?.foregroundBBox;
    if (bbox) {
      crops.hair = await writeEnlarged(join(directory, "crop-hair.png"), checkerRgb, width, height, {
        x: bbox.x + bbox.width / 2 - 120,
        y: bbox.y,
        width: 240,
        height: 200,
      });
      const leftRect = clampRect(width, height, {
        x: bbox.x,
        y: bbox.y + Math.round(bbox.height * 0.05),
        width: 180,
        height: 220,
      });
      const rightRect = clampRect(width, height, {
        x: bbox.x + bbox.width - 180,
        y: bbox.y + Math.round(bbox.height * 0.05),
        width: 180,
        height: 220,
      });
      const left = cropRgb(checkerRgb, width, leftRect);
      const right = cropRgb(checkerRgb, width, rightRect);
      const stitched = stitchHorizontal(left, leftRect.width, leftRect.height, right, rightRect.width, rightRect.height);
      await sharp(stitched.rgb, { raw: { width: stitched.width, height: stitched.height, channels: 3 } })
        .resize(stitched.width * 2, stitched.height * 2, { kernel: "nearest" })
        .png()
        .toFile(join(directory, "crop-ear-silhouette.png"));
      crops.earSilhouette = { left: leftRect, right: rightRect };
      const bottom = report.metrics.edgeContactRuns?.find((edge) => edge.edge === "bottom" && edge.longestRun > 0);
      const side = report.metrics.edgeContactRuns?.find((edge) => (edge.edge === "left" || edge.edge === "right") && edge.longestRun > 0);
      let shoulder = {
        x: bbox.x + bbox.width / 2 - 140,
        y: bbox.y + Math.max(0, bbox.height - 200),
        width: 280,
        height: 200,
      };
      if (bottom) {
        const run = bottom.runs.reduce((best, item) => (item.length > best.length ? item : best), bottom.runs[0]);
        shoulder = { x: run.start + run.length / 2 - 140, y: height - 200, width: 280, height: 200 };
      } else if (side) {
        const run = side.runs.reduce((best, item) => (item.length > best.length ? item : best), side.runs[0]);
        shoulder = {
          x: side.edge === "left" ? 0 : width - 280,
          y: run.start + run.length / 2 - 100,
          width: 280,
          height: 200,
        };
      }
      crops.shoulderContact = await writeEnlarged(join(directory, "crop-shoulder-contact.png"), checkerRgb, width, height, shoulder);
      const pocket = report.metrics.enclosedComponents?.find((item) => item.action !== "ignored");
      if (pocket) {
        crops.enclosedPocket = await writeEnlarged(join(directory, "crop-enclosed-pocket.png"), checkerRgb, width, height, {
          x: pocket.centroid.x - 90,
          y: pocket.centroid.y - 90,
          width: 180,
          height: 180,
        });
      }
      const leak = report.metrics.leakSites?.[0];
      crops.contourGap = await writeEnlarged(join(directory, "crop-contour-gap.png"), checkerRgb, width, height, leak ? {
        x: leak.centroid.x - 100,
        y: leak.centroid.y - 80,
        width: 200,
        height: 160,
        role: "leak-site",
      } : {
        x: bbox.x + bbox.width / 2 - 100,
        y: Math.max(0, bbox.y - 40),
        width: 200,
        height: 160,
        role: "silhouette-contour",
      });
      crops.contourGap.role = leak ? "leak-site" : "silhouette-contour";
      const edgeGarment = report.metrics.matteEdgeContact?.largest;
      if (edgeGarment?.centroid) {
        crops.matteEdgeContact = await writeEnlarged(join(directory, "crop-matte-edge-contact.png"), checkerRgb, width, height, {
          x: edgeGarment.centroid.x - 160,
          y: edgeGarment.centroid.y - 120,
          width: 320,
          height: 240,
        });
      }
      const worst = report.metrics.decontamination?.worst || {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + 8,
      };
      crops.worstBoundary = await writeEnlarged(join(directory, "crop-worst-boundary.png"), overlayRgb, width, height, {
        x: worst.x - 80,
        y: worst.y - 80,
        width: 160,
        height: 160,
      });
    }
  }
  return crops;
}
