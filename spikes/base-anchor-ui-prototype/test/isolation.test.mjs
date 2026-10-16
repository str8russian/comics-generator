import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_PORT } from "../lib/create-server.mjs";

const spikeRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const base = "73143e057508c5585f3c6d7975e04c12a2b0f9c3";
const protectedFiles = [
  "app/storyboard-web/public/app.css",
  "app/storyboard-web/public/app.js",
  "app/storyboard-web/public/index.html",
  "app/storyboard-web/server.mjs",
];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

test("working storyboard UI files are unchanged from the accepted Block B base", () => {
  const diff = execFileSync("git", ["diff", "--name-only", base, "--", ...protectedFiles], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(diff.trim(), "");
});

test("the prototype does not import product persistence or the storyboard server", () => {
  const sources = [join(spikeRoot, "server.mjs"), ...walk(join(spikeRoot, "lib")), ...walk(join(spikeRoot, "public"))]
    .filter((path) => /\.(mjs|js|html|css)$/.test(path));
  const banned = [
    /visual-store/,
    /storyboard-web\/server/,
    /from ["']pg["']/,
    /\/api\/visual/,
    /migrations\//,
  ];
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    for (const pattern of banned) assert.equal(pattern.test(text), false, `${path} matches ${pattern}`);
  }
  const generator = readFileSync(join(spikeRoot, "lib/generate.mjs"), "utf8");
  assert.match(generator, /image-provider\.mjs/);
  assert.match(generator, /image-reference-strategy\.mjs/);
  assert.match(generator, /image-info\.mjs/);
});

test("the page is Russian and wires dismiss, escape, and generate without a generic edit action", () => {
  const html = readFileSync(join(spikeRoot, "public/index.html"), "utf8");
  const app = readFileSync(join(spikeRoot, "public/app.js"), "utf8");
  const state = readFileSync(join(spikeRoot, "lib/state.mjs"), "utf8");
  assert.match(html, /lang="ru"/);
  assert.match(app, /escapeKey\(state\)/);
  assert.match(app, /requestDismiss\(state\)/);
  assert.match(app, /confirmDiscard\(state\)/);
  assert.match(app, /acceptDraft\(state/);
  assert.match(app, /undoCandidate\(state\)/);
  assert.match(app, /undoDelete\(state\)/);
  assert.match(app, /generation-basis/);
  assert.equal(app.split("/api/generate").length - 1, 1);
  assert.equal(`${html}\n${app}\n${state}`.includes("Изменить"), false);
  assert.equal(app.includes("/api/visual"), false);
});

test("the prototype server refuses the storyboard port", () => {
  assert.equal(FORBIDDEN_PORT, 4173);
  const result = spawnSync(process.execPath, ["spikes/base-anchor-ui-prototype/server.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, BASE_ANCHOR_PROTOTYPE_PORT: "4173" },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}`, /4173/);
});
