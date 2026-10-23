import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { decodeImage } from "../../foreground/decode.mjs";
import { extractForeground } from "../../foreground/extract.mjs";
import { MATTE_CONTRACT_SHA256, MATTE_CONTRACT_VERSION } from "../../foreground/contract.mjs";
import { backfillPanelForeground } from "../../backfill-panel-foreground.mjs";
import { duplicateProject } from "../../project-catalog.mjs";
import { enterProject } from "../../project-scope.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const FIXTURE_PROJECT_ID = "02000000-0000-4000-8000-0000000000a1";
const SENTINEL_PROJECT_ID = "02000000-0000-4000-8000-0000000000a2";
const OTHER_PROJECT_ID = "02000000-0000-4000-8000-0000000000a3";
const OWNED = [FIXTURE_PROJECT_ID, SENTINEL_PROJECT_ID, OTHER_PROJECT_ID];
const SENTINEL_TEXT = "020-sentinel-draft";
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);

const ids = {
  source: "02000000-0000-4000-8000-000000000001",
  reading: "02000000-0000-4000-8000-000000000002",
  interpretation: "02000000-0000-4000-8000-000000000003",
  material: "02000000-0000-4000-8000-000000000004",
  character: "02000000-0000-4000-8000-000000000005",
  result: "02000000-0000-4000-8000-000000000006",
  sentinelAsset: "02000000-0000-4000-8000-0000000000b1",
  otherAsset: "02000000-0000-4000-8000-0000000000b2",
};

const MATTE = [90, 110, 134];
const BLACK = [0, 0, 0];
const SKIN = [214, 156, 122];

function blank(width, height, color) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
  }
  return { width, height, channels: 3, data };
}

function paint(image, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = (y * image.width + x) * image.channels;
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
    }
  }
}

function portrait() {
  const image = blank(96, 120, MATTE);
  paint(image, 16, 70, 80, 108, BLACK);
  paint(image, 19, 73, 77, 105, SKIN);
  paint(image, 34, 18, 62, 74, BLACK);
  paint(image, 37, 21, 59, 71, SKIN);
  return image;
}

function jacket() {
  const matte = [94, 110, 133];
  const cloth = [63, 84, 105];
  const shirt = [210, 214, 220];
  const image = blank(200, 240, matte);
  paint(image, 50, 24, 130, 100, BLACK);
  paint(image, 54, 28, 126, 96, SKIN);
  paint(image, 40, 130, 199, 239, cloth);
  paint(image, 40, 130, 199, 133, BLACK);
  paint(image, 40, 130, 43, 239, BLACK);
  paint(image, 70, 160, 120, 210, BLACK);
  paint(image, 74, 164, 116, 206, shirt);
  return image;
}

async function pngOf(image) {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 3 },
  }).png().toBuffer();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function dataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function assertOk(result, label) {
  assert.equal(result?.ok, true, `${label}: ${result?.kind || result?.status || "failed"}`);
}

function frames() {
  return [{
    id: "frame-gen",
    layout: "split2",
    origin: "source",
    dialogue: "",
    panels: [
      { id: "p0", description: "Персонаж смотрит спокойно" },
      { id: "p1", description: "Персонаж слушает" },
    ],
  }, {
    id: "frame-up",
    layout: "split2",
    origin: "source",
    dialogue: "",
    panels: [
      { id: "u0", description: "Персонаж слева" },
      { id: "u1", description: "Персонаж справа" },
    ],
  }, {
    id: "frame-ex",
    layout: "single",
    origin: "source",
    dialogue: "",
    panels: [{ id: "e0", description: "Персонаж крупно" }],
  }];
}

async function removeOwned(pool, extraIds = []) {
  const projectIds = [...new Set([...OWNED, ...extraIds])];
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = NULL,
        active_material_state_id = NULL,
        current_reading_id = NULL
    WHERE id = ANY($1::uuid[])
  `, [projectIds]);
  const revisions = await pool.query(
    "SELECT id FROM source_revision WHERE project_id = ANY($1::uuid[])",
    [projectIds],
  );
  const revisionIds = revisions.rows.map((row) => row.id);
  const materials = revisionIds.length === 0
    ? { rows: [] }
    : await pool.query(
      "SELECT id FROM material_state WHERE source_revision_id = ANY($1::uuid[])",
      [revisionIds],
    );
  const materialIds = materials.rows.map((row) => row.id);
  const results = materialIds.length === 0
    ? { rows: [] }
    : await pool.query(
      "SELECT id FROM storyboard_result WHERE material_state_id = ANY($1::uuid[])",
      [materialIds],
    );
  const resultIds = results.rows.map((row) => row.id);
  const versions = resultIds.length === 0
    ? { rows: [] }
    : await pool.query(
      "SELECT id FROM storyboard_version WHERE storyboard_result_id = ANY($1::uuid[])",
      [resultIds],
    );
  const versionIds = versions.rows.map((row) => row.id);
  if (versionIds.length > 0) {
    await pool.query("DELETE FROM visual_approval WHERE storyboard_version_id = ANY($1::uuid[])", [versionIds]);
    await pool.query(`
      UPDATE panel_visual_state SET current_generation_id = NULL
      WHERE storyboard_version_id = ANY($1::uuid[])
    `, [versionIds]);
    await pool.query(`
      DELETE FROM panel_generation
      WHERE panel_visual_state_id IN (
        SELECT id FROM panel_visual_state WHERE storyboard_version_id = ANY($1::uuid[])
      )
    `, [versionIds]);
    await pool.query("DELETE FROM panel_visual_state WHERE storyboard_version_id = ANY($1::uuid[])", [versionIds]);
  }
  if (resultIds.length > 0) {
    await pool.query("DELETE FROM storyboard_reusable_asset WHERE storyboard_result_id = ANY($1::uuid[])", [resultIds]);
    await pool.query("DELETE FROM storyboard_head WHERE storyboard_result_id = ANY($1::uuid[])", [resultIds]);
    await pool.query(`
      UPDATE storyboard_version SET parent_storyboard_version_id = NULL
      WHERE storyboard_result_id = ANY($1::uuid[])
    `, [resultIds]);
    await pool.query("DELETE FROM storyboard_version WHERE storyboard_result_id = ANY($1::uuid[])", [resultIds]);
    await pool.query("DELETE FROM storyboard_result WHERE id = ANY($1::uuid[])", [resultIds]);
  }
  if (materialIds.length > 0) {
    await pool.query("DELETE FROM character_anchor_head WHERE material_state_id = ANY($1::uuid[])", [materialIds]);
    await pool.query(`
      UPDATE character_anchor_version SET parent_anchor_version_id = NULL
      WHERE material_state_id = ANY($1::uuid[])
    `, [materialIds]);
    await pool.query("DELETE FROM project_style_seed WHERE material_state_id = ANY($1::uuid[])", [materialIds]);
    await pool.query("DELETE FROM character_anchor_version WHERE material_state_id = ANY($1::uuid[])", [materialIds]);
    await pool.query("DELETE FROM character_identity WHERE material_state_id = ANY($1::uuid[])", [materialIds]);
    await pool.query("DELETE FROM canonical_character WHERE material_state_id = ANY($1::uuid[])", [materialIds]);
    await pool.query(`
      UPDATE material_state SET parent_material_state_id = NULL
      WHERE id = ANY($1::uuid[])
    `, [materialIds]);
    await pool.query("DELETE FROM material_state WHERE id = ANY($1::uuid[])", [materialIds]);
  }
  if (revisionIds.length > 0) {
    await pool.query("DELETE FROM interpretation WHERE source_revision_id = ANY($1::uuid[])", [revisionIds]);
    await pool.query(`
      UPDATE source_revision SET parent_source_revision_id = NULL
      WHERE id = ANY($1::uuid[])
    `, [revisionIds]);
    await pool.query("DELETE FROM source_revision WHERE id = ANY($1::uuid[])", [revisionIds]);
  }
  await pool.query("DELETE FROM panel_foreground_extraction WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM reading WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM visual_asset WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM research_event WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM character_exclusion WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [projectIds]);
}

async function seed(pool) {
  await pool.query("INSERT INTO project (id, title) VALUES ($1, $2)", [FIXTURE_PROJECT_ID, "020 foreground fixture"]);
  await pool.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, $2, $3)",
    [FIXTURE_PROJECT_ID, "fixture", randomUUID()],
  );
  await pool.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'исходный текст')",
    [ids.source, FIXTURE_PROJECT_ID],
  );
  await pool.query(`
    INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
    VALUES ($1, $2, 'исходный текст', $3, 'ready')
  `, [ids.reading, FIXTURE_PROJECT_ID, randomUUID()]);
  await pool.query(
    "INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)",
    [ids.interpretation, ids.source, ids.reading],
  );
  await pool.query(
    "INSERT INTO material_state (id, source_revision_id, interpretation_id) VALUES ($1, $2, $3)",
    [ids.material, ids.source, ids.interpretation],
  );
  await pool.query(`
    INSERT INTO canonical_character (id, material_state_id, ordinal, name)
    VALUES ($1, $2, 0, 'Персонаж')
  `, [ids.character, ids.material]);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = $1, active_material_state_id = $2
    WHERE id = $3
  `, [ids.source, ids.material, FIXTURE_PROJECT_ID]);
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
    VALUES ($1, $2, 'checked', $3::jsonb)
  `, [ids.result, ids.material, JSON.stringify({ frames: frames() })]);
  await pool.query(
    "INSERT INTO project (id, title) VALUES ($1, '020 sentinel')",
    [SENTINEL_PROJECT_ID],
  );
  await pool.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, $2, $3)",
    [SENTINEL_PROJECT_ID, SENTINEL_TEXT, randomUUID()],
  );
  await pool.query(`
    INSERT INTO visual_asset (
      id, project_id, kind, mime, width, height, byte_length, sha256, bytes
    ) VALUES ($1, $2, 'panel-image', 'image/png', 1, 1, $3, $4, $5)
  `, [ids.sentinelAsset, SENTINEL_PROJECT_ID, tinyPng.length, sha256(tinyPng), tinyPng]);
  await pool.query(
    "INSERT INTO project (id, title) VALUES ($1, '020 other')",
    [OTHER_PROJECT_ID],
  );
  await pool.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, 'other', $2)",
    [OTHER_PROJECT_ID, randomUUID()],
  );
  await pool.query(`
    INSERT INTO visual_asset (
      id, project_id, kind, mime, width, height, byte_length, sha256, bytes
    ) VALUES ($1, $2, 'uploaded-image', 'image/png', 1, 1, $3, $4, $5)
  `, [ids.otherAsset, OTHER_PROJECT_ID, tinyPng.length, sha256(tinyPng), tinyPng]);
}

async function versionCount(pool) {
  const result = await pool.query(`
    SELECT count(*)::int AS count
    FROM storyboard_version
    JOIN storyboard_result ON storyboard_result.id = storyboard_version.storyboard_result_id
    JOIN material_state ON material_state.id = storyboard_result.material_state_id
    JOIN source_revision ON source_revision.id = material_state.source_revision_id
    WHERE source_revision.project_id = $1
  `, [FIXTURE_PROJECT_ID]);
  return result.rows[0].count;
}

async function assetCount(pool, projectId = FIXTURE_PROJECT_ID) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM visual_asset WHERE project_id = $1",
    [projectId],
  );
  return result.rows[0].count;
}

async function extractionCount(pool, projectId = FIXTURE_PROJECT_ID) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM panel_foreground_extraction WHERE project_id = $1",
    [projectId],
  );
  return result.rows[0].count;
}

async function extractionFor(pool, assetId) {
  const result = await pool.query(
    "SELECT * FROM panel_foreground_extraction WHERE source_asset_id = $1",
    [assetId],
  );
  return result.rows[0] ?? null;
}

test("panel foreground storage, reuse, backfill, and migration stay isolated", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
  timeout: 120000,
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const created = [];
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const migration = await pool.query(
      "SELECT id FROM schema_migration WHERE id = '017_panel_foreground'",
    );
    assert.equal(migration.rowCount, 1);
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'visual_asset' AND column_name IN ('bytes', 'sha256', 'kind')
    `);
    assert.equal(columns.rowCount, 3);
    await removeOwned(pool);
    await seed(pool);
    const sentinelBefore = await pool.query(
      "SELECT bytes, sha256, kind FROM visual_asset WHERE id = $1",
      [ids.sentinelAsset],
    );
    assert.equal(sentinelBefore.rows[0].kind, "panel-image");
    assert.equal(sentinelBefore.rows[0].sha256, sha256(tinyPng));

    enterProject(FIXTURE_PROJECT_ID);
    const store = createVisualStore(pool);
    const initial = await store.load();
    assert.equal(initial.frames[0].panels[0].extraction, null);
    const versionsBefore = await versionCount(pool);
    const identity = await store.saveIdentity({
      characterName: "Персонаж",
      image: { bytes: tinyPng },
      comment: "keep the face",
    });
    assertOk(identity, "identity");
    const pendingAnchor = await store.beginAnchor({ characterName: "Персонаж", instruction: "contour" });
    assertOk(pendingAnchor, "begin-anchor");
    const finishedAnchor = await store.finishAnchor({
      id: pendingAnchor.id,
      result: { ok: true, image: { bytes: tinyPng }, metadata: { test: true } },
    });
    assertOk(finishedAnchor, "finish-anchor");
    assertOk(await store.approveAnchor({
      characterName: "Персонаж",
      anchorId: pendingAnchor.id,
    }), "approve-anchor");

    const passPng = await pngOf(portrait());
    const passPending = await store.beginPanelGeneration({
      frameId: "frame-gen",
      panelIndex: 0,
      instruction: "",
    });
    assertOk(passPending, "begin-pass");
    const passFinished = await store.finishPanelGeneration({
      id: passPending.id,
      result: { ok: true, image: { bytes: passPng }, metadata: { test: true } },
      provenance: {
        origin: "generation",
        subject: "Персонаж",
        matteContractVersion: MATTE_CONTRACT_VERSION,
        matteContractSha256: MATTE_CONTRACT_SHA256,
      },
    });
    assertOk(passFinished, "finish-pass");
    assert.equal(await versionCount(pool), versionsBefore + 1);
    const passRow = await extractionFor(pool, passFinished.assetId);
    assert.equal(passRow.status, "candidate-pass");
    assert.equal(passRow.extractor_version, "a1-known-matte-v2");
    assert.equal(passRow.contract_version, MATTE_CONTRACT_VERSION);
    assert.equal(typeof passRow.foreground_asset_id, "string");
    const original = await pool.query(
      "SELECT bytes, sha256, kind, provenance FROM visual_asset WHERE id = $1",
      [passFinished.assetId],
    );
    assert.equal(original.rows[0].kind, "panel-image");
    assert.equal(original.rows[0].sha256, sha256(passPng));
    assert.ok(Buffer.from(original.rows[0].bytes).equals(passPng));
    assert.equal(original.rows[0].provenance.matteContractVersion, MATTE_CONTRACT_VERSION);
    assert.equal(original.rows[0].provenance.matteContractSha256, MATTE_CONTRACT_SHA256);
    const foreground = await pool.query(
      "SELECT bytes, kind FROM visual_asset WHERE id = $1",
      [passRow.foreground_asset_id],
    );
    assert.equal(foreground.rows[0].kind, "panel-foreground");
    const decodedForeground = await decodeImage(foreground.rows[0].bytes);
    const extracted = extractForeground(await decodeImage(passPng));
    assert.equal(extracted.status, "candidate-pass");
    assert.ok(Buffer.from(decodedForeground.data).equals(extracted.rgba));
    const shown = (await store.load()).frames.find((frame) => frame.id === "frame-gen").panels[0];
    assert.equal(shown.assetId, passFinished.assetId);
    assert.equal(shown.drawAssetId, passRow.foreground_asset_id);
    assert.equal(shown.extraction.usesForeground, true);
    assert.equal(shown.extraction.status, "candidate-pass");
    assert.equal(shown.backgroundColor, "#5d6e86");

    const providerPending = await store.beginPanelGeneration({
      frameId: "frame-gen",
      panelIndex: 0,
      instruction: "снова",
    });
    assertOk(providerPending, "provider-basis");
    assert.equal(providerPending.refs.previous.id, passFinished.assetId);
    assert.equal(providerPending.refs.previous.kind, "panel-image");
    assert.ok(Buffer.from(providerPending.refs.previous.bytes).equals(passPng));
    assert.notEqual(providerPending.refs.previous.id, passRow.foreground_asset_id);
    if (providerPending.refs.anchor) {
      assert.equal(providerPending.refs.anchor.kind, "base-anchor");
      assert.ok(Buffer.from(providerPending.refs.anchor.bytes).equals(tinyPng));
    }

    const reviewPng = await pngOf(jacket());
    const reviewExpected = extractForeground(await decodeImage(reviewPng));
    assert.notEqual(reviewExpected.status, "candidate-pass");
    const beforeReview = await versionCount(pool);
    const reviewPending = await store.beginPanelGeneration({
      frameId: "frame-gen",
      panelIndex: 1,
      instruction: "",
    });
    assertOk(reviewPending, "begin-review");
    const reviewFinished = await store.finishPanelGeneration({
      id: reviewPending.id,
      result: { ok: true, image: { bytes: reviewPng }, metadata: { test: true } },
      provenance: { origin: "generation", subject: "Персонаж", matteContractVersion: MATTE_CONTRACT_VERSION },
    });
    assertOk(reviewFinished, "finish-review");
    assert.equal(await versionCount(pool), beforeReview + 1);
    const reviewRow = await extractionFor(pool, reviewFinished.assetId);
    assert.equal(reviewRow.status, reviewExpected.status);
    assert.equal(reviewRow.foreground_asset_id, null);
    const reviewShown = (await store.load()).frames.find((frame) => frame.id === "frame-gen").panels[1];
    assert.equal(reviewShown.assetId, reviewFinished.assetId);
    assert.equal(reviewShown.drawAssetId, reviewFinished.assetId);
    assert.equal(reviewShown.extraction.usesForeground, false);

    const rejectPng = await pngOf(blank(8, 8, MATTE));
    const uploadedReject = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: dataUrl(rejectPng),
      targets: [{ panelId: "u1" }],
    });
    assertOk(uploadedReject, "upload-reject");
    const rejectPanel = (await store.load()).frames.find((frame) => frame.id === "frame-up").panels[1];
    const rejectRow = await extractionFor(pool, rejectPanel.assetId);
    assert.equal(rejectRow.status, "reject");
    assert.equal(rejectRow.foreground_asset_id, null);
    assert.equal(rejectPanel.extraction.usesForeground, false);
    assert.equal(rejectPanel.drawAssetId, rejectPanel.assetId);

    const variant = portrait();
    paint(variant, 40, 40, 44, 44, [180, 120, 90]);
    const uploadPassPng = await pngOf(variant);
    const assetsBeforeUpload = await assetCount(pool);
    const uploadedPass = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: dataUrl(uploadPassPng),
      targets: [{ panelId: "u0" }],
    });
    assertOk(uploadedPass, "upload-pass");
    const passUpload = (await store.load()).frames.find((frame) => frame.id === "frame-up").panels[0];
    const uploadRow = await extractionFor(pool, passUpload.assetId);
    assert.equal(uploadRow.status, "candidate-pass");
    assert.equal(passUpload.drawAssetId, uploadRow.foreground_asset_id);
    assert.notEqual(passUpload.assetId, passFinished.assetId);

    const beforeException = await versionCount(pool);
    const exceptionPending = await store.beginPanelGeneration({
      frameId: "frame-ex",
      panelIndex: 0,
      instruction: "",
    });
    assertOk(exceptionPending, "begin-exception");
    const exceptionFinished = await store.finishPanelGeneration({
      id: exceptionPending.id,
      result: { ok: true, image: { bytes: passPng }, metadata: { test: true } },
      provenance: { origin: "generation", subject: "Персонаж" },
      runExtraction: async () => {
        throw new Error("extract-boom");
      },
    });
    assertOk(exceptionFinished, "finish-exception");
    assert.equal(await versionCount(pool), beforeException + 1);
    const failedRow = await extractionFor(pool, exceptionFinished.assetId);
    assert.equal(failedRow.status, "failed");
    assert.equal(failedRow.foreground_asset_id, null);
    assert.equal(failedRow.findings[0].code, "extraction-exception");
    const kept = await pool.query("SELECT sha256 FROM visual_asset WHERE id = $1", [exceptionFinished.assetId]);
    assert.equal(kept.rows[0].sha256, sha256(passPng));
    assertOk(await store.undoStoryboardEdit(), "undo-exception");
    const undone = (await store.load()).frames.find((frame) => frame.id === "frame-ex").panels[0];
    assert.equal(undone.assetId, null);
    assert.equal((await extractionFor(pool, exceptionFinished.assetId)).status, "failed");
    const stillPass = (await store.load()).frames.find((frame) => frame.id === "frame-gen").panels[0];
    assert.equal(stillPass.drawAssetId, passRow.foreground_asset_id);

    const assetsBeforeReuse = await assetCount(pool);
    const extractionsBeforeReuse = await extractionCount(pool);
    assertOk(await store.applyOperation({
      op: "assignAsset",
      assetId: passFinished.assetId,
      targets: [{ panelId: "u1" }],
    }), "assign");
    assert.equal(await assetCount(pool), assetsBeforeReuse);
    assert.equal(await extractionCount(pool), extractionsBeforeReuse);
    const reused = (await store.load()).frames.find((frame) => frame.id === "frame-up").panels[1];
    assert.equal(reused.assetId, passFinished.assetId);
    assert.equal(reused.drawAssetId, passRow.foreground_asset_id);

    const assetsBeforeCopy = await assetCount(pool);
    const extractionsBeforeCopy = await extractionCount(pool);
    assertOk(await store.applyOperation({
      op: "duplicateFrame",
      structureFrameId: "frame-gen",
    }), "duplicate-frame");
    assert.equal(await assetCount(pool), assetsBeforeCopy);
    assert.equal(await extractionCount(pool), extractionsBeforeCopy);
    const afterDuplicate = await store.load();
    const copy = afterDuplicate.frames.find((frame) => frame.id !== "frame-gen" && frame.panels.some((panel) => panel.assetId === passFinished.assetId) && frame.id !== "frame-up");
    assert.ok(copy, "duplicated frame");
    assert.equal(copy.panels[0].drawAssetId, passRow.foreground_asset_id);
    assert.equal(copy.panels[0].assetId, passFinished.assetId);

    const loadsBefore = await extractionCount(pool);
    await store.load();
    await store.load();
    assert.equal(await extractionCount(pool), loadsBefore);
    assert.equal(await extractionCount(pool, SENTINEL_PROJECT_ID), 0);

    const dry = await backfillPanelForeground(pool, { projectId: SENTINEL_PROJECT_ID, apply: false });
    assert.equal(dry.pending, 1);
    assert.equal(dry.written, 0);
    assert.equal(await extractionCount(pool, SENTINEL_PROJECT_ID), 0);
    assert.equal(await extractionCount(pool, OTHER_PROJECT_ID), 0);
    const applied = await backfillPanelForeground(pool, { projectId: SENTINEL_PROJECT_ID, apply: true });
    assert.equal(applied.written, 1);
    assert.equal(await extractionCount(pool, SENTINEL_PROJECT_ID), 1);
    assert.equal(await extractionCount(pool, OTHER_PROJECT_ID), 0);
    assert.equal(await extractionCount(pool, FIXTURE_PROJECT_ID), loadsBefore);
    const again = await backfillPanelForeground(pool, { projectId: SENTINEL_PROJECT_ID, apply: true });
    assert.equal(again.pending, 0);
    assert.equal(again.written, 0);
    const sentinelAfter = await pool.query("SELECT sha256 FROM visual_asset WHERE id = $1", [ids.sentinelAsset]);
    assert.equal(sentinelAfter.rows[0].sha256, sha256(tinyPng));
    const sentinelDraft = await pool.query("SELECT text FROM working_draft WHERE project_id = $1", [SENTINEL_PROJECT_ID]);
    assert.equal(sentinelDraft.rows[0].text, SENTINEL_TEXT);

    enterProject(FIXTURE_PROJECT_ID);
    const sourceAssets = await assetCount(pool);
    const sourceExtractions = await extractionCount(pool);
    const duplicated = await duplicateProject(pool, FIXTURE_PROJECT_ID, "020 copy");
    assertOk(duplicated, "duplicate-project");
    created.push(duplicated.project.id);
    assert.equal(await assetCount(pool), sourceAssets);
    assert.equal(await extractionCount(pool), sourceExtractions);
    enterProject(duplicated.project.id);
    const copyVisual = await createVisualStore(pool).load();
    const copyPanel = copyVisual.frames.find((frame) => frame.panels.some((panel) => panel.extraction?.usesForeground)).panels
      .find((panel) => panel.extraction?.usesForeground);
    assert.ok(copyPanel);
    assert.notEqual(copyPanel.assetId, passFinished.assetId);
    assert.notEqual(copyPanel.drawAssetId, passRow.foreground_asset_id);
    const copyForeground = await pool.query("SELECT sha256, kind FROM visual_asset WHERE id = $1", [copyPanel.drawAssetId]);
    const sourceForeground = await pool.query("SELECT sha256 FROM visual_asset WHERE id = $1", [passRow.foreground_asset_id]);
    assert.equal(copyForeground.rows[0].kind, "panel-foreground");
    assert.equal(copyForeground.rows[0].sha256, sourceForeground.rows[0].sha256);
    assert.equal(copyVisual.reusableAssets.some((asset) => asset.kind === "panel-foreground"), false);
    assert.equal(await extractionCount(pool, OTHER_PROJECT_ID), 0);
    assert.equal((await pool.query("SELECT text FROM working_draft WHERE project_id = $1", [SENTINEL_PROJECT_ID])).rows[0].text, SENTINEL_TEXT);
    assert.equal(assetsBeforeUpload > 0, true);
  } finally {
    await removeOwned(pool, created).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
