import assert from "node:assert/strict";
import https from "node:https";
import test from "node:test";
import sharp from "sharp";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { createPrototypeServer } from "../lib/create-server.mjs";
import { generatePrototypeImage } from "../lib/generate.mjs";

const SOURCE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const ANCHOR = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let OUTPUT;
const TOKEN = "CANARY_TOKEN_do_not_log";
const PROMPT = "CANARY_PROMPT_do_not_log";

const originalHttpsRequest = https.request;
let externalCalls = 0;

https.request = function blockedHttpsRequest() {
  externalCalls += 1;
  throw new Error("unexpected external https request");
};

test.before(async () => {
  OUTPUT = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).png().toBuffer();
});

test.after(() => {
  https.request = originalHttpsRequest;
  assert.equal(externalCalls, 0);
});

function dataUrl(bytes, mime = "image/png") {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function env(extra = {}) {
  return {
    BASE_URL: "https://provider.example.test/v1",
    CONTEST_API_TOKEN: TOKEN,
    IMAGE_MODEL: "image-test",
    IMAGE_REFERENCE_STRATEGY: "passthrough",
    IMAGE_TIMEOUT_MS: "1000",
    ...extra,
  };
}

function providerDouble(calls, result) {
  return async (input) => {
    calls.push(input);
    return result;
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function withServer(options, run) {
  const server = createPrototypeServer(options);
  const port = await listen(server);
  try {
    return await run(port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("fixture images are valid and distinct", () => {
  assert.equal(inspectImage(SOURCE).mime, "image/png");
  assert.equal(inspectImage(ANCHOR).mime, "image/png");
  assert.equal(inspectImage(OUTPUT).mime, "image/png");
  assert.equal(SOURCE.equals(ANCHOR), false);
  assert.equal(SOURCE.equals(OUTPUT), false);
  assert.equal(ANCHOR.equals(OUTPUT), false);
});

test("one provider-double call returns provider bytes rather than the source", async () => {
  const calls = [];
  const logs = [];
  const result = await generatePrototypeImage({
    env: env(),
    logger: (entry) => logs.push(entry),
    imageGenerator: providerDouble(calls, {
      ok: true,
      image: { bytes: OUTPUT, mime: "image/png", width: 1, height: 1 },
    }),
    body: {
      operation: "from-source",
      instruction: PROMPT,
      sourceImage: dataUrl(SOURCE),
      anchorImage: null,
      previousImage: null,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images.length, 1);
  assert.equal(calls[0].images[0].bytes.equals(SOURCE), true);
  assert.match(calls[0].prompt, new RegExp(PROMPT));
  assert.match(calls[0].prompt, /Do not return this photograph/);
  assert.equal(result.ok, true);
  assert.equal(result.imageDataUrl, dataUrl(OUTPUT));
  const rendered = JSON.stringify(logs);
  assert.equal(rendered.includes(PROMPT), false);
  assert.equal(rendered.includes(TOKEN), false);
  assert.equal(rendered.includes(SOURCE.toString("base64")), false);
  assert.equal(rendered.includes(OUTPUT.toString("base64")), false);
});

test("refine sends the accepted anchor ahead of an optional source photo", async () => {
  const calls = [];
  const result = await generatePrototypeImage({
    env: env(),
    imageGenerator: providerDouble(calls, {
      ok: true,
      image: { bytes: OUTPUT, mime: "image/png", width: 1, height: 1 },
    }),
    body: {
      operation: "refine",
      instruction: "",
      sourceImage: dataUrl(SOURCE),
      anchorImage: dataUrl(ANCHOR),
      previousImage: null,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images[0].bytes.equals(ANCHOR), true);
  assert.equal(calls[0].images[1].bytes.equals(SOURCE), true);
  assert.match(calls[0].prompt, /Image 1 is the current accepted illustrated anchor/);
  assert.match(calls[0].prompt, /Image 2 is the real source photograph/);
  assert.match(calls[0].prompt, /Create another stylized variant/);
  assert.equal(result.imageDataUrl, dataUrl(OUTPUT));
  assert.notEqual(result.imageDataUrl, dataUrl(SOURCE));
  assert.notEqual(result.imageDataUrl, dataUrl(ANCHOR));
});

test("an echoed source is rejected after the single provider call", async () => {
  const calls = [];
  const result = await generatePrototypeImage({
    env: env(),
    imageGenerator: providerDouble(calls, {
      ok: true,
      image: { bytes: SOURCE, mime: "image/png", width: 1, height: 1 },
    }),
    body: {
      operation: "from-source",
      instruction: PROMPT,
      sourceImage: dataUrl(SOURCE),
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "echoed-source");
  assert.equal(result.imageDataUrl, undefined);
});

test("provider failure and invalid input do not call twice or leak the prompt", async () => {
  const calls = [];
  const logs = [];
  const failed = await generatePrototypeImage({
    env: env(),
    logger: (entry) => logs.push(entry),
    imageGenerator: providerDouble(calls, { ok: false, kind: "timeout", httpStatus: 504 }),
    body: {
      operation: "from-source",
      instruction: PROMPT,
      sourceImage: dataUrl(SOURCE),
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(failed.kind, "timeout");
  assert.equal(JSON.stringify(logs).includes(PROMPT), false);
  assert.equal(JSON.stringify(failed).includes(PROMPT), false);

  const invalid = await generatePrototypeImage({
    env: env(),
    imageGenerator: providerDouble(calls, { ok: true, image: { bytes: OUTPUT, mime: "image/png" } }),
    body: {
      operation: "from-source",
      instruction: PROMPT,
      sourceImage: "data:text/plain;base64,aaaa",
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(invalid.kind, "invalid-request");
});

test("the http endpoint makes one double call and hides provider material", async () => {
  const calls = [];
  const logs = [];
  await withServer({
    env: env(),
    logger: (entry) => logs.push(entry),
    imageGenerator: providerDouble(calls, {
      ok: true,
      image: { bytes: OUTPUT, mime: "image/png", width: 1, height: 1 },
    }),
  }, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "from-source",
        instruction: PROMPT,
        sourceImage: dataUrl(SOURCE),
        anchorImage: null,
        previousImage: null,
      }),
    });
    const text = await response.text();
    const payload = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(payload).sort(), ["imageDataUrl", "mime", "ok"]);
    assert.equal(payload.imageDataUrl, dataUrl(OUTPUT));
    assert.equal(text.includes(PROMPT), false);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(SOURCE.toString("base64")), false);
    assert.equal(JSON.stringify(logs).includes(PROMPT), false);
    assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  });
  assert.equal(calls.length, 1);
});

test("a second request while one is pending does not call the provider", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  await withServer({
    env: env(),
    imageGenerator: async () => {
      calls.push(1);
      await gate;
      return { ok: true, image: { bytes: OUTPUT, mime: "image/png", width: 1, height: 1 } };
    },
  }, async (port) => {
    const body = JSON.stringify({
      operation: "from-source",
      instruction: "",
      sourceImage: dataUrl(SOURCE),
    });
    const first = fetch(`http://127.0.0.1:${port}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body });
    for (let attempt = 0; attempt < 50 && calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = await fetch(`http://127.0.0.1:${port}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).kind, "busy");
    release();
    const finished = await first;
    assert.equal(finished.status, 200);
    assert.equal((await finished.json()).imageDataUrl, dataUrl(OUTPUT));
  });
  assert.equal(calls.length, 1);
});

test("default budgeted reference preparation still performs one offline double call", async () => {
  const calls = [];
  const result = await generatePrototypeImage({
    env: env({ IMAGE_REFERENCE_STRATEGY: undefined }),
    imageGenerator: providerDouble(calls, {
      ok: true,
      image: { bytes: OUTPUT, mime: "image/png", width: 1, height: 1 },
    }),
    body: {
      operation: "refine",
      instruction: "тише",
      anchorImage: dataUrl(SOURCE),
      sourceImage: null,
      previousImage: null,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Image 1 is the current accepted illustrated anchor/);
});

test("endpoint failure preserves a safe error kind", async () => {
  await withServer({
    env: env(),
    imageGenerator: async () => ({ ok: false, kind: "provider", httpStatus: 502, diagnostics: { prompt: PROMPT, token: TOKEN } }),
  }, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "refine",
        instruction: PROMPT,
        anchorImage: dataUrl(SOURCE),
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 502);
    assert.equal(text.includes(PROMPT), false);
    assert.equal(text.includes(TOKEN), false);
    assert.deepEqual(JSON.parse(text), { ok: false, kind: "provider" });
  });
});
