import { randomUUID } from "node:crypto";
import { isEmptyDraft } from "./fidelity.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_CODE = /^[a-z]+(?:-[a-z]+)*$/;

export function draftInputError({ text, revisionToken }) {
  if (typeof text !== "string" || typeof revisionToken !== "string" || !UUID_PATTERN.test(revisionToken)) {
    return "invalid-request";
  }
  if (text.includes("\u0000") || hasUnpairedSurrogate(text)) return "invalid-request";
  return null;
}

function hasUnpairedSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function databaseFailure() {
  return { ok: false, httpStatus: 503, kind: "database" };
}

function invalidRequest() {
  return { ok: false, httpStatus: 400, kind: "invalid-request" };
}

function notFound() {
  return { ok: false, httpStatus: 404, kind: "not-found" };
}

function staleReading() {
  return { ok: false, httpStatus: 409, status: "failed", kind: "stale-reading" };
}

function textValue(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\u0000") && !hasUnpairedSurrogate(value);
}

export function normalizeCast(cast) {
  if (!cast || typeof cast !== "object" || Array.isArray(cast)) return { error: "invalid-request" };
  if (!Array.isArray(cast.characters) || !Array.isArray(cast.aliases) || !Array.isArray(cast.speakers)) {
    return { error: "invalid-request" };
  }
  const characters = [];
  const names = new Set();
  for (const character of cast.characters) {
    if (!character || typeof character !== "object" || Array.isArray(character) || !textValue(character.name)) {
      return { error: "invalid-request" };
    }
    if (names.has(character.name)) return { error: "invalid-request" };
    names.add(character.name);
    characters.push({ name: character.name });
  }
  const aliases = [];
  const surfaces = new Set();
  for (const alias of cast.aliases) {
    if (!alias || typeof alias !== "object" || Array.isArray(alias)) return { error: "invalid-request" };
    if (!textValue(alias.surface) || !names.has(alias.characterName)) return { error: "invalid-request" };
    if (surfaces.has(alias.surface)) return { error: "invalid-request" };
    surfaces.add(alias.surface);
    aliases.push({ surface: alias.surface, characterName: alias.characterName });
  }
  const speakers = [];
  const seenItems = new Set();
  for (const speaker of cast.speakers) {
    if (!speaker || typeof speaker !== "object" || Array.isArray(speaker)) return { error: "invalid-request" };
    if (typeof speaker.sourceItemId !== "string" || !ID_PATTERN.test(speaker.sourceItemId)) {
      return { error: "invalid-request" };
    }
    if (!names.has(speaker.characterName) || seenItems.has(speaker.sourceItemId)) return { error: "invalid-request" };
    seenItems.add(speaker.sourceItemId);
    speakers.push({ sourceItemId: speaker.sourceItemId, characterName: speaker.characterName });
  }
  return { characters, aliases, speakers };
}

function publicItem(item) {
  const next = {
    id: item.id,
    kind: item.kind,
    speakerStatus: item.speakerStatus,
    sourceQuote: item.sourceQuote,
  };
  if (item.speakerLabel) next.speakerLabel = item.speakerLabel;
  return next;
}

function findingsFor(items, assigned) {
  const findings = [];
  for (const item of items) {
    if (item.kind !== "utterance" || assigned.has(item.id)) continue;
    findings.push({
      code: "unresolved-speaker",
      sourceItemId: item.id,
      sourceQuote: item.sourceQuote,
    });
  }
  return findings;
}

function nameForLabel(label, characters, surfaceForms) {
  const named = characters.find((character) => character.name === label);
  if (named) return named.name;
  const form = surfaceForms.find((entry) => entry.quote === label && entry.characterId);
  if (!form) return null;
  const linked = characters.find((character) => character.id === form.characterId);
  return linked ? linked.name : null;
}

function initialCast(sourceItems, characters, surfaceForms) {
  const byId = new Map(characters.map((character) => [character.id, character.name]));
  const aliases = [];
  const seen = new Set();
  for (const form of surfaceForms) {
    if (!form.characterId || !byId.has(form.characterId) || seen.has(form.quote)) continue;
    seen.add(form.quote);
    aliases.push({ surface: form.quote, characterName: byId.get(form.characterId) });
  }
  const speakers = [];
  for (const item of sourceItems) {
    if (item.speakerStatus !== "explicit" && item.speakerStatus !== "inferred") continue;
    const name = nameForLabel(item.speakerLabel, characters, surfaceForms);
    if (!name) continue;
    speakers.push({ sourceItemId: item.id, characterName: name });
  }
  return {
    characters: characters.map((character) => ({ name: character.name })),
    aliases,
    speakers,
  };
}

function snapshotError(draftText, sourceItems, characters, surfaceForms) {
  if (!Array.isArray(sourceItems) || sourceItems.length === 0) return "invalid-output";
  if (!Array.isArray(characters) || !Array.isArray(surfaceForms)) return "invalid-output";
  const characterIds = new Set();
  for (const character of characters) {
    if (!character || typeof character !== "object" || !ID_PATTERN.test(character.id) || !textValue(character.name)) {
      return "invalid-output";
    }
    if (characterIds.has(character.id)) return "invalid-output";
    characterIds.add(character.id);
  }
  const surfaceIds = new Set();
  for (const form of surfaceForms) {
    if (!form || typeof form !== "object" || !ID_PATTERN.test(form.id) || !textValue(form.quote)) return "invalid-output";
    if (!["speaker-label", "address", "mention"].includes(form.role)) return "invalid-output";
    if (surfaceIds.has(form.id)) return "invalid-output";
    surfaceIds.add(form.id);
    if (form.characterId != null && !characterIds.has(form.characterId)) return "invalid-output";
    if (!draftText.includes(form.quote)) return "invalid-output";
  }
  const itemIds = new Set();
  for (const item of sourceItems) {
    if (!item || typeof item !== "object" || !ID_PATTERN.test(item.id) || itemIds.has(item.id)) return "invalid-output";
    itemIds.add(item.id);
    if (!["utterance", "action", "context", "note"].includes(item.kind)) return "invalid-output";
    if (!["explicit", "inferred", "unresolved", "none"].includes(item.speakerStatus)) return "invalid-output";
    if (typeof item.draftStart !== "number" || typeof item.draftEnd !== "number") return "invalid-output";
    if (!Number.isInteger(item.draftStart) || !Number.isInteger(item.draftEnd)) return "invalid-output";
    if (item.draftStart < 0 || item.draftEnd < item.draftStart) return "invalid-output";
    if (draftText.slice(item.draftStart, item.draftEnd) !== item.sourceQuote) return "invalid-output";
    if (typeof item.text !== "string") return "invalid-output";
    const labeled = item.speakerStatus === "explicit" || item.speakerStatus === "inferred";
    if (labeled && !textValue(item.speakerLabel)) return "invalid-output";
    if (!labeled && item.speakerLabel != null) return "invalid-output";
  }
  return null;
}

async function withClient(pool, run) {
  let client;
  try {
    client = await pool.connect();
  } catch {
    return databaseFailure();
  }
  try {
    return await run(client);
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return databaseFailure();
  } finally {
    client.release();
  }
}

async function rollback(client) {
  await client.query("ROLLBACK").catch(() => {});
}

async function lockDraft(client) {
  const result = await client.query(`
    SELECT project.id AS project_id,
           project.active_source_revision_id,
           project.active_material_state_id,
           project.current_reading_id,
           working_draft.text AS draft_text,
           working_draft.revision_token
    FROM project
    JOIN working_draft ON working_draft.project_id = project.id
    WHERE project.singleton = true
    FOR UPDATE
  `);
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function insertCast(client, readingId, cast) {
  const nameToId = new Map();
  for (let index = 0; index < cast.characters.length; index += 1) {
    const id = randomUUID();
    const name = cast.characters[index].name;
    if (!nameToId.has(name)) nameToId.set(name, id);
    await client.query(
      `INSERT INTO pending_character (id, reading_id, ordinal, name) VALUES ($1, $2, $3, $4)`,
      [id, readingId, index, name],
    );
  }
  for (const alias of cast.aliases) {
    await client.query(
      `INSERT INTO pending_alias (id, reading_id, surface_text, character_id) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), readingId, alias.surface, nameToId.get(alias.characterName)],
    );
  }
  for (const speaker of cast.speakers) {
    await client.query(
      `INSERT INTO pending_speaker (reading_id, source_item_model_id, character_id) VALUES ($1, $2, $3)`,
      [readingId, speaker.sourceItemId, nameToId.get(speaker.characterName)],
    );
  }
}

async function replaceCastRows(client, readingId, cast) {
  await client.query("DELETE FROM pending_speaker WHERE reading_id = $1", [readingId]);
  await client.query("DELETE FROM pending_alias WHERE reading_id = $1", [readingId]);
  await client.query("DELETE FROM pending_character WHERE reading_id = $1", [readingId]);
  await insertCast(client, readingId, cast);
}

function readingView({ id, text, sourceItems, characters, surfaceForms, cast }) {
  const items = sourceItems.map(publicItem);
  return {
    id,
    status: "ready",
    text,
    sourceItems: items,
    characters,
    surfaceForms: surfaceForms.map((form) => {
      const next = { id: form.id, quote: form.quote, role: form.role };
      if (form.characterId) next.characterId = form.characterId;
      return next;
    }),
    cast,
    findings: findingsFor(items, new Set(cast.speakers.map((speaker) => speaker.sourceItemId))),
  };
}

async function presentReading(queryable, readingId) {
  if (!readingId) return null;
  const reading = await queryable.query(
    `SELECT id, draft_text, status, snapshot FROM reading WHERE id = $1`,
    [readingId],
  );
  if (reading.rowCount !== 1) return null;
  const row = reading.rows[0];
  const snapshot = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const sourceItems = Array.isArray(snapshot.sourceItems) ? snapshot.sourceItems : [];
  const characters = Array.isArray(snapshot.characters) ? snapshot.characters : [];
  const surfaceForms = Array.isArray(snapshot.surfaceForms) ? snapshot.surfaceForms : [];
  const castRows = await queryable.query(
    `SELECT name FROM pending_character WHERE reading_id = $1 ORDER BY ordinal, id`,
    [readingId],
  );
  const aliasRows = await queryable.query(`
    SELECT pending_alias.surface_text, pending_character.name
    FROM pending_alias
    JOIN pending_character ON pending_character.id = pending_alias.character_id
    WHERE pending_alias.reading_id = $1
    ORDER BY pending_alias.surface_text, pending_character.name
  `, [readingId]);
  const speakerRows = await queryable.query(`
    SELECT pending_speaker.source_item_model_id, pending_character.name
    FROM pending_speaker
    JOIN pending_character ON pending_character.id = pending_speaker.character_id
    WHERE pending_speaker.reading_id = $1
    ORDER BY pending_speaker.source_item_model_id
  `, [readingId]);
  const cast = {
    characters: castRows.rows.map((character) => ({ name: character.name })),
    aliases: aliasRows.rows.map((alias) => ({ surface: alias.surface_text, characterName: alias.name })),
    speakers: speakerRows.rows.map((speaker) => ({
      sourceItemId: speaker.source_item_model_id,
      characterName: speaker.name,
    })),
  };
  const items = sourceItems.map(publicItem);
  return {
    id: row.id,
    status: row.status,
    text: row.draft_text,
    sourceItems: items,
    characters: characters.map((character) => {
      const next = { id: character.id, name: character.name };
      return next;
    }),
    surfaceForms: surfaceForms.map((form) => {
      const next = { id: form.id, quote: form.quote, role: form.role };
      if (form.characterId) next.characterId = form.characterId;
      return next;
    }),
    cast,
    findings: findingsFor(items, new Set(cast.speakers.map((speaker) => speaker.sourceItemId))),
  };
}

async function presentMaterial(queryable, materialStateId) {
  if (!materialStateId) return null;
  const state = await queryable.query(`
    SELECT material_state.id, material_state.source_revision_id, material_state.interpretation_id
    FROM material_state
    WHERE material_state.id = $1
  `, [materialStateId]);
  if (state.rowCount !== 1) return null;
  const row = state.rows[0];
  const items = await queryable.query(`
    SELECT model_id, kind, speaker_status, speaker_label, source_quote
    FROM source_item
    WHERE interpretation_id = $1
    ORDER BY ordinal
  `, [row.interpretation_id]);
  const characters = await queryable.query(`
    SELECT name FROM canonical_character
    WHERE material_state_id = $1
    ORDER BY ordinal, id
  `, [materialStateId]);
  const aliases = await queryable.query(`
    SELECT alias.surface_text, canonical_character.name
    FROM alias
    JOIN canonical_character ON canonical_character.id = alias.character_id
    WHERE alias.material_state_id = $1
    ORDER BY alias.surface_text, canonical_character.name
  `, [materialStateId]);
  const speakers = await queryable.query(`
    SELECT speaker_assignment.source_item_model_id, canonical_character.name
    FROM speaker_assignment
    JOIN canonical_character ON canonical_character.id = speaker_assignment.character_id
    WHERE speaker_assignment.material_state_id = $1
    ORDER BY speaker_assignment.source_item_model_id
  `, [materialStateId]);
  const sourceItems = items.rows.map((item) => publicItem({
    id: item.model_id,
    kind: item.kind,
    speakerStatus: item.speaker_status,
    speakerLabel: item.speaker_label,
    sourceQuote: item.source_quote,
  }));
  const cast = {
    characters: characters.rows.map((character) => ({ name: character.name })),
    aliases: aliases.rows.map((alias) => ({ surface: alias.surface_text, characterName: alias.name })),
    speakers: speakers.rows.map((speaker) => ({
      sourceItemId: speaker.source_item_model_id,
      characterName: speaker.name,
    })),
  };
  return {
    id: row.id,
    sourceRevisionId: row.source_revision_id,
    interpretationId: row.interpretation_id,
    sourceItems,
    cast,
    findings: findingsFor(sourceItems, new Set(cast.speakers.map((speaker) => speaker.sourceItemId))),
  };
}

export async function loadProject(pool) {
  try {
    const draft = await pool.query(
      `SELECT project.active_source_revision_id,
              project.active_material_state_id,
              project.current_reading_id,
              working_draft.text,
              working_draft.revision_token
       FROM project
       JOIN working_draft ON working_draft.project_id = project.id
       WHERE project.singleton = true`,
    );
    if (draft.rowCount !== 1) return null;
    const row = draft.rows[0];
    const revisions = await pool.query(
      `SELECT id, parent_source_revision_id, created_at
       FROM source_revision
       ORDER BY created_at, id`,
    );
    const storyboards = await pool.query(
      `SELECT DISTINCT ON (storyboard_result.material_state_id)
              storyboard_result.material_state_id,
              material_state.source_revision_id,
              storyboard_result.status,
              (storyboard_result.status = 'checked'
               AND storyboard_result.material_state_id IS NOT DISTINCT FROM project.active_material_state_id) AS ready_eligible
       FROM storyboard_result
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN project ON project.singleton = true
       ORDER BY storyboard_result.material_state_id, storyboard_result.created_at DESC, storyboard_result.id DESC`,
    );
    const reading = await presentReading(pool, row.current_reading_id);
    const material = await presentMaterial(pool, row.active_material_state_id);
    return {
      draft: { text: row.text, revisionToken: row.revision_token },
      activeSourceRevisionId: row.active_source_revision_id,
      activeMaterialStateId: row.active_material_state_id,
      reading,
      material,
      sourceRevisions: revisions.rows.map((revision) => ({
        id: revision.id,
        parentSourceRevisionId: revision.parent_source_revision_id,
        createdAt: revision.created_at instanceof Date ? revision.created_at.toISOString() : revision.created_at,
      })),
      storyboards: storyboards.rows.map((storyboard) => ({
        materialStateId: storyboard.material_state_id,
        sourceRevisionId: storyboard.source_revision_id,
        status: storyboard.status,
        readyEligible: storyboard.ready_eligible === true,
      })),
    };
  } catch {
    return null;
  }
}

export async function saveDraft(pool, input) {
  if (draftInputError(input)) {
    return { ok: false, httpStatus: 400, kind: "invalid-request" };
  }
  try {
    const nextToken = randomUUID();
    const updated = await pool.query(
      `UPDATE working_draft
       SET text = $1, revision_token = $2, updated_at = now()
       WHERE revision_token = $3`,
      [input.text, nextToken, input.revisionToken],
    );
    if (updated.rowCount !== 1) {
      return { ok: false, httpStatus: 409, kind: "stale-draft" };
    }
    return { ok: true, httpStatus: 200, revisionToken: nextToken };
  } catch {
    return databaseFailure();
  }
}

export async function beginReading(pool) {
  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    if (!locked) {
      await rollback(client);
      return databaseFailure();
    }
    if (isEmptyDraft(locked.draft_text)) {
      await rollback(client);
      return { ok: true, httpStatus: 200, status: "blocked", failures: [{ code: "empty-draft" }] };
    }
    const readingId = randomUUID();
    await client.query(
      `INSERT INTO reading (id, draft_text, draft_revision_token, status)
       VALUES ($1, $2, $3, 'pending')`,
      [readingId, locked.draft_text, locked.revision_token],
    );
    await client.query(
      `UPDATE project SET current_reading_id = $1 WHERE id = $2`,
      [readingId, locked.project_id],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      httpStatus: 200,
      readingId,
      draftText: locked.draft_text,
      revisionToken: locked.revision_token,
    };
  });
}

export async function finishReading(pool, input) {
  if (!input || typeof input.readingId !== "string" || !UUID_PATTERN.test(input.readingId)) return invalidRequest();
  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    const reading = await client.query(
      `SELECT id, draft_text, status FROM reading WHERE id = $1 FOR UPDATE`,
      [input.readingId],
    );
    if (!locked || reading.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const row = reading.rows[0];
    if (locked.current_reading_id !== input.readingId || row.status !== "pending") {
      await rollback(client);
      return staleReading();
    }
    if (locked.draft_text !== row.draft_text) {
      await client.query(
        `UPDATE reading SET status = 'stale', failure_kind = NULL, blocked_codes = NULL, snapshot = NULL WHERE id = $1`,
        [input.readingId],
      );
      await client.query("COMMIT");
      return staleReading();
    }
    if (input.failure) {
      const kind = typeof input.failure.kind === "string" && SAFE_CODE.test(input.failure.kind)
        ? input.failure.kind
        : null;
      await client.query(
        `UPDATE reading SET status = 'failed', failure_kind = $2, blocked_codes = NULL, snapshot = NULL WHERE id = $1`,
        [input.readingId, kind],
      );
      await client.query("COMMIT");
      return { ok: false, httpStatus: input.failure.httpStatus || 502, status: "failed", kind: kind || "invalid-output" };
    }
    if (input.blocked) {
      const codes = Array.isArray(input.blocked.failures)
        ? input.blocked.failures.map((failure) => failure?.code).filter((code) => SAFE_CODE.test(code))
        : [];
      await client.query(
        `UPDATE reading SET status = 'blocked', failure_kind = NULL, blocked_codes = $2, snapshot = NULL WHERE id = $1`,
        [input.readingId, codes],
      );
      await client.query("COMMIT");
      return { ok: true, httpStatus: 200, status: "blocked", failures: codes.map((code) => ({ code })) };
    }
    const sourceItems = input.sourceItems;
    const characters = input.characters;
    const surfaceForms = input.surfaceForms;
    if (snapshotError(row.draft_text, sourceItems, characters, surfaceForms)) {
      await client.query(
        `UPDATE reading SET status = 'failed', failure_kind = 'invalid-output', blocked_codes = NULL, snapshot = NULL WHERE id = $1`,
        [input.readingId],
      );
      await client.query("COMMIT");
      return { ok: false, httpStatus: 502, status: "failed", kind: "invalid-output" };
    }
    const cast = initialCast(sourceItems, characters, surfaceForms);
    await client.query(
      `UPDATE reading
       SET status = 'ready', failure_kind = NULL, blocked_codes = NULL, snapshot = $2::jsonb
       WHERE id = $1`,
      [input.readingId, JSON.stringify({ sourceItems, characters, surfaceForms })],
    );
    await insertCast(client, input.readingId, cast);
    await client.query("COMMIT");
    return {
      ok: true,
      httpStatus: 200,
      status: "ready",
      reading: readingView({
        id: input.readingId,
        text: row.draft_text,
        sourceItems,
        characters,
        surfaceForms,
        cast,
      }),
    };
  });
}

async function utteranceIds(client, snapshot) {
  const items = Array.isArray(snapshot?.sourceItems) ? snapshot.sourceItems : [];
  return new Set(items.filter((item) => item.kind === "utterance").map((item) => item.id));
}

function castFits(cast, text, utterances) {
  for (const alias of cast.aliases) {
    if (!text.includes(alias.surface)) return false;
  }
  for (const speaker of cast.speakers) {
    if (!utterances.has(speaker.sourceItemId)) return false;
  }
  return true;
}

export async function replacePendingCast(pool, readingId, cast) {
  if (typeof readingId !== "string" || !UUID_PATTERN.test(readingId)) return notFound();
  const normalized = normalizeCast(cast);
  if (normalized.error) return invalidRequest();
  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    const reading = await client.query(
      `SELECT id, draft_text, status, snapshot FROM reading WHERE id = $1 FOR UPDATE`,
      [readingId],
    );
    if (reading.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const row = reading.rows[0];
    if (!locked || locked.current_reading_id !== readingId || row.status !== "ready" || locked.draft_text !== row.draft_text) {
      await rollback(client);
      return staleReading();
    }
    const confirmed = await client.query(`SELECT id FROM interpretation WHERE reading_id = $1`, [readingId]);
    if (confirmed.rowCount > 0) {
      await rollback(client);
      return staleReading();
    }
    const utterances = await utteranceIds(client, row.snapshot);
    if (!castFits(normalized, row.draft_text, utterances)) {
      await rollback(client);
      return invalidRequest();
    }
    await replaceCastRows(client, readingId, normalized);
    await client.query("COMMIT");
    return { ok: true, httpStatus: 200, status: "ok" };
  });
}

export async function confirmReading(pool, input) {
  const readingId = input?.readingId;
  if (typeof readingId !== "string" || !UUID_PATTERN.test(readingId)) return notFound();
  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    const reading = await client.query(
      `SELECT id, draft_text, status, snapshot FROM reading WHERE id = $1 FOR UPDATE`,
      [readingId],
    );
    if (reading.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const row = reading.rows[0];
    if (!locked || locked.current_reading_id !== readingId || row.status !== "ready" || locked.draft_text !== row.draft_text) {
      await rollback(client);
      return staleReading();
    }
    const existing = await client.query(`SELECT id FROM interpretation WHERE reading_id = $1`, [readingId]);
    if (existing.rowCount > 0) {
      await rollback(client);
      return staleReading();
    }
    const snapshot = row.snapshot;
    if (!snapshot || !Array.isArray(snapshot.sourceItems)) {
      await rollback(client);
      return staleReading();
    }
    const pendingAliases = await client.query(
      `SELECT surface_text FROM pending_alias WHERE reading_id = $1`,
      [readingId],
    );
    if (pendingAliases.rows.some((alias) => !row.draft_text.includes(alias.surface_text))) {
      await rollback(client);
      return invalidRequest();
    }
    const revisionId = randomUUID();
    const interpretationId = randomUUID();
    const materialId = randomUUID();
    await client.query(
      `INSERT INTO source_revision (id, parent_source_revision_id, text) VALUES ($1, $2, $3)`,
      [revisionId, locked.active_source_revision_id, row.draft_text],
    );
    await client.query(
      `INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)`,
      [interpretationId, revisionId, readingId],
    );
    for (let index = 0; index < snapshot.sourceItems.length; index += 1) {
      const item = snapshot.sourceItems[index];
      const labeled = item.speakerStatus === "explicit" || item.speakerStatus === "inferred";
      await client.query(
        `INSERT INTO source_item (
           interpretation_id, ordinal, model_id, kind, speaker_status, speaker_label,
           draft_start, draft_end, source_quote, spoken_text
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          interpretationId,
          index,
          item.id,
          item.kind,
          item.speakerStatus,
          labeled ? item.speakerLabel : null,
          item.draftStart,
          item.draftEnd,
          item.sourceQuote,
          item.text,
        ],
      );
    }
    for (const character of snapshot.characters || []) {
      await client.query(
        `INSERT INTO provisional_character (interpretation_id, model_id, name) VALUES ($1, $2, $3)`,
        [interpretationId, character.id, character.name],
      );
    }
    for (const form of snapshot.surfaceForms || []) {
      await client.query(
        `INSERT INTO surface_form (interpretation_id, model_id, quote, role, proposed_character_model_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [interpretationId, form.id, form.quote, form.role, form.characterId ?? null],
      );
    }
    await client.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id, parent_material_state_id)
       VALUES ($1, $2, $3, NULL)`,
      [materialId, revisionId, interpretationId],
    );
    const characters = await client.query(
      `SELECT id, ordinal, name FROM pending_character WHERE reading_id = $1 ORDER BY ordinal, id`,
      [readingId],
    );
    const idMap = new Map();
    for (const character of characters.rows) {
      const canonicalId = randomUUID();
      idMap.set(character.id, canonicalId);
      await client.query(
        `INSERT INTO canonical_character (id, material_state_id, ordinal, name) VALUES ($1, $2, $3, $4)`,
        [canonicalId, materialId, character.ordinal, character.name],
      );
    }
    const aliases = await client.query(
      `SELECT surface_text, character_id FROM pending_alias WHERE reading_id = $1`,
      [readingId],
    );
    for (const alias of aliases.rows) {
      await client.query(
        `INSERT INTO alias (id, material_state_id, surface_text, character_id) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), materialId, alias.surface_text, idMap.get(alias.character_id)],
      );
    }
    const speakers = await client.query(
      `SELECT source_item_model_id, character_id FROM pending_speaker WHERE reading_id = $1`,
      [readingId],
    );
    for (const speaker of speakers.rows) {
      await client.query(
        `INSERT INTO speaker_assignment (material_state_id, source_item_model_id, character_id)
         VALUES ($1, $2, $3)`,
        [materialId, speaker.source_item_model_id, idMap.get(speaker.character_id)],
      );
    }
    await client.query(
      `UPDATE project
       SET active_source_revision_id = $1, active_material_state_id = $2, current_reading_id = NULL
       WHERE id = $3`,
      [revisionId, materialId, locked.project_id],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      httpStatus: 200,
      sourceRevisionId: revisionId,
      interpretationId,
      materialStateId: materialId,
    };
  });
}

async function insertMaterialCast(client, materialId, cast) {
  const nameToId = new Map();
  for (let index = 0; index < cast.characters.length; index += 1) {
    const id = randomUUID();
    const name = cast.characters[index].name;
    if (!nameToId.has(name)) nameToId.set(name, id);
    await client.query(
      `INSERT INTO canonical_character (id, material_state_id, ordinal, name) VALUES ($1, $2, $3, $4)`,
      [id, materialId, index, name],
    );
  }
  for (const alias of cast.aliases) {
    await client.query(
      `INSERT INTO alias (id, material_state_id, surface_text, character_id) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), materialId, alias.surface, nameToId.get(alias.characterName)],
    );
  }
  for (const speaker of cast.speakers) {
    await client.query(
      `INSERT INTO speaker_assignment (material_state_id, source_item_model_id, character_id)
       VALUES ($1, $2, $3)`,
      [materialId, speaker.sourceItemId, nameToId.get(speaker.characterName)],
    );
  }
}

export async function reviseMaterialState(pool, cast) {
  const normalized = normalizeCast(cast);
  if (normalized.error) return invalidRequest();
  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    if (!locked || !locked.active_material_state_id) {
      await rollback(client);
      return notFound();
    }
    const current = await client.query(
      `SELECT id, source_revision_id, interpretation_id
       FROM material_state
       WHERE id = $1`,
      [locked.active_material_state_id],
    );
    if (current.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const state = current.rows[0];
    const revision = await client.query(`SELECT text FROM source_revision WHERE id = $1`, [state.source_revision_id]);
    const utterances = await client.query(
      `SELECT model_id FROM source_item WHERE interpretation_id = $1 AND kind = 'utterance'`,
      [state.interpretation_id],
    );
    const utteranceSet = new Set(utterances.rows.map((item) => item.model_id));
    if (revision.rowCount !== 1 || !castFits(normalized, revision.rows[0].text, utteranceSet)) {
      await rollback(client);
      return invalidRequest();
    }
    const materialId = randomUUID();
    await client.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id, parent_material_state_id)
       VALUES ($1, $2, $3, $4)`,
      [materialId, state.source_revision_id, state.interpretation_id, state.id],
    );
    await insertMaterialCast(client, materialId, normalized);
    await client.query(
      `UPDATE project SET active_material_state_id = $1 WHERE id = $2`,
      [materialId, locked.project_id],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      httpStatus: 200,
      materialStateId: materialId,
      sourceRevisionId: state.source_revision_id,
      interpretationId: state.interpretation_id,
    };
  });
}

export function createProjectStore(pool) {
  return {
    loadProject: () => loadProject(pool),
    saveDraft: (input) => saveDraft(pool, input),
    beginReading: () => beginReading(pool),
    finishReading: (input) => finishReading(pool, input),
    replacePendingCast: (readingId, cast) => replacePendingCast(pool, readingId, cast),
    confirmReading: (input) => confirmReading(pool, input),
    reviseMaterialState: (cast) => reviseMaterialState(pool, cast),
  };
}
