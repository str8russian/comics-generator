import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { createCallCeiling } from "../lib/ceiling.mjs";
import {
  CROSS_ATTEMPT_ORDER,
  CROSS_DISPLAY_CODE_ORDER,
  CROSS_IDENTITY_JUDGEMENT_FIELDS,
  CROSS_IDENTITY_STATEMENT,
  buildCrossIdentityMatrix,
} from "../lib/cross-identity.mjs";
import { sha256 } from "../lib/evidence.mjs";
import { buildCellEvidence } from "../lib/evidence.mjs";
import { verifyInputs, verifyRunInputs } from "../lib/inputs.mjs";
import { IDENTITY_COLOR_SAFEGUARD, compileConditionPrompt } from "../lib/prompts.mjs";
import { buildReviewModel, renderReviewPage } from "../lib/render-page.mjs";
import { createReviewServer, listenReviewServer } from "../lib/review-server.mjs";
import { executeRun, runMatrix } from "../lib/runner.mjs";
import { main } from "../live.mjs";

const BASELINE_HASH = "961636a7515e4de4c32f22edbb7d20a2fb4228ceb164794cee19e3ffd1e9555d";
const SAFEGUARD_HASH = "afc36cf898c7c0cd396eefbcb31877f25747becdf317b10812aec277f4dd4f8d";
const SOURCE_A_HASH = "a0b84af7f7330d3c713a1fb5ff5d79a4b51cd29093897d5103fa53fb9b6b5ba4";
const SOURCE_B_HASH = "1931b220eeeacfa82c24aa88f370b05a2fbc47e56173f3b3c00a4ed4e33e4c3e";
const SIBLING = "/Users/andrey/Documents/Projects/comics-pipeline-style-determinism-generation";
const referenceConfig = { ok: true, strategy: "budgeted", budgetBytes: 850_000 };
const model = "gemini-3-pro-image-preview";
const timeoutMs = 58_000;
const FULL_JUDGEMENT = {
  overall: "acceptable",
  identity: "recognizable",
  contour: "target",
  identityDetail: "target",
  tonalComplexity: "target",
  facialShadow: "acceptable",
  color: "target",
  highlights: "absent",
  apparentAge: "target",
};

test("cross-identity matrix is 2 by 2 by 2 with stable blind codes and attempt order", () => {
  const cells = buildCrossIdentityMatrix();
  assert.equal(cells.length, 8);
  assert.deepEqual(cells.map((cell) => cell.id), CROSS_ATTEMPT_ORDER);
  assert.equal(new Set(cells.map((cell) => cell.id)).size, 8);
  assert.equal(new Set(cells.map((cell) => cell.publicId)).size, 8);
  assert.deepEqual(CROSS_DISPLAY_CODE_ORDER, ["C-N8", "C-H6"]);
  assert.notDeepEqual(CROSS_DISPLAY_CODE_ORDER, ["C-H6", "C-N8"]);
  const conditions = cells.map((cell) => cell.condition);
  for (let index = 1; index < conditions.length; index += 1) {
    assert.notEqual(conditions[index], conditions[index - 1]);
  }
  for (const sourceId of ["source-a", "source-b"]) {
    for (const condition of ["prompt-baseline", "prompt-identity-color"]) {
      for (const repetition of ["r1", "r2"]) {
        assert.equal(cells.filter((cell) => cell.sourceId === sourceId && cell.condition === condition && cell.repetition === repetition).length, 1);
      }
    }
  }
});

test("both conditions use only the identity reference and the safeguard is prompt-identical across cells", () => {
  const baseline = compileConditionPrompt("prompt-baseline");
  const guarded = compileConditionPrompt("prompt-identity-color");
  assert.equal(baseline, compileConditionPrompt("prompt-only"));
  assert.equal(sha256(baseline), BASELINE_HASH);
  assert.equal(sha256(IDENTITY_COLOR_SAFEGUARD), SAFEGUARD_HASH);
  assert.equal(guarded, `${baseline}\n\n${IDENTITY_COLOR_SAFEGUARD}`);
  assert.equal(baseline.includes(IDENTITY_COLOR_SAFEGUARD), false);
  assert.equal(baseline.includes("Image 2"), false);
  assert.equal(guarded.includes("Image 2"), false);
  const prompts = new Map();
  for (const cell of buildCrossIdentityMatrix()) {
    assert.deepEqual(cell.roles, ["identity"]);
    const prompt = compileConditionPrompt(cell.condition);
    prompts.set(cell.condition, prompt);
    assert.equal(cell.condition === "prompt-identity-color", prompt.includes(IDENTITY_COLOR_SAFEGUARD));
  }
  assert.equal(prompts.size, 2);
});

test("the tracked cross-identity template requires the exact source hashes, formats, and dimensions", async () => {
  const template = JSON.parse(await readFile(new URL("../manifest.cross-identity.template.json", import.meta.url), "utf8"));
  assert.equal(template.samePerson, false);
  assert.equal(template.profile, "cross-identity");
  assert.equal(template.inputs["style-reference"], undefined);
  assert.equal(template.inputs["source-a"].sha256, SOURCE_A_HASH);
  assert.equal(template.inputs["source-a"].mime, "image/jpeg");
  assert.deepEqual([template.inputs["source-a"].width, template.inputs["source-a"].height], [900, 600]);
  assert.equal(template.inputs["source-b"].sha256, SOURCE_B_HASH);
  assert.equal(template.inputs["source-b"].mime, "image/png");
  assert.deepEqual([template.inputs["source-b"].width, template.inputs["source-b"].height], [348, 439]);
  assert.equal(JSON.stringify(template).includes("Downloads"), false);
  assert.equal(JSON.stringify(template).includes("\"path\""), false);
  const first = JSON.parse(await readFile(new URL("../manifest.template.json", import.meta.url), "utf8"));
  assert.equal(first.samePerson, true);
  assert.equal(first.inputs["source-a"].sha256, "b4e3eec69f14c21e910ba45f6cf80d23098026a70f5258cf5c8c509f5c364827");
});

test("input mismatches and non-retryable failures make no provider retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-cross-input-"));
  const fixture = await writeCrossFixture(directory);
  let calls = 0;
  const generator = async () => {
    calls += 1;
    return { ok: true, image: { bytes: fixture.sourceB.bytes } };
  };
  try {
    const badTemplate = structuredClone(fixture.template);
    badTemplate.inputs["source-b"].width = 440;
    const badPath = join(directory, "bad-template.json");
    await writeFile(badPath, JSON.stringify(badTemplate));
    const mismatch = await verifyInputs({
      runtimePath: fixture.runtimePath,
      templatePath: badPath,
      inputIds: ["source-a", "source-b"],
      samePerson: false,
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.failures.some((failure) => failure.problem.includes("dimensions")), true);
    assert.equal(JSON.stringify(mismatch).includes(directory), false);
    const blocked = await main([
      "--profile", "cross-identity",
      "--fake",
      "--runtime", fixture.runtimePath,
      "--template", badPath,
      "--run-dir", join(directory, "blocked"),
      "--run-id", "fake-cross",
    ], { env: providerEnv(), git: { head: "abc", status: "" }, logger() {}, fetchImpl: async () => { calls += 1; } });
    assert.equal(blocked.exitCode, 2);
    assert.equal(blocked.attempted, 0);
    assert.equal(calls, 0);

    const validation = await executeRun({
      verified: { ok: false, reason: "input-mismatch" },
      planned: 8,
      imageGenerator: generator,
    });
    assert.equal(validation.providerCalls, 0);
    assert.equal(validation.planned, 8);

    const cells = buildCrossIdentityMatrix();
    const payload = await runMatrix({
      cells: cells.slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: generator,
      prepare: async () => ({ ok: false, kind: "reference-payload-too-large", omittedRoles: [], finalBodyBytes: 10, diagnostics: { referenceRoles: "identity", references: [] } }),
    });
    assert.equal(calls, 0);
    assert.equal(payload.providerCalls, 0);
    assert.equal(payload.cells[0].invocations.length, 1);
    assert.equal(payload.cells[0].failureKind, "reference-payload-too-large");

    const method = await runMatrix({
      cells: cells.slice(0, 2),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: generator,
      prepare: async (input) => ({
        ok: true,
        prompt: "different prompt",
        requestSha256: "c".repeat(64),
        finalBodyBytes: 12,
        serializedBody: "{}",
        omittedRoles: [],
        references: input.references,
        diagnostics: {
          referenceRoles: "identity",
          references: [{ role: "identity", mime: "image/png", width: 8, height: 8, byteLength: 8 }],
        },
      }),
    });
    assert.equal(calls, 0);
    assert.equal(method.stopReason, "method-defect");
    assert.equal(method.cells[0].status, "unattempted");
    assert.equal(method.cells[1].status, "unattempted");

    const evidence = await runMatrix({
      cells: cells.slice(0, 2),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: generator,
      onCell: async () => {
        throw new Error("evidence-write-failed");
      },
    });
    assert.equal(calls, 1);
    assert.equal(evidence.stopReason, "evidence-write-failed");
    assert.equal(evidence.cells[1].status, "unattempted");

    const transport = await runMatrix({
      cells: cells.slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: async () => {
        calls += 1;
        return { ok: false, kind: "provider-payload-too-large", diagnostics: { providerStatus: 413, latencyMs: 2 } };
      },
    });
    assert.equal(transport.cells[0].invocations.length, 1);
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a retry reuses the request hash, and the run cannot make a seventeenth provider call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-cross-ceiling-"));
  const fixture = await writeCrossFixture(directory);
  try {
    const bodies = [];
    const retried = await runMatrix({
      cells: buildCrossIdentityMatrix().slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      ceiling: createCallCeiling({ limit: 16 }),
      imageGenerator: async (request) => {
        bodies.push(request.serializedBody);
        if (bodies.length === 1) return { ok: false, kind: "timeout", diagnostics: { latencyMs: 5, providerStatus: 504 } };
        return { ok: true, image: { bytes: fixture.sourceB.bytes }, metadata: { latencyMs: 6, providerStatus: 200 } };
      },
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(retried.cells[0].invocations.length, 2);
    assert.equal(retried.cells[0].invocations[0].requestSha256, retried.cells[0].invocations[1].requestSha256);
    assert.equal(retried.cells[0].status, "succeeded");

    const kinds = ["timeout", "provider", "invalid-output"];
    let calls = 0;
    const cells = buildCrossIdentityMatrix();
    cells.push({ ...cells[0], id: "source-a.prompt-baseline.extra", publicId: "source-a.C-H6.extra" });
    const blocked = await runMatrix({
      cells,
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      ceiling: createCallCeiling({ limit: 16 }),
      imageGenerator: async () => {
        const kind = kinds[Math.floor(calls / 2) % kinds.length];
        calls += 1;
        if (kind === "invalid-output") return { ok: true, image: { bytes: Buffer.from("not-an-image") } };
        return { ok: false, kind, diagnostics: { latencyMs: 1, providerStatus: 503 } };
      },
    });
    assert.equal(calls, 16);
    assert.equal(blocked.providerCalls, 16);
    assert.equal(blocked.cells.slice(0, 8).every((cell) => cell.invocations.length === 2), true);
    assert.equal(blocked.cells.at(-1).status, "unattempted");
    assert.equal(blocked.cells.at(-1).skippedReason, "ceiling");
    assert.equal(blocked.cells.every((cell) => (cell.invocations || []).length <= 2), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fake provider review smoke makes no external call and stays readable without the originals", async () => {
  const siblingBefore = await fingerprint(SIBLING);
  const directory = await mkdtemp(join(tmpdir(), "style-cross-review-"));
  const fixture = await writeCrossFixture(directory);
  let external = 0;
  const env = providerEnv();
  try {
    const checked = await main([
      "--profile", "cross-identity",
      "--check",
      "--runtime", fixture.runtimePath,
      "--template", fixture.templatePath,
    ], {
      env,
      git: { head: "abc", status: "" },
      logger() {},
      fetchImpl: async () => { external += 1; throw new Error("external"); },
    });
    assert.equal(checked.exitCode, 0);
    assert.equal(checked.attempted, 0);
    assert.equal(checked.preflight.callCounter, 0);
    assert.equal(checked.preflight.planned, 8);
    assert.equal(checked.preflight.invocationCeiling, 16);
    assert.equal(checked.preflight.promptHashes["prompt-baseline"], BASELINE_HASH);
    assert.equal(checked.preflight.promptHashes.safeguard, SAFEGUARD_HASH);
    assert.equal(JSON.stringify(checked.preflight).includes("super-secret-token"), false);
    assert.equal(JSON.stringify(checked.preflight).includes(directory), false);

    const runDir = join(directory, "fake-cross");
    const ran = await main([
      "--profile", "cross-identity",
      "--fake",
      "--run-dir", runDir,
      "--run-id", "fake-cross",
      "--runtime", fixture.runtimePath,
      "--template", fixture.templatePath,
    ], {
      env,
      git: { head: "abc", status: "" },
      logger() {},
      fetchImpl: async () => { external += 1; throw new Error("external"); },
    });
    assert.equal(ran.exitCode, 0);
    assert.equal(ran.planned, 8);
    assert.equal(ran.succeeded, 8);
    assert.equal(ran.providerCalls, 8);
    assert.equal(ran.failed, 0);
    assert.equal(external, 0);
    const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
    assert.equal(manifest.profile, "cross-identity");
    assert.equal(manifest.sameIdentity, false);
    assert.equal(manifest.inputs["style-reference"], undefined);
    assert.equal(manifest.providerInvocations, 8);
    assert.equal(manifest.failedInvocations, 0);
    assert.equal(manifest.cells.every((cell) => cell.referenceRoles.join(",") === "identity"), true);
    assert.equal(new Set(manifest.cells.filter((cell) => cell.condition === "prompt-baseline").map((cell) => cell.promptSha256)).size, 1);
    assert.notEqual(manifest.cells.find((cell) => cell.condition === "prompt-baseline").promptSha256, manifest.cells.find((cell) => cell.condition === "prompt-identity-color").promptSha256);
    const safeText = `${JSON.stringify(manifest)}\n${await readFile(join(runDir, "preflight.json"), "utf8")}`;
    for (const term of ["data:image", "super-secret-token", "http://", "https://", directory, "/Users/", "Downloads"]) {
      assert.equal(safeText.includes(term), false, term);
    }
    await rm(fixture.runtimePath, { force: true });
    await rm(fixture.sourceA.path, { force: true });
    await rm(fixture.sourceB.path, { force: true });
    const verified = await verifyRunInputs(runDir);
    assert.equal(verified.ok, true);
    assert.deepEqual(Object.keys(verified.inputs).sort(), ["source-a", "source-b"]);

    const server = createReviewServer({ runDir });
    const address = await listenReviewServer(server, { host: "127.0.0.1", port: 0 });
    try {
      const base = `http://127.0.0.1:${address.port}`;
      const html = await (await fetch(`${base}/`)).text();
      assert.equal(html.includes("prompt-baseline"), false);
      assert.equal(html.includes("prompt-identity-color"), false);
      assert.equal(html.includes(IDENTITY_COLOR_SAFEGUARD.split("\n")[0]), false);
      assert.equal(html.includes("Experiment-only style reference"), false);
      assert.equal(html.includes("Apparent age"), true);
      assert.equal(html.includes("depict different people"), true);
      assert.equal(html.includes("directional evidence, not statistical proof"), true);
      const firstGroup = html.split("repetition r1")[1];
      assert.equal(firstGroup.indexOf("source-a.C-N8.r1") < firstGroup.indexOf("source-a.C-H6.r1"), true);
      for (const cell of manifest.cells) assert.equal(html.includes(cell.publicId), true);
      assert.equal((await fetch(`${base}/media/input/source-a`)).status, 200);
      assert.equal((await fetch(`${base}/media/input/source-b`)).status, 200);
      assert.equal((await fetch(`${base}/media/input/style-reference`)).status, 404);
      assert.equal((await fetch(`${base}/condition-map.json`)).status, 404);
      const early = await (await fetch(`${base}/?reveal=1`)).text();
      assert.equal(early.includes("prompt-baseline"), false);
      assert.equal(early.includes("Reveal stays closed"), true);
      const partial = await fetch(`${base}/api/judgements`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ publicId: manifest.cells[0].publicId, overall: "reject", apparentAge: "younger", anatomyNote: "draft note" }),
      });
      assert.equal(partial.status, 200);
      const savedPage = await (await fetch(`${base}/`)).text();
      assert.match(savedPage, /value="younger" selected/);
      assert.match(savedPage, /value="reject" selected/);
      assert.equal(savedPage.includes("draft note"), true);
      assert.equal(savedPage.includes("prompt-baseline"), false);
      const invalid = await fetch(`${base}/api/judgements`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ publicId: manifest.cells[0].publicId, apparentAge: "rejuvenated" }),
      });
      assert.equal(invalid.status, 400);
      for (const cell of manifest.cells) {
        const saved = await fetch(`${base}/api/judgements`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ publicId: cell.publicId, ...FULL_JUDGEMENT }),
        });
        assert.equal(saved.status, 200);
        const body = await saved.json();
        if (cell !== manifest.cells.at(-1)) assert.equal(body.complete, false);
      }
      const revealed = await (await fetch(`${base}/?reveal=1`)).text();
      assert.equal(revealed.includes("prompt-baseline"), true);
      assert.equal(revealed.includes("prompt-identity-color"), true);
      assert.equal(revealed.includes("Identity, apparent-age, and source-color safeguards:"), true);
      assert.equal(revealed.includes("not a winner"), true);
      assert.equal(revealed.includes("Apparent age"), true);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    assert.equal(await fingerprint(SIBLING), siblingBefore);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: SIBLING, encoding: "utf8" });
    assert.equal(head.stdout.trim(), "f02b44aaaacb90a0527f452b3d5fe0ade2177dc4");
  }
});

test("the review page shows failures, retries, separate counts, and unsaved draft warnings", async () => {
  const cells = buildCrossIdentityMatrix().map((cell, index) => buildCellEvidence({
    cell,
    status: index === 0 ? "failed" : index === 1 ? "unattempted" : "succeeded",
    attemptNumber: index === 1 ? null : index + 1,
    failureKind: index === 0 ? "timeout" : null,
    skippedReason: index === 1 ? "consecutive-same-failure" : null,
    prompt: compileConditionPrompt(cell.condition),
    referenceRoles: ["identity"],
    normalizedReferences: [{ role: "identity", mime: "image/jpeg", width: 900, height: 600, byteLength: 20 }],
    requestSha256: "a".repeat(64),
    requestBytes: 128,
    model,
    output: index > 1 ? { sha256: "b".repeat(64), extension: "png", mime: "image/png", width: 200, height: 250 } : null,
    invocations: index === 0 ? [
      { attemptNumber: 1, status: "failed", failureKind: "timeout", requestSha256: "a".repeat(64), requestBytes: 128 },
      { attemptNumber: 2, status: "failed", failureKind: "timeout", requestSha256: "a".repeat(64), requestBytes: 128 },
    ] : undefined,
  }));
  const manifest = {
    profile: "cross-identity",
    mode: "live",
    sameIdentity: false,
    sameIdentityStatement: CROSS_IDENTITY_STATEMENT,
    model,
    aspectRatio: "4:5",
    timeoutMs,
    budgetBytes: 850000,
    strategy: "budgeted",
    planned: 8,
    providerInvocations: 10,
    failedInvocations: 2,
    succeeded: 6,
    failed: 1,
    unattempted: 1,
    attemptOrder: CROSS_ATTEMPT_ORDER,
    displayCodeOrder: CROSS_DISPLAY_CODE_ORDER,
    conditionByCode: { "C-N8": "prompt-identity-color", "C-H6": "prompt-baseline" },
    inputs: {
      "source-a": { logicalId: "source-a", role: "identity", sha256: SOURCE_A_HASH, mime: "image/jpeg", width: 900, height: 600 },
      "source-b": { logicalId: "source-b", role: "identity", sha256: SOURCE_B_HASH, mime: "image/png", width: 348, height: 439 },
    },
    cells,
  };
  const hidden = renderReviewPage(buildReviewModel({ manifest, judgements: { cells: { [cells[2].publicId]: { ...FULL_JUDGEMENT, apparentAge: "older" } } }, reveal: true }));
  assert.equal(hidden.includes("prompt-baseline"), false);
  assert.equal(hidden.includes("No output"), true);
  assert.equal(hidden.includes("Not attempted"), true);
  assert.equal(hidden.includes("Attempt 1"), true);
  assert.equal(hidden.includes("Attempt 2"), true);
  assert.match(hidden, /Provider invocations<\/dt><dd>10<\/dd>/);
  assert.match(hidden, /Failed invocations<\/dt><dd>2<\/dd>/);
  assert.match(hidden, /value="older" selected/);
  assert.equal(hidden.includes("style-reference"), false);
  assert.equal(CROSS_IDENTITY_JUDGEMENT_FIELDS.some(([key]) => key === "apparentAge"), true);
  const harness = await loadDraftHarness();
  harness.form.values.apparentAge = "younger";
  harness.dispatchInput();
  assert.equal(harness.unsaved(), true);
  const event = harness.beforeUnload();
  assert.equal(event.defaultPrevented, true);
});

test("the cross-identity diff leaves the first experiment and production files untouched", () => {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
  const diff = spawnSync("git", ["diff", "--name-only", "f02b44aaaacb90a0527f452b3d5fe0ade2177dc4"], { cwd: root, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const changed = `${diff.stdout}\n${status.stdout}`;
  for (const path of [
    "spikes/style-determinism-generation/manifest.template.json",
    "spikes/style-determinism-generation/lib/constants.mjs",
    "spikes/style-determinism-generation/lib/matrix.mjs",
    "app/",
    "specs/",
  ]) {
    assert.equal(changed.includes(path), false, path);
  }
});

async function writeCrossFixture(directory) {
  const sourceA = await solid(directory, "source-a.jpg", 18, 12, { r: 20, g: 30, b: 40 }, "jpeg");
  const sourceB = await solid(directory, "source-b.png", 11, 15, { r: 70, g: 50, b: 40 }, "png");
  const inputs = {
    "source-a": { logicalId: "source-a", role: "identity", ...sourceA },
    "source-b": { logicalId: "source-b", role: "identity", ...sourceB },
  };
  const template = {
    version: 1,
    profile: "cross-identity",
    samePerson: false,
    inputs: Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, {
      logicalId: id,
      role: input.role,
      sha256: input.sha256,
      mime: input.mime,
      width: input.width,
      height: input.height,
    }])),
  };
  const runtime = {
    version: 1,
    inputs: {
      "source-a": { path: sourceA.path },
      "source-b": { path: sourceB.path },
    },
  };
  const templatePath = join(directory, "template.json");
  const runtimePath = join(directory, "runtime.json");
  await writeFile(templatePath, JSON.stringify(template));
  await writeFile(runtimePath, JSON.stringify(runtime));
  return { template, templatePath, runtimePath, inputs, sourceA, sourceB };
}

async function solid(directory, name, width, height, background, format) {
  const pipeline = sharp({ create: { width, height, channels: 3, background } });
  const bytes = format === "jpeg" ? await pipeline.jpeg().toBuffer() : await pipeline.png().toBuffer();
  const info = inspectImage(bytes);
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { path, bytes, mime: info.mime, width: info.width, height: info.height, sha256: sha256(bytes) };
}

function providerEnv() {
  return {
    BASE_URL: "http://127.0.0.1:9",
    CONTEST_API_TOKEN: "super-secret-token",
    IMAGE_TIMEOUT_MS: "180000",
  };
}

async function fingerprint(root) {
  const lines = [];
  async function walk(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        const info = await stat(path);
        lines.push(`${path.slice(root.length)} ${info.size} ${info.mtimeMs}`);
      }
    }
  }
  await walk(join(root, "spikes/style-determinism-generation/results"));
  try {
    const info = await stat(join(root, "spikes/style-determinism-generation/runtime-manifest.json"));
    lines.push(`runtime ${info.size} ${info.mtimeMs}`);
  } catch {
    lines.push("runtime absent");
  }
  lines.sort();
  return lines.join("\n");
}

function createClassList() {
  const classes = new Set();
  return {
    contains: (name) => classes.has(name),
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
  };
}

async function loadDraftHarness() {
  const form = {
    values: { publicId: "source-a.C-H6.r1", overall: "", apparentAge: "", anatomyNote: "" },
    listeners: {},
    classList: createClassList(),
    dataset: {},
    appended: [],
    button: { disabled: false },
    addEventListener(type, fn) {
      form.listeners[type] = form.listeners[type] || [];
      form.listeners[type].push(fn);
    },
    querySelector(selector) {
      if (selector === "button") return form.button;
      if (selector === ".save-status") return form.appended.find((node) => node.className === "save-status") || null;
      return null;
    },
    append(node) { form.appended.push(node); },
  };
  const pass = { textContent: "" };
  const reveal = { hidden: false };
  const document = {
    querySelectorAll: () => [form],
    querySelector(selector) {
      if (selector === "#first-pass") return pass;
      if (selector === "#reveal-action") return { textContent: "", append() {} };
      if (selector === "#reveal-lock") return reveal;
      return null;
    },
    createElement() {
      return { className: "", textContent: "", dataset: {} };
    },
  };
  const listeners = {};
  const code = await readFile(new URL("../public/review.js", import.meta.url), "utf8");
  vm.runInNewContext(code, {
    document,
    window: { addEventListener(type, fn) { listeners[type] = fn; } },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    FormData: class {
      constructor(target) { this.target = target; }
      entries() { return Object.entries(this.target.values); }
      [Symbol.iterator]() { return this.entries()[Symbol.iterator](); }
    },
    console,
  });
  return {
    form,
    dispatchInput() {
      for (const fn of form.listeners.input || []) fn({ preventDefault() {} });
    },
    unsaved() {
      return form.classList.contains("is-unsaved");
    },
    beforeUnload() {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      listeners.beforeunload?.(event);
      return event;
    },
  };
}
