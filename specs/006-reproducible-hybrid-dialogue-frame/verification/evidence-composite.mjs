/**
 * Deterministic evidence compositing helpers for hybrid verification.
 * Production renderer remains separate; these helpers only build review artifacts.
 */

/** Source-over alpha onto pixels already present in the destination. */
export function blitSourceOver(dest, destW, destH, src, srcW, srcH, ox, oy) {
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= destW || dy >= destH) continue;
      const di = (dy * destW + dx) * 4;
      const si = (y * srcW + x) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0) continue;
      if (a >= 1) {
        dest[di] = src[si];
        dest[di + 1] = src[si + 1];
        dest[di + 2] = src[si + 2];
        dest[di + 3] = 255;
        continue;
      }
      const inv = 1 - a;
      dest[di] = Math.round(src[si] * a + dest[di] * inv);
      dest[di + 1] = Math.round(src[si + 1] * a + dest[di + 1] * inv);
      dest[di + 2] = Math.round(src[si + 2] * a + dest[di + 2] * inv);
      dest[di + 3] = 255;
    }
  }
}

/**
 * Composite against a fixed RGB(A) fill (intentional matte / preview checks only).
 * Transparent source pixels become the fill color — never use this for hybrid assembly.
 */
export function blitAgainstFill(dest, destW, destH, src, srcW, srcH, ox, oy, fill = [32, 32, 36, 255]) {
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= destW || dy >= destH) continue;
      const di = (dy * destW + dx) * 4;
      const si = (y * srcW + x) * 4;
      const a = src[si + 3] / 255;
      dest[di] = Math.round(src[si] * a + fill[0] * (1 - a));
      dest[di + 1] = Math.round(src[si + 1] * a + fill[1] * (1 - a));
      dest[di + 2] = Math.round(src[si + 2] * a + fill[2] * (1 - a));
      dest[di + 3] = 255;
    }
  }
}

export function downscaleRgba(rgba, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / tw));
      const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / th));
      const si = (sy * width + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: tw, height: th };
}

/**
 * Side-by-side hybrid representative: shared background under two transparent cutouts.
 */
export function assembleRepresentativeHybridFrame({
  background,
  panel0,
  panel1,
  minWidth = 1200,
  minHeight = 540,
} = {}) {
  if (!background?.rgba || !panel0?.rgba || !panel1?.rgba) {
    throw new Error("assembleRepresentativeHybridFrame requires background and both panels");
  }
  const assembledW = Math.max(background.width, minWidth);
  const assembledH = Math.max(background.height, minHeight);
  const assembled = Buffer.alloc(assembledW * assembledH * 4, 0);
  // Neutral dark underfill only where the background does not cover; characters must not use it.
  for (let i = 0; i < assembled.length; i += 4) {
    assembled[i] = 20;
    assembled[i + 1] = 20;
    assembled[i + 2] = 24;
    assembled[i + 3] = 255;
  }
  const scaledBg = downscaleRgba(
    background.rgba,
    background.width,
    background.height,
    Math.max(assembledW, assembledH),
  );
  blitSourceOver(assembled, assembledW, assembledH, scaledBg.rgba, scaledBg.width, scaledBg.height, 0, 0);

  const half = Math.floor(assembledW / 2);
  const left = downscaleRgba(panel0.rgba, panel0.width, panel0.height, Math.min(half - 24, assembledH - 24));
  const right = downscaleRgba(panel1.rgba, panel1.width, panel1.height, Math.min(half - 24, assembledH - 24));
  const leftX = Math.floor((half - left.width) / 2);
  const rightX = half + Math.floor((half - right.width) / 2);
  const leftY = Math.floor((assembledH - left.height) / 2);
  const rightY = Math.floor((assembledH - right.height) / 2);
  blitSourceOver(assembled, assembledW, assembledH, left.rgba, left.width, left.height, leftX, leftY);
  blitSourceOver(assembled, assembledW, assembledH, right.rgba, right.width, right.height, rightX, rightY);

  return {
    rgba: assembled,
    width: assembledW,
    height: assembledH,
    placements: {
      left: { x: leftX, y: leftY, width: left.width, height: left.height },
      right: { x: rightX, y: rightY, width: right.width, height: right.height },
    },
  };
}

/**
 * Heuristic: opaque rectangular backplates leave large near-black blocks where cutout alpha is 0.
 * Returns true when a sampled transparent cutout region is dominated by near-black fill instead of background.
 */
export function hasOpaqueRectangularBackplate({
  assembled,
  cutout,
  placement,
  backgroundSampleRgb,
  nearBlackMax = 40,
  dominance = 0.55,
} = {}) {
  const { rgba: dest, width: destW, height: destH } = assembled;
  const { rgba: src, width: srcW, height: srcH } = cutout;
  const { x: ox, y: oy } = placement;
  let transparentSamples = 0;
  let nearBlackSamples = 0;
  let backgroundLikeSamples = 0;
  const step = Math.max(1, Math.floor(Math.min(srcW, srcH) / 64));
  for (let y = 0; y < srcH; y += step) {
    for (let x = 0; x < srcW; x += step) {
      const si = (y * srcW + x) * 4;
      if (src[si + 3] > 8) continue;
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= destW || dy >= destH) continue;
      const di = (dy * destW + dx) * 4;
      transparentSamples += 1;
      const r = dest[di];
      const g = dest[di + 1];
      const b = dest[di + 2];
      if (r <= nearBlackMax && g <= nearBlackMax && b <= nearBlackMax) {
        nearBlackSamples += 1;
      }
      if (backgroundSampleRgb) {
        const dr = Math.abs(r - backgroundSampleRgb[0]);
        const dg = Math.abs(g - backgroundSampleRgb[1]);
        const db = Math.abs(b - backgroundSampleRgb[2]);
        if (dr + dg + db < 90) backgroundLikeSamples += 1;
      }
    }
  }
  if (transparentSamples < 20) return false;
  const nearBlackRatio = nearBlackSamples / transparentSamples;
  if (backgroundSampleRgb) {
    const bgRatio = backgroundLikeSamples / transparentSamples;
    return nearBlackRatio >= dominance && bgRatio < 0.25;
  }
  return nearBlackRatio >= dominance;
}
