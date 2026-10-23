import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorSessionProviderTimeoutMs, generateImage, resolveImageModel } from "../../../app/storyboard-web/image-provider.mjs";
import {
  loadImageReferenceConfig,
  prepareImageRequest,
  toReference,
} from "../../../app/storyboard-web/image-reference-strategy.mjs";
import { writeItemDirectory } from "../artifacts.mjs";
import { EXTRACTION_CONFIG } from "../config.mjs";
import { decodeImage } from "../decode.mjs";
import { extractForeground } from "../extract.mjs";
import { MATTE_CONTRACT_SHA256, MATTE_CONTRACT_TEXT, MATTE_CONTRACT_VERSION, sha256Buffer } from "./contract.mjs";
import {
  STAGE_A2_IDENTITIES,
  anchorCompilePrompt,
  buildMatrix,
  compileAnchorContract,
  compilePanelContract,
  extensionForMime,
  loadIdentitySources,
  panelCompilePrompt,
} from "./matrix.mjs";
import { ABSOLUTE_CEILING, evaluateInvocation, isTransientFailure, stopReasonForFailure } from "./policy.mjs";
import { redactValue, secretValuesFromEnv } from "./redact.mjs";

const spikeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(spikeRoot, "../..");

export function makeRunId(date = new Date()) {
  return `a2-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

function assertRunId(runId) {
  if (!/^a2-[0-9]{8}T[0-9]{6}Z$/.test(runId) && !/^a2-test-[a-z0-9-]+$/.test(runId)) {
    throw new Error(`refusing run id: ${runId}`);
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function distribution(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return { count: 0, minMs: 0, meanMs: 0, maxMs: 0 };
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return {
    count: numbers.length,
    minMs: round(Math.min(...numbers)),
    meanMs: round(total / numbers.length),
    maxMs: round(Math.max(...numbers)),
  };
}

function configFingerprint() {
  return {
    version: EXTRACTION_CONFIG.version,
    sha256: sha256Buffer(Buffer.from(JSON.stringify(EXTRACTION_CONFIG))),
  };
}

function panelTimeoutMs(env = {}) {
  const configured = Number(env.IMAGE_TIMEOUT_MS || env.CONTEST_TIMEOUT_MS || 180000);
  if (!Number.isFinite(configured) || configured <= 0) return 180000;
  return configured;
}

function publicRequest(prepared, { model, timeoutMs }) {
  return {
    prepared: prepared.ok === true,
    sha256: prepared.requestSha256 || null,
    originalBodyBytes: prepared.originalBodyBytes ?? null,
    finalBodyBytes: prepared.finalBodyBytes ?? null,
    transformStep: prepared.diagnostics?.transformStep || (prepared.transforms?.length
      ? prepared.transforms.map((item) => item.step).join("+")
      : "none"),
    omittedRoles: prepared.omittedRoles || [],
    referenceRoles: (prepared.references || []).map((reference) => reference.role),
    referenceCount: prepared.references?.length ?? 0,
    model,
    timeoutMs,
  };
}

function publicProvider(result, { invocation, retryOf }) {
  const diagnostics = result?.diagnostics || {};
  const metadata = result?.metadata || {};
  return {
    invocation,
    retryOf: retryOf ?? null,
    ok: result?.ok === true,
    kind: result?.ok ? null : (result?.kind || "provider"),
    httpStatus: Number.isInteger(result?.httpStatus) ? result.httpStatus : null,
    providerStatus: Number.isInteger(metadata.providerStatus)
      ? metadata.providerStatus
      : (Number.isInteger(diagnostics.providerStatus) ? diagnostics.providerStatus : null),
    latencyMs: Number.isFinite(metadata.latencyMs)
      ? metadata.latencyMs
      : (Number.isFinite(diagnostics.latencyMs) ? diagnostics.latencyMs : null),
    model: typeof metadata.model === "string" ? metadata.model : null,
    finishReason: typeof metadata.finishReason === "string" ? metadata.finishReason : null,
  };
}

function adapterResult(result) {
  if (!result || typeof result !== "object") {
    return { ok: false, kind: "provider", httpStatus: 502, diagnostics: {} };
  }
  return result;
}

function preparedProblems(cell, prepared, expectedPrompt) {
  const problems = [];
  if (!prepared?.ok) problems.push(prepared?.kind || "prepare-failed");
  if (prepared?.prompt !== expectedPrompt) problems.push("prompt-drift");
  const roles = (prepared?.references || []).map((reference) => reference.role);
  if (cell.cell === "anchor") {
    if (roles.join(",") !== "identity") problems.push("anchor-roles");
  } else if (roles.join(",") !== "anchor" || roles.length !== 1) {
    problems.push("panel-roles");
  }
  if (prepared?.omittedRoles?.length) problems.push("omitted-roles");
  if ((prepared?.references || []).length !== 1) problems.push("reference-count");
  return problems;
}

function blankCell(plan) {
  return {
    ...plan,
    state: "unattempted",
    unattemptedReason: null,
    reviewRisk: false,
    lineage: plan.upstreamCellId ? {
      upstreamCellId: plan.upstreamCellId,
      upstreamAutomaticStatus: null,
      reviewRisk: false,
    } : null,
    providerAttempts: 0,
    extraction: null,
    output: null,
    request: null,
    provider: null,
    contract: null,
  };
}

function summarize(cells, invocations) {
  const summary = {
    planned: cells.length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    unattempted: 0,
    providerInvocations: invocations,
  };
  for (const cell of cells) {
    if (cell.state === "succeeded") summary.succeeded += 1;
    else if (cell.state === "failed") summary.failed += 1;
    else summary.unattempted += 1;
    if (cell.providerAttempts > 0) summary.attempted += 1;
    if (cell.providerAttempts > 1) summary.retried += 1;
  }
  return summary;
}

async function extractOutput(bytes, directory, extractImpl, context) {
  const decodeStarted = performance.now();
  let decoded = null;
  let failure = null;
  try {
    decoded = await decodeImage(bytes);
  } catch (error) {
    failure = {
      status: "reject",
      reasons: ["decode-failed"],
      warnings: [],
      findings: [],
      rgba: null,
      boundary: null,
      metrics: {},
      config: { version: EXTRACTION_CONFIG.version },
      message: "decode-failed",
    };
    void error;
  }
  const decodeMs = performance.now() - decodeStarted;
  const extractStarted = performance.now();
  let extracted = failure;
  if (!extracted) {
    try {
      extracted = extractImpl
        ? extractImpl(decoded, context)
        : extractForeground(decoded);
    } catch (error) {
      extracted = {
        status: "reject",
        reasons: ["extraction-failed"],
        warnings: [],
        findings: [],
        rgba: null,
        boundary: null,
        metrics: {},
        config: { version: EXTRACTION_CONFIG.version },
        message: "extraction-failed",
      };
      void error;
    }
  }
  const extractCoreMs = performance.now() - extractStarted;
  const report = {
    status: extracted.status,
    reasons: extracted.reasons || [],
    warnings: extracted.warnings || [],
    findings: extracted.findings || [],
    metrics: extracted.metrics || {},
    thresholds: { version: extracted.config?.version || EXTRACTION_CONFIG.version },
    timing: { decodeMs: round(decodeMs), extractCoreMs: round(extractCoreMs) },
  };
  const diagnosticStarted = performance.now();
  const crops = await writeItemDirectory(directory, {
    rgba: extracted.rgba,
    source: decoded,
    boundary: extracted.boundary,
    report,
  });
  report.crops = crops;
  report.timing.diagnosticMs = round(performance.now() - diagnosticStarted);
  return report;
}

function downstreamAllowed(anchorCell) {
  return anchorCell?.state === "succeeded"
    && anchorCell.extraction
    && anchorCell.extraction.status !== "reject"
    && anchorCell.extraction.status !== "failed";
}

export async function runStageA2({
  mode = "dry-run",
  outputRoot = join(spikeRoot, "output"),
  runId = makeRunId(),
  identities = null,
  env = {},
  imageGenerator = generateImage,
  extractImpl = null,
  hooks = {},
  resumeDirectory = null,
  invocationCeiling = ABSOLUTE_CEILING,
} = {}) {
  if (mode !== "dry-run" && mode !== "live") throw new Error(`unsupported mode: ${mode}`);
  const secrets = secretValuesFromEnv(env);
  const loaded = identities || loadIdentitySources();
  for (const identity of loaded) {
    const actual = sha256Buffer(identity.bytes);
    if (identity.sha256 && actual !== identity.sha256) {
      const error = new Error("stage A2 identity source mismatch");
      error.code = "source-mismatch";
      error.mismatches = [{ id: identity.id, reason: "hash-mismatch" }];
      throw error;
    }
    identity.sha256 = actual;
  }
  const byIdentity = new Map(loaded.map((identity) => [identity.id, identity]));
  const fingerprintAtStart = configFingerprint();
  let directory = resumeDirectory;
  let persisted = null;
  if (directory) {
    persisted = JSON.parse(readFileSync(join(directory, "run.json"), "utf8"));
    if (persisted.stage !== "a2" || persisted.mode !== "live" || mode !== "live") {
      throw new Error("resume requires an unfinished live Stage A2 run");
    }
    if (persisted.stopReason) {
      throw new Error(`resume refused after stop: ${persisted.stopReason}`);
    }
  } else {
    assertRunId(runId);
    mkdirSync(outputRoot, { recursive: true });
    directory = join(outputRoot, runId);
    if (existsSync(directory)) {
      const error = new Error(`run directory already exists: ${directory}`);
      error.code = "run-directory-exists";
      throw error;
    }
    mkdirSync(directory);
  }

  const sourceDir = join(directory, "sources");
  mkdirSync(sourceDir, { recursive: true });
  const sourceRecords = [];
  for (const identity of loaded) {
    const archiveBefore = identity.archivePath ? sha256Buffer(readFileSync(identity.archivePath)) : identity.sha256;
    const target = join(sourceDir, `${identity.id}.${identity.extension}`);
    if (!existsSync(target)) {
      if (identity.archivePath) copyFileSync(identity.archivePath, target);
      else writeFileSync(target, identity.bytes);
    }
    const copied = sha256Buffer(readFileSync(target));
    const archiveAfter = identity.archivePath ? sha256Buffer(readFileSync(identity.archivePath)) : identity.sha256;
    if (copied !== identity.sha256 || archiveBefore !== identity.sha256 || archiveAfter !== identity.sha256) {
      const error = new Error(`source bytes changed for ${identity.id}`);
      error.code = "source-mutated";
      throw error;
    }
    sourceRecords.push({
      id: identity.id,
      characterName: identity.characterName,
      sha256: identity.sha256,
      mime: identity.mime,
      extension: identity.extension,
      bytes: identity.bytes.length,
      copy: `sources/${identity.id}.${identity.extension}`,
    });
  }

  const plans = buildMatrix(loaded);
  const priorCells = new Map((persisted?.cells || []).map((cell) => [cell.id, cell]));
  const cells = plans.map((plan) => priorCells.get(plan.id) || blankCell(plan));
  const state = {
    invocations: persisted?.providerInvocations || 0,
    retries: persisted?.retries || { anchor: 0, panel: 0 },
    consecutiveTransient: persisted?.consecutiveTransient || 0,
    stopReason: null,
    trace: persisted?.trace || [],
  };
  const model = resolveImageModel(env);
  const referenceConfig = loadImageReferenceConfig(env);
  const anchorTimeout = anchorSessionProviderTimeoutMs(env);
  const panelTimeout = panelTimeoutMs(env);

  function publish() {
    const fingerprintAtWrite = configFingerprint();
    const payload = redactValue({
      stage: "a2",
      runId: directory.split("/").pop(),
      mode,
      commit: gitCommit(),
      extractor: fingerprintAtWrite,
      extractorUnchanged: fingerprintAtStart.version === "a1-known-matte-v2"
        && fingerprintAtStart.sha256 === fingerprintAtWrite.sha256,
      matteContract: {
        version: MATTE_CONTRACT_VERSION,
        sha256: MATTE_CONTRACT_SHA256,
        text: MATTE_CONTRACT_TEXT,
      },
      referenceStrategy: referenceConfig.ok ? {
        strategy: referenceConfig.strategy,
        budgetBytes: referenceConfig.budgetBytes,
      } : { ok: false, kind: referenceConfig.kind },
      model,
      timeouts: { anchorMs: anchorTimeout, panelMs: panelTimeout },
      providerInvocations: state.invocations,
      retries: state.retries,
      consecutiveTransient: state.consecutiveTransient,
      stopReason: state.stopReason,
      sources: sourceRecords,
      cells: cells.map((cell) => {
        const { bytes, ...rest } = cell;
        void bytes;
        return rest;
      }),
      summary: summarize(cells, state.invocations),
      timing: {
        provider: distribution(cells.flatMap((cell) => cell.providerLatencies || [])),
        extractCore: distribution(cells.map((cell) => cell.extraction?.timing?.extractCoreMs)),
        diagnostic: distribution(cells.map((cell) => cell.extraction?.timing?.diagnosticMs)),
      },
      trace: state.trace,
      immutability: {
        sourcesUnchanged: true,
        outputsUnchangedAfterExtraction: cells.every((cell) => cell.output?.unchangedAfterExtraction !== false),
      },
      credentialsRecorded: false,
    }, secrets);
    writeFileSync(join(directory, "run.json"), `${JSON.stringify(payload, null, 2)}\n`);
    const hash = createHash("sha256").update(readFileSync(join(directory, "run.json"))).digest("hex");
    writeFileSync(join(directory, "run.sha256"), `${hash}\n`);
    return { payload, hash };
  }

  if (!referenceConfig.ok) {
    state.stopReason = "credential-or-configuration";
    for (const cell of cells) {
      if (cell.state === "unattempted") cell.unattemptedReason = "run-stopped";
    }
    const written = publish();
    return { directory, ...written, providerCalls: state.invocations };
  }

  const outputs = new Map();
  if (persisted) {
    for (const cell of cells) {
      if (cell.state === "succeeded" && cell.output?.file) {
        const file = join(directory, cell.output.file);
        const bytes = readFileSync(file);
        if (sha256Buffer(bytes) !== cell.output.sha256) {
          state.stopReason = "output-mutated";
          break;
        }
        outputs.set(cell.id, { bytes, mime: cell.output.mime, width: cell.output.width, height: cell.output.height });
      }
    }
  }

  for (const cell of cells) {
    if (state.stopReason) {
      if (cell.state === "unattempted") cell.unattemptedReason = "run-stopped";
      continue;
    }
    if (cell.state === "succeeded" || cell.state === "failed") continue;
    const identity = byIdentity.get(cell.identityId);
    if (cell.cell !== "anchor" && mode !== "dry-run") {
      const anchorCell = cells.find((item) => item.id === cell.upstreamCellId);
      if (!anchorCell || anchorCell.state === "unattempted" || anchorCell.state === "failed") {
        cell.unattemptedReason = anchorCell?.state === "failed" ? "anchor-provider-failed" : "anchor-unattempted";
        continue;
      }
      if (anchorCell.extraction?.status === "reject") {
        cell.unattemptedReason = "anchor-automatic-reject";
        continue;
      }
      if (!downstreamAllowed(anchorCell)) {
        cell.unattemptedReason = "anchor-not-usable";
        continue;
      }
      cell.reviewRisk = anchorCell.extraction.status === "review";
      cell.lineage = {
        upstreamCellId: anchorCell.id,
        upstreamAutomaticStatus: anchorCell.extraction.status,
        reviewRisk: cell.reviewRisk,
      };
    }

    let contract;
    let references;
    let compilePrompt;
    if (cell.cell === "anchor") {
      contract = compileAnchorContract(identity);
      if (!contract.ok) {
        state.stopReason = "request-contract-mismatch";
        cell.unattemptedReason = "request-contract-mismatch";
        cell.contract = { problems: contract.problems };
        continue;
      }
      references = contract.assembled.references.map((reference) => toReference(reference.role, reference));
      compilePrompt = anchorCompilePrompt;
    } else if (mode === "dry-run") {
      contract = compilePanelContract({
        identity,
        cell: cell.cell,
        anchor: { id: `${identity.id}-anchor` },
      });
      cell.state = "unattempted";
      cell.unattemptedReason = "dry-run";
      if (!contract.ok) state.stopReason = "request-contract-mismatch";
      cell.contract = {
        ok: contract.ok,
        problems: contract.problems,
        compilerId: contract.compilerId,
        compilerVersion: contract.compilerVersion,
        baseSha256: contract.baseSha256,
        suffixedSha256: contract.suffixedSha256,
        contractVersion: contract.contractVersion,
        contractSha256: contract.contractSha256,
        roles: contract.roles,
        referenceCount: contract.referenceCount,
        identityAlsoStyle: contract.identityAlsoStyle,
        aspectRatio: contract.aspectRatio,
        requestPrepared: false,
        requestDeferredReason: "anchor-output-not-yet-generated",
      };
      continue;
    } else {
      const anchorOutput = outputs.get(cell.upstreamCellId);
      const anchorAsset = {
        id: cell.upstreamCellId,
        bytes: anchorOutput.bytes,
        mime: anchorOutput.mime,
        width: anchorOutput.width,
        height: anchorOutput.height,
      };
      contract = compilePanelContract({ identity, cell: cell.cell, anchor: anchorAsset });
      if (!contract.ok) {
        state.stopReason = "request-contract-mismatch";
        cell.unattemptedReason = "request-contract-mismatch";
        cell.contract = { problems: contract.problems };
        continue;
      }
      references = contract.assembled.slots.map((slot) => toReference(slot.role, slot.asset));
      const intent = contract.intent;
      const assembled = contract.assembled;
      compilePrompt = (preparedReferences) => panelCompilePrompt(intent, assembled, preparedReferences);
    }

    if (mode === "dry-run") {
      const prepared = await prepareImageRequest({
        strategy: referenceConfig.strategy,
        budgetBytes: referenceConfig.budgetBytes,
        references,
        generationMode: "initial",
        compilePrompt,
        aspectRatio: contract.aspectRatio,
        model,
      });
      const problems = preparedProblems(cell, prepared, contract.prompt);
      cell.contract = {
        ok: contract.ok && problems.length === 0,
        problems: [...contract.problems, ...problems],
        compilerId: contract.compilerId,
        compilerVersion: contract.compilerVersion,
        baseSha256: contract.baseSha256,
        suffixedSha256: contract.suffixedSha256,
        contractVersion: contract.contractVersion,
        contractSha256: contract.contractSha256,
        roles: contract.roles,
        referenceCount: contract.referenceCount,
        aspectRatio: contract.aspectRatio,
      };
      cell.request = prepared.ok ? publicRequest(prepared, { model, timeoutMs: anchorTimeout }) : null;
      cell.state = "unattempted";
      cell.unattemptedReason = "dry-run";
      if (problems.length > 0) state.stopReason = "request-contract-mismatch";
      continue;
    }

    let prepared = await prepareImageRequest({
      strategy: referenceConfig.strategy,
      budgetBytes: referenceConfig.budgetBytes,
      references,
      generationMode: "initial",
      compilePrompt,
      aspectRatio: contract.aspectRatio,
      model,
    });
    if (hooks.afterPrepare) prepared = await hooks.afterPrepare(prepared, cell) || prepared;
    if (!prepared.ok) {
      const reason = prepared.kind === "configuration"
        ? "credential-or-configuration"
        : (prepared.kind === "reference-payload-too-large" ? "reference-payload-too-large" : "request-contract-mismatch");
      state.stopReason = reason;
      cell.state = "failed";
      cell.providerAttempts = 0;
      cell.request = publicRequest(prepared, {
        model,
        timeoutMs: cell.cell === "anchor" ? anchorTimeout : panelTimeout,
      });
      continue;
    }
    const problems = preparedProblems(cell, prepared, compilePrompt(prepared.references));
    if (problems.length > 0) {
      state.stopReason = "request-contract-mismatch";
      cell.unattemptedReason = "request-contract-mismatch";
      cell.contract = { problems };
      continue;
    }
    const timeoutMs = cell.cell === "anchor" ? anchorTimeout : panelTimeout;
    cell.contract = {
      ok: true,
      problems: [],
      compilerId: contract.compilerId,
      compilerVersion: contract.compilerVersion,
      baseSha256: sha256Buffer(Buffer.from(contract.basePrompt)),
      suffixedSha256: sha256Buffer(Buffer.from(prepared.prompt)),
      contractVersion: MATTE_CONTRACT_VERSION,
      contractSha256: MATTE_CONTRACT_SHA256,
      roles: prepared.references.map((reference) => reference.role),
      referenceCount: prepared.references.length,
      identityAlsoStyle: contract.identityAlsoStyle === true,
      aspectRatio: contract.aspectRatio,
    };
    cell.request = publicRequest(prepared, { model, timeoutMs });

    const phase = cell.cell === "anchor" ? "anchor" : "panel";
    const send = async (isRetry, failure) => {
      const decision = evaluateInvocation({
        invocations: state.invocations,
        ceiling: invocationCeiling,
        isRetry,
        phase,
        phaseRetries: state.retries,
        failure,
        priorRequestSha256: prepared.requestSha256,
        retryRequestSha256: sha256Buffer(Buffer.from(prepared.serializedBody)),
      });
      if (!decision.allow) {
        if (decision.stop) state.stopReason = decision.stop;
        return null;
      }
      if (decision.consumesRetry) state.retries[phase] += 1;
      state.invocations += 1;
      const invocation = state.invocations;
      state.trace.push({ event: "provider", cellId: cell.id, invocation, retry: isRetry });
      let result;
      try {
        result = adapterResult(await imageGenerator({
          prompt: prepared.prompt,
          images: prepared.references.map((reference) => ({ mime: reference.mime, bytes: reference.bytes })),
          aspectRatio: contract.aspectRatio,
          serializedBody: prepared.serializedBody,
          env,
          timeoutMs: cell.cell === "anchor" ? anchorTimeout : undefined,
        }));
      } catch {
        result = { ok: false, kind: "provider", httpStatus: 502, diagnostics: {} };
      }
      return { result, invocation };
    };

    const noteResult = (result) => {
      const hardStop = stopReasonForFailure(result);
      if (hardStop) {
        state.stopReason = hardStop;
        return;
      }
      if (result?.ok) {
        state.consecutiveTransient = 0;
        return;
      }
      if (isTransientFailure(result)) {
        state.consecutiveTransient += 1;
        if (state.consecutiveTransient >= 2) state.stopReason = "consecutive-transient-failures";
        return;
      }
      state.consecutiveTransient = 0;
    };

    let sent = await send(false, null);
    if (!sent) {
      cell.unattemptedReason = state.stopReason || "not-sent";
      continue;
    }
    cell.providerAttempts = 1;
    let current = sent.result;
    cell.provider = [publicProvider(current, { invocation: sent.invocation, retryOf: null })];
    noteResult(current);
    if (!state.stopReason && isTransientFailure(current)) {
      if (hooks.beforeRetry) {
        const replacement = await hooks.beforeRetry(prepared, cell);
        if (replacement?.serializedBody) prepared = { ...prepared, serializedBody: replacement.serializedBody };
      }
      const retry = await send(true, current);
      if (retry) {
        cell.providerAttempts += 1;
        current = retry.result;
        cell.provider.push(publicProvider(current, { invocation: retry.invocation, retryOf: sent.invocation }));
        noteResult(current);
      }
    }

    cell.providerLatencies = cell.provider.map((item) => item.latencyMs).filter((value) => Number.isFinite(value));
    if (!current.ok || !current.image?.bytes) {
      cell.state = "failed";
      publish();
      continue;
    }

    const extension = extensionForMime(current.image.mime);
    if (!extension) {
      cell.state = "failed";
      cell.provider[cell.provider.length - 1].kind = "invalid-output";
      publish();
      continue;
    }
    const originalBytes = Buffer.from(current.image.bytes);
    const originalHash = sha256Buffer(originalBytes);
    const cellDir = join(directory, cell.id);
    mkdirSync(cellDir, { recursive: true });
    const originalName = `original.${extension}`;
    writeFileSync(join(cellDir, originalName), originalBytes);
    state.trace.push({ event: "extract", cellId: cell.id, invocation: state.invocations });
    const extraction = await extractOutput(originalBytes, cellDir, extractImpl, { cell });
    const after = sha256Buffer(readFileSync(join(cellDir, originalName)));
    const unchanged = after === originalHash;
    if (!unchanged) state.stopReason = "output-mutated";
    cell.output = {
      sha256: originalHash,
      mime: current.image.mime,
      width: current.image.width || extraction.metrics?.width || null,
      height: current.image.height || extraction.metrics?.height || null,
      file: `${cell.id}/${originalName}`,
      unchangedAfterExtraction: unchanged,
    };
    cell.extraction = {
      status: extraction.status,
      reasons: extraction.reasons,
      warnings: extraction.warnings,
      timing: extraction.timing,
      matte: extraction.metrics?.matte || null,
    };
    if (cell.cell === "anchor" && extraction.status === "review") cell.reviewRisk = true;
    cell.state = "succeeded";
    outputs.set(cell.id, {
      bytes: originalBytes,
      mime: current.image.mime,
      width: cell.output.width,
      height: cell.output.height,
    });
    const report = {
      id: cell.id,
      identityId: cell.identityId,
      cell: cell.cell,
      state: cell.state,
      reviewRisk: cell.reviewRisk,
      lineage: cell.lineage,
      contract: cell.contract,
      request: cell.request,
      provider: cell.provider,
      output: cell.output,
      extraction,
    };
    writeFileSync(join(cellDir, "report.json"), `${JSON.stringify(redactValue(report, secrets), null, 2)}\n`);
    publish();
    if (hooks.afterCell) await hooks.afterCell(cell);
  }

  for (const cell of cells) {
    if (cell.state === "unattempted" && !cell.unattemptedReason) {
      cell.unattemptedReason = state.stopReason ? "run-stopped" : (mode === "dry-run" ? "dry-run" : "not-started");
    }
  }
  const written = publish();
  return {
    directory,
    payload: written.payload,
    hash: written.hash,
    providerCalls: state.invocations,
    trace: state.trace,
  };
}

function parseArgs(argv) {
  const args = { mode: "dry-run", resume: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--live") args.mode = "live";
    else if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--resume") args.resume = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const identities = loadIdentitySources().map((identity) => ({ ...identity, archivePath: identity.path }));
  const archiveHashes = new Map(identities.map((identity) => [identity.id, sha256Buffer(readFileSync(identity.path))]));
  const result = await runStageA2({
    mode: args.mode,
    identities,
    env: process.env,
    imageGenerator: args.mode === "dry-run"
      ? () => {
        throw new Error("dry-run attempted a provider call");
      }
      : generateImage,
    resumeDirectory: args.resume,
  });
  for (const identity of identities) {
    const after = sha256Buffer(readFileSync(identity.path));
    if (after !== archiveHashes.get(identity.id)) {
      console.error(`archive source changed: ${identity.id}`);
      process.exitCode = 1;
      return;
    }
  }
  const summary = result.payload.summary;
  console.log(`run ${result.directory}`);
  console.log(`manifest ${result.hash}`);
  console.log(`mode ${result.payload.mode}`);
  console.log(`providerCalls ${result.providerCalls}`);
  console.log(`stop ${result.payload.stopReason || "none"}`);
  console.log(`planned ${summary.planned} attempted ${summary.attempted} succeeded ${summary.succeeded} failed ${summary.failed} retried ${summary.retried} unattempted ${summary.unattempted}`);
  for (const cell of result.payload.cells) {
    const extraction = cell.extraction ? `${cell.extraction.status}` : "none";
    console.log(`${cell.id} ${cell.state} extraction ${extraction} attempts ${cell.providerAttempts || 0} ${cell.unattemptedReason || ""}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
