import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { dialogueRegionVisible, panelContentSize } from "../../../../prototypes/storyboard-viewer/frame-renderer.mjs";
import { enterProject, SEEDED_PROJECT_ID } from "../../project-scope.mjs";
import { expandStoryboardFrames } from "../../visual-model.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const OTHER_PROJECT_ID = "01500000-0000-4000-8000-000000000099";

const ids = {
  source: "01500000-0000-4000-8000-000000000001",
  reading: "01500000-0000-4000-8000-000000000002",
  interpretation: "01500000-0000-4000-8000-000000000003",
  material: "01500000-0000-4000-8000-000000000004",
  character: "01500000-0000-4000-8000-000000000005",
  result: "01500000-0000-4000-8000-000000000006",
  otherSource: "01500000-0000-4000-8000-000000000011",
  otherReading: "01500000-0000-4000-8000-000000000012",
  otherInterpretation: "01500000-0000-4000-8000-000000000013",
  otherMaterial: "01500000-0000-4000-8000-000000000014",
  otherResult: "01500000-0000-4000-8000-000000000015",
  otherVersion: "01500000-0000-4000-8000-000000000016",
};

function legacyFrames() {
  return [{
    id: "frame-said",
    layout: "split2",
    origin: "source",
    sourceRole: "utterance",
    sourceItemId: "item-said",
    dialogue: "Первый говорит",
    speakerPanel: 0,
    panels: [
      { id: "left", description: "Левая" },
      { id: "right", description: "Правая" },
    ],
  }, {
    id: "frame-act",
    layout: "single",
    origin: "source",
    sourceRole: "action",
    frameKind: "image",
    dialogue: "",
    panels: [{ id: "act", description: "Действие" }],
  }, {
    id: "frame-card",
    frameKind: "text",
    textCard: "Пауза",
    dialogue: "",
    layout: "single",
    panels: [],
  }, {
    id: "frame-beat",
    directingBeat: true,
    origin: "source",
    sourceRole: "utterance",
    sourceItemId: "item-beat",
    dialogue: "Раз.Два.",
    segments: [
      { quote: "Раз.", layout: "single", speakerPanel: 0, panels: [{ id: "beat-a", description: "А" }] },
      { quote: "Два.", layout: "single", speakerPanel: 0, panels: [{ id: "beat-b", description: "Б" }] },
    ],
  }];
}

function legacyRegion(frame) {
  if (frame?.frameKind === "text") return false;
  return typeof frame?.dialogue === "string" && frame.dialogue.trim().length > 0;
}

async function reset(pool) {
  await pool.query(`
    TRUNCATE visual_approval, panel_generation, panel_visual_state,
             project_style_seed, character_anchor_version, character_identity, visual_asset,
             storyboard_head, storyboard_version CASCADE
  `);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = NULL,
        active_material_state_id = NULL,
        current_reading_id = NULL
  `);
  await pool.query("DELETE FROM storyboard_result");
  await pool.query("DELETE FROM speaker_assignment");
  await pool.query("DELETE FROM alias");
  await pool.query("DELETE FROM canonical_character");
  await pool.query("UPDATE material_state SET parent_material_state_id = NULL");
  await pool.query("DELETE FROM material_state");
  await pool.query("DELETE FROM pending_speaker");
  await pool.query("DELETE FROM pending_alias");
  await pool.query("DELETE FROM pending_character");
  await pool.query("DELETE FROM surface_form");
  await pool.query("DELETE FROM provisional_character");
  await pool.query("DELETE FROM source_item");
  await pool.query("DELETE FROM interpretation");
  await pool.query("UPDATE source_revision SET parent_source_revision_id = NULL");
  await pool.query("DELETE FROM source_revision");
  await pool.query("DELETE FROM reading");
  await pool.query("DELETE FROM working_draft WHERE project_id = $1", [OTHER_PROJECT_ID]);
  await pool.query("DELETE FROM project WHERE id = $1", [OTHER_PROJECT_ID]);
}

async function counts(pool) {
  const tables = ["visual_asset", "panel_generation", "character_identity", "character_anchor_version", "source_item", "interpretation", "material_state"];
  const out = {};
  for (const table of tables) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    out[table] = result.rows[0].count;
  }
  return out;
}

test("legacy frames gain an explicit mode without changing geometry, and one project cannot edit another", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const draftToken = "01500000-0000-4000-8000-000000000020";
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await reset(pool);
    await pool.query(
      "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'неизменный источник')",
      [ids.source, SEEDED_PROJECT_ID],
    );
    await pool.query(`
      INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
      VALUES ($1, $2, 'неизменный источник', $3, 'ready')
    `, [ids.reading, SEEDED_PROJECT_ID, draftToken]);
    await pool.query(
      "INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)",
      [ids.interpretation, ids.source, ids.reading],
    );
    await pool.query(
      "INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)",
      [ids.material, ids.source, ids.interpretation],
    );
    await pool.query(
      "INSERT INTO canonical_character (id, material_state_id, ordinal, name) VALUES ($1, $2, 0, 'Персонаж')",
      [ids.character, ids.material],
    );
    await pool.query(`
      UPDATE project
      SET active_source_revision_id = $1, active_material_state_id = $2
      WHERE id = $3
    `, [ids.source, ids.material, SEEDED_PROJECT_ID]);
    await pool.query(
      "UPDATE working_draft SET text = 'неизменный черновик', revision_token = $2 WHERE project_id = $1",
      [SEEDED_PROJECT_ID, draftToken],
    );
    const frames = legacyFrames();
    await pool.query(`
      INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
      VALUES ($1, $2, 'checked', $3::jsonb)
    `, [ids.result, ids.material, JSON.stringify({ frames })]);

    const otherFrames = [{
      id: "other-frame",
      layout: "single",
      dialogue: "Чужая реплика",
      speakerPanel: 0,
      panels: [{ id: "other-panel", description: "Чужой" }],
    }];
    await pool.query("INSERT INTO project (id, title) VALUES ($1, 'Другой')", [OTHER_PROJECT_ID]);
    await pool.query(
      "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, 'чужой черновик', $2)",
      [OTHER_PROJECT_ID, randomUUID()],
    );
    await pool.query(
      "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'чужой источник')",
      [ids.otherSource, OTHER_PROJECT_ID],
    );
    await pool.query(`
      INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
      VALUES ($1, $2, 'чужой источник', $3, 'ready')
    `, [ids.otherReading, OTHER_PROJECT_ID, randomUUID()]);
    await pool.query(
      "INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)",
      [ids.otherInterpretation, ids.otherSource, ids.otherReading],
    );
    await pool.query(
      "INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)",
      [ids.otherMaterial, ids.otherSource, ids.otherInterpretation],
    );
    await pool.query(`
      UPDATE project SET active_source_revision_id = $1, active_material_state_id = $2 WHERE id = $3
    `, [ids.otherSource, ids.otherMaterial, OTHER_PROJECT_ID]);
    await pool.query(`
      INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
      VALUES ($1, $2, 'checked', $3::jsonb)
    `, [ids.otherResult, ids.otherMaterial, JSON.stringify({ frames: otherFrames })]);
    await pool.query(
      "INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)",
      [ids.otherVersion, ids.otherResult, JSON.stringify(otherFrames)],
    );
    await pool.query(
      "INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)",
      [ids.otherResult, ids.otherVersion],
    );

    const beforeCounts = await counts(pool);
    const store = createVisualStore(pool);
    const prior = expandStoryboardFrames(frames);
    const loaded = await store.load();
    assert.equal(loaded.ok, true);
    for (const frame of loaded.frames) {
      const earlier = prior.find((item) => item.id === frame.id);
      assert.ok(earlier, frame.id);
      assert.equal(dialogueRegionVisible(frame), legacyRegion(earlier));
      assert.equal(
        panelContentSize(frame.panels.length, dialogueRegionVisible(frame)).height,
        panelContentSize(earlier.panels.length, legacyRegion(earlier)).height,
      );
    }
    const stored = await pool.query("SELECT frames FROM storyboard_version WHERE storyboard_result_id = $1", [ids.result]);
    const persisted = stored.rows[0].frames;
    assert.equal(persisted.find((frame) => frame.id === "frame-said").dialogueMode, "spoken");
    assert.equal(persisted.find((frame) => frame.id === "frame-said").speakerPanel, 0);
    assert.equal(persisted.find((frame) => frame.id === "frame-said").dialogue, "Первый говорит");
    assert.equal(persisted.find((frame) => frame.id === "frame-act").dialogueMode, "hidden");
    assert.equal(Object.hasOwn(persisted.find((frame) => frame.id === "frame-card"), "dialogueMode"), false);
    const beat = persisted.find((frame) => frame.id === "frame-beat");
    assert.equal(Object.hasOwn(beat, "dialogueMode"), false);
    assert.equal(beat.segments[0].dialogueMode, "spoken");
    assert.equal(beat.segments[1].dialogueMode, "spoken");
    assert.equal(JSON.stringify(persisted).includes('"silent"'), false);
    const again = await store.load();
    const storedAgain = await pool.query(
      "SELECT frames FROM storyboard_version WHERE storyboard_result_id = $1",
      [ids.result],
    );
    assert.deepEqual(storedAgain.rows[0].frames, persisted);
    assert.equal(again.storyboardVersionId, loaded.storyboardVersionId);

    await pool.query(
      "INSERT INTO visual_approval (id, storyboard_version_id, snapshot) VALUES ($1, $2, $3::jsonb)",
      [randomUUID(), loaded.storyboardVersionId, JSON.stringify(loaded.frames.map((frame) => ({
        id: frame.id,
        panels: frame.panels.map((panel) => ({
          assetId: panel.assetId ?? null,
          zoom: panel.zoom,
          position: panel.position,
          mirrored: panel.mirrored === true,
        })),
      })))],
    );
    const approved = await store.load();
    assert.equal(approved.approved, true);

    const spoken = await store.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "frame-act",
      dialogueMode: "spoken",
      text: "Новая реплика",
    });
    assert.equal(spoken.ok, true);
    assert.equal(spoken.changed, true);
    assert.equal(spoken.invalidateRender, true);
    const silent = await store.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "frame-act",
      dialogueMode: "silent",
    });
    assert.equal(silent.changed, true);
    const restored = await store.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "frame-act",
      dialogueMode: "spoken",
    });
    assert.equal(restored.changed, true);
    const hidden = await store.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "frame-said",
      dialogueMode: "hidden",
    });
    assert.equal(hidden.changed, true);
    const same = await store.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "frame-said",
      dialogueMode: "hidden",
    });
    assert.equal(same.ok, true);
    assert.equal(same.changed, false);
    assert.equal(same.invalidateRender, false);
    assert.equal(same.storyboardVersionId, hidden.storyboardVersionId);

    const after = await store.load();
    assert.equal(after.approved, false);
    assert.notEqual(after.storyboardVersionId, loaded.storyboardVersionId);
    const said = after.frames.find((frame) => frame.id === "frame-said");
    assert.equal(said.dialogueMode, "hidden");
    assert.equal(said.dialogue, "Первый говорит");
    assert.equal(dialogueRegionVisible(said), false);
    assert.equal(said.panels.map((panel) => panel.id).join(","), "left,right");
    const created = after.frames.find((frame) => frame.id === "frame-act");
    assert.equal(created.dialogueMode, "spoken");
    assert.equal(created.dialogue, "Новая реплика");
    assert.equal(created.panels[0].id, "act");
    const quietHeight = panelContentSize(created.panels.length, true).height;
    const spokenHeight = panelContentSize(2, dialogueRegionVisible({
      dialogueMode: "spoken",
      dialogue: "Первый говорит",
      panels: said.panels,
    })).height;
    assert.equal(quietHeight, spokenHeight);

    const undone = await store.undoStoryboardEdit();
    assert.equal(undone.ok, true);
    assert.equal(undone.undoneLabel, "диалог кадра");
    const restoredLoad = await store.load();
    const restoredSaid = restoredLoad.frames.find((frame) => frame.id === "frame-said");
    assert.equal(restoredSaid.dialogueMode, "spoken");
    assert.equal(restoredSaid.speakerPanel, 0);
    assert.equal(restoredSaid.dialogue, "Первый говорит");
    assert.equal(dialogueRegionVisible(restoredSaid), true);

    const other = await pool.query("SELECT frames FROM storyboard_version WHERE id = $1", [ids.otherVersion]);
    assert.deepEqual(other.rows[0].frames, otherFrames);
    const draft = await pool.query(
      "SELECT text, revision_token FROM working_draft WHERE project_id = $1",
      [SEEDED_PROJECT_ID],
    );
    assert.equal(draft.rows[0].text, "неизменный черновик");
    assert.equal(draft.rows[0].revision_token, draftToken);
    const source = await pool.query("SELECT text FROM source_revision WHERE id = $1", [ids.source]);
    assert.equal(source.rows[0].text, "неизменный источник");
    assert.deepEqual(await counts(pool), beforeCounts);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
