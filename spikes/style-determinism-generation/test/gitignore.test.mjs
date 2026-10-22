import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();

test("local results and the runtime manifest are ignored", async () => {
  const probe = join(root, "spikes/style-determinism-generation/results/probe/manifest.json");
  await mkdir(join(root, "spikes/style-determinism-generation/results/probe"), { recursive: true });
  await writeFile(probe, JSON.stringify({
    token: "probe-token",
    path: "/tmp/probe-image.jpeg",
  }));
  const runtime = join(root, "spikes/style-determinism-generation/runtime-manifest.json");
  await writeFile(runtime, JSON.stringify({ inputs: { "source-a": { path: "/tmp/probe-image.jpeg" } } }));
  try {
    for (const path of [probe, runtime, join(root, "spikes/style-determinism-generation/results/probe/outputs/cell.png")]) {
      const ignored = spawnSync("git", ["check-ignore", "--", path], { cwd: root, encoding: "utf8" });
      assert.equal(ignored.status, 0, path);
      const status = spawnSync("git", ["status", "--porcelain", "--", path], { cwd: root, encoding: "utf8" });
      assert.equal(status.stdout, "");
    }
    const dry = spawnSync("git", ["add", "-n", "--", probe], { cwd: root, encoding: "utf8" });
    assert.notEqual(dry.status, 0);
    assert.match(`${dry.stdout}\n${dry.stderr}`, /ignored/i);
    const template = join(root, "spikes/style-determinism-generation/manifest.template.json");
    const tracked = spawnSync("git", ["check-ignore", "--", template], { cwd: root, encoding: "utf8" });
    assert.notEqual(tracked.status, 0);
  } finally {
    await rm(join(root, "spikes/style-determinism-generation/results/probe"), { recursive: true, force: true });
    await rm(runtime, { force: true });
  }
});

test("the spike diff stays inside the isolated boundary and contains no local image paths", async () => {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const paths = status.stdout.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
  for (const path of paths) {
    const clean = path.replace(/\/$/, "");
    assert.equal(
      clean === ".gitignore" || clean === "package.json" || clean.startsWith("spikes/style-determinism-generation"),
      true,
      clean,
    );
    assert.equal(clean.startsWith("specs/"), false);
  }
  const banned = ["ComicsGeneratorAssets", "photo_2026-10-16", "Unknown-3", "Bearer "];
  const files = await textFiles(join(root, "spikes/style-determinism-generation"));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const term of banned) assert.equal(text.includes(term), false, `${file} contains ${term}`);
  }
});

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "results" || entry.name === "node_modules" || entry.name === "test" || entry.name === "runtime-manifest.json") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await textFiles(path));
    else if (/\.(mjs|json|css|js|md)$/.test(entry.name)) files.push(path);
  }
  return files;
}
