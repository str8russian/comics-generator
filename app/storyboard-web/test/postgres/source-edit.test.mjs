import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import {
  beginReading,
  confirmReading,
  finishReading,
  loadProject,
  replacePendingCast,
  reviseMaterialState,
  reviseSourceUtterance,
  saveDraft,
} from "../../project-store.mjs";
import { enterProject, SEEDED_PROJECT_ID } from "../../project-scope.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const line = "Путин: Дмитрий Сергеевич, это Песков.";
const spoken = "Дмитрий Сергеевич, это Песков.";
const second = "Кто это сказал?";
const draft = `${line}\n${second}`;

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

function cast() {
  return {
    characters: [
      { name: "Путин", extractedName: "Путин", included: true },
      { name: "Песков", extractedName: "Песков", included: true },
    ],
    aliases: [
      { surface: "Путин", characterName: "Путин" },
      { surface: "Дмитрий Сергеевич", characterName: "Песков" },
      { surface: "Песков", characterName: "Песков" },
    ],
    speakers: [{ sourceItemId: "u1", characterName: "Путин" }],
  };
}

async function resetProject(pool) {
  await pool.query(`
    UPDATE project
    SET active_source_revision_id = NULL,
        active_material_state_id = NULL,
        current_reading_id = NULL
  `);
  await pool.query("DELETE FROM visual_approval");
  await pool.query("DELETE FROM storyboard_head");
  await pool.query("DELETE FROM panel_generation");
  await pool.query("DELETE FROM panel_visual_state");
  await pool.query("DELETE FROM storyboard_version");
  await pool.query("DELETE FROM storyboard_result");
  await pool.query("DELETE FROM project_style_seed");
  await pool.query("DELETE FROM character_anchor_head");
  await pool.query("UPDATE character_anchor_version SET parent_anchor_version_id = NULL");
  await pool.query("DELETE FROM character_anchor_version");
  await pool.query("DELETE FROM character_identity");
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
  await pool.query("DELETE FROM character_exclusion");
  await pool.query(`
    UPDATE working_draft
    SET text = '',
        revision_token = '00000000-0000-4000-8000-000000000002',
        updated_at = now()
  `);
}

test("a local utterance edit versions the source and an exclusion survives recheck", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  enterProject(SEEDED_PROJECT_ID);
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
  try {
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    await resetProject(pool);
    const saved = await saveDraft(pool, {
      text: draft,
      revisionToken: "00000000-0000-4000-8000-000000000002",
    });
    const started = await beginReading(pool);
    const model = people();
    await finishReading(pool, {
      readingId: started.readingId,
      sourceItems: sourceItems(),
      characters: model.characters,
      surfaceForms: model.surfaceForms,
    });
    await replacePendingCast(pool, started.readingId, cast());
    const confirmed = await confirmReading(pool, { readingId: started.readingId });
    assert.equal(confirmed.ok, true);
    const before = await pool.query(`SELECT id, text FROM source_revision WHERE id = $1`, [confirmed.sourceRevisionId]);

    const resultId = randomUUID();
    const versionId = randomUUID();
    const frames = [{
      id: "f1",
      sourceItemId: "u1",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      speakerPanel: 0,
      dialogue: spoken,
      displayBlock: { sourceItemId: "u1", start: 0, end: spoken.length },
      panels: [{ id: "p1", description: "Путин" }],
      durationFrames: 20,
    }, {
      id: "f2",
      sourceItemId: "u2",
      sourceRole: "utterance",
      origin: "source",
      layout: "single",
      speakerPanel: 0,
      dialogue: second,
      displayBlock: { sourceItemId: "u2", start: 0, end: second.length },
      panels: [{ id: "p2", description: "Путин" }],
    }];
    await pool.query(
      `INSERT INTO storyboard_result (id, material_state_id, status, stage_payload)
       VALUES ($1, $2, 'checked', $3::jsonb)`,
      [resultId, confirmed.materialStateId, JSON.stringify({ frames })],
    );
    await pool.query(
      `INSERT INTO storyboard_version (id, storyboard_result_id, frames) VALUES ($1, $2, $3::jsonb)`,
      [versionId, resultId, JSON.stringify(frames)],
    );
    await pool.query(
      `INSERT INTO storyboard_head (storyboard_result_id, active_storyboard_version_id) VALUES ($1, $2)`,
      [resultId, versionId],
    );
    await pool.query(
      `INSERT INTO panel_visual_state (id, storyboard_version_id, frame_id, panel_index, panel_id, current_asset_id, current_asset_origin)
       VALUES ($1, $2, 'f1', 0, 'p1', NULL, NULL)`,
      [randomUUID(), versionId],
    );

    const edited = await reviseSourceUtterance(pool, {
      sourceItemId: "u1",
      spokenText: "Дмитрий Сергеевич, это Песков, короче.",
      materialStateId: confirmed.materialStateId,
      storyboardVersionId: versionId,
    });
    assert.equal(edited.ok, true, edited.kind);
    assert.notEqual(edited.sourceRevisionId, confirmed.sourceRevisionId);
    const oldText = await pool.query(`SELECT text FROM source_revision WHERE id = $1`, [before.rows[0].id]);
    assert.equal(oldText.rows[0].text, draft);
    const nextText = await pool.query(`SELECT text FROM source_revision WHERE id = $1`, [edited.sourceRevisionId]);
    assert.equal(nextText.rows[0].text.startsWith("Путин: Дмитрий Сергеевич, это Песков, короче."), true);
    assert.equal(nextText.rows[0].text.endsWith(second), true);
    const items = await pool.query(`
      SELECT model_id, spoken_text, draft_start, draft_end
      FROM source_item
      WHERE interpretation_id = $1
      ORDER BY ordinal
    `, [edited.interpretationId]);
    assert.deepEqual(items.rows.map((row) => row.model_id), ["u1", "u2"]);
    assert.equal(items.rows[0].spoken_text, "Дмитрий Сергеевич, это Песков, короче.");
    assert.equal(items.rows[1].spoken_text, second);
    const project = await loadProject(pool);
    assert.equal(project.draft.text, nextText.rows[0].text);
    assert.equal(project.draft.revisionToken, edited.draft.revisionToken);
    assert.notEqual(project.draft.revisionToken, saved.revisionToken);
    const stale = await saveDraft(pool, { text: draft, revisionToken: saved.revisionToken });
    assert.equal(stale.kind, "stale-draft");
    const boards = await pool.query(`SELECT material_state_id FROM storyboard_result`);
    assert.equal(boards.rowCount, 2);
    const carried = await pool.query(`
      SELECT frames FROM storyboard_version
      WHERE id <> $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [versionId]);
    const carriedFrames = carried.rows[0].frames;
    assert.equal(carriedFrames[0].dialogue, "Дмитрий Сергеевич, это Песков, короче.");
    assert.equal(carriedFrames[0].panels[0].id, "p1");
    assert.equal(carriedFrames[0].durationFrames > 20, true);
    assert.match(carriedFrames[0].retainedImageNotice, /изображение сохранено/);
    const oldFrames = await pool.query(`SELECT frames FROM storyboard_version WHERE id = $1`, [versionId]);
    assert.equal(oldFrames.rows[0].frames[0].dialogue, spoken);

    const excluded = {
      ...cast(),
      characters: [
        { name: "Путин", extractedName: "Путин", included: true },
        { name: "Песков", extractedName: "Песков", included: false },
      ],
    };
    const material = await reviseMaterialState(pool, excluded);
    assert.equal(material.ok, true, material.kind);
    assert.equal(material.visualChanged, true);
    const loaded = await loadProject(pool);
    const peskov = loaded.material.cast.characters.find((character) => character.name === "Песков");
    assert.equal(peskov.included, false);
    assert.equal(loaded.material.sourceItems[0].sourceQuote.includes("Песков"), true);

    const blocked = await reviseMaterialState(pool, {
      ...excluded,
      characters: [
        { name: "Путин", extractedName: "Путин", included: false },
        { name: "Песков", extractedName: "Песков", included: false },
      ],
    });
    assert.equal(blocked.kind, "speaking-character");
    assert.match(blocked.message, /1 реплике/);
    const still = await loadProject(pool);
    assert.equal(still.activeMaterialStateId, material.materialStateId);

    const currentText = nextText.rows[0].text;
    const firstLine = currentText.slice(0, currentText.indexOf("\n"));
    const reread = await beginReading(pool);
    const again = await finishReading(pool, {
      readingId: reread.readingId,
      sourceItems: [
        {
          id: "u1",
          kind: "utterance",
          segmentIds: ["seg-0"],
          speakerStatus: "explicit",
          speakerLabel: "Путин",
          sourceQuote: firstLine,
          draftStart: 0,
          draftEnd: firstLine.length,
          text: firstLine.slice("Путин: ".length),
        },
        {
          id: "u2",
          kind: "utterance",
          segmentIds: ["seg-1"],
          speakerStatus: "unresolved",
          sourceQuote: second,
          draftStart: firstLine.length + 1,
          draftEnd: currentText.length,
          text: second,
        },
      ],
      characters: model.characters,
      surfaceForms: model.surfaceForms,
    });
    assert.equal(again.status, "ready", again.kind);
    const rereadPeskov = again.reading.cast.characters.find((character) => character.name === "Песков");
    assert.equal(rereadPeskov.included, false);

    const restored = await reviseMaterialState(pool, cast());
    assert.equal(restored.ok, true, restored.kind);
    const afterRestore = await loadProject(pool);
    assert.equal(afterRestore.material.cast.characters.find((character) => character.name === "Песков").included, true);
    const exclusions = await pool.query(`SELECT extracted_name FROM character_exclusion`);
    assert.equal(exclusions.rowCount, 0);
  } finally {
    await resetProject(pool).catch(() => {});
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]);
    guard.release();
    await pool.end();
  }
});
