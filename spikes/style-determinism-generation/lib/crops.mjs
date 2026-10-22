import sharp from "sharp";

export const FACE_CROP_RATIOS = Object.freeze({
  left: 0.18,
  top: 0.05,
  width: 0.64,
  height: 0.46,
});

export function matchedFaceCropRect(width, height) {
  const safeWidth = Number(width) || 0;
  const safeHeight = Number(height) || 0;
  if (safeWidth < 2 || safeHeight < 2) return null;
  const left = Math.max(0, Math.round(safeWidth * FACE_CROP_RATIOS.left));
  const top = Math.max(0, Math.round(safeHeight * FACE_CROP_RATIOS.top));
  let cropWidth = Math.round(safeWidth * FACE_CROP_RATIOS.width);
  let cropHeight = Math.round(safeHeight * FACE_CROP_RATIOS.height);
  if (left + cropWidth > safeWidth) cropWidth = safeWidth - left;
  if (top + cropHeight > safeHeight) cropHeight = safeHeight - top;
  if (cropWidth < 1 || cropHeight < 1) return null;
  return { left, top, width: cropWidth, height: cropHeight };
}

export async function renderMatchedFaceCrop(bytes, width, height) {
  const rect = matchedFaceCropRect(width, height);
  if (!rect) return null;
  const source = Buffer.from(bytes);
  const cropped = await sharp(source, { failOn: "none" }).extract(rect).png().toBuffer();
  return { bytes: cropped, rect };
}
