import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createResearchStore } from "../research-store.mjs";
import { createRenderController } from "../render-service.mjs";
import { createServer } from "../server.mjs";

const visual = {
  ok: true,
  status: "ready",
  storyboardVersionId: "version-1",
  canUndo: true,
  frames: [{
    id: "frame-1",
    structureFrameId: "frame-1",
    layout: "single",
    frameKind: "image",
    dialogue: "",
    durationFrames: 12,
    panels: [{
      id: "panel-1",
      assetId: null,
      zoom: 1,
      positionX: 50,
      positionY: 30,
      mirrored: false,
      position: "50% 30%",
      align: "50% 30%",
    }],
  }],
};

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function send(port, { method = "GET", path: requestPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

test("global undo requires the JSON body and reports the undone action", async () => {
  let undoCalls = 0;
  const server = createServer({
    migrate: false,
    projectStore: { loadProject: async () => null },
    visualStore: {
      load: async () => visual,
      undoStoryboardEdit: async () => {
        undoCalls += 1;
        return {
          ok: true,
          undoneLabel: "удаление кадра",
          undoneTarget: { op: "deleteFrame", displayFrameNumber: 3, panelIndex: 1 },
        };
      },
    },
    researchStore: createResearchStore({ memory: true }),
  });
  const port = await listen(server);
  try {
    const missing = await send(port, { method: "POST", path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo" });
    assert.equal(missing.status, 415);
    assert.equal(undoCalls, 0);
    const restored = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.undoneLabel, "удаление кадра");
    assert.equal(restored.body.undoneTarget.displayFrameNumber, 3);
    assert.equal(undoCalls, 1);
  } finally {
    await close(server);
  }
});

test("render evidence is written once on the server for success, failure, and repeated polls", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "render-evidence-"));
  const research = createResearchStore({ memory: true });
  const controller = createRenderController({
    outputDir: directory,
    runRender: async (_spec, outputFile) => {
      await writeFile(outputFile, Buffer.from("mp4"));
    },
  });
  const server = createServer({
    migrate: false,
    projectStore: { loadProject: async () => null },
    visualStore: { load: async () => visual },
    researchStore: research,
    renderController: controller,
  });
  const port = await listen(server);
  try {
    const renderBody = JSON.stringify({ transition: "cross-dissolve" });
    const started = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/render",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(renderBody),
      },
      body: renderBody,
    });
    assert.equal(started.status, 202);
    assert.equal(started.body.transition, "cross-dissolve");
    assert.equal(started.body.overlapFrames, 6);
    for (let i = 0; i < 3; i += 1) {
      await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/render" });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    const trace = await research.listTrace({ projectId: "00000000-0000-4000-8000-000000000001" });
    const terminals = trace.events.filter((event) => event.eventKind === "action_terminal");
    const starts = trace.events.filter((event) => event.eventKind === "action_start");
    assert.equal(starts.length, 1);
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].outcome, "success");
    assert.equal(starts[0].context.transitionMode, "cross-dissolve");
    assert.equal(starts[0].context.transitionOverlapFrames, 6);
    const invalidBody = JSON.stringify({ transition: "wipe" });
    const invalid = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/render",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(invalidBody),
      },
      body: invalidBody,
    });
    assert.equal(invalid.status, 400);
    const afterInvalid = await research.listTrace({ projectId: "00000000-0000-4000-8000-000000000001" });
    assert.equal(afterInvalid.events.filter((event) => event.eventKind === "action_terminal").length, 1);
  } finally {
    await close(server);
  }
});

test("a failed render still records one terminal without a browser poll", async () => {
  const research = createResearchStore({ memory: true });
  const controller = createRenderController({
    outputDir: await mkdtemp(path.join(tmpdir(), "render-fail-evidence-")),
    runRender: async () => {
      const error = new Error("secret output");
      error.publicMessage = "Не удалось собрать видео.";
      throw error;
    },
  });
  const server = createServer({
    migrate: false,
    projectStore: { loadProject: async () => null },
    visualStore: { load: async () => visual },
    researchStore: research,
    renderController: controller,
  });
  const port = await listen(server);
  try {
    const started = await send(port, { method: "POST", path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/render" });
    assert.equal(started.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const trace = await research.listTrace({ projectId: "00000000-0000-4000-8000-000000000001" });
    const terminals = trace.events.filter((event) => event.eventKind === "action_terminal");
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].outcome, "failure");
    assert.equal(terminals[0].outcomeKind, "render-failed");
    assert.equal(JSON.stringify(trace.events).includes("secret output"), false);
  } finally {
    await close(server);
  }
});
