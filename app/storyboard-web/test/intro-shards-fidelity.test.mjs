import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { compileVideoSpec } from "../video-spec.mjs";

const introUrl = new URL("../../../prototypes/remotion-rough/src/StoryShardsIntro.jsx", import.meta.url);
const motionUrl = new URL("../../../prototypes/remotion-rough/src/story-shards-motion.mjs", import.meta.url);
const displayUrl = new URL("../../../prototypes/remotion-rough/src/story-shards-display.mjs", import.meta.url);
const fontUrl = new URL("../../../prototypes/remotion-rough/public/fonts/RobotoCondensed-variable.ttf", import.meta.url);
const licenseUrl = new URL("../../../prototypes/remotion-rough/public/fonts/OFL.txt", import.meta.url);
const dockerfileUrl = new URL("../../../Dockerfile", import.meta.url);

const projectId = "00000000-0000-4000-8000-000000000001";
const origin = `http://127.0.0.1:9/api/projects/${projectId}`;

function panel(subject, assetId) {
  return {
    id: `${subject}-${assetId}`,
    subject,
    assetId,
    zoom: 1,
    positionX: 50,
    positionY: 30,
    mirrored: false,
    position: "50% 30%",
    align: "50% 30%",
  };
}

function readyVisual() {
  return {
    ok: true,
    status: "ready",
    storyboardVersionId: "version-locked",
    approved: true,
    characters: [
      { name: "Катерина", approvedAnchorId: "anchor-kat-a", approvedAssetId: "kat-a" },
      { name: "Илья", approvedAnchorId: "anchor-ilya-a", approvedAssetId: "ilya-a" },
    ],
    frames: [
      {
        id: "f1",
        structureFrameId: "f1",
        frameKind: "image",
        dialogue: "",
        dialogueMode: "hidden",
        durationFrames: 36,
        layout: "split2",
        panels: [panel("Катерина", "kat-a"), panel("Илья", "ilya-a")],
      },
    ],
  };
}

function tableOffset(view, tag) {
  const numTables = view.getUint16(4);
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    const found = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    if (found === tag) return view.getUint32(record + 8);
  }
  return -1;
}

function cmapGlyph(view, codepoint) {
  const cmap = tableOffset(view, "cmap");
  assert.equal(cmap >= 0, true, "cmap table");
  const subtables = view.getUint16(cmap + 2);
  let chosen = -1;
  let format = 0;
  for (let index = 0; index < subtables; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const subtable = cmap + view.getUint32(record + 4);
    const nextFormat = view.getUint16(subtable);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (nextFormat !== 4 && nextFormat !== 12)) continue;
    if (chosen < 0 || nextFormat === 12) {
      chosen = subtable;
      format = nextFormat;
    }
  }
  assert.equal(chosen >= 0, true, `cmap entry for U+${codepoint.toString(16)}`);
  if (format === 12) {
    const groups = view.getUint32(chosen + 12);
    let lo = 0;
    let hi = groups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const group = chosen + 16 + mid * 12;
      const start = view.getUint32(group);
      const end = view.getUint32(group + 4);
      if (codepoint < start) hi = mid - 1;
      else if (codepoint > end) lo = mid + 1;
      else return view.getUint32(group + 8) + (codepoint - start);
    }
    return 0;
  }
  const segCount = view.getUint16(chosen + 6) / 2;
  const endOffset = chosen + 14;
  let segment = -1;
  for (let index = 0; index < segCount; index += 1) {
    const end = view.getUint16(endOffset + index * 2);
    if (end >= codepoint) {
      segment = index;
      break;
    }
  }
  if (segment < 0) return 0;
  const startOffset = endOffset + segCount * 2 + 2;
  const start = view.getUint16(startOffset + segment * 2);
  if (codepoint < start) return 0;
  const deltaOffset = startOffset + segCount * 2;
  const rangeOffset = deltaOffset + segCount * 2;
  const idDelta = view.getInt16(deltaOffset + segment * 2);
  const idRange = view.getUint16(rangeOffset + segment * 2);
  if (idRange === 0) return (idDelta + codepoint) & 0xffff;
  const glyphOffset = rangeOffset + segment * 2 + idRange + (codepoint - start) * 2;
  const glyph = view.getUint16(glyphOffset);
  if (glyph === 0) return 0;
  return (glyph + idDelta) & 0xffff;
}

function weightAxis(view) {
  const fvar = tableOffset(view, "fvar");
  assert.equal(fvar >= 0, true, "fvar table");
  const axisCount = view.getUint16(fvar + 8);
  const axisSize = view.getUint16(fvar + 10);
  for (let index = 0; index < axisCount; index += 1) {
    const axis = fvar + 16 + index * axisSize;
    const tag = String.fromCharCode(
      view.getUint8(axis),
      view.getUint8(axis + 1),
      view.getUint8(axis + 2),
      view.getUint8(axis + 3),
    );
    if (tag !== "wght") continue;
    return {
      min: view.getInt32(axis + 4) / 65536,
      max: view.getInt32(axis + 12) / 65536,
    };
  }
  return null;
}

function panContinuity(samples) {
  if (!Array.isArray(samples) || samples.length < 3) return { ok: false, reason: "short" };
  const dx = [];
  const dy = [];
  for (let index = 1; index < samples.length; index += 1) {
    const x = samples[index].x - samples[index - 1].x;
    const y = samples[index].y - samples[index - 1].y;
    if (!Number.isFinite(samples[index].x) || !Number.isFinite(samples[index].y)) {
      return { ok: false, reason: "non-finite" };
    }
    dx.push(x);
    dy.push(y);
  }
  const smooth = (deltas) => {
    const abs = deltas.map((value) => Math.abs(value));
    const mean = abs.reduce((sum, value) => sum + value, 0) / abs.length;
    if (!(mean > 0)) return "still";
    const sign = Math.sign(deltas.find((value) => Math.abs(value) > mean * 0.01) ?? 0);
    if (sign === 0) return "still";
    if (deltas.some((value) => Math.sign(value) === -sign && Math.abs(value) > mean * 0.05)) return "reverse";
    const min = Math.min(...abs);
    const max = Math.max(...abs);
    if (min < mean * 0.25) return "hold";
    if (max > mean * 2.5) return "jump";
    return null;
  };
  return { ok: smooth(dx) == null && smooth(dy) == null, reason: smooth(dx) || smooth(dy) || null };
}

test("story shards use the bundled condensed face and wait for it before capture", () => {
  const source = readFileSync(introUrl, "utf8");
  const dockerfile = readFileSync(dockerfileUrl, "utf8");
  assert.equal(source.includes("Arial"), false);
  assert.equal(source.includes("Helvetica"), false);
  assert.equal(source.includes("sans-serif"), false);
  assert.equal(source.includes("fonts.google"), false);
  assert.equal(source.includes("fonts.gstatic"), false);
  assert.doesNotMatch(source, /url\(\s*["']https?:/);
  assert.match(source, /fontFamily: `"\$\{DISPLAY_FONT_FAMILY\}"`/);
  assert.match(source, /fontWeight: NAME_FONT_WEIGHT/);
  assert.match(source, /fontWeight: TITLE_FONT_WEIGHT/);
  assert.match(source, /fontWeight: EYEBROW_FONT_WEIGHT/);
  assert.match(source, /delayRender\(/);
  assert.match(source, /continueRender\(/);
  assert.match(source, /cancelRender\(/);
  assert.match(source, /staticFile\(DISPLAY_FONT_FILE\)/);
  assert.match(source, /document\.fonts\.load/);
  assert.match(source, /did not become ready/);
  assert.match(dockerfile, /COPY prototypes\b/);
  assert.equal(existsSync(fontUrl), true);
  assert.equal(existsSync(licenseUrl), true);
  const license = readFileSync(licenseUrl, "utf8");
  assert.match(license, /SIL Open Font License/);
  const font = readFileSync(fontUrl);
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  for (const codepoint of [0x41, 0x5a, 0x401, 0x410, 0x42f, 0x451]) {
    assert.equal(cmapGlyph(view, codepoint) > 0, true, `U+${codepoint.toString(16)}`);
  }
  const axis = weightAxis(view);
  assert.ok(axis);
  assert.equal(axis.min <= 700, true);
  assert.equal(axis.max >= 800, true);
});

test("the renderer uppercases only the drawn title and keeps canonical names", async () => {
  const source = readFileSync(introUrl, "utf8");
  const { resolveIntro } = await import("../intro-templates.mjs");
  const { presentTitle, titleLines, nameSize, NAME_FONT_WEIGHT, TITLE_FONT_WEIGHT, EYEBROW_FONT_WEIGHT, DISPLAY_FONT_FAMILY, DISPLAY_FONT_FILE } = await import(displayUrl);
  assert.equal(DISPLAY_FONT_FAMILY, "Roboto Condensed");
  assert.equal(DISPLAY_FONT_FILE.startsWith("fonts/"), true);
  assert.equal(DISPLAY_FONT_FILE.includes("http"), false);
  assert.equal(NAME_FONT_WEIGHT, 800);
  assert.equal(TITLE_FONT_WEIGHT, 800);
  assert.equal(EYEBROW_FONT_WEIGHT, 700);
  assert.match(source, /\{character\.name\}/);
  assert.doesNotMatch(source, /presentTitle\(character/);
  assert.match(source, /titleLines\(intro\?\.text\?\.title\)/);
  const visual = readyVisual();
  const resolved = resolveIntro({
    templateId: "story-shards-v1",
    visual,
    title: "Загадка фамилии",
    assetOrigin: origin,
    ownsAsset: (id) => id === "kat-a" || id === "ilya-a",
  });
  const compiled = compileVideoSpec(visual, { intro: resolved.intro });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.spec.intro.text.title, "Загадка фамилии");
  assert.deepEqual(compiled.spec.intro.characters.map((character) => character.name), ["Катерина", "Илья"]);
  assert.equal(presentTitle(compiled.spec.intro.text.title), "ЗАГАДКА ФАМИЛИИ");
  assert.deepEqual(titleLines(compiled.spec.intro.text.title), ["ЗАГАДКА", "ФАМИЛИИ"]);
  assert.equal(presentTitle("ёлка и i"), "ЁЛКА И I");
  assert.equal(nameSize("Катерина") >= 54, true);
  assert.equal(nameSize("Илья") >= 54, true);
  assert.equal(nameSize("Ilya Zaigralov") >= 54, true);
  assert.equal(nameSize("Очень длинное каноническое имя персонажа") < nameSize("Катерина"), true);
});

test("settled shard pans are continuous, monotonic, and covered", async () => {
  const source = readFileSync(introUrl, "utf8");
  assert.equal(source.includes("Math.sin"), false);
  assert.doesNotMatch(source, /transform\s*:/);
  assert.match(source, /shardFrame\(/);
  assert.match(source, /objectFit:\s*["']cover["']/);
  const { shardFrame, STORY_SHARD_SLOTS, PAN_SAFETY_PX } = await import(motionUrl);
  const starts = {
    "left-top": 0,
    "left-bottom": 7,
    "right-top": 17,
    "right-bottom": 25,
    "center-top": 11,
    "center-bottom": 31,
  };
  const holdJump = [];
  for (let index = 0; index < 8; index += 1) holdJump.push({ x: 0, y: index * 0.2 });
  holdJump.push({ x: 30, y: 1.6 });
  assert.equal(panContinuity(holdJump).ok, false);
  const jitter = Array.from({ length: 10 }, (_, index) => ({ x: index % 2 === 0 ? 0 : 1.5, y: index * 0.2 }));
  assert.equal(panContinuity(jitter).ok, false);

  for (const slot of STORY_SHARD_SLOTS) {
    const enterStartFrame = starts[slot];
    const enterDurationFrames = 16;
    const moving = [];
    let imageSize = null;
    let settledBox = null;
    for (let frame = 0; frame <= 200; frame += 1) {
      const state = shardFrame({ slot, frame, fps: 30, enterStartFrame, enterDurationFrames });
      assert.equal(Number.isFinite(state.image.left), true);
      assert.equal(Number.isFinite(state.image.top), true);
      assert.equal(Number.isFinite(state.panX), true);
      assert.equal(Number.isFinite(state.panY), true);
      const leftGap = -state.image.left;
      const topGap = -state.image.top;
      const rightGap = state.image.left + state.image.width - state.box.width;
      const bottomGap = state.image.top + state.image.height - state.box.height;
      assert.equal(leftGap >= PAN_SAFETY_PX - 1e-6, true, `${slot} left ${frame}`);
      assert.equal(topGap >= PAN_SAFETY_PX - 1e-6, true, `${slot} top ${frame}`);
      assert.equal(rightGap >= PAN_SAFETY_PX - 1e-6, true, `${slot} right ${frame}`);
      assert.equal(bottomGap >= PAN_SAFETY_PX - 1e-6, true, `${slot} bottom ${frame}`);
      if (!imageSize) imageSize = [state.image.width, state.image.height];
      assert.deepEqual([state.image.width, state.image.height], imageSize);
      if (frame >= enterStartFrame + enterDurationFrames) {
        if (!settledBox) settledBox = [state.box.left, state.box.top, state.box.width, state.box.height];
        assert.deepEqual([state.box.left, state.box.top, state.box.width, state.box.height], settledBox);
      }
      const panEnd = enterStartFrame + Math.round(4.9 * 30);
      if (frame >= enterStartFrame + enterDurationFrames && frame < panEnd) {
        moving.push({ x: state.image.left, y: state.image.top });
      }
    }
    assert.equal(panContinuity(moving).ok, true, `${slot} ${panContinuity(moving).reason}`);
    const snapped = moving.map((sample) => ({ x: Math.round(sample.x), y: Math.round(sample.y) }));
    assert.equal(panContinuity(snapped).ok, false, slot);
    const entry = [];
    for (let frame = enterStartFrame; frame <= enterStartFrame + enterDurationFrames; frame += 1) {
      entry.push(shardFrame({ slot, frame, fps: 30, enterStartFrame, enterDurationFrames }).box.left);
    }
    const entryDelta = entry.slice(1).map((value, index) => value - entry[index]);
    const entrySign = Math.sign(entryDelta.find((value) => Math.abs(value) > 1e-6) ?? 0);
    assert.equal(entryDelta.every((value) => Math.sign(value) === entrySign || Math.abs(value) <= 1e-6), true, slot);
  }
});
