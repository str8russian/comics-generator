import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { compileVideoSpec } from "../../../app/storyboard-web/video-spec.mjs";

const remotionRoot = path.resolve(import.meta.dirname, "..");
const red = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const blue = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function visual(durationFrames) {
  return {
    status: "ready",
    frames: [
      {
        id: "red",
        frameKind: "image",
        dialogue: "",
        durationFrames,
        layout: "single",
        panels: [{ id: "p-red", asset: red, zoom: 1, positionX: 50, positionY: 30, mirrored: false, position: "50% 30%", align: "50% 30%" }],
      },
      {
        id: "blue",
        frameKind: "image",
        dialogue: "",
        durationFrames,
        layout: "single",
        panels: [{ id: "p-blue", asset: blue, zoom: 1, positionX: 50, positionY: 30, mirrored: false, position: "50% 30%", align: "50% 30%" }],
      },
    ],
  };
}

function paeth(a, b, c) {
  const estimate = a + b - c;
  const da = Math.abs(estimate - a);
  const db = Math.abs(estimate - b);
  const dc = Math.abs(estimate - c);
  if (da <= db && da <= dc) return a;
  if (db <= dc) return b;
  return c;
}

function samplePng(bytes) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let previous = Buffer.alloc(stride);
  const rows = [];
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) row[i] = (row[i] + left) & 255;
      else if (filter === 2) row[i] = (row[i] + up) & 255;
      else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
    }
    previous = row;
    rows.push(row);
  }
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 3);
  const index = x * channels;
  return [rows[y][index], rows[y][index + 1], rows[y][index + 2]];
}

test("hard cut and cross dissolve stills use the compiled timeline", { timeout: 180000 }, async () => {
  const bundler = await import(pathToFileURL(path.join(remotionRoot, "node_modules/@remotion/bundler/dist/index.js")).href);
  const renderer = await import(pathToFileURL(path.join(remotionRoot, "node_modules/@remotion/renderer/dist/index.js")).href);
  const directory = await mkdtemp(path.join(tmpdir(), "transition-still-"));
  const serveUrl = await bundler.bundle({
    entryPoint: path.join(remotionRoot, "src/index.jsx"),
    webpackOverride: (config) => config,
  });
  try {
    const hard = compileVideoSpec(visual(8)).spec;
    const dissolve = compileVideoSpec(visual(8), { transition: "cross-dissolve" }).spec;
    assert.equal(hard.project.totalDurationFrames, 16);
    assert.equal(dissolve.project.totalDurationFrames, 10);
    assert.equal(dissolve.frames[1].startFrame, 2);
    const hardFile = path.join(directory, "hard.png");
    const dissolveFile = path.join(directory, "dissolve.png");
    for (const [spec, frame, file] of [
      [hard, 8, hardFile],
      [dissolve, 4, dissolveFile],
    ]) {
      const composition = await renderer.selectComposition({
        serveUrl,
        id: "CurrentStoryboard",
        inputProps: { spec },
      });
      await renderer.renderStill({
        composition,
        serveUrl,
        output: file,
        frame,
        inputProps: { spec },
      });
    }
    const hardPixel = samplePng(await readFile(hardFile));
    const dissolvePixel = samplePng(await readFile(dissolveFile));
    assert.ok(hardPixel[2] > hardPixel[0] + 40, `hard cut should be the second color, got ${hardPixel}`);
    assert.ok(Math.abs(dissolvePixel[0] - dissolvePixel[2]) < 80, `dissolve should blend, got ${dissolvePixel}`);
    assert.notDeepEqual(hardPixel, dissolvePixel);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
