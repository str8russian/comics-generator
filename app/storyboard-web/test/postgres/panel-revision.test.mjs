import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { generateImage } from "../../image-provider.mjs";
import { createImageGenerationTraceRecorder } from "../../image-generation-trace.mjs";
import { enterProject } from "../../project-scope.mjs";
import { createServer } from "../../server.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026023";
const FRESH_SCHEMA = "revision022_fresh";
const PROJECT_ID = "02200000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "02200000-0000-4000-8000-000000000002";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
const sha = createHash("sha256").update(png).digest("hex");

const ids = {
  revision: "02200000-0000-4000-8000-000000000011",
  reading: "02200000-0000-4000-8000-000000000012",
  interpretation: "02200000-0000-4000-8000-000000000013",
  material: "02200000-0000-4000-8000-000000000014",
  character: "02200000-0000-4000-8000-000000000015",
  result: "02200000-0000-4000-8000-000000000016",
  version: "02200000-0000-4000-8000-000000000017",
  state: "02200000-0000-4000-8000-000000000018",
  current: "02200000-0000-4000-8000-000000000021",
  anchorAsset: "02200000-0000-4000-8000-000000000022",
  styleAsset: "02200000-0000-4000-8000-000000000023",
  anchor: "02200000-0000-4000-8000-000000000024",
  generation: "02200000-0000-4000-8000-000000000025",
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function request(port, path, body = null, method = "POST") {
  return new Promise((resolve, reject) => {
    const bytes = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: bytes ? { "content-type": "application/json", "content-length": bytes.length } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.end(bytes ?? undefined);
  });
}

function freshDatabaseUrl(base) {
  const url = new URL(base);
  url.searchParams.set("options", `-csearch_path=${FRESH_SCHEMA}`);
  return url.toString();
}

function panelPath(suffix) {
  return `/api/projects/${PROJECT_ID}/visual/frames/frame-1/panels/0/${suffix}`;
}

async function insertAsset(client, id, kind, provenance = null) {
  await client.query(`
    INSERT INTO visual_asset (
      id, project_id, kind, mime, width, height, byte_length, sha256, bytes, provenance
    ) VALUES ($1, $2, $3, 'image/png', 1, 1, $4, $5, $6, $7::jsonb)
  `, [id, PROJECT_ID, kind, png.length, sha, png, provenance ? JSON.stringify(provenance) : null]);
}

async function seed(client) {
  const frames = [{
    id: "frame-1",
    layout: "single",
    origin: "source",
    dialogueMode: "silent",
    speakerPanel: null,
    dialogue: "",
    panels: [{
      id: "panel-022",
      description: "Маша, крупный план, спокойное выражение лица, взгляд вправо, сплошной матовый фон",
    }],
  }];
  await client.query("INSERT INTO project (id, title) VALUES ($1, '022 revision fixture')", [PROJECT_ID]);
  await client.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, '022 fixture', $2)",
    [PROJECT_ID, randomUUID()],
  );
  await client.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'Маша говорит.')",
    [ids.revision, PROJECT_ID],
  );
  await client.query(
    `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
     VALUES ($1, $2, 'Маша говорит.', $3, 'ready')`,
    [ids.reading, PROJECT_ID, randomUUID()],
  );
  await client.query(
    "INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)",
    [ids.interpretation, ids.revision, ids.reading],
  );
  await client.query(
    "INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)",
    [ids.material, ids.revision, ids.interpretation],
  );
  await client.query(
    `UPDATE project SET active_source_revision_id = $2, active_material_state_id = $3 WHERE id = $1`,
    [PROJECT_ID, ids.revision, ids.material],
  );
  await client.query(
    `INSERT INTO canonical_character (id, material_state_id, ordinal, name, included)
     VALUES ($1, $2, 0, 'Маша', true)`,
    [ids.character, ids.material],
  );
  await client.query(
    `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
     VALUES ($1, $2, 'checked', $3::jsonb)`,
    [ids.result, ids.material, JSON.stringify({ frames })],
  );
  await client.query(
    `INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)`,
    [ids.version, ids.result, JSON.stringify(frames)],
  );
  await client.query(
    "INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)",
    [ids.result, ids.version],
  );
  await insertAsset(client, ids.anchorAsset, "base-anchor");
  await insertAsset(client, ids.styleAsset, "base-anchor");
  await insertAsset(client, ids.current, "panel-image", {
    origin: "generation",
    subject: "Маша",
    intent: {
      framing: "close-up",
      upperBody: "visible shoulders and upper torso",
      gesture: "hands outside crop",
      headPose: "near-frontal head",
      gaze: "screen-right",
      expression: "calm",
      background: "solid-matte",
    },
  });
  await client.query(`
    INSERT INTO character_anchor_version (
      id, material_state_id, character_name, output_asset_id, status, provenance, approved_at
    ) VALUES ($1, $2, 'Маша', $3, 'approved', 'uploaded_as_ready_anchor', clock_timestamp())
  `, [ids.anchor, ids.material, ids.anchorAsset]);
  await client.query(
    `INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
     VALUES ($1, 'Маша', $2)`,
    [ids.material, ids.anchor],
  );
  await client.query(
    `INSERT INTO project_style_seed (material_state_id, style_asset_id, source_anchor_version_id)
     VALUES ($1, $2, $3)`,
    [ids.material, ids.styleAsset, ids.anchor],
  );
  await client.query(`
    INSERT INTO panel_visual_state (
      id, storyboard_version_id, frame_id, panel_index, panel_id, subject,
      current_asset_id, current_asset_origin, current_generation_id
    ) VALUES ($1, $2, 'frame-1', 0, 'panel-022', 'Маша', $3, 'generation', NULL)
  `, [ids.state, ids.version, ids.current]);
  await client.query(`
    INSERT INTO panel_generation (
      id, panel_visual_state_id, anchor_version_id, resolved_description, instruction, status, output_asset_id
    ) VALUES ($1, $2, $3, 'Маша', '', 'ready', $4)
  `, [ids.generation, ids.state, ids.anchor, ids.current]);
  await client.query(
    "UPDATE panel_visual_state SET current_generation_id = $2 WHERE id = $1",
    [ids.state, ids.generation],
  );
}

async function cleanup(pool) {
  const projects = [PROJECT_ID, OTHER_PROJECT_ID];
  await pool.query("DELETE FROM image_generation_attempt WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query("DELETE FROM research_event WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query(`
    UPDATE panel_revision_session
    SET selected_candidate_id = NULL, accepted_candidate_id = NULL
    WHERE project_id = ANY($1::uuid[])
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM panel_revision_candidate
    WHERE session_id IN (SELECT id FROM panel_revision_session WHERE project_id = ANY($1::uuid[]))
  `, [projects]).catch(() => {});
  await pool.query("DELETE FROM panel_revision_session WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query(`
    UPDATE panel_visual_state SET current_generation_id = NULL
    WHERE storyboard_version_id IN (
      SELECT storyboard_version.id
      FROM storyboard_version
      JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
      JOIN material_state ON material_state.id = storyboard_result.material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query("DELETE FROM panel_foreground_extraction WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM panel_generation
    WHERE panel_visual_state_id IN (
      SELECT panel_visual_state.id FROM panel_visual_state
      JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
      JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
      JOIN material_state ON material_state.id = storyboard_result.material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM panel_visual_state
    WHERE storyboard_version_id IN (
      SELECT storyboard_version.id
      FROM storyboard_version
      JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
      JOIN material_state ON material_state.id = storyboard_result.material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM visual_approval
    WHERE storyboard_version_id IN (
      SELECT storyboard_version.id FROM storyboard_version
      JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
      JOIN material_state ON material_state.id = storyboard_result.material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM storyboard_head
    WHERE storyboard_result_id IN (
      SELECT storyboard_result.id FROM storyboard_result
      JOIN material_state ON material_state.id = storyboard_result.material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM storyboard_version
    WHERE storyboard_result_id IN (
      SELECT storyboard_result.id FROM storyboard_result
      JOIN material_state ON material_state.id = storyboard_result.material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM storyboard_result
    WHERE material_state_id IN (
      SELECT material_state.id FROM material_state
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id = ANY($1::uuid[])
    )
  `, [projects]).catch(() => {});
  await pool.query("DELETE FROM project_style_seed WHERE material_state_id = $1", [ids.material]).catch(() => {});
  await pool.query("DELETE FROM character_anchor_head WHERE material_state_id = $1", [ids.material]).catch(() => {});
  await pool.query("DELETE FROM character_anchor_version WHERE material_state_id = $1", [ids.material]).catch(() => {});
  await pool.query("DELETE FROM canonical_character WHERE material_state_id = $1", [ids.material]).catch(() => {});
  await pool.query("DELETE FROM visual_asset WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM material_state
    WHERE source_revision_id IN (SELECT id FROM source_revision WHERE project_id = ANY($1::uuid[]))
  `, [projects]).catch(() => {});
  await pool.query(`
    DELETE FROM interpretation
    WHERE source_revision_id IN (SELECT id FROM source_revision WHERE project_id = ANY($1::uuid[]))
  `, [projects]).catch(() => {});
  await pool.query("DELETE FROM reading WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query("UPDATE project SET active_source_revision_id = NULL, active_material_state_id = NULL WHERE id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query("DELETE FROM source_revision WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [projects]).catch(() => {});
  await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [projects]).catch(() => {});
}

test("panel revision migration and lifecycle stay isolated from the accepted image", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 120000,
}, async () => {
  assert.equal(new URL(databaseUrl).pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const freshPool = createPool(freshDatabaseUrl(databaseUrl));
  const guard = await pool.connect();
  const fetches = [];
  let failProvider = false;
  let server;
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await pool.query(`DROP SCHEMA IF EXISTS ${FRESH_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${FRESH_SCHEMA}`);
    await migrate({ connectionString: freshDatabaseUrl(databaseUrl), logger: { log() {} } });
    const freshMigrations = await freshPool.query("SELECT id FROM schema_migration ORDER BY id");
    assert.equal(freshMigrations.rows.some((row) => row.id === "021_panel_revision_session"), true);
    const freshColumns = await freshPool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name IN ('panel_revision_session', 'panel_revision_candidate')
    `, [FRESH_SCHEMA]);
    const names = freshColumns.rows.map((row) => row.column_name);
    for (const required of ["review_outcome", "reviewed_at", "panel_generation_id", "effective_intent", "reference_identity"]) {
      assert.equal(names.includes(required), true, required);
    }
    for (const forbidden of ["prompt", "bytes", "instruction_prompt", "data_url"]) {
      assert.equal(names.includes(forbidden), false, forbidden);
    }
    assert.equal(freshColumns.rows.some((row) => row.data_type === "bytea"), false);

    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await cleanup(pool);
    await seed(guard);

    const store = createVisualStore(pool);
    const trace = createImageGenerationTraceRecorder({
      query: (sql, params) => pool.query(sql, params),
      buildId: "r2-test",
      logger: { log() {} },
    });
    const env = {
      BASE_URL: "http://127.0.0.1:9/v1",
      CONTEST_API_TOKEN: "comics-test-fake-token",
      IMAGE_MODEL: "fake-image",
      IMAGE_TIMEOUT_MS: "5000",
      IMAGE_REFERENCE_STRATEGY: "passthrough",
    };
    server = createServer({
      migrate: false,
      visualStore: store,
      projectStore: { async load() { return { ok: false }; } },
      researchStore: { async listTrace() { return { events: [] }; } },
      imageGenerator: generateImage,
      fetchImpl: async (_url, init) => {
        fetches.push(JSON.parse(init.body));
        if (failProvider) {
          return { status: 500, async text() { return JSON.stringify({ error: "forced" }); } };
        }
        return {
          status: 200,
          async text() {
            return JSON.stringify({
              choices: [{
                message: {
                  content: [
                    { type: "text", text: "ok" },
                    { type: "image_url", image_url: { url: dataUrl } },
                  ],
                },
              }],
            });
          },
        };
      },
      traceRecorder: trace,
      env,
      logger: { log() {} },
    });
    const port = await listen(server);
    const before = await pool.query(
      "SELECT active_storyboard_version_id FROM storyboard_head WHERE storyboard_result_id = $1",
      [ids.result],
    );
    const headBefore = before.rows[0].active_storyboard_version_id;
    const versionsBefore = Number((await pool.query(
      "SELECT count(*)::int AS count FROM storyboard_version WHERE storyboard_result_id = $1",
      [ids.result],
    )).rows[0].count);

    const blocked = await request(port, panelPath("revision-preview"), { mode: "refine", instruction: "   " });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.summary.blockReason, "empty-refine");
    assert.equal(blocked.body.summary.providerCall, false);
    const refused = await request(port, panelPath("revision-candidate"), { mode: "refine", instruction: "   " });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.kind, "empty-refine");
    assert.equal(fetches.length, 0);
    const mirror = await request(port, panelPath("revision-preview"), { mode: "refine", instruction: "отразить" });
    assert.equal(mirror.body.summary.providerCall, false);
    assert.equal(mirror.body.summary.deterministicControl, "mirror");
    assert.equal(fetches.length, 0);

    const opened = await request(port, panelPath("revision"), { mode: "refine", instruction: "раздражённое выражение" });
    assert.equal(opened.status, 200);
    const openedPanel = opened.body.frames[0].panels[0];
    assert.equal(openedPanel.assetId, ids.current);
    assert.equal(openedPanel.revision.summary.providerCall, true);
    assert.equal(openedPanel.revision.summary.changes.some((change) => change.property === "expression"), true);
    assert.equal(openedPanel.revision.summary.preserved.some((fact) => fact.property === "gaze" && fact.value === "screen-right"), true);
    assert.equal(fetches.length, 0);

    const first = await request(port, panelPath("revision-candidate"), { mode: "refine", instruction: "раздражённое выражение" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(fetches.length, 1);
    const afterFirst = first.body.frames[0].panels[0];
    assert.equal(afterFirst.assetId, ids.current);
    assert.equal(afterFirst.revision.candidates.length, 1);
    assert.equal(first.body.storyboardVersionId, headBefore);
    const candidateOne = afterFirst.revision.candidates[0];
    const attempt = await pool.query(
      "SELECT prompt, sent_references, compiler_id FROM image_generation_attempt WHERE panel_generation_id = $1",
      [candidateOne.panelGenerationId],
    );
    assert.equal(attempt.rows.length, 1);
    assert.equal(attempt.rows[0].compiler_id, "panel-revision-intent");
    assert.equal(attempt.rows[0].prompt.includes("раздражённое"), false);
    assert.equal(attempt.rows[0].prompt.includes("стул"), false);
    assert.match(attempt.rows[0].prompt, /irritated/);
    assert.match(attempt.rows[0].prompt, /screen-right/);
    const sentRoles = attempt.rows[0].sent_references.map((reference) => reference.role);
    assert.equal(sentRoles.includes("previous"), true);
    assert.equal(sentRoles.includes("anchor"), true);

    const reloadedStore = createVisualStore(pool);
    enterProject(PROJECT_ID);
    const reloaded = await reloadedStore.load();
    assert.equal(reloaded.frames[0].panels[0].assetId, ids.current);
    assert.equal(reloaded.frames[0].panels[0].revision.candidates.length, 1);

    const second = await request(port, panelPath("revision-candidate"), { mode: "refine", instruction: "смотрит влево" });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(fetches.length, 2);
    assert.equal(second.body.frames[0].panels[0].assetId, ids.current);
    assert.equal(second.body.frames[0].panels[0].revision.candidates.length, 2);
    const undo = await request(port, panelPath("revision-navigate"), { direction: "undo" });
    assert.equal(fetches.length, 2);
    assert.equal(undo.body.frames[0].panels[0].revision.selectedCandidateId, candidateOne.id);
    const branched = await request(port, panelPath("revision-candidate"), { mode: "refine", instruction: "глаза закрыты" });
    assert.equal(branched.status, 200, JSON.stringify(branched.body));
    assert.equal(fetches.length, 3);
    const branchedAttempt = await pool.query(
      `SELECT sent_references FROM image_generation_attempt
       WHERE panel_generation_id = $1`,
      [branched.body.frames[0].panels[0].revision.candidates.at(-1).panelGenerationId],
    );
    const previous = branchedAttempt.rows[0].sent_references.find((reference) => reference.role === "previous");
    assert.equal(previous.assetId, candidateOne.assetId);

    const variation = await request(port, panelPath("revision-candidate"), { mode: "new-variation", instruction: "" });
    assert.equal(variation.status, 200, JSON.stringify(variation.body));
    assert.equal(fetches.length, 4);
    const variationAttempt = await pool.query(
      "SELECT sent_references, prompt FROM image_generation_attempt WHERE panel_generation_id = $1",
      [variation.body.frames[0].panels[0].revision.candidates.at(-1).panelGenerationId],
    );
    assert.equal(variationAttempt.rows[0].sent_references.some((reference) => reference.role === "previous"), false);
    assert.equal(variation.body.frames[0].panels[0].assetId, ids.current);
    assert.equal(variation.body.frames[0].panels[0].revision.summary.basis.kind, "none");

    const reusableBeforeAccept = new Set(variation.body.reusableAssets.map((asset) => asset.id));
    for (const candidate of variation.body.frames[0].panels[0].revision.candidates) {
      assert.equal(reusableBeforeAccept.has(candidate.assetId), false);
    }

    await request(port, panelPath("revision-navigate"), { direction: "undo" });
    await request(port, panelPath("revision-navigate"), { direction: "undo" });
    await request(port, panelPath("revision-navigate"), { direction: "undo" });
    const selected = (await request(port, `/api/projects/${PROJECT_ID}/visual`, null, "GET")).body.frames[0].panels[0].revision;
    assert.equal(selected.selectedCandidateId, candidateOne.id);
    assert.equal(fetches.length, 4);
    const accepted = await request(port, panelPath("revision-accept"), { candidateId: candidateOne.id });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(fetches.length, 4);
    assert.equal(accepted.body.frames[0].panels[0].assetId, candidateOne.assetId);
    assert.equal(accepted.body.frames[0].panels[0].revision, null);
    assert.equal(accepted.body.canUndo, true);
    const versionsAfter = Number((await pool.query(
      "SELECT count(*)::int AS count FROM storyboard_version WHERE storyboard_result_id = $1",
      [ids.result],
    )).rows[0].count);
    assert.equal(versionsAfter, versionsBefore + 1);
    const outcome = await pool.query(
      "SELECT status, review_outcome, accepted_candidate_id, accepted_storyboard_version_id FROM panel_revision_session WHERE project_id = $1",
      [PROJECT_ID],
    );
    assert.equal(outcome.rows[0].status, "accepted");
    assert.equal(outcome.rows[0].review_outcome, "accepted");
    assert.equal(outcome.rows[0].accepted_candidate_id, candidateOne.id);
    assert.equal(outcome.rows[0].accepted_storyboard_version_id, accepted.body.storyboardVersionId);
    assert.equal(accepted.body.reusableAssets.some((asset) => asset.id === candidateOne.assetId), true);

    const inherited = await request(port, panelPath("revision-preview"), { mode: "refine", instruction: "смотрит влево" });
    assert.equal(inherited.body.summary.preserved.some((fact) => fact.property === "expression" && fact.value === "irritated"), true);
    assert.equal(inherited.body.summary.changes.some((change) => change.property === "gaze"), true);

    const again = await request(port, panelPath("revision"), { mode: "refine", instruction: "смотрит влево" });
    const generated = await request(port, panelPath("revision-candidate"), { mode: "refine", instruction: "смотрит влево" });
    assert.equal(generated.status, 200, JSON.stringify(generated.body));
    const callsAfterDraft = fetches.length;
    const snapshot = await pool.query(`
      SELECT panel_visual_state.current_asset_id, panel_visual_state.performance_asset_id,
             panel_visual_state.zoom, storyboard_head.active_storyboard_version_id
      FROM panel_visual_state
      JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
      JOIN storyboard_head ON storyboard_head.active_storyboard_version_id = storyboard_version.id
      WHERE storyboard_head.storyboard_result_id = $1 AND panel_visual_state.panel_id = 'panel-022'
    `, [ids.result]);
    const cancelled = await request(port, panelPath("revision-cancel"), {});
    assert.equal(cancelled.status, 200);
    assert.equal(fetches.length, callsAfterDraft);
    assert.equal(cancelled.body.frames[0].panels[0].revision, null);
    assert.equal(cancelled.body.frames[0].panels[0].assetId, snapshot.rows[0].current_asset_id);
    const afterCancel = await pool.query(`
      SELECT panel_visual_state.current_asset_id, panel_visual_state.performance_asset_id,
             panel_visual_state.zoom, storyboard_head.active_storyboard_version_id
      FROM panel_visual_state
      JOIN storyboard_version ON storyboard_version.id = panel_visual_state.storyboard_version_id
      JOIN storyboard_head ON storyboard_head.active_storyboard_version_id = storyboard_version.id
      WHERE storyboard_head.storyboard_result_id = $1 AND panel_visual_state.panel_id = 'panel-022'
    `, [ids.result]);
    assert.deepEqual(afterCancel.rows[0], snapshot.rows[0]);
    const cancelOutcome = await pool.query(
      "SELECT status, review_outcome FROM panel_revision_session WHERE project_id = $1 AND status = 'cancelled'",
      [PROJECT_ID],
    );
    assert.equal(cancelOutcome.rows.length >= 1, true);
    assert.equal(cancelOutcome.rows.at(-1).review_outcome, "cancelled");
    assert.equal(again.status, 200);

    failProvider = true;
    const failedProvider = await request(port, panelPath("revision-candidate"), { mode: "new-variation", instruction: "" });
    failProvider = false;
    assert.notEqual(failedProvider.status, 200);
    const afterFailure = await request(port, `/api/projects/${PROJECT_ID}/visual`, null, "GET");
    assert.equal(afterFailure.body.frames[0].panels[0].assetId, snapshot.rows[0].current_asset_id);
    assert.equal(afterFailure.body.frames[0].panels[0].revision?.candidates?.length || 0, 0);
    assert.equal(fetches.length, callsAfterDraft + 1);

    enterProject(OTHER_PROJECT_ID);
    const foreign = await reloadedStore.previewPanelRevision({
      frameId: "frame-1",
      panelIndex: 0,
      mode: "refine",
      instruction: "смотрит влево",
    });
    assert.equal(foreign.ok, false);
    enterProject(PROJECT_ID);
  } finally {
    if (server) await close(server).catch(() => {});
    await cleanup(pool);
    await pool.query(`DROP SCHEMA IF EXISTS ${FRESH_SCHEMA} CASCADE`).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await freshPool.end();
    await pool.end();
  }
});

test("revision failures leave the accepted panel image unchanged", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 120000,
}, async () => {
  assert.equal(new URL(databaseUrl).pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await cleanup(pool);
    await seed(guard);
    enterProject(PROJECT_ID);
    const store = createVisualStore(pool);
    const opened = await store.openPanelRevision({
      frameId: "frame-1",
      panelIndex: 0,
      mode: "refine",
      instruction: "раздражённое выражение",
    });
    assert.equal(opened.ok, true, opened.kind);
    const pending = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "раздражённое выражение",
      revisionBasis: { assetId: ids.current },
    });
    assert.equal(pending.ok, true, pending.kind);
    const image = { ok: true, image: { bytes: png, mime: "image/png" }, metadata: {} };
    const revision = {
      sessionId: opened.sessionId,
      mode: "refine",
      basisKind: "current-panel",
      basisAssetId: ids.current,
      basisOrdinal: null,
      effectiveIntent: {
        compilerVersion: "panel-revision-intent/v1",
        characterName: "Маша",
        expression: "irritated",
        gaze: "screen-right",
        framing: "close-up",
        background: "solid-matte",
        reconstruction: "known-supported",
      },
      referenceIdentity: { identityAssetId: ids.anchorAsset, previousAssetId: ids.current },
      instruction: "раздражённое выражение",
    };
    const stored = await store.finishPanelGeneration({
      id: pending.id,
      result: image,
      provenance: { origin: "generation", subject: "Маша", effectiveIntent: revision.effectiveIntent },
      revision,
      runExtraction: async () => { throw new Error("foreground-failed"); },
    });
    assert.equal(stored.ok, true, stored.kind);
    const current = await pool.query(
      "SELECT current_asset_id FROM panel_visual_state WHERE id = $1",
      [ids.state],
    );
    assert.equal(current.rows[0].current_asset_id, ids.current);

    function failingPool(fragment) {
      return {
        async connect() {
          const client = await pool.connect();
          return {
            async query(sql, params) {
              if (typeof sql === "string" && sql.includes(fragment)) throw new Error("forced");
              return client.query(sql, params);
            },
            async release() {
              await client.query("ROLLBACK").catch(() => {});
              client.release();
            },
          };
        },
      };
    }
    const beforeAccept = await store.load();
    const acceptStore = createVisualStore(failingPool("UPDATE storyboard_head"));
    const acceptFailed = await acceptStore.acceptPanelRevision({ frameId: "frame-1", panelIndex: 0 });
    assert.equal(acceptFailed.ok, false);
    const afterAccept = await store.load();
    assert.equal(afterAccept.frames[0].panels[0].assetId, ids.current);
    assert.equal(afterAccept.frames[0].panels[0].revision.status || afterAccept.frames[0].panels[0].revision.id, beforeAccept.frames[0].panels[0].revision.id);

    const cancelStore = createVisualStore(failingPool("review_outcome"));
    const cancelFailed = await cancelStore.cancelPanelRevision({ frameId: "frame-1", panelIndex: 0 });
    assert.equal(cancelFailed.ok, false);
    const stillOpen = await pool.query(
      "SELECT status FROM panel_revision_session WHERE id = $1",
      [opened.sessionId],
    );
    assert.equal(stillOpen.rows[0].status, "open");

    const another = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "смотрит влево",
      revisionBasis: { assetId: ids.current },
    });
    const broken = createVisualStore(failingPool("INSERT INTO panel_revision_candidate"));
    const storageFailed = await broken.finishPanelGeneration({
      id: another.id,
      result: image,
      provenance: { origin: "generation", subject: "Маша" },
      revision,
    });
    assert.equal(storageFailed.ok, false);
    const count = await pool.query(
      "SELECT count(*)::int AS count FROM panel_revision_candidate WHERE session_id = $1",
      [opened.sessionId],
    );
    assert.equal(count.rows[0].count, 1);
    const assetNow = await pool.query("SELECT current_asset_id FROM panel_visual_state WHERE id = $1", [ids.state]);
    assert.equal(assetNow.rows[0].current_asset_id, ids.current);

    const traceCalls = [];
    const traceServer = createServer({
      migrate: false,
      visualStore: store,
      projectStore: { async load() { return { ok: false }; } },
      researchStore: { async listTrace() { return { events: [] }; } },
      imageGenerator: generateImage,
      fetchImpl: async () => {
        traceCalls.push(1);
        return {
          status: 200,
          async text() {
            return JSON.stringify({
              choices: [{ message: { content: [{ type: "image_url", image_url: { url: dataUrl } }] } }],
            });
          },
        };
      },
      traceRecorder: {
        async insertPrepared() { throw new Error("trace"); },
        async updateTerminal() { throw new Error("trace"); },
      },
      env: {
        BASE_URL: "http://127.0.0.1:9/v1",
        CONTEST_API_TOKEN: "comics-test-fake-token",
        IMAGE_MODEL: "fake-image",
        IMAGE_TIMEOUT_MS: "5000",
        IMAGE_REFERENCE_STRATEGY: "passthrough",
      },
      logger: { log() {} },
    });
    const port = await listen(traceServer);
    try {
      const traced = await request(port, panelPath("revision-candidate"), { mode: "refine", instruction: "смотрит влево" });
      assert.equal(traced.status, 200, JSON.stringify(traced.body));
      assert.equal(traceCalls.length, 1);
      assert.equal(traced.body.frames[0].panels[0].assetId, ids.current);
      assert.equal(traced.body.frames[0].panels[0].revision.candidates.length, 2);
    } finally {
      await close(traceServer);
    }
  } finally {
    await cleanup(pool);
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
