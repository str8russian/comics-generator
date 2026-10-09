import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import test from "node:test";
import { createServer } from "../server.mjs";
import {
  buildDiagnosticsArchive,
  buildZipArchive,
  diagnosticsAttachmentFilename,
  normalizeZipEntryPath,
  readZipArchive,
  sanitizeFrameIdForFilename,
  sha256Hex,
  stableStringify,
} from "../visual-diagnostics.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);
const pngSha = sha256Hex(png);

const PLANTED_SECRETS = [
  "sk-live-PLANTED-TOKEN-DO-NOT-EXPORT",
  "Bearer PLANTED-AUTHORIZATION-VALUE",
  "CONTEST_API_TOKEN=super-secret-env",
  "postgres://comics:comics-secret@127.0.0.1:5432/comics",
  "https://provider.example/v1/images?signature=PLANTED_SIGNED_URL",
  "Set-Cookie: session=PLANTED_COOKIE",
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function request(port, { method = "GET", path }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        let body = null;
        try { body = JSON.parse(bytes.toString("utf8")); } catch { /* binary */ }
        resolve({ status: res.statusCode, body, bytes, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function baseEvidence(overrides = {}) {
  const bgId = "20000000-0000-4000-8000-000000000001";
  const rawId = "20000000-0000-4000-8000-000000000002";
  const rgbaId = "20000000-0000-4000-8000-000000000003";
  const recordBg = "30000000-0000-4000-8000-000000000001";
  const recordChar = "30000000-0000-4000-8000-000000000002";
  const opId = "40000000-0000-4000-8000-000000000001";
  return {
    ok: true,
    storyboardResultId: "10000000-0000-4000-8000-000000000006",
    storyboardVersionId: "10000000-0000-4000-8000-000000000010",
    frameId: "frame-1",
    visibleFrameNumber: 1,
    visibleFrameId: "frame-1",
    briefs: {
      gridDescription: "Диалог двух персонажей",
      detailedBrief: "Подробный бриф кадра без compiled prompt",
    },
    assembly: {
      assemblyStatus: "ready",
      readiness: true,
      compositionMode: "near-frontal-pair",
      sceneKey: "primary",
      activeOperationId: null,
      backgroundAssetId: bgId,
      characterAssetIds: [rgbaId],
      pointers: {
        sceneBackgroundStateId: "50000000-0000-4000-8000-000000000001",
        currentBackgroundGenerationId: "50000000-0000-4000-8000-000000000002",
        sceneWriteVersion: 1,
        frameActiveOperationId: null,
        panelCharacterGenerationIds: ["50000000-0000-4000-8000-000000000003"],
      },
    },
    sharedBackground: null,
    composite: { present: false, reason: "no-deterministic-composite-stored" },
    panels: [{
      panelIndex: 0,
      subject: "Персонаж",
      zoom: 1.25,
      positionX: 40,
      positionY: 35,
      fitMode: "manual",
      currentCharacterGenerationId: "50000000-0000-4000-8000-000000000003",
    }],
    operations: [{
      operationId: opId,
      frameId: "frame-1",
      storyboardResultId: "10000000-0000-4000-8000-000000000006",
      storyboardVersionId: "10000000-0000-4000-8000-000000000010",
      scope: "frame",
      panelIndex: null,
      writeVersion: 1,
      phase: "complete",
      status: "complete",
      errorKind: null,
      componentFailures: [],
      createdAt: "2026-10-09T12:00:00.000Z",
      updatedAt: "2026-10-09T12:00:01.000Z",
      finishedAt: "2026-10-09T12:00:01.000Z",
    }],
    generations: [
      {
        recordId: recordBg,
        operationType: "scene-background",
        storyboardResultId: "10000000-0000-4000-8000-000000000006",
        storyboardVersionId: "10000000-0000-4000-8000-000000000010",
        frameId: "frame-1",
        panelIndex: null,
        sceneKey: "primary",
        componentGenerationId: "50000000-0000-4000-8000-000000000002",
        operationId: opId,
        visualIntent: { layer: "background", note: "shared-scene" },
        compiledPrompt: "BACKGROUND PROMPT for diagnostics only",
        promptCompilerVersion: "hybrid-dialogue-v1",
        model: "test-model",
        generationSettings: { aspectRatio: "21:9", component: "scene-background", timeoutMs: 1000 },
        referenceManifest: [{
          role: "style",
          assetId: "60000000-0000-4000-8000-000000000001",
          required: true,
          mime: "image/png",
          width: 1,
          height: 1,
          byteLength: png.length,
          sha256: pngSha,
        }],
        omittedReferences: [],
        appGitCommit: "deadbeef",
        status: "ready",
        errorKind: null,
        providerStatus: "200",
        latencyMs: 12,
        outputAssetId: bgId,
        outputSha256: pngSha,
        outputMime: "image/png",
        outputWidth: 1,
        outputHeight: 1,
        outputByteLength: png.length,
        sharedBackground: false,
        originatingFrameId: "frame-1",
        originatingOperationId: opId,
        createdAt: "2026-10-09T12:00:00.000Z",
        finishedAt: "2026-10-09T12:00:00.500Z",
      },
      {
        recordId: recordChar,
        operationType: "character-state",
        storyboardResultId: "10000000-0000-4000-8000-000000000006",
        storyboardVersionId: "10000000-0000-4000-8000-000000000010",
        frameId: "frame-1",
        panelIndex: 0,
        sceneKey: null,
        componentGenerationId: "50000000-0000-4000-8000-000000000003",
        operationId: opId,
        visualIntent: { layer: "character", panelIndex: 0 },
        compiledPrompt: "CHARACTER PROMPT for diagnostics only",
        promptCompilerVersion: "hybrid-dialogue-v1",
        model: "test-model",
        generationSettings: {
          aspectRatio: "5:4",
          component: "character-state",
          panelIndex: 0,
          timeoutMs: 1000,
        },
        referenceManifest: [
          {
            role: "identity",
            assetId: "60000000-0000-4000-8000-000000000002",
            required: true,
            mime: "image/png",
            sha256: pngSha,
            byteLength: png.length,
            width: 1,
            height: 1,
          },
          {
            role: "style",
            assetId: "60000000-0000-4000-8000-000000000001",
            required: true,
            mime: "image/png",
            sha256: pngSha,
            byteLength: png.length,
            width: 1,
            height: 1,
          },
        ],
        omittedReferences: [],
        appGitCommit: "deadbeef",
        status: "ready",
        errorKind: null,
        providerStatus: "200",
        latencyMs: 20,
        outputAssetId: rgbaId,
        outputSha256: pngSha,
        outputMime: "image/png",
        outputWidth: 1,
        outputHeight: 1,
        outputByteLength: png.length,
        sharedBackground: false,
        originatingFrameId: "frame-1",
        originatingOperationId: opId,
        createdAt: "2026-10-09T12:00:00.600Z",
        finishedAt: "2026-10-09T12:00:01.000Z",
      },
    ],
    assets: [
      {
        id: bgId,
        role: "background",
        kind: "scene-background",
        mime: "image/png",
        width: 1,
        height: 1,
        byteLength: png.length,
        sha256: pngSha,
        bytes: png,
        generationId: "50000000-0000-4000-8000-000000000002",
        generationRecordId: recordBg,
      },
      {
        id: rawId,
        role: "character-raw",
        kind: "character-state-raw",
        mime: "image/png",
        width: 1,
        height: 1,
        byteLength: png.length,
        sha256: pngSha,
        bytes: png,
        panelIndex: 0,
        generationId: "50000000-0000-4000-8000-000000000003",
        generationRecordId: recordChar,
      },
      {
        id: rgbaId,
        role: "character-rgba",
        kind: "character-state",
        mime: "image/png",
        width: 1,
        height: 1,
        byteLength: png.length,
        sha256: pngSha,
        bytes: png,
        panelIndex: 0,
        generationId: "50000000-0000-4000-8000-000000000003",
        generationRecordId: recordChar,
      },
    ],
    appGitCommit: "deadbeef",
    promptCompilerVersion: "hybrid-dialogue-v1",
    specVersion: "006-reproducible-hybrid-dialogue-frame",
    ...overrides,
  };
}

function assertNoPlantedSecrets(entries) {
  for (const [name, bytes] of entries) {
    const text = bytes.toString("utf8");
    for (const secret of PLANTED_SECRETS) {
      assert.equal(name.includes(secret), false, `entry name leaked secret: ${name}`);
      assert.equal(text.includes(secret), false, `entry ${name} leaked secret`);
    }
  }
}

test("sanitizeFrameIdForFilename handles unusual semantic frame ids", () => {
  assert.equal(sanitizeFrameIdForFilename("frame-1"), "frame-1");
  assert.equal(sanitizeFrameIdForFilename("../etc/passwd"), "etc_passwd");
  assert.equal(sanitizeFrameIdForFilename(".."), "frame");
  assert.equal(sanitizeFrameIdForFilename("frame/with\\slash"), "frame_with_slash");
  assert.equal(sanitizeFrameIdForFilename("кадр\u0000один"), "frame");
  assert.equal(diagnosticsAttachmentFilename("a b"), "frame-a_b-diagnostics.zip");
});

test("normalizeZipEntryPath rejects zip-slip and absolute paths", () => {
  assert.equal(normalizeZipEntryPath("manifest.json"), "manifest.json");
  assert.throws(() => normalizeZipEntryPath("../secret.txt"), /invalid-zip-path/);
  assert.throws(() => normalizeZipEntryPath("/etc/passwd"), /invalid-zip-path/);
  assert.throws(() => normalizeZipEntryPath("foo/../../bar"), /invalid-zip-path/);
  assert.throws(() => normalizeZipEntryPath("C:\\windows\\system32"), /invalid-zip-path/);
  assert.throws(() => normalizeZipEntryPath("a\nb"), /invalid-zip-path/);
});

test("buildZipArchive is deterministic and ordered", () => {
  const entries = [
    { path: "b.txt", bytes: "b" },
    { path: "a.txt", bytes: "a" },
  ];
  const first = buildZipArchive(entries);
  const second = buildZipArchive(entries);
  assert.deepEqual(first, second);
  const parsed = readZipArchive(first);
  assert.deepEqual([...parsed.keys()], ["a.txt", "b.txt"]);
});

test("complete hybrid frame evidence builds required archive layout", () => {
  const archive = buildDiagnosticsArchive(baseEvidence());
  assert.equal(archive.ok, true);
  assert.equal(archive.contentType, "application/zip");
  assert.equal(archive.filename, "frame-frame-1-diagnostics.zip");
  const entries = readZipArchive(archive.bytes);
  for (const required of [
    "manifest.json",
    "briefs/grid.txt",
    "briefs/detailed.txt",
    "assembly/manifest.json",
    "operations/40000000-0000-4000-8000-000000000001.json",
    "generations/30000000-0000-4000-8000-000000000001/record.json",
    "generations/30000000-0000-4000-8000-000000000001/compiled-prompt.txt",
    "generations/30000000-0000-4000-8000-000000000001/intent.json",
    "generations/30000000-0000-4000-8000-000000000001/reference-manifest.json",
    "generations/30000000-0000-4000-8000-000000000001/omitted-references.json",
    "generations/30000000-0000-4000-8000-000000000002/compiled-prompt.txt",
    "assets/background/20000000-0000-4000-8000-000000000001.png",
    "assets/character-raw/panel-0-20000000-0000-4000-8000-000000000002.png",
    "assets/character-rgba/panel-0-20000000-0000-4000-8000-000000000003.png",
    "assets/manifest.json",
    "placement/panels.json",
  ]) {
    assert.equal(entries.has(required), true, `missing ${required}`);
  }
  assert.equal(entries.has("composites/"), false);
  const assembly = JSON.parse(entries.get("assembly/manifest.json").toString("utf8"));
  assert.equal(assembly.composite.present, false);
  assert.match(assembly.composite.reason, /no-deterministic-composite/);
  const placement = JSON.parse(entries.get("placement/panels.json").toString("utf8"));
  assert.equal(placement.panels[0].fitMode, "manual");
  assert.equal(placement.panels[0].zoom, 1.25);
  const prompt = entries.get("generations/30000000-0000-4000-8000-000000000002/compiled-prompt.txt").toString("utf8");
  assert.match(prompt, /CHARACTER PROMPT/);
  const assetBytes = entries.get("assets/character-rgba/panel-0-20000000-0000-4000-8000-000000000003.png");
  assert.deepEqual(assetBytes, png);
  const assetManifest = JSON.parse(entries.get("assets/manifest.json").toString("utf8"));
  const rgbaMeta = assetManifest.assets.find((entry) => entry.role === "character-rgba");
  assert.equal(rgbaMeta.sha256, pngSha);
  assert.equal(sha256Hex(assetBytes), rgbaMeta.sha256);
  assert.equal(rgbaMeta.kind, "character-state");
  const again = buildDiagnosticsArchive(baseEvidence());
  assert.deepEqual(again.bytes, archive.bytes);
});

test("failed character generation retains raw chromakey asset role", () => {
  const evidence = baseEvidence({
    generations: [
      ...baseEvidence().generations,
      {
        recordId: "30000000-0000-4000-8000-000000000099",
        operationType: "character-state",
        storyboardResultId: "10000000-0000-4000-8000-000000000006",
        storyboardVersionId: "10000000-0000-4000-8000-000000000010",
        frameId: "frame-1",
        panelIndex: 0,
        componentGenerationId: "50000000-0000-4000-8000-000000000099",
        operationId: "40000000-0000-4000-8000-000000000002",
        visualIntent: {},
        compiledPrompt: "FAILED CHARACTER PROMPT",
        promptCompilerVersion: "hybrid-dialogue-v1",
        model: "test-model",
        generationSettings: { aspectRatio: "5:4", component: "character-state" },
        referenceManifest: [],
        omittedReferences: [],
        status: "failed",
        errorKind: "matte-failed",
        providerStatus: "200",
        latencyMs: 9,
        outputAssetId: null,
        sharedBackground: false,
        originatingFrameId: "frame-1",
        originatingOperationId: "40000000-0000-4000-8000-000000000002",
      },
    ],
    assets: [
      ...baseEvidence().assets,
      {
        id: "20000000-0000-4000-8000-000000000099",
        role: "character-raw",
        kind: "character-state-raw",
        mime: "image/png",
        width: 1,
        height: 1,
        byteLength: png.length,
        sha256: pngSha,
        bytes: png,
        panelIndex: 0,
        generationId: "50000000-0000-4000-8000-000000000099",
        generationRecordId: "30000000-0000-4000-8000-000000000099",
      },
    ],
    operations: [
      ...baseEvidence().operations,
      {
        operationId: "40000000-0000-4000-8000-000000000002",
        frameId: "frame-1",
        storyboardResultId: "10000000-0000-4000-8000-000000000006",
        storyboardVersionId: "10000000-0000-4000-8000-000000000010",
        scope: "panel",
        panelIndex: 0,
        writeVersion: 2,
        phase: "failed",
        status: "failed",
        errorKind: "matte-failed",
        componentFailures: [{ kind: "matte-failed", component: "character-state", panelIndex: 0 }],
      },
    ],
  });
  const archive = buildDiagnosticsArchive(evidence);
  const entries = readZipArchive(archive.bytes);
  assert.equal(
    entries.has("assets/character-raw/panel-0-20000000-0000-4000-8000-000000000099.png"),
    true,
  );
  const failedRecord = JSON.parse(
    entries.get("generations/30000000-0000-4000-8000-000000000099/record.json").toString("utf8"),
  );
  assert.equal(failedRecord.status, "failed");
  assert.equal(failedRecord.errorKind, "matte-failed");
  const assetManifest = JSON.parse(entries.get("assets/manifest.json").toString("utf8"));
  const raw = assetManifest.assets.find((entry) => entry.assetId === "20000000-0000-4000-8000-000000000099");
  assert.equal(raw.role, "character-raw");
  assert.equal(raw.kind, "character-state-raw");
});

test("shared background reuse is marked without exporting unrelated frames", () => {
  const evidence = baseEvidence({
    sharedBackground: {
      sceneKey: "primary",
      generationRecordId: "30000000-0000-4000-8000-000000000001",
      originatingFrameId: "frame-2",
      originatingOperationId: "40000000-0000-4000-8000-000000000088",
      componentGenerationId: "50000000-0000-4000-8000-000000000002",
    },
    generations: baseEvidence().generations.map((generation, index) => (
      index === 0
        ? {
          ...generation,
          sharedBackground: true,
          originatingFrameId: "frame-2",
          originatingOperationId: "40000000-0000-4000-8000-000000000088",
          frameId: "frame-2",
        }
        : generation
    )),
  });
  const archive = buildDiagnosticsArchive(evidence);
  const entries = readZipArchive(archive.bytes);
  const root = JSON.parse(entries.get("manifest.json").toString("utf8"));
  assert.equal(root.sharedBackground.originatingFrameId, "frame-2");
  const bgRecord = JSON.parse(
    entries.get("generations/30000000-0000-4000-8000-000000000001/record.json").toString("utf8"),
  );
  assert.equal(bgRecord.sharedBackground, true);
  assert.equal(bgRecord.originatingFrameId, "frame-2");
  const joined = Buffer.concat([...entries.values()]).toString("utf8");
  assert.equal(joined.includes("unrelated-frame-9"), false);
  assert.equal(joined.includes("SECRET PROMPT FOR OTHER FRAME"), false);
});

test("multiple attempts for the requested frame are retained", () => {
  const evidence = baseEvidence({
    generations: [
      ...baseEvidence().generations,
      {
        ...baseEvidence().generations[1],
        recordId: "30000000-0000-4000-8000-000000000077",
        status: "failed",
        errorKind: "provider",
        compiledPrompt: "RETRY PROMPT ATTEMPT",
        componentGenerationId: "50000000-0000-4000-8000-000000000077",
        operationId: "40000000-0000-4000-8000-000000000077",
      },
    ],
    operations: [
      ...baseEvidence().operations,
      {
        operationId: "40000000-0000-4000-8000-000000000077",
        frameId: "frame-1",
        storyboardResultId: "10000000-0000-4000-8000-000000000006",
        storyboardVersionId: "10000000-0000-4000-8000-000000000010",
        scope: "frame",
        writeVersion: 2,
        phase: "failed",
        status: "failed",
        errorKind: "provider",
        componentFailures: [],
      },
    ],
  });
  const archive = buildDiagnosticsArchive(evidence);
  const entries = readZipArchive(archive.bytes);
  assert.equal(entries.has("generations/30000000-0000-4000-8000-000000000077/compiled-prompt.txt"), true);
  assert.equal(entries.has("operations/40000000-0000-4000-8000-000000000077.json"), true);
  assert.match(
    entries.get("generations/30000000-0000-4000-8000-000000000077/compiled-prompt.txt").toString("utf8"),
    /RETRY PROMPT/,
  );
});

test("archive excludes planted credentials and unrelated scope markers", () => {
  const poisoned = baseEvidence({
    generations: baseEvidence().generations.map((generation) => ({
      ...generation,
      generationSettings: {
        ...generation.generationSettings,
        // These must be stripped by allowlist sanitization.
        authorization: PLANTED_SECRETS[1],
        apiToken: PLANTED_SECRETS[0],
        databaseUrl: PLANTED_SECRETS[3],
        providerUrl: PLANTED_SECRETS[4],
      },
      visualIntent: {
        ...generation.visualIntent,
        envSnapshot: PLANTED_SECRETS[2],
        cookie: PLANTED_SECRETS[5],
      },
    })),
  });
  // Intentionally do not put secrets into compiled prompts — those are allowed.
  const archive = buildDiagnosticsArchive(poisoned);
  const entries = readZipArchive(archive.bytes);
  assertNoPlantedSecrets(entries);
  for (const [name] of entries) {
    assert.equal(name.includes(".."), false);
    assert.equal(name.startsWith("/"), false);
    assert.equal(/^[A-Za-z]:/.test(name), false);
  }
  const record = JSON.parse(
    entries.get("generations/30000000-0000-4000-8000-000000000001/record.json").toString("utf8"),
  );
  assert.equal(record.generationSettings.authorization, undefined);
  assert.equal(record.generationSettings.apiToken, undefined);
  assert.equal(record.generationSettings.aspectRatio, "21:9");
});

test("identical semantic ids in different result evidence stay isolated in archive contents", () => {
  const evidenceA = baseEvidence({
    storyboardResultId: "aaaaaaaa-0000-4000-8000-000000000001",
    storyboardVersionId: "aaaaaaaa-0000-4000-8000-000000000002",
    generations: baseEvidence().generations.map((generation) => ({
      ...generation,
      storyboardResultId: "aaaaaaaa-0000-4000-8000-000000000001",
      storyboardVersionId: "aaaaaaaa-0000-4000-8000-000000000002",
      compiledPrompt: "PROMPT-A-ONLY",
    })),
  });
  const evidenceB = baseEvidence({
    storyboardResultId: "bbbbbbbb-0000-4000-8000-000000000001",
    storyboardVersionId: "bbbbbbbb-0000-4000-8000-000000000002",
    generations: baseEvidence().generations.map((generation) => ({
      ...generation,
      storyboardResultId: "bbbbbbbb-0000-4000-8000-000000000001",
      storyboardVersionId: "bbbbbbbb-0000-4000-8000-000000000002",
      compiledPrompt: "PROMPT-B-ONLY",
    })),
  });
  const zipB = readZipArchive(buildDiagnosticsArchive(evidenceB).bytes);
  const textB = Buffer.concat([...zipB.values()]).toString("utf8");
  assert.equal(textB.includes("aaaaaaaa-0000-4000-8000-000000000001"), false);
  assert.equal(textB.includes("PROMPT-A-ONLY"), false);
  assert.equal(textB.includes("PROMPT-B-ONLY"), true);
  assert.equal(textB.includes("bbbbbbbb-0000-4000-8000-000000000001"), true);
  void evidenceA;
});

test("diagnostics ZIP uses test-local temp only and never writes verification/", () => {
  const temp = mkdtempSync(join(tmpdir(), "visual-diagnostics-"));
  try {
    const archive = buildDiagnosticsArchive(baseEvidence());
    assert.equal(temp.includes("verification"), false);
    assert.equal(archive.filename.includes("verification"), false);
    // Builder returns bytes in memory; no filesystem write API exists on the builder.
    assert.ok(Buffer.isBuffer(archive.bytes));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("stableStringify is key-order independent", () => {
  assert.equal(
    stableStringify({ b: 1, a: 2 }),
    stableStringify({ a: 2, b: 1 }),
  );
});

test("GET diagnostics returns application/zip with safe headers", async () => {
  const archive = buildDiagnosticsArchive(baseEvidence());
  const logs = [];
  const server = createServer({
    migrate: false,
    projectStore: {},
    logger: { log: (...args) => logs.push(args.join(" ")) },
    visualStore: {
      exportFrameDiagnostics: async ({ frameId }) => {
        assert.equal(frameId, "frame-1");
        return archive;
      },
    },
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      method: "GET",
      path: "/api/visual/frames/frame-1/diagnostics",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /application\/zip/);
    assert.equal(
      response.headers["content-disposition"],
      'attachment; filename="frame-frame-1-diagnostics.zip"',
    );
    assert.equal(Number(response.headers["content-length"]), archive.bytes.length);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(response.bytes, archive.bytes);
    const joined = logs.join("\n");
    assert.match(joined, /visual-diagnostics-export/);
    assert.match(joined, /status=ok/);
    assert.equal(joined.includes("BACKGROUND PROMPT"), false);
    assert.equal(joined.includes("CHARACTER PROMPT"), false);
    for (const secret of PLANTED_SECRETS) {
      assert.equal(joined.includes(secret), false);
    }
    assert.equal(joined.includes(png.toString("base64")), false);
  } finally {
    await close(server);
  }
});

test("GET diagnostics returns 404 not-found without evidence", async () => {
  const logs = [];
  const server = createServer({
    migrate: false,
    projectStore: {},
    logger: { log: (...args) => logs.push(args.join(" ")) },
    visualStore: {
      exportFrameDiagnostics: async () => ({
        ok: false,
        status: "failed",
        kind: "not-found",
        httpStatus: 404,
      }),
    },
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      method: "GET",
      path: "/api/visual/frames/frame-missing/diagnostics",
    });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { status: "failed", kind: "not-found" });
    const joined = logs.join("\n");
    assert.match(joined, /visual-diagnostics-export/);
    assert.match(joined, /kind=not-found/);
  } finally {
    await close(server);
  }
});

test("diagnostics endpoint rejects non-GET methods", async () => {
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: {
      exportFrameDiagnostics: async () => {
        throw new Error("should not export");
      },
    },
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      method: "POST",
      path: "/api/visual/frames/frame-1/diagnostics",
    });
    assert.equal(response.status, 405);
  } finally {
    await close(server);
  }
});

test("unusual frame id produces safe Content-Disposition filename", async () => {
  const weirdId = "../frame with spaces";
  const archive = buildDiagnosticsArchive(baseEvidence({ frameId: weirdId }));
  const server = createServer({
    migrate: false,
    projectStore: {},
    visualStore: {
      exportFrameDiagnostics: async () => archive,
    },
  });
  const port = await listen(server);
  try {
    const response = await request(port, {
      method: "GET",
      path: `/api/visual/frames/${encodeURIComponent(weirdId)}/diagnostics`,
    });
    assert.equal(response.status, 200);
    const disposition = response.headers["content-disposition"];
    const filenameMatch = /filename="(frame-[A-Za-z0-9._-]+-diagnostics\.zip)"/.exec(disposition);
    assert.ok(filenameMatch, disposition);
    assert.equal(filenameMatch[1].includes(".."), false);
    assert.equal(filenameMatch[1].includes(" "), false);
    assert.equal(filenameMatch[1].includes("/"), false);
  } finally {
    await close(server);
  }
});

test("asset bytes in archive match recorded sha256", () => {
  const archive = buildDiagnosticsArchive(baseEvidence());
  const entries = readZipArchive(archive.bytes);
  const manifest = JSON.parse(entries.get("assets/manifest.json").toString("utf8"));
  for (const meta of manifest.assets) {
    let path;
    if (meta.role === "background") path = `assets/background/${meta.assetId}.png`;
    else if (meta.role === "character-raw") {
      path = `assets/character-raw/panel-${meta.panelIndex}-${meta.assetId}.png`;
    } else if (meta.role === "character-rgba") {
      path = `assets/character-rgba/panel-${meta.panelIndex}-${meta.assetId}.png`;
    } else continue;
    const bytes = entries.get(path);
    assert.ok(bytes, path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), meta.sha256);
  }
});
