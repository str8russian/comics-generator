import { randomUUID } from "node:crypto";
import { isEmptyDraft } from "./fidelity.mjs";
import { assessDialogue } from "./overflow.mjs";
import { createProject, listProjects, markOpened, renameProject } from "./project-catalog.mjs";
import { requireProjectId, touchProjectContent } from "./project-scope.mjs";
import {
  applyExclusions,
  applyUtteranceToFrames,
  reconcileExclusion,
  replaceSpokenSpan,
  speakingExclusion,
} from "./source-edit.mjs";
import { carryCharacterAnchors, carryCheckedStoryboard } from "./visual-store.mjs";

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
    if (character.included !== undefined && character.included !== true && character.included !== false) {
      return { error: "invalid-request" };
    }
    const extractedName = textValue(character.extractedName) ? character.extractedName : character.name;
    names.add(character.name);
    characters.push({
      name: character.name,
      included: character.included !== false,
      extractedName,
    });
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
    characters: characters.map((character) => ({
      name: character.name,
      extractedName: character.name,
      included: true,
    })),
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
  const projectId = requireProjectId();
  const result = await client.query(`
    SELECT project.id AS project_id,
           project.active_source_revision_id,
           project.active_material_state_id,
           project.current_reading_id,
           working_draft.text AS draft_text,
           working_draft.revision_token
    FROM project
    JOIN working_draft ON working_draft.project_id = project.id
    WHERE project.id = $1
    FOR UPDATE
  `, [projectId]);
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function insertCast(client, readingId, cast) {
  const nameToId = new Map();
  for (let index = 0; index < cast.characters.length; index += 1) {
    const id = randomUUID();
    const character = cast.characters[index];
    const name = character.name;
    if (!nameToId.has(name)) nameToId.set(name, id);
    await client.query(
      `INSERT INTO pending_character (id, reading_id, ordinal, name, included, extracted_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, readingId, index, name, character.included !== false, character.extractedName || name],
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

async function syncExclusions(client, projectId, characters) {
  for (const character of characters) {
    const extracted = character.extractedName || character.name;
    if (!extracted) continue;
    if (character.included === false) {
      await client.query(
        `INSERT INTO character_exclusion (project_id, extracted_name)
         VALUES ($1, $2)
         ON CONFLICT (project_id, extracted_name) DO NOTHING`,
        [projectId, extracted],
      );
    } else {
      await client.query(
        `DELETE FROM character_exclusion WHERE project_id = $1 AND extracted_name = $2`,
        [projectId, extracted],
      );
    }
  }
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
    `SELECT name, included, extracted_name FROM pending_character WHERE reading_id = $1 ORDER BY ordinal, id`,
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
    characters: castRows.rows.map((character) => ({
      name: character.name,
      included: character.included !== false,
      extractedName: character.extracted_name || character.name,
    })),
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
    SELECT model_id, kind, speaker_status, speaker_label, source_quote, spoken_text
    FROM source_item
    WHERE interpretation_id = $1
    ORDER BY ordinal
  `, [row.interpretation_id]);
  const characters = await queryable.query(`
    SELECT name, included, extracted_name FROM canonical_character
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
  const sourceItems = items.rows.map((item) => ({
    ...publicItem({
      id: item.model_id,
      kind: item.kind,
      speakerStatus: item.speaker_status,
      speakerLabel: item.speaker_label,
      sourceQuote: item.source_quote,
    }),
    text: item.spoken_text,
  }));
  const cast = {
    characters: characters.rows.map((character) => ({
      name: character.name,
      included: character.included !== false,
      extractedName: character.extracted_name || character.name,
    })),
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
    const projectId = requireProjectId();
    const draft = await pool.query(
      `SELECT project.id,
              project.title,
              project.created_at,
              project.updated_at,
              project.last_opened_at,
              project.active_source_revision_id,
              project.active_material_state_id,
              project.current_reading_id,
              working_draft.text,
              working_draft.revision_token
       FROM project
       JOIN working_draft ON working_draft.project_id = project.id
       WHERE project.id = $1`,
      [projectId],
    );
    if (draft.rowCount !== 1) return { missing: true };
    const row = draft.rows[0];
    const revisions = await pool.query(
      `SELECT id, parent_source_revision_id, created_at
       FROM source_revision
       WHERE project_id = $1
       ORDER BY created_at, id`,
      [projectId],
    );
    const storyboards = await pool.query(
      `SELECT DISTINCT ON (storyboard_result.material_state_id)
              storyboard_result.material_state_id,
              material_state.source_revision_id,
              storyboard_result.status,
              storyboard_result.failures,
              storyboard_result.stage_payload
       FROM storyboard_result
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN source_revision ON source_revision.id = material_state.source_revision_id
       WHERE source_revision.project_id = $1
       ORDER BY storyboard_result.material_state_id, storyboard_result.created_at DESC, storyboard_result.id DESC`,
      [projectId],
    );
    const reading = await presentReading(pool, row.current_reading_id);
    const material = await presentMaterial(pool, row.active_material_state_id);
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      lastOpenedAt: row.last_opened_at instanceof Date ? row.last_opened_at.toISOString() : row.last_opened_at,
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
      storyboards: await presentStoryboards(pool, storyboards.rows, row.active_material_state_id),
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
    const projectId = requireProjectId();
    const nextToken = randomUUID();
    const current = await pool.query(
      `SELECT text FROM working_draft WHERE project_id = $1 AND revision_token = $2`,
      [projectId, input.revisionToken],
    );
    if (current.rowCount !== 1) {
      return { ok: false, httpStatus: 409, kind: "stale-draft" };
    }
    const updated = await pool.query(
      `UPDATE working_draft
       SET text = $1, revision_token = $2, updated_at = now()
       WHERE project_id = $3 AND revision_token = $4`,
      [input.text, nextToken, projectId, input.revisionToken],
    );
    if (updated.rowCount !== 1) {
      return { ok: false, httpStatus: 409, kind: "stale-draft" };
    }
    if (current.rows[0].text !== input.text) await touchProjectContent(pool);
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
      `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [readingId, locked.project_id, locked.draft_text, locked.revision_token],
    );
    await client.query(
      `UPDATE project SET current_reading_id = $1 WHERE id = $2`,
      [readingId, locked.project_id],
    );
    await touchProjectContent(client);
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
      `SELECT id, draft_text, status, project_id FROM reading WHERE id = $1 FOR UPDATE`,
      [input.readingId],
    );
    if (!locked || reading.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const row = reading.rows[0];
    if (row.project_id !== locked.project_id || locked.current_reading_id !== input.readingId || row.status !== "pending") {
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
    const excluded = await client.query(
      `SELECT extracted_name FROM character_exclusion WHERE project_id = $1`,
      [locked.project_id],
    );
    const cast = applyExclusions(
      initialCast(sourceItems, characters, surfaceForms),
      excluded.rows.map((row) => row.extracted_name),
    );
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
      `SELECT id, project_id, draft_text, status, snapshot FROM reading WHERE id = $1 FOR UPDATE`,
      [readingId],
    );
    if (reading.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const row = reading.rows[0];
    if (!locked || row.project_id !== locked.project_id) {
      await rollback(client);
      return notFound();
    }
    if (locked.current_reading_id !== readingId || row.status !== "ready" || locked.draft_text !== row.draft_text) {
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
    const blockedSpeaker = speakingExclusion(normalized);
    if (blockedSpeaker) {
      await rollback(client);
      return blockedSpeaker;
    }
    await replaceCastRows(client, readingId, normalized);
    await syncExclusions(client, locked.project_id, normalized.characters);
    await touchProjectContent(client);
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
      `SELECT id, project_id, draft_text, status, snapshot FROM reading WHERE id = $1 FOR UPDATE`,
      [readingId],
    );
    if (reading.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const row = reading.rows[0];
    if (!locked || row.project_id !== locked.project_id) {
      await rollback(client);
      return notFound();
    }
    if (locked.current_reading_id !== readingId || row.status !== "ready" || locked.draft_text !== row.draft_text) {
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
      `INSERT INTO source_revision (id, project_id, parent_source_revision_id, text) VALUES ($1, $2, $3, $4)`,
      [revisionId, locked.project_id, locked.active_source_revision_id, row.draft_text],
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
      `SELECT id, ordinal, name, included, extracted_name
       FROM pending_character WHERE reading_id = $1 ORDER BY ordinal, id`,
      [readingId],
    );
    const idMap = new Map();
    for (const character of characters.rows) {
      const canonicalId = randomUUID();
      idMap.set(character.id, canonicalId);
      await client.query(
        `INSERT INTO canonical_character (id, material_state_id, ordinal, name, included, extracted_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          canonicalId,
          materialId,
          character.ordinal,
          character.name,
          character.included !== false,
          character.extracted_name || character.name,
        ],
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
    await syncExclusions(client, locked.project_id, characters.rows.map((character) => ({
      name: character.name,
      included: character.included !== false,
      extractedName: character.extracted_name || character.name,
    })));
    await touchProjectContent(client);
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
      `INSERT INTO canonical_character (id, material_state_id, ordinal, name, included, extracted_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        materialId,
        index,
        name,
        cast.characters[index].included !== false,
        cast.characters[index].extractedName || name,
      ],
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
    const blockedSpeaker = speakingExclusion(normalized);
    if (blockedSpeaker) {
      await rollback(client);
      return blockedSpeaker;
    }
    const previousCharacters = await client.query(
      `SELECT name, included, extracted_name FROM canonical_character WHERE material_state_id = $1`,
      [state.id],
    );
    const previousIncluded = new Map(previousCharacters.rows.map((character) => [
      character.extracted_name || character.name,
      character.included !== false,
    ]));
    const inclusionChanged = normalized.characters.some((character) => {
      const key = character.extractedName || character.name;
      const before = previousIncluded.has(key) ? previousIncluded.get(key) : true;
      return before !== (character.included !== false);
    });
    const materialId = randomUUID();
    await client.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id, parent_material_state_id)
       VALUES ($1, $2, $3, $4)`,
      [materialId, state.source_revision_id, state.interpretation_id, state.id],
    );
    await insertMaterialCast(client, materialId, normalized);
    await syncExclusions(client, locked.project_id, normalized.characters);
    if (inclusionChanged) {
      const carried = await carryInclusionChange(client, {
        fromMaterialStateId: state.id,
        toMaterialStateId: materialId,
        characters: normalized.characters,
      });
      if (!carried.ok) {
        await rollback(client);
        return carried;
      }
      await client.query(
        `UPDATE project SET active_material_state_id = $1, updated_at = clock_timestamp() WHERE id = $2`,
        [materialId, locked.project_id],
      );
      await client.query("COMMIT");
      return {
        ok: true,
        httpStatus: 200,
        materialStateId: materialId,
        sourceRevisionId: state.source_revision_id,
        interpretationId: state.interpretation_id,
        visualChanged: true,
        invalidateRender: carried.invalidateRender === true,
      };
    }
    await client.query(
      `UPDATE project SET active_material_state_id = $1, updated_at = clock_timestamp() WHERE id = $2`,
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

async function carryInclusionChange(client, { fromMaterialStateId, toMaterialStateId, characters }) {
  const excluded = characters.filter((character) => character.included === false);
  const includedNames = characters
    .filter((character) => character.included !== false)
    .map((character) => character.name);
  const aliasRows = await client.query(`
    SELECT alias.surface_text, canonical_character.name
    FROM alias
    JOIN canonical_character ON canonical_character.id = alias.character_id
    WHERE alias.material_state_id = $1
  `, [fromMaterialStateId]);
  const identification = {
    characters: characters.map((character) => ({ name: character.name })),
    aliases: aliasRows.rows.map((row) => ({ surface: row.surface_text, characterName: row.name })),
  };
  const carried = await carryCheckedStoryboard(client, {
    fromMaterialStateId,
    toMaterialStateId,
    copyApproval: true,
    transformFrames(frames) {
      let next = frames;
      for (const character of excluded) {
        const step = reconcileExclusion(next, character.name, identification);
        if (!step.ok) return step;
        next = step.frames;
      }
      return { ok: true, frames: next };
    },
  });
  if (!carried.ok) return carried;
  await carryCharacterAnchors(client, { fromMaterialStateId, toMaterialStateId, includedNames });
  return carried;
}

function visualStageCast(cast) {
  const included = new Set(
    (cast.characters || []).filter((character) => character.included !== false).map((character) => character.id),
  );
  return {
    characters: cast.characters.filter((character) => included.has(character.id)),
    aliases: cast.aliases.filter((alias) => included.has(alias.characterId)),
    speakers: cast.speakers.filter((speaker) => included.has(speaker.characterId)),
  };
}

async function activeStoryboardVersionId(client, materialStateId) {
  const result = await client.query(`
    SELECT storyboard_head.active_storyboard_version_id
    FROM storyboard_result
    JOIN storyboard_head ON storyboard_head.storyboard_result_id = storyboard_result.id
    WHERE storyboard_result.material_state_id = $1
      AND storyboard_result.status = 'checked'
    ORDER BY storyboard_result.created_at DESC, storyboard_result.id DESC
    LIMIT 1
  `, [materialStateId]);
  return result.rows[0]?.active_storyboard_version_id ?? null;
}

export async function reviseSourceUtterance(pool, input) {
  const sourceItemId = input?.sourceItemId;
  if (typeof sourceItemId !== "string" || !ID_PATTERN.test(sourceItemId)) return notFound();
  if (input.materialStateId != null && (typeof input.materialStateId !== "string" || !UUID_PATTERN.test(input.materialStateId))) {
    return invalidRequest();
  }
  if (input.storyboardVersionId != null && (typeof input.storyboardVersionId !== "string" || !UUID_PATTERN.test(input.storyboardVersionId))) {
    return invalidRequest();
  }
  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    if (!locked?.active_material_state_id || !locked.active_source_revision_id) {
      await rollback(client);
      return notFound();
    }
    if (input.materialStateId && input.materialStateId !== locked.active_material_state_id) {
      await rollback(client);
      return { ok: false, httpStatus: 409, kind: "stale-version" };
    }
    const versionId = await activeStoryboardVersionId(client, locked.active_material_state_id);
    if (input.storyboardVersionId && input.storyboardVersionId !== versionId) {
      await rollback(client);
      return { ok: false, httpStatus: 409, kind: "stale-version" };
    }
    const state = await client.query(`
      SELECT material_state.id,
             material_state.source_revision_id,
             material_state.interpretation_id,
             source_revision.text,
             source_revision.project_id,
             reading.snapshot
      FROM material_state
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      JOIN interpretation ON interpretation.id = material_state.interpretation_id
      JOIN reading ON reading.id = interpretation.reading_id
      WHERE material_state.id = $1
        AND source_revision.project_id = $2
    `, [locked.active_material_state_id, locked.project_id]);
    if (state.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    const current = state.rows[0];
    const itemRows = await client.query(`
      SELECT ordinal, model_id, kind, speaker_status, speaker_label, draft_start, draft_end, source_quote, spoken_text
      FROM source_item
      WHERE interpretation_id = $1
      ORDER BY ordinal
    `, [current.interpretation_id]);
    const items = itemRows.rows.map((item) => ({
      id: item.model_id,
      ordinal: item.ordinal,
      kind: item.kind,
      speakerStatus: item.speaker_status,
      speakerLabel: item.speaker_label,
      draftStart: item.draft_start,
      draftEnd: item.draft_end,
      sourceQuote: item.source_quote,
      spokenText: item.spoken_text,
      text: item.spoken_text,
    }));
    const replaced = replaceSpokenSpan({
      text: current.text,
      items,
      sourceItemId,
      spokenText: input.spokenText,
    });
    if (!replaced.ok) {
      await rollback(client);
      return replaced.kind === "not-found" ? notFound() : invalidRequest();
    }
    if (replaced.unchanged) {
      await rollback(client);
      return {
        ok: true,
        httpStatus: 200,
        unchanged: true,
        sourceRevisionId: current.source_revision_id,
        materialStateId: current.id,
        draft: { text: locked.draft_text, revisionToken: locked.revision_token },
      };
    }
    const carried = await carryCheckedStoryboard(client, {
      fromMaterialStateId: current.id,
      toMaterialStateId: null,
      preview: true,
      transformFrames(frames) {
        return applyUtteranceToFrames(frames, sourceItemId, input.spokenText);
      },
    });
    if (!carried.ok) {
      await rollback(client);
      return {
        ok: false,
        httpStatus: 409,
        status: "blocked",
        kind: carried.kind || "directing-repartition",
        message: "Эту правку нельзя распределить по текущим композициям без пустого фрагмента или потери кадра.",
      };
    }
    if (carried.previewFrames) {
      const dialogue = assessDialogue(
        replaced.items.filter((item) => item.kind === "utterance").map((item) => ({
          id: item.id,
          kind: item.kind,
          text: item.text,
        })),
        carried.previewFrames,
      );
      if (!dialogue.ok) {
        await rollback(client);
        return {
          ok: false,
          httpStatus: 409,
          status: "blocked",
          kind: "dialogue-fidelity",
          message: "Новая реплика не сходится с кадрами без потери или повтора текста.",
        };
      }
    }
    const revisionId = randomUUID();
    const interpretationId = randomUUID();
    const materialId = randomUUID();
    const readingId = randomUUID();
    const draftToken = randomUUID();
    const snapshot = current.snapshot && typeof current.snapshot === "object" ? current.snapshot : {};
    const previousSnapshotItems = new Map((snapshot.sourceItems || []).map((item) => [item.id, item]));
    const snapshotItems = replaced.items.map((item) => {
      const previous = previousSnapshotItems.get(item.id) || {};
      const next = {
        id: item.id,
        kind: item.kind,
        speakerStatus: item.speakerStatus,
        sourceQuote: item.sourceQuote,
        draftStart: item.draftStart,
        draftEnd: item.draftEnd,
        text: item.text,
      };
      if (item.speakerLabel) next.speakerLabel = item.speakerLabel;
      if (previous.segmentIds) next.segmentIds = previous.segmentIds;
      return next;
    });
    await client.query(
      `INSERT INTO reading (id, project_id, draft_text, draft_revision_token, status, snapshot)
       VALUES ($1, $2, $3, $4, 'ready', $5::jsonb)`,
      [readingId, locked.project_id, replaced.text, draftToken, JSON.stringify({
        sourceItems: snapshotItems,
        characters: snapshot.characters || [],
        surfaceForms: (snapshot.surfaceForms || []).filter((form) => replaced.text.includes(form.quote)),
      })],
    );
    await client.query(
      `INSERT INTO source_revision (id, project_id, parent_source_revision_id, text) VALUES ($1, $2, $3, $4)`,
      [revisionId, locked.project_id, current.source_revision_id, replaced.text],
    );
    await client.query(
      `INSERT INTO interpretation (id, source_revision_id, reading_id) VALUES ($1, $2, $3)`,
      [interpretationId, revisionId, readingId],
    );
    for (const item of replaced.items) {
      const labeled = item.speakerStatus === "explicit" || item.speakerStatus === "inferred";
      await client.query(
        `INSERT INTO source_item (
           interpretation_id, ordinal, model_id, kind, speaker_status, speaker_label,
           draft_start, draft_end, source_quote, spoken_text
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          interpretationId,
          item.ordinal,
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
    const provisional = await client.query(
      `SELECT model_id, name FROM provisional_character WHERE interpretation_id = $1`,
      [current.interpretation_id],
    );
    for (const character of provisional.rows) {
      await client.query(
        `INSERT INTO provisional_character (interpretation_id, model_id, name) VALUES ($1, $2, $3)`,
        [interpretationId, character.model_id, character.name],
      );
    }
    const surfaces = await client.query(
      `SELECT model_id, quote, role, proposed_character_model_id FROM surface_form WHERE interpretation_id = $1`,
      [current.interpretation_id],
    );
    for (const form of surfaces.rows) {
      if (!replaced.text.includes(form.quote)) continue;
      await client.query(
        `INSERT INTO surface_form (interpretation_id, model_id, quote, role, proposed_character_model_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [interpretationId, form.model_id, form.quote, form.role, form.proposed_character_model_id],
      );
    }
    await client.query(
      `INSERT INTO material_state (id, source_revision_id, interpretation_id, parent_material_state_id)
       VALUES ($1, $2, $3, $4)`,
      [materialId, revisionId, interpretationId, current.id],
    );
    const canonical = await client.query(
      `SELECT id, ordinal, name, included, extracted_name
       FROM canonical_character WHERE material_state_id = $1 ORDER BY ordinal, id`,
      [current.id],
    );
    const idMap = new Map();
    const includedNames = [];
    for (const character of canonical.rows) {
      const canonicalId = randomUUID();
      idMap.set(character.id, canonicalId);
      if (character.included !== false) includedNames.push(character.name);
      await client.query(
        `INSERT INTO canonical_character (id, material_state_id, ordinal, name, included, extracted_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          canonicalId,
          materialId,
          character.ordinal,
          character.name,
          character.included !== false,
          character.extracted_name || character.name,
        ],
      );
    }
    const aliases = await client.query(
      `SELECT surface_text, character_id FROM alias WHERE material_state_id = $1`,
      [current.id],
    );
    for (const alias of aliases.rows) {
      if (!replaced.text.includes(alias.surface_text) || !idMap.has(alias.character_id)) continue;
      await client.query(
        `INSERT INTO alias (id, material_state_id, surface_text, character_id) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), materialId, alias.surface_text, idMap.get(alias.character_id)],
      );
    }
    const speakers = await client.query(
      `SELECT source_item_model_id, character_id FROM speaker_assignment WHERE material_state_id = $1`,
      [current.id],
    );
    for (const speaker of speakers.rows) {
      if (!idMap.has(speaker.character_id)) continue;
      await client.query(
        `INSERT INTO speaker_assignment (material_state_id, source_item_model_id, character_id)
         VALUES ($1, $2, $3)`,
        [materialId, speaker.source_item_model_id, idMap.get(speaker.character_id)],
      );
    }
    const stored = await carryCheckedStoryboard(client, {
      fromMaterialStateId: current.id,
      toMaterialStateId: materialId,
      copyApproval: false,
      transformFrames(frames) {
        return applyUtteranceToFrames(frames, sourceItemId, input.spokenText);
      },
    });
    if (!stored.ok) {
      await rollback(client);
      return { ok: false, httpStatus: 409, status: "blocked", kind: stored.kind || "directing-repartition" };
    }
    await carryCharacterAnchors(client, {
      fromMaterialStateId: current.id,
      toMaterialStateId: materialId,
      includedNames,
    });
    await client.query(
      `UPDATE working_draft SET text = $1, revision_token = $2, updated_at = clock_timestamp() WHERE project_id = $3`,
      [replaced.text, draftToken, locked.project_id],
    );
    await client.query(
      `UPDATE project
       SET active_source_revision_id = $1, active_material_state_id = $2, current_reading_id = NULL
       WHERE id = $3`,
      [revisionId, materialId, locked.project_id],
    );
    await touchProjectContent(client);
    await client.query("COMMIT");
    return {
      ok: true,
      httpStatus: 200,
      sourceRevisionId: revisionId,
      interpretationId,
      materialStateId: materialId,
      previousSourceRevisionId: current.source_revision_id,
      invalidateRender: true,
      draft: { text: replaced.text, revisionToken: draftToken },
    };
  });
}

function spokenFromRevision(text, item) {
  const slice = text.slice(item.draftStart, item.draftEnd);
  if (item.speakerStatus === "explicit" && item.speakerLabel) {
    const spaced = `${item.speakerLabel}: `;
    if (slice.startsWith(spaced)) return slice.slice(spaced.length);
    const bare = `${item.speakerLabel}:`;
    if (slice.startsWith(bare)) return slice.slice(bare.length);
  }
  return slice;
}

function copyPanelDescriptions(panels) {
  if (!Array.isArray(panels)) return [];
  const copies = [];
  for (const panel of panels) {
    if (panel && typeof panel.description === "string") copies.push({ description: panel.description });
  }
  return copies;
}

function rebuildFrame(frame, revisionText, byId) {
  const next = {
    id: frame?.id,
    layout: frame?.layout,
    origin: frame?.origin,
    panels: copyPanelDescriptions(frame?.panels),
    dialogue: "",
  };
  if (frame?.placement) next.placement = frame.placement;
  if (frame?.sourceItemId) next.sourceItemId = frame.sourceItemId;
  if (frame?.sourceRole) next.sourceRole = frame.sourceRole;
  if (frame?.speakerPanel != null) next.speakerPanel = frame.speakerPanel;
  if (typeof frame?.retainedImageNotice === "string" && frame.retainedImageNotice) {
    next.retainedImageNotice = frame.retainedImageNotice;
  }
  const item = byId.get(frame?.sourceItemId);
  if (!item || frame?.origin === "derived") return next;
  const spoken = spokenFromRevision(revisionText, item);
  if (frame.sourceRole === "action" || item.kind === "action") {
    next.outsideFrameText = revisionText.slice(item.draftStart, item.draftEnd);
    return next;
  }
  if (frame.directingBeat === true && Array.isArray(frame.segments)) {
    next.directingBeat = true;
    next.dialogue = spoken;
    next.segments = frame.segments.map((segment) => ({
      quote: spoken.slice(segment?.start ?? 0, segment?.end ?? 0),
      layout: segment?.layout,
      speakerPanel: segment?.speakerPanel,
      panels: copyPanelDescriptions(segment?.panels),
      start: segment?.start,
      end: segment?.end,
    }));
    return next;
  }
  const start = Number.isInteger(frame.displayBlock?.start) ? frame.displayBlock.start : 0;
  const end = Number.isInteger(frame.displayBlock?.end) ? frame.displayBlock.end : spoken.length;
  next.displayBlock = {
    sourceItemId: frame.displayBlock?.sourceItemId || frame.sourceItemId,
    start,
    end,
  };
  next.dialogue = spoken.slice(start, end);
  return next;
}

function presentSourceItems(revisionText, items) {
  return items.map((item) => {
    const next = {
      id: item.id,
      kind: item.kind,
      speakerStatus: item.speakerStatus,
      sourceQuote: revisionText.slice(item.draftStart, item.draftEnd),
      draftStart: item.draftStart,
      draftEnd: item.draftEnd,
      text: spokenFromRevision(revisionText, item),
    };
    if (item.speakerLabel) next.speakerLabel = item.speakerLabel;
    return next;
  });
}

function rebuildReview(review, revisionText, byId) {
  if (!Array.isArray(review)) return [];
  const rebuilt = [];
  for (const entry of review) {
    const item = byId.get(entry?.sourceItemId);
    if (!item) continue;
    rebuilt.push({
      sourceItemId: item.id,
      kind: item.kind,
      text: spokenFromRevision(revisionText, item),
    });
  }
  return rebuilt;
}

function presentStored(row, context, activeMaterialStateId) {
  const readyEligible = row.status === "checked" && row.material_state_id === activeMaterialStateId;
  const base = {
    materialStateId: row.material_state_id,
    sourceRevisionId: context?.sourceRevisionId ?? row.source_revision_id,
    status: row.status,
    readyEligible,
  };
  if (row.status === "blocked") {
    return { ...base, failures: Array.isArray(row.failures) ? row.failures : [] };
  }
  if (row.status !== "checked") {
    const kind = Array.isArray(row.failures) ? row.failures.find((entry) => typeof entry?.kind === "string")?.kind : undefined;
    return kind ? { ...base, kind } : base;
  }
  const items = context?.sourceItems || [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const payload = row.stage_payload && typeof row.stage_payload === "object" ? row.stage_payload : {};
  const frames = Array.isArray(payload.frames)
    ? payload.frames.map((frame) => rebuildFrame(frame, context?.revisionText || "", byId))
    : [];
  return {
    ...base,
    sourceItems: context ? presentSourceItems(context.revisionText, items) : [],
    frames,
    review: rebuildReview(payload.review, context?.revisionText || "", byId),
  };
}

async function loadMaterialContext(queryable, materialStateId) {
  const state = await queryable.query(`
    SELECT material_state.id,
           material_state.source_revision_id,
           material_state.interpretation_id,
           source_revision.text AS revision_text,
           reading.snapshot
    FROM material_state
    JOIN source_revision ON source_revision.id = material_state.source_revision_id
    JOIN interpretation ON interpretation.id = material_state.interpretation_id
    JOIN reading ON reading.id = interpretation.reading_id
    WHERE material_state.id = $1
  `, [materialStateId]);
  if (state.rowCount !== 1) return null;
  const row = state.rows[0];
  const items = await queryable.query(`
    SELECT model_id, kind, speaker_status, speaker_label, draft_start, draft_end
    FROM source_item
    WHERE interpretation_id = $1
    ORDER BY ordinal
  `, [row.interpretation_id]);
  const sourceItems = items.rows.map((item) => ({
    id: item.model_id,
    kind: item.kind,
    speakerStatus: item.speaker_status,
    speakerLabel: item.speaker_label,
    draftStart: item.draft_start,
    draftEnd: item.draft_end,
  }));
  const characters = await queryable.query(`
    SELECT id, name, included, extracted_name FROM canonical_character
    WHERE material_state_id = $1
    ORDER BY ordinal, id
  `, [materialStateId]);
  const aliases = await queryable.query(`
    SELECT surface_text, character_id FROM alias
    WHERE material_state_id = $1
    ORDER BY surface_text, character_id
  `, [materialStateId]);
  const speakers = await queryable.query(`
    SELECT source_item_model_id, character_id FROM speaker_assignment
    WHERE material_state_id = $1
    ORDER BY source_item_model_id
  `, [materialStateId]);
  const snapshot = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const snapshotItems = Array.isArray(snapshot.sourceItems) ? snapshot.sourceItems : [];
  const snapshotById = new Map(snapshotItems.map((item) => [item.id, item]));
  const stageItems = sourceItems.map((item) => {
    const snapshotItem = snapshotById.get(item.id) || {};
    const stageItem = {
      id: item.id,
      kind: item.kind,
      segmentIds: snapshotItem.segmentIds,
      speakerStatus: item.speakerStatus,
      sourceQuote: row.revision_text.slice(item.draftStart, item.draftEnd),
      text: spokenFromRevision(row.revision_text, item),
    };
    if (item.speakerLabel) stageItem.speakerLabel = item.speakerLabel;
    return stageItem;
  });
  const cast = {
    characters: characters.rows.map((character) => ({
      id: character.id,
      name: character.name,
      included: character.included !== false,
      extractedName: character.extracted_name || character.name,
    })),
    aliases: aliases.rows.map((alias) => ({ surface: alias.surface_text, characterId: alias.character_id })),
    speakers: speakers.rows.map((speaker) => ({
      sourceItemId: speaker.source_item_model_id,
      characterId: speaker.character_id,
    })),
  };
  const assigned = new Set(cast.speakers.map((speaker) => speaker.sourceItemId));
  return {
    materialStateId: row.id,
    sourceRevisionId: row.source_revision_id,
    interpretationId: row.interpretation_id,
    revisionText: row.revision_text,
    sourceItems,
    stageItems,
    cast,
    unassigned: sourceItems.filter((item) => item.kind === "utterance" && !assigned.has(item.id)),
  };
}

async function presentStoryboards(pool, rows, activeMaterialStateId) {
  const presented = [];
  for (const row of rows) {
    const context = await loadMaterialContext(pool, row.material_state_id);
    presented.push(presentStored(row, context, activeMaterialStateId));
  }
  return presented;
}

function cleanFailures(failures) {
  if (!Array.isArray(failures)) return [];
  const clean = [];
  for (const failure of failures) {
    if (!failure || typeof failure.code !== "string" || !SAFE_CODE.test(failure.code)) continue;
    const entry = { code: failure.code };
    if (typeof failure.sourceItemId === "string" && ID_PATTERN.test(failure.sourceItemId)) {
      entry.sourceItemId = failure.sourceItemId;
    }
    clean.push(entry);
  }
  return clean;
}

async function insertStoryboard(client, materialStateId, { status, failures, stagePayload }) {
  if (status !== "checked" && status !== "blocked" && status !== "failed") {
    throw new Error("storyboard status is not persistable");
  }
  await client.query(
    `INSERT INTO storyboard_result (id, material_state_id, status, failures, stage_payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, clock_timestamp())`,
    [
      randomUUID(),
      materialStateId,
      status,
      failures == null ? null : JSON.stringify(failures),
      stagePayload == null ? null : JSON.stringify(stagePayload),
    ],
  );
}

export async function stageActiveMaterial(pool, options = {}) {
  const stage = options.stage;
  const captured = await withClient(pool, async (client) => {
    await client.query("BEGIN");
    const locked = await lockDraft(client);
    if (!locked?.active_material_state_id) {
      await rollback(client);
      return notFound();
    }
    const context = await loadMaterialContext(client, locked.active_material_state_id);
    if (!context) {
      await rollback(client);
      return notFound();
    }
    if (context.unassigned.length > 0) {
      const failures = context.unassigned.map((item) => ({
        code: "unresolved-speaker",
        sourceItemId: item.id,
      }));
      await insertStoryboard(client, context.materialStateId, {
        status: "blocked",
        failures,
        stagePayload: null,
      });
      await client.query("COMMIT");
      return {
        ok: false,
        httpStatus: 200,
        status: "blocked",
        failures,
        materialStateId: context.materialStateId,
        sourceRevisionId: context.sourceRevisionId,
        readyEligible: false,
      };
    }
    await client.query("COMMIT");
    return { pending: true, context };
  });
  if (!captured || captured.pending !== true) return captured;
  if (typeof stage !== "function") {
    return { ok: false, httpStatus: 500, status: "failed", kind: "configuration" };
  }

  let staged;
  try {
    staged = await stage({
      draftText: captured.context.revisionText,
      sourceItems: captured.context.stageItems,
      cast: visualStageCast(captured.context.cast),
    });
  } catch {
    staged = { ok: false, httpStatus: 502, status: "failed", kind: "provider" };
  }
  if (staged?.kind === "configuration") {
    return {
      ok: false,
      httpStatus: staged.httpStatus || 500,
      status: "failed",
      kind: "configuration",
      diagnostics: staged.diagnostics,
    };
  }

  return withClient(pool, async (client) => {
    await client.query("BEGIN");
    const projectId = requireProjectId();
    const active = await client.query("SELECT active_material_state_id FROM project WHERE id = $1", [projectId]);
    const activeId = active.rows[0]?.active_material_state_id ?? null;
    const ownedMaterial = await client.query(`
      SELECT material_state.id
      FROM material_state
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE material_state.id = $1 AND source_revision.project_id = $2
    `, [captured.context.materialStateId, projectId]);
    if (ownedMaterial.rowCount !== 1) {
      await rollback(client);
      return notFound();
    }
    let status = "failed";
    let failures = [{ kind: "invalid-output" }];
    let stagePayload = null;
    if (staged?.status === "blocked") {
      status = "blocked";
      failures = cleanFailures(staged.failures);
    } else if (staged?.ok && staged?.body?.status === "checked") {
      status = "checked";
      failures = null;
      stagePayload = {
        frames: Array.isArray(staged.body.frames) ? staged.body.frames : [],
        review: Array.isArray(staged.body.review)
          ? staged.body.review.map((entry) => ({ sourceItemId: entry.sourceItemId }))
          : [],
      };
    } else if (staged?.status === "failed") {
      const kind = typeof staged.kind === "string" && SAFE_CODE.test(staged.kind) ? staged.kind : "invalid-output";
      failures = [{ kind }];
    }
    await insertStoryboard(client, captured.context.materialStateId, { status, failures, stagePayload });
    await touchProjectContent(client);
    await client.query("COMMIT");
    const latest = await client.query(
      `SELECT material_state_id, status, failures, stage_payload
       FROM storyboard_result
       WHERE material_state_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [captured.context.materialStateId],
    );
    const presented = presentStored(latest.rows[0], captured.context, activeId);
    if (status === "failed") {
      return {
        ok: false,
        httpStatus: staged?.httpStatus || 502,
        status: "failed",
        kind: failures[0].kind,
        diagnostics: staged?.diagnostics,
        materialStateId: captured.context.materialStateId,
        readyEligible: false,
      };
    }
    if (status === "blocked") {
      return { ok: false, httpStatus: 200, ...presented, diagnostics: staged?.diagnostics };
    }
    return { ok: true, httpStatus: 200, ...presented, diagnostics: staged?.diagnostics };
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
    reviseSourceUtterance: (input) => reviseSourceUtterance(pool, input),
    stageActiveMaterial: (options) => stageActiveMaterial(pool, options),
    listProjects: (options) => listProjects(pool, options),
    createProject: () => createProject(pool),
    renameProject: (projectId, title) => renameProject(pool, projectId, title),
    markOpened: (projectId) => markOpened(pool, projectId),
  };
}
