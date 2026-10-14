import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { buildImageRequest, generateImage } from "../image-provider.mjs";
import {
  DEFAULT_REFERENCE_STRATEGY,
  DEFAULT_REQUEST_BUDGET_BYTES,
  IMAGE_ENCODING,
  LONG_EDGE_LADDER,
  executeImageRequest,
  loadImageReferenceConfig,
  prepareImageRequest,
  serializeImageRequest,
} from "../image-reference-strategy.mjs";
import { createServer } from "../server.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reference(role, bytes = png, width = 1, height = 1) {
  return { role, assetId: `${role}-asset`, mime: "image/png", bytes, width, height };
}

function compilePrompt(references) {
  return references.map((ref, index) => `Image ${index + 1} ${ref.role}`).join("\n");
}

function bodySize(references, prompt = compilePrompt(references)) {
  return Buffer.byteLength(serializeImageRequest({
    prompt,
    references,
    aspectRatio: "5:4",
    model: "image-test",
  }));
}

test("image reference transport defaults to budgeted and 850000 bytes", () => {
  const config = loadImageReferenceConfig({});
  assert.equal(config.ok, true);
  assert.equal(config.strategy, DEFAULT_REFERENCE_STRATEGY);
  assert.equal(config.strategy, "budgeted");
  assert.equal(config.budgetBytes, DEFAULT_REQUEST_BUDGET_BYTES);
  assert.equal(config.budgetBytes, 850000);
  assert.deepEqual(LONG_EDGE_LADDER, [1024, 896, 768, 640, 600, 512, 448]);
  assert.equal(IMAGE_ENCODING.jpeg.quality, 80);
  assert.equal(IMAGE_ENCODING.webp.quality, 80);
  assert.equal(IMAGE_ENCODING.png.compressionLevel, 9);
});

test("explicit passthrough selection is preserved", () => {
  const config = loadImageReferenceConfig({ IMAGE_REFERENCE_STRATEGY: "passthrough" });
  assert.equal(config.ok, true);
  assert.equal(config.strategy, "passthrough");
});

test("unknown strategy and invalid byte budget fail before provider I/O", async () => {
  assert.equal(loadImageReferenceConfig({ IMAGE_REFERENCE_STRATEGY: "shrink" }).ok, false);
  assert.equal(loadImageReferenceConfig({ IMAGE_REQUEST_BUDGET_BYTES: "0" }).ok, false);
  assert.equal(loadImageReferenceConfig({ IMAGE_REQUEST_BUDGET_BYTES: "nope" }).ok, false);
  assert.equal(loadImageReferenceConfig({ IMAGE_REQUEST_BUDGET_BYTES: "1.5" }).ok, false);
  let calls = 0;
  const unknown = await executeImageRequest({
    strategy: "shrink",
    budgetBytes: 850000,
    references: [reference("anchor")],
    generationMode: "initial",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    imageGenerator: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  const budget = await executeImageRequest({
    strategy: "budgeted",
    budgetBytes: 0,
    references: [reference("anchor")],
    generationMode: "initial",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    imageGenerator: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(unknown.kind, "configuration");
  assert.equal(budget.kind, "configuration");
  assert.equal(calls, 0);
});

test("passthrough reproduces the legacy serialized body and hash without transforming", async () => {
  const references = [reference("anchor"), reference("style"), reference("current")];
  const prompt = compilePrompt(references);
  const legacy = JSON.stringify(buildImageRequest({
    prompt,
    images: references.map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
    aspectRatio: "5:4",
    model: "image-test",
  }));
  let transcodes = 0;
  const prepared = await prepareImageRequest({
    strategy: "passthrough",
    budgetBytes: 10,
    references,
    generationMode: "revision",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    transcode: async () => {
      transcodes += 1;
      throw new Error("passthrough must not transform");
    },
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.serializedBody, legacy);
  assert.equal(prepared.requestSha256, sha256(legacy));
  assert.equal(prepared.finalBodyBytes, Buffer.byteLength(legacy));
  assert.equal(prepared.finalBodyBytes > 10, true);
  assert.deepEqual(prepared.omittedRoles, []);
  assert.deepEqual(prepared.transforms, []);
  assert.equal(prepared.references[0].bytes, references[0].bytes);
  assert.equal(transcodes, 0);
});

test("budgeted keeps original bytes when the measured body already fits", async () => {
  const source = Buffer.from(png);
  const input = reference("anchor", source, 1, 1);
  let transcodes = 0;
  const prepared = await prepareImageRequest({
    strategy: "budgeted",
    budgetBytes: 850000,
    references: [input],
    generationMode: "initial",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    transcode: async () => {
      transcodes += 1;
      return null;
    },
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.finalBodyBytes <= 850000, true);
  assert.equal(prepared.finalBodyBytes, prepared.originalBodyBytes);
  assert.equal(prepared.references[0].bytes, source);
  assert.deepEqual(prepared.transforms, []);
  assert.equal(transcodes, 0);
  assert.equal(input.bytes, source);
});

test("budgeted transforms only transient copies and sends the measured body", async () => {
  const source = await sharp({
    create: { width: 1400, height: 700, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).png({ compressionLevel: 0 }).toBuffer();
  const before = Buffer.from(source);
  const input = reference("anchor", source, 1400, 700);
  const originalBody = bodySize([input]);
  const prepared = await prepareImageRequest({
    strategy: "budgeted",
    budgetBytes: originalBody - 1,
    references: [input],
    generationMode: "initial",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
  });
  assert.equal(prepared.ok, true);
  assert.equal(Buffer.byteLength(prepared.serializedBody), prepared.finalBodyBytes);
  assert.equal(prepared.finalBodyBytes <= originalBody - 1, true);
  assert.equal(prepared.references[0].mime, "image/png");
  assert.equal(prepared.references[0].bytes.equals(source), false);
  assert.equal(prepared.references[0].bytes === source, false);
  const longEdge = Math.max(prepared.references[0].width, prepared.references[0].height);
  assert.equal(LONG_EDGE_LADDER.includes(longEdge), true);
  assert.equal(longEdge < 1400, true);
  assert.ok(Math.abs((prepared.references[0].width / prepared.references[0].height) - 2) < 0.05);
  assert.deepEqual(source, before);
  assert.equal(input.bytes, source);
  let sent = null;
  const generated = await generateImage({
    prompt: prepared.prompt,
    images: prepared.references.map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
    aspectRatio: "5:4",
    serializedBody: prepared.serializedBody,
    env: {
      BASE_URL: "https://gateway.invalid.example/v1",
      CONTEST_API_TOKEN: "token",
      IMAGE_MODEL: "image-test",
      IMAGE_TIMEOUT_MS: "1000",
    },
    fetchImpl: async (_url, init) => {
      sent = init.body;
      return new Response(JSON.stringify({
        choices: [{ message: { content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(generated.ok, true);
  assert.equal(sent, prepared.serializedBody);
});

test("jpeg and webp inputs stay in their own formats while being reduced", async () => {
  async function reduced(mime, encode) {
    const bytes = await encode(sharp({
      create: { width: 1300, height: 650, channels: 3, background: { r: 9, g: 8, b: 7 } },
    }));
    const prepared = await prepareImageRequest({
      strategy: "budgeted",
      budgetBytes: 1,
      references: [{ role: "anchor", assetId: "a", mime, bytes, width: 1300, height: 650 }],
      generationMode: "initial",
      compilePrompt,
      aspectRatio: "4:5",
      model: "image-test",
    });
    return prepared;
  }
  const jpeg = await reduced("image/jpeg", (pipeline) => pipeline.jpeg({ quality: 95 }).toBuffer());
  const webp = await reduced("image/webp", (pipeline) => pipeline.webp({ quality: 95 }).toBuffer());
  assert.equal(jpeg.ok, false);
  assert.equal(webp.ok, false);
  assert.equal(Math.max(jpeg.references[0].width, jpeg.references[0].height) < 1300, true);
  assert.equal(Math.max(webp.references[0].width, webp.references[0].height) < 1300, true);
  assert.equal(jpeg.references[0].mime, "image/jpeg");
  assert.equal(webp.references[0].mime, "image/webp");
  assert.equal(jpeg.references[0].bytes[0], 0xff);
  assert.equal(jpeg.references[0].bytes[1], 0xd8);
  assert.equal(webp.references[0].bytes.subarray(0, 4).toString("ascii"), "RIFF");
});

test("revision prompt agrees with the remaining role order after style omission", async () => {
  const references = [
    reference("anchor", Buffer.alloc(300, 1), 900, 700),
    reference("style", Buffer.alloc(300, 2), 900, 700),
    reference("current", Buffer.alloc(300, 3), 900, 700),
  ];
  const reduced = [references[0], references[2]];
  const budget = bodySize(reduced);
  const prepared = await prepareImageRequest({
    strategy: "budgeted",
    budgetBytes: budget,
    references,
    generationMode: "revision",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    transcode: async () => null,
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.references.map((ref) => ref.role), ["anchor", "current"]);
  assert.equal(prepared.prompt, "Image 1 anchor\nImage 2 current");
  assert.equal(prepared.prompt.includes("style"), false);
  assert.deepEqual(prepared.omittedRoles, ["style"]);
  assert.equal(prepared.finalBodyBytes <= budget, true);
  assert.equal(prepared.serializedBody.includes("Image 2 current"), true);
  assert.equal(prepared.serializedBody.includes("style"), false);
});

test("initial anchor plus style keeps both authorities", async () => {
  const references = [reference("anchor", Buffer.alloc(400, 4), 900, 700), reference("style", Buffer.alloc(400, 5), 900, 700)];
  let calls = 0;
  const result = await executeImageRequest({
    strategy: "budgeted",
    budgetBytes: bodySize(references) - 1,
    references,
    generationMode: "initial",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    transcode: async () => null,
    imageGenerator: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(result.kind, "reference-payload-too-large");
  assert.equal(result.diagnostics.omittedRoles, "none");
  assert.equal(result.diagnostics.originalRoles, "anchor,style");
  assert.equal(calls, 0);
});

test("performance generation does not drop anchor or performance", async () => {
  const references = [
    reference("anchor", Buffer.alloc(300, 6), 900, 700),
    reference("performance", Buffer.alloc(300, 7), 900, 700),
    reference("style", Buffer.alloc(300, 8), 900, 700),
  ];
  const withoutStyle = bodySize([references[0], references[1]]);
  let calls = 0;
  const result = await executeImageRequest({
    strategy: "budgeted",
    budgetBytes: withoutStyle,
    references,
    generationMode: "performance",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    transcode: async () => null,
    imageGenerator: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(result.kind, "reference-payload-too-large");
  assert.equal(result.diagnostics.omittedRoles, "none");
  assert.match(result.diagnostics.originalRoles, /anchor/);
  assert.match(result.diagnostics.originalRoles, /performance/);
  assert.equal(calls, 0);
});

test("exhausting the transform ladder returns reference-payload-too-large with zero provider calls", async () => {
  let calls = 0;
  const result = await executeImageRequest({
    strategy: "budgeted",
    budgetBytes: 1,
    references: [reference("anchor"), reference("style")],
    generationMode: "initial",
    compilePrompt,
    aspectRatio: "5:4",
    model: "image-test",
    transcode: async () => null,
    imageGenerator: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "reference-payload-too-large");
  assert.equal(result.httpStatus, 422);
  assert.equal(calls, 0);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function request(port, { method = "POST", path, body }) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body ?? {}));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: { "content-type": "application/json", "content-length": bytes.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.end(bytes);
  });
}

function transportServer({ env, calls, logs, mode = "storyboard" }) {
  const frame = mode === "manual"
    ? {
      id: "f-manual",
      layout: "single",
      frameKind: "image",
      panels: [{ id: "panel-manual", description: "назначенное изображение", subject: "Аня", manualSubject: "Аня" }],
    }
    : {
      id: "f-story",
      layout: "single",
      panels: [{ id: "panel-story", description: "спокойный портрет", subject: "Аня" }],
    };
  const store = {
    load: async () => ({
      ok: true,
      status: "ready",
      frames: [frame],
      characters: [{ name: "Аня", approvedAnchorId: "anchor-1" }],
      styleSeedAssetId: "style-1",
    }),
    beginAnchor: async () => ({
      ok: true,
      id: "anchor-gen",
      identityComment: "",
      instruction: "CANARY-PROMPT-991",
      identity: { id: "identity", mime: "image/png", bytes: png, width: 1, height: 1 },
      previous: null,
      style: { id: "style", mime: "image/png", bytes: png, width: 1, height: 1 },
    }),
    finishAnchor: async ({ result }) => (
      result?.ok
        ? { ok: true }
        : { ok: false, status: "failed", kind: result?.kind || "provider", httpStatus: result?.httpStatus || 502 }
    ),
    beginPanelGeneration: async () => ({
      ok: true,
      id: "panel-gen",
      frame,
      panel: frame.panels[0],
      subject: "Аня",
      instruction: "CANARY-PROMPT-991",
      storyboardVersionId: "sv-1",
      refs: {
        anchor: { id: "anchor", mime: "image/png", bytes: png, width: 1, height: 1 },
        previous: mode === "storyboard" ? { id: "previous", mime: "image/png", bytes: png, width: 1, height: 1 } : null,
        performance: null,
        style: { id: "style", mime: "image/png", bytes: png, width: 1, height: 1 },
      },
    }),
    finishPanelGeneration: async ({ result }) => (
      result?.ok
        ? { ok: true }
        : { ok: false, status: "failed", kind: result?.kind || "provider", httpStatus: result?.httpStatus || 502 }
    ),
  };
  return createServer({
    migrate: false,
    projectStore: {},
    visualStore: store,
    env,
    logger: { log: (line) => logs.push(String(line)) },
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: png, mime: "image/png", width: 1, height: 1 }, metadata: { model: "image-test" } };
    },
  });
}

test("storyboard and manually assigned panels share one strategy boundary", async () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/deliverPreparedImage\(/g).length, 3);
  assert.equal(source.includes("imageGenerator({"), false);
  const calls = [];
  const logs = [];
  const env = {
    IMAGE_REFERENCE_STRATEGY: "budgeted",
    IMAGE_MODEL: "image-test",
    BASE_URL: "https://gateway.invalid.example/v1",
    CONTEST_API_TOKEN: "super-secret-token",
  };
  const server = transportServer({ env, calls, logs, mode: "storyboard" });
  const port = await listen(server);
  try {
    const storyboard = await request(port, { path: "/api/visual/frames/f-story/panels/0/generate", body: { instruction: "CANARY-PROMPT-991" } });
    assert.equal(storyboard.status, 200);
    const manualServer = transportServer({ env, calls, logs, mode: "manual" });
    const manualPort = await listen(manualServer);
    try {
      const manual = await request(manualPort, { path: "/api/visual/frames/f-manual/panels/0/generate", body: { instruction: "CANARY-PROMPT-991" } });
      assert.equal(manual.status, 200);
    } finally {
      await close(manualServer);
    }
    const anchor = await request(port, {
      path: `/api/visual/characters/${encodeURIComponent("Аня")}/anchor`,
      body: { instruction: "CANARY-PROMPT-991" },
    });
    assert.equal(anchor.status, 200);
  } finally {
    await close(server);
  }
  assert.equal(calls.length, 3);
  assert.match(calls[0].prompt, /scene-specific storyboard panel/);
  assert.match(calls[1].prompt, /panel-ready character image/);
  assert.match(calls[2].prompt, /base identity anchor/);
  for (const input of calls) {
    assert.equal(input.transport.strategy, "budgeted");
    assert.equal(input.serializedBody, JSON.stringify(buildImageRequest({
      prompt: input.prompt,
      images: input.images,
      aspectRatio: input.aspectRatio,
      model: "image-test",
    })));
    assert.equal(Buffer.byteLength(input.serializedBody) <= 850000, true);
  }
  const rendered = logs.join("\n");
  assert.match(rendered, /strategy=budgeted/);
  assert.match(rendered, /originalBodyBytes=\d+/);
  assert.match(rendered, /finalBodyBytes=\d+/);
  assert.match(rendered, /requestSha256=[0-9a-f]{64}/);
  assert.equal(rendered.includes("CANARY-PROMPT-991"), false);
  assert.equal(rendered.includes("super-secret-token"), false);
  assert.equal(rendered.includes("gateway.invalid.example"), false);
  assert.equal(rendered.includes("data:image"), false);
  assert.equal(rendered.includes(png.toString("base64")), false);
});

test("invalid transport configuration fails before provider I/O", async () => {
  const calls = [];
  const logs = [];
  const server = transportServer({
    env: { IMAGE_REFERENCE_STRATEGY: "shrink", IMAGE_REQUEST_BUDGET_BYTES: "850000" },
    calls,
    logs,
  });
  const port = await listen(server);
  try {
    const response = await request(port, { path: "/api/visual/frames/f-story/panels/0/generate", body: {} });
    assert.equal(response.status, 500);
    assert.equal(response.body.kind, "configuration");
    assert.equal(calls.length, 0);
  } finally {
    await close(server);
  }
  const invalidBudget = transportServer({
    env: { IMAGE_REFERENCE_STRATEGY: "budgeted", IMAGE_REQUEST_BUDGET_BYTES: "-5" },
    calls,
    logs,
  });
  const budgetPort = await listen(invalidBudget);
  try {
    const response = await request(budgetPort, { path: "/api/visual/frames/f-story/panels/0/generate", body: {} });
    assert.equal(response.status, 500);
    assert.equal(response.body.kind, "configuration");
    assert.equal(calls.length, 0);
  } finally {
    await close(invalidBudget);
  }
});
