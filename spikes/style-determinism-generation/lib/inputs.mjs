import { readFile } from "node:fs/promises";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import { sha256 } from "./evidence.mjs";

export const TEMPLATE_URL = new URL("../manifest.template.json", import.meta.url);
export const RUNTIME_MANIFEST_URL = new URL("../runtime-manifest.json", import.meta.url);

const INPUT_IDS = ["source-a", "source-b", "style-reference"];

export async function verifyInputs({
  templatePath = TEMPLATE_URL,
  runtimePath = RUNTIME_MANIFEST_URL,
} = {}) {
  let template;
  let runtime;
  try {
    template = JSON.parse(await readFile(templatePath, "utf8"));
    runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  } catch (error) {
    return { ok: false, reason: "manifest-unreadable", detail: error.code || "unreadable" };
  }
  if (template?.samePerson !== true) {
    return { ok: false, reason: "same-person-flag" };
  }
  const inputs = {};
  const failures = [];
  for (const logicalId of INPUT_IDS) {
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
  if (failures.length || Object.keys(inputs).length !== INPUT_IDS.length) {
    return { ok: false, reason: "input-mismatch", failures };
  }
  return { ok: true, samePerson: true, inputs };
}
