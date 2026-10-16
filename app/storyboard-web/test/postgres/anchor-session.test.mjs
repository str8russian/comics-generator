import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { enterProject, SEEDED_PROJECT_ID } from "../../project-scope.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const generated = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ids = {
  source: "10000000-0000-4000-8000-000000000101",
  reading: "10000000-0000-4000-8000-000000000102",
  interpretation: "10000000-0000-4000-8000-000000000103",
  material: "10000000-0000-4000-8000-000000000104",
  character: "10000000-0000-4000-8000-000000000105",
  result: "10000000-0000-4000-8000-000000000106",
};

async function reset(pool) {
  await pool.query(`
    TRUNCATE visual_approval, panel_generation, panel_visual_state,
             project_style_seed, character_anchor_head, character_anchor_version, character_identity, visual_asset,
             storyboard_head, storyboard_version CASCADE
  `);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = NULL,
        active_material_state_id = NULL,
        current_reading_id = NULL
  `);
  await pool.query("DELETE FROM storyboard_result");
  await pool.query("DELETE FROM canonical_character");
  await pool.query("UPDATE material_state SET parent_material_state_id = NULL");
  await pool.query("DELETE FROM material_state");
  await pool.query("DELETE FROM interpretation");
  await pool.query("UPDATE source_revision SET parent_source_revision_id = NULL");
  await pool.query("DELETE FROM source_revision");
  await pool.query("DELETE FROM reading");
}

test("accepted anchor head ignores drafts and records provenance", {
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
    await pool.query(
      "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'test')",
      [ids.source, SEEDED_PROJECT_ID],
    );
    await pool.query(`
      INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
      VALUES ($1, $2, 'test', '10000000-0000-4000-8000-000000000108', 'ready')
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
      UPDATE project SET active_source_revision_id = $1, active_material_state_id = $2 WHERE id = $3
    `, [ids.source, ids.material, SEEDED_PROJECT_ID]);
    await pool.query(`
      INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
      VALUES ($1, $2, 'checked', $3::jsonb, '2026-10-16T08:00:00Z')
    `, [ids.result, ids.material, JSON.stringify({ frames: [] })]);

    const store = createVisualStore(pool);
    const uploaded = await store.acceptSessionAnchor({
      characterName: "Персонаж",
      provenance: "uploaded_as_ready_anchor",
      image: { bytes: png },
    });
    assert.equal(uploaded.ok, true);
    const afterUpload = await store.load();
    const uploadedCard = afterUpload.characters[0];
    assert.equal(uploadedCard.anchorProvenance, "uploaded_as_ready_anchor");
    assert.equal(uploadedCard.sourcePhoto, null);
    assert.equal(uploadedCard.identity, null);
    assert.equal(uploadedCard.approvedAnchorId, uploaded.anchorId);

    const beforeIdentity = uploadedCard.identity;
    const pending = await store.beginAnchor({ characterName: "Персонаж", instruction: "черновик" });
    assert.equal(pending.ok, false);
    const generatedAccept = await store.acceptSessionAnchor({
      characterName: "Персонаж",
      provenance: "generated_from_source",
      image: { bytes: generated },
      sourceImage: { bytes: png },
    });
    assert.equal(generatedAccept.ok, true);
    const afterGenerate = await store.load();
    const generatedCard = afterGenerate.characters[0];
    assert.equal(generatedCard.approvedAnchorId, generatedAccept.anchorId);
    assert.equal(generatedCard.anchorProvenance, "generated_from_source");
    assert.equal(generatedCard.sourcePhoto.assetId, generatedCard.identity.assetId);
    assert.notEqual(generatedCard.identity, beforeIdentity);
    assert.equal(generatedCard.candidate?.id === generatedCard.approvedAnchorId || generatedCard.candidate?.status !== "pending", true);

    const identityBeforeRefine = generatedCard.identity.assetId;
    const refined = await store.acceptSessionAnchor({
      characterName: "Персонаж",
      provenance: "refined_from_accepted_anchor",
      image: { bytes: png },
    });
    assert.equal(refined.ok, true);
    const afterRefine = await store.load();
    assert.equal(afterRefine.characters[0].identity.assetId, identityBeforeRefine);
    assert.equal(afterRefine.characters[0].approvedAnchorId, refined.anchorId);
    assert.equal(afterRefine.characters[0].anchorProvenance, "refined_from_accepted_anchor");

    const identityId = afterRefine.characters[0].identity.assetId;
    const beforeAssets = await pool.query("SELECT id, kind FROM visual_asset");
    const reused = await store.acceptSessionAnchor({
      characterName: "Персонаж",
      provenance: "generated_from_source",
      image: { bytes: generated },
      sourceAssetId: identityId,
    });
    assert.equal(reused.ok, true);
    const afterReuse = await store.load();
    assert.equal(afterReuse.characters[0].anchorProvenance, "generated_from_source");
    assert.equal(afterReuse.characters[0].identity.assetId, identityId);
    assert.equal(afterReuse.characters[0].sourcePhoto.assetId, identityId);
    assert.equal(afterReuse.characters[0].approvedAnchorId, reused.anchorId);
    const afterAssets = await pool.query("SELECT id, kind FROM visual_asset");
    const createdAssets = afterAssets.rows.filter((row) => !beforeAssets.rows.some((existing) => existing.id === row.id));
    assert.equal(createdAssets.length, 1);
    assert.equal(createdAssets[0].kind, "base-anchor");

    const foreign = await store.acceptSessionAnchor({
      characterName: "Персонаж",
      provenance: "generated_from_source",
      image: { bytes: png },
      sourceAssetId: "00000000-0000-4000-8000-000000009999",
    });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.kind, "not-found");
    const both = await store.acceptSessionAnchor({
      characterName: "Персонаж",
      provenance: "generated_from_source",
      image: { bytes: png },
      sourceImage: { bytes: png },
      sourceAssetId: identityId,
    });
    assert.equal(both.ok, false);
    assert.equal(both.kind, "invalid-request");
    const unchanged = await store.load();
    assert.equal(unchanged.characters[0].identity.assetId, identityId);
    assert.equal(unchanged.characters[0].approvedAnchorId, reused.anchorId);

    const retired = await store.retireCurrentAnchor({ characterName: "Персонаж" });
    assert.equal(retired.ok, true);
    const afterDelete = await store.load();
    assert.equal(afterDelete.characters[0].approvedAnchorId, null);
    assert.equal(afterDelete.characters[0].approvedAssetUrl, null);
    const restored = await store.restoreRetiredAnchor({
      characterName: "Персонаж",
      anchorId: retired.anchorId,
    });
    assert.equal(restored.ok, true);
    const afterRestore = await store.load();
    assert.equal(afterRestore.characters[0].approvedAnchorId, retired.anchorId);
  } finally {
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
