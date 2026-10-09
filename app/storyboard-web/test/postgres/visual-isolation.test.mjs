import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
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
             character_anchor_version, character_identity, visual_asset,
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
  await pool.query("INSERT INTO source_revision (id, text) VALUES ($1, 'test')", [ids.source]);
  await pool.query(`
    INSERT INTO reading (id, draft_text, draft_revision_token, status)
    VALUES ($1, 'test', '10000000-0000-4000-8000-000000000008', 'ready')
  `, [ids.reading]);
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
    WHERE singleton = true
  `, [ids.source, ids.material]);
}

async function insertResult(pool, id, createdAt) {
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
    VALUES ($1, $2, 'checked', $3::jsonb, $4::timestamptz)
  `, [id, ids.material, JSON.stringify({ frames: frames() }), createdAt]);
}

test("panel assignments stay isolated between storyboard results with the same frame and panel keys", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
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
    assert.equal((await store.load()).allAnchorsApproved, true);

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
