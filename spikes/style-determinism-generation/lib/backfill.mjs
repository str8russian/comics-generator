import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { sha256 } from "./evidence.mjs";
import { INPUT_IDS, inputRelativePath, verifyRunInputs } from "./inputs.mjs";
import { outputFilePath, readJson, writeJsonAtomic } from "./persist.mjs";

export async function backfillRunInputs({ runDir, files }) {
  const manifestPath = join(runDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  const judgementsPath = join(runDir, "review", "judgements.json");
  let judgementsBefore = null;
  try {
    judgementsBefore = await readFile(judgementsPath);
  } catch {
    judgementsBefore = null;
  }
  const outputBefore = await hashOutputs(runDir, manifest);
  const verifiedFiles = {};
  for (const logicalId of INPUT_IDS) {
    const expected = manifest.inputs?.[logicalId];
    const source = files?.[logicalId];
    if (!expected?.sha256 || !expected.mime || !expected.width || !expected.height || typeof source !== "string") {
      return { ok: false, providerCalls: 0, reason: "input-mismatch", logicalId };
    }
    let bytes;
    try {
      bytes = await readFile(source);
    } catch {
      return { ok: false, providerCalls: 0, reason: "file-missing", logicalId };
    }
    const info = inspectImage(bytes);
    if (sha256(bytes) !== expected.sha256 || info.mime !== expected.mime || info.width !== expected.width || info.height !== expected.height) {
      return { ok: false, providerCalls: 0, reason: "input-mismatch", logicalId };
    }
    verifiedFiles[logicalId] = bytes;
  }

  await mkdir(join(runDir, "inputs"), { recursive: true });
  let manifestChanged = false;
  for (const logicalId of INPUT_IDS) {
    const relativePath = inputRelativePath(logicalId, manifest.inputs[logicalId].mime);
    const target = join(runDir, relativePath);
    let current = null;
    try {
      current = await readFile(target);
    } catch {
      current = null;
    }
    if (!current || !current.equals(verifiedFiles[logicalId])) {
      await writeFile(target, verifiedFiles[logicalId]);
    }
    if (manifest.inputs[logicalId].path !== relativePath) {
      manifest.inputs[logicalId] = { ...manifest.inputs[logicalId], path: relativePath };
      manifestChanged = true;
    }
  }
  if (manifestChanged) await writeJsonAtomic(manifestPath, manifest);

  const verified = await verifyRunInputs(runDir);
  if (!verified.ok) return { ok: false, providerCalls: 0, reason: verified.reason || "input-mismatch" };
  const outputAfter = await hashOutputs(runDir, manifest);
  if (JSON.stringify(outputBefore) !== JSON.stringify(outputAfter)) {
    return { ok: false, providerCalls: 0, reason: "output-changed" };
  }
  let judgementsAfter = null;
  try {
    judgementsAfter = await readFile(judgementsPath);
  } catch {
    judgementsAfter = null;
  }
  if (Buffer.compare(judgementsBefore || Buffer.alloc(0), judgementsAfter || Buffer.alloc(0)) !== 0) {
    return { ok: false, providerCalls: 0, reason: "judgements-changed" };
  }
  return { ok: true, providerCalls: 0, runId: manifest.runId };
}

async function hashOutputs(runDir, manifest) {
  const hashes = {};
  for (const cell of manifest.cells || []) {
    if (!cell.outputPath) continue;
    const bytes = await readFile(outputFilePath(runDir, cell));
    hashes[cell.outputPath] = sha256(bytes);
  }
  return hashes;
}
