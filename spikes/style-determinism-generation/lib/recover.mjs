import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionForMime, inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { generateImage } from "../../../app/storyboard-web/image-provider.mjs";
import { normalizeFailureKind } from "./ceiling.mjs";
import { resolveRunConfig } from "./config.mjs";
import { sha256, assertSafeEvidence } from "./evidence.mjs";
import { verifyRunInputs } from "./inputs.mjs";
import { buildMatrix } from "./matrix.mjs";
import { countFailedInvocations, countProviderInvocations, outputFilePath, promptFilePath, readJson, writeJsonAtomic } from "./persist.mjs";
import { prepareCellRequest } from "./runner.mjs";

export const RECOVERY_RUN_ID = "sdg-20261022T162253Z";
export const RECOVERY_CELL_ID = "source-b.hybrid.r2";
export const RECOVERY_PUBLIC_ID = "source-b.C-M9.r2";
export const START_HEAD = "480c251ab4562f64c4285f097ccd5ba5323d328e";

export const ACCEPTED_INPUTS = Object.freeze({
  "source-a": {
    sha256: "b4e3eec69f14c21e910ba45f6cf80d23098026a70f5258cf5c8c509f5c364827",
    mime: "image/jpeg",
    width: 640,
    height: 640,
  },
  "source-b": {
    sha256: "59f457cc2f66d675e2198f56e45c93aa23f3200fd09b38d546442f9f217be2d1",
    mime: "image/jpeg",
    width: 640,
    height: 640,
  },
  "style-reference": {
    sha256: "2b4faa44c888c5282781bf10c83d4fcd41301c9a0903c2b68dec8d8e47a13fdb",
    mime: "image/png",
    width: 928,
    height: 1152,
  },
});

export async function recoverTimedOutCell({
  runDir,
  imageGenerator,
  git,
  prepareCell = prepareCellRequest,
  verifyInputs = verifyRunInputs,
  config,
  env,
  allowLive = false,
  enforceAcceptedHashes = true,
} = {}) {
  const refuse = (reason) => ({ ok: false, exitCode: 2, providerCalls: 0, reason });
  let manifest;
  try {
    manifest = await readJson(join(runDir, "manifest.json"));
  } catch {
    return refuse("manifest-unreadable");
  }
  if (manifest.runId !== RECOVERY_RUN_ID) return refuse("wrong-run");
  const recoveryPath = join(runDir, "review", "recovery.json");
  if (existsSync(recoveryPath)) return refuse("second-recovery");
  const index = (manifest.cells || []).findIndex((cell) => cell.id === RECOVERY_CELL_ID);
  const cell = manifest.cells?.[index];
  if (!cell || cell.publicId !== RECOVERY_PUBLIC_ID || cell.status !== "failed" || cell.failureKind !== "timeout" || cell.attemptNumber !== 12 || cell.outputPath || cell.outputSha256) {
    return refuse("wrong-cell");
  }
  if (Array.isArray(cell.invocations) && cell.invocations.some((item) => item.attemptNumber === 13)) return refuse("second-recovery");
  const outputCandidate = join(runDir, "outputs", `${RECOVERY_CELL_ID}.png`);
  if (existsSync(outputCandidate)) return refuse("existing-output");
  for (const other of manifest.cells) {
    if (other.id === RECOVERY_CELL_ID) continue;
    if (other.status !== "succeeded" || !other.outputSha256 || !other.outputPath) return refuse("output-mismatch");
    try {
      const bytes = await readFile(outputFilePath(runDir, other));
      if (sha256(bytes) !== other.outputSha256) return refuse("output-mismatch");
    } catch {
      return refuse("output-mismatch");
    }
  }
  if (enforceAcceptedHashes && !acceptedInputs(manifest)) return refuse("changed-inputs");
  const verified = await verifyInputs(runDir);
  if (!verified?.ok) return refuse("changed-inputs");
  const gitState = git;
  if (!gitState || String(gitState.status || "").trim() !== "") return refuse("dirty-worktree");
  if (!gitState.head || gitState.head === START_HEAD || gitState.ancestor === false) return refuse("stale-head");

  const resolved = config || resolveRunConfig(env || process.env);
  if (!sameRequestContext(manifest, resolved)) return refuse("changed-request");
  const matrixCell = buildMatrix().find((item) => item.id === RECOVERY_CELL_ID);
  let preparedRequest;
  try {
    preparedRequest = await prepareCell({
      cell: matrixCell,
      inputs: verified.inputs,
      model: manifest.model,
      referenceConfig: resolved.referenceConfig,
    });
  } catch {
    return refuse("changed-request");
  }
  const prepared = preparedRequest?.prepared;
  if (!prepared?.ok || prepared.requestSha256 !== cell.requestSha256 || prepared.finalBodyBytes !== cell.requestBytes) {
    return refuse("changed-request");
  }
  if (sha256(preparedRequest.prompt) !== cell.promptSha256) return refuse("changed-request");
  let promptText = "";
  try {
    promptText = await readFile(promptFilePath(runDir, cell), "utf8");
  } catch {
    return refuse("changed-request");
  }
  if (promptText !== preparedRequest.prompt) return refuse("changed-request");
  if ((preparedRequest.referenceRoles || []).join(",") !== (cell.referenceRoles || []).join(",")) return refuse("changed-request");
  if (!sameReferences(preparedRequest.normalizedReferences, cell.normalizedReferences)) return refuse("changed-request");

  const judgementsPath = join(runDir, "review", "judgements.json");
  const judgementsBefore = await readOptional(judgementsPath);
  const outputBefore = await Promise.all(manifest.cells.filter((item) => item.id !== RECOVERY_CELL_ID).map(async (item) => sha256(await readFile(outputFilePath(runDir, item)))));
  await mkdir(join(runDir, "review"), { recursive: true });
  try {
    await writeFile(recoveryPath, `${JSON.stringify({ calls: 1, cellId: RECOVERY_CELL_ID }, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") return refuse("second-recovery");
    return refuse("recovery-lock");
  }

  const generator = imageGenerator || (allowLive ? liveGenerator(env) : refuseLive);
  let generated;
  try {
    generated = await generator({
      prompt: prepared.prompt,
      images: (prepared.references || []).map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
      aspectRatio: manifest.aspectRatio,
      serializedBody: prepared.serializedBody,
      timeoutMs: manifest.timeoutMs,
      model: manifest.model,
    });
  } catch {
    generated = { ok: false, kind: "provider" };
  }

  const prior = {
    attemptNumber: 12,
    status: "failed",
    failureKind: "timeout",
    providerStatus: Number.isInteger(cell.providerStatus) ? cell.providerStatus : null,
    latencyMs: Number.isFinite(cell.latencyMs) ? cell.latencyMs : null,
    requestSha256: cell.requestSha256,
    requestBytes: cell.requestBytes,
  };
  let recorded;
  try {
    recorded = await recordRecovery(runDir, manifest, index, cell, prior, generated, prepared);
  } catch {
    return { ok: false, exitCode: 2, providerCalls: 1, reason: "persist-failed" };
  }
  const outputAfter = await Promise.all(manifest.cells.filter((item) => item.id !== RECOVERY_CELL_ID).map(async (item) => sha256(await readFile(outputFilePath(runDir, item)))));
  const judgementsAfter = await readOptional(judgementsPath);
  if (JSON.stringify(outputBefore) !== JSON.stringify(outputAfter)) {
    return { ok: false, exitCode: 2, providerCalls: 1, reason: "output-changed", ...recorded.counts };
  }
  if (Buffer.compare(judgementsBefore, judgementsAfter) !== 0) {
    return { ok: false, exitCode: 2, providerCalls: 1, reason: "judgements-changed", ...recorded.counts };
  }
  return { ok: true, exitCode: 0, providerCalls: 1, ...recorded.summary };
}

function acceptedInputs(manifest) {
  return Object.entries(ACCEPTED_INPUTS).every(([id, expected]) => {
    const input = manifest.inputs?.[id];
    return input?.sha256 === expected.sha256 && input.mime === expected.mime && input.width === expected.width && input.height === expected.height;
  });
}

function sameRequestContext(manifest, config) {
  return Boolean(config?.referenceConfig?.ok)
    && config.model === manifest.model
    && config.timeoutMs === manifest.timeoutMs
    && config.referenceConfig.strategy === manifest.strategy
    && config.referenceConfig.budgetBytes === manifest.budgetBytes
    && manifest.aspectRatio === "4:5";
}

function sameReferences(actual = [], expected = []) {
  if (actual.length !== expected.length) return false;
  return actual.every((ref, index) => {
    const other = expected[index] || {};
    return ref.role === other.role && ref.mime === other.mime && ref.width === other.width && ref.height === other.height && ref.byteLength === other.byteLength;
  });
}

async function recordRecovery(runDir, manifest, index, cell, prior, generated, prepared) {
  let output = null;
  let next;
  if (generated?.ok) {
    const info = inspectImage(generated.image?.bytes || Buffer.alloc(0));
    if (!info.mime) next = invocation(13, "failed", "invalid-output", generated, cell);
    else {
      output = { bytes: Buffer.from(generated.image.bytes), ...info, extension: extensionForMime(info.mime) };
      next = invocation(13, "succeeded", null, generated, cell);
    }
  } else {
    next = invocation(13, "failed", normalizeFailureKind(generated?.kind), generated, cell);
  }
  const updated = {
    ...cell,
    attemptNumber: 13,
    status: output ? "succeeded" : "failed",
    failureKind: output ? null : next.failureKind,
    providerStatus: next.providerStatus,
    latencyMs: next.latencyMs,
    transformStep: prepared.diagnostics?.transformStep || cell.transformStep || null,
    invocations: [prior, next],
    outputSha256: output?.sha256 || null,
    outputPath: output ? `outputs/${cell.id}.${output.extension}` : null,
    outputMime: output?.mime || null,
    outputWidth: output?.width ?? null,
    outputHeight: output?.height ?? null,
  };
  if (output) {
    await mkdir(join(runDir, "outputs"), { recursive: true });
    await writeFile(join(runDir, updated.outputPath), output.bytes);
  }
  manifest.cells[index] = updated;
  manifest.succeeded = manifest.cells.filter((item) => item.status === "succeeded").length;
  manifest.failed = manifest.cells.filter((item) => item.status === "failed").length;
  manifest.unattempted = manifest.cells.filter((item) => item.status === "unattempted").length;
  manifest.attempted = manifest.cells.filter((item) => item.status !== "unattempted").length;
  manifest.providerInvocations = countProviderInvocations(manifest.cells);
  manifest.failedInvocations = countFailedInvocations(manifest.cells);
  assertSafeEvidence(updated);
  await writeJsonAtomic(join(runDir, "manifest.json"), manifest);
  return {
    counts: {
      providerInvocations: manifest.providerInvocations,
      failedInvocations: manifest.failedInvocations,
      succeeded: manifest.succeeded,
      failed: manifest.failed,
    },
    summary: {
      status: updated.status,
      failureKind: updated.failureKind,
      providerInvocations: manifest.providerInvocations,
      failedInvocations: manifest.failedInvocations,
      succeeded: manifest.succeeded,
      failed: manifest.failed,
    },
  };
}

function invocation(attemptNumber, status, failureKind, generated, cell) {
  const metadata = generated?.metadata || {};
  const diagnostics = generated?.diagnostics || {};
  return {
    attemptNumber,
    status,
    failureKind,
    providerStatus: Number.isInteger(metadata.providerStatus) ? metadata.providerStatus : (Number.isInteger(diagnostics.providerStatus) ? diagnostics.providerStatus : null),
    latencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : (Number.isFinite(diagnostics.latencyMs) ? diagnostics.latencyMs : null),
    requestSha256: cell.requestSha256,
    requestBytes: cell.requestBytes,
  };
}

function liveGenerator(env) {
  return (request) => generateImage({
    prompt: request.prompt,
    images: request.images,
    aspectRatio: request.aspectRatio,
    serializedBody: request.serializedBody,
    timeoutMs: request.timeoutMs,
    env: env || process.env,
  });
}

async function refuseLive() {
  throw new Error("live provider call is not enabled");
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
  }
}
