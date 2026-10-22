import { extensionForMime, inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { toReference, prepareImageRequest } from "../../../app/storyboard-web/image-reference-strategy.mjs";
import {
  CALL_CEILING,
  FORBIDDEN_REFERENCE_ROLES,
  MAX_PROVIDER_TIMEOUT_MS,
} from "./constants.mjs";
import { createCallCeiling } from "./ceiling.mjs";
import { buildCellEvidence } from "./evidence.mjs";
import { buildMatrix } from "./matrix.mjs";
import { compileConditionPrompt } from "./prompts.mjs";

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
      cells: [],
      prompts: {},
      outputs: {},
    };
  }
  return runMatrix({ ...options, inputs: verified.inputs });
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
  let providerCalls = 0;

  for (const cell of cells) {
    const prompt = prompts[cell.id];
    if (stopReason || ceiling.halted || ceiling.attempted >= CALL_CEILING) {
      results.push(buildCellEvidence({
        cell,
        status: "unattempted",
        skippedReason: stopReason || ceiling.haltReason || "ceiling",
        prompt,
        model,
      }));
      stopReason = await notify(onCell, { cells: results, prompts, outputs, stopReason: stopReason || ceiling.haltReason || "ceiling" }) || stopReason;
      continue;
    }

    let prepared;
    try {
      prepared = await prepare({
        strategy: referenceConfig.strategy,
        budgetBytes: referenceConfig.budgetBytes,
        references: referencesFor(cell, inputs),
        generationMode: "initial",
        compilePrompt: () => prompt,
        aspectRatio: "4:5",
        model,
      });
    } catch {
      prepared = { ok: false, kind: "configuration" };
    }

    if (!prepared.ok && prepared.kind === "configuration") {
      stopReason = "configuration";
      results.push(buildCellEvidence({
        cell,
        status: "unattempted",
        skippedReason: "configuration",
        prompt,
        model,
      }));
      stopReason = await notify(onCell, { cells: results, prompts, outputs, stopReason }) || stopReason;
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
      stopReason = await notify(onCell, { cells: results, prompts, outputs, stopReason }) || stopReason;
      continue;
    }

    const invocation = await ceiling.invoke(async () => {
      if (!prepared.ok) return prepared;
      providerCalls += 1;
      const generated = await imageGenerator({
        prompt: prepared.prompt,
        images: prepared.references.map((ref) => ({ mime: ref.mime, bytes: ref.bytes })),
        aspectRatio: "4:5",
        serializedBody: prepared.serializedBody,
        timeoutMs,
        model,
      });
      if (generated?.ok) {
        const info = inspectImage(generated.image?.bytes || Buffer.alloc(0));
        if (!info.mime) return { ok: false, kind: "invalid-output", diagnostics: generated.diagnostics || {} };
        return { ...generated, image: { ...generated.image, ...info } };
      }
      return generated || { ok: false, kind: "provider" };
    });

    if (!invocation.consumed) {
      results.push(buildCellEvidence({
        cell,
        status: "unattempted",
        skippedReason: invocation.reason,
        prompt,
        model,
      }));
      stopReason = await notify(onCell, { cells: results, prompts, outputs, stopReason: invocation.reason }) || stopReason;
      continue;
    }

    let output = null;
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
    }
    const diagnostics = invocation.outcome?.diagnostics || prepared.diagnostics || {};
    results.push(buildCellEvidence({
      cell,
      status: invocation.ok ? "succeeded" : "failed",
      attemptNumber: invocation.attemptNumber,
      failureKind: invocation.ok ? null : invocation.kind,
      providerStatus: diagnostics.providerStatus ?? invocation.outcome?.metadata?.providerStatus ?? null,
      latencyMs: invocation.outcome?.metadata?.latencyMs ?? diagnostics.latencyMs ?? null,
      prompt,
      referenceRoles: roleList(prepared),
      normalizedReferences: normalizedReferences(prepared),
      requestSha256: prepared.requestSha256 || null,
      requestBytes: prepared.finalBodyBytes ?? null,
      model,
      transformStep: diagnostics.transformStep || null,
      omittedRoles: prepared.omittedRoles || [],
      output,
    }));
    if (invocation.halted) stopReason = invocation.haltReason;
    stopReason = await notify(onCell, { cells: results, prompts, outputs, stopReason }) || stopReason;
  }

  const attempted = results.filter((cell) => cell.attemptNumber != null).length;
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
    providerCalls,
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
    cells: [],
    prompts: {},
    outputs: {},
  };
}

async function notify(onCell, snapshot) {
  if (typeof onCell !== "function") return null;
  try {
    await onCell(snapshot);
    return null;
  } catch {
    return "evidence-write-failed";
  }
}
