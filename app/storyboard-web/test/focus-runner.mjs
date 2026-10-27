import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const testRoot = fileURLToPath(new URL("./", import.meta.url));

function fail(message) {
  console.error(`storyboard-focus: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  fail("pass one or more app/storyboard-web/test/**/*.test.mjs paths after --");
}

const files = [];
for (const arg of args) {
  if (arg === "--" || arg.startsWith("-")) fail(`refusing option: ${arg}`);
  const absolute = resolve(repoRoot, arg);
  let real;
  try {
    if (!statSync(absolute).isFile()) fail(`not a test file: ${arg}`);
    real = realpathSync(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`not a test file: ${arg}`);
    throw error;
  }
  const rel = relative(testRoot, real);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    fail(`outside storyboard web tests: ${arg}`);
  }
  if (!real.endsWith(".test.mjs")) fail(`not a test file: ${arg}`);
  files.push(real);
}

const child = spawn(process.execPath, ["--test", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});
child.on("error", () => process.exit(1));
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
