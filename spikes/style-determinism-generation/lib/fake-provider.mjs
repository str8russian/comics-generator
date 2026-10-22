import sharp from "sharp";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";

export function createFakeImageGenerator() {
  let sequence = 0;
  return async function fakeGenerateImage() {
    sequence += 1;
    const bytes = await sharp({
      create: {
        width: 200,
        height: 250,
        channels: 3,
        background: { r: 20 + sequence * 12, g: 84, b: 112 },
      },
    }).png().toBuffer();
    const info = inspectImage(bytes);
    return {
      ok: true,
      image: { bytes, ...info },
      metadata: { providerStatus: 200, latencyMs: 1, model: "fake-local" },
    };
  };
}
