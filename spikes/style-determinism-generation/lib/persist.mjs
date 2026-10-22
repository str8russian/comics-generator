import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const conditionMap = {
    note: BLIND_NOTE,
    codes: CONDITION_BY_CODE,
    displayCodeOrder: DISPLAY_CODE_ORDER,
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
    sameIdentity: true,
    sameIdentityStatement: SAME_IDENTITY_STATEMENT,
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
    stopReason: snapshot.stopReason || null,
    attemptOrder: ATTEMPT_ORDER,
    displayCodeOrder: DISPLAY_CODE_ORDER,
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
