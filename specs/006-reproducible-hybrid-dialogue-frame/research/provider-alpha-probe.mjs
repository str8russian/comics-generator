/**
 * Bounded planning probe for hybrid foreground feasibility.
 * Temporary research script only. Does not modify production app or database.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { generateImage } from "../../../app/storyboard-web/image-provider.mjs";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";

const outDir = new URL("./provider-alpha-probe/", import.meta.url);
mkdirSync(outDir, { recursive: true });

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function analyzePng(buf) {
  const inspected = inspectImage(buf);
  const info = {
    mimeFromInspect: inspected.mime,
    width: inspected.width,
    height: inspected.height,
    byteLength: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    colorType: null,
    bitDepth: null,
    hasTrns: false,
    hasAlphaChannel: false,
    nonOpaqueAlphaSamples: 0,
    alphaSampleCount: 0,
    minAlpha: null,
    maxAlpha: null,
    edgeNonOpaqueRatio: null,
    decodeError: null,
  };
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return info;
  info.bitDepth = buf[24];
  info.colorType = buf[25];
  info.hasAlphaChannel = info.colorType === 4 || info.colorType === 6;
  let offset = 8;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "tRNS") info.hasTrns = true;
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += 12 + len;
  }
  if (info.hasAlphaChannel && idat.length) {
    try {
      const raw = inflateSync(Buffer.concat(idat));
      const width = info.width;
      const height = info.height;
      const bpp = (info.colorType === 6 ? 4 : 2) * (info.bitDepth / 8);
      const stride = width * bpp;
      let pos = 0;
      let prev = Buffer.alloc(stride);
      const alphas = [];
      let edgeNonOpaque = 0;
      let edgeCount = 0;
      for (let y = 0; y < height; y += 1) {
        if (pos + 1 + stride > raw.length) break;
        const filter = raw[pos];
        pos += 1;
        let row = Buffer.from(raw.subarray(pos, pos + stride));
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
          const paeth = (a, b, c) => {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            if (pa <= pb && pa <= pc) return a;
            if (pb <= pc) return b;
            return c;
          };
          for (let i = 0; i < stride; i += 1) {
            const left = i >= bpp ? row[i - bpp] : 0;
            const up = prev[i];
            const upleft = i >= bpp ? prev[i - bpp] : 0;
            row[i] = (row[i] + paeth(left, up, upleft)) & 255;
          }
        }
        for (let x = 0; x < width; x += 4) {
          const a = row[x * bpp + (bpp - 1)];
          alphas.push(a);
          if (x < 8 || x >= width - 8 || y < 8 || y >= height - 8) {
            edgeCount += 1;
            if (a < 250) edgeNonOpaque += 1;
          }
        }
        prev = row;
      }
      info.alphaSampleCount = alphas.length;
      info.minAlpha = Math.min(...alphas);
      info.maxAlpha = Math.max(...alphas);
      info.nonOpaqueAlphaSamples = alphas.filter((a) => a < 255).length;
      info.edgeNonOpaqueRatio = edgeCount ? edgeNonOpaque / edgeCount : null;
    } catch (error) {
      info.decodeError = String(error.message || error);
    }
  }
  return info;
}

function decodeRgbPng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not png");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported png ct=${colorType}`);
  }
  let offset = 8;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(buf.subarray(offset + 8, offset + 8 + len));
    if (type === "IEND") break;
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  let pos = 0;
  let prev = Buffer.alloc(stride);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    let row = Buffer.from(raw.subarray(pos, pos + stride));
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
      const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc) return a;
        if (pb <= pc) return b;
        return c;
      };
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev[i];
        const upleft = i >= bpp ? prev[i - bpp] : 0;
        row[i] = (row[i] + paeth(left, up, upleft)) & 255;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      out[di] = row[si];
      out[di + 1] = row[si + 1];
      out[di + 2] = row[si + 2];
      out[di + 3] = colorType === 6 ? row[si + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba: out };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const compressed = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chromaKeyGreen(rgbaImg, { maxGreenDominance = 40, minGreen = 140 } = {}) {
  const { width, height, rgba } = rgbaImg;
  const out = Buffer.from(rgba);
  let removed = 0;
  let kept = 0;
  let edgeRemoved = 0;
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const p = i / 4;
    const x = p % width;
    const y = (p / width) | 0;
    const isEdge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
    const greenDom = g - Math.max(r, b);
    const keyed = g >= minGreen && greenDom >= maxGreenDominance && g > r + 20 && g > b + 20;
    if (keyed) {
      out[i + 3] = 0;
      removed += 1;
      if (isEdge) edgeRemoved += 1;
    } else {
      kept += 1;
    }
  }
  return {
    rgba: out,
    stats: {
      removed,
      kept,
      removedRatio: removed / (removed + kept),
      edgeRemoved,
      opaqueKeptRatio: kept / (removed + kept),
    },
  };
}

function loadHexTsv(path) {
  const line = readFileSync(path, "utf8").trim();
  if (!line) return null;
  const [hex, mime, width, height, id] = line.split("\t");
  return {
    bytes: Buffer.from(hex, "hex"),
    mime,
    width: Number(width),
    height: Number(height),
    id: id || null,
  };
}

function fileUrl(...parts) {
  return new URL(parts.join("/"), outDir);
}

const evidence = {
  startedAt: new Date().toISOString(),
  requestCount: 0,
  requests: [],
};

{
  const prompt = [
    "Create one chest-up illustrated portrait of a generic adult man in a dark suit for comic compositing.",
    "Style: clearly illustrated, heavy near-black contour, large tonal groups, simplified graphic shapes, no photorealism.",
    "The subject must be the only person. No other people, silhouettes, reflections, text, logos, watermarks, speech bubbles, panel borders, gutters, or comic layout.",
    "IMPORTANT: Output a PNG with a genuinely transparent alpha background around the person. Do not paint a checkerboard. Do not fill the background with white, black, gray, or any solid color. Transparent pixels only outside the person.",
    "Near-frontal head, subtle gaze to screen-right, safe margins around the head and shoulders.",
  ].join("\n");
  const started = Date.now();
  const result = await generateImage({ prompt, images: [], aspectRatio: "4:5" });
  evidence.requestCount += 1;
  const entry = {
    id: "R1-transparent-request",
    ok: Boolean(result.ok),
    kind: result.kind || null,
    latencyMs: Date.now() - started,
    providerLatencyMs: result.metadata?.latencyMs ?? result.diagnostics?.latencyMs ?? null,
    model: result.metadata?.model || null,
  };
  if (result.ok) {
    const file = fileUrl("R1-transparent-request.png");
    writeFileSync(file, result.image.bytes);
    entry.output = { path: file.pathname, ...analyzePng(result.image.bytes) };
  } else {
    entry.failure = { kind: result.kind, httpStatus: result.httpStatus };
  }
  evidence.requests.push(entry);
  console.log("R1", JSON.stringify(entry, null, 2));
}

{
  const identity = loadHexTsv("/tmp/anchor-ref.tsv");
  const style = loadHexTsv("/tmp/style-ref.tsv");
  const images = [];
  if (identity) images.push({ mime: identity.mime, bytes: identity.bytes });
  if (
    style
    && (!identity || style.bytes.toString("hex") !== identity.bytes.toString("hex"))
    && images.length < 3
  ) {
    images.push({ mime: style.mime, bytes: style.bytes });
  }
  const prompt = [
    "Create one chest-up illustrated portrait of the person in Image 1 for comic compositing.",
    "Image 1 is the approved identity anchor and controls who the person is.",
    images.length > 1
      ? "Image 2 is the project style anchor and controls rendering language only; never copy that person's identity."
      : "Use a clearly illustrated comic style with heavy near-black contour and large tonal groups.",
    "Exactly one visible person. No other people, silhouettes, reflections, text, logos, watermarks, speech bubbles, panel borders, gutters, or comic layout.",
    "Fill the entire background with a flat pure chroma-key green exactly #00FF00. No gradients, no room, no furniture, no props, no shadows on the background.",
    "Near-frontal head, subtle gaze toward screen-right, mouth visible, safe margins around head and shoulders for later placement.",
    "Do not render any final comic split layout.",
  ].join("\n");
  const started = Date.now();
  const result = await generateImage({ prompt, images, aspectRatio: "4:5" });
  evidence.requestCount += 1;
  const entry = {
    id: "R2-chromakey-green",
    ok: Boolean(result.ok),
    kind: result.kind || null,
    latencyMs: Date.now() - started,
    providerLatencyMs: result.metadata?.latencyMs ?? result.diagnostics?.latencyMs ?? null,
    model: result.metadata?.model || null,
    referenceCount: images.length,
  };
  if (result.ok) {
    const rawPath = fileUrl("R2-chromakey-raw.png");
    writeFileSync(rawPath, result.image.bytes);
    entry.raw = { path: rawPath.pathname, ...analyzePng(result.image.bytes) };
    try {
      const decoded = decodeRgbPng(result.image.bytes);
      let greenish = 0;
      for (let i = 0; i < decoded.rgba.length; i += 4) {
        const r = decoded.rgba[i];
        const g = decoded.rgba[i + 1];
        const b = decoded.rgba[i + 2];
        if (g >= 140 && g - Math.max(r, b) >= 40) greenish += 1;
      }
      const keyed = chromaKeyGreen(decoded);
      const cutout = encodeRgbaPng(decoded.width, decoded.height, keyed.rgba);
      const cutPath = fileUrl("R2-chromakey-cutout.png");
      writeFileSync(cutPath, cutout);
      entry.greenishPixelRatio = greenish / (decoded.width * decoded.height);
      entry.cutout = { path: cutPath.pathname, ...analyzePng(cutout), keyStats: keyed.stats };
    } catch (error) {
      entry.mattingError = String(error.message || error);
    }
  } else {
    entry.failure = { kind: result.kind, httpStatus: result.httpStatus };
  }
  evidence.requests.push(entry);
  console.log("R2", JSON.stringify(entry, null, 2));
}

evidence.finishedAt = new Date().toISOString();
writeFileSync(fileUrl("evidence.json"), JSON.stringify(evidence, null, 2));
console.log("TOTAL_REQUESTS", evidence.requestCount);
