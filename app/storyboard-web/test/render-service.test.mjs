import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRenderController, isSafeResultPath, safeRenderMessage } from "../render-service.mjs";

const spec = {
  schemaVersion: "storyboard-video-spec-1",
  project: { totalDurationFrames: 36 },
  frames: [],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("only one render runs, and success exposes only the known output file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "render-"));
  const gate = deferred();
  const controller = createRenderController({
    outputDir: directory,
    runRender: async (_spec, outputFile) => {
      await gate.promise;
      await writeFile(outputFile, Buffer.from("mp4"));
    },
  });
  const started = controller.start(spec);
  assert.equal(started.status, "running");
  assert.equal(controller.start(spec).kind, "render-busy");
  assert.equal(controller.status().status, "running");
  assert.equal(controller.resultFile(), null);
  gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(controller.status().status, "success");
  assert.equal(controller.resultFile(), path.join(directory, "current.mp4"));
  assert.equal(isSafeResultPath(directory, path.join(directory, "..", "current.mp4")), false);
});

test("failure keeps a short safe reason and does not publish a file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "render-fail-"));
  const controller = createRenderController({
    outputDir: directory,
    runRender: async () => {
      const error = new Error("postgres://comics:secret@db/comics");
      error.publicMessage = "postgres://comics:secret@db/comics";
      throw error;
    },
  });
  controller.start(spec);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const status = controller.status();
  assert.equal(status.status, "failure");
  assert.equal(status.message, "Не удалось собрать видео.");
  assert.equal(controller.resultFile(), null);
  assert.equal(safeRenderMessage({ publicMessage: "Композиция не собралась." }), "Композиция не собралась.");
});
