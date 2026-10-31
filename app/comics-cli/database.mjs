import { CliError } from "./errors.mjs";
import { MAIN_DATABASE, MAIN_RUN_ID, MANAGED_DATABASE_PREFIX, RESERVED_DATABASES, isManagedRunId } from "./constants.mjs";

export function databaseNameForRun(runId) {
  if (runId === MAIN_RUN_ID) return MAIN_DATABASE;
  if (!isManagedRunId(runId)) throw new CliError("invalid run id");
  const name = `${MANAGED_DATABASE_PREFIX}${runId}`;
  assertManagedDatabaseName(name);
  return name;
}

export function assertManagedDatabaseName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 63 || !/^comics_cli_[a-z0-9]+$/.test(name)) {
    throw new CliError("refusing unmanaged database name");
  }
  if (RESERVED_DATABASES.has(name) || !name.startsWith(MANAGED_DATABASE_PREFIX)) {
    throw new CliError("refusing unmanaged database name");
  }
}

export function readComposeDatabase(composeText) {
  const lines = String(composeText ?? "").split(/\r?\n/);
  let inDb = false;
  let inEnv = false;
  const env = {};
  for (const line of lines) {
    if (/^  db:\s*$/.test(line)) {
      inDb = true;
      inEnv = false;
      continue;
    }
    if (inDb && /^  [a-zA-Z0-9_-]+:\s*$/.test(line)) break;
    if (!inDb) continue;
    if (/^    environment:\s*$/.test(line)) {
      inEnv = true;
      continue;
    }
    if (inEnv && /^    [a-zA-Z]/.test(line)) inEnv = false;
    if (!inEnv) continue;
    const match = line.match(/^      ([A-Z0-9_]+):\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  if (!env.POSTGRES_USER || !env.POSTGRES_PASSWORD || env.POSTGRES_DB !== MAIN_DATABASE) {
    throw new CliError("primary docker-compose.yml db service must define POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB=comics");
  }
  return { user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: MAIN_DATABASE };
}

export function databaseUrl({ user, password, database, host = "127.0.0.1", port = 5432 }) {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

export function pgEnv(baseEnv, auth) {
  const env = {
    ...baseEnv,
    PGPASSWORD: auth.password,
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
    PGUSER: auth.user,
  };
  delete env.PGDATABASE;
  delete env.DATABASE_URL;
  return env;
}
