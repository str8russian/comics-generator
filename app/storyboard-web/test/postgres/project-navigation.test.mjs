import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { migrate, sqlStatements } from "../../db/migrate.mjs";
import { createPool } from "../../db/pool.mjs";
import { createProject, listProjects, markOpened, renameProject } from "../../project-catalog.mjs";
import { enterProject, SEEDED_PROJECT_ID } from "../../project-scope.mjs";
import { loadProject, saveDraft } from "../../project-store.mjs";
import { createResearchStore } from "../../research-store.mjs";
import { readAsset } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const migrationsDir = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);
const sourceText = "Аня: привет";
const draftText = "Аня: сохранённый черновик";
const noteText = "заметка-013";

async function applyFile(client, name) {
  const sql = readFileSync(join(migrationsDir, name), "utf8");
  for (const statement of sqlStatements(sql)) {
    await client.query(statement);
  }
}

test("populated pre-013 state migrates once and a second project stays isolated", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const assetId = "13000000-0000-4000-8000-000000000010";
  const revisionId = "13000000-0000-4000-8000-000000000011";
  const readingId = "13000000-0000-4000-8000-000000000012";
  const interpretationId = "13000000-0000-4000-8000-000000000013";
  const materialId = "13000000-0000-4000-8000-000000000014";
  const resultId = "13000000-0000-4000-8000-000000000015";
  const versionId = "13000000-0000-4000-8000-000000000016";
  const anchorId = "13000000-0000-4000-8000-000000000017";
  const noteId = "13000000-0000-4000-8000-000000000018";
  const sha = createHash("sha256").update(png).digest("hex");
  let createdId = null;
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await client.query("DROP SCHEMA IF EXISTS feature_013_fixture CASCADE");
    await client.query("CREATE SCHEMA feature_013_fixture");
    await client.query("SET search_path TO feature_013_fixture");
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      if (name >= "011_") break;
      await applyFile(client, name);
    }
    await client.query("UPDATE working_draft SET text = $1 WHERE project_id = $2", [draftText, SEEDED_PROJECT_ID]);
    await client.query(
      "INSERT INTO source_revision (id, text) VALUES ($1, $2)",
      [revisionId, sourceText],
    );
    await client.query(
      `INSERT INTO reading (id, draft_text, draft_revision_token, status)
       VALUES ($1, $2, $3, 'ready')`,
      [readingId, draftText, "13000000-0000-4000-8000-000000000019"],
    );
    await client.query(
      "INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)",
      [interpretationId, revisionId, readingId],
    );
    await client.query(
      "INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)",
      [materialId, revisionId, interpretationId],
    );
    await client.query(
      `UPDATE project
       SET active_source_revision_id = $1, active_material_state_id = $2, current_reading_id = $3
       WHERE id = $4`,
      [revisionId, materialId, readingId, SEEDED_PROJECT_ID],
    );
    await client.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES ($1, $2, 'checked', $3::jsonb)`,
      [resultId, materialId, JSON.stringify({ frames: [{ id: "frame-1", durationFrames: 48, panels: [{ id: "panel-1" }] }] })],
    );
    await client.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, frames)
       VALUES ($1, $2, $3::jsonb)`,
      [versionId, resultId, JSON.stringify([{ id: "frame-1", durationFrames: 48, panels: [{ id: "panel-1" }] }])],
    );
    await client.query(
      "INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)",
      [resultId, versionId],
    );
    await client.query(
      `INSERT INTO visual_asset (id, kind, mime, width, height, byte_length, sha256, bytes)
       VALUES ($1, 'uploaded-image', 'image/png', 1, 1, $2, $3, $4)`,
      [assetId, png.length, sha, png],
    );
    await client.query(
      `INSERT INTO character_anchor_version (
         id, material_state_id, character_name, output_asset_id, status, provenance, approved_at
       ) VALUES ($1, $2, 'Аня', $3, 'approved', 'uploaded_as_ready_anchor', clock_timestamp())`,
      [anchorId, materialId, assetId],
    );
    await client.query(
      `INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
       VALUES ($1, 'Аня', $2)`,
      [materialId, anchorId],
    );
    await client.query(
      `INSERT INTO panel_visual_state (
         id, storyboard_version_id, frame_id, panel_index, panel_id,
         current_asset_id, current_asset_origin, zoom, position_x, position_y
       ) VALUES ($1, $2, 'frame-1', 0, 'panel-1', $3, 'upload', 1.250, 12.500, 30.000)`,
      [randomUUID(), versionId, assetId],
    );
    await client.query(
      `INSERT INTO research_event (id, event_kind, semantic_action, surface, submitted_text, context)
       VALUES ($1, 'note', 'note', 'dock_notes', $2, '{}'::jsonb)`,
      [noteId, noteText],
    );
    const before = {
      projects: Number((await client.query("SELECT count(*)::int AS count FROM project")).rows[0].count),
      revisions: Number((await client.query("SELECT count(*)::int AS count FROM source_revision")).rows[0].count),
      assets: Number((await client.query("SELECT count(*)::int AS count FROM visual_asset")).rows[0].count),
      anchors: Number((await client.query("SELECT count(*)::int AS count FROM character_anchor_version")).rows[0].count),
      notes: Number((await client.query("SELECT count(*)::int AS count FROM research_event")).rows[0].count),
    };

    await applyFile(client, "011_project_workspace.sql");

    const project = await client.query("SELECT id, title, last_opened_at FROM project");
    assert.equal(project.rows.length, 1);
    assert.equal(project.rows[0].id, SEEDED_PROJECT_ID);
    assert.equal(project.rows[0].title, "Текущий ролик");
    assert.equal(project.rows[0].last_opened_at, null);
    const draft = await client.query("SELECT text FROM working_draft WHERE project_id = $1", [SEEDED_PROJECT_ID]);
    assert.equal(draft.rows[0].text, draftText);
    const revision = await client.query("SELECT id, text, project_id FROM source_revision");
    assert.equal(revision.rows.length, before.revisions);
    assert.equal(revision.rows[0].id, revisionId);
    assert.equal(revision.rows[0].text, sourceText);
    assert.equal(revision.rows[0].project_id, SEEDED_PROJECT_ID);
    const asset = await client.query("SELECT project_id, sha256, bytes FROM visual_asset WHERE id = $1", [assetId]);
    assert.equal(asset.rows[0].project_id, SEEDED_PROJECT_ID);
    assert.equal(asset.rows[0].sha256, sha);
    assert.deepEqual(Buffer.from(asset.rows[0].bytes), png);
    const head = await client.query(
      "SELECT anchor_version_id FROM character_anchor_head WHERE material_state_id = $1",
      [materialId],
    );
    assert.equal(head.rows[0].anchor_version_id, anchorId);
    const provenance = await client.query("SELECT provenance FROM character_anchor_version WHERE id = $1", [anchorId]);
    assert.equal(provenance.rows[0].provenance, "uploaded_as_ready_anchor");
    const placement = await client.query(
      "SELECT position_x::text AS position_x, current_asset_id FROM panel_visual_state WHERE panel_id = 'panel-1'",
    );
    assert.equal(placement.rows[0].current_asset_id, assetId);
    assert.equal(Number(placement.rows[0].position_x), 12.5);
    const note = await client.query("SELECT submitted_text, project_id FROM research_event WHERE id = $1", [noteId]);
    assert.equal(note.rows[0].submitted_text, noteText);
    assert.equal(note.rows[0].project_id, SEEDED_PROJECT_ID);
    const frames = await client.query("SELECT frames FROM storyboard_version WHERE id = $1", [versionId]);
    assert.equal(frames.rows[0].frames[0].durationFrames, 48);
    assert.equal(Number((await client.query("SELECT count(*)::int AS count FROM project")).rows[0].count), before.projects);
    assert.equal(Number((await client.query("SELECT count(*)::int AS count FROM visual_asset")).rows[0].count), before.assets);
    assert.equal(Number((await client.query("SELECT count(*)::int AS count FROM character_anchor_version")).rows[0].count), before.anchors);
    assert.equal(Number((await client.query("SELECT count(*)::int AS count FROM research_event")).rows[0].count), before.notes);
    const headRow = await client.query(
      "SELECT active_storyboard_version_id FROM storyboard_head WHERE storyboard_result_id = $1",
      [resultId],
    );
    assert.equal(headRow.rows[0].active_storyboard_version_id, versionId);

    await client.query("SET search_path TO public");
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const fresh = await pool.query("SELECT count(*)::int AS count FROM project");
    assert.ok(fresh.rows[0].count >= 1);

    enterProject(SEEDED_PROJECT_ID);
    const original = await loadProject(pool);
    assert.equal(original.missing, undefined);
    const originalUpdated = original.updatedAt;
    const opened = await markOpened(pool, SEEDED_PROJECT_ID);
    assert.equal(opened.ok, true);
    assert.notEqual(opened.lastOpenedAt, null);
    assert.equal(opened.updatedAt, originalUpdated);

    const created = await createProject(pool);
    assert.equal(created.ok, true);
    assert.equal(created.project.title, "Новый проект");
    createdId = created.project.id;
    enterProject(createdId);
    const empty = await loadProject(pool);
    assert.equal(empty.draft.text, "");
    assert.equal(empty.sourceRevisions.length, 0);
    assert.equal(empty.material, null);
    const saved = await saveDraft(pool, { text: "Борис: новый", revisionToken: empty.draft.revisionToken });
    assert.equal(saved.ok, true);
    const renamed = await renameProject(pool, createdId, "Отдельный ролик");
    assert.equal(renamed.ok, true);
    const renamedProject = await loadProject(pool);
    assert.equal(renamedProject.title, "Отдельный ролик");
    assert.equal(renamedProject.draft.text, "Борис: новый");

    enterProject(SEEDED_PROJECT_ID);
    const still = await loadProject(pool);
    assert.equal(still.draft.text, original.draft.text);
    assert.equal(still.title, original.title);

    await pool.query(
      `INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes)
       VALUES ($1, $2, 'uploaded-image', 'image/png', 1, 1, $3, $4, $5)`,
      ["13000000-0000-4000-8000-000000000020", SEEDED_PROJECT_ID, png.length, sha, png],
    );
    enterProject(createdId);
    assert.equal(await readAsset(pool, "13000000-0000-4000-8000-000000000020"), null);
    enterProject(SEEDED_PROJECT_ID);
    const owned = await readAsset(pool, "13000000-0000-4000-8000-000000000020");
    assert.equal(owned?.id, "13000000-0000-4000-8000-000000000020");

    const research = createResearchStore(pool);
    const noted = await research.appendNote({
      projectId: SEEDED_PROJECT_ID,
      submittedText: "только-старый",
      context: {
        workflowPhase: "draft",
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
        panelId: null,
        transitionMode: null,
        transitionOverlapFrames: null,
      },
    });
    assert.equal(noted.ok, true);
    const hidden = await research.listTrace({ projectId: createdId, kind: "note" });
    assert.equal(hidden.events.some((event) => event.submittedText === "только-старый"), false);
    const visible = await research.listTrace({ projectId: SEEDED_PROJECT_ID, kind: "note" });
    assert.equal(visible.events.some((event) => event.submittedText === "только-старый"), true);

    const listed = await listProjects(pool);
    assert.equal(listed.projects.some((projectRow) => projectRow.id === createdId), true);
    assert.equal(listed.projects.find((projectRow) => projectRow.id === createdId).snippet, "Борис: новый");
    enterProject("00000000-0000-4000-8000-000000000055");
    assert.equal((await loadProject(pool)).missing, true);
  } finally {
    if (createdId) {
      await pool.query("DELETE FROM working_draft WHERE project_id = $1", [createdId]).catch(() => {});
      await pool.query("DELETE FROM project WHERE id = $1", [createdId]).catch(() => {});
    }
    await pool.query("DELETE FROM research_event WHERE id = $1 OR submitted_text = 'только-старый'", ["00000000-0000-4000-8000-000000000000"]).catch(() => {});
    await pool.query("DELETE FROM research_event WHERE submitted_text = 'только-старый'").catch(() => {});
    await pool.query("DELETE FROM visual_asset WHERE id = '13000000-0000-4000-8000-000000000020'").catch(() => {});
    await client.query("DROP SCHEMA IF EXISTS feature_013_fixture CASCADE").catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
    await client.end();
  }
});
