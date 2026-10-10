import { createHash } from "node:crypto";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const IDENTITY_MAX_BYTES = 12 * 1024 * 1024;
export const IDENTITY_MAX_BODY_BYTES = Math.ceil(IDENTITY_MAX_BYTES * 4 / 3) + 8192;

const HEIC_BRANDS = new Set(["heic", "heif", "heix", "heim", "heis", "mif1", "msf1"]);
const DECLARED_MIME = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
};
const UNSUPPORTED_DECLARED = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function png(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { mime: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) break;
    const size = buffer.readUInt16BE(offset + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof && offset + 9 <= buffer.length) {
      return { mime: "image/jpeg", height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (size < 2) break;
    offset += 2 + size;
  }
  return { mime: "image/jpeg", width: null, height: null };
}

function webp(buffer) {
  if (buffer.length < 16) return null;
  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      mime: "image/webp",
      width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
      height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return { mime: "image/webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { mime: "image/webp", width: null, height: null };
}

export function isHeicLike(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
  if (HEIC_BRANDS.has(brand)) return true;
  for (let offset = 16; offset + 4 <= Math.min(buffer.length, 64); offset += 4) {
    if (HEIC_BRANDS.has(buffer.subarray(offset, offset + 4).toString("ascii").toLowerCase())) return true;
  }
  return false;
}

export function inspectImage(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const info = png(buffer) || jpeg(buffer) || webp(buffer);
  if (!info) return { mime: null, width: null, height: null, byteLength: buffer.length, sha256: null };
  return {
    ...info,
    byteLength: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

function failedImage(kind) {
  return { ok: false, kind };
}

export function parseIdentityImage(value, maxBytes = IDENTITY_MAX_BYTES) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value ?? ""));
  if (!match) return failedImage("invalid-image");
  const declared = match[1].toLowerCase();
  if (UNSUPPORTED_DECLARED.has(declared)) return failedImage("unsupported-image-format");
  const expectedMime = DECLARED_MIME[declared];
  if (!expectedMime) return failedImage("unsupported-image-format");
  const encoded = match[2].replace(/\s/g, "");
  if (encoded.length > Math.ceil(maxBytes * 4 / 3) + 8) return failedImage("image-too-large");
  let buffer;
  try {
    buffer = Buffer.from(encoded, "base64");
  } catch {
    return failedImage("invalid-image");
  }
  if (!buffer.length) return failedImage("invalid-image");
  if (buffer.length > maxBytes) return failedImage("image-too-large");
  if (isHeicLike(buffer)) return failedImage("unsupported-image-format");
  const info = inspectImage(buffer);
  if (!info.mime || info.mime !== expectedMime) return failedImage("invalid-image");
  return {
    ok: true,
    bytes: buffer,
    buffer,
    mime: info.mime,
    width: info.width,
    height: info.height,
    byteLength: info.byteLength,
    sha256: info.sha256,
  };
}

export function parseImageDataUrl(value, maxBytes = IDENTITY_MAX_BYTES) {
  const parsed = parseIdentityImage(value, maxBytes);
  if (!parsed.ok) return null;
  return parsed;
}

export function extensionForMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}
