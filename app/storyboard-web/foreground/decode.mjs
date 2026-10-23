import sharp from "sharp";

export async function decodeImage(buffer) {
  const image = sharp(buffer, { failOn: "error" });
  const meta = await image.metadata();
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    data,
    space: meta.space || null,
    format: meta.format || null,
    hasAlpha: Boolean(meta.hasAlpha),
  };
}
