import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { enterProject, SEEDED_PROJECT_ID } from "../../project-scope.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);
const redDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ids = {
  source: "20000000-0000-4000-8000-000000000001",
  reading: "20000000-0000-4000-8000-000000000002",
  interpretation: "20000000-0000-4000-8000-000000000003",
  material: "20000000-0000-4000-8000-000000000004",
  character: "20000000-0000-4000-8000-000000000005",
  result: "20000000-0000-4000-8000-000000000006",
};

function imageFrame(description = "Дуров смотрит спокойно") {
  return [{
    id: "frame-1",
    layout: "single",
    origin: "derived",
    frameKind: "image",
    dialogue: "",
    panels: [{ id: "panel-source", description, manualSubject: "Дуров" }],
  }];
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
}

async function seed(pool) {
  await pool.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'test')",
    [ids.source, SEEDED_PROJECT_ID],
  );
  await pool.query(`
    INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
    VALUES ($1, $2, 'test', '20000000-0000-4000-8000-000000000008', 'ready')
  `, [ids.reading, SEEDED_PROJECT_ID]);
  await pool.query(`
    INSERT INTO interpretation (id, source_revision_id, reading_id)
    VALUES ($1, $2, $3)
  `, [ids.interpretation, ids.source, ids.reading]);
  await pool.query(`
    INSERT INTO material_state (id, source_revision_id, interpretation_id)
    VALUES ($1, $2, $3)
  `, [ids.material, ids.source, ids.interpretation]);
  await pool.query(`
    INSERT INTO canonical_character (id, material_state_id, ordinal, name)
    VALUES ($1, $2, 0, 'Дуров')
  `, [ids.character, ids.material]);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = $1, active_material_state_id = $2
    WHERE id = $3
  `, [ids.source, ids.material, SEEDED_PROJECT_ID]);
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
    VALUES ($1, $2, 'checked', $3::jsonb, '2026-10-14T12:00:00Z')
  `, [ids.result, ids.material, JSON.stringify({ frames: imageFrame() })]);
}

async function withStore(run) {
  enterProject(SEEDED_PROJECT_ID);
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await reset(pool);
    await seed(pool);
    await run(createVisualStore(pool), pool);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
}

async function versionCount(pool) {
  const result = await pool.query("SELECT count(*)::int AS count FROM storyboard_version");
  return result.rows[0].count;
}

async function headId(pool) {
  const result = await pool.query("SELECT active_storyboard_version_id FROM storyboard_head");
  return result.rows[0].active_storyboard_version_id;
}

async function approveDurov(store) {
  const identity = await store.saveIdentity({
    characterName: "Дуров",
    image: { bytes: png },
    comment: "лицо",
  });
  assert.equal(identity.ok, true);
  const pending = await store.beginAnchor({ characterName: "Дуров", instruction: "графика" });
  assert.equal(pending.ok, true);
  const finished = await store.finishAnchor({
    id: pending.id,
    result: { ok: true, image: { bytes: png }, metadata: { test: true } },
  });
  assert.equal(finished.ok, true);
  const approved = await store.approveAnchor({ characterName: "Дуров", anchorId: pending.id });
  assert.equal(approved.ok, true);
}

test("no-op mutations do not create a storyboard version", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  await withStore(async (store, pool) => {
    await store.load();
    const duration = await store.applyOperation({
      op: "setDuration",
      structureFrameId: "frame-1",
      durationFrames: 48,
    });
    assert.equal(duration.changed, true);
    const versions = await versionCount(pool);
    const head = await headId(pool);
    const again = await store.applyOperation({
      op: "setDuration",
      structureFrameId: "frame-1",
      durationFrames: 48,
    });
    assert.equal(again.changed, false);
    assert.equal(await versionCount(pool), versions);
    assert.equal(await headId(pool), head);
    const sameOrder = await store.applyOperation({
      op: "reorderFrames",
      structureFrameIds: ["frame-1"],
    });
    assert.equal(sameOrder.changed, false);
    assert.equal(await versionCount(pool), versions);
    const sameSubject = await store.applyOperation({
      op: "setManualSubject",
      panelId: "panel-source",
      characterName: "Дуров",
    });
    assert.equal(sameSubject.changed, false);
    assert.equal(await versionCount(pool), versions);
    const unknown = await store.applyOperation({
      op: "setManualSubject",
      panelId: "panel-source",
      characterName: "Неизвестный",
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.kind, "unknown-subject");
    assert.equal(await versionCount(pool), versions);
    assert.equal(await headId(pool), head);
  });
});

test("reused Durov provenance is revisable, and performance changes stay atomic", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  await withStore(async (store, pool) => {
    await approveDurov(store);
    const pending = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "сделай спокойным",
    });
    assert.equal(pending.ok, true);
    const beforeFinish = await store.load();
    assert.equal(beforeFinish.frames[0].panels[0].performanceAssetId, null);
    const finished = await store.finishPanelGeneration({
      id: pending.id,
      result: { ok: true, image: { bytes: png }, metadata: { test: true } },
      provenance: {
        origin: "generation",
        subject: "Дуров",
        description: "Дуров смотрит спокойно",
        submittedText: "сделай спокойным",
        intent: { expression: "спокойное" },
      },
    });
    assert.equal(finished.ok, true);
    const generated = await store.load();
    const sourceAsset = generated.frames[0].panels[0].assetId;
    assert.equal(generated.reusableAssets[0].provenance.subject, "Дуров");
    assert.equal(generated.reusableAssets[0].provenance.submittedText, "сделай спокойным");

    const inserted = await store.applyOperation({
      op: "insertFrame",
      afterStructureFrameId: "frame-1",
      kind: "image",
    });
    assert.equal(inserted.changed, true);
    const withBlank = await store.load();
    const blank = withBlank.frames[1].panels[0];
    const assigned = await store.applyOperation({
      op: "assignAsset",
      assetId: sourceAsset,
      targets: [{ panelId: blank.id }],
    });
    assert.equal(assigned.changed, true);
    const carried = await store.load();
    assert.equal(carried.frames[1].panels[0].subject, "Дуров");
    assert.equal(carried.frames[1].panels[0].description, "Дуров смотрит спокойно");
    assert.equal(carried.frames[1].panels[0].assetId, sourceAsset);
    const sameAssignment = await store.applyOperation({
      op: "assignAsset",
      assetId: sourceAsset,
      targets: [{ panelId: blank.id }],
    });
    assert.equal(sameAssignment.changed, false);

    const revision = await store.beginPanelGeneration({
      frameId: carried.frames[1].id,
      panelIndex: 0,
      instruction: "Измени текущее изображение Дурова на удивлённо-раздражённое",
    });
    assert.equal(revision.ok, true);
    assert.equal(revision.subject, "Дуров");
    assert.equal(revision.refs.previous.id, sourceAsset);
    const failed = await store.finishPanelGeneration({
      id: revision.id,
      result: { ok: false, kind: "provider" },
    });
    assert.equal(failed.ok, false);
    const kept = await store.load();
    assert.equal(kept.frames[1].panels[0].assetId, sourceAsset);
    const headAfterFailure = await headId(pool);

    const retry = await store.beginPanelGeneration({
      frameId: carried.frames[1].id,
      panelIndex: 0,
      instruction: "Измени текущее изображение Дурова на удивлённо-раздражённое",
      performanceImage: { bytes: png },
    });
    assert.equal(retry.ok, true);
    const during = await store.load();
    assert.equal(during.frames[1].panels[0].performanceAssetId, null);
    assert.equal(during.frames[1].panels[0].assetId, sourceAsset);
    const revised = await store.finishPanelGeneration({
      id: retry.id,
      result: { ok: true, image: { bytes: png }, metadata: { test: true } },
      provenance: {
        origin: "generation",
        subject: "Дуров",
        description: "Дуров смотрит спокойно",
        submittedText: "Измени текущее изображение Дурова на удивлённо-раздражённое",
      },
    });
    assert.equal(revised.ok, true);
    const after = await store.load();
    assert.notEqual(after.frames[1].panels[0].assetId, sourceAsset);
    assert.ok(after.frames[1].panels[0].performanceAssetId);
    const undone = await store.undoStoryboardEdit();
    assert.equal(undone.ok, true);
    const restored = await store.load();
    assert.equal(restored.frames[1].panels[0].assetId, sourceAsset);
    assert.equal(restored.frames[1].panels[0].performanceAssetId, null);
    assert.equal(restored.frames[1].panels[0].subject, "Дуров");

    const clearing = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "без позы",
      clearPerformance: true,
    });
    assert.equal(clearing.ok, true);
    assert.equal((await store.load()).frames[0].panels[0].performanceAssetId, null);
    const cleared = await store.finishPanelGeneration({
      id: clearing.id,
      result: { ok: true, image: { bytes: png }, metadata: { test: true } },
    });
    assert.equal(cleared.ok, true);
    assert.notEqual(await headId(pool), headAfterFailure);

    const blankAgain = await store.applyOperation({ op: "insertFrame", kind: "image" });
    assert.equal(blankAgain.ok, true);
    const board = await store.load();
    const fresh = board.frames.at(-1).panels[0];
    const uploaded = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: redDataUrl,
      targets: [{ panelId: fresh.id }],
    });
    assert.equal(uploaded.ok, true);
    const unknownPanel = (await store.load()).frames.at(-1);
    assert.equal(unknownPanel.panels[0].subject, null);
    const blocked = await store.beginPanelGeneration({
      frameId: unknownPanel.id,
      panelIndex: 0,
      instruction: "измени",
    });
    assert.equal(blocked.kind, "subject-required");
  });
});
