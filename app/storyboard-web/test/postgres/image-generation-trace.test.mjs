import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import {
  createImageGenerationTraceRecorder,
  readImageGenerationAttempts,
} from "../../image-generation-trace.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026021";
const PROJECT_ID = "02100000-0000-4000-8000-000000000101";
const SENTINEL_PROJECT_ID = "02100000-0000-4000-8000-000000000102";
const GENERATION_ID = "02100000-0000-4000-8000-000000000111";
const CORRELATION_ID = "02100000-0000-4000-8000-000000000121";
const SENTINEL_TEXT = "021-sentinel-draft";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");

function runInspect(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("../../inspect-image-generation-attempt.mjs", import.meta.url)),
      ...args,
    ], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("image generation attempts persist in comics_test and inspect read-only", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 60000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const owned = [PROJECT_ID, SENTINEL_PROJECT_ID];
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, "comics_test");
    const columns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'image_generation_attempt'
      ORDER BY ordinal_position
    `);
    const names = columns.rows.map((row) => row.column_name);
    for (const required of [
      "id", "diagnostic_id", "project_id", "generation_kind", "action_kind",
      "panel_generation_id", "correlation_id", "compiler_id", "compiler_version", "build_id",
      "prompt", "prompt_sha256", "request_sha256", "sent_references", "omissions",
      "provider_io_started", "state", "output_sha256",
    ]) {
      assert.equal(names.includes(required), true, required);
    }
    for (const forbidden of ["bytes", "instruction", "description", "response_body", "data_url"]) {
      assert.equal(names.includes(forbidden), false, forbidden);
    }
    const foreignKeys = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'image_generation_attempt'::regclass AND contype = 'f'
    `);
    assert.equal(foreignKeys.rows.length, 1);
    assert.match(foreignKeys.rows[0].definition, /project/);
    assert.equal(foreignKeys.rows[0].definition.includes("research"), false);

    await pool.query("DELETE FROM image_generation_attempt WHERE project_id = ANY($1::uuid[])", [owned]);
    await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [owned]);
    await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [owned]);
    await pool.query("INSERT INTO project (id, title) VALUES ($1, '021 sentinel')", [SENTINEL_PROJECT_ID]);
    await pool.query(
      "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, $2, $3)",
      [SENTINEL_PROJECT_ID, SENTINEL_TEXT, randomUUID()],
    );
    await pool.query("INSERT INTO project (id, title) VALUES ($1, '021 trace fixture')", [PROJECT_ID]);
    await pool.query(
      "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, '021 fixture', $2)",
      [PROJECT_ID, randomUUID()],
    );

    const recorder = createImageGenerationTraceRecorder({
      query: (sql, params) => pool.query(sql, params),
      buildId: "build-021",
      logger: { log() {} },
    });
    const prompt = "synthetic panel prompt";
    const attemptId = await recorder.insertPrepared({
      traceContext: {
        diagnosticId: "checkpoint",
        projectId: PROJECT_ID,
        generationKind: "panel",
        actionKind: "panel",
        panelGenerationId: GENERATION_ID,
        storyboardVersionId: null,
        frameId: "frame-021",
        panelId: "panel-021",
        panelIndex: 0,
        correlationId: CORRELATION_ID,
        compilerId: "historical-panel-prompt",
        compilerVersion: "v1",
        upstreamOmissions: [],
      },
      prepared: {
        prompt,
        strategy: "passthrough",
        references: [{
          role: "anchor",
          assetId: "02100000-0000-4000-8000-000000000131",
          mime: "image/png",
          bytes: png,
          width: 1,
          height: 1,
        }],
        omittedRoles: [],
        originalBodyBytes: 120,
        finalBodyBytes: 120,
        requestSha256: "b".repeat(64),
      },
      originalReferences: [],
      aspectRatio: "4:5",
      model: "image-test",
      budgetBytes: 850000,
      timeoutMs: 1000,
    });
    assert.match(attemptId, /^[0-9a-f-]{36}$/i);
    const research = await pool.query(
      "SELECT count(*)::int AS count FROM research_event WHERE correlation_id = $1",
      [CORRELATION_ID],
    );
    assert.equal(research.rows[0].count, 0);
    const prepared = await pool.query(
      "SELECT state, provider_io_started, prompt FROM image_generation_attempt WHERE id = $1",
      [attemptId],
    );
    assert.equal(prepared.rows[0].state, "prepared");
    assert.equal(prepared.rows[0].provider_io_started, false);
    assert.equal(prepared.rows[0].prompt, prompt);

    const reader = await pool.connect();
    try {
      await reader.query("BEGIN READ ONLY");
      const visible = await readImageGenerationAttempts(reader, { attemptId });
      assert.equal(visible.length, 1);
      assert.equal(visible[0].state, "prepared");
      await assert.rejects(
        reader.query("INSERT INTO image_generation_attempt (id) VALUES ($1)", [randomUUID()]),
        (error) => error.code === "25006",
      );
      await reader.query("ROLLBACK");
    } finally {
      reader.release();
    }

    await recorder.updateTerminal({
      attemptId,
      result: {
        ok: true,
        image: { bytes: png, mime: "image/png", width: 1, height: 1 },
        metadata: {
          providerStatus: 200,
          latencyMs: 12,
          finishReason: "stop",
          usage: { prompt_tokens: 2, total_tokens: 2, secret: "super-secret-token" },
        },
      },
    });
    const stored = await pool.query("SELECT * FROM image_generation_attempt WHERE id = $1", [attemptId]);
    const rendered = JSON.stringify(stored.rows[0]);
    assert.equal(rendered.includes(png.toString("base64")), false);
    assert.equal(rendered.includes("super-secret-token"), false);
    assert.equal(stored.rows[0].state, "succeeded");
    assert.equal(stored.rows[0].provider_io_started, true);
    assert.equal(stored.rows[0].output_byte_length, png.length);
    assert.deepEqual(stored.rows[0].usage, { prompt_tokens: 2, total_tokens: 2 });

    for (const args of [
      ["--attempt", attemptId],
      ["--panel-generation", GENERATION_ID],
      ["--correlation", CORRELATION_ID],
    ]) {
      const inspected = await runInspect(args);
      assert.equal(inspected.status, 0, args[0]);
      assert.equal(inspected.stderr.includes(databaseUrl), false);
      const payload = JSON.parse(inspected.stdout);
      assert.equal(payload.attempts.length, 1);
      assert.equal(payload.attempts[0].attemptId, attemptId);
      assert.equal(payload.attempts[0].prompt, prompt);
      assert.equal(inspected.stdout.includes(png.toString("base64")), false);
      assert.equal(inspected.stdout.includes("data:image"), false);
    }

    const sentinel = await pool.query("SELECT text FROM working_draft WHERE project_id = $1", [SENTINEL_PROJECT_ID]);
    assert.equal(sentinel.rows[0].text, SENTINEL_TEXT);
  } finally {
    await pool.query("DELETE FROM image_generation_attempt WHERE project_id = ANY($1::uuid[])", [owned]).catch(() => {});
    await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [owned]).catch(() => {});
    await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [owned]).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
