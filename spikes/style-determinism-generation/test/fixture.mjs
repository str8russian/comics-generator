import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { sha256 } from "../lib/evidence.mjs";

export async function writeImageFixture(directory) {
  await mkdir(directory, { recursive: true });
  const sourceA = await solid("source-a.jpg", directory, 12, 12, { r: 20, g: 30, b: 40 }, "jpeg");
  const sourceB = await solid("source-b.jpg", directory, 10, 10, { r: 50, g: 60, b: 70 }, "jpeg");
  const style = await solid("style.png", directory, 14, 16, { r: 80, g: 90, b: 100 }, "png");
  const inputs = {
    "source-a": record("source-a", "identity", sourceA),
    "source-b": record("source-b", "identity", sourceB),
    "style-reference": record("style-reference", "style", style),
  };
  const template = {
    version: 1,
    samePerson: true,
    inputs: Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, {
      logicalId: id,
      role: input.role,
      sha256: input.sha256,
      mime: input.mime,
      width: input.width,
      height: input.height,
    }])),
  };
  const runtime = {
    version: 1,
    inputs: Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, { path: input.path }])),
  };
  const templatePath = join(directory, "template.json");
  const runtimePath = join(directory, "runtime.json");
  await writeFile(templatePath, JSON.stringify(template));
  await writeFile(runtimePath, JSON.stringify(runtime));
  return { directory, templatePath, runtimePath, inputs };
}

function record(logicalId, role, image) {
  return { logicalId, role, ...image };
}

async function solid(name, directory, width, height, background, format) {
  const pipeline = sharp({ create: { width, height, channels: 3, background } });
  const bytes = format === "jpeg" ? await pipeline.jpeg().toBuffer() : await pipeline.png().toBuffer();
  const info = inspectImage(bytes);
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { path, bytes, mime: info.mime, width: info.width, height: info.height, sha256: sha256(bytes) };
}
