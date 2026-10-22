import { extensionForMime, inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { toReference, prepareImageRequest } from "../../../app/storyboard-web/image-reference-strategy.mjs";
import {
  CALL_CEILING,
  FORBIDDEN_REFERENCE_ROLES,
  INVOCATION_CEILING,
  MAX_PROVIDER_TIMEOUT_MS,
  RETRYABLE_FAILURE_KINDS,
} from "./constants.mjs";
import { createCallCeiling, normalizeFailureKind } from "./ceiling.mjs";
import { buildCellEvidence } from "./evidence.mjs";
import { buildMatrix } from "./matrix.mjs";
import { compileConditionPrompt } from "./prompts.mjs";
import { countFailedInvocations } from "./persist.mjs";

const RETRYABLE = new Set(RETRYABLE_FAILURE_KINDS);

export async function executeRun({ verified, ...options }) {
  if (!verified?.ok) {
    return {
      ok: false,
      kind: "input-validation",
      stopReason: "input-validation",
      planned: CALL_CEILING,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      unattempted: CALL_CEILING,
      providerCalls: 0,
      failedInvocations: 0,
      cells: [],
      prompts: {},
      outputs: {},
    };
  }
  return runMatrix({ ...options, inputs: verified.inputs });
}

export async function prepareCellRequest({
  cell,
  inputs,
  model,
  referenceConfig,
  prepare = prepareImageRequest,
}) {
  const prompt = compileConditionPrompt(cell.condition);
  const prepared = await prepare({
    strategy: referenceConfig.strategy,
    budgetBytes: referenceConfig.budgetBytes,
    references: referencesFor(cell, inputs),
    generationMode: "initial",
    compilePrompt: () => prompt,
    aspectRatio: "4:5",
    model,
  });
  return {
    prompt,
    prepared,
    referenceRoles: roleList(prepared),
    normalizedReferences: normalizedReferences(prepared),
  };
}

export async function runMatrix({
  cells = buildMatrix(),
  inputs,
  imageGenerator,
  prepare = prepareImageRequest,
  model,
  timeoutMs,
  referenceConfig,
  ceiling = createCallCeiling(),
  onCell,
} = {}) {
  if (!referenceConfig?.ok || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_PROVIDER_TIMEOUT_MS || typeof imageGenerator !== "function") {
    return emptyStop("configuration");
  }
  const prompts = Object.fromEntries(cells.map((cell) => [cell.id, compileConditionPrompt(cell.condition)]));
  const results = [];
  const outputs = {};
  let stopReason = null;

  for (const cell of cells) {
    const prompt = prompts[cell.id];
    if (stopReason || ceiling.halted || ceiling.attempted >= INVOCATION_CEILING) {
      results.push(unattemptedCell(cell, stopReason || ceiling.haltReason || "ceiling", prompt, model));
      stopReason = await notify(onCell, snapshot(results, prompts, outputs, stopReason || ceiling.haltReason || "ceiling", ceiling)) || stopReason;
      continue;
    }

    let preparedRequest;
    try {
      preparedRequest = await prepareCellRequest({ cell, inputs, model, referenceConfig, prepare });
    } catch {
      preparedRequest = { prompt, prepared: { ok: false, kind: "configuration" }, referenceRoles: [], normalizedReferences: [] };
    }
    const prepared = preparedRequest.prepared;

    if (!prepared.ok && prepared.kind === "configuration") {
      stopReason = "configuration";
      results.push(unattemptedCell(cell, "configuration", prompt, model));
      stopReason = await notify(onCell, snapshot(results, prompts, outputs, stopReason, ceiling)) || stopReason;
      continue;
    }

    const defect = preparationDefect(prepared, cell, prompt);
    if (defect) {
      stopReason = "method-defect";
      results.push(buildCellEvidence({
        cell,
        status: "unattempted",
        skippedReason: defect,
        prompt,
        model,
        referenceRoles: roleList(prepared),
        normalizedReferences: normalizedReferences(prepared),
        requestSha256: prepared.requestSha256 || null,
        requestBytes: prepared.finalBodyBytes ?? null,
        transformStep: prepared.diagnostics?.transformStep || null,
        omittedRoles: prepared.omittedRoles || [],
      }));
      stopReason = await notify(onCell, snapshot(results, prompts, outputs, stopReason, ceiling)) || stopReason;
      continue;
    }

    if (!prepared.ok) {
      const kind = normalizeFailureKind(prepared.kind);
      results.push(buildCellEvidence({
        cell,
        status: "failed",
        failureKind: kind,
        prompt,
        model,
        referenceRoles: roleList(prepared),
        normalizedReferences: normalizedReferences(prepared),
        requestSha256: prepared.requestSha256 || null,
        requestBytes: prepared.finalBodyBytes ?? null,
        transformStep: prepared.diagnostics?.transformStep || null,
        omittedRoles: prepared.omittedRoles || [],
        invocations: [{
          attemptNumber: null,
          status: "failed",
          failureKind: kind,
          providerStatus: null,
          latencyMs: null,
          requestSha256: prepared.requestSha256 || null,
          requestBytes: prepared.finalBodyBytes ?? null,
        }],
      }));
      const terminal = ceiling.noteTerminal(kind);
      if (terminal.halted) stopReason = terminal.haltReason;
      stopReason = await notify(onCell, snapshot(results, prompts, outputs, stopReason, ceiling)) || stopReason;
      continue;
    }

    const requestBody = prepared.serializedBody;
    const invocations = [];
    let output = null;
    let finalOutcome = null;

    for (let tryIndex = 0; tryIndex < 2; tryIndex += 1) {
      if (tryIndex > 0 && !RETRYABLE.has(finalOutcome.kind)) break;
      const invocation = await ceiling.invoke(async () => {
        const generated = await imageGenerator({
          prompt: prepared.prompt,
          images: prepared.references.map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
          aspectRatio: "4:5",
          serializedBody: requestBody,
          timeoutMs,
          model,
        });
        if (generated?.ok) {
          const info = inspectImage(generated.image?.bytes || Buffer.alloc(0));
          if (!info.mime) return { ok: false, kind: "invalid-output", diagnostics: generated.diagnostics || {}, metadata: generated.metadata };
          return { ...generated, image: { ...generated.image, ...info } };
        }
        return generated || { ok: false, kind: "provider" };
      });
      if (!invocation.consumed) {
        if (!invocations.length) {
          results.push(unattemptedCell(cell, invocation.reason, prompt, model));
          stopReason = await notify(onCell, snapshot(results, prompts, outputs, invocation.reason, ceiling)) || stopReason;
        }
        break;
      }
      finalOutcome = invocation;
      const diagnostics = invocation.outcome?.diagnostics || {};
      const metadata = invocation.outcome?.metadata || {};
      invocations.push({
        attemptNumber: invocation.attemptNumber,
        status: invocation.ok ? "succeeded" : "failed",
        failureKind: invocation.ok ? null : invocation.kind,
        providerStatus: Number.isInteger(diagnostics.providerStatus) ? diagnostics.providerStatus : (Number.isInteger(metadata.providerStatus) ? metadata.providerStatus : null),
        latencyMs: metadata.latencyMs ?? diagnostics.latencyMs ?? null,
        requestSha256: prepared.requestSha256 || null,
        requestBytes: prepared.finalBodyBytes ?? null,
      });
      if (invocation.ok) {
        const image = invocation.outcome.image;
        output = {
          bytes: Buffer.from(image.bytes),
          mime: image.mime,
          sha256: image.sha256,
          width: image.width,
          height: image.height,
          extension: extensionForMime(image.mime),
        };
        outputs[cell.id] = output;
        break;
      }
      if (invocations.length >= 2 || !RETRYABLE.has(invocation.kind)) break;
    }

    if (!invocations.length) continue;

    const succeeded = Boolean(output);
    const latest = invocations.at(-1);
    const diagnostics = finalOutcome?.outcome?.diagnostics || prepared.diagnostics || {};
    results.push(buildCellEvidence({
      cell,
      status: succeeded ? "succeeded" : "failed",
      attemptNumber: latest.attemptNumber,
      failureKind: succeeded ? null : latest.failureKind,
      providerStatus: latest.providerStatus,
      latencyMs: latest.latencyMs,
      prompt,
      referenceRoles: roleList(prepared),
      normalizedReferences: normalizedReferences(prepared),
      requestSha256: prepared.requestSha256 || null,
      requestBytes: prepared.finalBodyBytes ?? null,
      model,
      transformStep: diagnostics.transformStep || prepared.diagnostics?.transformStep || null,
      omittedRoles: prepared.omittedRoles || [],
      output,
      invocations,
    }));
    if (succeeded) ceiling.noteSuccess();
    else {
      const terminal = ceiling.noteTerminal(latest.failureKind);
      if (terminal.halted) stopReason = terminal.haltReason;
    }
    stopReason = await notify(onCell, snapshot(results, prompts, outputs, stopReason, ceiling)) || stopReason;
  }

  const attempted = results.filter((cell) => cell.status !== "unattempted").length;
  const succeeded = results.filter((cell) => cell.status === "succeeded").length;
  const failed = results.filter((cell) => cell.status === "failed").length;
  return {
    ok: true,
    stopReason,
    planned: cells.length,
    attempted,
    succeeded,
    failed,
    unattempted: results.filter((cell) => cell.status === "unattempted").length,
    providerCalls: ceiling.attempted,
    failedInvocations: countFailedInvocations(results),
    cells: results,
    prompts,
    outputs,
    model,
    timeoutMs,
    strategy: referenceConfig.strategy,
    budgetBytes: referenceConfig.budgetBytes,
  };
}

function referencesFor(cell, inputs) {
  return cell.roles.map((role) => {
    const source = role === "identity" ? inputs[cell.sourceId] : inputs["style-reference"];
    return toReference(role, {
      id: role === "identity" ? cell.sourceId : "style-reference",
      bytes: source.bytes,
      mime: source.mime,
      width: source.width,
      height: source.height,
    });
  });
}

function preparationDefect(prepared, cell, prompt) {
  if (!prepared.ok) {
    return prepared.kind === "reference-payload-too-large" ? null : "unexpected-prepare-failure";
  }
  const roles = roleList(prepared);
  if (roles.join(",") !== cell.roles.join(",")) return "reference-roles";
  if (roles[0] !== "identity") return "identity-not-first";
  if ((prepared.omittedRoles || []).length > 0) return "omitted-reference";
  if (roles.some((role) => FORBIDDEN_REFERENCE_ROLES.includes(role))) return "forbidden-role";
  if (prepared.prompt !== prompt) return "prompt-mismatch";
  return null;
}

function roleList(prepared) {
  if (prepared?.diagnostics?.referenceRoles) return prepared.diagnostics.referenceRoles.split(",").filter(Boolean);
  return (prepared?.references || []).map((ref) => ref.role);
}

function normalizedReferences(prepared) {
  return (prepared?.diagnostics?.references || []).map((ref) => ({
    role: ref.role,
    mime: ref.mime,
    width: ref.width,
    height: ref.height,
    byteLength: ref.byteLength,
  }));
}

function unattemptedCell(cell, skippedReason, prompt, model) {
  return buildCellEvidence({
    cell,
    status: "unattempted",
    skippedReason,
    prompt,
    model,
  });
}

function snapshot(cells, prompts, outputs, stopReason, ceiling) {
  return { cells, prompts, outputs, stopReason, providerCalls: ceiling.attempted };
}

function emptyStop(stopReason) {
  return {
    ok: false,
    kind: stopReason,
    stopReason,
    planned: CALL_CEILING,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    unattempted: CALL_CEILING,
    providerCalls: 0,
    failedInvocations: 0,
    cells: [],
    prompts: {},
    outputs: {},
  };
}

async function notify(onCell, body) {
  if (typeof onCell !== "function") return null;
  try {
    await onCell(body);
    return null;
  } catch {
    return "evidence-write-failed";
  }
}
