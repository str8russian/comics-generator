import { isAbsolute, relative, resolve, dirname, basename } from "node:path";
import { CliError } from "./errors.mjs";

export const MAIN_RUN_ID = "main";
export const MAIN_HOST = "127.0.0.1";
export const MAIN_PORT = 4173;
export const MAIN_DATABASE = "comics";
export const RESERVED_DATABASES = new Set(["comics", "comics_test"]);
export const MANAGED_DATABASE_PREFIX = "comics_cli_";
export const MANAGED_PORT_START = 4174;
export const MANAGED_PORT_END = 4273;
export const PROVIDER_MODE = "enabled (local configuration)";
export const REUSE_SCHEMA_WARNING = "warning: reused database keeps its schema; starting a different commit does not downgrade migrations";
export const SERVER_RELATIVE = "app/storyboard-web/server.mjs";
export const POSTGRES_HOST = "127.0.0.1";
export const POSTGRES_PORT = 5432;

export const DEFAULT_TIMEOUTS = {
  startupMs: 60000,
  stopMs: 8000,
  dbReadyMs: 30000,
  lockWaitMs: 15000,
  pollMs: 250,
};

export function managedRootFor(primaryCheckout) {
  const root = resolve(primaryCheckout);
  return resolve(dirname(root), `.${basename(root)}-runs`);
}

export function isManagedRunId(id) {
  return /^sha[0-9a-f]{40}$/.test(id) || /^f[0-9a-f]{16}$/.test(id);
}

export function defaultRunId(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new CliError("resolved ref is not a commit sha");
  return `sha${sha}`;
}

export function worktreePathFor(root, runId) {
  if (!isManagedRunId(runId)) throw new CliError("invalid run id");
  const path = resolve(root, "worktrees", runId);
  assertInside(resolve(root, "worktrees"), path);
  return path;
}

export function assertInside(parent, target) {
  const rel = relative(resolve(parent), resolve(target));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new CliError("path escapes the managed root");
  }
}
