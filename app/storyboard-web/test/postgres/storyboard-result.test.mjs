import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createPool } from "../../db/pool.mjs";
import { migrate } from "../../db/migrate.mjs";
import { assessStage } from "../../fidelity.mjs";
import { assessDialogue } from "../../overflow.mjs";
import {
  beginReading,
  confirmReading,
  finishReading,
  loadProject,
  replacePendingCast,
  reviseMaterialState,
  saveDraft,
  stageActiveMaterial,
} from "../../project-store.mjs";
import { createServer } from "../../server.mjs";

const databaseUrl = process.env.STORYBOARD_TEST_DATABASE_URL;
const TEST_LOCK = "90210002026008";
const line1 = "Путин: Дмитрий Сергеевич, это Песков.";
const line2 = "Кто это сказал?";
const draft = `${line1}\n${line2}`;
const spoken1 = "Дмитрий Сергеевич, это Песков.";
const tamper = "ПОДМЕНА-РЕПЛИКИ";
const awkward = "кривая постановка без имени";

const env = {
  BASE_URL: "https://provider.example.test",
  CONTEST_API_TOKEN: "test-token",
  CONTEST_MODEL: "test-model",
};

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
      text: spoken1,
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

function assignedCast() {
  return {
    ...mappedCast(),
    speakers: [
      { sourceItemId: "u1", characterName: "Путин" },
      { sourceItemId: "u2", characterName: "Песков" },
    ],
  };
}

function frame(id, sourceItemId, description) {
  return {
    id,
    layout: "single",
    origin: "source",
    panels: [{ description }],
    sourceItemId,
    sourceRole: "utterance",
    speakerPanel: 0,
  };
}

function completion(content) {
  return JSON.stringify({
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: "stop",
    }],
  });
}

function codes(result) {
  return (result.failures || []).map((failure) => failure.code);
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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(port, { method, path }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        resolve({ status: res.statusCode, body, text });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("storyboard results bind to the captured material state and rebuild dialogue", {
  skip: databaseUrl ? false : "STORYBOARD_TEST_DATABASE_URL is unset",
}, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, "/comics_test");
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const pool = createPool(databaseUrl);
  const guard = await pool.connect();
  await guard.query("SELECT pg_advisory_lock($1::bigint)", [TEST_LOCK]);
  let server;
  try {
    await migrate({ connectionString: databaseUrl, logger: { log() {} } });
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, "comics_test");

    await resetProject(pool);
    await saveDraft(pool, {
      text: draft,
      revisionToken: "00000000-0000-4000-8000-000000000002",
    });
    const reading = await beginReading(pool);
    const people = modelPeople();
    const ready = await finishReading(pool, {
      readingId: reading.readingId,
      sourceItems: sourceItems(),
      characters: people.characters,
      surfaceForms: people.surfaceForms,
    });
    assert.equal(ready.status, "ready");
    assert.equal((await replacePendingCast(pool, reading.readingId, mappedCast())).httpStatus, 200);
    const confirmed = await confirmReading(pool, { readingId: reading.readingId });
    assert.equal(confirmed.httpStatus, 200);

    const items = sourceItems();
    const lost = assessDialogue([items[0]], [{
      id: "fLost",
      sourceItemId: "u1",
      sourceRole: "utterance",
      dialogue: spoken1.slice(0, 4),
      displayBlock: { sourceItemId: "u1", start: 0, end: 4 },
    }]);
    const duplicated = assessDialogue([items[0]], [
      {
        id: "fDup1",
        sourceItemId: "u1",
        sourceRole: "utterance",
        dialogue: spoken1,
        displayBlock: { sourceItemId: "u1", start: 0, end: spoken1.length },
      },
      {
        id: "fDup2",
        sourceItemId: "u1",
        sourceRole: "utterance",
        dialogue: spoken1,
        displayBlock: { sourceItemId: "u1", start: 0, end: spoken1.length },
      },
    ]);
    const changed = assessDialogue([items[0]], [{
      id: "fChanged",
      sourceItemId: "u1",
      sourceRole: "utterance",
      dialogue: "Песков",
      displayBlock: { sourceItemId: "u1", start: 0, end: spoken1.length },
    }]);
    const reordered = assessStage(items, {
      frames: [frame("f2", "u2", "сначала второй"), frame("f1", "u1", "потом первый")],
      review: [],
    });
    assert.deepEqual(codes(lost), ["lost-dialogue"]);
    assert.deepEqual(codes(duplicated), ["duplicated-dialogue"]);
    assert.deepEqual(codes(changed), ["changed-wording"]);
    assert.equal(codes(reordered).includes("reordered-dialogue"), true);

    let fetchCalls = 0;
    let mode = "good";
    let releaseFetch = () => {};
    let fetchStarted = () => {};
    const userMessages = [];
    const fetchImpl = async (_url, init) => {
      fetchCalls += 1;
      const requestBody = JSON.parse(init.body);
      userMessages.push(JSON.parse(requestBody.messages[1].content));
      if (mode === "hold") {
        fetchStarted();
        await new Promise((resolve) => {
          releaseFetch = resolve;
        });
      }
      const content = mode === "reorder"
        ? { frames: [frame("f2", "u2", "сначала второй"), frame("f1", "u1", "потом первый")], review: [] }
        : { frames: [frame("f1", "u1", awkward), frame("f2", "u2", "второй кадр")], review: [] };
      return {
        status: 200,
        async text() {
          return completion(content);
        },
      };
    };
    server = createServer({
      migrate: false,
      env,
      fetchImpl,
      projectStore: {
        loadProject: () => loadProject(pool),
        stageActiveMaterial: (options) => stageActiveMaterial(pool, options),
        reviseMaterialState: (cast) => reviseMaterialState(pool, cast),
      },
    });
    const port = await listen(server);
    const postStage = () => request(port, { method: "POST", path: "/api/storyboard-results" });
    const getProject = () => request(port, { method: "GET", path: "/api/project" });

    const unresolved = await postStage();
    assert.equal(unresolved.status, 200);
    assert.equal(unresolved.body.status, "blocked");
    assert.equal(unresolved.body.status === "ready", false);
    assert.equal(Object.hasOwn(unresolved.body, "frames"), false);
    assert.deepEqual(codes(unresolved.body), ["unresolved-speaker"]);
    assert.equal(unresolved.body.materialStateId, confirmed.materialStateId);
    assert.equal(unresolved.body.readyEligible, false);
    assert.equal(unresolved.text.includes(line2), false);
    assert.equal(fetchCalls, 0);
    const unresolvedRow = await pool.query(
      "SELECT material_state_id, status, failures, stage_payload FROM storyboard_result",
    );
    assert.equal(unresolvedRow.rowCount, 1);
    assert.equal(unresolvedRow.rows[0].material_state_id, confirmed.materialStateId);
    assert.equal(unresolvedRow.rows[0].status, "blocked");
    assert.equal(JSON.stringify(unresolvedRow.rows[0].failures).includes("unresolved-speaker"), true);
    assert.equal(unresolvedRow.rows[0].stage_payload, null);

    const legacy = await request(port, { method: "POST", path: "/api/storyboard" });
    assert.equal(legacy.status, 404);
    assert.equal(fetchCalls, 0);

    const corrected = await reviseMaterialState(pool, assignedCast());
    assert.equal(corrected.httpStatus, 200);
    for (const seeded of [lost, duplicated, changed]) {
      const stored = await stageActiveMaterial(pool, {
        stage: async () => ({ ok: false, httpStatus: 200, status: "blocked", failures: seeded.failures }),
      });
      assert.equal(stored.status, "blocked");
      assert.deepEqual(codes(stored), codes(seeded));
    }
    assert.equal(fetchCalls, 0);

    mode = "hold";
    let markFetchStarted;
    const started = new Promise((resolve) => {
      markFetchStarted = resolve;
    });
    fetchStarted = markFetchStarted;
    const racing = postStage();
    await started;
    const during = await loadProject(pool);
    assert.equal(during.activeMaterialStateId, corrected.materialStateId);
    const moved = await reviseMaterialState(pool, assignedCast());
    assert.equal(moved.httpStatus, 200);
    assert.notEqual(moved.materialStateId, corrected.materialStateId);
    releaseFetch();
    const raced = await racing;
    assert.equal(raced.status, 200);
    assert.equal(raced.body.status, "checked");
    assert.equal(raced.body.materialStateId, corrected.materialStateId);
    assert.notEqual(raced.body.materialStateId, moved.materialStateId);
    assert.equal(raced.body.readyEligible, false);
    assert.equal(fetchCalls, 1);
    const racedRow = await pool.query(
      `SELECT material_state_id, status FROM storyboard_result
       WHERE material_state_id = $1 AND status = 'checked'`,
      [corrected.materialStateId],
    );
    assert.equal(racedRow.rowCount, 1);
    assert.equal(racedRow.rows[0].material_state_id, corrected.materialStateId);

    mode = "reorder";
    const reversed = await postStage();
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.status, "blocked");
    assert.equal(codes(reversed.body).includes("reordered-dialogue"), true);
    assert.equal(reversed.body.materialStateId, moved.materialStateId);
    assert.equal(fetchCalls, 2);

    mode = "good";
    const checked = await postStage();
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, "checked");
    assert.equal(checked.body.status === "ready", false);
    assert.equal(checked.body.readyEligible, true);
    assert.equal(checked.body.materialStateId, moved.materialStateId);
    const uttered = checked.body.frames.find((entry) => entry.sourceItemId === "u1");
    assert.equal(uttered.dialogue, spoken1);
    assert.equal(uttered.panels[0].description, awkward);
    assert.equal(fetchCalls, 3);
    const castMessage = userMessages.at(-1);
    const peskov = castMessage.cast.characters.find((character) => character.name === "Песков");
    const alias = castMessage.cast.aliases.find((entry) => entry.surface === "Дмитрий Сергеевич");
    assert.equal(alias.characterId, peskov.id);
    assert.equal(Array.isArray(castMessage.cast.speakers), true);
    assert.equal(castMessage.sourceItems[0].text, spoken1);
    assert.deepEqual(Object.keys(castMessage).sort(), ["cast", "sourceItems"]);

    await pool.query(
      `UPDATE storyboard_result
       SET stage_payload = jsonb_set(stage_payload, '{frames,0,dialogue}', to_jsonb($2::text), true)
       WHERE id = (
         SELECT id FROM storyboard_result
         WHERE material_state_id = $1 AND status = 'checked'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )`,
      [moved.materialStateId, tamper],
    );
    const storedDialogue = await pool.query(
      `SELECT stage_payload->'frames'->0->>'dialogue' AS dialogue
       FROM storyboard_result
       WHERE material_state_id = $1 AND status = 'checked'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [moved.materialStateId],
    );
    assert.equal(storedDialogue.rows[0].dialogue, tamper);

    const project = await getProject();
    assert.equal(project.status, 200);
    assert.equal(project.body.activeMaterialStateId, moved.materialStateId);
    const boards = project.body.storyboards;
    const activeBoard = boards.find((board) => board.materialStateId === moved.materialStateId);
    const previousBoard = boards.find((board) => board.materialStateId === corrected.materialStateId);
    const unresolvedBoard = boards.find((board) => board.materialStateId === confirmed.materialStateId);
    assert.equal(activeBoard.status, "checked");
    assert.equal(activeBoard.readyEligible, true);
    assert.equal(previousBoard.status, "checked");
    assert.equal(previousBoard.readyEligible, false);
    assert.equal(unresolvedBoard.status, "blocked");
    assert.equal(unresolvedBoard.readyEligible, false);
    for (const board of boards) {
      const eligible = board.status === "checked" && board.materialStateId === project.body.activeMaterialStateId;
      assert.equal(board.readyEligible, eligible, board.materialStateId);
    }
    const rebuilt = activeBoard.frames.find((entry) => entry.sourceItemId === "u1");
    assert.equal(rebuilt.dialogue, spoken1);
    assert.equal(rebuilt.dialogue.includes("Дмитрий Сергеевич"), true);
    assert.equal(project.text.includes(tamper), false);
    assert.equal(rebuilt.panels[0].description, awkward);
    const spokenItem = activeBoard.sourceItems.find((item) => item.id === "u1");
    assert.equal(spokenItem.text, spoken1);

    const readyStatuses = await pool.query("SELECT status FROM storyboard_result WHERE status = 'ready'");
    assert.equal(readyStatuses.rowCount, 0);
    const blockedCodes = await pool.query(
      "SELECT failures FROM storyboard_result WHERE status = 'blocked'",
    );
    const storedCodes = blockedCodes.rows.flatMap((row) => (row.failures || []).map((failure) => failure.code));
    for (const code of ["unresolved-speaker", "lost-dialogue", "duplicated-dialogue", "reordered-dialogue", "changed-wording"]) {
      assert.equal(storedCodes.includes(code), true, code);
    }
  } finally {
    if (server) await close(server).catch(() => {});
    await resetProject(pool).catch(() => {});
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await guard.query("SELECT pg_advisory_unlock($1::bigint)", [TEST_LOCK]).catch(() => {});
    guard.release();
    await pool.end();
  }
});
