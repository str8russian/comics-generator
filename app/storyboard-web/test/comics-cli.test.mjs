import assert from "node:assert/strict";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { execute, parseArgs } from "../../comics-cli/cli.mjs";
import { managedRootFor, MANAGED_PORT_END, MANAGED_PORT_START } from "../../comics-cli/constants.mjs";
import { discoverPrimary } from "../../comics-cli/discover.mjs";
import { databaseNameForRun } from "../../comics-cli/database.mjs";
import { choosePort } from "../../comics-cli/ports.mjs";
import { readRegistry, withRegistry, writeRegistryAtomic } from "../../comics-cli/registry.mjs";
import { resolveRef } from "../../comics-cli/refs.mjs";

const execFileAsync = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SECRET_TOKEN = "super-secret-token-value";
const SECRET_PASSWORD = "comics-secret-pw";
const SECRET_BASE = "https://provider.example/v1";
const FILE_SECRET = "env-file-only-secret-zz";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function realPrimary(fixture) {
  return realpathSync(fixture.primary);
}

function managedRoot(fixture) {
  return managedRootFor(realPrimary(fixture));
}

function removeTree(path) {
  rmSync(path, { recursive: true, force: true });
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "comics-cli-"));
  const primary = join(root, "primary");
  const unrelated = join(root, "unrelated");
  mkdirSync(primary, { recursive: true });
  mkdirSync(unrelated, { recursive: true });
  git(primary, ["init", "-b", "master"]);
  git(primary, ["config", "user.email", "cli@example.com"]);
  git(primary, ["config", "user.name", "CLI Test"]);
  git(primary, ["config", "commit.gpgsign", "false"]);
  git(primary, ["config", "core.hooksPath", join(primary, ".empty-hooks")]);
  mkdirSync(join(primary, ".empty-hooks"), { recursive: true });
  mkdirSync(join(primary, "app/storyboard-web"), { recursive: true });
  writeFileSync(join(primary, "app/storyboard-web/server.mjs"), "export {}\n");
  writeFileSync(join(primary, "package.json"), "{\"name\":\"comics-pipeline\",\"private\":true}\n");
  writeFileSync(join(primary, "package-lock.json"), "{\"name\":\"comics-pipeline\",\"lockfileVersion\":3}\n");
  writeFileSync(join(primary, ".gitignore"), "node_modules/\n.env.local\n");
  writeFileSync(join(primary, "docker-compose.yml"), [
    "services:",
    "  db:",
    "    image: postgres:16",
    "    environment:",
    "      POSTGRES_USER: comics",
    `      POSTGRES_PASSWORD: ${SECRET_PASSWORD}`,
    "      POSTGRES_DB: comics",
    "  app:",
    "    image: ignored",
    "",
  ].join("\n"));
  git(primary, ["add", "."]);
  git(primary, ["commit", "-m", "init"]);
  return {
    root,
    primary,
    unrelated,
    cleanup() {
      removeTree(root);
      removeTree(managedRootFor(primary));
      try {
        removeTree(managedRootFor(realpathSync(primary)));
      } catch {
        // The primary directory is already gone.
      }
    },
  };
}

function commitFile(primary, relativePath, contents, message) {
  mkdirSync(dirname(join(primary, relativePath)), { recursive: true });
  writeFileSync(join(primary, relativePath), contents);
  git(primary, ["add", relativePath]);
  git(primary, ["commit", "-m", message]);
  return git(primary, ["rev-parse", "HEAD"]).trim();
}

function createProcesses() {
  const processes = {
    next: 5000,
    byPid: new Map(),
    signals: [],
    spawns: [],
    failHttp: false,
    ignoreTerm: false,
    exitOnSpawn: false,
  };
  processes.spawn = (file, args, options) => {
    const pid = processes.next;
    processes.next += 1;
    const command = [file, ...args].join(" ");
    const proc = {
      pid,
      command,
      options,
      alive: !processes.exitOnSpawn,
      port: Number(options.env.STORYBOARD_PORT),
    };
    processes.byPid.set(pid, proc);
    processes.spawns.push(proc);
    const exit = processes.exitOnSpawn ? { code: 1, signal: null } : null;
    return {
      pid,
      onExit(listener) {
        if (exit) listener(exit);
        else proc.listener = listener;
      },
    };
  };
  processes.describe = async (pid) => {
    const proc = processes.byPid.get(pid);
    if (!proc?.alive) return { alive: false, command: null };
    return { alive: true, command: proc.command };
  };
  processes.signal = (pid, signal) => {
    processes.signals.push({ pid, signal });
    const proc = processes.byPid.get(pid);
    if (!proc) return { ok: false };
    if (signal === "SIGTERM" && !processes.ignoreTerm) {
      proc.alive = false;
      proc.listener?.({ code: 0, signal: "SIGTERM" });
    }
    return { ok: true };
  };
  return processes;
}

function createHarness(fixture, { packageRoot = fixture.primary } = {}) {
  const processes = createProcesses();
  const calls = [];
  const databases = new Set();
  const dumps = [];
  let failRestore = false;
  let failNpm = false;
  let failWorktreeRemove = false;
  let failDropdb = false;
  let missingTool = null;
  const busyPorts = new Set();
  const shellCalls = [];
  const overrides = { failRestore, failNpm, missingTool, busyPorts, databases, dumps, processes, calls, shellCalls };
  const env = {
    BASE_URL: SECRET_BASE,
    CONTEST_API_TOKEN: SECRET_TOKEN,
    DATABASE_URL: "postgres://comics:elsewhere-secret@127.0.0.1:5432/elsewhere",
    STORYBOARD_PORT: "9999",
    STORYBOARD_HOST: "0.0.0.0",
    IMAGE_MODEL: "gemini-3-pro-image-preview",
  };

  async function execFile(file, args, options = {}) {
    calls.push({ file, args: [...args], cwd: options.cwd ?? null, env: options.env ?? null });
    if (options.cwd === fixture.unrelated) throw new Error("command used the caller cwd");
    if (file === "git" && args.some((arg) => arg === "fetch")) throw new Error("git fetch was invoked");
    if (file === "git") {
      if (failWorktreeRemove && args.includes("worktree") && args.includes("remove")) {
        return { code: 1, stdout: "", stderr: "git worktree remove failed" };
      }
      try {
        const stdout = execFileSync("git", args, { cwd: options.cwd, encoding: "utf8" });
        return { code: 0, stdout, stderr: "" };
      } catch (error) {
        return { code: error.status ?? 1, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
      }
    }
    if (missingTool && (file === missingTool || (missingTool === "docker" && file === "docker"))) {
      return { code: 1, stdout: "", stderr: `${file} missing` };
    }
    if (args[0] === "--version" || (file === "docker" && args[0] === "compose" && args[1] === "version")) {
      return { code: 0, stdout: "ok\n", stderr: "" };
    }
    if (file === "docker") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (file === "npm") {
      if (args[0] === "ci") {
        if (failNpm) return { code: 17, stdout: "", stderr: "npm ci failed token=should-not-leak" };
        mkdirSync(join(options.cwd, "node_modules"), { recursive: true });
        writeFileSync(join(options.cwd, "node_modules/.installed"), "ok\n");
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    if (file === "pg_dump") {
      const fileArg = args.find((arg) => arg.startsWith("--file="));
      const dumpPath = fileArg.slice("--file=".length);
      mkdirSync(dirname(dumpPath), { recursive: true });
      writeFileSync(dumpPath, "PGDMP-fake");
      dumps.push(dumpPath);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (file === "createdb") {
      databases.add(args.at(-1));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (file === "pg_restore") {
      if (failRestore) return { code: 1, stdout: "", stderr: "restore failed" };
      return { code: 0, stdout: "", stderr: "" };
    }
    if (file === "dropdb") {
      if (args[0] !== "--version" && failDropdb) return { code: 1, stdout: "", stderr: "dropdb failed" };
      if (args[0] !== "--version") databases.delete(args.at(-1));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (file === "psql") {
      return { code: 0, stdout: "1\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unexpected ${file}` };
  }

  const deps = {
    packageRoot,
    callerCwd: fixture.unrelated,
    env,
    nodeVersion: "24.11.0",
    execFile,
    spawnDetached: (file, args, options) => processes.spawn(file, args, options),
    describeProcess: (pid) => processes.describe(pid),
    signalProcess: (pid, signal) => processes.signal(pid, signal),
    httpGet: async (url) => {
      if (processes.failHttp) throw new Error("unhealthy");
      const port = Number(new URL(url).port);
      const live = [...processes.byPid.values()].find((proc) => proc.alive && proc.port === port);
      if (!live) throw new Error("connection refused");
      return { status: 200 };
    },
    portOpen: async (port) => busyPorts.has(port) || [...processes.byPid.values()].some((proc) => proc.alive && proc.port === port),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => "2026-10-31T02:12:00.000Z",
    randomBytes,
    timeouts: { startupMs: 400, stopMs: 400, dbReadyMs: 400, lockWaitMs: 1500, pollMs: 10 },
    interactivePsql: async (args, psqlEnv) => {
      shellCalls.push({ args, env: psqlEnv });
      return shellCalls.exitCode ?? 0;
    },
  };

  return {
    deps,
    processes,
    calls,
    databases,
    dumps,
    shellCalls,
    env,
    set failRestore(value) { failRestore = value; },
    set failNpm(value) { failNpm = value; },
    set failWorktreeRemove(value) { failWorktreeRemove = value; },
    set failDropdb(value) { failDropdb = value; },
    set missingTool(value) { missingTool = value; },
    busyPorts,
  };
}

function assertNoSecrets(text) {
  const combined = String(text);
  assert.equal(combined.includes(SECRET_TOKEN), false);
  assert.equal(combined.includes(SECRET_PASSWORD), false);
  assert.equal(combined.includes(SECRET_BASE), false);
  assert.equal(combined.includes(FILE_SECRET), false);
  assert.equal(combined.includes("elsewhere-secret"), false);
  assert.doesNotMatch(combined, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(combined, /PGPASSWORD/i);
  assert.doesNotMatch(combined, /CONTEST_API_TOKEN/i);
  assert.doesNotMatch(combined, /DATABASE_URL/i);
}

function registryText(fixture) {
  const path = join(managedRoot(fixture), "registry.json");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function mutating(harness, file) {
  return harness.calls.filter((call) => call.file === file && call.args[0] !== "--version");
}

function combinedLogs(fixture) {
  const dir = join(managedRoot(fixture), "logs");
  if (!existsSync(dir)) return "";
  return readdirSync(dir).map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
}

test("managed root is the hidden sibling of the primary checkout", () => {
  assert.equal(managedRootFor("/Users/andrey/Documents/Projects/comics-pipeline"), "/Users/andrey/Documents/Projects/.comics-pipeline-runs");
  assert.equal(MANAGED_PORT_START, 4174);
  assert.equal(MANAGED_PORT_END, 4273);
});

test("parsing accepts the command surface and rejects malformed combinations", () => {
  assert.equal(parseArgs(["help"]).command, "help");
  assert.equal(parseArgs(["--help"]).command, "help");
  assert.equal(parseArgs(["start"]).mode, "main");
  assert.deepEqual(parseArgs(["start", "feature"]), { command: "start", mode: "default", ref: "feature", reuse: null });
  assert.equal(parseArgs(["start", "feature", "--fresh"]).mode, "fresh");
  assert.equal(parseArgs(["start", "--fresh", "feature"]).mode, "fresh");
  assert.equal(parseArgs(["start", "feature", "--reuse", "sha" + "a".repeat(40)]).mode, "reuse");
  assert.equal(parseArgs(["list"]).command, "list");
  assert.equal(parseArgs(["stop", "main"]).runId, "main");
  assert.equal(parseArgs(["clean", "main"]).command, "clean");
  assert.equal(parseArgs(["db", "list"]).command, "db-list");
  assert.equal(parseArgs(["db", "shell"]).runId, null);
  assert.equal(parseArgs(["db", "shell", "main"]).runId, "main");
  for (const argv of [
    [],
    ["compare", "a", "b"],
    ["start", "--fresh"],
    ["start", "--reuse", "main"],
    ["start", "feature", "--fresh", "--reuse", "main"],
    ["start", "feature", "extra"],
    ["start", "--open"],
    ["start", "feature", "--ephemeral"],
    ["ps"],
    ["open"],
    ["db"],
    ["db", "clean"],
    ["db", "shell", "main", "extra"],
    ["stop"],
    ["clean"],
    ["list", "extra"],
    ["help", "extra"],
    ["--help", "extra"],
    ["-h"],
  ]) {
    assert.throws(() => parseArgs(argv), /comics|usage|unknown|require|mutually|unexpected|invalid/i);
  }
});

test("help lists the accepted commands and does not advertise compare", async () => {
  const fixture = createRepository();
  try {
    const harness = createHarness(fixture);
    for (const argv of [["help"], ["--help"]]) {
      const result = await execute(argv, harness.deps);
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /comics start <ref> --fresh/);
      assert.match(result.stdout, /comics start <ref> --reuse <run-id>/);
      assert.match(result.stdout, /comics db shell \[<run-id>\]/);
      assert.equal(result.stdout.includes("compare"), false);
      assert.equal(harness.calls.length, 0);
    }
    const unknown = await execute(["compare", "a", "b"], harness.deps);
    assert.notEqual(unknown.exitCode, 0);
    assert.match(unknown.stderr, /unknown command 'compare'/);
    assert.match(unknown.stderr, /comics start/);
  } finally {
    fixture.cleanup();
  }
});

test("discovery selects the unique master worktree and ignores caller cwd", async () => {
  const fixture = createRepository();
  const feature = join(fixture.root, "feature");
  try {
    git(fixture.primary, ["branch", "feature"]);
    git(fixture.primary, ["worktree", "add", feature, "feature"]);
    const seen = [];
    const execFile = async (file, args, options = {}) => {
      seen.push(options.cwd ?? null);
      assert.notEqual(options.cwd, fixture.unrelated);
      try {
        const stdout = execFileSync(file, args, { cwd: options.cwd, encoding: "utf8" });
        return { code: 0, stdout, stderr: "" };
      } catch (error) {
        return { code: error.status ?? 1, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
      }
    };
    const found = await discoverPrimary(feature, execFile);
    assert.equal(realpathSync(found.primary), realPrimary(fixture));
    assert.equal(seen.includes(fixture.unrelated), false);
    const harness = createHarness(fixture, { packageRoot: feature });
    const listed = await execute(["list"], harness.deps);
    assert.equal(listed.exitCode, 0);
    assert.match(listed.stdout, new RegExp(`worktree: ${realPrimary(fixture)}`));
    assert.equal(harness.calls.some((call) => call.cwd === fixture.unrelated), false);
    assert.equal(harness.calls.some((call) => call.file === "git" && call.args.includes("fetch")), false);
  } finally {
    fixture.cleanup();
  }
});

test("discovery fails without a unique master worktree in the same repository", async () => {
  const responses = [
    { code: 0, stdout: "/repo/feature\n" },
    { code: 0, stdout: "/repo/.git\n" },
    { code: 0, stdout: "worktree /repo/primary\nHEAD abc\nbranch refs/heads/master\n\nworktree /repo/other\nHEAD def\nbranch refs/heads/master\n" },
    { code: 0, stdout: "/repo/.git\n" },
    { code: 0, stdout: "/repo/.git\n" },
  ];
  const execFile = async () => responses.shift();
  await assert.rejects(() => discoverPrimary("/repo/feature", execFile), /master worktree/);
  const missing = async (_file, args) => {
    if (args.includes("--show-toplevel")) return { code: 128, stdout: "", stderr: "not a git repository" };
    return { code: 1, stdout: "", stderr: "" };
  };
  await assert.rejects(() => discoverPrimary("/nowhere", missing), /repository/);
});

test("ref resolution accepts local commit-ish names and rejects ambiguous refs without fetching", async () => {
  const fixture = createRepository();
  const calls = [];
  const execFile = async (file, args, options = {}) => {
    calls.push(args);
    assert.equal(file, "git");
    assert.equal(args.includes("fetch"), false);
    try {
      const stdout = execFileSync(file, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: 0, stdout, stderr: "" };
    } catch (error) {
      return { code: error.status ?? 1, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "" };
    }
  };
  try {
    const full = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
    const branchSha = commitFile(fixture.primary, "branch.txt", "branch\n", "branch");
    git(fixture.primary, ["branch", "feature-a", branchSha]);
    git(fixture.primary, ["tag", "v1", full]);
    git(fixture.primary, ["update-ref", "refs/remotes/origin/feature-a", branchSha]);
    git(fixture.primary, ["branch", "same", full]);
    git(fixture.primary, ["tag", "same", branchSha]);
    const short = full.slice(0, 7);
    for (const [ref, sha] of [[full, full], [short, full], ["feature-a", branchSha], ["v1", full], ["origin/feature-a", branchSha]]) {
      const resolved = await resolveRef(fixture.primary, ref, execFile);
      assert.equal(resolved.sha, sha);
      assert.equal(resolved.requested, ref);
    }
    await assert.rejects(() => resolveRef(fixture.primary, "same", execFile), /ambiguous/);
    await assert.rejects(() => resolveRef(fixture.primary, "missing-ref", execFile), /unknown ref/);
    const groups = new Map();
    let ambiguous = null;
    for (let index = 0; index < 2000 && !ambiguous; index += 1) {
      const sha = commitFile(fixture.primary, "ambig.txt", `n${index}\n`, `n${index}`);
      const key = sha.slice(0, 4);
      const list = groups.get(key) ?? [];
      list.push(sha);
      groups.set(key, list);
      if (list.length > 1) ambiguous = key;
    }
    assert.ok(ambiguous);
    await assert.rejects(() => resolveRef(fixture.primary, ambiguous, execFile), /ambiguous/);
    assert.equal(calls.some((args) => args.includes("fetch")), false);
  } finally {
    fixture.cleanup();
  }
});

test("bare start launches the dirty primary checkout without a managed database or worktree", async () => {
  const fixture = createRepository();
  try {
    writeFileSync(join(fixture.primary, "local-note.txt"), "dirty\n");
    writeFileSync(join(fixture.primary, ".env.local"), `FILE_SECRET=${FILE_SECRET}\n`);
    const harness = createHarness(fixture);
    const result = await execute(["start"], harness.deps);
    assert.equal(result.exitCode, 0);
    const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
    assert.match(result.stdout, /run: main/);
    assert.match(result.stdout, /ref: master/);
    assert.match(result.stdout, new RegExp(`sha: ${sha}`));
    assert.match(result.stdout, /dirty: yes/);
    assert.match(result.stdout, new RegExp(`worktree: ${realPrimary(fixture)}`));
    assert.match(result.stdout, /database: comics\n/);
    assert.match(result.stdout, /port: 4173/);
    assert.match(result.stdout, /url: http:\/\/127\.0\.0\.1:4173\//);
    assert.match(result.stdout, /provider: enabled \(local configuration\)/);
    assert.equal(["createdb", "pg_dump", "pg_restore"].some((file) => mutating(harness, file).length > 0), false);
    assert.equal(harness.calls.some((call) => call.file === "git" && call.args.includes("worktree") && call.args.includes("add")), false);
    const dockerUp = harness.calls.filter((call) => call.file === "docker" && call.args[0] === "compose" && call.args[1] === "up");
    assert.equal(dockerUp.length, 1);
    assert.deepEqual(dockerUp[0].args, ["compose", "up", "-d", "db"]);
    assert.equal(dockerUp[0].cwd, realPrimary(fixture));
    assert.equal(harness.processes.spawns.length, 1);
    const spawn = harness.processes.spawns[0];
    assert.equal(spawn.options.cwd, realPrimary(fixture));
    assert.equal(spawn.options.env.STORYBOARD_HOST, "127.0.0.1");
    assert.equal(spawn.options.env.STORYBOARD_PORT, "4173");
    assert.equal(new URL(spawn.options.env.DATABASE_URL).pathname, "/comics");
    assert.equal(spawn.options.env.CONTEST_API_TOKEN, SECRET_TOKEN);
    assert.match(spawn.command, /--env-file-if-exists=/);
    assert.match(spawn.command, new RegExp(`--comics-cli-run=main`));
    assert.match(spawn.command, new RegExp(`--comics-cli-worktree=${realPrimary(fixture)}`));
    assert.equal(spawn.command.includes("postgres://"), false);
    assert.equal(existsSync(join(fixture.primary, ".env.local")), true);
    assertNoSecrets(`${result.stdout}\n${result.stderr}\n${registryText(fixture)}\n${combinedLogs(fixture)}`);
  } finally {
    fixture.cleanup();
  }
});

test("default ref start creates one detached worktree and database, then reuses both", async () => {
  const fixture = createRepository();
  const featureSha = commitFile(fixture.primary, "feature.txt", "feature\n", "feature");
  git(fixture.primary, ["branch", "feature-a", featureSha]);
  git(fixture.primary, ["checkout", "master"]);
  try {
    const harness = createHarness(fixture);
    const started = await execute(["start", "feature-a"], harness.deps);
    assert.equal(started.exitCode, 0, started.stderr);
    assert.match(started.stdout, /ref: feature-a/);
    assert.match(started.stdout, new RegExp(`sha: ${featureSha}`));
    assert.match(started.stdout, /provider: enabled \(local configuration\)/);
    const runId = `sha${featureSha}`;
    const database = databaseNameForRun(runId);
    assert.match(started.stdout, new RegExp(`database: ${database}`));
    assert.match(started.stdout, /port: 4174/);
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    assert.match(started.stdout, new RegExp(`worktree: ${worktree}`));
    assert.equal(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "HEAD");
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), featureSha);
    assert.equal(lstatSync(join(worktree, "node_modules")).isSymbolicLink(), false);
    assert.equal(existsSync(join(worktree, ".env.local")), false);
    assert.equal(harness.databases.has(database), true);
    assert.equal(harness.dumps.every((dump) => existsSync(dump)), false);
    const dump = mutating(harness, "pg_dump")[0];
    assert.equal(dump.args.includes("--format=custom"), true);
    assert.equal(dump.args.includes("--dbname=comics"), true);
    assert.equal(dump.args.some((arg) => arg.includes(database)), false);
    const npm = harness.calls.filter((call) => call.file === "npm" && call.args[0] === "ci");
    assert.equal(npm.length, 1);
    assert.equal(npm[0].cwd, worktree);
    await execute(["stop", runId], harness.deps);
    const callsBefore = harness.calls.length;
    const spawnsBefore = harness.processes.spawns.length;
    const again = await execute(["start", featureSha.slice(0, 8)], harness.deps);
    assert.equal(again.exitCode, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`run: ${runId}`));
    assert.match(again.stdout, new RegExp(`database: ${database}`));
    assert.equal(mutating(harness, "createdb").length, 1);
    assert.equal(harness.calls.filter((call) => call.file === "git" && call.args.includes("add") && call.args.includes("worktree")).length, 1);
    assert.equal(harness.calls.slice(callsBefore).some((call) => call.file === "npm" && call.args[0] === "ci"), false);
    assert.equal(harness.processes.spawns.length, spawnsBefore + 1);
    const child = harness.processes.spawns.at(-1);
    assert.equal(child.options.cwd, worktree);
    assert.equal(child.options.env.CONTEST_API_TOKEN, SECRET_TOKEN);
    assert.equal(new URL(child.options.env.DATABASE_URL).pathname, `/${database}`);
    assert.equal(child.options.env.STORYBOARD_HOST, "127.0.0.1");
    assert.notEqual(child.options.env.STORYBOARD_PORT, "4173");
    assertNoSecrets(`${started.stdout}${again.stdout}${registryText(fixture)}${combinedLogs(fixture)}`);
  } finally {
    fixture.cleanup();
  }
});

test("fresh creates a distinct run and reuse retargets only a clean stopped database", async () => {
  const fixture = createRepository();
  const first = commitFile(fixture.primary, "a.txt", "a\n", "a");
  try {
    const harness = createHarness(fixture);
    const initial = await execute(["start", first], harness.deps);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const defaultId = `sha${first}`;
    await execute(["stop", defaultId], harness.deps);
    const fresh = await execute(["start", first, "--fresh"], harness.deps);
    assert.equal(fresh.exitCode, 0, fresh.stderr);
    const freshId = fresh.stdout.match(/run: (f[0-9a-f]{16})/)[1];
    assert.notEqual(freshId, defaultId);
    assert.notEqual(databaseNameForRun(freshId), databaseNameForRun(defaultId));
    assert.equal(mutating(harness, "createdb").length, 2);
    assert.match(fresh.stdout, /port: 4175/);
    const second = commitFile(fixture.primary, "package-lock.json", "{\"name\":\"comics-pipeline\",\"lockfileVersion\":3,\"packages\":{}}\n", "lock");
    git(fixture.primary, ["checkout", "master"]);
    const worktree = join(managedRoot(fixture), "worktrees", defaultId);
    writeFileSync(join(worktree, "dirty.txt"), "dirty\n");
    const dirty = await execute(["start", second, "--reuse", defaultId], harness.deps);
    assert.notEqual(dirty.exitCode, 0);
    assert.match(dirty.stderr, /dirty/);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), first);
    assert.equal(harness.calls.some((call) => call.file === "git" && call.args.includes("checkout")), false);
    rmSync(join(worktree, "dirty.txt"));
    const running = await execute(["start", first], harness.deps);
    assert.equal(running.exitCode, 0, running.stderr);
    const refused = await execute(["start", second, "--reuse", defaultId], harness.deps);
    assert.notEqual(refused.exitCode, 0);
    assert.equal(harness.processes.signals.length, 1);
    await execute(["stop", defaultId], harness.deps);
    const npmBefore = harness.calls.filter((call) => call.file === "npm" && call.args[0] === "ci").length;
    const reused = await execute(["start", "master", "--reuse", defaultId], harness.deps);
    assert.equal(reused.exitCode, 0, reused.stderr);
    assert.match(reused.stdout, new RegExp(`previous-sha: ${first}`));
    assert.match(reused.stdout, /ref: master/);
    assert.match(reused.stdout, new RegExp(`sha: ${second}`));
    assert.match(reused.stdout, new RegExp(`database: ${databaseNameForRun(defaultId)}`));
    assert.match(reused.stdout, /does not downgrade migrations/);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), second);
    assert.equal(mutating(harness, "createdb").length, 2);
    assert.ok(harness.calls.filter((call) => call.file === "npm" && call.args[0] === "ci").length > npmBefore);
    const mainReuse = await execute(["start", second, "--reuse", "main"], harness.deps);
    assert.notEqual(mainReuse.exitCode, 0);
    assert.equal(harness.calls.some((call) => call.file === "git" && call.args.includes("fetch")), false);
  } finally {
    fixture.cleanup();
  }
});

test("ordinary start does not launch a reused run at a different SHA", async () => {
  const fixture = createRepository();
  const shaA = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  const shaB = commitFile(fixture.primary, "b.txt", "b\n", "b");
  try {
    const harness = createHarness(fixture);
    const started = await execute(["start", shaA], harness.deps);
    assert.equal(started.exitCode, 0, started.stderr);
    const runId = `sha${shaA}`;
    await execute(["stop", runId], harness.deps);
    const reused = await execute(["start", shaB, "--reuse", runId], harness.deps);
    assert.equal(reused.exitCode, 0, reused.stderr);
    await execute(["stop", runId], harness.deps);
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    const registryBefore = registryText(fixture);
    const spawnsBefore = harness.processes.spawns.length;
    const npmBefore = harness.calls.filter((call) => call.file === "npm" && call.args[0] === "ci").length;
    const ordinary = await execute(["start", shaA], harness.deps);
    assert.notEqual(ordinary.exitCode, 0);
    assert.match(ordinary.stderr, /previously reused/);
    assert.match(ordinary.stderr, /--reuse/);
    assert.match(ordinary.stderr, /--fresh/);
    assert.equal(ordinary.stdout.includes("status: running"), false);
    assert.equal(ordinary.stdout.includes(`sha: ${shaA}`), false);
    assert.equal(harness.processes.spawns.length, spawnsBefore);
    assert.equal(harness.calls.filter((call) => call.file === "npm" && call.args[0] === "ci").length, npmBefore);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), shaB);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId].resolvedSha, shaB);
    assert.equal(registryText(fixture), registryBefore);
    const back = await execute(["start", shaA, "--reuse", runId], harness.deps);
    assert.equal(back.exitCode, 0, back.stderr);
    assert.match(back.stdout, /does not downgrade migrations/);
    assert.match(back.stdout, new RegExp(`sha: ${shaA}`));
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), shaA);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId].resolvedSha, shaA);
  } finally {
    fixture.cleanup();
  }
});

test("ordinary restart refuses a drifted or dirty managed worktree before spawn", async () => {
  const fixture = createRepository();
  const shaA = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  const shaB = commitFile(fixture.primary, "drift.txt", "drift\n", "drift");
  try {
    const harness = createHarness(fixture);
    assert.equal((await execute(["start", shaA], harness.deps)).exitCode, 0);
    const runId = `sha${shaA}`;
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    await execute(["stop", runId], harness.deps);
    git(worktree, ["checkout", "--detach", shaB]);
    const spawnsBefore = harness.processes.spawns.length;
    const drifted = await execute(["start", shaA], harness.deps);
    assert.notEqual(drifted.exitCode, 0);
    assert.match(drifted.stderr, /inconsistent/);
    assert.equal(drifted.stdout.includes("status: running"), false);
    assert.equal(harness.processes.spawns.length, spawnsBefore);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), shaB);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId].resolvedSha, shaA);
    git(worktree, ["checkout", "--detach", shaA]);
    writeFileSync(join(worktree, "dirty.txt"), "dirty\n");
    const dirty = await execute(["start", shaA], harness.deps);
    assert.notEqual(dirty.exitCode, 0);
    assert.match(dirty.stderr, /inconsistent/);
    assert.equal(harness.processes.spawns.length, spawnsBefore);
    assert.equal(existsSync(join(worktree, "dirty.txt")), true);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]).trim(), shaA);
  } finally {
    fixture.cleanup();
  }
});

test("failed git worktree removal does not delete the run and can be retried", async () => {
  const fixture = createRepository();
  const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  const foreign = join(fixture.root, "foreign-worktree");
  try {
    const harness = createHarness(fixture);
    assert.equal((await execute(["start", sha], harness.deps)).exitCode, 0);
    const runId = `sha${sha}`;
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    const database = databaseNameForRun(runId);
    await execute(["stop", runId], harness.deps);
    git(fixture.primary, ["worktree", "add", "--detach", foreign, sha]);
    harness.failWorktreeRemove = true;
    const failed = await execute(["clean", runId], harness.deps);
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr, /git worktree remove failed/);
    assert.match(failed.stderr, new RegExp(worktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(existsSync(worktree), true);
    assert.equal(mutating(harness, "dropdb").length, 0);
    assert.equal(harness.databases.has(database), true);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId].databaseName, database);
    assert.equal(existsSync(foreign), true);
    assert.equal(harness.calls.some((call) => call.args.includes(foreign)), false);
    harness.failWorktreeRemove = false;
    const cleaned = await execute(["clean", runId], harness.deps);
    assert.equal(cleaned.exitCode, 0, cleaned.stderr);
    assert.equal(existsSync(worktree), false);
    assert.equal(harness.databases.has(database), false);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId], undefined);
    assert.equal(existsSync(foreign), true);
  } finally {
    fixture.cleanup();
  }
});

test("database drop failure after worktree removal stays retryable", async () => {
  const fixture = createRepository();
  const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  const foreign = join(fixture.root, "foreign-worktree");
  try {
    const harness = createHarness(fixture);
    assert.equal((await execute(["start", sha], harness.deps)).exitCode, 0);
    const runId = `sha${sha}`;
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    const database = databaseNameForRun(runId);
    await execute(["stop", runId], harness.deps);
    git(fixture.primary, ["worktree", "add", "--detach", foreign, sha]);
    harness.failDropdb = true;
    const failed = await execute(["clean", runId], harness.deps);
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr, new RegExp(database));
    assert.match(failed.stderr, /remains/);
    assert.equal(existsSync(worktree), false);
    assert.equal(harness.databases.has(database), true);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId].databaseName, database);
    assert.equal(existsSync(foreign), true);
    harness.failDropdb = false;
    const cleaned = await execute(["clean", runId], harness.deps);
    assert.equal(cleaned.exitCode, 0, cleaned.stderr);
    assert.equal(harness.databases.has(database), false);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId], undefined);
    assert.equal(existsSync(foreign), true);
    assert.equal(existsSync(fixture.primary), true);
  } finally {
    fixture.cleanup();
  }
});

test("creation rollback does not raw-delete a worktree when git removal fails", async () => {
  const fixture = createRepository();
  const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  try {
    const harness = createHarness(fixture);
    assert.equal((await execute(["start", sha], harness.deps)).exitCode, 0);
    const existingId = `sha${sha}`;
    const existingWorktree = join(managedRoot(fixture), "worktrees", existingId);
    await execute(["stop", existingId], harness.deps);
    harness.failNpm = true;
    harness.failWorktreeRemove = true;
    const failed = await execute(["start", sha, "--fresh"], harness.deps);
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr, /rollback incomplete/);
    const created = failed.stderr.match(/worktrees\/(f[0-9a-f]{16})/);
    assert.ok(created);
    const createdWorktree = join(managedRoot(fixture), "worktrees", created[1]);
    assert.equal(existsSync(createdWorktree), true);
    assert.equal(existsSync(existingWorktree), true);
    assert.equal(harness.databases.has(databaseNameForRun(existingId)), true);
    const registry = JSON.parse(registryText(fixture));
    assert.ok(registry.runs[existingId]);
    assert.equal(registry.runs[created[1]], undefined);
    assert.equal(failed.stdout.includes("status: running"), false);
  } finally {
    fixture.cleanup();
  }
});

test("healthy start is idempotent and foreign, unhealthy, or busy ports are not signaled", async () => {
  const fixture = createRepository();
  try {
    const harness = createHarness(fixture);
    const first = await execute(["start"], harness.deps);
    assert.equal(first.exitCode, 0, first.stderr);
    const second = await execute(["start"], harness.deps);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stdout, /url: http:\/\/127\.0\.0\.1:4173\//);
    assert.equal(harness.processes.spawns.length, 1);
    assert.equal(harness.calls.filter((call) => call.file === "docker" && call.args[1] === "up").length, 1);
    await execute(["stop", "main"], harness.deps);
    const restarted = await execute(["start"], harness.deps);
    assert.equal(restarted.exitCode, 0, restarted.stderr);
    assert.equal(harness.processes.spawns.length, 2);
    harness.processes.failHttp = true;
    const unhealthy = await execute(["start"], harness.deps);
    assert.notEqual(unhealthy.exitCode, 0);
    assert.match(unhealthy.stderr, /unhealthy/);
    assert.equal(harness.processes.spawns.length, 2);
    const signalCount = harness.processes.signals.length;
    assert.equal(signalCount, 1);
    harness.processes.failHttp = false;
    const pid = harness.processes.spawns.at(-1).pid;
    harness.processes.byPid.get(pid).command = "foreign-unrelated-process";
    harness.processes.byPid.get(pid).alive = true;
    harness.busyPorts.add(4173);
    const collided = await execute(["start"], harness.deps);
    assert.notEqual(collided.exitCode, 0);
    assert.match(collided.stderr, /4173/);
    assert.equal(harness.processes.signals.length, signalCount);
    assert.equal(harness.processes.spawns.length, 2);
  } finally {
    fixture.cleanup();
  }
});

test("stop signals only the matching process and preserves resources", async () => {
  const fixture = createRepository();
  const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  try {
    const harness = createHarness(fixture);
    await execute(["start", sha], harness.deps);
    const runId = `sha${sha}`;
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    const stopped = await execute(["stop", runId], harness.deps);
    assert.equal(stopped.exitCode, 0, stopped.stderr);
    assert.deepEqual(harness.processes.signals.map((item) => item.signal), ["SIGTERM"]);
    assert.equal(existsSync(worktree), true);
    assert.equal(harness.databases.has(databaseNameForRun(runId)), true);
    assert.match(registryText(fixture), new RegExp(runId));
    const again = await execute(["stop", runId], harness.deps);
    assert.equal(again.exitCode, 0, again.stderr);
    assert.equal(harness.processes.signals.length, 1);
    harness.processes.byPid.get(harness.processes.spawns[0].pid).alive = true;
    harness.processes.byPid.get(harness.processes.spawns[0].pid).command = "foreign-unrelated-process";
    const registry = JSON.parse(registryText(fixture));
    registry.runs[runId].pid = harness.processes.spawns[0].pid;
    registry.runs[runId].state = "running";
    writeFileSync(join(managedRoot(fixture), "registry.json"), JSON.stringify(registry));
    const mismatch = await execute(["stop", runId], harness.deps);
    assert.notEqual(mismatch.exitCode, 0);
    assert.equal(harness.processes.signals.length, 1);
    assert.match(registryText(fixture), new RegExp(databaseNameForRun(runId)));
  } finally {
    fixture.cleanup();
  }
});

test("clean deletes only a stopped managed run and refuses unsafe targets", async () => {
  const fixture = createRepository();
  const sha = commitFile(fixture.primary, "clean.txt", "clean\n", "clean");
  try {
    const harness = createHarness(fixture);
    await execute(["start"], harness.deps);
    const mainClean = await execute(["clean", "main"], harness.deps);
    assert.notEqual(mainClean.exitCode, 0);
    assert.equal(mutating(harness, "dropdb").length, 0);
    await execute(["start", sha], harness.deps);
    const runId = `sha${sha}`;
    const worktree = join(managedRoot(fixture), "worktrees", runId);
    const database = databaseNameForRun(runId);
    const running = await execute(["clean", runId], harness.deps);
    assert.notEqual(running.exitCode, 0);
    assert.equal(existsSync(worktree), true);
    assert.equal(mutating(harness, "dropdb").length, 0);
    harness.processes.failHttp = true;
    const unhealthy = await execute(["clean", runId], harness.deps);
    assert.notEqual(unhealthy.exitCode, 0);
    harness.processes.failHttp = false;
    await execute(["stop", runId], harness.deps);
    writeFileSync(join(worktree, "dirty.txt"), "dirty\n");
    const dirty = await execute(["clean", runId], harness.deps);
    assert.notEqual(dirty.exitCode, 0);
    assert.match(dirty.stderr, /dirty/);
    assert.equal(existsSync(worktree), true);
    rmSync(join(worktree, "dirty.txt"));
    const registry = JSON.parse(registryText(fixture));
    registry.runs[runId].worktree = join(fixture.root, "escape");
    writeFileSync(join(managedRoot(fixture), "registry.json"), JSON.stringify(registry));
    const inconsistent = await execute(["clean", runId], harness.deps);
    assert.notEqual(inconsistent.exitCode, 0);
    registry.runs[runId].worktree = worktree;
    writeFileSync(join(managedRoot(fixture), "registry.json"), JSON.stringify(registry));
    const cleaned = await execute(["clean", runId], harness.deps);
    assert.equal(cleaned.exitCode, 0, cleaned.stderr);
    assert.match(cleaned.stdout, new RegExp(worktree));
    assert.match(cleaned.stdout, new RegExp(database));
    assert.equal(existsSync(worktree), false);
    assert.equal(harness.databases.has(database), false);
    assert.equal(harness.databases.has("comics"), false);
    const drop = mutating(harness, "dropdb");
    assert.equal(drop.length, 1);
    assert.equal(drop[0].args.at(-1), database);
    assert.equal(drop[0].args.includes("--force"), false);
    assert.equal(JSON.parse(registryText(fixture)).runs[runId], undefined);
    assert.match(registryText(fixture), /main/);
  } finally {
    fixture.cleanup();
  }
});

test("creation failure rolls back only resources created by that invocation", async () => {
  const fixture = createRepository();
  const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  try {
    const harness = createHarness(fixture);
    const existing = await execute(["start", sha], harness.deps);
    assert.equal(existing.exitCode, 0, existing.stderr);
    const existingId = `sha${sha}`;
    await execute(["stop", existingId], harness.deps);
    harness.failRestore = true;
    const failed = await execute(["start", sha, "--fresh"], harness.deps);
    assert.notEqual(failed.exitCode, 0);
    const freshDrops = mutating(harness, "dropdb").map((call) => call.args.at(-1));
    assert.equal(freshDrops.includes(databaseNameForRun(existingId)), false);
    assert.equal(freshDrops.length, 1);
    assert.equal(harness.databases.has(databaseNameForRun(existingId)), true);
    assert.equal(existsSync(join(managedRoot(fixture), "worktrees", existingId)), true);
    assert.equal(harness.dumps.every((dump) => existsSync(dump)), false);
    const registry = JSON.parse(registryText(fixture));
    assert.ok(registry.runs[existingId]);
    assert.equal(Object.keys(registry.runs).some((id) => id.startsWith("f")), false);
    harness.failRestore = false;
    harness.failNpm = true;
    const npmFailed = await execute(["start", sha, "--fresh"], harness.deps);
    assert.notEqual(npmFailed.exitCode, 0);
    assert.match(npmFailed.stderr, /dependency installation failed/);
    assert.equal(Object.keys(JSON.parse(registryText(fixture)).runs).filter((id) => id !== "main" && id !== existingId).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("registry writes are atomic, locked, and untrustworthy when malformed", async () => {
  const fixture = createRepository();
  const root = managedRoot(fixture);
  try {
    mkdirSync(root, { recursive: true });
    const original = { version: 1, runs: { main: { id: "main", databaseName: "comics" } } };
    writeRegistryAtomic(root, original);
    assert.throws(() => writeRegistryAtomic(root, { version: 1, runs: {} }, { crashBeforeRename: true }));
    assert.deepEqual(readRegistry(root), original);
    assert.equal(readFileSync(join(root, "registry.json"), "utf8").includes("\"runs\": {}"), false);
    writeFileSync(join(root, ".registry.partial.tmp"), "{");
    assert.deepEqual(readRegistry(root).runs.main.id, "main");
    writeFileSync(join(root, "registry.json"), "{");
    const harness = createHarness(fixture);
    const failed = await execute(["start"], harness.deps);
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr, /malformed/);
    assert.equal(readFileSync(join(root, "registry.json"), "utf8"), "{");
    assert.equal(harness.calls.some((call) => call.file === "docker" && call.args.includes("up")), false);
    writeFileSync(join(root, "registry.json"), JSON.stringify(original));
    let release;
    let entered = false;
    const deps = {
      ...harness.deps,
      describeProcess: async (pid) => ({ alive: pid === process.pid, command: "node --test" }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    const first = withRegistry(root, async () => {
      entered = true;
      await new Promise((resolve) => { release = resolve; });
    }, deps);
    while (!entered) await deps.sleep(5);
    let secondDone = false;
    const second = withRegistry(root, async () => { secondDone = true; }, deps);
    await deps.sleep(40);
    assert.equal(secondDone, false);
    release();
    await first;
    await second;
    assert.equal(secondDone, true);
    writeFileSync(join(root, "registry.lock"), JSON.stringify({ pid: 999999, createdAt: "2020-01-01T00:00:00.000Z" }));
    await withRegistry(root, async (state) => { state.dirty = false; }, deps);
    assert.equal(existsSync(join(root, "registry.lock")), false);
  } finally {
    fixture.cleanup();
  }
});

test("db list owns only registered databases and db shell preserves interactive exit", async () => {
  const fixture = createRepository();
  const sha = git(fixture.primary, ["rev-parse", "HEAD"]).trim();
  try {
    const harness = createHarness(fixture);
    await execute(["start", sha], harness.deps);
    const runId = `sha${sha}`;
    const listed = await execute(["db", "list"], harness.deps);
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.match(listed.stdout, /database: comics/);
    assert.match(listed.stdout, new RegExp(`database: ${databaseNameForRun(runId)}`));
    assert.match(listed.stdout, new RegExp(`run: ${runId}`));
    assert.equal(listed.stdout.includes("comics_test"), false);
    assert.equal(harness.calls.some((call) => call.file === "psql" && call.args.includes("pg_database")), false);
    const shell = await execute(["db", "shell", runId], harness.deps);
    assert.equal(typeof shell.interactive, "function");
    harness.shellCalls.exitCode = 7;
    assert.equal(await shell.interactive(), 7);
    assert.equal(harness.shellCalls[0].args.at(-1), databaseNameForRun(runId));
    assert.equal(harness.shellCalls[0].args.join(" ").includes("postgres://"), false);
    assert.equal(harness.shellCalls[0].env.DATABASE_URL, undefined);
    assert.equal(harness.shellCalls[0].env.PGPASSWORD, SECRET_PASSWORD);
    assertNoSecrets(`${shell.stdout}\n${shell.stderr}`);
    const mainShell = await execute(["db", "shell"], harness.deps);
    assert.equal(await mainShell.interactive(), 7);
    assert.equal(harness.shellCalls.at(-1).args.at(-1), "comics");
    const unknown = await execute(["db", "shell", "sha" + "b".repeat(40)], harness.deps);
    assert.notEqual(unknown.exitCode, 0);
    assert.equal(unknown.interactive, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("timeouts and missing tools fail before claiming a run started", async () => {
  const fixture = createRepository();
  try {
    const harness = createHarness(fixture);
    harness.deps.nodeVersion = "22.0.0";
    const oldNode = await execute(["start"], harness.deps);
    assert.notEqual(oldNode.exitCode, 0);
    assert.match(oldNode.stderr, /Node\.js >=24/);
    assert.equal(harness.processes.spawns.length, 0);
    harness.deps.nodeVersion = "24.11.0";
    harness.missingTool = "docker";
    const noDocker = await execute(["start"], harness.deps);
    assert.notEqual(noDocker.exitCode, 0);
    assert.match(noDocker.stderr, /docker compose/);
    assert.equal(harness.calls.some((call) => call.args.includes("up")), false);
    const ready = createHarness(fixture);
    const original = ready.deps.execFile;
    ready.deps.execFile = async (file, args, options) => {
      if (file === "psql" && args.includes("SELECT 1")) return { code: 2, stdout: "", stderr: `password=${SECRET_PASSWORD}` };
      return original(file, args, options);
    };
    ready.deps.timeouts = { ...ready.deps.timeouts, dbReadyMs: 30, pollMs: 10 };
    const unavailable = await execute(["start"], ready.deps);
    assert.notEqual(unavailable.exitCode, 0);
    assert.match(unavailable.stderr, /did not become ready/);
    assertNoSecrets(unavailable.stderr);
    assert.equal(ready.processes.spawns.length, 0);
    const startup = createHarness(fixture);
    startup.processes.exitOnSpawn = true;
    const exited = await execute(["start"], startup.deps);
    assert.notEqual(exited.exitCode, 0);
    assert.match(exited.stderr, /did not become healthy/);
    assert.equal(exited.stdout.includes("status: running"), false);
    const hung = createHarness(fixture);
    hung.processes.failHttp = true;
    hung.deps.timeouts = { ...hung.deps.timeouts, startupMs: 30, pollMs: 10 };
    const timeout = await execute(["start"], hung.deps);
    assert.notEqual(timeout.exitCode, 0);
    assert.match(timeout.stderr, /did not become healthy/);
    assert.equal(timeout.stdout.includes("status: running"), false);
  } finally {
    fixture.cleanup();
  }
});

test("stop reports a process that ignores SIGTERM without sending SIGKILL", async () => {
  const fixture = createRepository();
  try {
    const harness = createHarness(fixture);
    await execute(["start"], harness.deps);
    harness.processes.ignoreTerm = true;
    harness.deps.timeouts = { ...harness.deps.timeouts, stopMs: 40, pollMs: 10 };
    const result = await execute(["stop", "main"], harness.deps);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(harness.processes.signals.map((item) => item.signal), ["SIGTERM"]);
    assert.equal(JSON.parse(registryText(fixture)).runs.main.state, "running");
  } finally {
    fixture.cleanup();
  }
});

test("port selection stays inside the managed range", async () => {
  const blocked = new Set([4174]);
  const chosen = await choosePort({
    preferred: 4173,
    blocked,
    isOpen: async (port) => port === 4175,
    start: MANAGED_PORT_START,
    end: MANAGED_PORT_END,
  });
  assert.equal(chosen, 4176);
  const none = await choosePort({
    preferred: null,
    blocked: new Set(),
    isOpen: async () => true,
    start: MANAGED_PORT_START,
    end: MANAGED_PORT_START + 1,
  });
  assert.equal(none, null);
});

test("package bin runs from an unrelated directory via a disposable prefix", async () => {
  const prefix = mkdtempSync(join(tmpdir(), "comics-cli-prefix-"));
  const unrelated = mkdtempSync(join(tmpdir(), "comics-cli-cwd-"));
  const globalPrefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
  const globalBin = join(globalPrefix, "bin", "comics");
  const before = existsSync(globalBin) ? statSync(globalBin).mtimeMs : null;
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.bin.comics, "./bin/comics.mjs");
  assert.equal(pkg.dependencies.ajv, "^8.17.1");
  try {
    const linked = await execFileAsync("npm", ["link"], {
      cwd: repoRoot,
      env: { ...process.env, npm_config_prefix: prefix, PREFIX: prefix },
      encoding: "utf8",
    });
    assert.equal(linked.stderr.includes("ERR"), false);
    const bin = join(prefix, "bin", "comics");
    const help = await execFileAsync(bin, ["--help"], { cwd: unrelated, encoding: "utf8" });
    assert.match(help.stdout, /comics start/);
    assert.equal(help.stdout.includes("compare"), false);
    const after = existsSync(globalBin) ? statSync(globalBin).mtimeMs : null;
    assert.equal(after, before);
  } finally {
    removeTree(prefix);
    removeTree(unrelated);
  }
});
