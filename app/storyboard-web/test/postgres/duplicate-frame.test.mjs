import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { enterProject } from "../../project-scope.mjs";
import { createResearchStore } from "../../research-store.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const RESEARCH_LOCK = "90210002026009";
const FIXTURE_PROJECT_ID = "01800000-0000-4000-8000-0000000000a1";
const ISOLATION_PROJECT_ID = "01800000-0000-4000-8000-0000000000a2";
const SENTINEL_PROJECT_ID = "01800000-0000-4000-8000-0000000000a3";
const RESEARCH_PROJECT_ID = "01800000-0000-4000-8000-0000000000a4";
const OWNED_PROJECT_IDS = [
  FIXTURE_PROJECT_ID,
  ISOLATION_PROJECT_ID,
  SENTINEL_PROJECT_ID,
  RESEARCH_PROJECT_ID,
];
const SENTINEL_TEXT = "018-sentinel-draft";
const SENTINEL_SOURCE = "018-sentinel-source";
const SENTINEL_BYTES = Buffer.from("018-sentinel-bytes");
const SENTINEL_ASSET_ID = "01800000-0000-4000-8000-0000000000c1";
const pngA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
  "base64",
);
const pngB = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const ids = {
  source: "01800000-0000-4000-8000-000000000001",
  reading: "01800000-0000-4000-8000-000000000002",
  interpretation: "01800000-0000-4000-8000-000000000003",
  material: "01800000-0000-4000-8000-000000000004",
  characterA: "01800000-0000-4000-8000-000000000005",
  characterB: "01800000-0000-4000-8000-000000000006",
  result: "01800000-0000-4000-8000-000000000007",
  otherSource: "01800000-0000-4000-8000-000000000011",
  otherReading: "01800000-0000-4000-8000-000000000012",
  otherInterpretation: "01800000-0000-4000-8000-000000000013",
  otherMaterial: "01800000-0000-4000-8000-000000000014",
  otherResult: "01800000-0000-4000-8000-000000000015",
  otherVersion: "01800000-0000-4000-8000-000000000016",
};

function storyboardFrames() {
  return [{
    id: "frame-split",
    layout: "split2",
    origin: "source",
    frameKind: "image",
    dialogueMode: "spoken",
    dialogue: "Привет",
    speakerPanel: 1,
    dormantSpeakerPanelId: "right",
    durationFrames: 120,
    sourceItemId: "item-split",
    sourceRole: "utterance",
    displayBlock: { sourceItemId: "item-split", start: 0, end: 6 },
    panels: [
      { id: "left", description: "Левая", ownerDescription: "заметка слева", manualSubject: "Аня" },
      { id: "right", description: "Правая", ownerDescription: "заметка справа", manualSubject: "Боря" },
    ],
  }, {
    id: "frame-card",
    layout: "single",
    origin: "derived",
    frameKind: "text",
    textCard: "Пауза",
    dialogue: "",
    durationFrames: 48,
    panels: [],
  }, {
    id: "frame-beat",
    directingBeat: true,
    origin: "source",
    sourceItemId: "item-beat",
    sourceRole: "utterance",
    dialogue: "Раз.Два.",
    segments: [
      {
        quote: "Раз.",
        layout: "single",
        dialogueMode: "spoken",
        speakerPanel: 0,
        dormantSpeakerPanelId: "beat-a",
        durationFrames: 80,
        panels: [{ id: "beat-a", description: "А", manualSubject: "Аня" }],
      },
      {
        quote: "Два.",
        layout: "single",
        dialogueMode: "silent",
        speakerPanel: null,
        dormantSpeakerPanelId: "beat-b",
        durationFrames: 36,
        panels: [{ id: "beat-b", description: "Б", manualSubject: "Боря" }],
      },
    ],
  }];
}

async function removeOwnedProjects(pool, projectIds = OWNED_PROJECT_IDS) {
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
    await pool.query(
      "DELETE FROM visual_approval WHERE storyboard_version_id = ANY($1::uuid[])",
      [versionIds],
    );
    await pool.query(`
      UPDATE panel_visual_state
      SET current_generation_id = NULL
      WHERE storyboard_version_id = ANY($1::uuid[])
    `, [versionIds]);
    await pool.query(`
      DELETE FROM panel_generation
      WHERE panel_visual_state_id IN (
        SELECT id FROM panel_visual_state WHERE storyboard_version_id = ANY($1::uuid[])
      )
    `, [versionIds]);
    await pool.query(
      "DELETE FROM panel_visual_state WHERE storyboard_version_id = ANY($1::uuid[])",
      [versionIds],
    );
  }
  if (resultIds.length > 0) {
    await pool.query(
      "DELETE FROM storyboard_reusable_asset WHERE storyboard_result_id = ANY($1::uuid[])",
      [resultIds],
    );
    await pool.query(
      "DELETE FROM storyboard_head WHERE storyboard_result_id = ANY($1::uuid[])",
      [resultIds],
    );
    await pool.query(`
      UPDATE storyboard_version
      SET parent_storyboard_version_id = NULL
      WHERE storyboard_result_id = ANY($1::uuid[])
    `, [resultIds]);
    await pool.query(
      "DELETE FROM storyboard_version WHERE storyboard_result_id = ANY($1::uuid[])",
      [resultIds],
    );
    await pool.query(
      "DELETE FROM storyboard_result WHERE id = ANY($1::uuid[])",
      [resultIds],
    );
  }
  if (materialIds.length > 0) {
    await pool.query(
      "DELETE FROM canonical_character WHERE material_state_id = ANY($1::uuid[])",
      [materialIds],
    );
    await pool.query(`
      UPDATE material_state
      SET parent_material_state_id = NULL
      WHERE id = ANY($1::uuid[])
    `, [materialIds]);
    await pool.query("DELETE FROM material_state WHERE id = ANY($1::uuid[])", [materialIds]);
  }
  if (revisionIds.length > 0) {
    await pool.query(
      "DELETE FROM interpretation WHERE source_revision_id = ANY($1::uuid[])",
      [revisionIds],
    );
  }
  if (revisionIds.length > 0) {
    await pool.query(`
      UPDATE source_revision
      SET parent_source_revision_id = NULL
      WHERE id = ANY($1::uuid[])
    `, [revisionIds]);
    await pool.query("DELETE FROM source_revision WHERE id = ANY($1::uuid[])", [revisionIds]);
  }
  await pool.query("DELETE FROM reading WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM visual_asset WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM research_event WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM working_draft WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM character_exclusion WHERE project_id = ANY($1::uuid[])", [projectIds]);
  await pool.query("DELETE FROM project WHERE id = ANY($1::uuid[])", [projectIds]);
}

async function seedProject(pool, projectId, title) {
  await pool.query(
    "INSERT INTO project (id, title) VALUES ($1, $2)",
    [projectId, title],
  );
}

async function seed(pool) {
  await seedProject(pool, FIXTURE_PROJECT_ID, "018 duplicate fixture");
  await pool.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, 'fixture draft', $2)",
    [FIXTURE_PROJECT_ID, randomUUID()],
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
    VALUES ($1, $2, 0, 'Аня'), ($3, $2, 1, 'Боря')
  `, [ids.characterA, ids.material, ids.characterB]);
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = $1, active_material_state_id = $2
    WHERE id = $3
  `, [ids.source, ids.material, FIXTURE_PROJECT_ID]);
  await pool.query(`
    INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
    VALUES ($1, $2, 'checked', $3::jsonb)
  `, [ids.result, ids.material, JSON.stringify({ frames: storyboardFrames() })]);

  const otherFrames = [{
    id: "other-frame",
    layout: "single",
    dialogue: "Чужая реплика",
    speakerPanel: 0,
    panels: [{ id: "other-panel", description: "Чужой" }],
  }];
  await seedProject(pool, ISOLATION_PROJECT_ID, "018 isolation fixture");
  await pool.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, 'чужой черновик', $2)",
    [ISOLATION_PROJECT_ID, randomUUID()],
  );
  await pool.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, 'чужой источник')",
    [ids.otherSource, ISOLATION_PROJECT_ID],
  );
  await pool.query(`
    INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
    VALUES ($1, $2, 'чужой источник', $3, 'ready')
  `, [ids.otherReading, ISOLATION_PROJECT_ID, randomUUID()]);
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
  `, [ids.otherSource, ids.otherMaterial, ISOLATION_PROJECT_ID]);
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
}

async function versionRows(pool, resultId) {
  const result = await pool.query(`
    SELECT id, parent_storyboard_version_id, instruction
    FROM storyboard_version
    WHERE storyboard_result_id = $1
    ORDER BY created_at, id
  `, [resultId]);
  return result.rows;
}

async function headId(pool, resultId) {
  const result = await pool.query(
    "SELECT active_storyboard_version_id FROM storyboard_head WHERE storyboard_result_id = $1",
    [resultId],
  );
  return result.rows[0]?.active_storyboard_version_id ?? null;
}

async function storedFrames(pool, versionId) {
  const result = await pool.query("SELECT frames FROM storyboard_version WHERE id = $1", [versionId]);
  return result.rows[0]?.frames ?? null;
}

async function panelRows(pool, versionId) {
  const result = await pool.query(`
    SELECT id, frame_id, panel_index, panel_id, subject, performance_asset_id, current_generation_id,
           zoom::text AS zoom, position_x::text AS position_x, position_y::text AS position_y, mirrored,
           assigned_asset_id, assignment_origin, current_asset_id, current_asset_origin
    FROM panel_visual_state
    WHERE storyboard_version_id = $1
    ORDER BY frame_id, panel_index
  `, [versionId]);
  return result.rows;
}

async function assetFingerprint(pool) {
  const result = await pool.query(`
    SELECT id, kind, sha256, byte_length, octet_length(bytes)::int AS stored_length, bytes
    FROM visual_asset
    ORDER BY id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    sha256: row.sha256,
    byteLength: row.byte_length,
    storedLength: row.stored_length,
    bytes: Buffer.from(row.bytes).toString("base64"),
  }));
}

async function tableCounts(pool) {
  const tables = [
    "visual_asset",
    "panel_generation",
    "source_revision",
    "material_state",
    "working_draft",
    "interpretation",
    "source_item",
    "character_anchor_version",
    "character_anchor_head",
    "project_style_seed",
    "storyboard_reusable_asset",
    "canonical_character",
    "reading",
    "character_identity",
  ];
  const counts = {};
  for (const table of tables) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function unrelatedSnapshot(pool) {
  const projects = await pool.query(`
    SELECT id, title, active_source_revision_id, active_material_state_id, current_reading_id
    FROM project
    WHERE NOT (id = ANY($1::uuid[]))
    ORDER BY id
  `, [OWNED_PROJECT_IDS]);
  const assets = await pool.query(`
    SELECT id, sha256, byte_length, octet_length(bytes)::int AS stored_length
    FROM visual_asset
    WHERE NOT (project_id = ANY($1::uuid[]))
    ORDER BY id
  `, [OWNED_PROJECT_IDS]);
  const events = await pool.query(`
    SELECT count(*)::int AS count
    FROM research_event
    WHERE NOT (project_id = ANY($1::uuid[]))
  `, [OWNED_PROJECT_IDS]);
  return {
    projects: projects.rows,
    assets: assets.rows,
    researchEvents: events.rows[0].count,
  };
}

async function seedSentinel(pool) {
  await seedProject(pool, SENTINEL_PROJECT_ID, "018 sentinel");
  await pool.query(
    "INSERT INTO working_draft (project_id, text, revision_token) VALUES ($1, $2, $3)",
    [SENTINEL_PROJECT_ID, SENTINEL_TEXT, "01800000-0000-4000-8000-0000000000c2"],
  );
  await pool.query(
    "INSERT INTO source_revision (id, project_id, text) VALUES ($1, $2, $3)",
    ["01800000-0000-4000-8000-0000000000c3", SENTINEL_PROJECT_ID, SENTINEL_SOURCE],
  );
  await pool.query(`
    INSERT INTO visual_asset (
      id, project_id, kind, mime, width, height, byte_length, sha256, bytes
    ) VALUES ($1, $2, 'uploaded-image', 'image/png', 1, 1, $3, $4, $5)
  `, [
    SENTINEL_ASSET_ID,
    SENTINEL_PROJECT_ID,
    SENTINEL_BYTES.length,
    createHash("sha256").update(SENTINEL_BYTES).digest("hex"),
    SENTINEL_BYTES,
  ]);
}

async function readSentinel(pool) {
  const project = await pool.query(`
    SELECT id, title, active_source_revision_id, active_material_state_id, current_reading_id
    FROM project WHERE id = $1
  `, [SENTINEL_PROJECT_ID]);
  const draft = await pool.query(
    "SELECT text, revision_token FROM working_draft WHERE project_id = $1",
    [SENTINEL_PROJECT_ID],
  );
  const source = await pool.query(
    "SELECT id, text FROM source_revision WHERE project_id = $1 ORDER BY id",
    [SENTINEL_PROJECT_ID],
  );
  const asset = await pool.query(`
    SELECT id, sha256, byte_length, octet_length(bytes)::int AS stored_length, bytes
    FROM visual_asset WHERE id = $1 AND project_id = $2
  `, [SENTINEL_ASSET_ID, SENTINEL_PROJECT_ID]);
  return {
    project: project.rows,
    draft: draft.rows,
    source: source.rows,
    asset: asset.rows.map((row) => ({
      id: row.id,
      sha256: row.sha256,
      byteLength: row.byte_length,
      storedLength: row.stored_length,
      bytes: Buffer.from(row.bytes).toString("base64"),
    })),
  };
}

function findFrame(visual, structureFrameId, structureSegmentIndex = null) {
  return visual.frames.find((frame) => (
    frame.structureFrameId === structureFrameId
    && (structureSegmentIndex == null
      ? frame.structureSegmentIndex == null
      : frame.structureSegmentIndex === structureSegmentIndex)
  ));
}

test("duplicateFrame copies panel state by reference, then one undo restores the previous head", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  assert.equal(new URL(databaseUrl).pathname, "/comics_test");
  enterProject(FIXTURE_PROJECT_ID);
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await removeOwnedProjects(pool);
    const unrelatedBefore = await unrelatedSnapshot(pool);
    await seedSentinel(pool);
    const sentinelBefore = await readSentinel(pool);
    await seed(pool);
    const store = createVisualStore(pool);
    const initial = await store.load();
    assert.equal(initial.frames[0].structureFrameId, "frame-split");
    for (const payload of [
      { op: "batch", operations: [{ op: "duplicateFrame", structureFrameId: "frame-split" }] },
      {
        op: "batch",
        operations: [
          { op: "duplicateFrame", structureFrameId: "frame-split" },
          { op: "duplicateFrame", structureFrameId: "frame-card" },
        ],
      },
      {
        op: "batch",
        operations: [
          { op: "setDuration", structureFrameId: "frame-card", durationFrames: 40 },
          { op: "duplicateFrame", structureFrameId: "frame-split" },
        ],
      },
    ]) {
      const rejected = await store.applyOperation(payload);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.kind, "invalid-operation");
      assert.equal(rejected.operationResult, undefined);
    }
    assert.equal((await store.load()).storyboardVersionId, initial.storyboardVersionId);
    assert.equal((await versionRows(pool, ids.result)).length, 1);
    const stale = await store.applyOperation({ op: "duplicateFrame", structureFrameId: "missing-frame" });
    assert.equal(stale.ok, false);
    assert.equal(stale.kind, "frame-not-found");
    assert.equal((await store.load()).storyboardVersionId, initial.storyboardVersionId);

    assert.equal((await store.updatePlacement({
      frameId: "frame-split",
      panelIndex: 0,
      zoom: 1.5,
      positionX: 20,
      positionY: 40,
      mirrored: true,
    })).ok, true);
    assert.equal((await store.updatePlacement({
      frameId: "frame-split",
      panelIndex: 1,
      zoom: 2,
      positionX: 80,
      positionY: 10,
      mirrored: false,
    })).ok, true);
    assert.equal((await store.updatePlacement({
      frameId: "frame-beat#1",
      panelIndex: 0,
      zoom: 1.25,
      positionX: 15,
      positionY: 35,
      mirrored: true,
    })).ok, true);
    const uploadedLeft = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: `data:image/png;base64,${pngA.toString("base64")}`,
      targets: [{ panelId: "left" }],
    });
    assert.equal(uploadedLeft.ok, true, uploadedLeft.kind);
    const uploadedRight = await store.applyOperation({
      op: "uploadAsset",
      imageDataUrl: `data:image/png;base64,${pngB.toString("base64")}`,
      targets: [{ panelId: "right" }],
    });
    assert.equal(uploadedRight.ok, true, uploadedRight.kind);
    const spoken = await store.applyOperation({
      op: "setFrameDialogue",
      structureFrameId: "frame-split",
      dialogueMode: "spoken",
      text: "Привет ещё",
      speakerPanelId: "right",
    });
    assert.equal(spoken.ok, true, spoken.kind);
    assert.equal((await store.applyOperation({
      op: "setManualSubject",
      panelId: "left",
      characterName: "Аня",
    })).ok, true);
    assert.equal((await store.applyOperation({
      op: "setOwnerDescription",
      panelId: "left",
      ownerDescription: "заметка слева обновлена",
    })).ok, true);

    const prepared = await store.load();
    const headBefore = prepared.storyboardVersionId;
    const left = findFrame(prepared, "frame-split").panels[0];
    const right = findFrame(prepared, "frame-split").panels[1];
    assert.notEqual(left.assetId, right.assetId);
    assert.equal(left.zoom, 1.5);
    assert.equal(left.mirrored, true);
    assert.equal(right.zoom, 2);
    assert.equal(right.positionX, 80);
    const performanceId = randomUUID();
    const performanceBytes = Buffer.from("performance-bytes");
    await pool.query(`
      INSERT INTO visual_asset (
        id, project_id, kind, mime, width, height, byte_length, sha256, bytes
      ) VALUES ($1, $2, 'performance-reference', 'image/png', 1, 1, $3, $4, $5)
    `, [
      performanceId,
      FIXTURE_PROJECT_ID,
      performanceBytes.length,
      createHash("sha256").update(performanceBytes).digest("hex"),
      performanceBytes,
    ]);
    const generationId = randomUUID();
    const leftState = await pool.query(
      "SELECT id FROM panel_visual_state WHERE storyboard_version_id = $1 AND panel_id = 'left'",
      [headBefore],
    );
    assert.equal(leftState.rowCount, 1);
    await pool.query(`
      INSERT INTO panel_generation (
        id, panel_visual_state_id, output_asset_id, resolved_description, instruction, status
      ) VALUES ($1, $2, $3, 'Левая', 'готово', 'ready')
    `, [generationId, leftState.rows[0].id, left.assetId]);
    await pool.query(`
      UPDATE panel_visual_state
      SET performance_asset_id = $2,
          current_generation_id = $3
      WHERE storyboard_version_id = $1 AND panel_id = 'left'
    `, [headBefore, performanceId, generationId]);

    const approvalSnapshot = prepared.frames.map((frame) => ({
      id: frame.id,
      panels: frame.panels.map((panel) => ({
        assetId: panel.assetId ?? null,
        zoom: panel.zoom,
        position: panel.position,
        mirrored: panel.mirrored === true,
      })),
    }));
    await pool.query(
      "INSERT INTO visual_approval (id, storyboard_version_id, snapshot) VALUES ($1, $2, $3::jsonb)",
      [randomUUID(), headBefore, JSON.stringify(approvalSnapshot)],
    );
    const approved = await store.load();
    assert.equal(approved.approved, true);
    assert.equal(approved.storyboardVersionId, headBefore);

    const versionsBefore = await versionRows(pool, ids.result);
    const assetsBefore = await assetFingerprint(pool);
    const countsBefore = await tableCounts(pool);
    const sourceRowsBefore = await panelRows(pool, headBefore);
    const sourceJsonBefore = await storedFrames(pool, headBefore);
    const generationsBefore = await pool.query("SELECT id, panel_visual_state_id FROM panel_generation ORDER BY id");

    const duplicated = await store.applyOperation({
      op: "duplicateFrame",
      structureFrameId: "frame-split",
      structureSegmentIndex: null,
      displayFrameNumber: 1,
    });
    assert.equal(duplicated.ok, true, duplicated.kind);
    assert.equal(duplicated.changed, true);
    assert.equal(duplicated.invalidateRender, true);
    assert.equal(duplicated.operationResult.op, "duplicateFrame");
    assert.equal(duplicated.operationResult.source.structureFrameId, "frame-split");
    assert.equal(typeof duplicated.operationResult.created.structureFrameId, "string");
    const createdId = duplicated.operationResult.created.structureFrameId;
    assert.notEqual(createdId, "frame-split");

    const versionsAfter = await versionRows(pool, ids.result);
    assert.equal(versionsAfter.length, versionsBefore.length + 1);
    const createdVersion = versionsAfter.find((row) => !versionsBefore.some((before) => before.id === row.id));
    assert.equal(createdVersion.parent_storyboard_version_id, headBefore);
    assert.equal(createdVersion.instruction, "duplicateFrame");
    assert.equal(await headId(pool, ids.result), createdVersion.id);
    const context = await pool.query(
      "SELECT operation_context FROM storyboard_version WHERE id = $1",
      [createdVersion.id],
    );
    assert.equal(context.rows[0].operation_context.source.structureFrameId, "frame-split");
    assert.equal(context.rows[0].operation_context.created.structureFrameId, createdId);

    const copied = await store.load();
    assert.equal(copied.storyboardVersionId, createdVersion.id);
    assert.equal(copied.approved, false);
    assert.equal(copied.readyForVideo, false);
    assert.equal(copied.canUndo, true);
    const sourceVisible = findFrame(copied, "frame-split");
    const duplicateVisible = findFrame(copied, createdId);
    const cardVisible = findFrame(copied, "frame-card");
    assert.equal(copied.frames.indexOf(duplicateVisible), copied.frames.indexOf(sourceVisible) + 1);
    assert.equal(sourceVisible.panels[0].id, "left");
    assert.equal(sourceVisible.panels[1].id, "right");
    assert.notEqual(duplicateVisible.panels[0].id, "left");
    assert.notEqual(duplicateVisible.panels[1].id, "right");
    assert.equal(duplicateVisible.dialogueMode, "spoken");
    assert.equal(duplicateVisible.dialogue, "Привет ещё");
    assert.equal(duplicateVisible.speakerPanel, 1);
    assert.equal(duplicateVisible.durationFrames, 120);
    assert.equal(duplicateVisible.panels[0].description, "Левая");
    assert.equal(duplicateVisible.panels[0].ownerDescription, "заметка слева обновлена");
    assert.equal(duplicateVisible.panels[0].manualSubject, "Аня");
    assert.equal(duplicateVisible.panels[0].assetId, sourceVisible.panels[0].assetId);
    assert.equal(duplicateVisible.panels[1].assetId, sourceVisible.panels[1].assetId);
    assert.equal(duplicateVisible.panels[0].zoom, 1.5);
    assert.equal(duplicateVisible.panels[0].positionX, 20);
    assert.equal(duplicateVisible.panels[0].positionY, 40);
    assert.equal(duplicateVisible.panels[0].mirrored, true);
    assert.equal(duplicateVisible.panels[0].performanceAssetId, performanceId);
    assert.equal(duplicateVisible.panels[1].zoom, 2);
    assert.equal(duplicateVisible.panels[1].positionX, 80);
    assert.equal(duplicateVisible.panels[1].mirrored, false);
    assert.equal(cardVisible.textCard, "Пауза");
    assert.equal(cardVisible.durationFrames, 48);
    assert.deepEqual(cardVisible.panels, []);
    assert.equal(findFrame(copied, "frame-beat", 0).panels[0].id, "beat-a");
    assert.equal(findFrame(copied, "frame-beat", 1).panels[0].id, "beat-b");

    const storedAfter = await storedFrames(pool, createdVersion.id);
    assert.deepEqual(storedAfter[0], sourceJsonBefore[0]);
    assert.equal(storedAfter[1].id, createdId);
    assert.equal(storedAfter[2].id, "frame-card");
    assert.equal(storedAfter[3].id, "frame-beat");
    assert.deepEqual(await panelRows(pool, headBefore), sourceRowsBefore);

    const duplicateRows = (await panelRows(pool, createdVersion.id))
      .filter((row) => row.panel_id === duplicateVisible.panels[0].id || row.panel_id === duplicateVisible.panels[1].id);
    assert.equal(duplicateRows.length, 2);
    const sourceIds = new Set(sourceRowsBefore.map((row) => row.id));
    for (const row of duplicateRows) {
      assert.equal(sourceIds.has(row.id), false);
      assert.equal(row.current_generation_id, null);
    }
    const copiedLeft = duplicateRows.find((row) => row.panel_id === duplicateVisible.panels[0].id);
    const copiedRight = duplicateRows.find((row) => row.panel_id === duplicateVisible.panels[1].id);
    assert.equal(copiedLeft.current_asset_id, left.assetId);
    assert.equal(copiedLeft.performance_asset_id, performanceId);
    assert.equal(copiedLeft.mirrored, true);
    assert.equal(copiedRight.current_asset_id, right.assetId);
    assert.equal(copiedRight.current_generation_id, null);
    const forwardedLeft = (await panelRows(pool, createdVersion.id)).find((row) => row.panel_id === "left");
    assert.equal(forwardedLeft.current_generation_id, generationId);
    assert.notEqual(forwardedLeft.id, leftState.rows[0].id);

    assert.deepEqual(await assetFingerprint(pool), assetsBefore);
    const countsAfter = await tableCounts(pool);
    assert.equal(countsAfter.visual_asset, countsBefore.visual_asset);
    assert.equal(countsAfter.panel_generation, countsBefore.panel_generation);
    assert.deepEqual(
      countsAfter,
      countsBefore,
    );
    const generationsAfter = await pool.query("SELECT id, panel_visual_state_id FROM panel_generation ORDER BY id");
    assert.deepEqual(generationsAfter.rows, generationsBefore.rows);
    const approval = await pool.query("SELECT storyboard_version_id FROM visual_approval");
    assert.deepEqual(approval.rows.map((row) => row.storyboard_version_id), [headBefore]);

    const reloaded = await store.load();
    assert.equal(findFrame(reloaded, createdId).panels[0].assetId, left.assetId);
    assert.equal(findFrame(reloaded, "frame-split").panels[1].id, "right");

    const edited = await store.applyOperation({
      op: "setOwnerDescription",
      panelId: duplicateVisible.panels[0].id,
      ownerDescription: "только копия",
    });
    assert.equal(edited.ok, true, edited.kind);
    const afterEdit = await store.load();
    assert.equal(findFrame(afterEdit, createdId).panels[0].ownerDescription, "только копия");
    assert.equal(findFrame(afterEdit, "frame-split").panels[0].ownerDescription, "заметка слева обновлена");
    assert.equal(findFrame(afterEdit, "frame-split").panels[0].assetId, left.assetId);

    const undoEdit = await store.undoStoryboardEdit();
    assert.equal(undoEdit.ok, true);
    assert.equal((await store.load()).storyboardVersionId, createdVersion.id);
    const undoDuplicate = await store.undoStoryboardEdit();
    assert.equal(undoDuplicate.ok, true);
    assert.equal(undoDuplicate.storyboardVersionId, headBefore);
    assert.equal(undoDuplicate.undoneTarget.op, "duplicateFrame");
    assert.equal(undoDuplicate.undoneTarget.created.structureFrameId, createdId);
    const restored = await store.load();
    assert.equal(restored.storyboardVersionId, headBefore);
    assert.equal(restored.frames.some((frame) => frame.structureFrameId === createdId), false);
    assert.equal(findFrame(restored, "frame-split").panels[0].id, "left");
    assert.equal(findFrame(restored, "frame-split").panels[0].ownerDescription, "заметка слева обновлена");
    assert.equal(await headId(pool, ids.result), headBefore);

    const compound = await store.applyOperation({
      op: "duplicateFrame",
      structureFrameId: "frame-beat",
      structureSegmentIndex: 1,
    });
    assert.equal(compound.ok, true, compound.kind);
    const compoundVisible = await store.load();
    const compoundCopyId = compound.operationResult.created.structureFrameId;
    const compoundCopy = findFrame(compoundVisible, compoundCopyId, 1);
    assert.equal(compoundCopy.dialogueMode, "silent");
    assert.notEqual(compoundCopy.panels[0].id, "beat-b");
    assert.equal(compoundCopy.panels[0].zoom, 1);
    const compoundFirst = findFrame(compoundVisible, compoundCopyId, 0);
    assert.equal(compoundFirst.panels[0].zoom, 1.25);
    assert.equal(compoundFirst.panels[0].mirrored, true);
    assert.notEqual(compoundFirst.panels[0].id, "beat-a");
    assert.equal(findFrame(compoundVisible, "frame-beat", 0).panels[0].id, "beat-a");
    const cardCopy = await store.applyOperation({
      op: "duplicateFrame",
      structureFrameId: "frame-card",
    });
    assert.equal(cardCopy.ok, true, cardCopy.kind);
    const withCard = await store.load();
    const copiedCard = findFrame(withCard, cardCopy.operationResult.created.structureFrameId);
    assert.equal(copiedCard.textCard, "Пауза");
    assert.equal(copiedCard.durationFrames, 48);
    assert.deepEqual(copiedCard.panels, []);
    assert.equal((await tableCounts(pool)).panel_generation, countsBefore.panel_generation);
    assert.deepEqual(await assetFingerprint(pool), assetsBefore);

    enterProject(ISOLATION_PROJECT_ID);
    const other = await store.load();
    assert.equal(other.storyboardVersionId, ids.otherVersion);
    assert.equal(other.frames.length, 1);
    assert.equal(other.frames[0].dialogue, "Чужая реплика");
    assert.equal(await headId(pool, ids.otherResult), ids.otherVersion);
    enterProject(FIXTURE_PROJECT_ID);
    assert.equal((await store.load()).storyboardVersionId === ids.otherVersion, false);
    assert.deepEqual(await readSentinel(pool), sentinelBefore);
    await removeOwnedProjects(pool, [FIXTURE_PROJECT_ID, ISOLATION_PROJECT_ID]);
    assert.deepEqual(await readSentinel(pool), sentinelBefore);
    await removeOwnedProjects(pool, [SENTINEL_PROJECT_ID]);
    assert.deepEqual(await unrelatedSnapshot(pool), unrelatedBefore);
  } finally {
    enterProject(FIXTURE_PROJECT_ID);
    await removeOwnedProjects(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});

test("frame_duplicate can be stored and earlier semantic actions stay valid", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  assert.equal(new URL(databaseUrl).pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  const eventIds = [randomUUID(), randomUUID(), randomUUID()];
  const correlationIds = [];
  try {
    await guard.query("SELECT pg_advisory_lock($1::bigint)", [RESEARCH_LOCK]);
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await removeOwnedProjects(pool, [RESEARCH_PROJECT_ID]);
    await seedProject(pool, RESEARCH_PROJECT_ID, "018 research fixture");
    const inserted = await pool.query(`
      INSERT INTO research_event (
        id, project_id, event_kind, semantic_action, correlation_id, surface, context
      ) VALUES
        ($1, $4, 'action_start', 'frame_duplicate', $5, 'product_control', '{"structureFrameId":"source"}'::jsonb),
        ($2, $4, 'action_start', 'frame_insert', $6, 'product_control', '{}'::jsonb),
        ($3, $4, 'action_start', 'frame_dialogue', $7, 'product_control', '{}'::jsonb)
      RETURNING semantic_action
    `, [eventIds[0], eventIds[1], eventIds[2], RESEARCH_PROJECT_ID, randomUUID(), randomUUID(), randomUUID()]);
    assert.deepEqual(inserted.rows.map((row) => row.semantic_action), [
      "frame_duplicate",
      "frame_insert",
      "frame_dialogue",
    ]);
    const research = createResearchStore(pool);
    const correlationId = randomUUID();
    correlationIds.push(correlationId);
    const start = await research.appendEvent({
      projectId: RESEARCH_PROJECT_ID,
      eventKind: "action_start",
      semanticAction: "frame_duplicate",
      correlationId,
      surface: "product_control",
      commandTarget: { kind: "frame", structureFrameId: "source-frame", displayFrameNumber: 2 },
      context: {
        workflowPhase: "visual",
        storyboardVersionId: null,
        displayFrameNumber: 2,
        displayFrameId: null,
        structureFrameId: "source-frame",
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
        introTemplateId: null,
        introTemplateVersion: null,
      },
    });
    assert.equal(start.ok, true, start.kind);
    const terminal = await research.appendEvent({
      projectId: RESEARCH_PROJECT_ID,
      eventKind: "action_terminal",
      correlationId,
      outcome: "success",
      outcomeFlags: {},
      resultContext: {
        createdStructureFrameId: "created-frame",
        createdDisplayFrameId: "created-frame",
        createdDisplayFrameNumber: 3,
        createdStructureSegmentIndex: null,
      },
    });
    assert.equal(terminal.ok, true, terminal.kind);
    assert.equal(terminal.event.context.structureFrameId, "source-frame");
    assert.equal(terminal.event.context.createdStructureFrameId, "created-frame");
    assert.equal(terminal.event.context.createdDisplayFrameNumber, 3);
  } finally {
    await removeOwnedProjects(pool, [RESEARCH_PROJECT_ID]).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [RESEARCH_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
