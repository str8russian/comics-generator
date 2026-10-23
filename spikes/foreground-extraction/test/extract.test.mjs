import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import sharp from "sharp";
import { EXTRACTION_CONFIG } from "../config.mjs";
import { extractForeground, interiorHoleArea } from "../extract.mjs";
import { assertRelativeResourcePath, containedPath } from "../manifest.mjs";
import { allocateRunDirectory } from "../run.mjs";
import { buildOwnerReviewExport, OWNER_REVIEW_SCHEMA } from "../review.mjs";

const MATTE = [90, 110, 134];
const BLACK = [0, 0, 0];
const SKIN = [214, 156, 122];
const SHIRT = [20, 24, 40];

function blank(width, height, color, channels = 3) {
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < data.length; i += channels) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    if (channels === 4) data[i + 3] = 255;
  }
  return { width, height, channels, data };
}

function paint(image, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = (y * image.width + x) * image.channels;
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
    }
  }
}

function pixel(image, x, y) {
  return (y * image.width + x) * image.channels;
}

function rgbaAt(result, x, y) {
  const index = (y * result.metrics.width + x) * 4;
  return [result.rgba[index], result.rgba[index + 1], result.rgba[index + 2], result.rgba[index + 3]];
}

function silhouette(image) {
  paint(image, 16, 70, 80, 108, BLACK);
  paint(image, 19, 73, 77, 105, SKIN);
  paint(image, 34, 18, 62, 74, BLACK);
  paint(image, 37, 21, 59, 71, SKIN);
}

function portrait() {
  const image = blank(96, 120, MATTE);
  silhouette(image);
  return image;
}

function composite(rgba, index, background) {
  const alpha = rgba[index + 3] / 255;
  return [0, 1, 2].map((channel) => Math.round(rgba[index + channel] * alpha + background[channel] * (1 - alpha)));
}

test("closed matte and near-black contour become straight-alpha foreground", () => {
  const image = portrait();
  const result = extractForeground(image);
  assert.equal(result.status, "candidate-pass", result.reasons.join(","));
  assert.deepEqual(rgbaAt(result, 4, 4), [0, 0, 0, 0]);
  assert.deepEqual(rgbaAt(result, 48, 18), [0, 0, 0, 255]);
  assert.deepEqual(rgbaAt(result, 48, 40).slice(0, 3), SKIN);
  assert.equal(rgbaAt(result, 48, 40)[3], 255);
  for (let index = 0; index < result.rgba.length; index += 4) {
    const alpha = result.rgba[index + 3];
    assert.ok(alpha === 0 || alpha === 255);
    const mixed = composite(result.rgba, index, [255, 0, 255]);
    if (alpha === 0) assert.deepEqual(mixed, [255, 0, 255]);
  }
});

test("antialiased edge stores straight foreground color instead of matte rgb", () => {
  const image = portrait();
  paint(image, 48, 17, 48, 17, [45, 55, 67]);
  const result = extractForeground(image);
  const sample = rgbaAt(result, 48, 17);
  assert.ok(sample[3] > 80 && sample[3] < 190, `alpha ${sample[3]}`);
  assert.ok(sample[0] < 25 && sample[1] < 25 && sample[2] < 25);
  const mixed = composite(result.rgba, (17 * image.width + 48) * 4, [255, 0, 255]);
  assert.ok(mixed[1] < 15, `green channel ${mixed[1]}`);
  assert.ok(mixed[0] > 80);
});

test("subject contact with the bottom and left stays foreground", () => {
  const image = blank(80, 100, MATTE);
  paint(image, 0, 36, 48, 99, SHIRT);
  paint(image, 0, 36, 48, 39, BLACK);
  paint(image, 46, 36, 48, 99, BLACK);
  const result = extractForeground(image);
  assert.equal(result.status, "candidate-pass");
  assert.equal(result.reasons.includes("canvas-edge-contact"), false);
  assert.ok(result.warnings.includes("canvas-edge-contact"));
  assert.equal(rgbaAt(result, 0, 50)[3], 255);
  assert.deepEqual(rgbaAt(result, 0, 50).slice(0, 3), SHIRT);
  assert.equal(rgbaAt(result, 10, 99)[3], 255);
  assert.equal(rgbaAt(result, 70, 8)[3], 0);
  const contacts = result.metrics.edgeContacts.filter((edge) => edge.totalPixels > 0).map((edge) => edge.edge);
  assert.ok(contacts.includes("bottom"));
  assert.ok(contacts.includes("left"));
});

test("matte-colored foreground inside the contour is not removed", () => {
  const image = portrait();
  paint(image, 42, 40, 52, 52, MATTE);
  const result = extractForeground(image);
  assert.equal(result.status, "candidate-pass", result.reasons.join(","));
  assert.equal(rgbaAt(result, 47, 46)[3], 255);
  assert.ok(result.warnings.includes("matte-colored-foreground-risk"));
  assert.equal(result.reasons.includes("destructive-interior-hole"), false);
});

test("a strongly bounded enclosed pocket is cleared without a destructive hole", () => {
  const image = portrait();
  paint(image, 20, 86, 32, 104, BLACK);
  paint(image, 23, 89, 29, 100, MATTE);
  const result = extractForeground(image);
  assert.equal(result.status, "candidate-pass", result.reasons.join(","));
  assert.equal(rgbaAt(result, 26, 94)[3], 0);
  assert.deepEqual(rgbaAt(result, 26, 94), [0, 0, 0, 0]);
  assert.equal(rgbaAt(result, 21, 88)[3], 255);
  assert.ok(result.warnings.includes("enclosed-pocket-cleared"));
  assert.equal(result.reasons.includes("destructive-interior-hole"), false);
});

test("an ambiguous enclosed pocket stays opaque and is not a candidate pass", () => {
  const image = portrait();
  paint(image, 40, 21, 56, 28, MATTE);
  const result = extractForeground(image);
  assert.equal(result.status, "review", result.reasons.join(","));
  assert.ok(result.reasons.includes("ambiguous-enclosed-pocket"));
  assert.equal(rgbaAt(result, 48, 22)[3], 255);
});

test("a one-pixel contour gap rejects leak risk and a wide opening does not", () => {
  const narrow = blank(96, 120, MATTE);
  paint(narrow, 20, 18, 76, 98, BLACK);
  paint(narrow, 24, 22, 72, 94, MATTE);
  for (let y = 18; y <= 22; y += 1) paint(narrow, 48, y, 48, y, MATTE);
  const leaked = extractForeground(narrow);
  assert.equal(leaked.status, "reject");
  assert.ok(leaked.reasons.includes("contour-gap-leak-risk"));

  const wide = blank(96, 120, MATTE);
  paint(wide, 20, 18, 76, 98, BLACK);
  paint(wide, 24, 22, 72, 94, MATTE);
  for (let y = 18; y <= 22; y += 1) paint(wide, 40, y, 54, y, MATTE);
  const opened = extractForeground(wide);
  assert.equal(opened.reasons.includes("contour-gap-leak-risk"), false);
});

test("non-uniform and scenic borders are rejected", () => {
  const split = blank(96, 80, [30, 120, 50]);
  paint(split, 48, 0, 95, 79, [190, 40, 40]);
  const nonUniform = extractForeground(split);
  assert.equal(nonUniform.status, "reject");
  assert.ok(
    nonUniform.reasons.includes("non-uniform-matte") || nonUniform.reasons.includes("insufficient-matte-border-support"),
    nonUniform.reasons.join(","),
  );

  const scenic = blank(96, 80, [0, 0, 0]);
  for (let y = 0; y < scenic.height; y += 1) {
    for (let x = 0; x < scenic.width; x += 1) {
      paint(scenic, x, y, x, y, [(x * 17 + y * 3) % 256, (y * 29) % 256, (x * 13) % 256]);
    }
  }
  const rejected = extractForeground(scenic);
  assert.equal(rejected.status, "reject");
  assert.ok(rejected.reasons.includes("insufficient-matte-border-support") || rejected.reasons.includes("non-uniform-matte"));
});

test("an inset frame is rejected instead of becoming a candidate pass", () => {
  const image = blank(120, 140, [255, 255, 255]);
  paint(image, 10, 10, 109, 129, BLACK);
  paint(image, 13, 13, 106, 126, [70, 90, 140]);
  paint(image, 40, 30, 80, 100, SKIN);
  const result = extractForeground(image);
  assert.notEqual(result.status, "candidate-pass");
  assert.equal(result.status, "reject");
  assert.ok(result.reasons.includes("inset-or-nested-canvas"));
});

test("identical input and config produce identical rgba", () => {
  const image = portrait();
  const first = extractForeground(image);
  const second = extractForeground(image);
  assert.equal(first.status, second.status);
  assert.deepEqual(first.reasons, second.reasons);
  assert.ok(first.rgba.equals(second.rgba));
  assert.equal(first.config.version, EXTRACTION_CONFIG.version);
});

test("already-present alpha is rejected and opaque alpha is accepted", () => {
  const translucent = blank(32, 32, MATTE, 4);
  translucent.data[7] = 100;
  const rejected = extractForeground(translucent);
  assert.equal(rejected.status, "reject");
  assert.deepEqual(rejected.reasons, ["input-already-has-alpha"]);

  const opaque = blank(96, 120, MATTE, 4);
  silhouette(opaque);
  const accepted = extractForeground(opaque);
  assert.equal(accepted.status, "candidate-pass", accepted.reasons.join(","));
});

test("unexpected interior holes are distinct from cleared pockets", () => {
  const width = 12;
  const height = 12;
  const alpha = new Uint8Array(width * height).fill(255);
  const cleared = new Uint8Array(width * height);
  alpha[6 * width + 6] = 0;
  assert.ok(interiorHoleArea(alpha, cleared, width, height) > 0);
  cleared[6 * width + 6] = 1;
  assert.equal(interiorHoleArea(alpha, cleared, width, height), 0);
});

test("low-contrast material outside the contour is review, not a pass", () => {
  const image = portrait();
  paint(image, 34, 12, 62, 16, [140, 160, 170]);
  const result = extractForeground(image, {
    connectivityDeltaE: 6,
    seedDeltaE: 6,
    glowBoundaryDeltaE: 40,
    glowBoundaryFractionReview: 0.02,
  });
  assert.equal(result.status, "review", result.reasons.join(","));
  assert.ok(result.reasons.includes("exterior-glow-or-strands"));
});

test("run directories are not overwritten", () => {
  const root = mkdtempSync(join(tmpdir(), "spike-a-run-"));
  const created = allocateRunDirectory(root, "a1-test-once");
  assert.equal(statSync(created).isDirectory(), true);
  assert.throws(() => allocateRunDirectory(root, "a1-test-once"), /already exists/);
});

test("manifest paths reject traversal and env names", () => {
  assert.throws(() => assertRelativeResourcePath("../secret.png"));
  assert.throws(() => assertRelativeResourcePath("/etc/passwd"));
  assert.throws(() => assertRelativeResourcePath(".env.local"));
  assert.throws(() => assertRelativeResourcePath("nested/.env"));
  assert.doesNotThrow(() => assertRelativeResourcePath("Unknown 2.png"));
  assert.equal(containedPath("/allowed/root", "/allowed/root/file.png"), true);
  assert.equal(containedPath("/allowed/root", "/allowed/other/file.png"), false);
});

test("owner review export has the documented shape", () => {
  const exported = buildOwnerReviewExport({
    runId: "a1-20261023T120000Z",
    manifestHash: "a".repeat(64),
    items: [
      { id: "sdg-source-a-prompt-only-r1", automaticStatus: "candidate-pass", judgement: "accept", note: "clean" },
      { id: "historical-unknown-2", automaticStatus: "reject", judgement: "reject", note: "" },
    ],
  });
  assert.equal(exported.schema, OWNER_REVIEW_SCHEMA);
  assert.equal(exported.reloadLossDisclosed, true);
  assert.equal(exported.persistence, "browser-memory-only");
  assert.equal(exported.items[0].judgement, "accept");
  assert.equal(exported.items[1].automaticStatus, "reject");
  assert.throws(() => buildOwnerReviewExport({
    runId: "a1",
    manifestHash: "a".repeat(64),
    items: [{ id: "ok-id", automaticStatus: "candidate-pass", judgement: "maybe", note: "" }],
  }));
});

test("extraction does not call the network or rewrite a source file", async () => {
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    fetches += 1;
    throw new Error("network");
  };
  try {
    const image = portrait();
    const directory = mkdtempSync(join(tmpdir(), "spike-a-src-"));
    const file = join(directory, "portrait.png");
    await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).png().toFile(file);
    const before = createHash("sha256").update(readFileSync(file)).digest("hex");
    const decoded = await sharp(readFileSync(file)).raw().toBuffer({ resolveWithObject: true });
    extractForeground({
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      data: decoded.data,
    });
    const after = createHash("sha256").update(readFileSync(file)).digest("hex");
    assert.equal(before, after);
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("spike runtime does not import production, provider, or database code", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = readdirSync(root).filter((name) => name.endsWith(".mjs") || name.endsWith(".js"));
  const banned = [/image-provider/, /storyboard-web/, /renderer-remotion/, /from ["']pg["']/, /OPENAI/, /API_KEY/, /\.env\.local/];
  for (const name of files) {
    const source = readFileSync(join(root, name), "utf8");
    for (const pattern of banned) assert.equal(pattern.test(source), false, `${name} matches ${pattern}`);
  }
  const packageSource = readFileSync(join(root, "../../package.json"), "utf8");
  assert.match(packageSource, /spike:foreground-extraction/);
});
