import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { extensionForMime } from "../../../app/storyboard-web/image-info.mjs";
import {
  ASPECT_RATIO,
  ATTEMPT_ORDER,
  BLIND_NOTE,
  CALL_CEILING,
  CONDITION_BY_CODE,
  DISPLAY_CODE_ORDER,
  SAME_IDENTITY_STATEMENT,
  SEED_NOTE,
} from "./constants.mjs";
import {
  CROSS_ATTEMPT_ORDER,
  CROSS_CONDITION_BY_CODE,
  CROSS_DISPLAY_CODE_ORDER,
  CROSS_IDENTITY_INVOCATION_CEILING,
  CROSS_IDENTITY_STATEMENT,
} from "./cross-identity.mjs";
import { assertSafeEvidence, publicInputRecord } from "./evidence.mjs";

export function assertEvidenceDirectory(runDir) {
  const resolved = resolve(runDir);
  if (resolved.includes(`${sep}Downloads${sep}`)) {
    throw new Error("refusing to write the result bundle beside source images");
  }
  return resolved;
}

export async function writeRunSnapshot(runDir, snapshot) {
  const root = assertEvidenceDirectory(runDir);
  await mkdir(join(root, "prompts"), { recursive: true });
  await mkdir(join(root, "outputs"), { recursive: true });
  await mkdir(join(root, "review"), { recursive: true });
  for (const [id, prompt] of Object.entries(snapshot.prompts || {})) {
    await writeFile(join(root, "prompts", `${id}.txt`), prompt);
  }
  for (const [id, output] of Object.entries(snapshot.outputs || {})) {
    if (!output?.bytes) continue;
    const extension = output.extension || extensionForMime(output.mime);
    await writeFile(join(root, "outputs", `${id}.${extension}`), output.bytes);
  }
  const manifest = buildManifest(snapshot);
  const crossIdentity = snapshot.profile === "cross-identity";
  const conditionMap = {
    note: BLIND_NOTE,
    codes: crossIdentity ? CROSS_CONDITION_BY_CODE : CONDITION_BY_CODE,
    displayCodeOrder: crossIdentity ? CROSS_DISPLAY_CODE_ORDER : DISPLAY_CODE_ORDER,
  };
  assertSafeEvidence(manifest);
  assertSafeEvidence(conditionMap);
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, "condition-map.json"), `${JSON.stringify(conditionMap, null, 2)}\n`);
  if (snapshot.preflight) {
    assertSafeEvidence(snapshot.preflight);
    await writeFile(join(root, "preflight.json"), `${JSON.stringify(snapshot.preflight, null, 2)}\n`);
  }
  return manifest;
}

export function buildManifest(snapshot) {
  const cells = snapshot.cells || [];
  const crossIdentity = snapshot.profile === "cross-identity";
  const planned = snapshot.planned ?? CALL_CEILING;
  const attempted = cells.filter((cell) => cell.attemptNumber != null).length;
  const succeeded = cells.filter((cell) => cell.status === "succeeded").length;
  const failed = cells.filter((cell) => cell.status === "failed").length;
  const listedUnattempted = cells.filter((cell) => cell.status === "unattempted").length;
  const unattempted = listedUnattempted + Math.max(0, planned - cells.length);
  return {
    runId: snapshot.runId,
    mode: snapshot.mode,
    createdAt: snapshot.createdAt,
    ...(crossIdentity ? { profile: "cross-identity", invocationCeiling: CROSS_IDENTITY_INVOCATION_CEILING } : {}),
    sameIdentity: crossIdentity ? false : true,
    sameIdentityStatement: crossIdentity ? CROSS_IDENTITY_STATEMENT : SAME_IDENTITY_STATEMENT,
    seed: null,
    repeatVariation: SEED_NOTE,
    model: snapshot.model,
    aspectRatio: ASPECT_RATIO,
    timeoutMs: snapshot.timeoutMs,
    strategy: snapshot.strategy,
    budgetBytes: snapshot.budgetBytes,
    planned,
    attempted,
    succeeded,
    failed,
    unattempted,
    providerInvocations: snapshot.providerCalls ?? countProviderInvocations(cells),
    failedInvocations: countFailedInvocations(cells),
    stopReason: snapshot.stopReason || null,
    attemptOrder: crossIdentity ? CROSS_ATTEMPT_ORDER : ATTEMPT_ORDER,
    displayCodeOrder: crossIdentity ? CROSS_DISPLAY_CODE_ORDER : DISPLAY_CODE_ORDER,
    ...(crossIdentity ? { conditionByCode: CROSS_CONDITION_BY_CODE } : {}),
    inputs: Object.fromEntries(Object.entries(snapshot.inputs || {}).map(([id, input]) => [id, publicInputRecord(input)])),
    cells,
  };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function outputFilePath(runDir, cell) {
  if (!cell.outputPath) return null;
  const root = assertEvidenceDirectory(runDir);
  const resolved = resolve(root, cell.outputPath);
  if (!resolved.startsWith(`${root}${sep}`)) throw new Error("output path escaped the run directory");
  return resolved;
}

export function promptFilePath(runDir, cell) {
  const root = assertEvidenceDirectory(runDir);
  const resolved = resolve(root, cell.promptPath);
  if (!resolved.startsWith(`${root}${sep}`)) throw new Error("prompt path escaped the run directory");
  return resolved;
}

export async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(temporary, body);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function countProviderInvocations(cells = []) {
  return cells.reduce((sum, cell) => sum + providerInvocationRecords(cell).length, 0);
}

export function countFailedInvocations(cells = []) {
  return cells.reduce((sum, cell) => sum + providerInvocationRecords(cell).filter((item) => item.status === "failed").length, 0);
}

export function providerInvocationRecords(cell) {
  if (Array.isArray(cell?.invocations) && cell.invocations.length) {
    return cell.invocations.filter((item) => Number.isInteger(item.attemptNumber));
  }
  if (Number.isInteger(cell?.attemptNumber) && cell.status !== "unattempted") {
    return [{
      attemptNumber: cell.attemptNumber,
      status: cell.status,
      failureKind: cell.failureKind || null,
    }];
  }
  return [];
}
