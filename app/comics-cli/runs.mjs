import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { databaseNameForRun, assertManagedDatabaseName, databaseUrl, pgEnv, readComposeDatabase } from "./database.mjs";
import { runGit } from "./git.mjs";
import { CliError } from "./errors.mjs";
import {
  DEFAULT_TIMEOUTS,
  MAIN_DATABASE,
  MAIN_HOST,
  MAIN_PORT,
  MAIN_RUN_ID,
  MANAGED_PORT_END,
  MANAGED_PORT_START,
  PROVIDER_MODE,
  REUSE_SCHEMA_WARNING,
  SERVER_RELATIVE,
  assertInside,
  defaultRunId,
  isManagedRunId,
  managedRootFor,
  worktreePathFor,
} from "./constants.mjs";
import { choosePort } from "./ports.mjs";
import { readRegistry, withRegistry } from "./registry.mjs";
import { resolveRef } from "./refs.mjs";

const START_TOOLS = ["git", "npm", "docker", "psql", "pg_dump", "pg_restore", "createdb", "dropdb"];

function timeoutsOf(deps) {
  return { ...DEFAULT_TIMEOUTS, ...deps.timeouts };
}

function parseUserRunId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new CliError("invalid run id", { usage: true });
  return id;
}

function freshRunId(deps, runs) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `f${deps.randomBytes(8).toString("hex")}`;
    if (!runs[id]) return id;
  }
  throw new CliError("could not allocate a run id");
}

function loadAuth(primary, secrets) {
  let text;
  try {
    text = readFileSync(join(primary, "docker-compose.yml"), "utf8");
  } catch {
    throw new CliError("primary docker-compose.yml is missing");
  }
  const auth = readComposeDatabase(text);
  if (auth.password.length >= 12) secrets.push(auth.password);
  return auth;
}

async function assertNode(deps) {
  const version = String(deps.nodeVersion ?? "");
  const match = /^v?(\d+)\./.exec(version);
  const major = match ? Number(match[1]) : 0;
  if (major < 24) throw new CliError(`Node.js >=24 is required (found ${version || "unknown"})`);
}

async function assertTools(deps, names, cwd) {
  for (const name of names) {
    const args = name === "docker" ? ["compose", "version"] : ["--version"];
    let result;
    try {
      result = await deps.execFile(name, args, { cwd });
    } catch {
      result = { code: 127 };
    }
    if (!result || result.code !== 0) {
      throw new CliError(name === "docker" ? "docker compose is unavailable" : `${name} is unavailable`);
    }
  }
}

async function ensureDatabaseReady(primary, auth, deps, secrets) {
  const up = await deps.execFile("docker", ["compose", "up", "-d", "db"], { cwd: primary, env: deps.env });
  if (!up || up.code !== 0) throw new CliError("docker compose up -d db failed");
  const deadline = Date.now() + timeoutsOf(deps).dbReadyMs;
  do {
    const ready = await deps.execFile("psql", [
      "-h", "127.0.0.1",
      "-p", "5432",
      "-U", auth.user,
      "-d", MAIN_DATABASE,
      "-v", "ON_ERROR_STOP=1",
      "-c", "SELECT 1",
    ], { cwd: primary, env: pgEnv(deps.env, auth) });
    if (ready?.code === 0) return;
    if (Date.now() >= deadline) break;
    await deps.sleep(timeoutsOf(deps).pollMs);
  } while (Date.now() < deadline);
  throw new CliError("PostgreSQL did not become ready at 127.0.0.1:5432");
}

function serverEnvironment(baseEnv, { port, databaseName, auth }) {
  return {
    ...baseEnv,
    STORYBOARD_HOST: MAIN_HOST,
    STORYBOARD_PORT: String(port),
    DATABASE_URL: databaseUrl({ ...auth, database: databaseName }),
  };
}

export function commandMatches(command, { serverPath, runId, worktree }) {
  if (typeof command !== "string" || command.length === 0) return false;
  return command.includes(serverPath)
    && command.includes(`--comics-cli-run=${runId}`)
    && command.includes(`--comics-cli-worktree=${worktree}`);
}

async function inspectRun(run, deps) {
  if (!run?.pid) return "stopped";
  const described = await deps.describeProcess(run.pid);
  if (!described?.alive) return "stopped";
  const serverPath = join(run.worktree, SERVER_RELATIVE);
  if (!commandMatches(described.command, { serverPath, runId: run.id, worktree: run.worktree })) return "stale";
  try {
    const response = await deps.httpGet(`http://${MAIN_HOST}:${run.port}/`, { timeout: timeoutsOf(deps).pollMs });
    if (response?.status >= 200 && response.status < 400) return "running";
  } catch {
    return "unhealthy";
  }
  return "unhealthy";
}

function validateRecord(run, root, primary) {
  if (!run || typeof run !== "object" || run.id == null) return "record";
  if (run.id === MAIN_RUN_ID) {
    if (run.databaseName !== MAIN_DATABASE) return "database";
    if (run.port !== MAIN_PORT) return "port";
    if (resolvePath(run.worktree) !== resolvePath(primary)) return "worktree";
    return null;
  }
  if (!isManagedRunId(run.id)) return "id";
  let expectedDatabase;
  try {
    expectedDatabase = databaseNameForRun(run.id);
  } catch {
    return "database";
  }
  if (run.databaseName !== expectedDatabase) return "database";
  let expectedWorktree;
  try {
    expectedWorktree = worktreePathFor(root, run.id);
  } catch {
    return "worktree";
  }
  if (resolvePath(run.worktree) !== resolvePath(expectedWorktree)) return "worktree";
  if (!Number.isInteger(run.port) || run.port < MANAGED_PORT_START || run.port > MANAGED_PORT_END) return "port";
  return null;
}

function resolvePath(path) {
  return resolve(path);
}

function formatDetails(run, { dirty = null, status = "running", lines = [] } = {}) {
  const body = [
    ...lines,
    `run: ${run.id}`,
    `ref: ${run.requestedRef}`,
    `sha: ${run.resolvedSha}`,
  ];
  if (dirty != null) body.push(`dirty: ${dirty ? "yes" : "no"}`);
  body.push(
    `status: ${status}`,
    `worktree: ${run.worktree}`,
    `database: ${run.databaseName}`,
    `port: ${run.port}`,
    `url: http://${MAIN_HOST}:${run.port}/`,
    `provider: ${PROVIDER_MODE}`,
  );
  return `${body.join("\n")}\n`;
}

async function isDirty(execFile, cwd) {
  const stdout = await runGit(execFile, cwd, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  return stdout.trim().length > 0;
}

async function headSha(execFile, cwd) {
  return (await runGit(execFile, cwd, ["rev-parse", "HEAD"])).trim();
}

async function launch(input, primary, deps) {
  if (input.id !== MAIN_RUN_ID) {
    await assertReusableWorktree(primary, input.root, input, deps);
  }
  const serverPath = join(input.worktree, SERVER_RELATIVE);
  if (!existsSync(serverPath)) throw new CliError(`server entry is missing at ${serverPath}`);
  const logDir = join(input.root, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${input.id}.log`);
  assertInside(logDir, logPath);
  appendFileSync(logPath, `[${deps.now()}] start run=${input.id} port=${input.port}\n`);
  const args = [
    `--env-file-if-exists=${join(primary, ".env.local")}`,
    serverPath,
    `--comics-cli-run=${input.id}`,
    `--comics-cli-worktree=${input.worktree}`,
  ];
  const child = deps.spawnDetached(process.execPath, args, {
    cwd: input.worktree,
    env: serverEnvironment(deps.env, input),
    logPath,
  });
  let exited = null;
  child.onExit((info) => { exited = info; });
  const deadline = Date.now() + timeoutsOf(deps).startupMs;
  let healthy = false;
  while (!exited && Date.now() < deadline) {
    const described = await deps.describeProcess(child.pid);
    if (!described?.alive) break;
    try {
      const response = await deps.httpGet(`http://${MAIN_HOST}:${input.port}/`, { timeout: timeoutsOf(deps).pollMs });
      if (response?.status >= 200 && response.status < 400) {
        healthy = true;
        break;
      }
    } catch {
      // The server is still starting or has failed its health check.
    }
    if (Date.now() >= deadline) break;
    await deps.sleep(timeoutsOf(deps).pollMs);
  }
  const identity = { serverPath, runId: input.id, worktree: input.worktree };
  const record = {
    id: input.id,
    kind: input.kind,
    requestedRef: input.requestedRef,
    resolvedSha: input.resolvedSha,
    worktree: input.worktree,
    databaseName: input.databaseName,
    host: MAIN_HOST,
    port: input.port,
    pid: child.pid,
    state: "running",
    createdAt: input.createdAt ?? deps.now(),
    updatedAt: deps.now(),
  };
  if (healthy) return { record, healthy: true };
  const described = await deps.describeProcess(child.pid);
  if (described?.alive && commandMatches(described.command, identity)) {
    deps.signalProcess(child.pid, "SIGTERM");
    const stopDeadline = Date.now() + Math.min(timeoutsOf(deps).stopMs, 300);
    while (Date.now() < stopDeadline) {
      const again = await deps.describeProcess(child.pid);
      if (!again?.alive) break;
      await deps.sleep(timeoutsOf(deps).pollMs);
    }
  }
  const still = await deps.describeProcess(child.pid);
  if (still?.alive && commandMatches(still.command, identity)) {
    record.state = "unhealthy";
  } else {
    record.state = "stopped";
    record.pid = null;
  }
  return { record, healthy: false };
}

async function installDependencies(worktree, deps, secrets, lines) {
  if (!existsSync(join(worktree, "package-lock.json"))) {
    throw new CliError(`package-lock.json is required for dependency installation in ${worktree}`);
  }
  lines.push(`installing dependencies in ${worktree}`);
  const result = await deps.execFile("npm", ["ci"], { cwd: worktree, env: deps.env });
  if (!result || result.code !== 0) {
    throw new CliError(`dependency installation failed in ${worktree}`);
  }
}

async function lockBlob(execFile, primary, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  const result = await execFile("git", ["-C", primary, "rev-parse", `${sha}:package-lock.json`], { cwd: primary });
  if (!result || result.code !== 0) return null;
  return result.stdout.trim();
}

async function needsInstall(primary, worktree, previousSha, nextSha, deps) {
  if (!existsSync(join(worktree, "node_modules"))) return true;
  if (!previousSha || previousSha === nextSha) return false;
  const before = await lockBlob(deps.execFile, primary, previousSha);
  const after = await lockBlob(deps.execFile, primary, nextSha);
  return before !== after;
}

function reservedPorts(runs, exceptId) {
  const blocked = new Set();
  for (const run of Object.values(runs)) {
    if (run.id === exceptId) continue;
    if (Number.isInteger(run.port)) blocked.add(run.port);
  }
  return blocked;
}

async function allocatePort(runs, runId, preferred, deps) {
  const port = await choosePort({
    preferred,
    blocked: reservedPorts(runs, runId),
    isOpen: (candidate) => deps.portOpen(candidate),
    start: MANAGED_PORT_START,
    end: MANAGED_PORT_END,
  });
  if (port == null) throw new CliError(`no free loopback port in ${MANAGED_PORT_START}-${MANAGED_PORT_END}`);
  return port;
}

async function createDatabaseCopy(root, runId, auth, deps, created) {
  const database = databaseNameForRun(runId);
  const snapshots = join(root, "snapshots");
  mkdirSync(snapshots, { recursive: true });
  const dump = join(snapshots, `${runId}-${deps.randomBytes(4).toString("hex")}.dump`);
  assertInside(snapshots, dump);
  created.dump = dump;
  try {
    const dumped = await deps.execFile("pg_dump", [
      "--host=127.0.0.1",
      "--port=5432",
      `--username=${auth.user}`,
      "--dbname=comics",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${dump}`,
    ], { cwd: root, env: pgEnv(deps.env, auth) });
    if (!dumped || dumped.code !== 0 || !existsSync(dump)) throw new CliError("pg_dump of database comics failed");
    const createdb = await deps.execFile("createdb", [
      "--host=127.0.0.1",
      "--port=5432",
      `--username=${auth.user}`,
      `--owner=${auth.user}`,
      database,
    ], { cwd: root, env: pgEnv(deps.env, auth) });
    if (!createdb || createdb.code !== 0) throw new CliError(`createdb ${database} failed`);
    created.database = database;
    const restored = await deps.execFile("pg_restore", [
      "--host=127.0.0.1",
      "--port=5432",
      `--username=${auth.user}`,
      `--dbname=${database}`,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      dump,
    ], { cwd: root, env: pgEnv(deps.env, auth) });
    if (!restored || restored.code !== 0) throw new CliError(`pg_restore into ${database} failed`);
  } finally {
    if (existsSync(dump)) rmSync(dump, { force: true });
  }
}

async function commonDir(execFile, cwd) {
  const text = (await runGit(execFile, cwd, ["rev-parse", "--git-common-dir"])).trim();
  const absolute = isAbsolute(text) ? text : resolve(cwd, text);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

async function assertReusableWorktree(primary, root, run, deps) {
  const expected = worktreePathFor(root, run.id);
  if (resolve(run.worktree) !== resolve(expected) || !existsSync(expected)) {
    throw new CliError(`run ${run.id} is inconsistent (worktree)`);
  }
  const [worktreeCommon, primaryCommon] = await Promise.all([
    commonDir(deps.execFile, expected),
    commonDir(deps.execFile, primary),
  ]);
  if (worktreeCommon !== primaryCommon) throw new CliError(`run ${run.id} is inconsistent (worktree repository)`);
  const actual = await headSha(deps.execFile, expected);
  if (actual !== run.resolvedSha) {
    throw new CliError(`run ${run.id} is inconsistent (worktree HEAD ${actual} does not match ${run.resolvedSha})`);
  }
  if (await isDirty(deps.execFile, expected)) throw new CliError(`run ${run.id} is inconsistent (worktree is dirty)`);
}

async function removeManagedWorktree(primary, root, worktreePath, deps) {
  const target = resolve(worktreePath);
  assertInside(resolve(root, "worktrees"), target);
  if (!existsSync(target)) return;
  const removed = await deps.execFile("git", ["-C", primary, "worktree", "remove", "--force", target], { cwd: primary });
  if (!removed || removed.code !== 0 || existsSync(target)) {
    throw new CliError(`git worktree remove failed for ${target}`);
  }
}

async function rollbackCreated(primary, root, created, deps) {
  if (created?.dump && existsSync(created.dump)) rmSync(created.dump, { force: true });
  if (created?.worktree) {
    try {
      await removeManagedWorktree(primary, root, created.worktree, deps);
    } catch (error) {
      const databaseNote = created.database ? `; database ${created.database} remains` : "";
      const reason = error instanceof CliError ? error.message : "git worktree remove failed";
      throw new CliError(`rollback incomplete: ${reason}${databaseNote}`);
    }
  }
  if (created?.database) {
    assertManagedDatabaseName(created.database);
    const dropped = await deps.execFile("dropdb", [
      "--host=127.0.0.1",
      "--port=5432",
      `--username=${created.user}`,
      created.database,
    ], { cwd: primary, env: pgEnv(deps.env, created.auth) });
    if (!dropped || dropped.code !== 0) throw new CliError(`rollback incomplete: database ${created.database} remains`);
  }
}

async function addWorktree(primary, worktree, sha, deps) {
  mkdirSync(join(worktree, ".."), { recursive: true });
  if (existsSync(worktree)) throw new CliError(`managed worktree already exists at ${worktree}`);
  await runGit(deps.execFile, primary, ["worktree", "add", "--detach", worktree, sha]);
}

function rememberFailure(lines, error) {
  if (error instanceof CliError && !error.stdout && lines.length > 0) {
    error.stdout = `${lines.join("\n")}\n`;
  }
  return error;
}

async function startRecorded(run, primary, root, auth, deps, state, { dirty = null, lines = [], extra = [] } = {}) {
  const status = await inspectRun(run, deps);
  if (status === "running") return `${prefix(lines)}${formatDetails(run, { dirty, status, lines: extra })}`;
  if (status === "unhealthy") throw new CliError(`run ${run.id} is unhealthy at http://${MAIN_HOST}:${run.port}/`);
  if (run.id === MAIN_RUN_ID) {
    if (await deps.portOpen(MAIN_PORT)) throw new CliError("port 4173 is in use by another process; refusing to start run main");
  }
  await assertTools(deps, START_TOOLS, primary);
  await ensureDatabaseReady(primary, auth, deps, []);
  const port = run.id === MAIN_RUN_ID ? MAIN_PORT : await allocatePort(state.data.runs, run.id, run.port, deps);
  const launched = await launch({ ...run, root, port, auth }, primary, deps);
  state.data.runs[run.id] = launched.record;
  state.dirty = true;
  if (!launched.healthy) throw new CliError(`run ${run.id} did not become healthy`);
  return `${prefix(lines)}${formatDetails(launched.record, { dirty, status: "running", lines: extra })}`;
}

function prefix(lines) {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export async function startCommand(parsed, context, deps, secrets) {
  const primary = context.primary;
  const root = managedRootFor(primary);
  const lines = [];
  try {
    return await withRegistry(root, async (state) => {
      await assertNode(deps);
      const auth = loadAuth(primary, secrets);
      if (parsed.mode === "main") {
        const sha = await headSha(deps.execFile, primary);
        const dirty = await isDirty(deps.execFile, primary);
        const existing = state.data.runs[MAIN_RUN_ID];
        if (existing) {
          const problem = validateRecord(existing, root, primary);
          if (problem) throw new CliError(`run main is inconsistent (${problem})`);
          existing.requestedRef = "master";
          existing.resolvedSha = sha;
          return startRecorded(existing, primary, root, auth, deps, state, { dirty });
        }
        if (await deps.portOpen(MAIN_PORT)) throw new CliError("port 4173 is in use by another process; refusing to start run main");
        await assertTools(deps, START_TOOLS, primary);
        await ensureDatabaseReady(primary, auth, deps, secrets);
        const launched = await launch({
          id: MAIN_RUN_ID,
          kind: "main",
          requestedRef: "master",
          resolvedSha: sha,
          worktree: primary,
          databaseName: MAIN_DATABASE,
          root,
          port: MAIN_PORT,
          auth,
        }, primary, deps);
        state.data.runs[MAIN_RUN_ID] = launched.record;
        state.dirty = true;
        if (!launched.healthy) throw new CliError("run main did not become healthy");
        return formatDetails(launched.record, { dirty, status: "running" });
      }
      const resolved = await resolveRef(primary, parsed.ref, deps.execFile);
      if (parsed.mode === "reuse") return reuseRun(parsed, resolved, primary, root, auth, deps, state, lines, secrets);
      const runId = parsed.mode === "fresh" ? freshRunId(deps, state.data.runs) : defaultRunId(resolved.sha);
      const existing = state.data.runs[runId];
      if (existing && parsed.mode !== "fresh") {
        const problem = validateRecord(existing, root, primary);
        if (problem) throw new CliError(`run ${runId} is inconsistent (${problem})`);
        if (existing.resolvedSha !== resolved.sha) {
          throw new CliError(`run ${runId} was previously reused at ${existing.resolvedSha}; retarget it with --reuse ${runId}, or use --fresh`);
        }
        const status = await inspectRun(existing, deps);
        if (status !== "running" && status !== "unhealthy") {
          await assertReusableWorktree(primary, root, existing, deps);
          if (await needsInstall(primary, existing.worktree, existing.resolvedSha, resolved.sha, deps)) {
            await installDependencies(existing.worktree, deps, secrets, lines);
          }
          existing.requestedRef = resolved.requested;
        }
        return startRecorded(existing, primary, root, auth, deps, state, { lines });
      }
      return createManagedRun({ runId, resolved, primary, root, auth, deps, state, lines, secrets });
    }, deps);
  } catch (error) {
    throw rememberFailure(lines, error);
  }
}

async function createManagedRun({ runId, resolved, primary, root, auth, deps, state, lines, secrets }) {
  await assertTools(deps, START_TOOLS, primary);
  await ensureDatabaseReady(primary, auth, deps, secrets);
  const created = { dump: null, database: null, worktree: null, user: auth.user, auth };
  try {
    await createDatabaseCopy(root, runId, auth, deps, created);
    const worktree = worktreePathFor(root, runId);
    await addWorktree(primary, worktree, resolved.sha, deps);
    created.worktree = worktree;
    await installDependencies(worktree, deps, secrets, lines);
    const port = await allocatePort(state.data.runs, runId, null, deps);
    const launched = await launch({
      id: runId,
      kind: "managed",
      requestedRef: resolved.requested,
      resolvedSha: resolved.sha,
      worktree,
      databaseName: created.database,
      root,
      port,
      auth,
    }, primary, deps);
    state.data.runs[runId] = launched.record;
    state.dirty = true;
    if (!launched.healthy) throw new CliError(`run ${runId} did not become healthy`);
    return `${lines.length ? `${lines.join("\n")}\n` : ""}${formatDetails(launched.record, { status: "running" })}`;
  } catch (error) {
    if (!state.data.runs[runId]) {
      try {
        await rollbackCreated(primary, root, created, deps);
      } catch (rollbackError) {
        const original = error instanceof CliError ? error.message : "creation failed";
        const rollback = rollbackError instanceof CliError ? rollbackError.message : "rollback incomplete";
        throw new CliError(`${original}; ${rollback}`);
      }
    }
    throw error;
  }
}

async function reuseRun(parsed, resolved, primary, root, auth, deps, state, lines, secrets) {
  const runId = parseUserRunId(parsed.reuse);
  if (runId === MAIN_RUN_ID) throw new CliError("refusing to reuse main; a ref cannot use the main database");
  const run = state.data.runs[runId];
  if (!run) throw new CliError(`unknown run '${runId}'`);
  const problem = validateRecord(run, root, primary);
  if (problem) throw new CliError(`run ${runId} is inconsistent (${problem})`);
  const status = await inspectRun(run, deps);
  if (status === "running") throw new CliError(`run ${runId} is running; stop it before reuse`);
  if (status === "unhealthy") throw new CliError(`run ${runId} is unhealthy; stop it before reuse`);
  await assertReusableWorktree(primary, root, run, deps);
  const previousSha = run.resolvedSha;
  if (previousSha !== resolved.sha) {
    await runGit(deps.execFile, run.worktree, ["checkout", "--detach", resolved.sha]);
    const checkedOut = await headSha(deps.execFile, run.worktree);
    if (checkedOut !== resolved.sha) throw new CliError(`run ${runId} checkout did not reach ${resolved.sha}`);
  }
  const candidate = {
    ...run,
    requestedRef: resolved.requested,
    resolvedSha: resolved.sha,
  };
  try {
    if (await needsInstall(primary, run.worktree, previousSha, resolved.sha, deps)) {
      await installDependencies(run.worktree, deps, secrets, lines);
    }
    await assertReusableWorktree(primary, root, candidate, deps);
  } catch (error) {
    if (previousSha !== resolved.sha) {
      await runGit(deps.execFile, run.worktree, ["checkout", "--detach", previousSha]);
      const restored = await headSha(deps.execFile, run.worktree);
      if (restored !== previousSha) {
        const reason = error instanceof CliError ? error.message : "pre-spawn step failed";
        throw new CliError(`rollback incomplete: worktree ${run.worktree} is at ${restored}, not ${previousSha}; ${reason}`);
      }
    }
    throw error;
  }
  const extra = [];
  if (previousSha !== resolved.sha) {
    extra.push(`previous-sha: ${previousSha}`);
    extra.push(REUSE_SCHEMA_WARNING);
  }
  return startRecorded(candidate, primary, root, auth, deps, state, { lines, extra });
}

export async function stopCommand(runIdInput, context, deps) {
  const runId = parseUserRunId(runIdInput);
  const primary = context.primary;
  const root = managedRootFor(primary);
  if (runId !== MAIN_RUN_ID && !existsSync(join(root, "registry.json"))) throw new CliError(`unknown run '${runId}'`);
  return withRegistry(root, async (state) => {
    const run = state.data.runs[runId];
    if (!run && runId === MAIN_RUN_ID) return "run main is stopped\n";
    if (!run) throw new CliError(`unknown run '${runId}'`);
    const problem = validateRecord(run, root, primary);
    if (problem) throw new CliError(`run ${runId} is inconsistent (${problem})`);
    const status = await inspectRun(run, deps);
    if (status === "stopped") {
      if (run.pid) {
        run.pid = null;
        run.state = "stopped";
        run.updatedAt = deps.now();
        state.dirty = true;
      }
      return `run ${runId} is stopped\n`;
    }
    if (status === "stale") throw new CliError(`run ${runId} pid does not match the registered process; not signaling it`);
    const signaled = deps.signalProcess(run.pid, "SIGTERM");
    if (!signaled?.ok) throw new CliError(`failed to stop run ${runId}`);
    const deadline = Date.now() + timeoutsOf(deps).stopMs;
    let alive = true;
    while (Date.now() < deadline) {
      const described = await deps.describeProcess(run.pid);
      if (!described?.alive) {
        alive = false;
        break;
      }
      await deps.sleep(timeoutsOf(deps).pollMs);
    }
    if (alive) {
      const described = await deps.describeProcess(run.pid);
      alive = Boolean(described?.alive);
    }
    if (alive) throw new CliError(`run ${runId} did not exit after SIGTERM`);
    run.pid = null;
    run.state = "stopped";
    run.stoppedAt = deps.now();
    run.updatedAt = deps.now();
    state.dirty = true;
    return `run ${runId} is stopped\n`;
  }, deps);
}

export async function cleanCommand(runIdInput, context, deps) {
  const runId = parseUserRunId(runIdInput);
  if (runId === MAIN_RUN_ID) throw new CliError("refusing to clean main");
  const primary = context.primary;
  const root = managedRootFor(primary);
  if (!existsSync(join(root, "registry.json"))) throw new CliError(`unknown run '${runId}'`);
  return withRegistry(root, async (state) => {
    const run = state.data.runs[runId];
    if (!run) throw new CliError(`unknown run '${runId}'`);
    const problem = validateRecord(run, root, primary);
    if (problem) throw new CliError(`run ${runId} is inconsistent (${problem})`);
    const status = await inspectRun(run, deps);
    if (status === "running" || status === "unhealthy") {
      throw new CliError(`run ${runId} is ${status}; stop it before clean`);
    }
    assertManagedDatabaseName(run.databaseName);
    await assertTools(deps, ["git", "dropdb"], primary);
    const auth = loadAuth(primary, []);
    const lines = [
      `clean: removing worktree ${run.worktree}`,
      `clean: removing database ${run.databaseName}`,
    ];
    if (existsSync(run.worktree)) {
      await assertReusableWorktree(primary, root, run, deps);
      await removeManagedWorktree(primary, root, run.worktree, deps);
    }
    const dropped = await deps.execFile("dropdb", [
      "--host=127.0.0.1",
      "--port=5432",
      `--username=${auth.user}`,
      run.databaseName,
    ], { cwd: primary, env: pgEnv(deps.env, auth) });
    if (!dropped || dropped.code !== 0) {
      const worktreeState = existsSync(run.worktree)
        ? `worktree ${run.worktree} remains`
        : `worktree ${run.worktree} was removed`;
      throw new CliError(`database ${run.databaseName} remains; ${worktreeState}`);
    }
    const logPath = join(root, "logs", `${runId}.log`);
    if (existsSync(logPath)) rmSync(logPath, { force: true });
    delete state.data.runs[runId];
    state.dirty = true;
    lines.push(`deleted worktree ${run.worktree}`, `deleted database ${run.databaseName}`, `deleted run ${runId}`);
    return `${lines.join("\n")}\n`;
  }, deps);
}

function shortSha(sha) {
  return String(sha ?? "").slice(0, 12);
}

export async function listCommand(context, deps) {
  const primary = context.primary;
  const root = managedRootFor(primary);
  const registry = readRegistry(root);
  const sha = await headSha(deps.execFile, primary);
  const dirty = await isDirty(deps.execFile, primary);
  const blocks = [];
  const main = registry.runs[MAIN_RUN_ID];
  if (!main) {
    blocks.push(formatDetails({
      id: MAIN_RUN_ID,
      requestedRef: "master",
      resolvedSha: shortSha(sha),
      worktree: primary,
      databaseName: MAIN_DATABASE,
      port: MAIN_PORT,
    }, { dirty, status: "not-started" }));
  } else {
    const problem = validateRecord(main, root, primary);
    const status = problem ? "inconsistent" : await inspectRun(main, deps);
    blocks.push(formatDetails({ ...main, resolvedSha: shortSha(sha) }, { dirty, status }));
  }
  for (const run of Object.values(registry.runs)) {
    if (run.id === MAIN_RUN_ID) continue;
    const problem = validateRecord(run, root, primary);
    let status = "inconsistent";
    if (!problem) status = await inspectRun(run, deps);
    if (!problem && existsSync(run.worktree)) {
      const actual = await headSha(deps.execFile, run.worktree);
      if (actual !== run.resolvedSha) status = "inconsistent";
    }
    blocks.push(formatDetails({ ...run, resolvedSha: shortSha(run.resolvedSha) }, { status }));
  }
  return blocks.join("\n");
}

export async function dbListCommand(context, deps) {
  const primary = context.primary;
  const root = managedRootFor(primary);
  const registry = readRegistry(root);
  const sha = await headSha(deps.execFile, primary);
  const lines = [];
  const main = registry.runs[MAIN_RUN_ID];
  const mainStatus = main ? (validateRecord(main, root, primary) ? "inconsistent" : await inspectRun(main, deps)) : "not-started";
  lines.push([
    "database: comics",
    "run: main",
    "ref: master",
    `sha: ${shortSha(main?.resolvedSha || sha)}`,
    `status: ${mainStatus}`,
  ].join("\n"));
  for (const run of Object.values(registry.runs)) {
    if (run.id === MAIN_RUN_ID) continue;
    const problem = validateRecord(run, root, primary);
    const status = problem ? "inconsistent" : await inspectRun(run, deps);
    lines.push([
      `database: ${run.databaseName}`,
      `run: ${run.id}`,
      `ref: ${run.requestedRef}`,
      `sha: ${shortSha(run.resolvedSha)}`,
      `status: ${status}`,
    ].join("\n"));
  }
  return `${lines.join("\n\n")}\n`;
}

export async function dbShellCommand(runIdInput, context, deps, secrets) {
  const primary = context.primary;
  const root = managedRootFor(primary);
  const auth = loadAuth(primary, secrets);
  let database = MAIN_DATABASE;
  if (runIdInput) {
    const runId = parseUserRunId(runIdInput);
    const registry = readRegistry(root);
    if (runId === MAIN_RUN_ID) {
      if (registry.runs[MAIN_RUN_ID] && validateRecord(registry.runs[MAIN_RUN_ID], root, primary)) {
        throw new CliError("run main is inconsistent");
      }
      database = MAIN_DATABASE;
    } else {
      const run = registry.runs[runId];
      if (!run) throw new CliError(`unknown run '${runId}'`);
      if (validateRecord(run, root, primary)) throw new CliError(`run ${runId} is inconsistent`);
      database = run.databaseName;
      assertManagedDatabaseName(database);
    }
  }
  await assertTools(deps, ["psql"], primary);
  const args = ["-h", "127.0.0.1", "-p", "5432", "-U", auth.user, "-d", database];
  const env = pgEnv(deps.env, auth);
  return {
    stdout: `database: ${database}\n`,
    interactive: () => deps.interactivePsql(args, env),
  };
}
