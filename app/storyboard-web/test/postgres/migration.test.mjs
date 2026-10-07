import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { migrate } from "../../db/migrate.mjs";
import { startServer } from "../../server.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";

test("seeds one project and a failed migration does not listen", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const client = new pg.Client({ connectionString: databaseUrl });
  const tempDir = mkdtempSync(join(tmpdir(), "storyboard-migration-"));
  let connected = false;
  let server;
  try {
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await client.connect();
    connected = true;
    await client.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    const current = await client.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, "comics_test");
    const projects = await client.query("SELECT singleton FROM project");
    assert.equal(projects.rows.length, 1);
    assert.equal(projects.rows[0].singleton, true);
    const drafts = await client.query("SELECT text FROM working_draft");
    assert.equal(drafts.rows.length, 1);
    await assert.rejects(client.query(
      "INSERT INTO project (id, singleton) VALUES ('00000000-0000-4000-8000-000000000099', true)",
    ));
    const recount = await client.query("SELECT count(*)::int AS count FROM project");
    assert.equal(recount.rows[0].count, 1);

    const sqlMarker = "SENTINEL-SQL-NOT-A-LOG";
    writeFileSync(join(tempDir, "002_fail.sql"), [
      "CREATE TABLE migration_failure_probe (id integer PRIMARY KEY);",
      `INSERT INTO migration_failure_probe (id) VALUES ('${sqlMarker}');`,
      "",
    ].join("\n"));
    const lines = [];
    const logger = {
      log(line) {
        lines.push(String(line));
      },
    };
    await assert.rejects(startServer({
      port: 0,
      host: "127.0.0.1",
      logger,
      migrate: () => migrate({
        connectionString: databaseUrl,
        migrationsDir: tempDir,
        logger,
      }),
    }).then((listening) => {
      server = listening;
      return listening;
    }));
    assert.equal(server, undefined);
    const captured = lines.join("\n");
    assert.match(captured, /event=migration-failed\b/);
    assert.match(captured, /migration=002_fail\b/);
    assert.equal(captured.includes("listening"), false);
    assert.equal(captured.includes(databaseUrl), false);
    assert.equal(captured.includes(sqlMarker), false);
    assert.equal(/\b(SELECT|INSERT|CREATE|UPDATE|DELETE)\b/.test(captured), false);
    const probe = await client.query("SELECT to_regclass('migration_failure_probe') AS name");
    assert.equal(probe.rows[0].name, null);
    const still = await client.query("SELECT count(*)::int AS count FROM project");
    assert.equal(still.rows[0].count, 1);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(tempDir, { recursive: true, force: true });
    if (connected) {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
      await client.end();
    }
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
