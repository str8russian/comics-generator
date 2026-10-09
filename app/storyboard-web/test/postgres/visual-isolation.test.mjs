import assert from "node:assert/strict";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { encodeRgbPng } from "../../image-matte.mjs";
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
    TRUNCATE visual_approval,
             character_visual_state_generation,
             scene_background_generation,
             frame_hybrid_state,
             scene_background_state,
             generation_record,
             visual_frame_operation,
             panel_generation, panel_visual_state,
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

async function insertResult(pool, id, createdAt, stageFrames = frames()) {
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload, created_at)
    VALUES ($1, $2, 'checked', $3::jsonb, $4::timestamptz)
  `, [id, ids.material, JSON.stringify({ frames: stageFrames }), createdAt]);
}

function splitDialogueFrames() {
  return [
    {
      id: "frame-1",
      layout: "split2",
      origin: "source",
      panels: [{ description: "Персонаж слева" }, { description: "Персонаж справа" }],
      dialogue: "Раз",
      speakerPanel: 0,
      sourceItemId: "item-1",
      sourceRole: "utterance",
    },
    {
      id: "frame-2",
      layout: "split2",
      origin: "source",
      panels: [{ description: "Персонаж слева снова" }, { description: "Персонаж справа снова" }],
      dialogue: "Два",
      speakerPanel: 1,
      sourceItemId: "item-2",
      sourceRole: "utterance",
    },
  ];
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

async function approveStyleAndAnchor(store) {
  const identity = await store.saveIdentity({
    characterName: "Персонаж",
    image: { bytes: png },
    comment: "identity",
  });
  assert.equal(identity.ok, true);
  const pending = await store.beginAnchor({ characterName: "Персонаж", instruction: "seed" });
  assert.equal(pending.ok, true);
  const finished = await store.finishAnchor({
    id: pending.id,
    result: { ok: true, image: { bytes: png }, metadata: {} },
  });
  assert.equal(finished.ok, true);
  const approved = await store.approveAnchor({
    characterName: "Персонаж",
    anchorId: pending.id,
  });
  assert.equal(approved.ok, true);
  return {
    styleAssetId: approved.styleSeedAssetId,
    anchorVersionId: pending.id,
  };
}

function provenance(label) {
  return {
    visualIntent: { label },
    compiledPrompt: `compiled-${label}`,
    promptCompilerVersion: "hybrid-v1",
    model: "test-model",
    generationSettings: { aspectRatio: "5:4" },
    referenceManifest: [{ role: "style", assetId: "style" }],
    omittedReferences: [],
    appGitCommit: "test",
  };
}

test("hybrid persistence is additive, isolated, and protects shared primary-scene writes", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T11:00:00Z");

    const store = createVisualStore(pool);
    const authorities = await approveStyleAndAnchor(store);
    const historical = await store.beginPanelGeneration({
      frameId: "frame-1",
      panelIndex: 0,
      instruction: "historical full panel",
    });
    assert.equal(historical.ok, true);
    const historicalDone = await store.finishPanelGeneration({
      id: historical.id,
      result: { ok: true, image: { bytes: png }, metadata: {} },
    });
    assert.equal(historicalDone.ok, true);
    const beforeHybrid = await store.load();
    assert.equal(beforeHybrid.frames[0].panels[0].assetId, historicalDone.assetId);

    const heads = await store.ensureHybridHeads({
      frameId: "frame-1",
      compositionMode: "near-frontal-pair",
    });
    assert.equal(heads.ok, true);
    assert.equal(heads.sceneBackgroundState.sceneKey, "primary");
    assert.equal(heads.sceneBackgroundState.currentGenerationId, null);
    assert.equal(heads.frameHybridState.assemblyStatus, "not-ready");

    const kindCheck = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'visual_asset'::regclass AND conname = 'visual_asset_kind_check'
    `);
    assert.match(kindCheck.rows[0].def, /scene-background/);
    assert.match(kindCheck.rows[0].def, /character-state-raw/);
    assert.match(kindCheck.rows[0].def, /character-state/);

    const fitDefault = await pool.query(`
      SELECT fit_mode, current_character_generation_id
      FROM panel_visual_state
      WHERE storyboard_version_id = $1 AND frame_id = 'frame-1' AND panel_index = 0
    `, [heads.storyboardVersionId]);
    assert.equal(fitDefault.rows[0].fit_mode, "manual");
    assert.equal(fitDefault.rows[0].current_character_generation_id, null);

    const historicalCount = await pool.query(
      `SELECT count(*)::int AS count FROM panel_generation WHERE id = $1`,
      [historical.id],
    );
    assert.equal(historicalCount.rows[0].count, 1);

    const opA = await store.createFrameOperation({ frameId: "frame-1", scope: "frame" });
    assert.equal(opA.ok, true);
    assert.equal(opA.writeVersion, 1);
    const claimA = await store.claimOrReuseSceneBackground({
      operationId: opA.operationId,
      preferReuse: true,
    });
    assert.equal(claimA.ok, true);
    assert.equal(claimA.mode, "claim");
    assert.equal(claimA.claimed, true);
    assert.equal(claimA.writeVersion, 1);
    assert.equal(claimA.capturedSceneWriteVersion, 1);

    const bgA = await store.createSceneBackgroundGeneration({
      operationId: opA.operationId,
      styleAssetId: authorities.styleAssetId,
      capturedSceneWriteVersion: claimA.capturedSceneWriteVersion,
      provenance: provenance("bg-a"),
    });
    assert.equal(bgA.ok, true);
    const recordBefore = await pool.query(
      `SELECT status, compiled_prompt FROM generation_record WHERE id = $1`,
      [bgA.generationRecordId],
    );
    assert.equal(recordBefore.rows[0].status, "pending");
    assert.equal(recordBefore.rows[0].compiled_prompt, "compiled-bg-a");

    const bgReady = await store.finalizeSceneBackgroundGeneration({
      generationId: bgA.generationId,
      result: { ok: true, image: { bytes: png }, latencyMs: 12 },
    });
    assert.equal(bgReady.ok, true);
    assert.equal(bgReady.advancedCurrentPointer, true);
    const sceneAfterA = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(sceneAfterA.sceneBackgroundState.currentGenerationId, bgA.generationId);
    assert.equal(sceneAfterA.sceneBackgroundState.activeOperationId, null);
    assert.equal(sceneAfterA.sceneBackgroundState.writeVersion, 1);

    const secondFinalize = await store.finalizeGenerationRecord({
      id: bgA.generationRecordId,
      status: "failed",
      errorKind: "provider",
    });
    assert.equal(secondFinalize.ok, false);
    assert.equal(secondFinalize.kind, "conflict");
    const recordAfter = await pool.query(
      `SELECT status, compiled_prompt FROM generation_record WHERE id = $1`,
      [bgA.generationRecordId],
    );
    assert.equal(recordAfter.rows[0].status, "ready");
    assert.equal(recordAfter.rows[0].compiled_prompt, "compiled-bg-a");

    const charPending = await store.createCharacterStateGeneration({
      operationId: opA.operationId,
      frameId: "frame-1",
      panelIndex: 0,
      anchorVersionId: authorities.anchorVersionId,
      styleAssetId: authorities.styleAssetId,
      provenance: provenance("char-a"),
    });
    assert.equal(charPending.ok, true);
    const charReady = await store.finalizeCharacterStateGeneration({
      generationId: charPending.generationId,
      result: { ok: true, image: { bytes: png }, rawImage: { bytes: png } },
      advanceWithOperationId: opA.operationId,
    });
    assert.equal(charReady.ok, true);
    assert.equal(charReady.advancedCurrentPointer, true);

    const failedReplacement = await store.createCharacterStateGeneration({
      operationId: opA.operationId,
      frameId: "frame-1",
      panelIndex: 0,
      anchorVersionId: authorities.anchorVersionId,
      styleAssetId: authorities.styleAssetId,
      parentGenerationId: charPending.generationId,
      provenance: provenance("char-fail"),
    });
    assert.equal(failedReplacement.ok, true);
    const failedDone = await store.finalizeCharacterStateGeneration({
      generationId: failedReplacement.generationId,
      result: { ok: false, kind: "matte-failed" },
      advanceWithOperationId: opA.operationId,
    });
    assert.equal(failedDone.ok, true);
    assert.equal(failedDone.advancedCurrentPointer, false);
    const afterFail = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(afterFail.panels[0].currentCharacterGenerationId, charPending.generationId);
    assert.equal(afterFail.panels[0].currentGenerationId, historical.id);

    await insertResult(pool, ids.resultB, "2026-10-09T11:01:00Z");
    const loadedB = await store.load();
    assert.equal(loadedB.storyboardResultId, ids.resultB);
    const headsB = await store.ensureHybridHeads({ frameId: "frame-1" });
    assert.equal(headsB.ok, true);
    assert.notEqual(headsB.storyboardVersionId, heads.storyboardVersionId);
    assert.equal(headsB.sceneBackgroundState.currentGenerationId, null);
    const persistenceB = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(persistenceB.storyboardResultId, ids.resultB);
    assert.equal(persistenceB.sceneBackgroundState.currentGenerationId, null);
    assert.equal(persistenceB.panels[0].currentCharacterGenerationId, null);
    assert.equal(persistenceB.panels[0].currentGenerationId, null);

    // Shared-background concurrency for two frame operations on the same version-scoped primary scene.
    await reset(pool);
    await seedMaterial(pool);
    await insertResult(pool, ids.resultA, "2026-10-09T12:00:00Z");
    const store2 = createVisualStore(pool);
    const auth2 = await approveStyleAndAnchor(store2);
    await store2.ensureHybridHeads({ frameId: "frame-1" });
    await store2.ensureHybridHeads({ frameId: "frame-2" });

    const opFrame1 = await store2.createFrameOperation({ frameId: "frame-1" });
    const claim1 = await store2.claimOrReuseSceneBackground({
      operationId: opFrame1.operationId,
      preferReuse: false,
    });
    assert.equal(claim1.mode, "claim");
    assert.equal(claim1.writeVersion, 1);
    const gen1 = await store2.createSceneBackgroundGeneration({
      operationId: opFrame1.operationId,
      styleAssetId: auth2.styleAssetId,
      capturedSceneWriteVersion: claim1.capturedSceneWriteVersion,
      provenance: provenance("frame1-bg"),
    });
    assert.equal(gen1.ok, true);
    assert.equal(gen1.capturedSceneWriteVersion, 1);

    const opFrame2 = await store2.createFrameOperation({ frameId: "frame-2" });
    const claim2 = await store2.claimOrReuseSceneBackground({
      operationId: opFrame2.operationId,
      preferReuse: false,
    });
    assert.equal(claim2.mode, "claim");
    assert.equal(claim2.writeVersion, 2);
    assert.equal(claim2.capturedSceneWriteVersion, 2);
    const gen2 = await store2.createSceneBackgroundGeneration({
      operationId: opFrame2.operationId,
      styleAssetId: auth2.styleAssetId,
      capturedSceneWriteVersion: claim2.capturedSceneWriteVersion,
      provenance: provenance("frame2-bg"),
    });
    assert.equal(gen2.ok, true);

    const staleDone = await store2.finalizeSceneBackgroundGeneration({
      generationId: gen1.generationId,
      result: { ok: true, image: { bytes: png } },
    });
    assert.equal(staleDone.ok, true);
    assert.equal(staleDone.status, "ready");
    assert.equal(staleDone.advancedCurrentPointer, false, "stale scene write must not advance current_generation_id");
    const staleRecord = await pool.query(
      `SELECT status FROM generation_record WHERE id = $1`,
      [gen1.generationRecordId],
    );
    assert.equal(staleRecord.rows[0].status, "ready", "stale attempt still finalizes its own provenance");

    const sceneAfterStale = await store2.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(sceneAfterStale.sceneBackgroundState.currentGenerationId, null);
    assert.equal(sceneAfterStale.sceneBackgroundState.writeVersion, 2);
    assert.equal(sceneAfterStale.sceneBackgroundState.activeOperationId, opFrame2.operationId);

    const winner = await store2.finalizeSceneBackgroundGeneration({
      generationId: gen2.generationId,
      result: { ok: true, image: { bytes: png } },
    });
    assert.equal(winner.ok, true);
    assert.equal(winner.advancedCurrentPointer, true);
    const sceneAfterWinner = await store2.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(sceneAfterWinner.sceneBackgroundState.currentGenerationId, gen2.generationId);
    assert.equal(sceneAfterWinner.sceneBackgroundState.activeOperationId, null);

    const reuseOp = await store2.createFrameOperation({ frameId: "frame-1" });
    const reuse = await store2.claimOrReuseSceneBackground({
      operationId: reuseOp.operationId,
      preferReuse: true,
    });
    assert.equal(reuse.ok, true);
    assert.equal(reuse.mode, "reuse");
    assert.equal(reuse.claimed, false);
    assert.equal(reuse.currentGenerationId, gen2.generationId);
    const sceneAfterReuse = await store2.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(sceneAfterReuse.sceneBackgroundState.writeVersion, 2);
    assert.equal(sceneAfterReuse.sceneBackgroundState.activeOperationId, null);

    const frameOnlyOp = await store2.createFrameOperation({ frameId: "frame-2" });
    assert.equal(frameOnlyOp.ok, true);
    const sceneAfterFrameOnly = await store2.loadHybridPersistence({ frameId: "frame-2" });
    assert.equal(
      sceneAfterFrameOnly.sceneBackgroundState.currentGenerationId,
      gen2.generationId,
      "frame-level operation authority alone must not update the shared background pointer",
    );
    assert.equal(sceneAfterFrameOnly.sceneBackgroundState.activeOperationId, null);
    assert.equal(sceneAfterFrameOnly.frameHybridState.activeOperationId, frameOnlyOp.operationId);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("hybrid foundation repairs: concurrent heads, atomic write versions, finalize-once, and operation scoping", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T13:00:00Z", splitDialogueFrames());

    const store = createVisualStore(pool);
    const authorities = await approveStyleAndAnchor(store);

    const concurrentHeads = await Promise.all([
      store.ensureHybridHeads({ frameId: "frame-1" }),
      store.ensureHybridHeads({ frameId: "frame-2" }),
      store.ensureHybridHeads({ frameId: "frame-1" }),
      store.ensureHybridHeads({ frameId: "frame-1" }),
    ]);
    for (const head of concurrentHeads) {
      assert.equal(head.ok, true, "concurrent scene-head initialization must not fail as database");
      assert.equal(head.sceneBackgroundState.sceneKey, "primary");
    }
    const sceneIds = new Set(concurrentHeads.map((head) => head.sceneBackgroundState.id));
    assert.equal(sceneIds.size, 1);
    const sceneCount = await pool.query(`
      SELECT count(*)::int AS count
      FROM scene_background_state
      WHERE storyboard_version_id = $1 AND scene_key = 'primary'
    `, [concurrentHeads[0].storyboardVersionId]);
    assert.equal(sceneCount.rows[0].count, 1);

    const [opEarly, opLate] = await Promise.all([
      store.createFrameOperation({ frameId: "frame-1", scope: "frame" }),
      store.createFrameOperation({ frameId: "frame-1", scope: "frame" }),
    ]);
    assert.equal(opEarly.ok, true);
    assert.equal(opLate.ok, true);
    assert.notEqual(opEarly.operationId, opLate.operationId);
    assert.notEqual(opEarly.writeVersion, opLate.writeVersion);
    const ordered = [opEarly, opLate].sort((a, b) => a.writeVersion - b.writeVersion);
    assert.equal(ordered[0].writeVersion + 1, ordered[1].writeVersion);
    const hybridAfterOps = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(hybridAfterOps.frameHybridState.activeOperationId, ordered[1].operationId);
    assert.notEqual(
      hybridAfterOps.frameHybridState.activeOperationId,
      ordered[0].operationId,
      "earlier operation must not stay authoritative after a later write version wins",
    );

    const claim = await store.claimOrReuseSceneBackground({
      operationId: ordered[1].operationId,
      preferReuse: false,
    });
    assert.equal(claim.ok, true);
    assert.equal(claim.mode, "claim");
    const pendingBg = await store.createSceneBackgroundGeneration({
      operationId: ordered[1].operationId,
      styleAssetId: authorities.styleAssetId,
      capturedSceneWriteVersion: claim.capturedSceneWriteVersion,
      provenance: provenance("finalize-once"),
    });
    assert.equal(pendingBg.ok, true);
    const beforeInvalid = await pool.query(
      `SELECT status, compiled_prompt, prompt_compiler_version, visual_intent_json
       FROM generation_record WHERE id = $1`,
      [pendingBg.generationRecordId],
    );
    assert.equal(beforeInvalid.rows[0].status, "pending");

    const rejectPending = await store.finalizeGenerationRecord({
      id: pendingBg.generationRecordId,
      status: "pending",
    });
    assert.equal(rejectPending.ok, false);
    assert.equal(rejectPending.kind, "invalid-request");
    const rejectUnknown = await store.finalizeGenerationRecord({
      id: pendingBg.generationRecordId,
      status: "complete",
    });
    assert.equal(rejectUnknown.ok, false);
    assert.equal(rejectUnknown.kind, "invalid-request");
    const rejectMissing = await store.finalizeGenerationRecord({
      id: pendingBg.generationRecordId,
    });
    assert.equal(rejectMissing.ok, false);
    assert.equal(rejectMissing.kind, "invalid-request");
    const stillPending = await pool.query(
      `SELECT status, compiled_prompt, prompt_compiler_version, visual_intent_json
       FROM generation_record WHERE id = $1`,
      [pendingBg.generationRecordId],
    );
    assert.equal(stillPending.rows[0].status, "pending");
    assert.equal(stillPending.rows[0].compiled_prompt, beforeInvalid.rows[0].compiled_prompt);
    assert.equal(
      stillPending.rows[0].prompt_compiler_version,
      beforeInvalid.rows[0].prompt_compiler_version,
    );
    assert.deepEqual(
      stillPending.rows[0].visual_intent_json,
      beforeInvalid.rows[0].visual_intent_json,
    );

    const readyOnce = await store.finalizeGenerationRecord({
      id: pendingBg.generationRecordId,
      status: "ready",
      outputAssetId: null,
      latencyMs: 5,
    });
    assert.equal(readyOnce.ok, true);
    assert.equal(readyOnce.record.status, "ready");
    const secondReady = await store.finalizeGenerationRecord({
      id: pendingBg.generationRecordId,
      status: "failed",
      errorKind: "provider",
    });
    assert.equal(secondReady.ok, false);
    assert.equal(secondReady.kind, "conflict");
    const immutable = await pool.query(
      `SELECT status, compiled_prompt, prompt_compiler_version, visual_intent_json::text AS intent
       FROM generation_record WHERE id = $1`,
      [pendingBg.generationRecordId],
    );
    assert.equal(immutable.rows[0].status, "ready");
    assert.equal(immutable.rows[0].compiled_prompt, "compiled-finalize-once");
    assert.equal(immutable.rows[0].prompt_compiler_version, "hybrid-v1");

    const failedOp = await store.createFrameOperation({ frameId: "frame-2" });
    const failedClaim = await store.claimOrReuseSceneBackground({
      operationId: failedOp.operationId,
      preferReuse: false,
    });
    assert.equal(failedClaim.ok, true);
    const pendingFail = await store.createSceneBackgroundGeneration({
      operationId: failedOp.operationId,
      styleAssetId: authorities.styleAssetId,
      capturedSceneWriteVersion: failedClaim.capturedSceneWriteVersion,
      provenance: provenance("fail-once"),
    });
    assert.equal(pendingFail.ok, true);
    const failOnce = await store.finalizeGenerationRecord({
      id: pendingFail.generationRecordId,
      status: "failed",
      errorKind: "provider",
    });
    assert.equal(failOnce.ok, true);
    assert.equal(failOnce.record.status, "failed");
    const failAgain = await store.finalizeGenerationRecord({
      id: pendingFail.generationRecordId,
      status: "ready",
    });
    assert.equal(failAgain.ok, false);
    assert.equal(failAgain.kind, "conflict");

    // Component-operation scoping
    const opFrame1 = await store.createFrameOperation({ frameId: "frame-1" });
    const opFrame2 = await store.createFrameOperation({ frameId: "frame-2" });
    const wrongFrame = await store.createCharacterStateGeneration({
      operationId: opFrame1.operationId,
      frameId: "frame-2",
      panelIndex: 0,
      anchorVersionId: authorities.anchorVersionId,
      styleAssetId: authorities.styleAssetId,
      provenance: provenance("wrong-frame"),
    });
    assert.equal(wrongFrame.ok, false);
    assert.equal(wrongFrame.kind, "conflict");
    const noRowsWrongFrame = await pool.query(
      `SELECT count(*)::int AS count FROM generation_record WHERE compiled_prompt = 'compiled-wrong-frame'`,
    );
    assert.equal(noRowsWrongFrame.rows[0].count, 0);

    const panelOp = await store.createFrameOperation({
      frameId: "frame-1",
      scope: "panel",
      panelIndex: 0,
    });
    const wrongPanel = await store.createCharacterStateGeneration({
      operationId: panelOp.operationId,
      frameId: "frame-1",
      panelIndex: 1,
      anchorVersionId: authorities.anchorVersionId,
      styleAssetId: authorities.styleAssetId,
      provenance: provenance("wrong-panel"),
    });
    assert.equal(wrongPanel.ok, false);
    assert.equal(wrongPanel.kind, "conflict");
    const noRowsWrongPanel = await pool.query(
      `SELECT count(*)::int AS count FROM generation_record WHERE compiled_prompt = 'compiled-wrong-panel'`,
    );
    assert.equal(noRowsWrongPanel.rows[0].count, 0);

    const staleClaim = await store.createSceneBackgroundGeneration({
      operationId: opFrame1.operationId,
      styleAssetId: authorities.styleAssetId,
      capturedSceneWriteVersion: 1,
      provenance: provenance("stale-claim"),
    });
    assert.equal(staleClaim.ok, false);
    assert.equal(staleClaim.kind, "conflict");
    const noRowsStale = await pool.query(
      `SELECT count(*)::int AS count FROM generation_record WHERE compiled_prompt = 'compiled-stale-claim'`,
    );
    assert.equal(noRowsStale.rows[0].count, 0);

    const matchingClaim = await store.claimOrReuseSceneBackground({
      operationId: opFrame2.operationId,
      preferReuse: false,
    });
    assert.equal(matchingClaim.ok, true);
    const mismatchedCapture = await store.createSceneBackgroundGeneration({
      operationId: opFrame2.operationId,
      styleAssetId: authorities.styleAssetId,
      capturedSceneWriteVersion: matchingClaim.capturedSceneWriteVersion + 1,
      provenance: provenance("mismatched-capture"),
    });
    assert.equal(mismatchedCapture.ok, false);
    assert.equal(mismatchedCapture.kind, "conflict");

    await insertResult(pool, ids.resultB, "2026-10-09T13:01:00Z", splitDialogueFrames());
    const foreignVersion = await store.createCharacterStateGeneration({
      operationId: opFrame2.operationId,
      frameId: "frame-2",
      panelIndex: 0,
      anchorVersionId: authorities.anchorVersionId,
      styleAssetId: authorities.styleAssetId,
      provenance: provenance("foreign-version"),
    });
    assert.equal(foreignVersion.ok, false);
    assert.equal(foreignVersion.kind, "not-found");
    const noRowsForeign = await pool.query(
      `SELECT count(*)::int AS count FROM generation_record WHERE compiled_prompt = 'compiled-foreign-version'`,
    );
    assert.equal(noRowsForeign.rows[0].count, 0);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

function chromakeySubjectPng() {
  const width = 32;
  const height = 32;
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const subject = x >= 8 && x < 24 && y >= 8 && y < 24;
      rgb[i] = subject ? 40 : 0;
      rgb[i + 1] = subject ? 40 : 255;
      rgb[i + 2] = subject ? 40 : 0;
    }
  }
  return encodeRgbPng(width, height, rgb);
}

test("hybrid lifecycle keeps provenance before provider I/O and retains ready heads", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T14:00:00Z", splitDialogueFrames());
    const store = createVisualStore(pool);
    await approveStyleAndAnchor(store);
    await store.ensureHybridHeads({ frameId: "frame-1" });
    const op = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(op.ok, true);

    const providerConfig = { model: "hybrid-test-model", timeoutMs: 12345 };
    let providerCalls = 0;
    const backgroundBegin = await store.beginSceneBackgroundLifecycle({
      operationId: op.operationId,
      providerConfig,
      env: {},
    });
    assert.equal(backgroundBegin.ok, true);
    assert.equal(backgroundBegin.mode, "generate");
    const recordBeforeProvider = await pool.query(
      `SELECT status, compiled_prompt, model, generation_settings_json,
              provider_status, latency_ms
       FROM generation_record WHERE id = $1`,
      [backgroundBegin.generationRecordId],
    );
    assert.equal(recordBeforeProvider.rows[0].status, "pending");
    assert.ok(String(recordBeforeProvider.rows[0].compiled_prompt).length > 0);
    assert.equal(recordBeforeProvider.rows[0].model, "hybrid-test-model");
    assert.equal(recordBeforeProvider.rows[0].generation_settings_json.aspectRatio, "21:9");
    assert.equal(recordBeforeProvider.rows[0].generation_settings_json.component, "scene-background");
    assert.equal(recordBeforeProvider.rows[0].generation_settings_json.timeoutMs, 12345);
    assert.equal(recordBeforeProvider.rows[0].provider_status, null);
    assert.equal(providerCalls, 0, "provenance exists before any provider call");

    providerCalls += 1;
    const bgDone = await store.finalizeSceneBackgroundLifecycle({
      generationId: backgroundBegin.generationId,
      providerResult: {
        ok: true,
        image: { bytes: png },
        metadata: { providerStatus: 200, latencyMs: 42, model: "hybrid-test-model" },
      },
    });
    assert.equal(bgDone.ok, true);
    assert.equal(bgDone.advancedCurrentPointer, true);
    const recordAfterSuccess = await pool.query(
      `SELECT status, model, provider_status, latency_ms FROM generation_record WHERE id = $1`,
      [backgroundBegin.generationRecordId],
    );
    assert.equal(recordAfterSuccess.rows[0].status, "ready");
    assert.equal(recordAfterSuccess.rows[0].model, "hybrid-test-model");
    assert.equal(Number(recordAfterSuccess.rows[0].provider_status), 200);
    assert.equal(Number(recordAfterSuccess.rows[0].latency_ms), 42);

    const charBegin = await store.beginCharacterStateLifecycle({
      operationId: op.operationId,
      frameId: "frame-1",
      panelIndex: 0,
      providerConfig,
      env: {},
    });
    assert.equal(charBegin.ok, true);
    const charRecord = await pool.query(
      `SELECT status, model, generation_settings_json FROM generation_record WHERE id = $1`,
      [charBegin.generationRecordId],
    );
    assert.equal(charRecord.rows[0].status, "pending");
    assert.equal(charRecord.rows[0].model, "hybrid-test-model");
    assert.equal(charRecord.rows[0].generation_settings_json.panelIndex, 0);
    const charReady = await store.finalizeCharacterStateLifecycle({
      generationId: charBegin.generationId,
      providerResult: {
        ok: true,
        image: { bytes: chromakeySubjectPng() },
        metadata: { providerStatus: 201, latencyMs: 17 },
      },
      advanceWithOperationId: op.operationId,
    });
    assert.equal(charReady.ok, true);
    assert.equal(charReady.status, "ready");
    assert.equal(charReady.advancedCurrentPointer, true);
    assert.ok(charReady.rawAssetId);
    assert.ok(charReady.outputAssetId);
    const charTerminal = await pool.query(
      `SELECT provider_status, latency_ms FROM generation_record WHERE id = $1`,
      [charBegin.generationRecordId],
    );
    assert.equal(Number(charTerminal.rows[0].provider_status), 201);
    assert.equal(Number(charTerminal.rows[0].latency_ms), 17);

    const opaqueFailBegin = await store.beginCharacterStateLifecycle({
      operationId: op.operationId,
      frameId: "frame-1",
      panelIndex: 0,
      providerConfig,
      env: {},
    });
    assert.equal(opaqueFailBegin.ok, true);
    const matteFailed = await store.finalizeCharacterStateLifecycle({
      generationId: opaqueFailBegin.generationId,
      providerResult: {
        ok: true,
        image: { bytes: png },
        metadata: { providerStatus: 200, latencyMs: 9 },
      },
      advanceWithOperationId: op.operationId,
    });
    assert.equal(matteFailed.ok, true);
    assert.equal(matteFailed.status, "failed");
    assert.equal(matteFailed.errorKind, "matte-failed");
    assert.equal(matteFailed.advancedCurrentPointer, false);
    const failedTerminal = await pool.query(
      `SELECT provider_status, latency_ms FROM generation_record WHERE id = $1`,
      [opaqueFailBegin.generationRecordId],
    );
    assert.equal(Number(failedTerminal.rows[0].provider_status), 200);
    assert.equal(Number(failedTerminal.rows[0].latency_ms), 9);
    const head = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(head.panels[0].currentCharacterGenerationId, charBegin.generationId);

    const assembly = await store.evaluateHybridAssembly({ frameId: "frame-1", operationId: op.operationId });
    assert.equal(assembly.ok, true);
    assert.equal(assembly.visualReady, false, "both panels required for assembly readiness");

    const char1 = await store.beginCharacterStateLifecycle({
      operationId: op.operationId,
      frameId: "frame-1",
      panelIndex: 1,
      providerConfig,
      env: {},
    });
    assert.equal(char1.ok, true);
    const char1Ready = await store.finalizeCharacterStateLifecycle({
      generationId: char1.generationId,
      providerResult: {
        ok: true,
        image: { bytes: chromakeySubjectPng() },
        metadata: { providerStatus: 200, latencyMs: 11 },
      },
      advanceWithOperationId: op.operationId,
    });
    assert.equal(char1Ready.ok, true);
    const readyAssembly = await store.evaluateHybridAssembly({
      frameId: "frame-1",
      operationId: op.operationId,
    });
    assert.equal(readyAssembly.visualReady, true);

    const loaded = await store.load();
    assert.equal(loaded.frames[0].visualReady, true);
    assert.equal(loaded.frames[0].hybrid.assemblyStatus, "ready");
    assert.equal(loaded.frames[0].hybrid.background.status, "ready");
    assert.equal(loaded.frames[0].hybrid.panels[0].status, "ready");
    assert.ok(loaded.frames[0].detailedBrief);
    assert.equal(String(loaded.frames[0].detailedBrief).includes("#00FF00"), false);

    // Authoritative background failure clears the scene claim and preserves prior ready pointer.
    const failOp = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(failOp.ok, true);
    const failBegin = await store.beginSceneBackgroundLifecycle({
      operationId: failOp.operationId,
      providerConfig,
      env: {},
      preferReuse: false,
    });
    assert.equal(failBegin.mode, "generate");
    const beforeFailPointer = await store.loadHybridPersistence({ frameId: "frame-1" });
    const previousBg = beforeFailPointer.sceneBackgroundState.currentGenerationId;
    const failFinalize = await store.finalizeSceneBackgroundLifecycle({
      generationId: failBegin.generationId,
      providerResult: { ok: false, kind: "provider", diagnostics: { providerStatus: 500, latencyMs: 3 } },
    });
    assert.equal(failFinalize.ok, true);
    assert.equal(failFinalize.status, "failed");
    assert.equal(failFinalize.clearedSceneClaim, true);
    const afterFail = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(afterFail.sceneBackgroundState.currentGenerationId, previousBg);
    assert.equal(afterFail.sceneBackgroundState.activeOperationId, null);

    // Stale failure must not clear a newer scene claim.
    const newerOp = await store.createFrameOperation({ frameId: "frame-1" });
    const staleOp = await store.createFrameOperation({ frameId: "frame-2" });
    const staleBegin = await store.beginSceneBackgroundLifecycle({
      operationId: staleOp.operationId,
      providerConfig,
      env: {},
      preferReuse: false,
    });
    assert.equal(staleBegin.mode, "generate");
    const newerBegin = await store.beginSceneBackgroundLifecycle({
      operationId: newerOp.operationId,
      providerConfig,
      env: {},
      preferReuse: false,
    });
    assert.equal(newerBegin.mode, "generate");
    const staleFail = await store.finalizeSceneBackgroundLifecycle({
      generationId: staleBegin.generationId,
      providerResult: { ok: false, kind: "provider", diagnostics: { providerStatus: 500, latencyMs: 1 } },
    });
    assert.equal(staleFail.ok, true);
    assert.equal(staleFail.clearedSceneClaim, false);
    const afterStaleFail = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(afterStaleFail.sceneBackgroundState.activeOperationId, newerOp.operationId);
    assert.equal(afterStaleFail.sceneBackgroundState.currentGenerationId, previousBg);

    // Orphan-claim injection: failure before generation insert rolls back the claim.
    const beforeOrphan = await store.loadHybridPersistence({ frameId: "frame-1" });
    const claimBeforeOrphan = beforeOrphan.sceneBackgroundState.activeOperationId;
    const writeBeforeOrphan = beforeOrphan.sceneBackgroundState.writeVersion;
    const orphanOp = await store.createFrameOperation({ frameId: "frame-2" });
    assert.equal(orphanOp.ok, true);
    const orphanBegin = await store.beginSceneBackgroundLifecycle({
      operationId: orphanOp.operationId,
      providerConfig,
      env: {},
      preferReuse: false,
      onBeforeCreateGeneration: async () => {
        const error = new Error("inject-begin-failure");
        error.kind = "database";
        error.httpStatus = 503;
        throw error;
      },
    });
    assert.equal(orphanBegin.ok, false);
    assert.equal(orphanBegin.kind, "database");
    const orphanScene = await store.loadHybridPersistence({ frameId: "frame-2" });
    assert.equal(orphanScene.sceneBackgroundState.activeOperationId, claimBeforeOrphan);
    assert.equal(orphanScene.sceneBackgroundState.writeVersion, writeBeforeOrphan);
    assert.notEqual(orphanScene.sceneBackgroundState.activeOperationId, orphanOp.operationId);
    const orphanRecords = await pool.query(
      `SELECT count(*)::int AS count FROM generation_record
       WHERE operation_id = $1`,
      [orphanOp.operationId],
    );
    assert.equal(orphanRecords.rows[0].count, 0);
    const orphanGens = await pool.query(
      `SELECT count(*)::int AS count FROM scene_background_generation
       WHERE operation_id = $1`,
      [orphanOp.operationId],
    );
    assert.equal(orphanGens.rows[0].count, 0);
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("stale frame operation finalizes own evidence but cannot complete or continue", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T15:00:00Z", splitDialogueFrames());
    const store = createVisualStore(pool);
    await approveStyleAndAnchor(store);
    await store.ensureHybridHeads({ frameId: "frame-1" });
    const providerConfig = { model: "stale-model", timeoutMs: 1000 };

    const opA = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(opA.ok, true);
    let releaseA;
    const gateA = new Promise((resolve) => {
      releaseA = resolve;
    });
    let aCalls = 0;
    const runA = store.orchestrateHybridFrameOperation({
      operationId: opA.operationId,
      providerConfig,
      env: {},
      generateImage: async () => {
        aCalls += 1;
        await gateA;
        return {
          ok: true,
          image: { bytes: aCalls === 1 ? png : chromakeySubjectPng() },
          metadata: { providerStatus: 200, latencyMs: 5 },
        };
      },
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (aCalls >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(aCalls, 1, "operation A enters the first provider call");

    const opB = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(opB.ok, true);
    assert.notEqual(opB.operationId, opA.operationId);
    const hybridAfterB = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(hybridAfterB.frameHybridState.activeOperationId, opB.operationId);

    releaseA();
    const resultA = await runA;
    assert.equal(resultA.ok, false);
    assert.equal(resultA.kind, "conflict");
    assert.equal(aCalls, 1, "stale operation A must not start remaining provider calls");

    const opARow = await pool.query(`SELECT status, phase, error_kind FROM visual_frame_operation WHERE id = $1`, [opA.operationId]);
    assert.equal(opARow.rows[0].status, "failed");
    assert.equal(opARow.rows[0].phase, "failed");
    assert.equal(opARow.rows[0].error_kind, "conflict");

    const aRecords = await pool.query(
      `SELECT status FROM generation_record WHERE operation_id = $1 ORDER BY created_at`,
      [opA.operationId],
    );
    assert.ok(aRecords.rowCount >= 1);
    assert.equal(aRecords.rows[0].status, "ready");

    const persistence = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(persistence.frameHybridState.activeOperationId, opB.operationId);
    assert.equal(
      persistence.sceneBackgroundState.currentGenerationId == null
        || persistence.sceneBackgroundState.activeOperationId == null
        || persistence.sceneBackgroundState.activeOperationId === opB.operationId,
      true,
    );

    // Stale evaluate must not mutate assembly status.
    await pool.query(`
      UPDATE frame_hybrid_state
      SET assembly_status = 'not-ready'
      WHERE storyboard_version_id = $1 AND frame_id = 'frame-1'
    `, [persistence.storyboardVersionId]);
    const staleEval = await store.evaluateHybridAssembly({
      frameId: "frame-1",
      operationId: opA.operationId,
    });
    assert.equal(staleEval.ok, false);
    assert.equal(staleEval.kind, "conflict");
    const assemblyAfter = await pool.query(`
      SELECT assembly_status FROM frame_hybrid_state
      WHERE storyboard_version_id = $1 AND frame_id = 'frame-1'
    `, [persistence.storyboardVersionId]);
    assert.equal(assemblyAfter.rows[0].assembly_status, "not-ready");

    // Operation B remains authoritative and can proceed independently.
    const resultB = await store.orchestrateHybridFrameOperation({
      operationId: opB.operationId,
      providerConfig,
      env: {},
      generateImage: async ({ aspectRatio }) => ({
        ok: true,
        image: { bytes: aspectRatio === "21:9" ? png : chromakeySubjectPng() },
        metadata: { providerStatus: 200, latencyMs: 8 },
      }),
    });
    assert.equal(resultB.ok, true);
    assert.equal(resultB.visualReady, true);
    const loaded = await store.load();
    assert.equal(loaded.frames[0].visualReady, true);
    assert.equal(loaded.frames[0].hybrid.assemblyStatus, "ready");
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("background pre-provider stale race finalizes begun generation as failed/conflict", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T16:00:00Z", splitDialogueFrames());
    const store = createVisualStore(pool);
    await approveStyleAndAnchor(store);
    await store.ensureHybridHeads({ frameId: "frame-1" });
    const providerConfig = { model: "bg-stale-model", timeoutMs: 1111 };
    const beforePointer = await store.loadHybridPersistence({ frameId: "frame-1" });
    const previousBg = beforePointer.sceneBackgroundState.currentGenerationId;

    const opA = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(opA.ok, true);
    let aCalls = 0;
    let opBId = null;
    let aGenerationId = null;
    let aRecordId = null;

    const resultA = await store.orchestrateHybridFrameOperation({
      operationId: opA.operationId,
      providerConfig,
      env: { IMAGE_MODEL: "env-should-not-win", IMAGE_TIMEOUT_MS: "999999" },
      onAfterBackgroundBegin: async (begun) => {
        aGenerationId = begun.generationId;
        aRecordId = begun.generationRecordId;
        const opB = await store.createFrameOperation({ frameId: "frame-1" });
        assert.equal(opB.ok, true);
        opBId = opB.operationId;
        const bBegin = await store.beginSceneBackgroundLifecycle({
          operationId: opB.operationId,
          providerConfig: { model: "b-model", timeoutMs: 2222 },
          env: {},
          preferReuse: false,
        });
        assert.equal(bBegin.ok, true);
        assert.equal(bBegin.mode, "generate");
      },
      generateImage: async () => {
        aCalls += 1;
        return { ok: true, image: { bytes: png }, metadata: { providerStatus: 200, latencyMs: 1 } };
      },
    });

    assert.equal(resultA.ok, false);
    assert.equal(resultA.kind, "conflict");
    assert.equal(aCalls, 0, "stale operation A must make zero provider calls");
    assert.ok(aGenerationId);
    assert.ok(aRecordId);
    assert.ok(opBId);

    const gen = await pool.query(
      `SELECT status, error_kind FROM scene_background_generation WHERE id = $1`,
      [aGenerationId],
    );
    assert.equal(gen.rows[0].status, "failed");
    assert.equal(gen.rows[0].error_kind, "conflict");
    const record = await pool.query(
      `SELECT status, error_kind FROM generation_record WHERE id = $1`,
      [aRecordId],
    );
    assert.equal(record.rows[0].status, "failed");
    assert.equal(record.rows[0].error_kind, "conflict");

    const opARow = await pool.query(
      `SELECT status, phase, error_kind FROM visual_frame_operation WHERE id = $1`,
      [opA.operationId],
    );
    assert.equal(opARow.rows[0].status, "failed");
    assert.equal(opARow.rows[0].phase, "failed");
    assert.equal(opARow.rows[0].error_kind, "conflict");

    const persistence = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(persistence.sceneBackgroundState.currentGenerationId, previousBg);
    assert.equal(persistence.sceneBackgroundState.activeOperationId, opBId);
    assert.equal(persistence.frameHybridState.activeOperationId, opBId);

    const pending = await pool.query(`
      SELECT count(*)::int AS count FROM (
        SELECT id FROM scene_background_generation
         WHERE status = 'pending' AND operation_id = $1
        UNION ALL
        SELECT id FROM character_visual_state_generation
         WHERE status = 'pending' AND operation_id = $1
        UNION ALL
        SELECT id FROM generation_record
         WHERE status = 'pending' AND operation_id = $1
      ) pending_rows
    `, [opA.operationId]);
    assert.equal(pending.rows[0].count, 0, "A leaves no pending generation or provenance rows");
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("character pre-provider stale race finalizes begun generation as failed/conflict", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T16:30:00Z", splitDialogueFrames());
    const store = createVisualStore(pool);
    await approveStyleAndAnchor(store);
    await store.ensureHybridHeads({ frameId: "frame-1" });
    const providerConfig = { model: "char-stale-model", timeoutMs: 3333 };

    // Seed a ready background so orchestration reuses it and reaches character begin.
    const setupOp = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(setupOp.ok, true);
    const setupBg = await store.beginSceneBackgroundLifecycle({
      operationId: setupOp.operationId,
      providerConfig,
      env: {},
    });
    assert.equal(setupBg.mode, "generate");
    const setupReady = await store.finalizeSceneBackgroundLifecycle({
      generationId: setupBg.generationId,
      providerResult: {
        ok: true,
        image: { bytes: png },
        metadata: { providerStatus: 200, latencyMs: 2 },
      },
    });
    assert.equal(setupReady.ok, true);
    assert.equal(setupReady.advancedCurrentPointer, true);

    const beforeHead = await store.loadHybridPersistence({ frameId: "frame-1" });
    const previousCharHead = beforeHead.panels[0].currentCharacterGenerationId;
    const assetCountBefore = await pool.query(`SELECT count(*)::int AS count FROM visual_asset`);

    const opA = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(opA.ok, true);
    let aCalls = 0;
    let begunPanels = [];
    let aGenerationId = null;
    let aRecordId = null;

    const resultA = await store.orchestrateHybridFrameOperation({
      operationId: opA.operationId,
      providerConfig,
      env: {},
      onAfterCharacterBegin: async (started) => {
        begunPanels.push(started.panelIndex);
        aGenerationId = started.generationId;
        aRecordId = started.generationRecordId;
        const opB = await store.createFrameOperation({ frameId: "frame-1" });
        assert.equal(opB.ok, true);
      },
      generateImage: async () => {
        aCalls += 1;
        return {
          ok: true,
          image: { bytes: chromakeySubjectPng() },
          metadata: { providerStatus: 200, latencyMs: 1 },
        };
      },
    });

    assert.equal(resultA.ok, false);
    assert.equal(resultA.kind, "conflict");
    assert.equal(aCalls, 0, "stale operation A must make zero provider calls");
    assert.deepEqual(begunPanels, [0], "no later panel generation begins");
    assert.ok(aGenerationId);
    assert.ok(aRecordId);

    const gen = await pool.query(
      `SELECT status, error_kind, raw_asset_id, output_asset_id
       FROM character_visual_state_generation WHERE id = $1`,
      [aGenerationId],
    );
    assert.equal(gen.rows[0].status, "failed");
    assert.equal(gen.rows[0].error_kind, "conflict");
    assert.equal(gen.rows[0].raw_asset_id, null);
    assert.equal(gen.rows[0].output_asset_id, null);
    const record = await pool.query(
      `SELECT status, error_kind FROM generation_record WHERE id = $1`,
      [aRecordId],
    );
    assert.equal(record.rows[0].status, "failed");
    assert.equal(record.rows[0].error_kind, "conflict");

    const assetCountAfter = await pool.query(`SELECT count(*)::int AS count FROM visual_asset`);
    assert.equal(assetCountAfter.rows[0].count, assetCountBefore.rows[0].count);

    const afterHead = await store.loadHybridPersistence({ frameId: "frame-1" });
    assert.equal(afterHead.panels[0].currentCharacterGenerationId, previousCharHead);

    const opARow = await pool.query(
      `SELECT status, error_kind FROM visual_frame_operation WHERE id = $1`,
      [opA.operationId],
    );
    assert.equal(opARow.rows[0].status, "failed");
    assert.equal(opARow.rows[0].error_kind, "conflict");

    const pending = await pool.query(`
      SELECT count(*)::int AS count FROM (
        SELECT id FROM character_visual_state_generation
         WHERE status = 'pending' AND operation_id = $1
        UNION ALL
        SELECT id FROM generation_record
         WHERE status = 'pending' AND operation_id = $1
      ) pending_rows
    `, [opA.operationId]);
    assert.equal(pending.rows[0].count, 0, "A leaves no pending character generation or provenance");
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("persisted provider settings exactly control the actual provider request", {
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
    await insertResult(pool, ids.resultA, "2026-10-09T17:00:00Z", splitDialogueFrames());
    const store = createVisualStore(pool);
    await approveStyleAndAnchor(store);
    await store.ensureHybridHeads({ frameId: "frame-1" });

    const providerConfig = { model: "persisted-model-v1", timeoutMs: 45678 };
    const mutableEnv = {
      IMAGE_MODEL: "persisted-model-v1",
      IMAGE_TIMEOUT_MS: "45678",
      CONTEST_API_TOKEN: "secret-token-must-not-persist",
      BASE_URL: "https://provider.example/v1",
    };
    const op = await store.createFrameOperation({ frameId: "frame-1" });
    assert.equal(op.ok, true);

    const invocations = [];
    let backgroundRecordId = null;
    let characterRecordId = null;

    const result = await store.orchestrateHybridFrameOperation({
      operationId: op.operationId,
      providerConfig,
      env: mutableEnv,
      onAfterBackgroundBegin: async (begun) => {
        backgroundRecordId = begun.generationRecordId;
        mutableEnv.IMAGE_MODEL = "mutated-after-begin";
        mutableEnv.IMAGE_TIMEOUT_MS = "1";
      },
      onAfterCharacterBegin: async (begun) => {
        if (begun.panelIndex === 0) characterRecordId = begun.generationRecordId;
        mutableEnv.IMAGE_MODEL = "mutated-after-character-begin";
        mutableEnv.IMAGE_TIMEOUT_MS = "2";
      },
      generateImage: async (args) => {
        invocations.push({
          model: args.model,
          timeoutMs: args.timeoutMs,
          aspectRatio: args.aspectRatio,
          component: args.component,
          panelIndex: args.panelIndex,
        });
        return {
          ok: true,
          image: { bytes: args.component === "scene-background" ? png : chromakeySubjectPng() },
          metadata: { providerStatus: 200, latencyMs: 4 },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(invocations.length, 3);

    const bgRecord = await pool.query(
      `SELECT model, generation_settings_json FROM generation_record WHERE id = $1`,
      [backgroundRecordId],
    );
    assert.equal(bgRecord.rows[0].model, "persisted-model-v1");
    assert.equal(bgRecord.rows[0].generation_settings_json.timeoutMs, 45678);
    assert.equal(bgRecord.rows[0].generation_settings_json.aspectRatio, "21:9");
    assert.equal(bgRecord.rows[0].generation_settings_json.component, "scene-background");
    assert.equal(bgRecord.rows[0].generation_settings_json.panelIndex, undefined);
    const bgSettingsText = JSON.stringify(bgRecord.rows[0].generation_settings_json);
    assert.equal(bgSettingsText.includes("secret"), false);
    assert.equal(bgSettingsText.includes("https://"), false);
    assert.equal(bgSettingsText.includes("provider.example"), false);

    assert.deepEqual(invocations[0], {
      model: "persisted-model-v1",
      timeoutMs: 45678,
      aspectRatio: "21:9",
      component: "scene-background",
      panelIndex: undefined,
    });

    const charRecord = await pool.query(
      `SELECT model, generation_settings_json FROM generation_record WHERE id = $1`,
      [characterRecordId],
    );
    assert.equal(charRecord.rows[0].model, "persisted-model-v1");
    assert.equal(charRecord.rows[0].generation_settings_json.timeoutMs, 45678);
    assert.equal(charRecord.rows[0].generation_settings_json.aspectRatio, "4:5");
    assert.equal(charRecord.rows[0].generation_settings_json.component, "character-state");
    assert.equal(charRecord.rows[0].generation_settings_json.panelIndex, 0);
    const charSettingsText = JSON.stringify(charRecord.rows[0].generation_settings_json);
    assert.equal(charSettingsText.includes("secret"), false);
    assert.equal(charSettingsText.includes("https://"), false);

    assert.deepEqual(invocations[1], {
      model: "persisted-model-v1",
      timeoutMs: 45678,
      aspectRatio: "4:5",
      component: "character-state",
      panelIndex: 0,
    });
    assert.deepEqual(invocations[2], {
      model: "persisted-model-v1",
      timeoutMs: 45678,
      aspectRatio: "4:5",
      component: "character-state",
      panelIndex: 1,
    });
    assert.equal(
      invocations.every((call) => call.model === "persisted-model-v1" && call.timeoutMs === 45678),
      true,
      "env mutation after begin must not alter model or timeout",
    );
    assert.equal(
      invocations.filter((call) => call.component === "scene-background").every((call) => call.panelIndex === undefined),
      true,
    );
    assert.equal(
      invocations.filter((call) => call.component === "character-state").every((call) => Number.isInteger(call.panelIndex)),
      true,
    );
  } finally {
    await reset(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
