import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.mjs";

const LOCK_KEY = "90210002026007";
const defaultMigrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));

export function sqlStatements(sql) {
  const statements = [];
  let current = "";
  let inString = false;
  let dollarTag = null;
  for (let index = 0; index < sql.length; index += 1) {
    if (!inString && !dollarTag && sql[index] === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
      current += sql[index];
      continue;
    }
    const char = sql[index];
    if (inString && char === "'" && sql[index + 1] === "'") {
      current += "''";
      index += 1;
      continue;
    }
    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }
    if (char === ";" && !inString) {
      pushStatement(statements, current);
      current = "";
      continue;
    }
    current += char;
  }
  pushStatement(statements, current);
  return statements;
}

function pushStatement(statements, raw) {
  const statement = raw.trim();
  if (!statement) return;
  const hasSql = statement.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("--");
  });
  if (hasSql) statements.push(statement);
}

function migrationId(fileName) {
  return fileName.slice(0, -".sql".length);
}

async function applyMigrations(client, migrationsDir, logger) {
  await client.query("SELECT pg_advisory_lock($1::bigint)", [LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await client.query("SELECT id FROM schema_migration");
    const applied = new Set(existing.rows.map((row) => row.id));
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of files) {
      const id = migrationId(name);
      if (applied.has(id)) continue;
      const sql = readFileSync(join(migrationsDir, name), "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of sqlStatements(sql)) {
          await client.query(statement);
        }
        await client.query("INSERT INTO schema_migration (id) VALUES ($1)", [id]);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK").catch(() => {});
        const safeId = /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
        logger.log(safeId
          ? `storyboard event=migration-failed migration=${safeId}`
          : "storyboard event=migration-failed");
        const failure = new Error("migration-failed");
        failure.code = "MIGRATION_FAILED";
        throw failure;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [LOCK_KEY]).catch(() => {});
  }
}

export async function migrate({
  connectionString,
  migrationsDir = defaultMigrationsDir,
  logger = console,
} = {}) {
  let pool;
  try {
    pool = createPool(connectionString);
    const client = await pool.connect();
    try {
      await applyMigrations(client, migrationsDir, logger);
    } finally {
      client.release();
    }
  } catch (error) {
    if (error?.code === "MIGRATION_FAILED") throw error;
    logger.log("storyboard event=database-unavailable");
    const failure = new Error("database-unavailable");
    failure.code = "DATABASE_UNAVAILABLE";
    throw failure;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}
