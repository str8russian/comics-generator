import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { sha256 } from "../lib/evidence.mjs";
import { backfillRunInputs } from "../lib/backfill.mjs";
import { buildMatrix } from "../lib/matrix.mjs";
import { ACCEPTED_INPUTS, RECOVERY_CELL_ID, RECOVERY_RUN_ID, START_HEAD, recoverTimedOutCell } from "../lib/recover.mjs";
import { writeImageFixture } from "./fixture.mjs";

const MODEL = "gemini-3-pro-image-preview";
const PROMPT = "same-prompt";
const REQUEST_HASH = "ab".repeat(32);

test("backfill copies verified inputs without changing outputs, judgements, or calling a provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-backfill-"));
  const fixture = await writeImageFixture(directory);
  const runDir = join(directory, "run");
  await mkdir(join(runDir, "outputs"), { recursive: true });
  await mkdir(join(runDir, "review"), { recursive: true });
  const output = Buffer.from("prior-output");
  await writeFile(join(runDir, "outputs", "source-a.prompt-only.r1.png"), output);
  const judgements = `${JSON.stringify({ version: 1, cells: { "source-a.C-K4.r1": { overall: "acceptable", anatomyNote: "existing owner note" } } }, null, 2)}\n`;
  await writeFile(join(runDir, "review", "judgements.json"), judgements);
  const manifest = {
    runId: "fake-smoke",
    inputs: Object.fromEntries(Object.entries(fixture.inputs).map(([id, input]) => [id, {
      logicalId: id,
      role: input.role,
      sha256: input.sha256,
      mime: input.mime,
      width: input.width,
      height: input.height,
    }])),
    cells: [{ id: "source-a.prompt-only.r1", status: "succeeded", outputPath: "outputs/source-a.prompt-only.r1.png", outputSha256: sha256(output) }],
  };
  await writeFile(join(runDir, "manifest.json"), JSON.stringify(manifest));
  const files = Object.fromEntries(Object.entries(fixture.inputs).map(([id, input]) => [id, input.path]));
  const first = await backfillRunInputs({ runDir, files });
  assert.equal(first.ok, true);
  assert.equal(first.providerCalls, 0);
  const stored = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  assert.equal(stored.inputs["source-a"].path, "inputs/source-a.jpeg");
  assert.equal(JSON.stringify(stored).includes(directory), false);
  assert.equal(sha256(await readFile(join(runDir, "inputs", "source-a.jpeg"))), fixture.inputs["source-a"].sha256);
  assert.equal(await readFile(join(runDir, "review", "judgements.json"), "utf8"), judgements);
  assert.equal(sha256(await readFile(join(runDir, "outputs", "source-a.prompt-only.r1.png"))), sha256(output));
  const second = await backfillRunInputs({ runDir, files });
  assert.equal(second.ok, true);
  assert.equal(second.providerCalls, 0);
  const mismatch = await backfillRunInputs({ runDir, files: { ...files, "source-a": fixture.inputs["source-b"].path } });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.providerCalls, 0);
  assert.equal(sha256(await readFile(join(runDir, "inputs", "source-a.jpeg"))), fixture.inputs["source-a"].sha256);
  assert.equal(await readFile(join(runDir, "review", "judgements.json"), "utf8"), judgements);
});

test("recovery refuses the wrong run, cell, request, inputs, dirty code, existing output, and a second call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-recover-"));
  const fixture = await writeImageFixture(directory);
  const runDir = await writeRecoveryRun(directory, fixture);
  const calls = { count: 0 };
  const imageGenerator = async () => {
    calls.count += 1;
    return { ok: true, image: { bytes: fixture.inputs["style-reference"].bytes }, metadata: { providerStatus: 200, latencyMs: 5 } };
  };
  const shared = recoveryOptions(runDir, imageGenerator);

  const wrongRun = await recoverTimedOutCell({ ...shared, runDir: await writeRecoveryRun(directory, fixture, { runId: "sdg-20261022T000000Z" }) });
  assert.equal(wrongRun.reason, "wrong-run");
  assert.equal(wrongRun.providerCalls, 0);

  const wrongCell = await recoverTimedOutCell({ ...shared, runDir: await writeRecoveryRun(directory, fixture, { failureKind: "provider" }) });
  assert.equal(wrongCell.reason, "wrong-cell");
  assert.equal(calls.count, 0);

  const dirty = await recoverTimedOutCell({ ...shared, git: { head: "corrective", status: " M package.json", ancestor: true } });
  assert.equal(dirty.reason, "dirty-worktree");
  assert.equal(calls.count, 0);

  const stale = await recoverTimedOutCell({ ...shared, git: { head: START_HEAD, status: "", ancestor: true } });
  assert.equal(stale.reason, "stale-head");
  assert.equal(calls.count, 0);

  const changedInputs = await recoverTimedOutCell({ ...shared, enforceAcceptedHashes: true, verifyInputs: undefined });
  assert.equal(changedInputs.reason, "changed-inputs");
  assert.equal(calls.count, 0);

  const changedRequest = await recoverTimedOutCell({
    ...shared,
    prepareCell: async () => ({ prompt: PROMPT, prepared: { ok: true, requestSha256: "cd".repeat(32), finalBodyBytes: 64, serializedBody: "body" }, referenceRoles: ["identity", "style"], normalizedReferences: shared.references }),
  });
  assert.equal(changedRequest.reason, "changed-request");
  assert.equal(calls.count, 0);

  await writeFile(join(runDir, "outputs", `${RECOVERY_CELL_ID}.png`), Buffer.from("already-there"));
  const existing = await recoverTimedOutCell(shared);
  assert.equal(existing.reason, "existing-output");
  assert.equal(calls.count, 0);
  const { rm } = await import("node:fs/promises");
  await rm(join(runDir, "outputs", `${RECOVERY_CELL_ID}.png`));

  const outputHashes = await hashNamedOutputs(runDir);
  const judgements = await readFile(join(runDir, "review", "judgements.json"));
  const succeeded = await recoverTimedOutCell(shared);
  assert.equal(succeeded.providerCalls, 1);
  assert.equal(succeeded.status, "succeeded");
  assert.equal(calls.count, 1);
  const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  const cell = manifest.cells.find((item) => item.id === RECOVERY_CELL_ID);
  assert.equal(cell.invocations[0].attemptNumber, 12);
  assert.equal(cell.invocations[0].failureKind, "timeout");
  assert.equal(cell.invocations[1].attemptNumber, 13);
  assert.equal(cell.invocations[1].status, "succeeded");
  assert.equal(cell.invocations[0].requestSha256, cell.invocations[1].requestSha256);
  assert.equal(manifest.providerInvocations, 13);
  assert.equal(manifest.succeeded, 12);
  assert.equal(manifest.failed, 0);
  assert.equal(manifest.failedInvocations, 1);
  assert.deepEqual(await hashNamedOutputs(runDir), outputHashes);
  assert.deepEqual(await readFile(join(runDir, "review", "judgements.json")), judgements);
  assert.equal(JSON.parse(await readFile(join(runDir, "review", "judgements.json"), "utf8")).cells["source-a.C-K4.r1"].anatomyNote, "existing owner note");

  const second = await recoverTimedOutCell(shared);
  assert.equal(second.reason, "second-recovery");
  assert.equal(second.providerCalls, 0);
  assert.equal(calls.count, 1);
});

test("a failed recovery keeps both attempts and does not call the provider again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-recover-fail-"));
  const fixture = await writeImageFixture(directory);
  const runDir = await writeRecoveryRun(directory, fixture);
  let calls = 0;
  const first = await recoverTimedOutCell({
    ...recoveryOptions(runDir, async () => {
      calls += 1;
      return { ok: false, kind: "timeout", diagnostics: { latencyMs: 8 } };
    }),
  });
  assert.equal(first.providerCalls, 1);
  assert.equal(first.status, "failed");
  assert.equal(first.failureKind, "timeout");
  const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  const cell = manifest.cells.find((item) => item.id === RECOVERY_CELL_ID);
  assert.equal(cell.invocations.length, 2);
  assert.equal(cell.outputPath, null);
  assert.equal(manifest.succeeded, 11);
  assert.equal(manifest.failed, 1);
  assert.equal(manifest.providerInvocations, 13);
  assert.equal(manifest.failedInvocations, 2);
  const second = await recoverTimedOutCell(recoveryOptions(runDir, async () => { calls += 1; return { ok: true }; }));
  assert.equal(second.providerCalls, 0);
  assert.equal(second.reason, "second-recovery");
  assert.equal(calls, 1);
});

function recoveryOptions(runDir, imageGenerator) {
  const references = [
    { role: "identity", mime: "image/jpeg", width: 640, height: 640, byteLength: 10 },
    { role: "style", mime: "image/png", width: 619, height: 768, byteLength: 20 },
  ];
  return {
    runDir,
    imageGenerator,
    enforceAcceptedHashes: false,
    git: { head: "corrective-commit", status: "", ancestor: true },
    config: {
      model: MODEL,
      timeoutMs: 58000,
      referenceConfig: { ok: true, strategy: "budgeted", budgetBytes: 850000 },
    },
    verifyInputs: async () => ({ ok: true, inputs: {} }),
    references,
    prepareCell: async () => ({
      prompt: PROMPT,
      prepared: {
        ok: true,
        requestSha256: REQUEST_HASH,
        finalBodyBytes: 64,
        serializedBody: "same-body",
        prompt: PROMPT,
        references: [],
        diagnostics: { transformStep: "long-edge:768" },
      },
      referenceRoles: ["identity", "style"],
      normalizedReferences: references,
    }),
  };
}

async function writeRecoveryRun(directory, fixture, overrides = {}) {
  const runDir = join(directory, `run-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(runDir, "outputs"), { recursive: true });
  await mkdir(join(runDir, "prompts"), { recursive: true });
  await mkdir(join(runDir, "review"), { recursive: true });
  const cells = buildMatrix().map((cell, index) => {
    if (cell.id === RECOVERY_CELL_ID) {
      return {
        ...cell,
        status: "failed",
        attemptNumber: 12,
        failureKind: overrides.failureKind || "timeout",
        providerStatus: null,
        latencyMs: 58008,
        promptSha256: sha256(PROMPT),
        promptPath: `prompts/${cell.id}.txt`,
        referenceRoles: ["identity", "style"],
        normalizedReferences: [
          { role: "identity", mime: "image/jpeg", width: 640, height: 640, byteLength: 10 },
          { role: "style", mime: "image/png", width: 619, height: 768, byteLength: 20 },
        ],
        requestSha256: REQUEST_HASH,
        requestBytes: 64,
        model: MODEL,
        outputSha256: null,
        outputPath: null,
      };
    }
    const bytes = Buffer.from(`output-${cell.id}`);
    return {
      ...cell,
      status: "succeeded",
      attemptNumber: index + 1,
      failureKind: null,
      outputPath: `outputs/${cell.id}.png`,
      outputSha256: sha256(bytes),
      outputBytes: bytes,
    };
  });
  for (const cell of cells) {
    if (cell.outputBytes) await writeFile(join(runDir, cell.outputPath), cell.outputBytes);
    delete cell.outputBytes;
  }
  await writeFile(join(runDir, "prompts", `${RECOVERY_CELL_ID}.txt`), PROMPT);
  await writeFile(join(runDir, "review", "judgements.json"), `${JSON.stringify({ version: 1, cells: { "source-a.C-K4.r1": { overall: "acceptable", anatomyNote: "existing owner note" } } }, null, 2)}\n`);
  const manifest = {
    runId: overrides.runId || RECOVERY_RUN_ID,
    model: MODEL,
    timeoutMs: 58000,
    strategy: "budgeted",
    budgetBytes: 850000,
    aspectRatio: "4:5",
    inputs: Object.fromEntries(Object.entries(ACCEPTED_INPUTS).map(([id, input]) => [id, { logicalId: id, ...input }])),
    cells,
  };
  await writeFile(join(runDir, "manifest.json"), JSON.stringify(manifest));
  assert.equal(fixture.inputs["source-a"].sha256.length, 64);
  return runDir;
}

async function hashNamedOutputs(runDir) {
  const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  const hashes = {};
  for (const cell of manifest.cells) {
    if (cell.id === RECOVERY_CELL_ID || !cell.outputPath) continue;
    hashes[cell.outputPath] = sha256(await readFile(join(runDir, cell.outputPath)));
  }
  return hashes;
}
