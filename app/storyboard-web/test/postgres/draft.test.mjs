import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { loadProject, saveDraft } from "../../project-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";

test("draft saves are conditional and do not create a source revision", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
  try {
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, "comics_test");

    const initial = await loadProject(pool);
    const staleToken = initial.draft.revisionToken;
    const saved = await saveDraft(pool, { text: "более новый текст", revisionToken: staleToken });
    assert.equal(saved.httpStatus, 200);
    const rejected = await saveDraft(pool, { text: "устаревшая запись", revisionToken: staleToken });
    assert.equal(rejected.httpStatus, 409);
    assert.equal(rejected.kind, "stale-draft");
    assert.equal(Object.hasOwn(rejected, "text"), false);
    const afterStale = await loadProject(pool);
    assert.equal(afterStale.draft.text, "более новый текст");
    assert.equal(afterStale.draft.revisionToken, saved.revisionToken);

    const roundTrip = "Привет\nе\u0308\n🙂";
    const stored = await saveDraft(pool, {
      text: roundTrip,
      revisionToken: afterStale.draft.revisionToken,
    });
    assert.equal(stored.httpStatus, 200);
    const loaded = await loadProject(pool);
    assert.equal(loaded.draft.text, roundTrip);

    const beforeReject = await loadProject(pool);
    for (const text of ["a\u0000b", "a\uD800b"]) {
      const rejectedText = await saveDraft(pool, {
        text,
        revisionToken: beforeReject.draft.revisionToken,
      });
      assert.equal(rejectedText.httpStatus, 400);
      assert.equal(rejectedText.kind, "invalid-request");
      const unchanged = await loadProject(pool);
      assert.equal(unchanged.draft.text, beforeReject.draft.text);
      assert.equal(unchanged.draft.revisionToken, beforeReject.draft.revisionToken);
    }

    const revisions = await pool.query("SELECT count(*)::int AS count FROM source_revision");
    assert.equal(revisions.rows[0].count, 0);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
