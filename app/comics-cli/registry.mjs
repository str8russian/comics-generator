import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors.mjs";

const SECRET_KEY = /token|password|secret|databaseurl|authorization|prompt/i;

function assertNoSecretKeys(value) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEY.test(key)) throw new CliError("registry contains untrusted fields");
  }
}

export function registryPath(root) {
  return join(root, "registry.json");
}

export function readRegistry(root) {
  const path = registryPath(root);
  if (!existsSync(path)) return { version: 1, runs: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`malformed registry at ${path}`);
  }
  if (!parsed || parsed.version !== 1 || !parsed.runs || typeof parsed.runs !== "object" || Array.isArray(parsed.runs)) {
    throw new CliError(`malformed registry at ${path}`);
  }
  assertNoSecretKeys(parsed);
  for (const run of Object.values(parsed.runs)) {
    if (!run || typeof run !== "object" || Array.isArray(run)) throw new CliError(`malformed registry at ${path}`);
    assertNoSecretKeys(run);
  }
  return parsed;
}

export function writeRegistryAtomic(root, data, { crashBeforeRename = false } = {}) {
  if (!data || data.version !== 1 || !data.runs || typeof data.runs !== "object") {
    throw new CliError("refusing to write an untrusted registry");
  }
  mkdirSync(root, { recursive: true });
  const json = `${JSON.stringify(data, null, 2)}\n`;
  JSON.parse(json);
  const temporary = join(root, `.registry.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const fd = openSync(temporary, "w");
  try {
    writeSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (crashBeforeRename) throw new Error("crash before registry rename");
  renameSync(temporary, registryPath(root));
}

async function lockIsStale(lockPath, deps) {
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    const age = Date.now() - statSync(lockPath).mtimeMs;
    return age > 60000;
  }
  if (!Number.isInteger(parsed?.pid)) return true;
  const described = await deps.describeProcess(parsed.pid);
  return !described?.alive;
}

async function acquireLock(root, deps) {
  const lockPath = join(root, "registry.lock");
  const deadline = Date.now() + deps.timeouts.lockWaitMs;
  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: deps.now(), token: "comics-cli-registry" }));
      } finally {
        closeSync(fd);
      }
      return lockPath;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath, deps)) {
        try { unlinkSync(lockPath); } catch { /* another waiter removed it */ }
        continue;
      }
      if (Date.now() >= deadline) throw new CliError("another comics command holds the registry lock");
      await deps.sleep(deps.timeouts.pollMs);
    }
  }
}

function releaseLock(lockPath) {
  try { unlinkSync(lockPath); } catch { /* already released */ }
}

export async function withRegistry(root, fn, deps) {
  mkdirSync(root, { recursive: true });
  const lockPath = await acquireLock(root, deps);
  try {
    const state = { data: readRegistry(root), dirty: false };
    let failure = null;
    let result;
    try {
      result = await fn(state);
    } catch (error) {
      failure = error;
    }
    if (state.dirty) writeRegistryAtomic(root, state.data);
    if (failure) throw failure;
    return result;
  } finally {
    releaseLock(lockPath);
  }
}
