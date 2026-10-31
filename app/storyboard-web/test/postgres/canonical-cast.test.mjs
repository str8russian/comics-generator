import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import {
  beginReading,
  confirmReading,
  finishReading,
  loadProject,
  replacePendingCast,
  reviseMaterialState,
  saveDraft,
} from "../../project-store.mjs";
import { enterProject, SEEDED_PROJECT_ID } from "../../project-scope.mjs";
import { createVisualStore } from "../../visual-store.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const line = "Путин: Дмитрий Сергеевич, это Песков.";
const spoken = "Дмитрий Сергеевич, это Песков.";
const second = "Кто это сказал?";
const draft = `${line}\n${second}`;
const pngA = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");
const pngB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const pngPanel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function sourceItems() {
  return [
    {
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Путин",
      sourceQuote: line,
      draftStart: 0,
      draftEnd: line.length,
      text: spoken,
    },
    {
      id: "u2",
      kind: "utterance",
      segmentIds: ["seg-1"],
      speakerStatus: "unresolved",
      sourceQuote: second,
      draftStart: line.length + 1,
      draftEnd: draft.length,
      text: second,
    },
  ];
}

function people() {
  return {
    characters: [
      { id: "putin", name: "Путин" },
      { id: "peskov", name: "Песков" },
    ],
    surfaceForms: [
      { id: "label", quote: "Путин", role: "speaker-label", characterId: "putin" },
      { id: "address", quote: "Дмитрий Сергеевич", role: "address" },
      { id: "mention", quote: "Песков", role: "mention", characterId: "peskov" },
    ],
  };
}

function cast(extra = []) {
  return {
    characters: [
      { name: "Путин", extractedName: "Путин", included: true },
      { name: "Песков", extractedName: "Песков", included: true },
      ...extra,
    ],
    aliases: [
      { surface: "Путин", characterName: "Путин" },
      { surface: "Дмитрий Сергеевич", characterName: "Песков" },
      { surface: "Песков", characterName: "Песков" },
    ],
    speakers: [{ sourceItemId: "u1", characterName: "Путин" }],
  };
}

function frames() {
  return [{
    id: "f1",
    sourceItemId: "u1",
    sourceRole: "utterance",
    origin: "source",
    layout: "single",
    dialogueMode: "spoken",
    speakerPanel: 0,
    dialogue: spoken,
    displayBlock: { sourceItemId: "u1", start: 0, end: spoken.length },
    panels: [{ id: "p1", description: "Путин" }],
    durationFrames: 48,
  }];
}

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function resetProject(pool) {
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = NULL,
        active_material_state_id = NULL,
        current_reading_id = NULL
    WHERE id = $1
  `, [SEEDED_PROJECT_ID]);
  await pool.query("DELETE FROM visual_approval");
  await pool.query("DELETE FROM storyboard_head");
  await pool.query("UPDATE panel_visual_state SET current_generation_id = NULL");
  await pool.query("DELETE FROM panel_generation");
  await pool.query("DELETE FROM panel_visual_state");
  await pool.query("DELETE FROM storyboard_version");
  await pool.query("DELETE FROM storyboard_result");
  await pool.query("DELETE FROM project_style_seed");
  await pool.query("DELETE FROM character_anchor_head");
  await pool.query("UPDATE character_anchor_version SET parent_anchor_version_id = NULL");
  await pool.query("DELETE FROM character_anchor_version");
  await pool.query("DELETE FROM character_identity");
  await pool.query("DELETE FROM visual_asset WHERE project_id = $1", [SEEDED_PROJECT_ID]);
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
  await pool.query("DELETE FROM character_exclusion WHERE project_id = $1", [SEEDED_PROJECT_ID]);
  await pool.query(`
    UPDATE working_draft
    SET text = '',
        revision_token = '00000000-0000-4000-8000-000000000002',
        updated_at = now()
    WHERE project_id = $1
  `, [SEEDED_PROJECT_ID]);
}

async function confirmBase(pool) {
  await saveDraft(pool, {
    text: draft,
    revisionToken: "00000000-0000-4000-8000-000000000002",
  });
  const started = await beginReading(pool);
  const model = people();
  const ready = await finishReading(pool, {
    readingId: started.readingId,
    sourceItems: sourceItems(),
    characters: model.characters,
    surfaceForms: model.surfaceForms,
  });
  assert.equal(ready.status, "ready", ready.kind);
  return { readingId: started.readingId };
}

async function insertAsset(pool, bytes, kind) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO visual_asset (id, project_id, kind, mime, width, height, byte_length, sha256, bytes)
     VALUES ($1, $2, $3, 'image/png', 1, 1, $4, $5, $6)`,
    [id, SEEDED_PROJECT_ID, kind, bytes.length, sha(bytes), bytes],
  );
  return id;
}

async function installBoard(pool, materialStateId, { putinAsset, peskovAsset, panelAsset }) {
  const resultId = randomUUID();
  const versionId = randomUUID();
  const board = frames();
  await pool.query(
    `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
     VALUES ($1, $2, 'checked', $3::jsonb)`,
    [resultId, materialStateId, JSON.stringify({ frames: board })],
  );
  await pool.query(
    `INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)`,
    [versionId, resultId, JSON.stringify(board)],
  );
  await pool.query(
    `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
    [resultId, versionId],
  );
  await pool.query(
    `INSERT INTO panel_visual_state (
       id, storyboard_version_id, frame_id, panel_index, panel_id,
       current_asset_id, current_asset_origin, zoom, position_x, position_y, mirrored
     ) VALUES ($1, $2, 'f1', 0, 'p1', $3, 'upload', 1.250, 40, 20, true)`,
    [randomUUID(), versionId, panelAsset],
  );
  const putinAnchor = randomUUID();
  const peskovAnchor = randomUUID();
  await pool.query(
    `INSERT INTO character_anchor_version (
       id, material_state_id, character_name, output_asset_id, instruction, status, provenance, approved_at
     ) VALUES
       ($1, $2, 'Путин', $3, '', 'approved', 'uploaded_as_ready_anchor', clock_timestamp()),
       ($4, $2, 'Песков', $5, '', 'approved', 'uploaded_as_ready_anchor', clock_timestamp())`,
    [putinAnchor, materialStateId, putinAsset, peskovAnchor, peskovAsset],
  );
  await pool.query(
    `INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
     VALUES ($1, 'Путин', $2), ($1, 'Песков', $3)`,
    [materialStateId, putinAnchor, peskovAnchor],
  );
  return { resultId, versionId, putinAnchor, peskovAnchor };
}

function withRenames(base, renames) {
  const next = {
    characters: base.characters.map((character) => ({ ...character })),
    aliases: base.aliases.map((alias) => ({ ...alias })),
    speakers: base.speakers.map((speaker) => ({ ...speaker })),
  };
  for (const character of next.characters) {
    if (renames[character.name]) character.name = renames[character.name];
  }
  for (const alias of next.aliases) {
    if (renames[alias.characterName]) alias.characterName = renames[alias.characterName];
  }
  for (const speaker of next.speakers) {
    if (renames[speaker.characterName]) speaker.characterName = renames[speaker.characterName];
  }
  return next;
}

async function activeId(pool) {
  const project = await loadProject(pool);
  return project.activeMaterialStateId;
}

async function withDatabase(run) {
  enterProject(SEEDED_PROJECT_ID);
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
  try {
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, "comics_test");
    await resetProject(pool);
    await run(pool);
  } finally {
    await resetProject(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]);
    guard.release();
    await pool.end();
  }
}

test("pending add stores one silent character and confirmation creates it once", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  await withDatabase(async (pool) => {
    const { readingId } = await confirmBase(pool);
    const blank = await replacePendingCast(pool, readingId, cast([{ name: "   ", included: true }]));
    assert.equal(blank.ok, false);
    const duplicate = await replacePendingCast(pool, readingId, cast([
      { name: "Путин", extractedName: "Путин", included: true },
    ]));
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.kind, "duplicate-name");
    const before = await pool.query(`SELECT count(*)::int AS count FROM pending_character WHERE reading_id = $1`, [readingId]);
    const added = await replacePendingCast(pool, readingId, cast([
      { name: "  Наблюдатель  ", included: true },
    ]));
    assert.equal(added.ok, true, added.kind);
    const pending = await pool.query(
      `SELECT name, included, extracted_name FROM pending_character WHERE reading_id = $1 AND name = 'Наблюдатель'`,
      [readingId],
    );
    assert.equal(pending.rowCount, 1);
    assert.equal(pending.rows[0].included, true);
    assert.equal(pending.rows[0].extracted_name, "Наблюдатель");
    const speakers = await pool.query(
      `SELECT count(*)::int AS count FROM pending_speaker WHERE reading_id = $1`,
      [readingId],
    );
    assert.equal(speakers.rows[0].count, 1);
    assert.equal(before.rows[0].count + 1, 3);
    const again = await replacePendingCast(pool, readingId, cast([
      { name: "Наблюдатель", extractedName: "Наблюдатель", included: true },
      { name: "Наблюдатель", extractedName: "Другой", included: true },
    ]));
    assert.equal(again.ok, false);
    const still = await pool.query(
      `SELECT count(*)::int AS count FROM pending_character WHERE reading_id = $1 AND name = 'Наблюдатель'`,
      [readingId],
    );
    assert.equal(still.rows[0].count, 1);

    const confirmed = await confirmReading(pool, { readingId });
    assert.equal(confirmed.ok, true, confirmed.kind);
    const canonical = await pool.query(
      `SELECT name FROM canonical_character WHERE material_state_id = $1 AND name = 'Наблюдатель'`,
      [confirmed.materialStateId],
    );
    assert.equal(canonical.rowCount, 1);
    const assignments = await pool.query(
      `SELECT canonical_character.name
       FROM speaker_assignment
       JOIN canonical_character ON canonical_character.id = speaker_assignment.character_id
       WHERE speaker_assignment.material_state_id = $1`,
      [confirmed.materialStateId],
    );
    assert.deepEqual(assignments.rows.map((row) => row.name), ["Путин"]);
    const loaded = await loadProject(pool);
    assert.equal(loaded.material.cast.characters.filter((character) => character.name === "Наблюдатель").length, 1);
    const stale = await replacePendingCast(pool, readingId, cast([
      { name: "Ещё", extractedName: "Ещё", included: true },
    ]));
    assert.equal(stale.kind, "stale-reading");
    const afterStale = await loadProject(pool);
    assert.equal(afterStale.activeMaterialStateId, confirmed.materialStateId);
    assert.equal(afterStale.material.cast.characters.some((character) => character.name === "Ещё"), false);
  });
});

test("a confirmed silent add keeps the checked storyboard and drops whole-board approval", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  await withDatabase(async (pool) => {
    const { readingId } = await confirmBase(pool);
    assert.equal((await replacePendingCast(pool, readingId, cast())).ok, true);
    const confirmed = await confirmReading(pool, { readingId });
    assert.equal(confirmed.ok, true, confirmed.kind);
    const putinAsset = await insertAsset(pool, pngA, "base-anchor");
    const peskovAsset = await insertAsset(pool, pngB, "base-anchor");
    const panelAsset = await insertAsset(pool, pngPanel, "uploaded-image");
    const board = await installBoard(pool, confirmed.materialStateId, { putinAsset, peskovAsset, panelAsset });
    const store = createVisualStore(pool);
    const before = await store.load();
    assert.equal(before.ok, true, before.kind);
    assert.equal(before.approved, false);
    await pool.query(
      `INSERT INTO visual_approval (id, storyboard_version_id, snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [randomUUID(), before.storyboardVersionId, JSON.stringify(before.frames.map((frame) => ({
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
    assert.equal(approved.readyForVideo, true);
    const assetsBefore = await pool.query(`SELECT count(*)::int AS count FROM visual_asset WHERE project_id = $1`, [SEEDED_PROJECT_ID]);
    const generationsBefore = await pool.query(`SELECT count(*)::int AS count FROM panel_generation`);

    const added = await reviseMaterialState(pool, cast([
      { name: "Наблюдатель", extractedName: "Наблюдатель", included: true },
    ]));
    assert.equal(added.ok, true, added.kind);
    assert.notEqual(added.materialStateId, confirmed.materialStateId);
    assert.equal(added.sourceRevisionId, confirmed.sourceRevisionId);
    assert.equal(added.invalidateRender, true);
    assert.equal(added.visualChanged, true);
    const materials = await pool.query(`SELECT count(*)::int AS count FROM material_state`);
    assert.equal(materials.rows[0].count, 2);
    const loaded = await loadProject(pool);
    assert.equal(loaded.activeMaterialStateId, added.materialStateId);
    assert.equal(loaded.material.cast.characters.filter((character) => character.name === "Наблюдатель").length, 1);
    assert.equal(loaded.material.cast.characters.find((character) => character.name === "Наблюдатель").included, true);
    assert.equal(loaded.material.cast.speakers.filter((speaker) => speaker.characterName === "Наблюдатель").length, 0);
    assert.equal(loaded.material.cast.aliases.find((alias) => alias.surface === "Дмитрий Сергеевич").characterName, "Песков");
    assert.equal(loaded.material.cast.speakers.find((speaker) => speaker.sourceItemId === "u1").characterName, "Путин");

    const results = await pool.query(`SELECT material_state_id, status FROM storyboard_result`);
    assert.equal(results.rowCount, 2);
    assert.equal(results.rows.every((row) => row.status === "checked"), true);
    const carriedFrames = await pool.query(`
      SELECT storyboard_version.frames
      FROM storyboard_result
      JOIN storyboard_head ON storyboard_head.storyboard_result_id = storyboard_result.id
      JOIN storyboard_version ON storyboard_version.id = storyboard_head.active_storyboard_version_id
      WHERE storyboard_result.material_state_id = $1
    `, [added.materialStateId]);
    assert.equal(carriedFrames.rows[0].frames[0].id, "f1");
    assert.equal(carriedFrames.rows[0].frames[0].panels[0].id, "p1");
    assert.equal(carriedFrames.rows[0].frames[0].dialogue, spoken);
    const placed = await pool.query(`
      SELECT panel_id, current_asset_id, zoom, position_x, position_y, mirrored
      FROM panel_visual_state
      WHERE storyboard_version_id = (
        SELECT storyboard_head.active_storyboard_version_id
        FROM storyboard_result
        JOIN storyboard_head ON storyboard_head.storyboard_result_id = storyboard_result.id
        WHERE storyboard_result.material_state_id = $1
      )
    `, [added.materialStateId]);
    assert.equal(placed.rows[0].panel_id, "p1");
    assert.equal(placed.rows[0].current_asset_id, panelAsset);
    assert.equal(Number(placed.rows[0].zoom), 1.25);
    assert.equal(Number(placed.rows[0].position_x), 40);
    assert.equal(Number(placed.rows[0].position_y), 20);
    assert.equal(placed.rows[0].mirrored, true);
    const approvals = await pool.query(`
      SELECT visual_approval.storyboard_version_id
      FROM visual_approval
    `);
    assert.deepEqual(approvals.rows.map((row) => row.storyboard_version_id), [board.versionId]);
    const after = await store.load();
    assert.equal(after.status, "ready");
    assert.equal(after.materialStateId, added.materialStateId);
    assert.equal(after.approved, false);
    assert.equal(after.readyForVideo, false);
    const observer = after.characters.find((character) => character.name === "Наблюдатель");
    const putin = after.characters.find((character) => character.name === "Путин");
    const peskov = after.characters.find((character) => character.name === "Песков");
    assert.ok(observer);
    assert.equal(after.characters.filter((character) => character.name === "Наблюдатель").length, 1);
    assert.equal(observer.approvedAnchorId, null);
    assert.equal(putin.approvedAssetId, putinAsset);
    assert.equal(peskov.approvedAssetId, peskovAsset);
    assert.equal(after.frames.length, 1);
    assert.equal(after.frames[0].id, "f1");
    assert.equal(after.frames[0].panels[0].id, "p1");
    assert.equal(after.frames[0].panels[0].assetId, panelAsset);
    const assetsAfter = await pool.query(`SELECT count(*)::int AS count FROM visual_asset WHERE project_id = $1`, [SEEDED_PROJECT_ID]);
    const generationsAfter = await pool.query(`SELECT count(*)::int AS count FROM panel_generation`);
    assert.equal(assetsAfter.rows[0].count, assetsBefore.rows[0].count);
    assert.equal(generationsAfter.rows[0].count, generationsBefore.rows[0].count);
    const reloaded = await loadProject(pool);
    assert.equal(reloaded.material.cast.characters.find((character) => character.extractedName === "Наблюдатель").name, "Наблюдатель");
  });
});

test("rename keeps the same character anchor and never borrows another", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  await withDatabase(async (pool) => {
    const { readingId } = await confirmBase(pool);
    assert.equal((await replacePendingCast(pool, readingId, cast())).ok, true);
    const confirmed = await confirmReading(pool, { readingId });
    const putinAsset = await insertAsset(pool, pngA, "base-anchor");
    const peskovAsset = await insertAsset(pool, pngB, "base-anchor");
    const panelAsset = await insertAsset(pool, pngPanel, "uploaded-image");
    await installBoard(pool, confirmed.materialStateId, { putinAsset, peskovAsset, panelAsset });
    const store = createVisualStore(pool);
    const base = cast([{ name: "Наблюдатель", extractedName: "Наблюдатель", included: true }]);
    const added = await reviseMaterialState(pool, base);
    assert.equal(added.ok, true, added.kind);
    const renamedPutin = withRenames(base, { Путин: "Владимир" });
    const renamed = await reviseMaterialState(pool, renamedPutin);
    assert.equal(renamed.ok, true, renamed.kind);
    assert.equal(renamed.invalidateRender, true);
    const visual = await store.load();
    const vladimir = visual.characters.find((character) => character.name === "Владимир");
    const peskov = visual.characters.find((character) => character.name === "Песков");
    const observer = visual.characters.find((character) => character.name === "Наблюдатель");
    assert.equal(vladimir.approvedAssetId, putinAsset);
    assert.equal(peskov.approvedAssetId, peskovAsset);
    assert.equal(observer.approvedAnchorId, null);
    assert.equal(visual.characters.filter((character) => character.approvedAssetId === putinAsset).length, 1);
    const project = await loadProject(pool);
    assert.equal(project.material.cast.characters.find((character) => character.extractedName === "Путин").name, "Владимир");
    assert.equal(project.material.cast.speakers.find((speaker) => speaker.sourceItemId === "u1").characterName, "Владимир");
    assert.equal(project.material.cast.aliases.find((alias) => alias.surface === "Путин").characterName, "Владимир");
    assert.equal(project.material.cast.aliases.find((alias) => alias.surface === "Дмитрий Сергеевич").characterName, "Песков");

    const renamedPeskov = withRenames(renamedPutin, { Песков: "Секретарь" });
    const moved = await reviseMaterialState(pool, renamedPeskov);
    assert.equal(moved.ok, true, moved.kind);
    const claimed = withRenames(renamedPeskov, { Наблюдатель: "Песков" });
    const claim = await reviseMaterialState(pool, claimed);
    assert.equal(claim.ok, true, claim.kind);
    const afterClaim = await store.load();
    assert.equal(afterClaim.characters.find((character) => character.name === "Секретарь").approvedAssetId, peskovAsset);
    assert.equal(afterClaim.characters.find((character) => character.name === "Владимир").approvedAssetId, putinAsset);
    assert.equal(afterClaim.characters.find((character) => character.name === "Песков").approvedAnchorId, null);
    assert.equal(afterClaim.approved, false);
    assert.equal(afterClaim.readyForVideo, false);
    const returned = await loadProject(pool);
    assert.equal(returned.material.cast.characters.find((character) => character.extractedName === "Наблюдатель").name, "Песков");
    assert.equal(returned.material.cast.characters.find((character) => character.extractedName === "Наблюдатель").included, true);
  });
});

test("duplicate, stale, speaking exclusion, and unreconcilable cast edits write nothing", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  await withDatabase(async (pool) => {
    const { readingId } = await confirmBase(pool);
    assert.equal((await replacePendingCast(pool, readingId, cast())).ok, true);
    const confirmed = await confirmReading(pool, { readingId });
    const putinAsset = await insertAsset(pool, pngA, "base-anchor");
    const peskovAsset = await insertAsset(pool, pngB, "base-anchor");
    const panelAsset = await insertAsset(pool, pngPanel, "uploaded-image");
    const board = await installBoard(pool, confirmed.materialStateId, { putinAsset, peskovAsset, panelAsset });
    const before = await activeId(pool);
    const snapshot = async () => {
      const [materials, boards, approvals, anchors, assets] = await Promise.all([
        pool.query(`SELECT id FROM material_state ORDER BY created_at, id`),
        pool.query(`SELECT id, material_state_id FROM storyboard_result ORDER BY created_at, id`),
        pool.query(`SELECT storyboard_version_id FROM visual_approval`),
        pool.query(`SELECT character_name, anchor_version_id FROM character_anchor_head ORDER BY character_name`),
        pool.query(`SELECT count(*)::int AS count FROM visual_asset WHERE project_id = $1`, [SEEDED_PROJECT_ID]),
      ]);
      return {
        active: await activeId(pool),
        materials: materials.rows.map((row) => row.id),
        boards: boards.rows,
        approvals: approvals.rows.map((row) => row.storyboard_version_id),
        anchors: anchors.rows,
        assets: assets.rows[0].count,
      };
    };
    await pool.query(
      `INSERT INTO visual_approval (id, storyboard_version_id, snapshot) VALUES ($1, $2, '[]'::jsonb)`,
      [randomUUID(), board.versionId],
    );
    const unchanged = await snapshot();

    const duplicate = await reviseMaterialState(pool, cast([
      { name: "Путин", extractedName: "Другой", included: true },
    ]));
    assert.equal(duplicate.kind, "duplicate-name");
    assert.deepEqual(await snapshot(), unchanged);

    const speaking = await reviseMaterialState(pool, {
      ...cast(),
      characters: [
        { name: "Путин", extractedName: "Путин", included: false },
        { name: "Песков", extractedName: "Песков", included: true },
      ],
    });
    assert.equal(speaking.kind, "speaking-character");
    assert.deepEqual(await snapshot(), unchanged);

    const collided = await reviseMaterialState(pool, {
      characters: [
        { name: "Владимир", extractedName: "Путин", included: true },
        { name: "Путин", extractedName: "Путин", included: true },
      ],
      aliases: [
        { surface: "Путин", characterName: "Владимир" },
        { surface: "Дмитрий Сергеевич", characterName: "Путин" },
        { surface: "Песков", characterName: "Путин" },
      ],
      speakers: [{ sourceItemId: "u1", characterName: "Владимир" }],
    });
    assert.equal(collided.ok, false);
    assert.equal(collided.kind, "cast-reconciliation");
    assert.deepEqual(await snapshot(), unchanged);

    const omitted = await reviseMaterialState(pool, {
      ...cast(),
      characters: [{ name: "Путин", extractedName: "Путин", included: true }],
      aliases: [{ surface: "Путин", characterName: "Путин" }],
    });
    assert.equal(omitted.kind, "cast-reconciliation");
    assert.deepEqual(await snapshot(), unchanged);
    assert.equal(unchanged.active, before);
    const project = await loadProject(pool);
    assert.equal(project.material.cast.characters.length, 2);
    assert.equal(project.storyboards.find((item) => item.materialStateId === before).readyEligible, true);
  });
});
