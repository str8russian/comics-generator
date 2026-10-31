import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { CliError } from "./errors.mjs";

function existingRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function normalizeCommon(base, text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new CliError("repository cannot be identified from the comics command");
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(base, trimmed);
  return existingRealpath(absolute);
}

export function parseWorktreeList(text) {
  const records = [];
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice("worktree ".length), branch: null, detached: false, head: null };
    } else if (!current) {
      continue;
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    } else if (line === "detached") {
      current.detached = true;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    }
  }
  if (current) records.push(current);
  return records;
}

async function git(execFile, cwd, args) {
  try {
    return await execFile("git", ["-C", cwd, ...args], { cwd });
  } catch {
    return { code: 1, stdout: "", stderr: "" };
  }
}

export async function discoverPrimary(packageRoot, execFile) {
  const top = await git(execFile, packageRoot, ["rev-parse", "--show-toplevel"]);
  if (!top || top.code !== 0 || !top.stdout.trim()) {
    throw new CliError("repository cannot be identified from the comics command");
  }
  const common = await git(execFile, packageRoot, ["rev-parse", "--git-common-dir"]);
  if (!common || common.code !== 0) throw new CliError("repository cannot be identified from the comics command");
  const commonDir = normalizeCommon(packageRoot, common.stdout);
  const listed = await git(execFile, packageRoot, ["worktree", "list", "--porcelain"]);
  if (!listed || listed.code !== 0) throw new CliError("repository cannot be identified from the comics command");
  const masters = parseWorktreeList(listed.stdout).filter((entry) => entry.branch === "refs/heads/master");
  if (masters.length !== 1) throw new CliError("expected exactly one local master worktree");
  const primary = existingRealpath(masters[0].path);
  const primaryCommon = await git(execFile, primary, ["rev-parse", "--git-common-dir"]);
  if (!primaryCommon || primaryCommon.code !== 0) throw new CliError("discovered checkout is not the same repository");
  if (normalizeCommon(primary, primaryCommon.stdout) !== commonDir) {
    throw new CliError("discovered checkout is not the same repository");
  }
  return { primary, packageRoot: existingRealpath(top.stdout.trim()), commonDir };
}
