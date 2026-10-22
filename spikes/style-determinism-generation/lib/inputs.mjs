import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { sha256 } from "./evidence.mjs";
import { assertEvidenceDirectory } from "./persist.mjs";

export const TEMPLATE_URL = new URL("../manifest.template.json", import.meta.url);
export const RUNTIME_MANIFEST_URL = new URL("../runtime-manifest.json", import.meta.url);

export const INPUT_IDS = ["source-a", "source-b", "style-reference"];

const INPUT_EXTENSION = {
  "image/jpeg": "jpeg",
  "image/png": "png",
};

export function inputRelativePath(logicalId, mime) {
  const extension = INPUT_EXTENSION[mime];
  if (!INPUT_IDS.includes(logicalId) || !extension) return null;
  return `inputs/${logicalId}.${extension}`;
}

export async function verifyInputs({
  templatePath = TEMPLATE_URL,
  runtimePath = RUNTIME_MANIFEST_URL,
  inputIds = INPUT_IDS,
  samePerson = true,
} = {}) {
  let template;
  let runtime;
  try {
    template = JSON.parse(await readFile(templatePath, "utf8"));
    runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  } catch (error) {
    return { ok: false, reason: "manifest-unreadable", detail: error.code || "unreadable" };
  }
  if (samePerson === true) {
    if (template?.samePerson !== true) return { ok: false, reason: "same-person-flag" };
  } else if (template?.samePerson !== false) {
    return { ok: false, reason: "cross-identity-flag" };
  }
  const inputs = {};
  const failures = [];
  for (const logicalId of inputIds) {
    const expected = template.inputs?.[logicalId];
    const location = runtime.inputs?.[logicalId]?.path;
    if (!expected?.sha256 || !expected.mime || !expected.width || !expected.height) {
      failures.push({ logicalId, problem: "template-fields" });
      continue;
    }
    if (typeof location !== "string" || location.trim() === "") {
      failures.push({ logicalId, problem: "path-missing" });
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(location);
    } catch {
      failures.push({ logicalId, problem: "file-missing" });
      continue;
    }
    const actualHash = sha256(bytes);
    const info = inspectImage(bytes);
    const problems = [];
    if (actualHash !== expected.sha256) problems.push("hash");
    if (info.mime !== expected.mime) problems.push("format");
    if (info.width !== expected.width || info.height !== expected.height) problems.push("dimensions");
    if (problems.length) {
      failures.push({
        logicalId,
        problem: problems.join("+"),
        expected: {
          sha256: expected.sha256,
          mime: expected.mime,
          width: expected.width,
          height: expected.height,
        },
        actual: {
          sha256: actualHash,
          mime: info.mime,
          width: info.width,
          height: info.height,
        },
      });
      continue;
    }
    inputs[logicalId] = {
      logicalId,
      role: expected.role,
      path: location,
      bytes,
      sha256: actualHash,
      mime: info.mime,
      width: info.width,
      height: info.height,
    };
  }
  if (failures.length || Object.keys(inputs).length !== inputIds.length) {
    return { ok: false, reason: "input-mismatch", failures };
  }
  return { ok: true, samePerson, inputs };
}

export async function snapshotRunInputs(runDir, inputs, inputIds = INPUT_IDS) {
  const root = assertEvidenceDirectory(runDir);
  await mkdir(join(root, "inputs"), { recursive: true });
  const snapshotted = {};
  for (const logicalId of inputIds) {
    const input = inputs?.[logicalId];
    const relativePath = inputRelativePath(logicalId, input?.mime);
    if (!input?.bytes || !relativePath) {
      throw new Error("input snapshot is incomplete");
    }
    const target = containedInputPath(root, relativePath);
    if (!target) throw new Error("input snapshot escaped the run directory");
    await writeFile(target, input.bytes);
    snapshotted[logicalId] = { ...input, relativePath };
  }
  return snapshotted;
}

export async function verifyRunInputs(runDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
  } catch (error) {
    return { ok: false, reason: "manifest-unreadable", detail: error.code || "unreadable", failures: [] };
  }
  const failures = [];
  const inputs = {};
  const inputIds = manifest.profile === "cross-identity" ? ["source-a", "source-b"] : INPUT_IDS;
  if (manifest.profile === "cross-identity" && manifest.inputs?.["style-reference"]) {
    return { ok: false, reason: "unexpected-style-reference", failures: [{ logicalId: "style-reference", problem: "unexpected-style-reference" }] };
  }
  for (const logicalId of inputIds) {
    const expected = manifest.inputs?.[logicalId];
    if (!expected?.sha256 || !expected.mime || !expected.width || !expected.height) {
      failures.push({ logicalId, problem: "template-fields" });
      continue;
    }
    const expectedPath = inputRelativePath(logicalId, expected.mime);
    if (!expectedPath || expected.path !== expectedPath || !containedInputPath(runDir, expected.path)) {
      failures.push({ logicalId, problem: "path-containment" });
      continue;
    }
    const target = containedInputPath(runDir, expected.path);
    let bytes;
    try {
      bytes = await readFile(target);
    } catch {
      failures.push({ logicalId, problem: "file-missing" });
      continue;
    }
    const info = inspectImage(bytes);
    const problems = [];
    if (sha256(bytes) !== expected.sha256) problems.push("hash");
    if (info.mime !== expected.mime) problems.push("mime");
    if (info.width !== expected.width || info.height !== expected.height) problems.push("dimensions");
    if (problems.length) {
      failures.push({ logicalId, problem: problems.join("+") });
      continue;
    }
    inputs[logicalId] = {
      logicalId,
      role: expected.role,
      relativePath: expected.path,
      bytes,
      sha256: expected.sha256,
      mime: info.mime,
      width: info.width,
      height: info.height,
    };
  }
  if (failures.length || Object.keys(inputs).length !== inputIds.length) {
    return { ok: false, reason: "input-mismatch", failures };
  }
  return { ok: true, inputs };
}

function containedInputPath(runDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\0") || relativePath.startsWith("/") || relativePath.includes("\\")) {
    return null;
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  if (parts[0] !== "inputs") return null;
  const root = resolve(runDir);
  const inputsRoot = resolve(root, "inputs");
  const resolved = resolve(root, relativePath);
  if (!resolved.startsWith(`${inputsRoot}${sep}`)) return null;
  return resolved;
}
