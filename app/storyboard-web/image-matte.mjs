import { deflateSync, inflateSync } from "node:zlib";
import { inspectPngAlpha } from "./image-info.mjs";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const CHROMA_KEY = { r: 0, g: 255, b: 0 };
export const MATTE_THRESHOLDS = Object.freeze({
  minGreen: 140,
  minGreenDominance: 40,
  greenOverChannel: 20,
  maxOpaqueGreenSpill: 0,
  maxEdgeFringeRatio: 0.02,
  minTransparentRatio: 0.02,
  minOpaqueSubjectRatio: 0.05,
  edgeBand: 2,
  spillDesatStrength: 0.65,
});

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function encodeRgbPng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePngRgba(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!buffer.subarray(0, 8).equals(PNG_SIG)) throw new Error("not-png");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported-png-ct:${colorType}`);
  }
  const idat = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  let pos = 0;
  let prev = Buffer.alloc(stride);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    if (filter === 1) {
      for (let i = 0; i < stride; i += 1) row[i] = (row[i] + (i >= bpp ? row[i - bpp] : 0)) & 255;
    } else if (filter === 2) {
      for (let i = 0; i < stride; i += 1) row[i] = (row[i] + prev[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? row[i - bpp] : 0;
        row[i] = (row[i] + Math.floor((left + prev[i]) / 2)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev[i];
        const upLeft = i >= bpp ? prev[i - bpp] : 0;
        row[i] = (row[i] + paethPredictor(left, up, upLeft)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported-filter:${filter}`);
    }
    for (let x = 0; x < width; x += 1) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      rgba[di] = row[si];
      rgba[di + 1] = row[si + 1];
      rgba[di + 2] = row[si + 2];
      rgba[di + 3] = colorType === 6 ? row[si + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba, colorType };
}

function isKeyedGreen(r, g, b, thresholds) {
  const greenDom = g - Math.max(r, b);
  return g >= thresholds.minGreen
    && greenDom >= thresholds.minGreenDominance
    && g > r + thresholds.greenOverChannel
    && g > b + thresholds.greenOverChannel;
}

function despillPixel(r, g, b, strength) {
  const maxRB = Math.max(r, b);
  if (g <= maxRB) return [r, g, b];
  const nextG = Math.round(g - (g - maxRB) * strength);
  return [r, Math.max(0, Math.min(255, nextG)), b];
}

function edgeCleanup(rgba, width, height, thresholds) {
  const out = Buffer.from(rgba);
  const band = thresholds.edgeBand;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (out[i + 3] === 0) continue;
      let transparentNeighbor = false;
      for (let dy = -band; dy <= band && !transparentNeighbor; dy += 1) {
        for (let dx = -band; dx <= band; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (out[(ny * width + nx) * 4 + 3] === 0) {
            transparentNeighbor = true;
            break;
          }
        }
      }
      if (!transparentNeighbor) continue;
      const [r, g, b] = despillPixel(out[i], out[i + 1], out[i + 2], thresholds.spillDesatStrength);
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      if (isKeyedGreen(r, g, b, thresholds)) out[i + 3] = 0;
    }
  }
  return out;
}

export function measureMatteAcceptance(rgba, width, height, thresholds = MATTE_THRESHOLDS) {
  const total = width * height;
  let transparent = 0;
  let opaque = 0;
  let opaqueGreenSpill = 0;
  let edgeOpaque = 0;
  let edgeGreenFringe = 0;
  const band = thresholds.edgeBand;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      if (a === 0) {
        transparent += 1;
        continue;
      }
      opaque += 1;
      if (isKeyedGreen(r, g, b, thresholds)) opaqueGreenSpill += 1;
      const onEdge = x < band || y < band || x >= width - band || y >= height - band
        || (() => {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (rgba[(ny * width + nx) * 4 + 3] === 0) return true;
            }
          }
          return false;
        })();
      if (onEdge) {
        edgeOpaque += 1;
        if (g - Math.max(r, b) >= thresholds.minGreenDominance / 2 && g > r && g > b) {
          edgeGreenFringe += 1;
        }
      }
    }
  }
  const transparentRatio = transparent / total;
  const opaqueSubjectRatio = opaque / total;
  const edgeFringeRatio = edgeOpaque === 0 ? 0 : edgeGreenFringe / edgeOpaque;
  const reasons = [];
  if (transparent === 0 || transparentRatio < thresholds.minTransparentRatio) {
    reasons.push("fully-opaque-or-insufficient-transparency");
  }
  if (opaqueSubjectRatio < thresholds.minOpaqueSubjectRatio) {
    reasons.push("subject-erased");
  }
  if (opaqueGreenSpill > thresholds.maxOpaqueGreenSpill) {
    reasons.push("green-spill");
  }
  if (edgeFringeRatio > thresholds.maxEdgeFringeRatio) {
    reasons.push("edge-fringe");
  }
  return {
    transparent,
    opaque,
    opaqueGreenSpill,
    edgeOpaque,
    edgeGreenFringe,
    transparentRatio,
    opaqueSubjectRatio,
    edgeFringeRatio,
    accepted: reasons.length === 0,
    reasons,
  };
}

function looksLikeCheckerboard(rgba, width, height) {
  if (width < 4 || height < 4) return false;
  let transitions = 0;
  let samples = 0;
  for (let y = 0; y < Math.min(height, 32); y += 1) {
    for (let x = 0; x < Math.min(width, 32); x += 1) {
      const i = (y * width + x) * 4;
      const nextX = ((x + 1) % Math.min(width, 32));
      const j = (y * width + nextX) * 4;
      const lumA = rgba[i] + rgba[i + 1] + rgba[i + 2];
      const lumB = rgba[j] + rgba[j + 1] + rgba[j + 2];
      if (Math.abs(lumA - lumB) > 120) transitions += 1;
      samples += 1;
    }
  }
  return samples > 0 && transitions / samples > 0.35;
}

function greenBackingRatio(rgba, width, height, thresholds) {
  let green = 0;
  const total = width * height;
  for (let i = 0; i < rgba.length; i += 4) {
    if (isKeyedGreen(rgba[i], rgba[i + 1], rgba[i + 2], thresholds)) green += 1;
  }
  return green / total;
}

/**
 * Deterministic #00FF00 chromakey extraction with bounded spill/edge cleanup.
 * Fail-closed: returns kind `matte-failed` when acceptance thresholds are not met.
 */
export function extractChromakeyMatte(rawPngBytes, options = {}) {
  const thresholds = { ...MATTE_THRESHOLDS, ...(options.thresholds || {}) };
  let decoded;
  try {
    decoded = decodePngRgba(rawPngBytes);
  } catch (error) {
    return {
      ok: false,
      kind: "matte-failed",
      reasons: ["invalid-png", String(error.message || error)],
      rawBytes: Buffer.isBuffer(rawPngBytes) ? rawPngBytes : Buffer.from(rawPngBytes),
    };
  }
  const { width, height, rgba } = decoded;
  if (looksLikeCheckerboard(rgba, width, height)) {
    return {
      ok: false,
      kind: "matte-failed",
      reasons: ["checkerboard-or-fake-alpha"],
      rawBytes: Buffer.from(rawPngBytes),
      width,
      height,
    };
  }
  if (greenBackingRatio(rgba, width, height, thresholds) < thresholds.minTransparentRatio) {
    return {
      ok: false,
      kind: "matte-failed",
      reasons: ["non-green-backing"],
      rawBytes: Buffer.from(rawPngBytes),
      width,
      height,
    };
  }

  const keyed = Buffer.from(rgba);
  let removed = 0;
  for (let i = 0; i < keyed.length; i += 4) {
    if (isKeyedGreen(keyed[i], keyed[i + 1], keyed[i + 2], thresholds)) {
      keyed[i + 3] = 0;
      removed += 1;
    }
  }
  const cleaned = edgeCleanup(keyed, width, height, thresholds);
  const acceptance = measureMatteAcceptance(cleaned, width, height, thresholds);
  const rgbaPng = encodeRgbaPng(width, height, cleaned);
  const alphaInfo = inspectPngAlpha(rgbaPng);
  if (!acceptance.accepted || !alphaInfo.hasAlphaChannel || alphaInfo.transparentSampleCount === 0) {
    return {
      ok: false,
      kind: "matte-failed",
      reasons: acceptance.reasons.length ? acceptance.reasons : ["alpha-inspection-failed"],
      acceptance,
      alphaInfo,
      rawBytes: Buffer.from(rawPngBytes),
      rgbaBytes: rgbaPng,
      width,
      height,
      removed,
    };
  }
  return {
    ok: true,
    kind: null,
    rawBytes: Buffer.from(rawPngBytes),
    rgbaBytes: rgbaPng,
    rgba: cleaned,
    width,
    height,
    removed,
    acceptance,
    alphaInfo,
  };
}
