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

const ids = {
  source: "10000000-0000-4000-8000-000000000001",
  reading: "10000000-0000-4000-8000-000000000002",
  interpretation: "10000000-0000-4000-8000-000000000003",
  material: "10000000-0000-4000-8000-000000000004",
  character: "10000000-0000-4000-8000-000000000005",
  resultA: "10000000-0000-4000-8000-000000000006",
  resultB: "10000000-0000-4000-8000-000000000007",
};

function frames(description = "Абстрактный предмет на столе") {
  return [{
    id: "frame-1",
    layout: "single",
    origin: "source",
    panels: [{ description }],
    dialogue: "",
    sourceItemId: "item-1",
    sourceRole: "action",
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

async function seedMaterial(pool) {
  await pool.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'test')",
    [ids.source, SEEDED_PROJECT_ID],
  );
  await pool.query(`
    INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
    VALUES ($1, $2, 'test', '10000000-0000-4000-8000-000000000008', 'ready')
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
    VALUES ($1, $2, 0, 'Персонаж')
  `, [ids.character, ids.material]);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = $1, active_material_state_id = $2
    WHERE id = $3
  `, [ids.source, ids.material, SEEDED_PROJECT_ID]);
}

async function insertResult(pool, id, createdAt, payloadFrames = frames()) {
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
    VALUES ($1, $2, 'checked', $3::jsonb, $4::timestamptz)
  `, [id, ids.material, JSON.stringify({ frames: payloadFrames }), createdAt]);
}

test("panel assignments stay isolated between storyboard results with the same frame and panel keys", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await reset(pool);
    await seedMaterial(pool);
    await insertResult(pool, ids.resultA, "2026-10-09T10:00:00Z");

    const store = createVisualStore(pool);
    const initialA = await store.load();
    assert.equal(initialA.storyboardResultId, ids.resultA);
    assert.equal(initialA.frames[0].panels[0].assetId, null);

    const identity = await store.saveIdentity({
      characterName: "Персонаж",
      image: { bytes: png },
      comment: "keep the face recognizable",
    });
    assert.equal(identity.ok, true);
    const pendingAnchor = await store.beginAnchor({
      characterName: "Персонаж",
      instruction: "graphic contour",
    });
    assert.equal(pendingAnchor.ok, true);
    assert.deepEqual(pendingAnchor.identity.bytes, png);
    const finishedAnchor = await store.finishAnchor({
      id: pendingAnchor.id,
      result: { ok: true, image: { bytes: png }, metadata: { test: true } },
    });
    assert.equal(finishedAnchor.ok, true);
    const approvedAnchor = await store.approveAnchor({
      characterName: "Персонаж",
      anchorId: pendingAnchor.id,
    });
    assert.equal(approvedAnchor.ok, true);
    const loadedAfterApprove = await store.load();
    assert.equal(loadedAfterApprove.allAnchorsApproved, true);
    assert.equal(loadedAfterApprove.styleSeedAssetId, finishedAnchor.assetId);
    const secondPending = await store.beginAnchor({
      characterName: "Персонаж",
      instruction: "revise against the same seed",
    });
    assert.equal(secondPending.ok, true);
    assert.equal(secondPending.style?.id, finishedAnchor.assetId);

    const pending = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "first result only",
    });
    assert.equal(pending.ok, true);
    const finished = await store.finishPanelGeneration({
      id: pending.id,
      result: { ok: true, image: { bytes: png }, metadata: { test: true } },
    });
    assert.equal(finished.ok, true);

    const assignedA = await store.load();
    assert.equal(assignedA.frames[0].panels[0].assetId, finished.assetId);

    await insertResult(pool, ids.resultB, "2026-10-09T10:01:00Z");
    const initialB = await store.load();
    assert.equal(initialB.storyboardResultId, ids.resultB);
    assert.notEqual(initialB.storyboardVersionId, assignedA.storyboardVersionId);
    assert.equal(initialB.frames[0].id, "frame-1");
    assert.equal(initialB.frames[0].panels[0].stateId === assignedA.frames[0].panels[0].stateId, false);
    assert.equal(initialB.frames[0].panels[0].assetId, null);
    assert.equal(initialB.frames[0].panels[0].instruction, "");
    assert.equal(initialB.allAnchorsApproved, true, "identity anchors belong to the material, not one storyboard result");
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("placement zoom, pan, and mirror persist across reload and copy-forward without a new asset", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const split = [{
    id: "frame-split",
    layout: "split2",
    origin: "source",
    panels: [
      { description: "Левая панель" },
      { description: "Правая панель" },
    ],
    dialogue: "Привет",
    speakerPanel: 0,
    sourceItemId: "item-1",
    sourceRole: "utterance",
  }];
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await reset(pool);
    await seedMaterial(pool);
    await insertResult(pool, ids.resultA, "2026-10-14T10:00:00Z", split);
    const store = createVisualStore(pool);
    const beforeAssets = await pool.query("SELECT count(*)::int AS count FROM visual_asset");
    const beforeGenerations = await pool.query("SELECT count(*)::int AS count FROM panel_generation");
    const initial = await store.load();
    assert.equal(initial.frames[0].panels[0].zoom, 1);
    assert.equal(initial.frames[0].panels[0].positionX, 50);
    assert.equal(initial.frames[0].panels[0].positionY, 30);
    assert.equal(initial.frames[0].panels[0].mirrored, false);

    const updated = await store.updatePlacement({
      frameId: "frame-split",
      panelIndex: 0,
      zoom: 1.4,
      positionX: 41,
      positionY: 22,
      mirrored: true,
    });
    assert.equal(updated.ok, true);
    assert.deepEqual(updated.placement, {
      zoom: 1.4,
      positionX: 41,
      positionY: 22,
      mirrored: true,
    });
    const loaded = await store.load();
    assert.equal(loaded.frames[0].panels[0].zoom, 1.4);
    assert.equal(loaded.frames[0].panels[0].position, "41% 22%");
    assert.equal(loaded.frames[0].panels[0].mirrored, true);
    assert.equal(loaded.frames[0].panels[0].assetId, null);
    assert.equal(loaded.frames[0].panels[1].zoom, 1);
    assert.equal(loaded.frames[0].panels[1].positionX, 50);
    assert.equal(loaded.frames[0].panels[1].mirrored, false);

    const invalid = await store.updatePlacement({
      frameId: "frame-split",
      panelIndex: 1,
      zoom: 9,
    });
    assert.equal(invalid.ok, false);
    const still = await store.load();
    assert.equal(still.frames[0].panels[1].zoom, 1);
    assert.equal(still.frames[0].panels[0].mirrored, true);

    const edited = await store.saveStoryboardEdit({
      instruction: "оставить панели и перенести кадрирование",
      frames: split,
    });
    assert.equal(edited.ok, true);
    const copied = await store.load();
    assert.notEqual(copied.storyboardVersionId, loaded.storyboardVersionId);
    assert.equal(copied.frames[0].panels[0].zoom, 1.4);
    assert.equal(copied.frames[0].panels[0].positionX, 41);
    assert.equal(copied.frames[0].panels[0].positionY, 22);
    assert.equal(copied.frames[0].panels[0].mirrored, true);
    assert.equal(copied.frames[0].panels[1].mirrored, false);
    assert.equal(copied.frames[0].panels[0].assetId, null);

    const afterAssets = await pool.query("SELECT count(*)::int AS count FROM visual_asset");
    const afterGenerations = await pool.query("SELECT count(*)::int AS count FROM panel_generation");
    assert.equal(afterAssets.rows[0].count, beforeAssets.rows[0].count);
    assert.equal(afterGenerations.rows[0].count, beforeGenerations.rows[0].count);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("manual assembly keeps panel identity and reuses an upload without a generation attempt", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const split = [{
    id: "frame-split",
    layout: "split2",
    origin: "source",
    panels: [
      { description: "Левая панель" },
      { description: "Правая панель" },
    ],
    dialogue: "Привет",
    speakerPanel: 0,
    sourceItemId: "item-1",
    sourceRole: "utterance",
  }];
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await reset(pool);
    await seedMaterial(pool);
    await insertResult(pool, ids.resultA, "2026-10-14T12:00:00Z", split);
    const store = createVisualStore(pool);
    const initial = await store.load();
    const leftId = initial.frames[0].panels[0].id;
    const rightId = initial.frames[0].panels[1].id;
    assert.equal(typeof leftId, "string");
    assert.notEqual(leftId, rightId);
    const placed = await store.updatePlacement({
      frameId: "frame-split",
      panelIndex: 0,
      zoom: 1.5,
      positionX: 20,
      positionY: 40,
      mirrored: true,
    });
    assert.equal(placed.ok, true);
    const moved = await store.applyOperation({
      op: "reorderPanels",
      structureFrameId: "frame-split",
      panelIds: [rightId, leftId],
    });
    assert.equal(moved.ok, true);
    const after = await store.load();
    assert.equal(after.frames[0].dialogue, "Привет");
    assert.equal(after.frames[0].sourceItemId, "item-1");
    assert.equal(after.frames[0].speakerPanel, 1);
    assert.equal(after.frames[0].panels[1].id, leftId);
    assert.equal(after.frames[0].panels[1].description, "Левая панель");
    assert.equal(after.frames[0].panels[1].zoom, 1.5);
    assert.equal(after.frames[0].panels[1].positionX, 20);
    assert.equal(after.frames[0].panels[1].mirrored, true);
    assert.equal(after.frames[0].panels[0].id, rightId);
    assert.equal(after.frames[0].panels[0].zoom, 1);

    const beforeAssets = await pool.query("SELECT count(*)::int AS count FROM visual_asset");
    const beforeGenerations = await pool.query("SELECT count(*)::int AS count FROM panel_generation");
    const uploaded = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      targets: [{ panelId: leftId }],
    });
    assert.equal(uploaded.ok, true);
    const withImage = await store.load();
    const uploadedPanel = withImage.frames[0].panels.find((panel) => panel.id === leftId);
    assert.equal(uploadedPanel.assignmentOrigin, "upload");
    assert.equal(typeof uploadedPanel.assetId, "string");
    const noted = await store.applyOperation({
      op: "setOwnerDescription",
      panelId: leftId,
      ownerDescription: "заметка владельца",
    });
    assert.equal(noted.ok, true);
    const reused = await store.applyOperation({
      op: "assignAsset",
      assetId: uploadedPanel.assetId,
      targets: [{ panelId: rightId }],
    });
    assert.equal(reused.ok, true);
    const shared = await store.load();
    const rightPanel = shared.frames[0].panels.find((panel) => panel.id === rightId);
    const leftPanel = shared.frames[0].panels.find((panel) => panel.id === leftId);
    assert.equal(rightPanel.assetId, uploadedPanel.assetId);
    assert.equal(rightPanel.assignmentOrigin, "reuse");
    assert.equal(rightPanel.description, "Правая панель");
    assert.equal(rightPanel.ownerDescription || "", "");
    assert.equal(leftPanel.ownerDescription, "заметка владельца");
    assert.equal(leftPanel.description, "Левая панель");
    const afterAssets = await pool.query("SELECT count(*)::int AS count FROM visual_asset");
    const afterGenerations = await pool.query("SELECT count(*)::int AS count FROM panel_generation");
    assert.equal(afterAssets.rows[0].count, beforeAssets.rows[0].count + 1);
    assert.equal(afterGenerations.rows[0].count, beforeGenerations.rows[0].count);

    const duplicate = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      targets: [{ panelId: rightId }],
    });
    assert.equal(duplicate.ok, true);
    const deduped = await pool.query("SELECT count(*)::int AS count FROM visual_asset");
    assert.equal(deduped.rows[0].count, afterAssets.rows[0].count);
    const afterDuplicate = await store.load();

    const head = afterDuplicate.storyboardVersionId;
    const rejected = await store.applyOperation({
      op: "batch",
      operations: [
        { op: "insertFrame", index: 1, kind: "text" },
        { op: "setDuration", structureFrameId: "frame-split", durationFrames: 1 },
      ],
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.kind, "duration-truncates-dialogue");
    const unchanged = await store.load();
    assert.equal(unchanged.storyboardVersionId, head);
    assert.equal(unchanged.frames.length, 1);
    assert.equal(unchanged.frames[0].dialogue, "Привет");

    await store.applyOperation({ op: "insertFrame", index: 1, kind: "image" });
    await store.applyOperation({ op: "insertFrame", index: 2, kind: "text" });
    const assembled = await store.load();
    const image = assembled.frames.find((frame) => frame.frameKind === "image");
    const card = assembled.frames.find((frame) => frame.frameKind === "text");
    assert.equal(image.durationFrames, 36);
    assert.equal(image.durationSeconds, 1.2);
    const written = await store.applyOperation({
      op: "setTextCard",
      structureFrameId: card.structureFrameId,
      text: "Пояснение",
    });
    assert.equal(written.ok, true);
    const finished = await store.load();
    assert.equal(finished.frames.find((frame) => frame.frameKind === "text").textCard, "Пояснение");
    assert.equal(finished.frames.find((frame) => frame.frameKind === "text").dialogue, "");
    assert.equal(finished.frames[0].dialogue, "Привет");
    const generations = await pool.query("SELECT count(*)::int AS count FROM panel_generation");
    assert.equal(generations.rows[0].count, 0);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("current image follows assignment then generation, and undo restores each step", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await reset(pool);
    await seedMaterial(pool);
    await insertResult(pool, ids.resultA, "2026-10-14T13:00:00Z");
    const store = createVisualStore(pool);
    const initial = await store.load();
    const panelId = initial.frames[0].panels[0].id;
    const uploaded = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      targets: [{ panelId }],
    });
    assert.equal(uploaded.ok, true);
    const assigned = await store.load();
    const assignedId = assigned.frames[0].panels[0].assetId;
    assert.equal(typeof assignedId, "string");
    assert.equal(assigned.canUndo, true);
    const pending = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "измени выражение",
    });
    assert.equal(pending.ok, true);
    assert.equal(pending.refs.previous?.id, assignedId);
    const generatedPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const finished = await store.finishPanelGeneration({
      id: pending.id,
      result: { ok: true, image: { bytes: generatedPng }, metadata: { test: true } },
    });
    assert.equal(finished.ok, true);
    const visible = await store.load();
    assert.equal(visible.frames[0].panels[0].assetId, finished.assetId);
    assert.notEqual(visible.frames[0].panels[0].assetId, assignedId);
    assert.equal(visible.frames[0].panels[0].assignmentOrigin, "generation");
    const undoneGeneration = await store.undoStoryboardEdit();
    assert.equal(undoneGeneration.ok, true);
    const restoredAssignment = await store.load();
    assert.equal(restoredAssignment.frames[0].panels[0].assetId, assignedId);
    const undoneAssignment = await store.undoStoryboardEdit();
    assert.equal(undoneAssignment.ok, true);
    const restoredEmpty = await store.load();
    assert.equal(restoredEmpty.frames[0].panels[0].assetId, null);
    const assets = await pool.query("SELECT count(*)::int AS count FROM visual_asset");
    assert.equal(assets.rows[0].count >= 2, true);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

