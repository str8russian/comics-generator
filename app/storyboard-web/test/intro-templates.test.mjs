import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createResearchStore } from "../research-store.mjs";
import { createRenderController } from "../render-service.mjs";
import { createServer } from "../server.mjs";
import { compileVideoSpec } from "../video-spec.mjs";

const projectId = "00000000-0000-4000-8000-000000000001";
const origin = `http://127.0.0.1:9/api/projects/${projectId}`;

function panel(subject, assetId, id = `${subject || "panel"}-${assetId || "empty"}`) {
  return {
    id,
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

function imageFrame(id, panels, durationFrames = 36) {
  return {
    id,
    structureFrameId: id,
    frameKind: "image",
    dialogue: "",
    dialogueMode: "hidden",
    durationFrames,
    layout: panels.length > 1 ? "split2" : "single",
    panels,
  };
}

function cast(names) {
  return names.map((name) => ({
    name: name.name || name,
    approvedAnchorId: name.approvedAssetId ? `anchor-${name.approvedAssetId}` : null,
    approvedAssetId: name.approvedAssetId ?? null,
  }));
}

function readyVisual({ characters, frames, dialogue = "" }) {
  const nextFrames = frames.map((frame, index) => (
    index === 0 ? { ...frame, dialogue } : frame
  ));
  return {
    ok: true,
    status: "ready",
    storyboardVersionId: "version-locked",
    approved: true,
    characters,
    frames: nextFrames,
  };
}

function owns(ids) {
  const allowed = new Set(ids);
  return (id) => allowed.has(id);
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
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function introApi() {
  return import("../intro-templates.mjs");
}

test("the intro selector is a labeled native control and does not copy the catalog", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /<label for="render-intro">Интро<\/label>/);
  assert.match(html, /<select id="render-intro">/);
  assert.match(html, /<option value="" selected>Без интро<\/option>/);
  assert.equal(html.includes("story-shards-v1"), false);
  assert.equal(html.includes("Осколки истории"), false);
  assert.equal(app.includes("story-shards-v1"), false);
  assert.equal(app.includes("Осколки истории"), false);
  assert.equal(app.includes("durationFrames: 201"), false);
});

test("the existing render tool still encodes one composition and does not concatenate an intro file", () => {
  const video = readFileSync(new URL("../../../prototypes/remotion-rough/src/Video.jsx", import.meta.url), "utf8");
  const tool = readFileSync(new URL("../../../prototypes/remotion-rough/tools/render-spec.mjs", import.meta.url), "utf8");
  const root = readFileSync(new URL("../../../prototypes/remotion-rough/src/Root.jsx", import.meta.url), "utf8");
  assert.match(video, /spec\.intro/);
  assert.match(video, /isSupportedIntroRenderer|introRendererKey/);
  assert.match(video, /TelegramUnblockVideo/);
  assert.doesNotMatch(video, /ffmpeg|concat\(|render\.swift|story-shards-revised\.mp4/);
  assert.equal(tool.match(/renderMedia\(/g).length, 1);
  assert.equal(tool.match(/selectComposition\(/g).length, 1);
  assert.match(tool, /id:\s*["']CurrentStoryboard["']/);
  assert.doesNotMatch(tool, /ffmpeg|concat\(/);
  assert.equal(root.match(/id="CurrentStoryboard"/g).length, 1);
  assert.equal(root.includes("IntroOnly"), false);
});

test("the catalog publishes story-shards-v1 once, with version, length, label, and slots", async () => {
  const { INTRO_CATALOG, listIntroTemplates } = await introApi();
  const matches = INTRO_CATALOG.filter((entry) => entry.id === "story-shards-v1");
  assert.equal(matches.length, 1);
  const template = matches[0];
  assert.equal(template.version, 1);
  assert.equal(template.label, "Осколки истории");
  assert.equal(template.durationFrames, 201);
  assert.equal(template.fps, 30);
  assert.equal(template.minCharacters, 2);
  assert.equal(template.maxCharacters, 3);
  assert.equal(template.rendererKey, "story-shards-v1");
  assert.equal(template.slots.some((slot) => slot.kind === "text" && slot.id === "title"), true);
  assert.equal(template.slots.some((slot) => slot.kind === "text" && slot.id === "names"), true);
  assert.equal(template.slots.some((slot) => slot.kind === "image" && slot.count === 6), true);
  const listed = listIntroTemplates({
    visual: readyVisual({
      characters: cast([
        { name: "Катерина", approvedAssetId: "kat-a" },
        { name: "Илья", approvedAssetId: "ilya-a" },
      ]),
      frames: [imageFrame("f1", [panel("Катерина", "kat-a"), panel("Илья", "ilya-a")])],
    }),
    title: "Семейная история",
    ownsAsset: owns(["kat-a", "ilya-a"]),
  });
  assert.equal(listed.templates.length, 1);
  assert.equal(listed.templates[0].id, template.id);
  assert.equal(listed.templates[0].version, template.version);
  assert.equal(listed.templates[0].label, template.label);
  assert.equal(listed.templates[0].durationFrames, template.durationFrames);
  assert.equal(listed.templates[0].available, true);
  assert.equal(listed.templates[0].message, null);
});

test("no intro preserves body starts, transitions, duration, and omits an intro segment", async () => {
  const frames = [
    imageFrame("a", [panel("Катерина", "kat-a")], 36),
    imageFrame("b", [panel("Илья", "ilya-a")], 36),
    {
      id: "card",
      frameKind: "text",
      textCard: "Пауза",
      dialogue: "",
      durationFrames: 36,
      layout: "single",
      panels: [],
    },
    imageFrame("c", [panel("Катерина", "kat-a")], 4),
  ];
  const visual = { status: "ready", frames };
  const hard = compileVideoSpec(visual);
  assert.equal(hard.ok, true);
  assert.equal(Object.hasOwn(hard.spec, "intro"), false);
  assert.equal(hard.spec.project.totalDurationFrames, 112);
  assert.equal(hard.spec.frames[1].startFrame, 36);
  assert.equal(hard.spec.frames[0].durationFrames, 36);
  assert.equal(hard.spec.frames[0].transitionOut.overlapFrames, 0);
  const dissolve = compileVideoSpec(visual, { transition: "cross-dissolve" });
  assert.equal(Object.hasOwn(dissolve.spec, "intro"), false);
  assert.equal(dissolve.spec.frames[0].durationFrames, 36);
  assert.equal(dissolve.spec.frames[1].startFrame, 30);
  assert.deepEqual(dissolve.spec.frames[0].transitionOut, { mode: "cross-dissolve", overlapFrames: 6 });
  assert.equal(dissolve.spec.frames[2].startFrame, 66);
  assert.equal(dissolve.spec.project.nominalDurationFrames, 112);
  assert.equal(dissolve.spec.project.totalDurationFrames, 106);
});

test("two characters get three distinct shards each before the anchor is reused", async () => {
  const { resolveIntro } = await introApi();
  const visual = readyVisual({
    characters: cast([
      { name: "Пётр", approvedAssetId: "petr-a" },
      { name: "Илья", approvedAssetId: "ilya-a" },
      { name: "Катерина", approvedAssetId: "kat-a" },
    ]),
    frames: [
      imageFrame("f1", [panel("Катерина", "kat-1", "p1"), panel("Катерина", "kat-1", "p1b")]),
      imageFrame("f2", [panel("Илья", "ilya-1", "p2"), panel("Катерина", "kat-2", "p3")]),
      imageFrame("f3", [panel("Илья", "ilya-2", "p4")]),
    ],
    dialogue: "Не менять реплику",
  });
  const before = visual.frames[0].dialogue;
  const resolved = resolveIntro({
    templateId: "story-shards-v1",
    visual,
    title: "  Семейная история  ",
    assetOrigin: origin,
    ownsAsset: owns(["kat-a", "kat-1", "kat-2", "ilya-a", "ilya-1", "ilya-2"]),
    clientTitle: "Чужое название",
    clientNames: ["Хакер"],
  });
  assert.equal(resolved.ok, true);
  assert.equal(visual.frames[0].dialogue, before);
  assert.deepEqual(resolved.intro.characters.map((character) => character.name), ["Катерина", "Илья"]);
  assert.equal(resolved.intro.text.title, "Семейная история");
  assert.equal(resolved.intro.text.eyebrow, "ВИДЕОКОМИКС");
  assert.equal(resolved.intro.templateId, "story-shards-v1");
  assert.equal(resolved.intro.version, 1);
  assert.equal(resolved.intro.durationFrames, 201);
  assert.equal(resolved.intro.shards.length, 6);
  const byName = (name) => resolved.intro.shards.filter((shard) => shard.characterName === name).map((shard) => shard.assetId);
  assert.deepEqual(byName("Катерина"), ["kat-a", "kat-1", "kat-2"]);
  assert.deepEqual(byName("Илья"), ["ilya-a", "ilya-1", "ilya-2"]);
  assert.deepEqual(resolved.intro.shards.map((shard) => shard.slot), [
    "left-top",
    "left-bottom",
    "right-top",
    "right-bottom",
    "center-top",
    "center-bottom",
  ]);
  for (const shard of resolved.intro.shards) {
    assert.equal(shard.asset, `${origin}/visual/assets/${shard.assetId}`);
  }
  assert.equal(JSON.stringify(resolved.intro).includes("Чужое"), false);
  assert.equal(JSON.stringify(resolved.intro).includes("Хакер"), false);
  assert.equal(resolved.intro.sequence.namesStartFrame > Math.max(...resolved.intro.shards.map((shard) => shard.enterStartFrame + shard.enterDurationFrames - 1)), true);
  assert.equal(resolved.intro.sequence.titleStartFrame > resolved.intro.sequence.namesStartFrame, true);
  assert.equal(resolved.intro.sequence.closeStartFrame > resolved.intro.sequence.titleStartFrame, true);
});

test("missing distinct images reuse only that character's approved anchor", async () => {
  const { resolveIntro } = await introApi();
  const resolved = resolveIntro({
    templateId: "story-shards-v1",
    visual: readyVisual({
      characters: cast([
        { name: "Катерина", approvedAssetId: "kat-a" },
        { name: "Илья", approvedAssetId: "ilya-a" },
      ]),
      frames: [imageFrame("f1", [panel("Катерина", "kat-a"), panel("Илья", "ilya-1")])],
    }),
    title: "Семейная история",
    assetOrigin: origin,
    ownsAsset: owns(["kat-a", "ilya-a", "ilya-1"]),
  });
  assert.equal(resolved.ok, true);
  const kat = resolved.intro.shards.filter((shard) => shard.characterName === "Катерина").map((shard) => shard.assetId);
  const ilya = resolved.intro.shards.filter((shard) => shard.characterName === "Илья").map((shard) => shard.assetId);
  assert.deepEqual(kat, ["kat-a", "kat-a", "kat-a"]);
  assert.deepEqual(ilya, ["ilya-a", "ilya-1", "ilya-a"]);
});

test("three characters get two shards each in first-subject order", async () => {
  const { resolveIntro } = await introApi();
  const resolved = resolveIntro({
    templateId: "story-shards-v1",
    visual: readyVisual({
      characters: cast([
        { name: "Аня", approvedAssetId: "anya-a" },
        { name: "Борис", approvedAssetId: "boris-a" },
        { name: "Вера", approvedAssetId: "vera-a" },
      ]),
      frames: [
        imageFrame("f1", [panel("Вера", "vera-1"), panel("Аня", "anya-1")]),
        imageFrame("f2", [panel("Борис", "boris-1"), panel("Вера", "vera-a")]),
      ],
    }),
    title: "Трое",
    assetOrigin: origin,
    ownsAsset: owns(["anya-a", "anya-1", "boris-a", "boris-1", "vera-a", "vera-1"]),
  });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.intro.characters.map((character) => character.name), ["Вера", "Аня", "Борис"]);
  const ids = (name) => resolved.intro.shards.filter((shard) => shard.characterName === name).map((shard) => shard.assetId);
  assert.deepEqual(ids("Вера"), ["vera-a", "vera-1"]);
  assert.deepEqual(ids("Аня"), ["anya-a", "anya-1"]);
  assert.deepEqual(ids("Борис"), ["boris-a", "boris-1"]);
  assert.equal(resolved.intro.shards.length, 6);
});

test("a foreign panel image is dropped and a foreign anchor never enters the spec", async () => {
  const { resolveIntro } = await introApi();
  const skipped = resolveIntro({
    templateId: "story-shards-v1",
    visual: readyVisual({
      characters: cast([
        { name: "Катерина", approvedAssetId: "kat-a" },
        { name: "Илья", approvedAssetId: "ilya-a" },
      ]),
      frames: [imageFrame("f1", [panel("Катерина", "foreign-kat"), panel("Илья", "ilya-a")])],
    }),
    title: "Семейная история",
    assetOrigin: origin,
    ownsAsset: owns(["kat-a", "ilya-a"]),
  });
  assert.equal(skipped.ok, true);
  assert.equal(JSON.stringify(skipped.intro).includes("foreign-kat"), false);
  assert.deepEqual(
    skipped.intro.shards.filter((shard) => shard.characterName === "Катерина").map((shard) => shard.assetId),
    ["kat-a", "kat-a", "kat-a"],
  );
  const rejected = resolveIntro({
    templateId: "story-shards-v1",
    visual: readyVisual({
      characters: cast([
        { name: "Катерина", approvedAssetId: "foreign-anchor" },
        { name: "Илья", approvedAssetId: "ilya-a" },
      ]),
      frames: [imageFrame("f1", [panel("Катерина", "kat-1"), panel("Илья", "ilya-a")])],
    }),
    title: "Семейная история",
    assetOrigin: origin,
    ownsAsset: owns(["ilya-a", "kat-1"]),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, "intro-asset");
  assert.match(rejected.message, /проект/);
  assert.equal(JSON.stringify(rejected).includes("foreign-anchor"), false);
  assert.equal(rejected.intro, undefined);
});

test("cast size, missing title, missing anchor, and no cast are specific and leave no intro", async () => {
  const { resolveIntro, listIntroTemplates } = await introApi();
  const two = [
    { name: "Катерина", approvedAssetId: "kat-a" },
    { name: "Илья", approvedAssetId: "ilya-a" },
  ];
  const cases = [
    {
      kind: "intro-cast-count",
      visual: readyVisual({
        characters: cast([{ name: "Катерина", approvedAssetId: "kat-a" }]),
        frames: [imageFrame("f1", [panel("Катерина", "kat-a")])],
      }),
      title: "Один",
    },
    {
      kind: "intro-cast-count",
      visual: readyVisual({
        characters: cast(["Аня", "Борис", "Вера", "Глеб"].map((name) => ({ name, approvedAssetId: `${name}-a` }))),
        frames: [imageFrame("f1", ["Аня", "Борис", "Вера", "Глеб"].map((name) => panel(name, `${name}-a`)))],
      }),
      title: "Четверо",
    },
    {
      kind: "intro-no-cast",
      visual: readyVisual({
        characters: cast(two),
        frames: [imageFrame("f1", [panel("Посторонний", "kat-a"), panel(null, "ilya-a")])],
      }),
      title: "Пусто",
    },
    {
      kind: "intro-missing-title",
      visual: readyVisual({
        characters: cast(two),
        frames: [imageFrame("f1", [panel("Катерина", "kat-a"), panel("Илья", "ilya-a")])],
      }),
      title: "   ",
    },
    {
      kind: "intro-missing-anchor",
      visual: readyVisual({
        characters: cast([
          { name: "Катерина", approvedAssetId: "kat-a" },
          { name: "Илья", approvedAssetId: null },
        ]),
        frames: [imageFrame("f1", [panel("Катерина", "kat-a"), panel("Илья", "ilya-panel")])],
      }),
      title: "Без образа",
    },
  ];
  for (const entry of cases) {
    const ownedIds = entry.visual.frames.flatMap((frame) => frame.panels.map((item) => item.assetId)).filter(Boolean);
    const resolved = resolveIntro({
      templateId: "story-shards-v1",
      visual: entry.visual,
      title: entry.title,
      assetOrigin: origin,
      ownsAsset: owns(["kat-a", "ilya-a", "ilya-panel", "Аня-a", "Борис-a", "Вера-a", "Глеб-a", ...ownedIds]),
    });
    assert.equal(resolved.ok, false, entry.kind);
    assert.equal(resolved.kind, entry.kind);
    assert.match(resolved.message, /[А-Яа-яЁё]/);
    assert.equal(resolved.intro, undefined);
    const listed = listIntroTemplates({
      visual: entry.visual,
      title: entry.title,
      ownsAsset: owns(["kat-a", "ilya-a", "ilya-panel", "Аня-a", "Борис-a", "Вера-a", "Глеб-a", ...ownedIds]),
    });
    assert.equal(listed.templates[0].available, false);
    assert.equal(listed.templates[0].reason, entry.kind);
    assert.equal(listed.templates[0].message, resolved.message);
    const plain = compileVideoSpec(entry.visual);
    assert.equal(plain.ok, true);
    assert.equal(Object.hasOwn(plain.spec, "intro"), false);
    assert.equal(plain.spec.frames[0].startFrame, 0);
  }
});

test("an intro adds 201 frames, offsets body starts, and keeps a hard cut into the body", async () => {
  const { resolveIntro } = await introApi();
  const frames = [
    imageFrame("a", [panel("Катерина", "kat-a")], 36),
    imageFrame("b", [panel("Илья", "ilya-a")], 36),
    {
      id: "card",
      frameKind: "text",
      textCard: "Пауза",
      dialogue: "",
      durationFrames: 36,
      layout: "single",
      panels: [],
    },
    imageFrame("c", [panel("Катерина", "kat-a")], 4),
  ];
  const visual = readyVisual({
    characters: cast([
      { name: "Катерина", approvedAssetId: "kat-a" },
      { name: "Илья", approvedAssetId: "ilya-a" },
    ]),
    frames,
  });
  const resolved = resolveIntro({
    templateId: "story-shards-v1",
    visual,
    title: "Семейная история",
    assetOrigin: origin,
    ownsAsset: owns(["kat-a", "ilya-a"]),
  });
  const hard = compileVideoSpec(visual, { intro: resolved.intro });
  assert.equal(hard.ok, true);
  assert.equal(hard.spec.intro.durationFrames, 201);
  assert.equal(hard.spec.project.totalDurationFrames, 112 + 201);
  assert.equal(hard.spec.project.nominalDurationFrames, 112 + 201);
  assert.deepEqual(hard.spec.frames.map((frame) => frame.durationFrames), [36, 36, 36, 4]);
  assert.deepEqual(hard.spec.frames.map((frame) => frame.startFrame), [201, 237, 273, 309]);
  assert.equal(hard.spec.frames[0].transitionIn.mode, "hard-cut");
  const dissolve = compileVideoSpec(visual, { transition: "cross-dissolve", intro: resolved.intro });
  assert.equal(dissolve.spec.frames[0].durationFrames, 36);
  assert.equal(dissolve.spec.frames[1].startFrame, 231);
  assert.deepEqual(dissolve.spec.frames[0].transitionOut, { mode: "cross-dissolve", overlapFrames: 6 });
  assert.equal(dissolve.spec.frames[0].transitionIn.mode, "hard-cut");
  assert.equal(dissolve.spec.frames[0].transitionIn.overlapFrames, 0);
  assert.equal(dissolve.spec.frames[2].startFrame, 267);
  assert.equal(dissolve.spec.frames[2].transitionOut.mode, "hard-cut");
  assert.equal(dissolve.spec.project.totalDurationFrames, 106 + 201);
  assert.equal(dissolve.spec.project.nominalDurationFrames, 112 + 201);
  assert.equal(dissolve.spec.frames.some((frame) => frame.kind === "intro"), false);
});

test("unknown and unavailable intros are rejected before the render controller starts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "intro-reject-"));
  let renders = 0;
  let providerCalls = 0;
  let writes = 0;
  const visual = readyVisual({
    characters: cast([{ name: "Катерина", approvedAssetId: "kat-a" }]),
    frames: [imageFrame("only", [panel("Катерина", "kat-a")])],
    dialogue: "исходная реплика",
  });
  const controller = createRenderController({
    outputDir: directory,
    runRender: async (_spec, outputFile) => {
      renders += 1;
      await writeFile(outputFile, Buffer.from("mp4"));
    },
  });
  const server = createServer({
    migrate: false,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("provider");
    },
    projectStore: {
      loadProject: async () => ({ title: "Семейная история" }),
      reviseSourceUtterance: async () => {
        writes += 1;
        return { ok: false };
      },
    },
    visualStore: {
      load: async () => visual,
      readAsset: async (id) => (id === "kat-a" ? { mime: "image/png", bytes: Buffer.from("png") } : null),
      edit: async () => {
        writes += 1;
      },
      undoStoryboardEdit: async () => {
        writes += 1;
      },
      approve: async () => {
        writes += 1;
      },
    },
    renderController: controller,
  });
  const port = await listen(server);
  try {
    const unknownBody = JSON.stringify({ transition: "hard-cut", introTemplateId: "not-a-template", title: "Чужое" });
    const unknown = await send(port, {
      method: "POST",
      path: `/api/projects/${projectId}/visual/render`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(unknownBody),
      },
      body: unknownBody,
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.kind, "unknown-intro");
    assert.match(unknown.body.message, /недоступ/);
    const versionBody = JSON.stringify({ introTemplateId: "story-shards-v1", introTemplateVersion: 2 });
    const version = await send(port, {
      method: "POST",
      path: `/api/projects/${projectId}/visual/render`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(versionBody),
      },
      body: versionBody,
    });
    assert.equal(version.status, 400);
    assert.equal(version.body.kind, "invalid-intro-version");
    const unavailableBody = JSON.stringify({ introTemplateId: "story-shards-v1", title: "Чужое", names: ["Хакер"] });
    const unavailable = await send(port, {
      method: "POST",
      path: `/api/projects/${projectId}/visual/render`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(unavailableBody),
      },
      body: unavailableBody,
    });
    assert.equal(unavailable.status, 400);
    assert.equal(unavailable.body.kind, "intro-cast-count");
    assert.match(unavailable.body.message, /двух или трёх/);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(renders, 0);
    assert.equal(providerCalls, 0);
    assert.equal(writes, 0);
    assert.equal(visual.frames[0].dialogue, "исходная реплика");
    assert.equal(visual.storyboardVersionId, "version-locked");
    const plainBody = JSON.stringify({ transition: "hard-cut" });
    const plain = await send(port, {
      method: "POST",
      path: `/api/projects/${projectId}/visual/render`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(plainBody),
      },
      body: plainBody,
    });
    assert.equal(plain.status, 202);
    for (let attempt = 0; attempt < 20 && renders < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(renders, 1);
    assert.equal(writes, 0);
    assert.equal(providerCalls, 0);
  } finally {
    await close(server);
  }
});

test("the catalog route and a real render resolve project data without provider calls or storyboard writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "intro-render-"));
  const research = createResearchStore({ memory: true });
  let renders = 0;
  let providerCalls = 0;
  let writes = 0;
  const captured = [];
  const kat = "11111111-1111-4111-8111-111111111111";
  const ilya = "22222222-2222-4222-8222-222222222222";
  const foreign = "33333333-3333-4333-8333-333333333333";
  const visual = readyVisual({
    characters: cast([
      { name: "Илья", approvedAssetId: ilya },
      { name: "Катерина", approvedAssetId: kat },
    ]),
    frames: [
      imageFrame("f1", [panel("Катерина", kat, "p1"), panel("Илья", foreign, "p2")]),
      imageFrame("f2", [panel("Илья", ilya, "p3")]),
    ],
    dialogue: "исходная реплика",
  });
  const server = createServer({
    migrate: false,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("provider");
    },
    projectStore: {
      loadProject: async () => ({ title: "Семейная история", draft: { text: "исходный черновик", revisionToken: "token-1" } }),
      reviseSourceUtterance: async () => {
        writes += 1;
        return { ok: false };
      },
    },
    visualStore: {
      load: async () => visual,
      readAsset: async (id) => (
        id === kat || id === ilya ? { mime: "image/png", bytes: Buffer.from(id) } : null
      ),
      undoStoryboardEdit: async () => {
        writes += 1;
      },
      approve: async () => {
        writes += 1;
      },
    },
    researchStore: research,
    renderController: createRenderController({
      outputDir: directory,
      runRender: async (spec, outputFile) => {
        renders += 1;
        captured.push(spec);
        await writeFile(outputFile, Buffer.from("mp4"));
      },
    }),
  });
  const port = await listen(server);
  try {
    const listed = await send(port, {
      path: `/api/projects/${projectId}/visual/intro-templates`,
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.templates[0].id, "story-shards-v1");
    assert.equal(listed.body.templates[0].version, 1);
    assert.equal(listed.body.templates[0].label, "Осколки истории");
    assert.equal(listed.body.templates[0].durationFrames, 201);
    assert.equal(listed.body.templates[0].available, true);
    const body = JSON.stringify({
      transition: "cross-dissolve",
      introTemplateId: "story-shards-v1",
      title: "Чужое название",
      names: ["Хакер"],
      assetIds: [foreign],
    });
    const started = await send(port, {
      method: "POST",
      path: `/api/projects/${projectId}/visual/render`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      body,
    });
    assert.equal(started.status, 202);
    assert.equal(started.body.introTemplateId, "story-shards-v1");
    assert.equal(started.body.introTemplateVersion, 1);
    for (let attempt = 0; attempt < 20 && captured.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(renders, 1);
    const spec = captured[0];
    assert.equal(spec.intro.text.title, "Семейная история");
    assert.deepEqual(spec.intro.characters.map((character) => character.name), ["Катерина", "Илья"]);
    assert.equal(JSON.stringify(spec).includes("Чужое"), false);
    assert.equal(JSON.stringify(spec).includes("Хакер"), false);
    assert.equal(JSON.stringify(spec.intro).includes(foreign), false);
    assert.equal(spec.frames[0].startFrame, 201);
    assert.equal(spec.frames[0].transitionIn.mode, "hard-cut");
    assert.equal(spec.project.totalDurationFrames, spec.frames.reduce((sum, frame) => sum + frame.durationFrames, 0) - 6 + 201);
    const assetPath = `/api/projects/${projectId}/visual/assets/${kat}`;
    assert.equal(spec.intro.shards.every((shard) => shard.asset === `http://127.0.0.1:${port}${assetPath.replace(kat, shard.assetId)}`), true);
    const owned = await send(port, { path: assetPath });
    assert.equal(owned.status, 200);
    const blocked = await send(port, { path: `/api/projects/${projectId}/visual/assets/${foreign}` });
    assert.equal(blocked.status, 404);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const trace = await research.listTrace({ projectId });
    const start = trace.events.find((event) => event.eventKind === "action_start");
    const terminal = trace.events.find((event) => event.eventKind === "action_terminal");
    assert.equal(start.context.introTemplateId, "story-shards-v1");
    assert.equal(start.context.introTemplateVersion, 1);
    assert.equal(terminal.context.introTemplateId, "story-shards-v1");
    assert.equal(terminal.context.introTemplateVersion, 1);
    assert.equal(JSON.stringify(trace).includes("исходная реплика"), false);
    assert.equal(JSON.stringify(trace).includes("исходный черновик"), false);
    assert.equal(writes, 0);
    assert.equal(providerCalls, 0);
    assert.equal(visual.frames[0].dialogue, "исходная реплика");
    assert.equal(visual.storyboardVersionId, "version-locked");
  } finally {
    await close(server);
  }
});
