import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { createPrototypeServer, FIXTURE_DIR, FORBIDDEN_PORTS } from "../server.mjs";
import { BASE_COMMIT, prototypeRoot, repoRoot } from "./helpers.mjs";

const PROTECTED = [
  "app",
  "schema",
  "renderer-remotion",
  "catalog",
  "prompts",
  "specs",
  "docs",
  "spikes",
  "docker-compose.yml",
  "prototypes/remotion-rough",
  "prototypes/storyboard-viewer",
];
const WRITE_SQL = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|MERGE|VACUUM|COMMIT|UPSERT|LOCK)\b/i;

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function importSpecifiers(text) {
  const found = [];
  for (const match of text.matchAll(/\bimport\s+(?:[^"'()]*?\sfrom\s+)?["']([^"']+)["']/g)) found.push(match[1]);
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1]);
  for (const match of text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) found.push(match[1]);
  return found;
}

test("production, spec, spike, and other prototype trees are unchanged from the base", () => {
  assert.equal(git(["diff", "--name-only", BASE_COMMIT, "--", ...PROTECTED]).trim(), "");
  assert.equal(git(["status", "--porcelain", "--untracked-files=all", "--", ...PROTECTED]).trim(), "");
});

test("the root package.json differs from the base by at most the two prototype scripts", () => {
  const before = JSON.parse(git(["show", `${BASE_COMMIT}:package.json`]));
  const after = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const allowed = new Set(["prototype:w1", "prototype:w1:test"]);
  const strip = (pkg) => ({
    ...pkg,
    scripts: Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([name]) => !allowed.has(name))),
  });
  assert.deepEqual(strip(after), strip(before));
  assert.equal(git(["diff", "--name-only", BASE_COMMIT, "--", "package-lock.json"]).trim(), "");
});

test("prototype sources import only their own modules and node built-ins", () => {
  const sources = [join(prototypeRoot, "server.mjs"), ...walk(join(prototypeRoot, "public"))]
    .filter((path) => /\.(mjs|js|html)$/.test(path));
  const bannedModules = /(visual-store|project-store|research-store|storyboard-web\/server|provider|image-provider|interpret|db\/pool|migrate)\.mjs$|^pg$/;
  const banned = [/\.env\.local/, /\/api\//, /fetch\([^)]*method/, /DATABASE_URL/];
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    for (const specifier of importSpecifiers(text)) {
      const ok = specifier.startsWith("node:") || specifier.startsWith("./") || specifier === "/app.mjs";
      assert.ok(ok, `${relative(prototypeRoot, path)} imports ${specifier}`);
      assert.equal(bannedModules.test(specifier), false, `${relative(prototypeRoot, path)} imports ${specifier}`);
    }
    for (const pattern of banned) assert.equal(pattern.test(text), false, `${relative(prototypeRoot, path)} matches ${pattern}`);
  }
});

test("the exporter imports only pg and node built-ins and cannot write", () => {
  const text = readFileSync(join(prototypeRoot, "export-snapshot.mjs"), "utf8");
  for (const specifier of importSpecifiers(text)) {
    assert.ok(specifier === "pg" || specifier.startsWith("node:"), `exporter imports ${specifier}`);
  }
  assert.equal(/\bfetch\s*\(|node:https?|\bhttp\.request\b/.test(text), false, "no HTTP client");
  assert.equal(/\b(POST|PUT|PATCH|DELETE|OPTIONS)\b/.test(text), false, "no non-GET HTTP method");
  assert.equal(/\.env\.local/.test(text), false);
  assert.match(text, /const READ_ONLY_BEGIN = "BEGIN TRANSACTION READ ONLY";/);
  assert.match(text, /const READ_ONLY_END = "ROLLBACK";/);
  assert.match(text, /default_transaction_read_only=on/);
  assert.match(text, /transaction_read_only/);
  const guarded = text
    .replace('const READ_ONLY_BEGIN = "BEGIN TRANSACTION READ ONLY";', "")
    .replace('const READ_ONLY_END = "ROLLBACK";', "");
  assert.equal(WRITE_SQL.test(guarded), false, `write keyword: ${guarded.match(WRITE_SQL)?.[0]}`);
  const queries = [...text.matchAll(/client\.query\(([^,)]+)/g)].map((match) => match[1].trim());
  assert.deepEqual(queries.sort(), ["READ_ONLY_BEGIN", "READ_ONLY_END", "sql"]);
  for (const match of text.matchAll(/select\(client,\s*[`"]\s*([A-Z]+)/g)) assert.equal(match[1], "SELECT");
});

test("the server refuses the production and PostgreSQL ports", () => {
  assert.deepEqual([...FORBIDDEN_PORTS], [4173, 5432]);
  for (const port of FORBIDDEN_PORTS) {
    const result = spawnSync(process.execPath, [join(prototypeRoot, "server.mjs")], {
      encoding: "utf8",
      env: { ...process.env, W1_PROTOTYPE_PORT: String(port) },
      timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`Refusing to listen on port ${port}`));
  }
});

test("the server is read-only, local, and cannot escape its directories", async () => {
  const server = createPrototypeServer({ data: { dir: FIXTURE_DIR, kind: "fixture" } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const data = await fetch(`${base}/data/snapshot.json`);
    assert.equal(data.headers.get("x-w1-data-source"), "fixture");
    assert.equal((await data.json()).source.method, "synthetic-fixture");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(`${base}/data/snapshot.json`, { method })).status, 405);
    }
    assert.equal((await fetch(`${base}/..%2Fserver.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/data/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/api/visual`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
