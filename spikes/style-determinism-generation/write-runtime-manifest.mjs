import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyInputs } from "./lib/inputs.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const fields = [
  ["source-a", "STYLE_DET_SOURCE_A"],
  ["source-b", "STYLE_DET_SOURCE_B"],
  ["style-reference", "STYLE_DET_STYLE"],
];
const missing = fields.filter(([, name]) => !String(process.env[name] || "").trim()).map(([, name]) => name);
if (missing.length) {
  console.log(JSON.stringify({ ok: false, missing }));
  process.exit(2);
}
const runtimePath = join(root, "runtime-manifest.json");
const runtime = {
  version: 1,
  inputs: Object.fromEntries(fields.map(([id, name]) => [id, { path: process.env[name] }])),
};
await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
const verified = await verifyInputs({ runtimePath });
if (!verified.ok) {
  await rm(runtimePath, { force: true });
  console.log(JSON.stringify({ ok: false, reason: verified.reason || "input-mismatch", failures: verified.failures || [] }));
  process.exit(2);
}
console.log(JSON.stringify({
  ok: true,
  samePerson: true,
  inputs: Object.fromEntries(fields.map(([id]) => [id, {
    sha256: verified.inputs[id].sha256,
    mime: verified.inputs[id].mime,
    width: verified.inputs[id].width,
    height: verified.inputs[id].height,
  }])),
}));
