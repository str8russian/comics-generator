import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer, IMAGE_MAX_BODY_BYTES } from "../server.mjs";
import { IDENTITY_MAX_BODY_BYTES } from "../image-info.mjs";
import { compileOverflow } from "../overflow.mjs";
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

test("stable style seed is reused for later anchors and survives approval of other characters", async () => {
  const logs = [];
  const style = { id: "style-seed", mime: "image/png", bytes: png };
  const identityB = { id: "id-b", mime: "image/png", bytes: png };
  const previousB = { id: "prev-b", mime: "image/png", bytes: png };
  let approved = ["Путин"];
  const calls = [];
  const store = {
    load: async () => ({
      ...visualState(),
      styleSeedAssetId: style.id,
      characters: [
        { name: "Путин", approvedAnchorId: "a1", approvedAssetId: style.id },
        { name: "Дуров", approvedAnchorId: approved.includes("Дуров") ? "a2" : null },
      ],
    }),
    beginAnchor: async ({ characterName }) => ({
      ok: true,
      id: `anchor-${characterName}`,
      identityComment: "",
      instruction: "match project style",
      identity: characterName === "Дуров" ? identityB : { id: "id-a", mime: "image/png", bytes: png },
      previous: characterName === "Дуров" ? previousB : null,
      style,
    }),
    finishAnchor: async () => ({ ok: true }),
    approveAnchor: async ({ characterName }) => {
      approved.push(characterName);
      return { ok: true, styleSeedAssetId: style.id };
    },
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    logger: { log: (line) => logs.push(line) },
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: png, mime: "image/png", width: 1, height: 1, byteLength: png.length }, metadata: { model: "test-model" } };
    },
  });
  const port = await listen(server);
  try {
    const first = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Дуров")}/anchor`,
      body: { instruction: "match project style" },
    });
    assert.equal(first.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].images.length, 3);
    assert.match(calls[0].prompt, /real identity reference/);
    assert.match(calls[0].prompt, /project style anchor/);
    assert.match(calls[0].prompt, /previous anchor candidate/);

    const approve = await request(port, {
      method: "POST",
      path: `/api/visual/characters/${encodeURIComponent("Дуров")}/anchors/00000000-0000-4000-8000-000000000222/approve`,
      body: {},
    });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.styleSeedAssetId, style.id);

    const joined = logs.join("\n");
    assert.match(joined, /visual-anchor-start/);
    assert.match(joined, /visual-anchor-provider/);
    assert.match(joined, /visual-anchor-storage/);
    assert.match(joined, /visual-anchor-approve/);
    assert.equal(joined.includes("match project style"), false);
    assert.equal(joined.includes(dataUrl), false);
    assert.equal(joined.includes("test-token"), false);
    assert.equal(joined.includes("BASE_URL"), false);
  } finally {
    await close(server);
  }
});

test("successful panel assets survive loadVisual fitting and partial frame failures stay visible", async () => {
  const logs = [];
  let panelCalls = 0;
  const splitReady = {
    id: "f-split",
    layout: "split2",
    dialogue: "Короткий текст.",
    speakerPanel: 0,
    visualReady: true,
    panels: [
      {
        description: "Путин",
        subject: "Путин",
        assetId: "p0",
        asset: "/api/visual/assets/p0",
        zoom: 1,
        position: "50% 30%",
        align: "50% 30%",
        generationStatus: "ready",
      },
      {
        description: "Дуров",
        subject: "Дуров",
        assetId: "p1",
        asset: "/api/visual/assets/p1",
        zoom: 1.2,
        position: "45% 28%",
        align: "45% 28%",
        generationStatus: "ready",
      },
    ],
  };
  // Legacy sync frame-generate remains for non-eligible frames (silent/action), not ordinary split dialogue.
  const readyState = {
    ...visualState(),
    storyboardResultId: "result-1",
    storyboardVersionId: "version-1",
    frames: [{
      id: "f1",
      layout: "split2",
      dialogue: "",
      silent: true,
      sourceRole: "action",
      visualReady: true,
      panels: [
        {
          description: "Путин",
          subject: "Путин",
          assetId: "p0",
          asset: "/api/visual/assets/p0",
          zoom: 1,
          position: "50% 30%",
          align: "50% 30%",
          generationStatus: "ready",
        },
        {
          description: "Дуров",
          subject: "Дуров",
          assetId: "p1",
          asset: "/api/visual/assets/p1",
          zoom: 1.2,
          position: "45% 28%",
          align: "45% 28%",
          generationStatus: "ready",
        },
      ],
    }],
  };
  const store = {
    load: async () => readyState,
    beginPanelGeneration: async ({ panelIndex }) => {
      panelCalls += 1;
      if (panelIndex === 1) return { ok: false, status: "failed", kind: "timeout", httpStatus: 504 };
      return {
        ok: true,
        id: `gen-${panelIndex}`,
        storyboardVersionId: "version-1",
        frame: readyState.frames[0],
        panel: readyState.frames[0].panels[panelIndex],
        panelIndex,
        subject: readyState.frames[0].panels[panelIndex].subject,
        instruction: "",
        refs: {
          anchor: { id: "anchor", mime: "image/png", bytes: png },
          previous: null,
          performance: null,
          style: { id: "style", mime: "image/png", bytes: png },
        },
      };
    },
    finishPanelGeneration: async () => ({ ok: true, generationId: "gen-0", assetId: "p0" }),
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    logger: { log: (line) => logs.push(line) },
    imageGenerator: async () => ({ ok: true, image: { bytes: png }, metadata: {} }),
  });
  const port = await listen(server);
  try {
    const fitted = compileOverflow([splitReady], () => true);
    assert.equal(fitted.ok, true);
    assert.equal(fitted.frames[0].panels[0].assetId, "p0");
    assert.equal(fitted.frames[0].panels[1].assetId, "p1");
    assert.equal(fitted.frames[0].visualReady, true);

    const generated = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f1/generate",
      body: {},
    });
    assert.equal(generated.status, 200);
    assert.equal(panelCalls, 2);
    assert.deepEqual(generated.body.generationFailures, [{ panelIndex: 1, kind: "timeout" }]);
    assert.equal(generated.body.frames[0].panels[0].assetId, "p0");
    const joined = logs.join("\n");
    assert.match(joined, /visual-frame-start/);
    assert.match(joined, /visual-panel-start/);
    assert.match(joined, /visual-frame-outcome/);
    assert.equal(joined.includes("Короткий текст"), false);
    assert.equal(joined.includes(dataUrl), false);
  } finally {
    await close(server);
  }
});

function hybridEligibleState(overrides = {}) {
  return {
    ok: true,
    status: "ready",
    allAnchorsApproved: true,
    complete: false,
    approved: false,
    readyForVideo: false,
    styleSeedAssetId: "style-1",
    storyboardResultId: "result-1",
    storyboardVersionId: "version-1",
    characters: [
      { name: "Путин", approvedAnchorId: "anchor-putin" },
      { name: "Дуров", approvedAnchorId: "anchor-durov" },
    ],
    frames: [{
      id: "f-hybrid",
      layout: "split2",
      dialogue: "Привет, коллега.",
      speakerPanel: 0,
      sourceRole: "utterance",
      visualReady: false,
      gridDescription: "near-frontal-pair: Путин / Дуров",
      detailedBrief: "Human-readable hybrid brief for ordinary UI copy.",
      hybrid: {
        sceneKey: "primary",
        compositionMode: "near-frontal-pair",
        assemblyStatus: "not-ready",
        activeOperationId: null,
        operation: null,
        background: { status: "missing", assetId: null },
        panels: [
          {
            panelIndex: 0,
            subject: "Путин",
            status: "missing",
            assetId: null,
            errorKind: null,
            zoom: 1,
            positionX: 50,
            positionY: 30,
            fitMode: "manual",
          },
          {
            panelIndex: 1,
            subject: "Дуров",
            status: "missing",
            assetId: null,
            errorKind: null,
            zoom: 1,
            positionX: 50,
            positionY: 30,
            fitMode: "manual",
          },
        ],
      },
      panels: [
        {
          description: "Путин слева",
          subject: "Путин",
          assetId: null,
          zoom: 1,
          positionX: 50,
          positionY: 30,
          fitMode: "manual",
          position: "50% 30%",
          align: "50% 30%",
        },
        {
          description: "Дуров справа",
          subject: "Дуров",
          assetId: null,
          zoom: 1,
          positionX: 50,
          positionY: 30,
          fitMode: "manual",
          position: "50% 30%",
          align: "50% 30%",
        },
      ],
    }],
    ...overrides,
  };
}

test("hybrid pre-accept rejects missing style or anchors without creating work", async () => {
  const calls = [];
  const created = { ops: 0, orchestrations: 0 };
  const noStyle = hybridEligibleState({ styleSeedAssetId: null });
  const store = {
    load: async () => noStyle,
    createFrameOperation: async () => {
      created.ops += 1;
      return { ok: true, operationId: "should-not-create" };
    },
    orchestrateHybridFrameOperation: async () => {
      created.orchestrations += 1;
      return { ok: true };
    },
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: png } };
    },
  });
  const port = await listen(server);
  try {
    const missingStyle = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f-hybrid/generate",
      body: {},
    });
    assert.equal(missingStyle.status, 409);
    assert.deepEqual(missingStyle.body, { status: "failed", kind: "style-required" });
    assert.equal(created.ops, 0);
    assert.equal(created.orchestrations, 0);
    assert.equal(calls.length, 0);

    noStyle.styleSeedAssetId = "style-1";
    noStyle.characters = [{ name: "Путин", approvedAnchorId: "anchor-putin" }];
    const missingAnchor = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f-hybrid/generate",
      body: {},
    });
    assert.equal(missingAnchor.status, 409);
    assert.deepEqual(missingAnchor.body, { status: "failed", kind: "anchor-required" });
    assert.equal(created.ops, 0);
    assert.equal(calls.length, 0);
  } finally {
    await close(server);
  }
});

test("eligible hybrid frame accept returns 202, polls real phases, and completes without fabricated progress", async () => {
  const calls = [];
  let resolveProvider;
  const providerGate = new Promise((resolve) => {
    resolveProvider = resolve;
  });
  let acceptedAt = 0;
  let providerResolvedAt = 0;
  const operationId = "00000000-0000-4000-8000-000000000001";
  const op = {
    operationId,
    frameId: "f-hybrid",
    storyboardVersionId: "version-1",
    writeVersion: 1,
    phase: "queued",
    status: "running",
    errorKind: null,
    componentFailures: [],
    visualReady: false,
    hybrid: hybridEligibleState().frames[0].hybrid,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    finishedAt: null,
  };
  let loadState = hybridEligibleState();
  const store = {
    load: async () => loadState,
    ensureHybridHeads: async () => ({ ok: true }),
    createFrameOperation: async ({ frameId }) => {
      assert.equal(frameId, "f-hybrid");
      return {
        ok: true,
        operationId: op.operationId,
        frameId,
        storyboardVersionId: op.storyboardVersionId,
        writeVersion: 1,
        phase: "queued",
        status: "running",
      };
    },
    getFrameOperation: async ({ frameId, operationId }) => {
      assert.equal(frameId, "f-hybrid");
      assert.equal(operationId, op.operationId);
      return { ok: true, ...op };
    },
    orchestrateHybridFrameOperation: async ({ operationId, generateImage }) => {
      assert.equal(operationId, op.operationId);
      op.phase = "preparing-background";
      op.updatedAt = "2026-10-09T10:00:01.000Z";
      op.phase = "generating-background";
      const bg = await generateImage({
        prompt: "people-free background",
        images: [{ mime: "image/png", bytes: png }],
        aspectRatio: "21:9",
      });
      providerResolvedAt = Date.now();
      assert.equal(bg.ok, true);
      op.phase = "generating-character-states";
      await generateImage({
        prompt: "character chromakey",
        images: [{ mime: "image/png", bytes: png }],
        aspectRatio: "4:5",
      });
      await generateImage({
        prompt: "character chromakey",
        images: [{ mime: "image/png", bytes: png }],
        aspectRatio: "4:5",
      });
      op.phase = "assembling";
      op.phase = "complete";
      op.status = "complete";
      op.visualReady = true;
      op.finishedAt = "2026-10-09T10:00:02.000Z";
      op.hybrid = {
        ...op.hybrid,
        background: { status: "ready", assetId: "bg-1" },
        panels: op.hybrid.panels.map((panel) => ({
          ...panel,
          status: "ready",
          assetId: `char-${panel.panelIndex}`,
        })),
      };
      loadState = hybridEligibleState({
        frames: [{
          ...hybridEligibleState().frames[0],
          visualReady: true,
          hybrid: {
            ...op.hybrid,
            assemblyStatus: "ready",
            activeOperationId: op.operationId,
            operation: {
              operationId: op.operationId,
              phase: "complete",
              status: "complete",
              errorKind: null,
              writeVersion: 1,
            },
          },
        }],
      });
      return { ok: true, phase: "complete", visualReady: true };
    },
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async (input) => {
      calls.push(input);
      await providerGate;
      return { ok: true, image: { bytes: png }, metadata: {} };
    },
  });
  const port = await listen(server);
  try {
    const acceptPromise = request(port, {
      method: "POST",
      path: "/api/visual/frames/f-hybrid/generate",
      body: {},
    });
    const accepted = await acceptPromise;
    acceptedAt = Date.now();
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.status, "accepted");
    assert.equal(accepted.body.operationId, operationId);
    assert.equal(accepted.body.phase, "queued");
    assert.equal(accepted.body.writeVersion, 1);
    assert.equal(accepted.body.frameId, "f-hybrid");
    assert.equal(Object.hasOwn(accepted.body, "percent"), false);
    assert.equal(providerResolvedAt, 0, "202 must return before deferred provider double resolves");
    assert.ok(acceptedAt > 0);

    const mid = await request(port, {
      path: `/api/visual/frames/f-hybrid/operations/${op.operationId}`,
    });
    assert.equal(mid.status, 200);
    assert.equal(mid.body.operationId, op.operationId);
    assert.equal(mid.body.status, "running");
    assert.equal(Object.hasOwn(mid.body, "percent"), false);
    assert.equal(mid.body.visualReady, false);

    resolveProvider();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (op.status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(op.status, "complete");
    assert.ok(providerResolvedAt >= acceptedAt, "provider resolves only after 202 response");
    assert.equal(calls.length, 3);

    const done = await request(port, {
      path: `/api/visual/frames/f-hybrid/operations/${op.operationId}`,
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.phase, "complete");
    assert.equal(done.body.status, "complete");
    assert.equal(done.body.visualReady, true);
    assert.equal(done.body.hybrid.background.status, "ready");

    const visual = await request(port, { path: "/api/visual" });
    assert.equal(visual.status, 200);
    assert.equal(visual.body.frames[0].visualReady, true);
    assert.equal(visual.body.frames[0].hybrid.activeOperationId, op.operationId);
    assert.match(visual.body.frames[0].detailedBrief, /Human-readable/);
    assert.equal(String(visual.body.frames[0].detailedBrief).includes("#00FF00"), false);
    assert.equal(String(visual.body.frames[0].detailedBrief).includes("Create one people-free"), false);
  } finally {
    resolveProvider();
    await close(server);
  }
});

test("hybrid failures map contract kinds and retain previous ready assembly", async () => {
  const calls = [];
  const previousHybrid = {
    sceneKey: "primary",
    compositionMode: "near-frontal-pair",
    assemblyStatus: "ready",
    activeOperationId: "op-prev",
    operation: {
      operationId: "op-prev",
      phase: "complete",
      status: "complete",
      errorKind: null,
      writeVersion: 1,
    },
    background: { status: "ready", assetId: "bg-ready" },
    panels: [
      {
        panelIndex: 0,
        subject: "Путин",
        status: "ready",
        assetId: "char-0",
        errorKind: null,
        zoom: 1,
        positionX: 50,
        positionY: 30,
        fitMode: "manual",
      },
      {
        panelIndex: 1,
        subject: "Дуров",
        status: "ready",
        assetId: "char-1",
        errorKind: null,
        zoom: 1.1,
        positionX: 48,
        positionY: 28,
        fitMode: "manual",
      },
    ],
  };
  let loadState = hybridEligibleState({
    frames: [{
      ...hybridEligibleState().frames[0],
      visualReady: true,
      hybrid: previousHybrid,
      panels: hybridEligibleState().frames[0].panels.map((panel, index) => ({
        ...panel,
        characterAssetId: `char-${index}`,
      })),
    }],
  });
  const operationId = "00000000-0000-4000-8000-0000000000f1";
  const op = {
    operationId,
    frameId: "f-hybrid",
    storyboardVersionId: "version-1",
    writeVersion: 2,
    phase: "queued",
    status: "running",
    errorKind: null,
    componentFailures: [],
    visualReady: true,
    hybrid: {
      ...previousHybrid,
      activeOperationId: operationId,
      background: { status: "ready", assetId: "bg-ready" },
      panels: [
        { ...previousHybrid.panels[0] },
        {
          ...previousHybrid.panels[1],
          status: "pending",
          assetId: "char-1",
          errorKind: null,
        },
      ],
    },
    createdAt: "2026-10-09T11:00:00.000Z",
    updatedAt: "2026-10-09T11:00:00.000Z",
    finishedAt: null,
  };
  const store = {
    load: async () => loadState,
    ensureHybridHeads: async () => ({ ok: true }),
    createFrameOperation: async () => ({
      ok: true,
      operationId,
      frameId: "f-hybrid",
      storyboardVersionId: "version-1",
      writeVersion: 2,
      phase: "queued",
      status: "running",
    }),
    getFrameOperation: async () => ({ ok: true, ...op }),
    orchestrateHybridFrameOperation: async ({ generateImage }) => {
      op.phase = "generating-character-states";
      const result = await generateImage({
        prompt: "character",
        images: [],
        aspectRatio: "4:5",
      });
      assert.equal(result.ok, false);
      op.phase = "failed";
      op.status = "failed";
      op.errorKind = "matte-failed";
      op.componentFailures = [{ component: "character-state", panelIndex: 1, kind: "matte-failed" }];
      op.finishedAt = "2026-10-09T11:00:01.000Z";
      op.visualReady = true;
      op.hybrid = {
        ...previousHybrid,
        activeOperationId: operationId,
        operation: {
          operationId,
          phase: "failed",
          status: "failed",
          errorKind: "matte-failed",
          writeVersion: 2,
        },
        panels: [
          previousHybrid.panels[0],
          {
            ...previousHybrid.panels[1],
            status: "ready",
            assetId: "char-1",
            errorKind: null,
          },
        ],
      };
      loadState = {
        ...loadState,
        frames: [{
          ...loadState.frames[0],
          visualReady: true,
          hybrid: op.hybrid,
        }],
      };
      return { ok: false, kind: "matte-failed" };
    },
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: false, kind: "matte-failed" };
    },
  });
  const port = await listen(server);
  try {
    const accepted = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f-hybrid/generate",
      body: {},
    });
    assert.equal(accepted.status, 202);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (op.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const polled = await request(port, {
      path: `/api/visual/frames/f-hybrid/operations/${op.operationId}`,
    });
    assert.equal(polled.status, 200);
    assert.equal(polled.body.status, "failed");
    assert.equal(polled.body.errorKind, "matte-failed");
    assert.deepEqual(polled.body.componentFailures, [
      { component: "character-state", panelIndex: 1, kind: "matte-failed" },
    ]);
    assert.equal(polled.body.visualReady, true, "previous valid assembly remains ready");
    assert.equal(polled.body.hybrid.background.assetId, "bg-ready");
    assert.equal(polled.body.hybrid.panels[0].assetId, "char-0");

    const visual = await request(port, { path: "/api/visual" });
    assert.equal(visual.body.frames[0].visualReady, true);
    assert.equal(visual.body.frames[0].hybrid.operation.status, "failed");
    assert.equal(visual.body.frames[0].hybrid.background.assetId, "bg-ready");
    assert.equal(calls.length, 1);
  } finally {
    await close(server);
  }
});

test("hybrid attempt does not silently treat historical full-panel assets as success", async () => {
  const operationId = "00000000-0000-4000-8000-0000000000a1";
  const state = hybridEligibleState({
    frames: [{
      ...hybridEligibleState().frames[0],
      visualReady: false,
      hybrid: {
        ...hybridEligibleState().frames[0].hybrid,
        activeOperationId: operationId,
        operation: {
          operationId,
          phase: "generating-character-states",
          status: "running",
          errorKind: null,
          writeVersion: 1,
        },
        background: { status: "ready", assetId: "bg-1" },
      },
      panels: [
        {
          description: "Путин слева",
          subject: "Путин",
          assetId: "historical-0",
          characterAssetId: null,
          zoom: 1,
          position: "50% 30%",
          align: "50% 30%",
        },
        {
          description: "Дуров справа",
          subject: "Дуров",
          assetId: "historical-1",
          characterAssetId: null,
          zoom: 1,
          position: "50% 30%",
          align: "50% 30%",
        },
      ],
    }],
  });
  const store = {
    load: async () => state,
    getFrameOperation: async () => ({
      ok: true,
      operationId,
      frameId: "f-hybrid",
      storyboardVersionId: "version-1",
      writeVersion: 1,
      phase: "generating-character-states",
      status: "running",
      errorKind: null,
      componentFailures: [],
      visualReady: false,
      hybrid: state.frames[0].hybrid,
      createdAt: "2026-10-09T12:00:00.000Z",
      updatedAt: "2026-10-09T12:00:01.000Z",
      finishedAt: null,
    }),
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async () => {
      throw new Error("provider must not run");
    },
  });
  const port = await listen(server);
  try {
    const visual = await request(port, { path: "/api/visual" });
    assert.equal(visual.status, 200);
    assert.equal(visual.body.frames[0].visualReady, false);
    assert.equal(visual.body.frames[0].panels[0].assetId, "historical-0");
    assert.equal(visual.body.frames[0].hybrid.operation.status, "running");

    const polled = await request(port, {
      path: `/api/visual/frames/f-hybrid/operations/${operationId}`,
    });
    assert.equal(polled.status, 200);
    assert.equal(polled.body.visualReady, false);
    assert.equal(polled.body.status, "running");
  } finally {
    await close(server);
  }
});

test("overflow fitting preserves hybrid fields, dialogue, and speakerPanel", async () => {
  const frame = {
    id: "f-hybrid",
    layout: "split2",
    dialogue: "Очень длинная реплика для принудительного разбиения overflow.",
    speakerPanel: 1,
    sourceRole: "utterance",
    sourceItemId: "utt-1",
    displayBlock: { sourceItemId: "utt-1", start: 0, end: 58 },
    visualReady: true,
    fitMode: "manual",
    hybrid: {
      sceneKey: "primary",
      compositionMode: "near-frontal-pair",
      assemblyStatus: "ready",
      activeOperationId: null,
      background: { status: "ready", assetId: "bg-1" },
      panels: [
        {
          panelIndex: 0,
          subject: "Путин",
          status: "ready",
          assetId: "c0",
          zoom: 1.25,
          positionX: 40,
          positionY: 20,
          fitMode: "manual",
        },
        {
          panelIndex: 1,
          subject: "Дуров",
          status: "ready",
          assetId: "c1",
          zoom: 1.1,
          positionX: 55,
          positionY: 25,
          fitMode: "fit",
        },
      ],
    },
    panels: [
      {
        description: "Путин",
        subject: "Путин",
        characterAssetId: "c0",
        zoom: 1.25,
        positionX: 40,
        positionY: 20,
        fitMode: "manual",
        hybrid: { status: "ready", assetId: "c0" },
      },
      {
        description: "Дуров",
        subject: "Дуров",
        characterAssetId: "c1",
        zoom: 1.1,
        positionX: 55,
        positionY: 25,
        fitMode: "fit",
        hybrid: { status: "ready", assetId: "c1" },
      },
    ],
  };
  const notReady = {
    ...frame,
    visualReady: false,
    hybrid: { ...frame.hybrid, assemblyStatus: "not-ready" },
  };
  const notReadyFitted = compileOverflow([notReady], () => true);
  assert.equal(notReadyFitted.ok, true);
  assert.equal(notReadyFitted.frames[0].visualReady, false);
  assert.equal(notReadyFitted.frames[0].hybrid.assemblyStatus, "not-ready");

  const fitted = compileOverflow([frame], (text, options) => {
    if (options.fontSize > 31) return false;
    return text.length <= 20;
  });
  assert.equal(fitted.ok, true);
  assert.ok(fitted.frames.length >= 2);
  const joined = fitted.frames.map((piece) => piece.dialogue).join("");
  assert.equal(joined, frame.dialogue);
  for (const piece of fitted.frames) {
    assert.equal(piece.speakerPanel, 1);
    assert.equal(piece.hybrid.sceneKey, "primary");
    assert.equal(piece.hybrid.assemblyStatus, "ready");
    assert.equal(piece.hybrid.background.assetId, "bg-1");
    assert.equal(piece.panels[0].characterAssetId, "c0");
    assert.equal(piece.panels[0].fitMode, "manual");
    assert.equal(piece.panels[1].fitMode, "fit");
    assert.equal(piece.visualReady, true);
  }
});

test("non-eligible frames do not silently succeed through the hybrid route", async () => {
  const calls = [];
  let hybridOps = 0;
  const state = {
    ...visualState(),
    styleSeedAssetId: "style-1",
    storyboardResultId: "result-1",
    storyboardVersionId: "version-1",
    frames: [{
      id: "f-single",
      layout: "single",
      dialogue: "Один.",
      speakerPanel: 0,
      sourceRole: "utterance",
      panels: [{
        description: "Путин",
        subject: "Путин",
        assetId: null,
      }],
    }],
  };
  const store = {
    load: async () => state,
    createFrameOperation: async () => {
      hybridOps += 1;
      return { ok: true, operationId: "nope" };
    },
    beginPanelGeneration: async () => ({
      ok: true,
      id: "gen-single",
      storyboardVersionId: "version-1",
      frame: state.frames[0],
      panel: state.frames[0].panels[0],
      panelIndex: 0,
      subject: "Путин",
      instruction: "",
      refs: {
        anchor: { id: "anchor", mime: "image/png", bytes: png },
        previous: null,
        performance: null,
        style: { id: "style", mime: "image/png", bytes: png },
      },
    }),
    finishPanelGeneration: async () => ({ ok: true }),
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: png } };
    },
  });
  const port = await listen(server);
  try {
    const generated = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f-single/generate",
      body: {},
    });
    assert.equal(generated.status, 200);
    assert.equal(hybridOps, 0);
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(generated.body, "operationId"), false);
  } finally {
    await close(server);
  }
});

test("operation poll returns not-found for unknown operations", async () => {
  const store = {
    load: async () => hybridEligibleState(),
    getFrameOperation: async () => ({ ok: false, status: "failed", kind: "not-found", httpStatus: 404 }),
  };
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async () => ({ ok: true, image: { bytes: png } }),
  });
  const port = await listen(server);
  try {
    const missing = await request(port, {
      path: "/api/visual/frames/f-hybrid/operations/00000000-0000-4000-8000-000000000099",
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { status: "failed", kind: "not-found" });
  } finally {
    await close(server);
  }
});

test("deferred hybrid provider rejection finalizes failed without unhandled rejection", async () => {
  const operationId = "00000000-0000-4000-8000-0000000000e1";
  const op = {
    operationId,
    frameId: "f-hybrid",
    storyboardVersionId: "version-1",
    writeVersion: 1,
    phase: "queued",
    status: "running",
    errorKind: null,
    componentFailures: [],
    visualReady: false,
    hybrid: hybridEligibleState().frames[0].hybrid,
    createdAt: "2026-10-09T13:00:00.000Z",
    updatedAt: "2026-10-09T13:00:00.000Z",
    finishedAt: null,
  };
  const store = {
    load: async () => hybridEligibleState(),
    ensureHybridHeads: async () => ({ ok: true }),
    createFrameOperation: async () => ({
      ok: true,
      operationId,
      frameId: "f-hybrid",
      storyboardVersionId: "version-1",
      writeVersion: 1,
      phase: "queued",
      status: "running",
    }),
    getFrameOperation: async () => ({ ok: true, ...op }),
    orchestrateHybridFrameOperation: async ({ generateImage }) => {
      op.phase = "generating-background";
      try {
        await generateImage({ prompt: "bg", images: [], aspectRatio: "21:9" });
      } catch {
        op.phase = "failed";
        op.status = "failed";
        op.errorKind = "provider";
        op.componentFailures = [{ component: "background", kind: "provider" }];
        op.finishedAt = "2026-10-09T13:00:01.000Z";
        return { ok: false, kind: "provider" };
      }
      return { ok: true };
    },
  };
  const rejections = [];
  const onRejection = (reason) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    imageGenerator: async () => {
      throw new Error("provider exploded");
    },
  });
  const port = await listen(server);
  try {
    const accepted = await request(port, {
      method: "POST",
      path: "/api/visual/frames/f-hybrid/generate",
      body: {},
    });
    assert.equal(accepted.status, 202);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (op.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(op.status, "failed");
    assert.equal(op.errorKind, "provider");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(rejections.length, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
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
