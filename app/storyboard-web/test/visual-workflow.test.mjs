import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer, IMAGE_MAX_BODY_BYTES } from "../server.mjs";
import { IDENTITY_MAX_BODY_BYTES } from "../image-info.mjs";
import { expandStoryboardFrames } from "../visual-model.mjs";
import { heicLike, putinBoard, tinyJpeg } from "./visual-repair-fixtures.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function request(port, { method = "GET", path, body = null }) {
  return new Promise((resolve, reject) => {
    const bytes = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: bytes ? { "content-type": "application/json", "content-length": bytes.length } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body: parsed, bytes: Buffer.concat(chunks), headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end(bytes ?? undefined);
  });
}

function visualState() {
  return {
    ok: true,
    status: "ready",
    allAnchorsApproved: true,
    complete: false,
    approved: false,
    readyForVideo: false,
    characters: [{ name: "Путин", approvedAnchorId: "anchor" }],
    frames: [{
      id: "f1",
      layout: "single",
      dialogue: "Нет.",
      speakerPanel: 0,
      panels: [{ description: "Путин спокойно отвечает", subject: "Путин", zoom: 1, position: "50% 30%", align: "50% 30%" }],
    }],
  };
}

test("visual endpoints use the image provider for anchors and panels but never for zoom", async () => {
  const calls = [];
  const counters = { identity: 0, placement: 0, finishAnchor: 0, finishPanel: 0 };
  const store = {
    load: async () => visualState(),
    saveIdentity: async (input) => {
      counters.identity += 1;
      assert.equal(input.characterName, "Путин");
      assert.equal(input.image.mime, "image/png");
      assert.ok(Buffer.isBuffer(input.image.bytes));
      assert.deepEqual(input.image.bytes, png);
      return { ok: true };
    },
    beginAnchor: async () => ({
      ok: true,
      id: "anchor-run",
      identityComment: "recognizable",
      instruction: "heavier contour",
      identity: { mime: "image/png", bytes: png },
      previous: null,
      style: null,
    }),
    finishAnchor: async ({ result }) => {
      counters.finishAnchor += 1;
      assert.equal(result.ok, true);
      return { ok: true };
    },
    approveAnchor: async () => ({ ok: true }),
    beginPanelGeneration: async ({ performanceImage }) => ({
      ok: true,
      id: "panel-run",
      frame: { id: "f1", layout: "single", speakerPanel: 0 },
      panel: { description: "Путин спокойно отвечает" },
      panelIndex: 0,
      subject: "Путин",
      instruction: "closer",
      refs: {
        anchor: { mime: "image/png", bytes: png },
        previous: null,
        performance: performanceImage ? { mime: "image/png", bytes: png } : null,
        style: null,
      },
    }),
    finishPanelGeneration: async ({ result }) => {
      counters.finishPanel += 1;
      assert.equal(result.ok, true);
      return { ok: true };
    },
    updatePlacement: async ({ zoom }) => {
      counters.placement += 1;
      assert.equal(zoom, 1.5);
      return { ok: true };
    },
    readAsset: async () => ({ mime: "image/png", bytes: png }),
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: png }, metadata: {} };
    },
  });
  const port = await listen(server);
  try {
    const identity = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Путин")}/identity`,
      body: { imageDataUrl: dataUrl, comment: "recognizable" },
    });
    assert.equal(identity.status, 200);
    assert.equal(counters.identity, 1);

    const anchor = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Путин")}/anchor`,
      body: { instruction: "heavier contour" },
    });
    assert.equal(anchor.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].aspectRatio, "4:5");
    assert.equal(counters.finishAnchor, 1);

    const panel = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f1/panels/0/generate",
      body: { instruction: "closer", performanceImageDataUrl: dataUrl },
    });
    assert.equal(panel.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].aspectRatio, "21:9");
    assert.equal(calls[1].images.length, 2);
    assert.equal(counters.finishPanel, 1);

    const zoom = await request(port, {
      method: "PATCH",
      path: "/api/visual/frames/f1/panels/0/placement",
      body: { zoom: 1.5, positionX: 50, positionY: 30 },
    });
    assert.equal(zoom.status, 200);
    assert.equal(counters.placement, 1);
    assert.equal(calls.length, 2, "zoom must not call the image provider");

    const asset = await request(port, { path: "/api/visual/assets/00000000-0000-4000-8000-000000000111" });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers["content-type"], "image/png");
    assert.deepEqual(asset.bytes, png);
  } finally {
    await close(server);
  }
});

function jpegDataUrl() {
  const jpeg = tinyJpeg();
  return { jpeg, dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
}

test("identity save accepts JPEG and PNG, never calls the image provider, and returns specific image errors", async () => {
  assert.equal(IMAGE_MAX_BODY_BYTES, IDENTITY_MAX_BODY_BYTES);
  const saved = [];
  const calls = [];
  const store = {
    load: async () => visualState(),
    saveIdentity: async (input) => {
      saved.push(input);
      return { ok: true };
    },
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: png }, metadata: {} };
    },
  });
  const port = await listen(server);
  try {
    const pngResponse = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Путин")}/identity`,
      body: { imageDataUrl: dataUrl, comment: "png" },
    });
    assert.equal(pngResponse.status, 200);
    assert.equal(saved[0].image.mime, "image/png");
    assert.deepEqual(saved[0].image.bytes, png);

    const { jpeg, dataUrl: jpegUrl } = jpegDataUrl();
    const jpegResponse = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Путин")}/identity`,
      body: { imageDataUrl: jpegUrl, comment: "jpeg" },
    });
    assert.equal(jpegResponse.status, 200);
    assert.equal(saved[1].image.mime, "image/jpeg");
    assert.deepEqual(saved[1].image.bytes, jpeg);

    const heic = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Путин")}/identity`,
      body: { imageDataUrl: `data:image/heic;base64,${heicLike().toString("base64")}` },
    });
    assert.equal(heic.status, 400);
    assert.deepEqual(heic.body, { status: "failed", kind: "unsupported-image-format" });

    const oversize = Buffer.concat([png, Buffer.alloc((12 * 1024 * 1024 + 1) - png.length)]);
    const tooLarge = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Путин")}/identity`,
      body: { imageDataUrl: `data:image/png;base64,${oversize.toString("base64")}` },
    });
    assert.equal(tooLarge.status, 400);
    assert.deepEqual(tooLarge.body, { status: "failed", kind: "image-too-large" });

    assert.equal(calls.length, 0);
    assert.equal(saved.length, 2);
  } finally {
    await close(server);
  }
});

test("structural edit applies the Putin full-frame command and maps conflicts to structure-rejected", async () => {
  const board = putinBoard();
  let savedFrames = null;
  const store = {
    load: async () => ({
      ...visualState(),
      frames: expandStoryboardFrames(savedFrames || board.frames),
    }),
    loadStructure: async () => ({ ok: true, frames: board.frames }),
    saveStoryboardEdit: async ({ frames }) => {
      savedFrames = frames;
      return { ok: true };
    },
  };
  const server = createServer({
    migrate: false,
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                frames: [{
                  id: "orphan",
                  layout: "single",
                  origin: "source",
                  panels: [{ description: "пусто" }],
                  sourceItemId: "missing",
                  sourceRole: "utterance",
                  speakerPanel: 0,
                }],
                review: [],
              }),
            },
            finish_reason: "stop",
          }],
        });
      },
    }),
    projectStore: {
      loadProject: async () => ({
        draft: { text: board.draft },
        material: { cast: board.cast },
        activeMaterialStateId: "ms-1",
        storyboards: [{ materialStateId: "ms-1", sourceItems: board.sourceItems }],
      }),
    },
    visualStore: store,
    imageGenerator: async () => {
      throw new Error("image provider must not run during structural edit");
    },
  });
  const port = await listen(server);
  try {
    const edited = await request(port, {
      method: "POST",
      path: "/api/visual/storyboard/edit",
      body: { instruction: "в кадре 14 должен быть только Путин на весь кадр" },
    });
    assert.equal(edited.status, 200);
    const visible = expandStoryboardFrames(savedFrames);
    assert.equal(visible[13].layout, "single");
    assert.equal(visible[13].panels.length, 1);
    assert.match(visible[13].panels[0].description, /Путин/);

    const conflict = await request(port, {
      method: "POST",
      path: "/api/visual/storyboard/edit",
      body: { instruction: "Сделай кадр 2 крупнее" },
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { status: "failed", kind: "structure-rejected" });
    assert.equal(Object.hasOwn(conflict.body, "failures"), false);
  } finally {
    await close(server);
  }
});
