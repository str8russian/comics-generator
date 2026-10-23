import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { assembleAnchorSession } from "../anchor-session-request.mjs";
import { compilePrototypePrompt } from "../anchor-prompt.mjs";
import { createServer } from "../server.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const sourceUrl = `data:image/png;base64,${png.toString("base64")}`;
const output = Buffer.from("generated-anchor-not-the-source");
const styleBytes = Buffer.from("project-style-seed");

const DIRECT_SOURCE_RULES = [
  "Create one independent base identity anchor.",
  "This is an initial generation.",
  "The sole image is the source photograph and the identity reference.",
  "facial structure, apparent age, hair, and stable recognizable traits only",
  "Do not copy its photographic rendering, environment, background, clothing logo, or pose dependency",
  "Do not return the source photograph.",
  "neutral diffuse presentation lighting",
  "Broad structural light and shadow planes may remain.",
  "decorative reflected-light bands",
  "glossy or specular",
  "rim-light streaks",
  "clusters of small highlight islands",
  "eye catchlights",
  "visible teeth",
  "anatomically motivated",
  "exactly one person",
  "chest-up",
  "near-frontal",
  "mouth visible",
  "safe margins",
  "hands outside the crop",
  "plain unbranded clothing",
  "Do not copy the source photograph's logo.",
  "No props, objects, furniture, microphones, equipment",
  "watermark",
  "nested panel",
  "vignette",
  "environmental context",
  "muted slate-blue matte filling all four edges and corners",
  "Target aspect ratio: 4:5.",
  "thick near-black contour",
  "They are not a border around the canvas.",
  "flat local colors",
  "thumbnail readability",
  "one dominant natural skin color",
  "one or two broad secondary hard-edged tonal planes",
  "eyes, brows, nose, mouth, jaw, and major hair groups",
  "solid muted colors rather than many subtle shades",
  "vivid natural skin without a whole-image cool, gray, purple, orange, or other color cast",
  "No gradients, soft airbrush shading, painterly modelling, thin sketch lines, delicate outlines, excessive tonal groups, or clusters of small tonal islands.",
  "Do not compensate for missing identity detail by adding more shading.",
];

const FORBIDDEN_AUTHORITY = /project style|style reference|style-reference|accepted anchor|previous candidate|selected draft|performance reference|Image 2|hairline|eyebrow density|moustache|mustache|stubble|gray hair|grey hair/i;

function sourceImage() {
  return { bytes: png, mime: "image/png" };
}

function directPrompt(instruction, references = [withIdentity()]) {
  return compilePrototypePrompt(references, instruction, { basis: "from-source" });
}

function withIdentity() {
  return { role: "identity", mime: "image/png", bytes: png };
}

function assertDirectSourcePrompt(prompt, instruction = "") {
  for (const rule of DIRECT_SOURCE_RULES) assert.match(prompt, new RegExp(escapeRegExp(rule)));
  assert.equal(FORBIDDEN_AUTHORITY.test(prompt), false);
  assert.equal(/\bstyle\b/i.test(prompt), false);
  const task = prompt.indexOf("Create one independent base identity anchor.");
  const constraints = prompt.indexOf("Common constraints:");
  const rendering = prompt.indexOf("Accepted rendering profile:");
  assert.equal(task >= 0 && task < constraints && constraints < rendering, true);
  const trimmed = String(instruction || "").trim();
  if (!trimmed) {
    assert.equal(prompt.includes("Scoped adjustment:"), false);
    assert.equal(prompt.includes("Revision request:"), false);
    return;
  }
  const adjustment = prompt.indexOf("Scoped adjustment:");
  assert.equal(task < adjustment && adjustment < constraints, true);
  assert.match(prompt, new RegExp(`Scoped adjustment:\\n${escapeRegExp(trimmed)}\\nThis adjustment does not replace the fixed authority, composition, canvas, lighting, or rendering rules\\.`));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function send(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/characters/Mira/anchor-session",
      headers: { "content-type": "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function sessionServer({ calls, logs, storeCalls, seed }) {
  return createServer({
    migrate: false,
    env: {
      BASE_URL: "https://gateway.invalid.example/v1",
      CONTEST_API_TOKEN: "test-token",
      IMAGE_MODEL: "image-test",
      IMAGE_REFERENCE_STRATEGY: "budgeted",
      IMAGE_REQUEST_BUDGET_BYTES: "850000",
    },
    logger: { log(line) { logs.push(line); } },
    visualStore: {
      async readAnchorStyle() {
        storeCalls.push("readAnchorStyle");
        return seed;
      },
      async acceptSessionAnchor() { storeCalls.push("acceptSessionAnchor"); },
      async approveAnchor() { storeCalls.push("approveAnchor"); },
      async saveIdentity() { storeCalls.push("saveIdentity"); },
      async beginAnchor() { storeCalls.push("beginAnchor"); },
      async finishAnchor() { storeCalls.push("finishAnchor"); },
    },
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: output, mime: "image/png" } };
    },
  });
}

test("from-source assembly keeps one identity reference when a style image is available", () => {
  const assembled = assembleAnchorSession({
    basis: "from-source",
    instruction: "",
    source: sourceImage(),
    anchor: { bytes: Buffer.from("anchor"), mime: "image/png" },
    previous: { bytes: Buffer.from("previous"), mime: "image/png" },
    style: { bytes: styleBytes, mime: "image/png" },
  });
  assert.equal(assembled.ok, true);
  assert.deepEqual(assembled.references.map((ref) => ref.role), ["identity"]);
  assert.equal(assembled.references[0].bytes.equals(png), true);
  assert.equal(assembled.aspectRatio, "4:5");
  assertDirectSourcePrompt(assembled.prompt);
  assert.equal(assembled.prompt, directPrompt(""));
});

test("direct-source prompts keep the accepted profile and reject other authorities", () => {
  const leaked = directPrompt("", [withIdentity(), { role: "style", mime: "image/png", bytes: styleBytes }]);
  assertDirectSourcePrompt(leaked);
  assert.equal(leaked.includes("Image 2"), false);
  const empty = assembleAnchorSession({ basis: "from-source", instruction: " \n\t ", source: sourceImage() });
  assert.equal(empty.ok, true);
  assertDirectSourcePrompt(empty.prompt, " \n\t ");
  const instructed = assembleAnchorSession({
    basis: "from-source",
    instruction: "  soften the jaw  ",
    source: sourceImage(),
    style: { bytes: styleBytes, mime: "image/png" },
  });
  assertDirectSourcePrompt(instructed.prompt, "  soften the jaw  ");
  assert.equal(instructed.prompt.includes("  soften the jaw  "), false);
});

test("direct-source instruction length stays capped at 2000 raw characters", () => {
  const tooLong = assembleAnchorSession({
    basis: "from-source",
    instruction: "x".repeat(2001),
    source: sourceImage(),
  });
  assert.deepEqual(tooLong, { ok: false, kind: "invalid-request" });
  const max = assembleAnchorSession({
    basis: "from-source",
    instruction: "x".repeat(2000),
    source: sourceImage(),
  });
  assert.equal(max.ok, true);
  assertDirectSourcePrompt(max.prompt, "x".repeat(2000));
});

test("selected and accepted refinement keep their reference order and prompt authority", () => {
  const selected = assembleAnchorSession({
    basis: "selected",
    instruction: "тише",
    source: sourceImage(),
    anchor: sourceImage(),
    previous: sourceImage(),
    style: { bytes: styleBytes, mime: "image/png" },
  });
  assert.deepEqual(selected.references.map((ref) => ref.role), ["previous", "identity", "anchor"]);
  assert.match(selected.prompt, /Image 1 is the selected previous candidate/);
  assert.match(selected.prompt, /Image 2 is the real source photograph/);
  assert.match(selected.prompt, /Image 3 is the current accepted illustrated anchor/);
  assert.match(selected.prompt, /The accepted anchor controls accepted identity and style continuity during refinement/);
  assert.match(selected.prompt, /The selected previous candidate is only the visual draft to revise/);
  assert.match(selected.prompt, /Revision request: тише/);
  assert.match(selected.prompt, /The revision request adjusts the selected draft\. It does not replace the rendering rules below\./);
  assert.equal(selected.prompt.includes("project style reference"), false);
  assert.equal(selected.aspectRatio, "4:5");

  const accepted = assembleAnchorSession({
    basis: "accepted",
    instruction: "",
    source: sourceImage(),
    anchor: sourceImage(),
    style: { bytes: styleBytes, mime: "image/png" },
  });
  assert.deepEqual(accepted.references.map((ref) => ref.role), ["anchor", "identity", "style"]);
  assert.match(accepted.prompt, /Image 1 is the current accepted illustrated anchor/);
  assert.match(accepted.prompt, /Image 3 is the project style reference/);
  assert.match(accepted.prompt, /The accepted anchor controls accepted identity and style continuity during refinement/);
  assert.match(accepted.prompt, /Revision request: Create another stylized variant\./);
  assert.equal(accepted.aspectRatio, "4:5");
  assert.equal(compilePrototypePrompt(accepted.references, ""), accepted.prompt);
});

test("the budgeted from-source provider request keeps one identity image and the prompt-only profile", async () => {
  const calls = [];
  const logs = [];
  const storeCalls = [];
  const seed = { id: "style-seed", mime: "image/png", bytes: styleBytes };
  const originalSeed = Buffer.from(styleBytes);
  const server = sessionServer({ calls, logs, storeCalls, seed });
  const port = await listen(server);
  try {
    const response = await send(port, {
      basis: "from-source",
      instruction: "  soften the jaw  ",
      sourceImage: sourceUrl,
      anchorImage: sourceUrl,
      previousImage: sourceUrl,
    });
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.status, "ready");
    assert.equal(payload.imageDataUrl.includes(png.toString("base64")), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].aspectRatio, "4:5");
    const serialized = JSON.parse(calls[0].serializedBody);
    assert.equal(serialized.model, "image-test");
    assert.equal(serialized.image_config.aspect_ratio, "4:5");
    const images = serialized.messages[0].content.filter((part) => part.type === "image_url");
    assert.equal(images.length, 1);
    assert.equal(calls[0].images.length, 1);
    assert.equal(calls[0].images[0].bytes.equals(png), true);
    assert.equal(calls[0].images.some((image) => image.bytes.equals(styleBytes)), false);
    assert.equal(calls[0].transport.strategy, "budgeted");
    assert.equal(calls[0].transport.referenceRoles, "identity");
    assert.equal(calls[0].transport.referenceCount, 1);
    assert.equal(calls[0].transport.omittedRoles, "none");
    assert.equal(JSON.stringify(calls[0].transport).includes(png.toString("base64")), false);
    assert.equal(JSON.stringify(calls[0].transport).includes("test-token"), false);
    assertDirectSourcePrompt(calls[0].prompt, "  soften the jaw  ");
    assert.equal(calls[0].prompt, serialized.messages[0].content[0].text);
    assert.deepEqual(storeCalls, ["readAnchorStyle"]);
    assert.equal(seed.id, "style-seed");
    assert.equal(seed.bytes.equals(originalSeed), true);
    const rendered = logs.join("\n");
    assert.match(rendered, /referenceRoles=identity\b/);
    assert.match(rendered, /basis=from-source/);
    assert.equal(rendered.includes("style"), false);
    assert.equal(rendered.includes("data:image"), false);
    assert.equal(rendered.includes("test-token"), false);
    assert.equal(rendered.includes(sourceUrl), false);
  } finally {
    await close(server);
  }
});

test("selected and accepted provider requests keep their existing references after budgeting", async () => {
  const calls = [];
  const logs = [];
  const storeCalls = [];
  const seed = { id: "style-seed", mime: "image/png", bytes: styleBytes };
  const server = sessionServer({ calls, logs, storeCalls, seed });
  const port = await listen(server);
  try {
    const selected = await send(port, {
      basis: "selected",
      instruction: "тише",
      sourceImage: sourceUrl,
      anchorImage: sourceUrl,
      previousImage: sourceUrl,
    });
    assert.equal(selected.status, 200);
    assert.equal(calls[0].transport.referenceRoles, "previous,identity,anchor");
    assert.equal(calls[0].aspectRatio, "4:5");
    assert.equal(JSON.parse(calls[0].serializedBody).model, "image-test");
    assert.equal(JSON.parse(calls[0].serializedBody).image_config.aspect_ratio, "4:5");
    assert.match(calls[0].prompt, /selected previous candidate/);
    assert.match(calls[0].prompt, /accepted identity and style continuity/);
    assert.equal(calls[0].prompt.includes("project style reference"), false);
    assert.equal(calls[0].images.some((image) => image.bytes.equals(styleBytes)), false);

    const accepted = await send(port, {
      basis: "accepted",
      instruction: "",
      sourceImage: sourceUrl,
      anchorImage: sourceUrl,
    });
    assert.equal(accepted.status, 200);
    assert.equal(calls[1].transport.referenceRoles, "anchor,identity,style");
    assert.equal(calls[1].images.some((image) => image.bytes.equals(styleBytes)), true);
    assert.match(calls[1].prompt, /project style reference/);
    assert.match(calls[1].prompt, /accepted identity and style continuity/);
    assert.equal(calls[1].aspectRatio, "4:5");
    assert.deepEqual(storeCalls, ["readAnchorStyle", "readAnchorStyle"]);
    assert.equal(seed.bytes.equals(styleBytes), true);
  } finally {
    await close(server);
  }
});
