import assert from "node:assert/strict";
import test from "node:test";
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

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const line1 = "Путин: Дмитрий Сергеевич, это Песков.";
const line2 = "Кто это сказал?";
const draft = `${line1}\n${line2}`;

function sourceItems() {
  return [
    {
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Путин",
      sourceQuote: line1,
      draftStart: 0,
      draftEnd: line1.length,
      text: "Дмитрий Сергеевич, это Песков.",
    },
    {
      id: "u2",
      kind: "utterance",
      segmentIds: ["seg-1"],
      speakerStatus: "unresolved",
      sourceQuote: line2,
      draftStart: line1.length + 1,
      draftEnd: line1.length + 1 + line2.length,
      text: line2,
    },
  ];
}

function modelPeople() {
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

function mappedCast() {
  return {
    characters: [{ name: "Путин" }, { name: "Песков" }],
    aliases: [
      { surface: "Путин", characterName: "Путин" },
      { surface: "Дмитрий Сергеевич", characterName: "Песков" },
      { surface: "Песков", characterName: "Песков" },
    ],
    speakers: [{ sourceItemId: "u1", characterName: "Путин" }],
  };
}

async function counts(pool) {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM source_revision) AS revisions,
      (SELECT count(*)::int FROM interpretation) AS interpretations,
      (SELECT count(*)::int FROM material_state) AS materials,
      (SELECT count(*)::int FROM reading) AS readings
  `);
  return result.rows[0];
}

async function resetProject(pool) {
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
  await pool.query(`
    UPDATE working_draft
    SET text = '',
        revision_token = '00000000-0000-4000-8000-000000000002',
        updated_at = now()
  `);
}

test("confirmation is atomic and a mapping correction versions only the material state", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
  try {
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, "comics_test");

    await resetProject(pool);
    const empty = await beginReading(pool);
    assert.equal(empty.httpStatus, 200);
    assert.equal(empty.status, "blocked");
    assert.deepEqual(empty.failures, [{ code: "empty-draft" }]);
    assert.deepEqual(await counts(pool), { revisions: 0, interpretations: 0, materials: 0, readings: 0 });

    await saveDraft(pool, {
      text: draft,
      revisionToken: "00000000-0000-4000-8000-000000000002",
    });
    const started = await beginReading(pool);
    assert.equal(started.draftText, draft);
    const people = modelPeople();
    const finished = await finishReading(pool, {
      readingId: started.readingId,
      sourceItems: sourceItems(),
      characters: people.characters,
      surfaceForms: people.surfaceForms,
    });
    assert.equal(finished.status, "ready");
    const changed = await saveDraft(pool, { text: `${draft}!`, revisionToken: started.revisionToken });
    assert.equal(changed.httpStatus, 200);
    const mismatch = await confirmReading(pool, { readingId: started.readingId });
    assert.equal(mismatch.httpStatus, 409);
    assert.equal(mismatch.kind, "stale-reading");
    const afterMismatch = await counts(pool);
    assert.equal(afterMismatch.revisions, 0);
    assert.equal(afterMismatch.interpretations, 0);
    assert.equal(afterMismatch.materials, 0);

    await resetProject(pool);
    const saved = await saveDraft(pool, {
      text: draft,
      revisionToken: "00000000-0000-4000-8000-000000000002",
    });
    const reading = await beginReading(pool);
    assert.equal(reading.draftText, draft);
    assert.equal(reading.revisionToken, saved.revisionToken);
    const ready = await finishReading(pool, {
      readingId: reading.readingId,
      sourceItems: sourceItems(),
      characters: people.characters,
      surfaceForms: people.surfaceForms,
    });
    assert.equal(ready.status, "ready");
    const beforeCast = await counts(pool);
    assert.equal(beforeCast.materials, 0);
    const addressBefore = await pool.query(
      "SELECT surface_text FROM pending_alias WHERE surface_text = 'Дмитрий Сергеевич'",
    );
    assert.equal(addressBefore.rowCount, 0);
    const replaced = await replacePendingCast(pool, reading.readingId, mappedCast());
    assert.equal(replaced.httpStatus, 200);
    const afterCast = await counts(pool);
    assert.equal(afterCast.revisions, 0);
    assert.equal(afterCast.interpretations, 0);
    assert.equal(afterCast.materials, 0);
    const pendingAddress = await pool.query(`
      SELECT pending_character.name
      FROM pending_alias
      JOIN pending_character ON pending_character.id = pending_alias.character_id
      WHERE pending_alias.surface_text = 'Дмитрий Сергеевич'
    `);
    assert.deepEqual(pendingAddress.rows.map((row) => row.name), ["Песков"]);
    const draftDuringCast = await loadProject(pool);
    assert.equal(draftDuringCast.draft.text, draft);

    const confirmed = await confirmReading(pool, { readingId: reading.readingId });
    assert.equal(confirmed.httpStatus, 200);
    const committed = await counts(pool);
    assert.deepEqual(
      { revisions: committed.revisions, interpretations: committed.interpretations, materials: committed.materials },
      { revisions: 1, interpretations: 1, materials: 1 },
    );
    const revision = await pool.query(
      "SELECT parent_source_revision_id, text FROM source_revision WHERE id = $1",
      [confirmed.sourceRevisionId],
    );
    assert.equal(revision.rows[0].parent_source_revision_id, null);
    assert.equal(revision.rows[0].text, draft);
    const aliases = await pool.query(`
      SELECT alias.surface_text, canonical_character.name
      FROM alias
      JOIN canonical_character ON canonical_character.id = alias.character_id
      WHERE alias.material_state_id = $1
    `, [confirmed.materialStateId]);
    const aliasRows = aliases.rows
      .map((row) => ({ surface_text: row.surface_text, name: row.name }))
      .sort((left, right) => (left.surface_text < right.surface_text ? -1 : left.surface_text > right.surface_text ? 1 : 0));
    assert.deepEqual(aliasRows, [
      { surface_text: "Дмитрий Сергеевич", name: "Песков" },
      { surface_text: "Песков", name: "Песков" },
      { surface_text: "Путин", name: "Путин" },
    ]);
    for (const alias of aliases.rows) {
      assert.equal(revision.rows[0].text.includes(alias.surface_text), true, alias.surface_text);
    }
    const unresolved = await pool.query(`
      SELECT speaker_status, speaker_label
      FROM source_item
      WHERE model_id = 'u2' AND interpretation_id = $1
    `, [confirmed.interpretationId]);
    assert.equal(unresolved.rows[0].speaker_status, "unresolved");
    assert.equal(unresolved.rows[0].speaker_label, null);
    const assignment = await pool.query(`
      SELECT character_id
      FROM speaker_assignment
      WHERE material_state_id = $1 AND source_item_model_id = 'u2'
    `, [confirmed.materialStateId]);
    assert.equal(assignment.rowCount, 0);
    const material = await pool.query(
      "SELECT parent_material_state_id, source_revision_id, interpretation_id FROM material_state WHERE id = $1",
      [confirmed.materialStateId],
    );
    assert.equal(material.rows[0].parent_material_state_id, null);
    assert.equal(material.rows[0].source_revision_id, confirmed.sourceRevisionId);
    assert.equal(material.rows[0].interpretation_id, confirmed.interpretationId);

    const previousCast = await pool.query(`
      SELECT canonical_character.ordinal, canonical_character.name,
             alias.surface_text, speaker_assignment.source_item_model_id
      FROM canonical_character
      LEFT JOIN alias ON alias.character_id = canonical_character.id
      LEFT JOIN speaker_assignment ON speaker_assignment.character_id = canonical_character.id
      WHERE canonical_character.material_state_id = $1
      ORDER BY canonical_character.ordinal, alias.surface_text, speaker_assignment.source_item_model_id
    `, [confirmed.materialStateId]);
    await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES ('00000000-0000-4000-8000-0000000000aa', $1, 'checked', '{"frames":[]}'::jsonb)`,
      [confirmed.materialStateId],
    );
    const corrected = await reviseMaterialState(pool, {
      characters: [{ name: "Путин" }, { name: "Песков" }, { name: "Секретарь" }],
      aliases: [
        { surface: "Путин", characterName: "Путин" },
        { surface: "Дмитрий Сергеевич", characterName: "Секретарь" },
        { surface: "Песков", characterName: "Песков" },
      ],
      speakers: [{ sourceItemId: "u1", characterName: "Путин" }],
    });
    assert.equal(corrected.httpStatus, 200);
    assert.equal(corrected.sourceRevisionId, confirmed.sourceRevisionId);
    assert.equal(corrected.interpretationId, confirmed.interpretationId);
    assert.notEqual(corrected.materialStateId, confirmed.materialStateId);
    const afterCorrection = await counts(pool);
    assert.equal(afterCorrection.revisions, 1);
    assert.equal(afterCorrection.interpretations, 1);
    assert.equal(afterCorrection.materials, 2);
    const stillPrevious = await pool.query(`
      SELECT canonical_character.ordinal, canonical_character.name,
             alias.surface_text, speaker_assignment.source_item_model_id
      FROM canonical_character
      LEFT JOIN alias ON alias.character_id = canonical_character.id
      LEFT JOIN speaker_assignment ON speaker_assignment.character_id = canonical_character.id
      WHERE canonical_character.material_state_id = $1
      ORDER BY canonical_character.ordinal, alias.surface_text, speaker_assignment.source_item_model_id
    `, [confirmed.materialStateId]);
    assert.deepEqual(stillPrevious.rows, previousCast.rows);
    const nextState = await pool.query(
      "SELECT parent_material_state_id, source_revision_id, interpretation_id FROM material_state WHERE id = $1",
      [corrected.materialStateId],
    );
    assert.equal(nextState.rows[0].parent_material_state_id, confirmed.materialStateId);
    assert.equal(nextState.rows[0].source_revision_id, confirmed.sourceRevisionId);
    assert.equal(nextState.rows[0].interpretation_id, confirmed.interpretationId);
    const revisionAfter = await pool.query("SELECT text FROM source_revision");
    assert.equal(revisionAfter.rowCount, 1);
    assert.equal(revisionAfter.rows[0].text, draft);
    const storedBoard = await pool.query("SELECT material_state_id, status FROM storyboard_result");
    assert.equal(storedBoard.rowCount, 2);
    assert.equal(storedBoard.rows.every((row) => row.status === "checked"), true);
    const boardIds = new Set(storedBoard.rows.map((row) => row.material_state_id));
    assert.equal(boardIds.has(confirmed.materialStateId), true);
    assert.equal(boardIds.has(corrected.materialStateId), true);
    const project = await loadProject(pool);
    assert.equal(project.activeMaterialStateId, corrected.materialStateId);
    assert.equal(project.storyboards.length, 2);
    const activeBoard = project.storyboards.find((board) => board.materialStateId === corrected.materialStateId);
    const previousBoard = project.storyboards.find((board) => board.materialStateId === confirmed.materialStateId);
    assert.equal(activeBoard.readyEligible, true);
    assert.equal(previousBoard.readyEligible, false);
    assert.equal(project.draft.text, draft);
  } finally {
    await resetProject(pool).catch(() => {});
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
