import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { sha256 } from "../lib/evidence.mjs";
import { createReviewServer, listenReviewServer } from "../lib/review-server.mjs";
import { buildMatrix } from "../lib/matrix.mjs";
import { executeRun, runMatrix } from "../lib/runner.mjs";
import { main } from "../live.mjs";
import { writeImageFixture } from "./fixture.mjs";

const referenceConfig = { ok: true, strategy: "budgeted", budgetBytes: 850_000 };
const model = "gemini-3-pro-image-preview";
const timeoutMs = 58_000;
const SUCCESS_IMAGE = { mime: "image/png", width: 14, height: 16 };

test("saving one judgement does not navigate or clear another card", async () => {
  const harness = await loadReviewHarness();
  harness.formA.values.overall = "reject";
  harness.formA.values.identity = "wrong";
  harness.formA.values.anatomyNote = "card A contour note";
  harness.formB.values.overall = "uncertain";
  harness.formB.values.contour = "too heavy";
  harness.formB.values.anatomyNote = "card B anatomy note";
  harness.dispatchInput(harness.formA);
  harness.dispatchInput(harness.formB);
  harness.fetchResult = { ok: true, complete: false, judged: 1, required: 2 };
  await harness.submit(harness.formA);

  assert.equal(harness.reloads, 0);
  assert.equal(harness.formA.nativeSubmitted, false);
  assert.equal(harness.formB.nativeSubmitted, false);
  assert.equal(harness.formB.values.overall, "uncertain");
  assert.equal(harness.formB.values.contour, "too heavy");
  assert.equal(harness.formB.values.anatomyNote, "card B anatomy note");
  assert.equal(harness.formA.values.overall, "reject");
  assert.equal(harness.formA.values.anatomyNote, "card A contour note");
  assert.equal(harness.savedState(harness.formA), true);
  assert.equal(harness.unsavedState(harness.formB), true);
  assert.equal(harness.pass.textContent.includes("1 of 2"), true);
  assert.equal(harness.revealReady(), false);
  assert.equal(JSON.stringify(harness.reveal).includes("prompt-only"), false);
  assert.equal(JSON.stringify(harness.reveal).includes("hybrid"), false);
});

test("a failed save keeps every value and shows an error without native submission", async () => {
  const harness = await loadReviewHarness();
  harness.formA.values.overall = "acceptable";
  harness.formA.values.anatomyNote = "keep this note";
  harness.formB.values.highlights = "excessive";
  harness.formB.values.anatomyNote = "keep the other note";
  harness.dispatchInput(harness.formA);
  harness.dispatchInput(harness.formB);
  harness.fetchResult = { ok: false, status: 500 };
  await harness.submit(harness.formA);

  assert.equal(harness.reloads, 0);
  assert.equal(harness.formA.nativeSubmitted, false);
  assert.equal(harness.formB.nativeSubmitted, false);
  assert.equal(harness.formA.button.disabled, false);
  assert.equal(harness.formA.values.overall, "acceptable");
  assert.equal(harness.formA.values.anatomyNote, "keep this note");
  assert.equal(harness.formB.values.highlights, "excessive");
  assert.equal(harness.formB.values.anatomyNote, "keep the other note");
  assert.match(harness.statusText(harness.formA), /save failed/i);
  assert.match(harness.statusText(harness.formA), /try again/i);
});

test("a completed first pass enables reveal without navigation and a clean page does not warn", async () => {
  const harness = await loadReviewHarness();
  harness.formA.values.overall = "acceptable";
  harness.dispatchInput(harness.formA);
  const dirty = harness.beforeUnload();
  assert.equal(dirty.defaultPrevented, true);
  harness.fetchResult = { ok: true, complete: true, judged: 2, required: 2 };
  await harness.submit(harness.formA);
  assert.equal(harness.reloads, 0);
  assert.equal(harness.revealReady(), true);
  assert.equal(JSON.stringify(harness.reveal).includes("style-reference-only"), false);
  const clean = harness.beforeUnload();
  assert.equal(clean.defaultPrevented, false);
});

test("near-concurrent judgement saves preserve both records and an existing note", async () => {
  const { mkdir } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "style-det-judgement-"));
  const runDir = join(directory, "run");
  await mkdir(join(runDir, "review"), { recursive: true });
  await writeFile(join(runDir, "manifest.json"), JSON.stringify(twoCellManifest()));
  const existing = {
    version: 1,
    updatedAt: "2026-10-22T18:41:36.600Z",
    cells: {
      "source-a.C-K4.r1": {
        overall: "acceptable",
        identity: "weakened",
        contour: "target",
        identityDetail: "target",
        tonalComplexity: "target",
        facialShadow: "acceptable",
        color: "target",
        highlights: "absent",
        anatomyNote: "existing owner note",
      },
    },
  };
  await writeFile(join(runDir, "review", "judgements.json"), `${JSON.stringify(existing, null, 2)}\n`);
  const server = createReviewServer({ runDir });
  const address = await listenReviewServer(server, { host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${address.port}`;
    const post = (publicId, overall) => fetch(`${base}/api/judgements`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        publicId,
        overall,
        identity: "recognizable",
        contour: "target",
        identityDetail: "target",
        tonalComplexity: "target",
        facialShadow: "acceptable",
        color: "target",
        highlights: "absent",
        anatomyNote: `${publicId} note`,
      }),
    });
    const [left, right] = await Promise.all([
      post("source-a.C-M9.r1", "reject"),
      post("source-b.C-K4.r1", "uncertain"),
    ]);
    assert.equal(left.status, 200);
    assert.equal(right.status, 200);
    const stored = JSON.parse(await readFile(join(runDir, "review", "judgements.json"), "utf8"));
    assert.equal(stored.cells["source-a.C-K4.r1"].anatomyNote, "existing owner note");
    assert.equal(stored.cells["source-a.C-M9.r1"].overall, "reject");
    assert.equal(stored.cells["source-b.C-K4.r1"].overall, "uncertain");
    const page = await (await fetch(`${base}/?reveal=1`)).text();
    assert.equal(page.includes("prompt-only"), false);
    assert.equal(page.includes("Reveal stays closed"), true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("review serves snapshotted inputs after the runtime manifest and originals are gone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-inputs-"));
  const fixture = await writeImageFixture(directory);
  const runDir = join(directory, "fake-smoke");
  const ran = await main([
    "--fake",
    "--run-dir", runDir,
    "--run-id", "fake-smoke",
    "--runtime", fixture.runtimePath,
    "--template", fixture.templatePath,
  ], { env: { IMAGE_TIMEOUT_MS: "1000", BASE_URL: "http://127.0.0.1:9", CONTEST_API_TOKEN: "token" }, git: { head: "abc", status: "" }, logger: () => {} });
  assert.equal(ran.exitCode, 0);
  await rm(fixture.runtimePath, { force: true });
  await rm(fixture.templatePath, { force: true });
  for (const input of Object.values(fixture.inputs)) await rm(input.path, { force: true });
  const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  assert.equal(JSON.stringify(manifest).includes(directory), false);
  const server = createReviewServer({ runDir });
  const address = await listenReviewServer(server, { host: "127.0.0.1", port: 0 });
  try {
    const base = `http://127.0.0.1:${address.port}`;
    for (const [id, input] of Object.entries(fixture.inputs)) {
      const response = await fetch(`${base}/media/input/${id}`);
      assert.equal(response.status, 200, id);
      assert.equal(response.headers.get("content-type"), input.mime);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha256(bytes), input.sha256);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a run snapshot rejects escaped paths and hash, mime, or dimension mismatches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-contain-"));
  const fixture = await writeImageFixture(directory);
  const runDir = join(directory, "run");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(runDir, "inputs"), { recursive: true });
  const secret = Buffer.from("secret-bytes-not-an-image");
  await writeFile(join(directory, "secret.bin"), secret);
  const inputs = {};
  for (const [id, input] of Object.entries(fixture.inputs)) {
    const extension = input.mime === "image/png" ? "png" : "jpeg";
    const relativePath = `inputs/${id}.${extension}`;
    await writeFile(join(runDir, relativePath), input.bytes);
    inputs[id] = {
      logicalId: id,
      role: input.role,
      sha256: input.sha256,
      mime: input.mime,
      width: input.width,
      height: input.height,
      path: relativePath,
    };
  }
  await writeFile(join(runDir, "manifest.json"), JSON.stringify({ inputs, cells: [] }));
  const server = createReviewServer({ runDir });
  const address = await listenReviewServer(server, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const ok = await fetch(`${base}/media/input/source-a`);
    assert.equal(ok.status, 200);

    const escaped = structuredClone(inputs);
    escaped["source-a"].path = "../secret.bin";
    await writeFile(join(runDir, "manifest.json"), JSON.stringify({ inputs: escaped, cells: [] }));
    const escapedResponse = await fetch(`${base}/media/input/source-a`);
    assert.equal(escapedResponse.status, 409);
    assert.equal((await escapedResponse.json()).kind, "path-containment");

    const hashed = structuredClone(inputs);
    hashed["source-b"].sha256 = "a".repeat(64);
    await writeFile(join(runDir, "manifest.json"), JSON.stringify({ inputs: hashed, cells: [] }));
    const hashResponse = await fetch(`${base}/media/input/source-b`);
    assert.equal(hashResponse.status, 409);
    assert.match((await hashResponse.json()).kind, /hash/);

    const stylePath = join(runDir, "inputs", "style-reference.png");
    const styleBytes = await readFile(stylePath);
    await writeFile(stylePath, fixture.inputs["source-a"].bytes);
    await writeFile(join(runDir, "manifest.json"), JSON.stringify({ inputs, cells: [] }));
    const mimeResponse = await fetch(`${base}/media/input/style-reference`);
    assert.equal(mimeResponse.status, 409);
    assert.match((await mimeResponse.json()).kind, /mime/);
    await writeFile(stylePath, styleBytes);

    const dimensions = structuredClone(inputs);
    dimensions["source-a"].width = inputs["source-a"].width + 1;
    await writeFile(join(runDir, "manifest.json"), JSON.stringify({ inputs: dimensions, cells: [] }));
    const dimensionResponse = await fetch(`${base}/media/input/source-a`);
    assert.equal(dimensionResponse.status, 409);
    assert.match((await dimensionResponse.json()).kind, /dimensions/);

    await rm(join(runDir, "inputs", "source-a.jpeg"));
    await writeFile(join(runDir, "manifest.json"), JSON.stringify({ inputs, cells: [] }));
    const missing = await fetch(`${base}/media/input/source-a`);
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).kind, "file-missing");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("each retryable failure is retried once with the same request bytes and the failed attempt remains", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-retry-"));
  const fixture = await writeImageFixture(directory);
  try {
    for (const kind of ["timeout", "provider", "invalid-output"]) {
      const bodies = [];
      let calls = 0;
      const result = await runMatrix({
        cells: buildMatrix().slice(0, 1),
        inputs: fixture.inputs,
        model,
        timeoutMs,
        referenceConfig,
        imageGenerator: async (request) => {
          calls += 1;
          bodies.push(request.serializedBody);
          if (calls === 1) {
            if (kind === "invalid-output") return { ok: true, image: { bytes: Buffer.from("not-an-image") } };
            return { ok: false, kind, diagnostics: { providerStatus: 504, latencyMs: 4 } };
          }
          return {
            ok: true,
            image: { bytes: fixture.inputs["style-reference"].bytes, ...SUCCESS_IMAGE },
            metadata: { latencyMs: 5, providerStatus: 200 },
          };
        },
      });
      assert.equal(calls, 2, kind);
      assert.equal(bodies[0], bodies[1], kind);
      assert.equal(result.providerCalls, 2, kind);
      assert.equal(result.succeeded, 1, kind);
      assert.equal(result.failed, 0, kind);
      assert.equal(result.cells.length, 1, kind);
      assert.equal(result.cells[0].invocations.length, 2, kind);
      assert.equal(result.cells[0].invocations[0].status, "failed");
      assert.equal(result.cells[0].invocations[0].failureKind, kind);
      assert.equal(result.cells[0].invocations[1].status, "succeeded");
      assert.equal(result.cells[0].invocations[0].requestSha256, result.cells[0].invocations[1].requestSha256);
      assert.equal(result.failedInvocations, 1, kind);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pre-provider failures are not retried", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-noretry-"));
  const fixture = await writeImageFixture(directory);
  try {
    let calls = 0;
    const payload = await runMatrix({
      cells: buildMatrix().slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      prepare: async () => ({ ok: false, kind: "reference-payload-too-large", omittedRoles: [], finalBodyBytes: 900_000, diagnostics: { referenceRoles: "identity", references: [] } }),
      imageGenerator: async () => { calls += 1; return { ok: true }; },
    });
    assert.equal(calls, 0);
    assert.equal(payload.providerCalls, 0);
    assert.equal(payload.cells[0].status, "failed");
    assert.equal(payload.cells[0].invocations?.length || 1, 1);

    const blocked = await executeRun({
      verified: { ok: false, reason: "input-mismatch" },
      imageGenerator: async () => { calls += 1; return { ok: true }; },
    });
    assert.equal(blocked.providerCalls, 0);
    assert.equal(calls, 0);

    let prepared = 0;
    const defect = await runMatrix({
      cells: buildMatrix().slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      prepare: async () => {
        prepared += 1;
        return { ok: false, kind: "configuration" };
      },
      imageGenerator: async () => { calls += 1; return { ok: true }; },
    });
    assert.equal(prepared, 1);
    assert.equal(defect.providerCalls, 0);
    assert.equal(calls, 0);
    assert.equal(defect.stopReason, "configuration");

    const oversized = await runMatrix({
      cells: buildMatrix().slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: async () => {
        calls += 1;
        return { ok: false, kind: "provider-payload-too-large", diagnostics: { providerStatus: 413, latencyMs: 2 } };
      },
    });
    assert.equal(calls, 1);
    assert.equal(oversized.cells[0].invocations.length, 1);
    assert.equal(oversized.cells[0].failureKind, "provider-payload-too-large");

    let evidenceCalls = 0;
    const evidence = await runMatrix({
      cells: buildMatrix().slice(0, 2),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: async () => {
        evidenceCalls += 1;
        return { ok: false, kind: "timeout", diagnostics: { latencyMs: 2 } };
      },
      onCell: async () => {
        throw new Error("evidence-write-failed");
      },
    });
    assert.equal(evidenceCalls, 2);
    assert.equal(evidence.stopReason, "evidence-write-failed");
    assert.equal(evidence.cells[1].status, "unattempted");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cell stops after two failures and the matrix cannot make a 25th provider call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-ceiling-"));
  const fixture = await writeImageFixture(directory);
  try {
    let calls = 0;
    const exhausted = await runMatrix({
      cells: buildMatrix().slice(0, 1),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: async () => {
        calls += 1;
        return { ok: false, kind: "timeout", diagnostics: { latencyMs: 3 } };
      },
    });
    assert.equal(calls, 2);
    assert.equal(exhausted.cells[0].status, "failed");
    assert.equal(exhausted.cells[0].invocations.length, 2);
    assert.equal(exhausted.stopReason, null);

    const cells = buildMatrix();
    cells.push({ ...cells[0], id: "source-a.prompt-only.extra", publicId: "source-a.C-K4.extra" });
    let extraCalls = 0;
    const blocked = await runMatrix({
      cells,
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: async () => {
        extraCalls += 1;
        if (extraCalls % 2 === 1) return { ok: false, kind: "provider", diagnostics: { latencyMs: 2, providerStatus: 502 } };
        return {
          ok: true,
          image: { bytes: fixture.inputs["style-reference"].bytes, ...SUCCESS_IMAGE },
          metadata: { latencyMs: 2, providerStatus: 200 },
        };
      },
    });
    assert.equal(extraCalls, 24);
    assert.equal(blocked.providerCalls, 24);
    assert.equal(blocked.cells.at(-1).status, "unattempted");
    assert.equal(blocked.cells.at(-1).skippedReason, "ceiling");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the systemic stop waits until two cells have each exhausted the same retryable failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-systemic-"));
  const fixture = await writeImageFixture(directory);
  try {
    let calls = 0;
    const result = await runMatrix({
      cells: buildMatrix().slice(0, 3),
      inputs: fixture.inputs,
      model,
      timeoutMs,
      referenceConfig,
      imageGenerator: async () => {
        calls += 1;
        return { ok: false, kind: "timeout", diagnostics: { latencyMs: 6 } };
      },
    });
    assert.equal(calls, 4);
    assert.equal(result.cells[0].status, "failed");
    assert.equal(result.cells[0].invocations.length, 2);
    assert.equal(result.cells[1].status, "failed");
    assert.equal(result.cells[2].status, "unattempted");
    assert.equal(result.stopReason, "consecutive-same-failure");
    assert.equal(result.failed, 2);
    assert.equal(result.providerCalls, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tracked spike text does not contain owner image paths", () => {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const paths = status.stdout.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
  for (const path of paths) {
    const clean = path.replace(/\/$/, "");
    assert.equal(
      clean === ".gitignore" || clean === "package.json" || clean.startsWith("spikes/style-determinism-generation"),
      true,
      clean,
    );
  }
});

function twoCellManifest() {
  const cells = [0, 2, 3, 4].map((index) => {
    const cell = buildMatrix()[index];
    return {
      ...cell,
      status: "succeeded",
      attemptNumber: index + 1,
      failureKind: null,
      outputPath: null,
    };
  });
  return { cells, planned: 12, succeeded: 4, failed: 0 };
}

async function loadReviewHarness() {
  const forms = [createForm("source-a.C-K4.r1"), createForm("source-b.C-M9.r1")];
  const pass = { textContent: "First judgement pass: 0 of 2 successful outputs have a complete categorical record." };
  const reveal = { children: [], dataset: {}, textContent: "" };
  reveal.append = (child) => { reveal.children.push(child); };
  const document = {
    forms,
    createElement() {
      return { className: "", textContent: "", href: "", dataset: {}, children: [], append(child) { this.children.push(child); } };
    },
    querySelectorAll(selector) {
      return selector === "form.judgement" ? forms : [];
    },
    querySelector(selector) {
      if (selector === "#first-pass") return pass;
      if (selector === "#reveal-action") return reveal;
      return null;
    },
  };
  const windowListeners = {};
  const window = {
    location: { reload() { harness.reloads += 1; } },
    addEventListener(type, fn) { windowListeners[type] = fn; },
  };
  const harness = {
    formA: forms[0],
    formB: forms[1],
    pass,
    reveal,
    reloads: 0,
    fetchResult: { ok: true, complete: false, judged: 1, required: 2 },
    dispatchInput(form) {
      for (const fn of form.listeners.input || []) fn({ preventDefault() {} });
    },
    async submit(form) {
      for (const fn of form.listeners.submit || []) {
        await fn({ preventDefault() {} });
      }
    },
    beforeUnload() {
      const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
      windowListeners.beforeunload?.(event);
      return event;
    },
    savedState(form) {
      return form.classList.contains("is-saved") && /saved/i.test(statusText(form)) && !/unsaved/i.test(statusText(form));
    },
    unsavedState(form) {
      return form.classList.contains("is-unsaved") && /unsaved/i.test(statusText(form));
    },
    statusText(form) {
      return statusText(form);
    },
    revealReady() {
      return reveal.children.some((child) => child.href === "/?reveal=1" && child.textContent === "Reveal condition labels");
    },
  };
  function statusText(form) {
    return form.appended.map((node) => node.textContent || "").join(" ");
  }
  const fetch = async () => ({
    ok: harness.fetchResult.ok !== false && harness.fetchResult.status !== 500,
    status: harness.fetchResult.status || (harness.fetchResult.ok === false ? 500 : 200),
    async json() { return harness.fetchResult; },
  });
  const code = await readFile(new URL("../public/review.js", import.meta.url), "utf8");
  vm.runInNewContext(code, {
    document,
    window,
    fetch,
    FormData: FakeFormData,
    console,
  });
  return harness;
}

function createForm(publicId) {
  const form = {
    values: {
      publicId,
      overall: "",
      identity: "",
      contour: "",
      identityDetail: "",
      tonalComplexity: "",
      facialShadow: "",
      color: "",
      highlights: "",
      anatomyNote: "",
    },
    listeners: {},
    classList: createClassList(),
    dataset: {},
    appended: [],
    button: { disabled: false },
    nativeSubmitted: false,
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
    submit() { form.nativeSubmitted = true; },
  };
  return form;
}

function createClassList() {
  const classes = new Set();
  return {
    contains: (name) => classes.has(name),
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    toggle(name, force) {
      const on = force == null ? !classes.has(name) : Boolean(force);
      if (on) classes.add(name);
      else classes.delete(name);
      return on;
    },
  };
}

class FakeFormData {
  constructor(form) {
    this.form = form;
  }

  entries() {
    return Object.entries(this.form.values);
  }

  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
}
