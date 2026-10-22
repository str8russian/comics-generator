import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateImage } from "../../app/storyboard-web/image-provider.mjs";
import { createCallCeiling } from "./lib/ceiling.mjs";
import { buildPreflight, resolveRunConfig } from "./lib/config.mjs";
import {
  CROSS_ATTEMPT_ORDER,
  CROSS_DISPLAY_CODE_ORDER,
  CROSS_IDENTITY_INVOCATION_CEILING,
  CROSS_IDENTITY_PLANNED,
  CROSS_IDENTITY_STATEMENT,
  CROSS_INPUT_IDS,
  buildCrossIdentityMatrix,
  crossIdentityPromptHashes,
} from "./lib/cross-identity.mjs";
import { createFakeImageGenerator } from "./lib/fake-provider.mjs";
import { snapshotRunInputs, verifyInputs } from "./lib/inputs.mjs";
import { assertEvidenceDirectory, writeRunSnapshot } from "./lib/persist.mjs";
import { assertSafeEvidence } from "./lib/evidence.mjs";
import { executeRun } from "./lib/runner.mjs";

const SPIKE_ROOT = fileURLToPath(new URL(".", import.meta.url));

export function parseArgs(argv) {
  const args = { fake: false, check: false, runDir: null, runtime: null, template: null, runId: null, profile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--fake") args.fake = true;
    else if (token === "--check") args.check = true;
    else if (token === "--profile") args.profile = requiredValue(argv, ++index);
    else if (token === "--run-dir") args.runDir = requiredValue(argv, ++index);
    else if (token === "--runtime") args.runtime = requiredValue(argv, ++index);
    else if (token === "--template") args.template = requiredValue(argv, ++index);
    else if (token === "--run-id") args.runId = requiredValue(argv, ++index);
    else throw new Error("unknown argument");
  }
  if (args.profile && args.profile !== "cross-identity") throw new Error("unknown profile");
  return args;
}

export async function main(argv = [], options = {}) {
  const args = parseArgs(argv);
  const crossIdentity = args.profile === "cross-identity";
  const logger = options.logger || ((line) => console.log(line));
  const env = options.env || process.env;
  const verified = await verifyInputs({
    runtimePath: args.runtime || join(SPIKE_ROOT, crossIdentity ? "runtime-manifest.cross-identity.json" : "runtime-manifest.json"),
    templatePath: args.template || join(SPIKE_ROOT, crossIdentity ? "manifest.cross-identity.template.json" : "manifest.template.json"),
    ...(crossIdentity ? { inputIds: CROSS_INPUT_IDS, samePerson: false } : {}),
  });
  if (!verified.ok) {
    logger(JSON.stringify({ ok: false, kind: "input-validation", attempted: 0, failures: verified.failures || [], reason: verified.reason || verified.detail || null }));
    return { exitCode: 2, attempted: 0 };
  }
  const config = resolveRunConfig(env);
  if (!config.referenceConfig.ok || !config.model || !Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 58_000) {
    logger(JSON.stringify({ ok: false, kind: "configuration", attempted: 0, providerConfigured: config.providerConfigured }));
    return { exitCode: 2, attempted: 0 };
  }
  if (!args.fake && !config.providerConfigured) {
    logger(JSON.stringify({ ok: false, kind: "configuration", attempted: 0, providerConfigured: false }));
    return { exitCode: 2, attempted: 0 };
  }
  const git = options.git || readGitState();
  const preflight = buildPreflight({ config, inputs: verified.inputs, git });
  if (crossIdentity) {
    preflight.profile = "cross-identity";
    preflight.sameIdentityStatement = CROSS_IDENTITY_STATEMENT;
    preflight.attemptOrder = CROSS_ATTEMPT_ORDER;
    preflight.displayCodeOrder = CROSS_DISPLAY_CODE_ORDER;
    preflight.planned = CROSS_IDENTITY_PLANNED;
    preflight.invocationCeiling = CROSS_IDENTITY_INVOCATION_CEILING;
    preflight.promptHashes = crossIdentityPromptHashes();
    preflight.callCounter = 0;
  }
  assertSafeEvidence(preflight);
  if (!args.fake && preflight.gitStatus.trim() !== "") {
    logger(JSON.stringify({ ok: false, kind: "dirty-worktree", attempted: 0, callCounter: 0 }));
    return { exitCode: 2, attempted: 0 };
  }
  logger(`PREFLIGHT ${JSON.stringify(preflight)}`);
  if (args.check) return { exitCode: 0, attempted: 0, preflight };

  const runId = args.runId || (args.fake ? (crossIdentity ? "fake-cross" : "fake-smoke") : stamp(crossIdentity ? "sdc" : "sdg"));
  const runPattern = crossIdentity ? /^(?:fake-cross|sdc-\d{8}T\d{6}Z)$/ : /^(?:fake-smoke|sdg-\d{8}T\d{6}Z)$/;
  if (!runPattern.test(runId) || (!args.fake && (runId === "fake-smoke" || runId === "fake-cross"))) {
    logger(JSON.stringify({ ok: false, kind: "run-id", attempted: 0 }));
    return { exitCode: 2, attempted: 0 };
  }
  const runDir = assertEvidenceDirectory(args.runDir || join(SPIKE_ROOT, "results", runId));
  if (basename(runDir) !== runId || resolve(runDir) === resolve(SPIKE_ROOT)) {
    logger(JSON.stringify({ ok: false, kind: "run-dir", attempted: 0 }));
    return { exitCode: 2, attempted: 0 };
  }
  if (!args.fake && existsSync(runDir)) {
    logger(JSON.stringify({ ok: false, kind: "run-exists", attempted: 0 }));
    return { exitCode: 2, attempted: 0 };
  }
  if (args.fake) await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });
  const createdAt = new Date().toISOString();
  await writeFile(join(runDir, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`);
  let snapshotted;
  try {
    snapshotted = await snapshotRunInputs(runDir, verified.inputs, crossIdentity ? CROSS_INPUT_IDS : undefined);
  } catch {
    logger(JSON.stringify({ ok: false, kind: "input-snapshot", attempted: 0, providerCalls: 0 }));
    return { exitCode: 2, attempted: 0, providerCalls: 0 };
  }
  const imageGenerator = args.fake
    ? createFakeImageGenerator()
    : (request) => generateImage({
      prompt: request.prompt,
      images: request.images,
      aspectRatio: request.aspectRatio,
      serializedBody: request.serializedBody,
      timeoutMs: request.timeoutMs,
      env,
      fetchImpl: options.fetchImpl,
    });
  const snapshotBase = {
    runId,
    mode: args.fake ? "fake" : "live",
    createdAt,
    model: config.model,
    timeoutMs: config.timeoutMs,
    strategy: config.referenceConfig.strategy,
    budgetBytes: config.referenceConfig.budgetBytes,
    inputs: snapshotted,
    preflight,
    planned: crossIdentity ? CROSS_IDENTITY_PLANNED : 12,
    ...(crossIdentity ? { profile: "cross-identity" } : {}),
  };
  const result = await executeRun({
    verified,
    ...(crossIdentity ? {
      cells: buildCrossIdentityMatrix(),
      ceiling: createCallCeiling({ limit: CROSS_IDENTITY_INVOCATION_CEILING }),
      planned: CROSS_IDENTITY_PLANNED,
    } : {}),
    imageGenerator,
    model: config.model,
    timeoutMs: config.timeoutMs,
    referenceConfig: config.referenceConfig,
    onCell: async (snapshot) => {
      await writeRunSnapshot(runDir, { ...snapshotBase, ...snapshot });
      const latest = snapshot.cells.at(-1);
      logger(`CELL ${latest.attemptNumber ?? "-"} ${latest.publicId} ${latest.status} ${latest.failureKind || latest.skippedReason || "ok"}`);
    },
  });
  if (!result.ok || (result.attempted === 0 && result.stopReason)) {
    logger(JSON.stringify({ ok: false, kind: result.stopReason || result.kind, attempted: result.attempted || 0, providerCalls: result.providerCalls || 0 }));
    return { exitCode: 2, attempted: result.attempted || 0 };
  }
  await writeRunSnapshot(runDir, { ...snapshotBase, ...result, stopReason: result.stopReason });
  const resultsRoot = resolve(SPIKE_ROOT, "results");
  if (resolve(runDir) === resolve(resultsRoot, runId)) {
    await mkdir(resultsRoot, { recursive: true });
    await writeFile(join(resultsRoot, "LATEST"), `${runId}\n`);
  }
  const summary = {
    ok: true,
    runId,
    mode: snapshotBase.mode,
    planned: result.planned,
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
    unattempted: result.unattempted,
    providerCalls: result.providerCalls,
    stopReason: result.stopReason,
  };
  logger(`SUMMARY ${JSON.stringify(summary)}`);
  return { exitCode: 0, ...summary, runDir };
}

function stamp(prefix, date = new Date()) {
  return `${prefix}-${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

function readGitState() {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (status.status !== 0) return { head: (head.stdout || "").trim(), status: "git-status-failed" };
  return { head: (head.stdout || "").trim(), status: status.stdout || "" };
}

function requiredValue(argv, index) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error("missing argument value");
  return value;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await main(process.argv.slice(2));
  process.exit(result.exitCode);
}
