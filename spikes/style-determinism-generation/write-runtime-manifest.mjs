import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CROSS_INPUT_IDS } from "./lib/cross-identity.mjs";
import { verifyInputs } from "./lib/inputs.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const argv = process.argv.slice(2);
const profileFlag = argv.indexOf("--profile");
const profile = profileFlag === -1 ? "style-comparison" : argv[profileFlag + 1];
const crossIdentity = profile === "cross-identity";
if (profile !== "style-comparison" && !crossIdentity) {
  console.log(JSON.stringify({ ok: false, reason: "unknown-profile" }));
  process.exit(2);
}
const fields = crossIdentity
  ? [["source-a", "CROSS_IDENTITY_SOURCE_A"], ["source-b", "CROSS_IDENTITY_SOURCE_B"]]
  : [["source-a", "STYLE_DET_SOURCE_A"], ["source-b", "STYLE_DET_SOURCE_B"], ["style-reference", "STYLE_DET_STYLE"]];
const missing = fields.filter(([, name]) => !String(process.env[name] || "").trim()).map(([, name]) => name);
if (missing.length) {
  console.log(JSON.stringify({ ok: false, missing }));
  process.exit(2);
}
const runtimePath = join(root, crossIdentity ? "runtime-manifest.cross-identity.json" : "runtime-manifest.json");
const runtime = {
  version: 1,
  inputs: Object.fromEntries(fields.map(([id, name]) => [id, { path: process.env[name] }])),
};
await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
const verified = await verifyInputs({
  runtimePath,
  ...(crossIdentity ? {
    templatePath: join(root, "manifest.cross-identity.template.json"),
    inputIds: CROSS_INPUT_IDS,
    samePerson: false,
  } : {}),
});
if (!verified.ok) {
  await rm(runtimePath, { force: true });
  console.log(JSON.stringify({ ok: false, reason: verified.reason || "input-mismatch", failures: verified.failures || [] }));
  process.exit(2);
}
console.log(JSON.stringify({
  ok: true,
  samePerson: crossIdentity ? false : true,
  inputs: Object.fromEntries(fields.map(([id]) => [id, {
    sha256: verified.inputs[id].sha256,
    mime: verified.inputs[id].mime,
    width: verified.inputs[id].width,
    height: verified.inputs[id].height,
  }])),
}));
