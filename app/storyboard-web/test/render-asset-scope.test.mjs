import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { requireProjectId } from "../project-scope.mjs";
import { createRenderController } from "../render-service.mjs";
import { createServer } from "../server.mjs";

const projectP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectQ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const assetP = "11111111-1111-4111-8111-111111111111";
const bytesP = Buffer.from("project-p-png-bytes");

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
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function visualFor(projectId) {
  if (projectId === projectP) {
    return {
      ok: true,
      status: "ready",
      storyboardVersionId: "version-p",
      frames: [{
        id: "frame-image",
        structureFrameId: "frame-image",
        layout: "split2",
        frameKind: "image",
        dialogue: "",
        durationFrames: 36,
        panels: [
          {
            id: "owned",
            assetId: assetP,
            zoom: 1.2,
            positionX: 40,
            positionY: 20,
            mirrored: true,
            position: "40% 20%",
            align: "40% 20%",
          },
          {
            id: "empty",
            assetId: null,
            zoom: 1,
            positionX: 50,
            positionY: 30,
            mirrored: false,
            position: "50% 30%",
            align: "50% 30%",
          },
        ],
      }, {
        id: "card",
        structureFrameId: "card",
        frameKind: "text",
        textCard: "Пауза",
        dialogue: "",
        durationFrames: 48,
        layout: "single",
        panels: [],
      }],
    };
  }
  return {
    ok: true,
    status: "ready",
    storyboardVersionId: "version-q",
    frames: [{
      id: "frame-foreign",
      structureFrameId: "frame-foreign",
      layout: "single",
      frameKind: "image",
      dialogue: "",
      durationFrames: 36,
      panels: [{
        id: "foreign",
        assetId: assetP,
        zoom: 1,
        positionX: 50,
        positionY: 30,
        mirrored: false,
        position: "50% 30%",
        align: "50% 30%",
      }],
    }],
  };
}

function assetUrls(spec) {
  return spec.frames.flatMap((frame) => frame.panels.map((panel) => panel.asset).filter((asset) => typeof asset === "string"));
}

test("a project render compiles and serves only that project's asset URLs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "render-asset-scope-"));
  const captures = [];
  const controller = createRenderController({
    outputDir: directory,
    runRender: async (spec, outputFile) => {
      const loaded = [];
      for (const asset of assetUrls(spec)) {
        const response = await fetch(asset);
        loaded.push({
          asset,
          status: response.status,
          body: Buffer.from(await response.arrayBuffer()),
        });
      }
      captures.push({ spec, loaded });
      await writeFile(outputFile, Buffer.from(spec.frames[0].id));
    },
  });
  const server = createServer({
    migrate: false,
    projectStore: { loadProject: async () => null },
    visualStore: {
      load: async () => visualFor(requireProjectId()),
      readAsset: async (id) => {
        if (requireProjectId() === projectP && id === assetP) {
          return { mime: "image/png", bytes: bytesP };
        }
        return null;
      },
    },
    renderController: controller,
  });
  const port = await listen(server);
  try {
    const startedP = await send(port, {
      method: "POST",
      path: `/api/projects/${projectP}/visual/render`,
    });
    assert.equal(startedP.status, 202);
    const startedQ = await send(port, {
      method: "POST",
      path: `/api/projects/${projectQ}/visual/render`,
    });
    assert.equal(startedQ.status, 202);
    for (let attempt = 0; attempt < 50 && captures.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(captures.length, 2);

    const owned = captures.find((capture) => capture.spec.frames[0].id === "frame-image");
    const foreign = captures.find((capture) => capture.spec.frames[0].id === "frame-foreign");
    const ownedUrl = `http://127.0.0.1:${port}/api/projects/${projectP}/visual/assets/${assetP}`;
    const foreignUrl = `http://127.0.0.1:${port}/api/projects/${projectQ}/visual/assets/${assetP}`;
    assert.equal(owned.spec.frames[0].panels[0].asset, ownedUrl);
    assert.equal(owned.spec.frames[0].panels[0].zoom, 1.2);
    assert.equal(owned.spec.frames[0].panels[0].mirrored, true);
    assert.equal(owned.spec.frames[0].panels[1].asset, null);
    assert.equal(owned.spec.frames[0].durationFrames, 36);
    assert.equal(owned.spec.frames[1].kind, "text");
    assert.equal(owned.spec.frames[1].textCard, "Пауза");
    assert.equal(owned.spec.frames[1].panels.length, 0);
    assert.equal(owned.spec.project.exportTransition.mode, "hard-cut");
    assert.equal(JSON.stringify(owned.spec).includes("/api/visual/assets/"), false);
    assert.equal(owned.loaded.length, 1);
    assert.equal(owned.loaded[0].asset, ownedUrl);
    assert.equal(owned.loaded[0].status, 200);
    assert.equal(owned.loaded[0].body.equals(bytesP), true);

    assert.equal(foreign.spec.frames[0].panels[0].asset, foreignUrl);
    assert.equal(JSON.stringify(foreign.spec).includes(projectP), false);
    assert.equal(JSON.stringify(foreign.spec).includes("/api/visual/assets/"), false);
    assert.equal(foreign.loaded.length, 1);
    assert.equal(foreign.loaded[0].status, 404);
    assert.equal(foreign.loaded[0].body.equals(bytesP), false);

    const unscoped = await send(port, { path: `/api/visual/assets/${assetP}` });
    assert.equal(unscoped.status, 404);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (controller.status(projectP).status === "success" && controller.status(projectQ).status === "success") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const fileP = controller.resultFile(projectP);
    const fileQ = controller.resultFile(projectQ);
    assert.equal(controller.status(projectP).status, "success");
    assert.equal(controller.status(projectQ).status, "success");
    assert.equal(fileP, path.join(directory, projectP, "current.mp4"));
    assert.equal(fileQ, path.join(directory, projectQ, "current.mp4"));
    assert.notEqual(fileP, fileQ);
    assert.equal(await readFile(fileP, "utf8"), "frame-image");
    assert.equal(await readFile(fileQ, "utf8"), "frame-foreign");
  } finally {
    await close(server);
  }
});
