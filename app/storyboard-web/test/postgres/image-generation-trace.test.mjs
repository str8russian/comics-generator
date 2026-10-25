import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { generateImage } from "../../image-provider.mjs";
import {
  createImageGenerationTraceRecorder,
  readImageGenerationAttempts,
} from "../../image-generation-trace.mjs";
import { createServer } from "../../server.mjs";

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
      "character_name", "material_state_id", "anchor_version_id", "basis_kind",
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
    const ioColumn = await pool.query(`
      SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'image_generation_attempt' AND column_name = 'provider_io_started'
    `);
    assert.equal(ioColumn.rows[0].is_nullable, "YES");
    assert.equal(ioColumn.rows[0].column_default, null);
    const checks = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'image_generation_attempt'::regclass AND contype = 'c'
    `);
    const definitions = checks.rows.map((row) => row.definition).join("\n");
    assert.match(definitions, /anchor-session/);
    assert.match(definitions, /persisted/);
    assert.equal(definitions.includes("'video'"), false);

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
    assert.equal(prepared.rows[0].provider_io_started, null);
    assert.equal(prepared.rows[0].prompt, prompt);

    const reader = await pool.connect();
    try {
      await reader.query("BEGIN READ ONLY");
      const visible = await readImageGenerationAttempts(reader, { attemptId });
      assert.equal(visible.length, 1);
      assert.equal(visible[0].state, "prepared");
      assert.equal(visible[0].providerIoStarted, null);
      assert.equal(visible[0].providerHttpStatus, null);
      assert.equal(Object.hasOwn(visible[0], "httpStatus"), false);
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
    assert.equal(stored.rows[0].http_status, 200);
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
      assert.equal(payload.attempts[0].providerIoStarted, true);
      assert.equal(payload.attempts[0].providerHttpStatus, 200);
      assert.equal(Object.hasOwn(payload.attempts[0], "httpStatus"), false);
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

const ANCHOR_PROJECT_ID = "02100000-0000-4000-8000-000000000401";
const ANCHOR_SENTINEL_ID = "02100000-0000-4000-8000-000000000402";
const ANCHOR_MATERIAL_ID = "02100000-0000-4000-8000-000000000403";
const ANCHOR_VERSION_ID = "02100000-0000-4000-8000-000000000404";
const ANCHOR_CORRELATION_ID = "02100000-0000-4000-8000-000000000405";
const ANCHOR_SOURCE_ID = "02100000-0000-4000-8000-000000000406";
const FRESH_SCHEMA = "trace021_anchor_fresh";
const ANCHOR_LOCK = "90210002026022";

function freshDatabaseUrl(base) {
  const url = new URL(base);
  url.searchParams.set("options", `-csearch_path=${FRESH_SCHEMA}`);
  return url.toString();
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path,
      headers: { "content-type": "application/json", "content-length": bytes.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(bytes);
  });
}

test("anchor migrations converge and both routes persist inspectable rows", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 120000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const freshPool = createPool(freshDatabaseUrl(databaseUrl));
  const owned = [ANCHOR_PROJECT_ID, ANCHOR_SENTINEL_ID];
  let server;
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [ANCHOR_LOCK]);
    await pool.query(`DROP SCHEMA IF EXISTS ${FRESH_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${FRESH_SCHEMA}`);
    await migrate({ connectionString: freshDatabaseUrl(databaseUrl), logger: { log() {} } });
    const freshPath = await freshPool.query("SELECT current_setting('search_path') AS path, current_database() AS name");
    assert.equal(freshPath.rows[0].name, "comics_test");
    assert.equal(freshPath.rows[0].path, FRESH_SCHEMA);
    const freshMigrations = await freshPool.query("SELECT id FROM schema_migration ORDER BY id");
    const freshIds = freshMigrations.rows.map((row) => row.id);
    assert.equal(freshIds.includes("018_image_generation_attempt"), true);
    assert.equal(freshIds.includes("019_image_generation_attempt_observed_facts"), true);
    assert.equal(freshIds.includes("020_image_generation_attempt_anchor"), true);
    const freshColumns = await freshPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'image_generation_attempt'
    `, [FRESH_SCHEMA]);
    const freshNames = freshColumns.rows.map((row) => row.column_name);
    for (const name of ["character_name", "material_state_id", "anchor_version_id", "basis_kind"]) {
      assert.equal(freshNames.includes(name), true, name);
    }
    const freshRecorder = createImageGenerationTraceRecorder({
      query: (sql, params) => freshPool.query(sql, params),
      buildId: "build-021",
      logger: { log() {} },
    });
    const freshAttempt = await freshRecorder.insertPrepared({
      traceContext: {
        projectId: "00000000-0000-4000-8000-000000000001",
        generationKind: "anchor-session",
        actionKind: "anchor-session",
        basisKind: "from-source",
        characterName: "Аня",
        compilerId: "anchor-session-prompt",
        compilerVersion: "v1",
      },
      prepared: {
        prompt: "fresh anchor prompt",
        strategy: "passthrough",
        references: [],
        omittedRoles: [],
        originalBodyBytes: 10,
        finalBodyBytes: 10,
        requestSha256: "c".repeat(64),
      },
      originalReferences: [],
      aspectRatio: "4:5",
      model: "image-test",
      budgetBytes: 850000,
      timeoutMs: 1000,
    });
    assert.match(freshAttempt, /^[0-9a-f-]{36}$/i);
    await assert.rejects(
      freshPool.query(
        "UPDATE image_generation_attempt SET anchor_version_id = $2 WHERE id = $1",
        [freshAttempt, ANCHOR_VERSION_ID],
      ),
      (error) => error.code === "23514",
    );
    await migrate({ connectionString: freshDatabaseUrl(databaseUrl), logger: { log() {} } });
    const freshStill = await freshPool.query("SELECT count(*)::int AS count FROM schema_migration WHERE id = '020_image_generation_attempt_anchor'");
    assert.equal(freshStill.rows[0].count, 1);

    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const applied = await pool.query("SELECT 1 FROM schema_migration WHERE id = '020_image_generation_attempt_anchor'");
    assert.equal(applied.rowCount, 1);
    const located = await pool.query(`
      SELECT n.nspname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'image_generation_attempt'
      ORDER BY n.nspname
    `);
    const schemas = located.rows.map((row) => row.nspname);
    assert.equal(schemas.includes("public"), true);
    assert.equal(schemas.includes(FRESH_SCHEMA), true);

    await pool.query("DELETE FROM image_generation_attempt WHERE project_id = ANY($1::uuid[])", [owned]);
    await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [owned]);
    await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [owned]);
    await pool.query("INSERT INTO project (id, title) VALUES ($1, '021 anchor sentinel')", [ANCHOR_SENTINEL_ID]);
    await pool.query(
      "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, $2, $3)",
      [ANCHOR_SENTINEL_ID, SENTINEL_TEXT, randomUUID()],
    );
    await pool.query("INSERT INTO project (id, title) VALUES ($1, '021 anchor fixture')", [ANCHOR_PROJECT_ID]);
    const recorder = createImageGenerationTraceRecorder({
      query: (sql, params) => pool.query(sql, params),
      buildId: "build-021",
      logger: { log() {} },
    });
    const output = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const sourceUrl = `data:image/png;base64,${png.toString("base64")}`;
    const serverEnv = {
      BASE_URL: "http://127.0.0.1:9/v1",
      CONTEST_API_TOKEN: "test-token",
      IMAGE_MODEL: "image-test",
      IMAGE_TIMEOUT_MS: "1000",
      IMAGE_REFERENCE_STRATEGY: "passthrough",
    };
    server = createServer({
      migrate: false,
      projectStore: {},
      visualStore: {
        async readAnchorStyle() {
          return { id: ANCHOR_SOURCE_ID, mime: "image/png", bytes: png, width: 1, height: 1 };
        },
        async readActiveMaterialStateId() {
          return ANCHOR_MATERIAL_ID;
        },
        async readAsset() {
          return null;
        },
        async beginAnchor() {
          return {
            ok: true,
            id: ANCHOR_VERSION_ID,
            materialStateId: ANCHOR_MATERIAL_ID,
            characterName: "Аня",
            identityComment: "",
            instruction: "",
            identity: { id: ANCHOR_SOURCE_ID, mime: "image/png", bytes: png, width: 1, height: 1 },
            previous: null,
            style: null,
          };
        },
        async finishAnchor({ result }) {
          return result?.ok ? { ok: true } : { ok: false, kind: result?.kind || "provider", httpStatus: 502 };
        },
        async load() {
          return { ok: true, status: "ready", characters: [], frames: [] };
        },
      },
      env: serverEnv,
      logger: { log() {} },
      traceRecorder: recorder,
      imageGenerator: generateImage,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: {
            content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${output.toString("base64")}` } }],
          },
        }],
      }), { status: 200 }),
    });
    const port = await listen(server);
    const session = await post(port, `/api/projects/${ANCHOR_PROJECT_ID}/visual/characters/${encodeURIComponent("Аня")}/anchor-session`, {
      basis: "from-source",
      instruction: "",
      sourceImage: sourceUrl,
      correlationId: ANCHOR_CORRELATION_ID,
      projectId: "client-project",
      anchorVersionId: ANCHOR_VERSION_ID,
    });
    assert.equal(session.status, 200);
    const persisted = await post(port, `/api/projects/${ANCHOR_PROJECT_ID}/visual/characters/${encodeURIComponent("Аня")}/anchor`, {
      instruction: "",
      correlationId: ANCHOR_CORRELATION_ID,
      anchorVersionId: "02100000-0000-4000-8000-00000000eeee",
    });
    assert.equal(persisted.status, 200);
    const stored = await pool.query(`
      SELECT generation_kind, basis_kind, character_name, material_state_id, anchor_version_id,
             panel_generation_id, correlation_id, compiler_id
      FROM image_generation_attempt
      WHERE project_id = $1
      ORDER BY generation_kind
    `, [ANCHOR_PROJECT_ID]);
    assert.equal(stored.rowCount, 2);
    const byKind = new Map(stored.rows.map((row) => [row.generation_kind, row]));
    assert.equal(byKind.get("anchor").anchor_version_id, ANCHOR_VERSION_ID);
    assert.equal(byKind.get("anchor").basis_kind, "persisted");
    assert.equal(byKind.get("anchor").material_state_id, ANCHOR_MATERIAL_ID);
    assert.equal(byKind.get("anchor-session").anchor_version_id, null);
    assert.equal(byKind.get("anchor-session").basis_kind, "from-source");
    assert.equal(byKind.get("anchor-session").character_name, "Аня");
    assert.equal(byKind.get("anchor-session").panel_generation_id, null);
    assert.equal(byKind.get("anchor-session").correlation_id, ANCHOR_CORRELATION_ID);
    assert.equal(byKind.get("anchor-session").compiler_id, "anchor-session-prompt");
    const byVersion = await runInspect(["--anchor-version", ANCHOR_VERSION_ID]);
    assert.equal(byVersion.status, 0);
    const versionPayload = JSON.parse(byVersion.stdout);
    assert.equal(versionPayload.attempts.length, 1);
    assert.equal(versionPayload.attempts[0].anchorVersionId, ANCHOR_VERSION_ID);
    assert.equal(versionPayload.attempts[0].basisKind, "persisted");
    assert.equal(versionPayload.attempts[0].characterName, "Аня");
    assert.equal(byVersion.stdout.includes(png.toString("base64")), false);
    const byCorrelation = await runInspect(["--correlation", ANCHOR_CORRELATION_ID]);
    assert.equal(byCorrelation.status, 0);
    assert.equal(JSON.parse(byCorrelation.stdout).attempts.length, 2);
    const sentinel = await pool.query("SELECT text FROM working_draft WHERE project_id = $1", [ANCHOR_SENTINEL_ID]);
    assert.equal(sentinel.rows[0].text, SENTINEL_TEXT);
    const publicCount = await pool.query("SELECT count(*)::int AS count FROM project");
    assert.equal(publicCount.rows[0].count >= 1, true);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    await freshPool.end().catch(() => {});
    await pool.query(`DROP SCHEMA IF EXISTS ${FRESH_SCHEMA} CASCADE`).catch(() => {});
    await pool.query("DELETE FROM image_generation_attempt WHERE project_id = ANY($1::uuid[])", [owned]).catch(() => {});
    await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [owned]).catch(() => {});
    await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [owned]).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [ANCHOR_LOCK]).catch(() => {});
    guard.release();
    await freshPool.end().catch(() => {});
    await pool.end();
  }
});
