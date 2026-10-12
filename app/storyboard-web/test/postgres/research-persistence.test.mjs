import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026009";

function nullContext(overrides = {}) {
  return {
    workflowPhase: null,
    storyboardVersionId: null,
    displayFrameNumber: null,
    displayFrameId: null,
    structureFrameId: null,
    structureSegmentIndex: null,
    panelIndex: null,
    panelSubject: null,
    imageAssetId: null,
    generationId: null,
    characterName: null,
    anchorVersionId: null,
    ...overrides,
  };
}

async function resetResearch(pool) {
  await pool.query("TRUNCATE research_event RESTART IDENTITY");
}

test("research_event migration, restart durability, uniqueness, and long reading text", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const { createResearchStore } = await import("../../research-store.mjs");
  const lockPool = createPool(databaseUrl);
  const guard = await lockPool.connect();
  let poolA;
  let poolB;
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });

    poolA = createPool(databaseUrl);
    const applied = await poolA.query(
      "SELECT id FROM schema_migration WHERE id = $1",
      ["005_research_workspace_dock"],
    );
    assert.equal(applied.rows.length, 1);

    await resetResearch(poolA);

    const storeA = createResearchStore(poolA);
    const note = await storeA.appendNote({
      submittedText: "durable-note",
      context: nullContext({ workflowPhase: "structure" }),
    });
    assert.equal(note.ok, true);

    const correlationId = randomUUID();
    const longText = "Д".repeat(9000);
    const start = await storeA.appendEvent({
      eventKind: "action_start",
      semanticAction: "reading",
      correlationId,
      surface: "product_control",
      submittedText: longText,
      commandTarget: null,
      editTarget: null,
      context: nullContext({ workflowPhase: "draft" }),
    });
    assert.equal(start.ok, true);
    assert.equal(start.event.submittedText.length, 9000);

    const terminal = await storeA.appendEvent({
      eventKind: "action_terminal",
      correlationId,
      outcome: "success",
      outcomeFlags: {},
    });
    assert.equal(terminal.ok, true);
    assert.equal(typeof terminal.event.durationMs, "number");
    const fromReturnedTimestamps = Math.max(
      0,
      Date.parse(terminal.event.occurredAt) - Date.parse(start.event.occurredAt),
    );
    assert.equal(terminal.event.durationMs, fromReturnedTimestamps);
    const fromPersisted = await poolA.query(`
      SELECT GREATEST(
        0,
        (
          (EXTRACT(EPOCH FROM date_trunc('milliseconds', term.occurred_at)) * 1000)::bigint
          - (EXTRACT(EPOCH FROM date_trunc('milliseconds', start_row.occurred_at)) * 1000)::bigint
        )
      )::int AS ms
      FROM research_event AS term
      JOIN research_event AS start_row
        ON start_row.correlation_id = term.correlation_id
       AND start_row.event_kind = 'action_start'
      WHERE term.correlation_id = $1::uuid
        AND term.event_kind = 'action_terminal'
    `, [correlationId]);
    assert.equal(terminal.event.durationMs, fromPersisted.rows[0].ms);

    // Simulate app restart with a fresh pool (lock held on a separate pool).
    await poolA.end();
    poolA = null;
    poolB = createPool(databaseUrl);
    const storeB = createResearchStore(poolB);
    const listed = await storeB.listTrace();
    assert.equal(listed.ok, true);
    assert.equal(listed.events.length, 3);
    assert.deepEqual(
      listed.events.map((event) => event.eventKind),
      ["note", "action_start", "action_terminal"],
    );
    assert.equal(listed.events[0].submittedText, "durable-note");
    assert.equal(listed.events[1].submittedText, longText);
    assert.equal(listed.events[1].submittedText.length, 9000);

    const dupStart = await storeB.appendEvent({
      eventKind: "action_start",
      semanticAction: "reading",
      correlationId,
      surface: "product_control",
      submittedText: "dup",
      commandTarget: null,
      editTarget: null,
      context: nullContext({ workflowPhase: "draft" }),
    });
    assert.equal(dupStart.ok, false);
    assert.equal(dupStart.kind, "invalid-request");

    const dupTerminal = await storeB.appendEvent({
      eventKind: "action_terminal",
      correlationId,
      outcome: "failure",
      outcomeFlags: {},
    });
    assert.equal(dupTerminal.ok, false);
    assert.equal(dupTerminal.kind, "invalid-request");

    const indexes = await poolB.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'research_event'
      ORDER BY indexname
    `);
    const defs = indexes.rows.map((row) => row.indexdef).join("\n");
    assert.match(defs, /UNIQUE.*correlation_id.*action_start/i);
    assert.match(defs, /UNIQUE.*correlation_id.*action_terminal/i);
  } finally {
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    if (poolA) await poolA.end().catch(() => {});
    if (poolB) await poolB.end().catch(() => {});
    await lockPool.end().catch(() => {});
  }
});
