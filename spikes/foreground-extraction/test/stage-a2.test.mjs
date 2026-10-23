import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { MATTE_CONTRACT_SHA256, MATTE_CONTRACT_TEXT, MATTE_CONTRACT_VERSION } from "../stage-a2/contract.mjs";
import {
  STAGE_A2_IDENTITIES,
  buildMatrix,
  compileAnchorContract,
  compilePanelContract,
} from "../stage-a2/matrix.mjs";
import { ABSOLUTE_CEILING, PHASE_RETRY_LIMIT, PRIMARY_CEILING, evaluateInvocation } from "../stage-a2/policy.mjs";
import { A2_ARTIFACT_NAMES, createStageA2Server } from "../stage-a2/review-server.mjs";
import { runStageA2 } from "../stage-a2/run.mjs";
import { buildStageA2OwnerReviewExport } from "../review.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function tinyPng(red = 90) {
  return sharp({
    create: { width: 32, height: 40, channels: 3, background: { r: red, g: 110, b: 134 } },
  }).png().toBuffer();
}

function identitiesFor(bytes, { archivePaths = null } = {}) {
  return STAGE_A2_IDENTITIES.map((identity, index) => ({
    id: identity.id,
    characterName: identity.characterName,
    sha256: sha256(bytes),
    mime: "image/png",
    extension: "png",
    bytes,
    archivePath: archivePaths ? archivePaths[index] : null,
  }));
}

function passExtraction(status = "candidate-pass") {
  return () => ({
    status,
    reasons: status === "reject" ? ["non-uniform-matte"] : [],
    warnings: status === "review" ? ["canvas-edge-contact"] : [],
    findings: [],
    rgba: null,
    boundary: null,
    metrics: {},
    config: { version: "a1-known-matte-v2" },
  });
}

function successImage(bytes, extra = {}) {
  return {
    ok: true,
    image: { bytes, mime: "image/png", width: 32, height: 40 },
    metadata: { providerStatus: 200, latencyMs: 5, model: "fake-model", finishReason: "stop", ...extra },
  };
}

function failedImage(kind, providerStatus = null) {
  return {
    ok: false,
    status: "failed",
    kind,
    httpStatus: 502,
    diagnostics: {
      ...(providerStatus == null ? {} : { providerStatus }),
      latencyMs: 4,
    },
  };
}

function scripted(steps, calls, bytes) {
  return async (input) => {
    calls.push(input.serializedBody);
    const step = steps[calls.length - 1];
    if (!step) throw new Error(`unexpected provider call ${calls.length}`);
    if (step === "throw") throw new Error("connection reset");
    if (step === "ok") return successImage(bytes);
    if (step === "timeout") return failedImage("timeout");
    if (step === "429") return failedImage("provider", 429);
    if (step === "500") return failedImage("provider", 500);
    if (step === "400") return failedImage("provider", 400);
    if (step === "413") return failedImage("provider-payload-too-large", 413);
    if (step === "401") return failedImage("provider", 401);
    if (step === "configuration") return failedImage("configuration");
    if (step === "invalid-output") return failedImage("invalid-output", 200);
    return step(input);
  };
}

async function harness(name) {
  const bytes = await tinyPng();
  const root = mkdtempSync(join(tmpdir(), `spike-a2-${name}-`));
  return {
    bytes,
    root,
    identities: identitiesFor(bytes),
    runId: `a2-test-${name}`,
  };
}

test("matrix is exactly three identities and nine cells", () => {
  assert.deepEqual(STAGE_A2_IDENTITIES.map((identity) => identity.id), ["identity-1", "identity-2", "identity-3"]);
  const cells = buildMatrix();
  assert.equal(cells.length, 9);
  assert.deepEqual(cells.map((cell) => cell.id), [
    "identity-1-anchor",
    "identity-1-panel-close",
    "identity-1-panel-gesture",
    "identity-2-anchor",
    "identity-2-panel-close",
    "identity-2-panel-gesture",
    "identity-3-anchor",
    "identity-3-panel-close",
    "identity-3-panel-gesture",
  ]);
  assert.deepEqual(cells.filter((cell) => cell.cell === "anchor").map((cell) => cell.aspectRatio), ["4:5", "4:5", "4:5"]);
  assert.equal(cells.filter((cell) => cell.cell.startsWith("panel-")).length, 6);
});

test("direct-source anchors compile to one identity reference and panels reuse that anchor", async () => {
  const bytes = await tinyPng();
  const anchor = compileAnchorContract({ bytes, mime: "image/png" });
  assert.equal(anchor.ok, true, anchor.problems?.join(","));
  assert.deepEqual(anchor.roles, ["identity"]);
  assert.equal(anchor.referenceCount, 1);
  assert.equal(anchor.aspectRatio, "4:5");
  const asset = { id: "identity-1-anchor", bytes, mime: "image/png" };
  for (const cell of ["panel-close", "panel-gesture"]) {
    const panel = compilePanelContract({
      identity: STAGE_A2_IDENTITIES[0],
      cell,
      anchor: asset,
    });
    assert.equal(panel.ok, true, panel.problems?.join(","));
    assert.equal(panel.identityAlsoStyle, true);
    assert.deepEqual(panel.roles, ["anchor"]);
    assert.equal(panel.referenceCount, 1);
    assert.equal(panel.aspectRatio, "5:4");
    assert.equal(panel.basePrompt.includes("Image 1 is both the approved identity anchor"), true);
    assert.equal(panel.basePrompt.includes("Image 2"), false);
  }
  const close = compilePanelContract({
    identity: STAGE_A2_IDENTITIES[0],
    cell: "panel-close",
    anchor: asset,
  });
  const gesture = compilePanelContract({
    identity: STAGE_A2_IDENTITIES[0],
    cell: "panel-gesture",
    anchor: asset,
  });
  assert.equal(close.intent.framing, "close-up");
  assert.equal(close.intent.gesture, "hands outside crop");
  assert.equal(close.intent.expression, "calm");
  assert.equal(close.intent.speakingRole, "listening");
  assert.equal(gesture.intent.framing, "waist-up");
  assert.equal(gesture.intent.gesture, "open-palm hand raised in crop");
  assert.equal(gesture.intent.expression, "self-confident");
  assert.equal(gesture.intent.speakingRole, "speaking");
});

test("the matte suffix is immutable on every compiled cell", async () => {
  const bytes = await tinyPng();
  assert.match(MATTE_CONTRACT_TEXT, /uniform solid muted slate-blue technical matte filling every edge and corner/);
  assert.match(MATTE_CONTRACT_TEXT, /No gradient, texture, lighting variation, vignette, frame, border, card, nested panel, or incomplete matte/);
  assert.match(MATTE_CONTRACT_TEXT, /No glow, rim light, halo, soft shadow, or drop shadow on the matte/);
  assert.match(MATTE_CONTRACT_TEXT, /clean decisive near-black outer contour/);
  assert.match(MATTE_CONTRACT_TEXT, /No sticker outline or second outer border/);
  assert.match(MATTE_CONTRACT_TEXT, /No hair strand, clothing detail, gesture fragment/);
  assert.equal(MATTE_CONTRACT_VERSION, "stage-a2-matte-contract-v1");
  assert.equal(sha256(MATTE_CONTRACT_TEXT), MATTE_CONTRACT_SHA256);
  const anchor = compileAnchorContract({ bytes, mime: "image/png" });
  const asset = { id: "identity-1-anchor", bytes, mime: "image/png" };
  const prompts = [anchor.prompt];
  for (const identity of STAGE_A2_IDENTITIES) {
    for (const cell of ["panel-close", "panel-gesture"]) {
      prompts.push(compilePanelContract({ identity, cell, anchor: { ...asset, id: `${identity.id}-anchor` } }).prompt);
    }
  }
  assert.equal(prompts.length, 7);
  for (const prompt of prompts) {
    assert.equal(prompt.endsWith(MATTE_CONTRACT_TEXT), true);
    assert.equal(prompt.includes(MATTE_CONTRACT_VERSION), true);
  }
  const cells = buildMatrix();
  assert.equal(cells.length, 9);
  assert.equal(new Set(prompts.map(() => MATTE_CONTRACT_SHA256)).size, 1);
});

test("dry-run prepares anchor requests and makes zero provider calls", async () => {
  const { bytes, root, identities, runId } = await harness("dry");
  let calls = 0;
  const result = await runStageA2({
    mode: "dry-run",
    outputRoot: root,
    runId,
    identities,
    env: {},
    imageGenerator: () => {
      calls += 1;
      throw new Error("provider");
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.payload.summary.succeeded, 0);
  assert.equal(result.payload.summary.attempted, 0);
  assert.equal(result.payload.summary.planned, 9);
  assert.equal(result.payload.extractor.version, "a1-known-matte-v2");
  const anchors = result.payload.cells.filter((cell) => cell.cell === "anchor");
  assert.equal(anchors.length, 3);
  for (const cell of anchors) {
    assert.equal(cell.state, "unattempted");
    assert.equal(cell.request.referenceRoles.join(","), "identity");
    assert.match(cell.request.sha256, /^[a-f0-9]{64}$/);
    assert.equal(cell.contract.contractSha256, MATTE_CONTRACT_SHA256);
    assert.ok(cell.request.finalBodyBytes > 0);
  }
  for (const cell of result.payload.cells.filter((item) => item.cell !== "anchor")) {
    assert.equal(cell.contract.requestPrepared, false);
    assert.equal(cell.contract.identityAlsoStyle, true);
    assert.equal(cell.state, "unattempted");
  }
});

test("a successful provider output is extracted before the next provider call", async () => {
  const { bytes, root, identities, runId } = await harness("order");
  const order = [];
  await runStageA2({
    mode: "live",
    outputRoot: root,
    runId,
    identities,
    env: {},
    imageGenerator: async () => {
      order.push("provider");
      return successImage(bytes);
    },
    extractImpl: (_decoded, context) => {
      order.push(`extract:${context.cell.id}`);
      return passExtraction()();
    },
  });
  assert.deepEqual(order, [
    "provider", "extract:identity-1-anchor",
    "provider", "extract:identity-1-panel-close",
    "provider", "extract:identity-1-panel-gesture",
    "provider", "extract:identity-2-anchor",
    "provider", "extract:identity-2-panel-close",
    "provider", "extract:identity-2-panel-gesture",
    "provider", "extract:identity-3-anchor",
    "provider", "extract:identity-3-panel-close",
    "provider", "extract:identity-3-panel-gesture",
  ]);
});

test("automatic reject blocks downstream panels and review lineage stays marked", async () => {
  const { bytes, root, identities } = await harness("gate");
  const calls = [];
  const rejected = await runStageA2({
    mode: "live",
    outputRoot: join(root, "reject"),
    runId: "a2-test-reject",
    identities,
    env: {},
    imageGenerator: scripted(Array(7).fill("ok"), calls, bytes),
    extractImpl: (_decoded, context) => passExtraction(context.cell.id === "identity-1-anchor" ? "reject" : "candidate-pass")(),
  });
  const firstPanels = rejected.payload.cells.filter((cell) => cell.identityId === "identity-1" && cell.cell !== "anchor");
  assert.deepEqual(firstPanels.map((cell) => cell.state), ["unattempted", "unattempted"]);
  assert.deepEqual(firstPanels.map((cell) => cell.unattemptedReason), ["anchor-automatic-reject", "anchor-automatic-reject"]);
  assert.equal(rejected.payload.cells.find((cell) => cell.id === "identity-2-anchor").state, "succeeded");
  assert.equal(calls.length, 7);

  const reviewCalls = [];
  const reviewed = await runStageA2({
    mode: "live",
    outputRoot: join(root, "review"),
    runId: "a2-test-review",
    identities,
    env: {},
    imageGenerator: scripted(Array(9).fill("ok"), reviewCalls, bytes),
    extractImpl: (_decoded, context) => passExtraction(context.cell.cell === "anchor" ? "review" : "candidate-pass")(),
  });
  for (const identity of ["identity-1", "identity-2", "identity-3"]) {
    const anchor = reviewed.payload.cells.find((cell) => cell.id === `${identity}-anchor`);
    assert.equal(anchor.extraction.status, "review");
    assert.notEqual(anchor.extraction.status, "candidate-pass");
    for (const cell of reviewed.payload.cells.filter((item) => item.identityId === identity && item.cell !== "anchor")) {
      assert.equal(cell.state, "succeeded");
      assert.equal(cell.reviewRisk, true);
      assert.equal(cell.lineage.upstreamAutomaticStatus, "review");
      assert.equal(cell.lineage.reviewRisk, true);
      assert.equal(cell.extraction.status, "candidate-pass");
    }
  }
});

test("retries stay byte-identical, phase-limited, and inside the absolute ceiling", async () => {
  assert.equal(PRIMARY_CEILING, 9);
  assert.equal(ABSOLUTE_CEILING, 11);
  assert.equal(PHASE_RETRY_LIMIT, 1);
  assert.equal(evaluateInvocation({
    invocations: 11,
    isRetry: true,
    phase: "panel",
    failure: { ok: false, kind: "timeout" },
    priorRequestSha256: "a",
    retryRequestSha256: "a",
  }).stop, "absolute-ceiling");
  assert.equal(evaluateInvocation({
    invocations: 1,
    isRetry: true,
    phase: "anchor",
    phaseRetries: { anchor: 1, panel: 0 },
    failure: { ok: false, kind: "timeout" },
    priorRequestSha256: "a",
    retryRequestSha256: "a",
  }).reason, "phase-retry-exhausted");
  assert.equal(evaluateInvocation({
    invocations: 1,
    isRetry: true,
    phase: "panel",
    failure: { ok: false, kind: "provider", diagnostics: { providerStatus: 400 } },
    priorRequestSha256: "a",
    retryRequestSha256: "a",
  }).reason, "not-eligible");
  assert.equal(evaluateInvocation({
    invocations: 1,
    isRetry: true,
    phase: "anchor",
    failure: { ok: false, kind: "timeout" },
    priorRequestSha256: "abc",
    retryRequestSha256: "def",
  }).stop, "request-contract-mismatch");

  const { bytes, root, identities } = await harness("retry");
  const calls = [];
  const steps = ["timeout", "ok", "ok", "ok", "timeout", "ok", "ok", "ok"];
  const result = await runStageA2({
    mode: "live",
    outputRoot: root,
    runId: "a2-test-retry",
    identities,
    env: {},
    imageGenerator: scripted(steps, calls, bytes),
    extractImpl: passExtraction(),
  });
  assert.equal(calls[0], calls[1]);
  assert.equal(result.payload.cells.find((cell) => cell.id === "identity-1-anchor").providerAttempts, 2);
  assert.equal(result.payload.cells.find((cell) => cell.id === "identity-2-anchor").providerAttempts, 1);
  assert.equal(result.payload.cells.find((cell) => cell.id === "identity-2-panel-close").state, "unattempted");
  assert.equal(result.payload.retries.anchor, 1);
  assert.equal(result.providerCalls, 8);

  const mismatchCalls = [];
  const mismatch = await runStageA2({
    mode: "live",
    outputRoot: join(root, "mismatch"),
    runId: "a2-test-mismatch",
    identities,
    env: {},
    imageGenerator: scripted(["timeout", "ok"], mismatchCalls, bytes),
    extractImpl: passExtraction(),
    hooks: {
      beforeRetry: (prepared) => ({ serializedBody: `${prepared.serializedBody}x` }),
    },
  });
  assert.equal(mismatchCalls.length, 1);
  assert.equal(mismatch.payload.stopReason, "request-contract-mismatch");

  const ceilingCalls = [];
  const ceiling = await runStageA2({
    mode: "live",
    outputRoot: join(root, "ceiling"),
    runId: "a2-test-ceiling",
    identities,
    env: {},
    invocationCeiling: 1,
    imageGenerator: scripted(Array(9).fill("ok"), ceilingCalls, bytes),
    extractImpl: passExtraction(),
  });
  assert.equal(ceilingCalls.length, 1);
  assert.equal(ceiling.payload.stopReason, "absolute-ceiling");
  assert.equal(ceiling.payload.summary.unattempted, 8);
});

test("credential, contract, consecutive transient, and HTTP 413 failures stop the run", async () => {
  const { bytes, root, identities } = await harness("stop");
  const cases = [
    ["configuration", "a2-test-config", "credential-or-configuration"],
    ["401", "a2-test-auth", "credential-or-configuration"],
    ["413", "a2-test-large", "http-413"],
  ];
  for (const [step, runId, reason] of cases) {
    const calls = [];
    const result = await runStageA2({
      mode: "live",
      outputRoot: join(root, runId),
      runId,
      identities,
      env: {},
      imageGenerator: scripted([step, "ok"], calls, bytes),
      extractImpl: passExtraction(),
    });
    assert.equal(calls.length, 1, reason);
    assert.equal(result.payload.stopReason, reason);
    assert.equal(result.payload.cells[1].state, "unattempted");
  }

  const contractCalls = [];
  const contract = await runStageA2({
    mode: "live",
    outputRoot: join(root, "contract"),
    runId: "a2-test-contract",
    identities,
    env: {},
    imageGenerator: scripted(["ok"], contractCalls, bytes),
    extractImpl: passExtraction(),
    hooks: {
      afterPrepare: (prepared) => ({
        ...prepared,
        references: prepared.references.map((reference) => ({ ...reference, role: "style" })),
      }),
    },
  });
  assert.equal(contractCalls.length, 0);
  assert.equal(contract.payload.stopReason, "request-contract-mismatch");

  const transientCalls = [];
  const transient = await runStageA2({
    mode: "live",
    outputRoot: join(root, "transient"),
    runId: "a2-test-transient",
    identities,
    env: {},
    imageGenerator: scripted(["timeout", "throw", "ok"], transientCalls, bytes),
    extractImpl: passExtraction(),
  });
  assert.equal(transientCalls.length, 2);
  assert.equal(transient.payload.stopReason, "consecutive-transient-failures");
  assert.equal(transient.payload.cells.find((cell) => cell.id === "identity-1-panel-close").state, "unattempted");
});

test("resume never repeats a successful cell", async () => {
  const { bytes, root, identities } = await harness("resume");
  const firstCalls = [];
  const directory = join(root, "run");
  await assert.rejects(() => runStageA2({
    mode: "live",
    outputRoot: directory,
    runId: "a2-test-resume",
    identities,
    env: {},
    imageGenerator: scripted(["ok"], firstCalls, bytes),
    extractImpl: passExtraction(),
    hooks: {
      afterCell: (cell) => {
        if (cell.id === "identity-1-anchor") throw new Error("crash");
      },
    },
  }));
  const anchorFile = join(directory, "a2-test-resume", "identity-1-anchor", "original.png");
  const before = sha256(readFileSync(anchorFile));
  const secondCalls = [];
  const resumed = await runStageA2({
    mode: "live",
    identities,
    env: {},
    resumeDirectory: join(directory, "a2-test-resume"),
    imageGenerator: scripted(Array(8).fill("ok"), secondCalls, bytes),
    extractImpl: passExtraction(),
  });
  assert.equal(firstCalls.length, 1);
  assert.equal(secondCalls.length, 8);
  assert.equal(sha256(readFileSync(anchorFile)), before);
  assert.equal(resumed.payload.summary.succeeded, 9);
  const doneCalls = [];
  await runStageA2({
    mode: "live",
    identities,
    env: {},
    resumeDirectory: join(directory, "a2-test-resume"),
    imageGenerator: scripted(["ok"], doneCalls, bytes),
    extractImpl: passExtraction(),
  });
  assert.equal(doneCalls.length, 0);
});

test("manifest redaction and source/output bytes stay immutable", async () => {
  const bytes = await tinyPng(12);
  const root = mkdtempSync(join(tmpdir(), "spike-a2-redact-"));
  const archive = join(root, "archive");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(archive);
  const archivePaths = [];
  for (const identity of STAGE_A2_IDENTITIES) {
    const file = join(archive, `${identity.id}.png`);
    writeFileSync(file, bytes);
    archivePaths.push(file);
  }
  const before = archivePaths.map((file) => sha256(readFileSync(file)));
  const token = "stage-a2-super-secret-token";
  const calls = [];
  const result = await runStageA2({
    mode: "live",
    outputRoot: join(root, "out"),
    runId: "a2-test-redact",
    identities: identitiesFor(bytes, { archivePaths }),
    env: { CONTEST_API_TOKEN: token },
    imageGenerator: async (input) => {
      calls.push(input.serializedBody);
      return successImage(bytes, { model: token, authorization: `Bearer ${token}` });
    },
    extractImpl: passExtraction(),
  });
  const manifest = readFileSync(join(result.directory, "run.json"), "utf8");
  assert.equal(manifest.includes(token), false);
  assert.equal(manifest.includes("Bearer"), false);
  assert.equal(manifest.includes("authorization"), false);
  assert.equal(calls.length, 9);
  archivePaths.forEach((file, index) => {
    assert.equal(sha256(readFileSync(file)), before[index]);
  });
  for (const cell of result.payload.cells) {
    assert.equal(cell.output.unchangedAfterExtraction, true);
    const stored = sha256(readFileSync(join(result.directory, cell.output.file)));
    assert.equal(stored, cell.output.sha256);
  }
});

test("the reviewer serves only declared Stage A2 artifacts on localhost", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-a2-http-"));
  const runDir = join(root, "a2-test-http");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(runDir, "sources"), { recursive: true });
  mkdirSync(join(runDir, "identity-1-anchor"), { recursive: true });
  const source = await tinyPng();
  const output = await tinyPng(20);
  writeFileSync(join(runDir, "sources", "identity-1.png"), source);
  writeFileSync(join(runDir, "identity-1-anchor", "original.png"), output);
  writeFileSync(join(runDir, "identity-1-anchor", "notes.txt"), "secret");
  writeFileSync(join(runDir, "identity-1-anchor", ".env.local"), "TOKEN=1");
  writeFileSync(join(runDir, "run.sha256"), `${"a".repeat(64)}\n`);
  writeFileSync(join(runDir, "run.json"), JSON.stringify({
    stage: "a2",
    runId: "a2-test-http",
    providerInvocations: 1,
    stopReason: null,
    extractor: { version: "a1-known-matte-v2" },
    matteContract: { version: MATTE_CONTRACT_VERSION, sha256: MATTE_CONTRACT_SHA256 },
    summary: { planned: 9 },
    timing: {},
    model: "fake-model",
    sources: [
      { id: "identity-1", characterName: "Identity 1", sha256: sha256(source), mime: "image/png", copy: "sources/identity-1.png" },
      { id: "identity-2", characterName: "Identity 2", sha256: sha256(source), mime: "image/png", copy: "sources/identity-1.png" },
      { id: "identity-3", characterName: "Identity 3", sha256: sha256(source), mime: "image/png", copy: "sources/identity-1.png" },
    ],
    cells: [{
      id: "identity-1-anchor",
      identityId: "identity-1",
      cell: "anchor",
      state: "succeeded",
      reviewRisk: false,
      extraction: { status: "review", reasons: ["non-uniform-matte"], warnings: [] },
    }],
  }));
  const server = createStageA2Server({ runDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  const ask = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: address.port, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    assert.equal(A2_ARTIFACT_NAMES.has("notes.txt"), false);
    assert.equal(A2_ARTIFACT_NAMES.has("original.png"), true);
    const page = await ask("/");
    assert.equal(page.status, 200);
    assert.match(page.body.toString("utf8"), /Foreground extraction review/);
    const api = await ask("/api/run");
    const payload = JSON.parse(api.body.toString("utf8"));
    assert.equal(payload.stage, "a2");
    assert.equal(payload.identities.length, 3);
    assert.match(payload.ownerReview.reloadLoss, /reload/i);
    assert.equal((await ask("/artifact/identity-1-anchor/original.png")).status, 200);
    assert.equal((await ask("/artifact/identity-1-anchor/notes.txt")).status, 404);
    assert.equal((await ask("/artifact/identity-1-anchor/.env.local")).status, 400);
    assert.equal((await ask("/artifact/identity-1-anchor/../../run.json")).status, 400);
    assert.equal((await ask("/source/identity-1")).status, 200);
    const exported = buildStageA2OwnerReviewExport({
      runId: payload.runId,
      manifestHash: payload.manifestHash,
      items: [{
        id: "identity-1-anchor",
        identityId: "identity-1",
        cell: "anchor",
        attemptState: "succeeded",
        automaticStatus: "review",
        reviewRisk: true,
        judgement: null,
        note: "",
      }],
    });
    assert.equal(exported.prefilled, false);
    assert.equal(exported.items[0].judgement, null);
    assert.equal(exported.persistence, "browser-memory-only");
  } finally {
    server.close();
  }
});
