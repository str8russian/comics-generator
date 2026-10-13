import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["app", "prototypes/storyboard-viewer", "prototypes/remotion-rough/src"];

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const hash = createHash("sha256");
const files = roots.flatMap((directory) => walk(path.join(root, directory))).sort();
for (const file of files) {
  hash.update(path.relative(root, file));
  hash.update(readFileSync(file));
}
const payload = {
  id: hash.digest("hex").slice(0, 12),
  source: "docker-source",
  builtAt: new Date().toISOString(),
};
writeFileSync(path.join(root, "build-info.json"), `${JSON.stringify(payload)}\n`);
console.log(payload.id);
