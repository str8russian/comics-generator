import { randomUUID } from "node:crypto";
import {
  assertResearchSubmittedTextSafe,
  ResearchProtectedContentError,
} from "./research-text-policy.mjs";

const SEMANTIC_ACTIONS = new Set([
  "note",
  "reading",
  "confirm_material",
  "stage_storyboard",
  "cast_edit",
  "structure_edit",
  "structure_undo",
  "identity_save",
  "anchor_generate",
  "anchor_approve",
  "frame_generate",
  "panel_generate",
  "placement_commit",
  "visual_approve",
]);

const SURFACES = new Set(["dock_notes", "dock_commands", "product_control"]);
const OUTCOMES = new Set(["success", "failure", "blocked"]);
const EVENT_KINDS = new Set(["note", "action_start", "action_terminal"]);

const CONTEXT_KEYS = [
  "workflowPhase",
  "storyboardVersionId",
  "displayFrameNumber",
  "displayFrameId",
  "structureFrameId",
  "structureSegmentIndex",
  "panelIndex",
  "panelSubject",
  "imageAssetId",
  "generationId",
  "characterName",
  "anchorVersionId",
];

const COMMAND_TARGET_KEYS = [
  "kind",
  "displayFrameNumber",
  "displayFrameId",
  "structureFrameId",
  "structureSegmentIndex",
  "panelIndex",
  "zoom",
  "positionX",
  "positionY",
  "characterName",
  "anchorVersionId",
];

const EDIT_TARGET_KEYS = [
  "editKind",
  "castPhase",
  "characterName",
  "previousCharacterName",
  "surfaceForm",
  "sourceItemId",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failed(kind, httpStatus = 400) {
  return { ok: false, status: "failed", kind, httpStatus };
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function normalizeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const out = {};
  for (const key of CONTEXT_KEYS) {
    out[key] = Object.hasOwn(context, key) ? context[key] : null;
  }
  return out;
}

function normalizeCommandTarget(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (typeof value.kind !== "string") return undefined;
  const out = {};
  for (const key of COMMAND_TARGET_KEYS) {
    out[key] = Object.hasOwn(value, key) ? value[key] : (key === "kind" ? value.kind : null);
  }
  out.kind = value.kind;
  return out;
}

function normalizeEditTarget(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (typeof value.editKind !== "string" || typeof value.castPhase !== "string") return undefined;
  const out = {};
  for (const key of EDIT_TARGET_KEYS) {
    out[key] = Object.hasOwn(value, key) ? value[key] : null;
  }
  out.editKind = value.editKind;
  out.castPhase = value.castPhase;
  return out;
}

function normalizeOutcomeFlags(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  if (Object.hasOwn(value, "retainedLastGoodImage")) {
    if (typeof value.retainedLastGoodImage !== "boolean") return undefined;
    out.retainedLastGoodImage = value.retainedLastGoodImage;
  }
  if (Object.hasOwn(value, "evidenceIncomplete")) {
    if (typeof value.evidenceIncomplete !== "boolean") return undefined;
    out.evidenceIncomplete = value.evidenceIncomplete;
  }
  for (const key of Object.keys(value)) {
    if (key !== "retainedLastGoodImage" && key !== "evidenceIncomplete") return undefined;
  }
  return out;
}

function validateTextPolicy(submittedText, editTarget) {
  try {
    if (typeof submittedText === "string") assertResearchSubmittedTextSafe(submittedText);
    if (editTarget && typeof editTarget === "object") {
      for (const value of Object.values(editTarget)) {
        if (typeof value === "string") assertResearchSubmittedTextSafe(value);
      }
    }
    return null;
  } catch (error) {
    if (error instanceof ResearchProtectedContentError || error?.kind === "protected-content") {
      return failed("protected-content", 400);
    }
    throw error;
  }
}

function mapRow(row) {
  return {
    seq: Number(row.seq),
    id: row.id,
    occurredAt: row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : String(row.occurred_at),
    eventKind: row.event_kind,
    semanticAction: row.semantic_action,
    correlationId: row.correlation_id ?? null,
    surface: row.surface,
    submittedText: row.submitted_text ?? null,
    commandTarget: row.command_target ?? null,
    editTarget: row.edit_target ?? null,
    context: row.context,
    outcome: row.outcome ?? null,
    outcomeKind: row.outcome_kind ?? null,
    outcomeFlags: row.outcome_flags ?? {},
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
  };
}

function validateNoteInput(input) {
  if (!input || typeof input !== "object") return failed("invalid-request");
  if (input.id != null && !isUuid(input.id)) return failed("invalid-request");
  if (typeof input.submittedText !== "string") return failed("invalid-request");
  const context = normalizeContext(input.context);
  if (!context) return failed("invalid-request");
  const protectedFailure = validateTextPolicy(input.submittedText, null);
  if (protectedFailure) return protectedFailure;
  return {
    ok: true,
    id: input.id ?? randomUUID(),
    submittedText: input.submittedText,
    context,
  };
}

function validateStartSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (!SEMANTIC_ACTIONS.has(snapshot.semanticAction) || snapshot.semanticAction === "note") return null;
  if (!SURFACES.has(snapshot.surface)) return null;
  const context = normalizeContext(snapshot.context);
  if (!context) return null;
  const commandTarget = normalizeCommandTarget(snapshot.commandTarget);
  if (commandTarget === undefined) return null;
  const editTarget = normalizeEditTarget(snapshot.editTarget);
  if (editTarget === undefined) return null;
  if (snapshot.semanticAction === "cast_edit") {
    if (!editTarget || commandTarget != null) return null;
  } else if (editTarget != null) {
    return null;
  }
  if (snapshot.submittedText != null && typeof snapshot.submittedText !== "string") return null;
  return {
    semanticAction: snapshot.semanticAction,
    surface: snapshot.surface,
    submittedText: snapshot.submittedText ?? null,
    commandTarget,
    editTarget,
    context,
  };
}

function validateEventInput(input) {
  if (!input || typeof input !== "object") return failed("invalid-request");
  if (input.id != null && !isUuid(input.id)) return failed("invalid-request");
  if (!EVENT_KINDS.has(input.eventKind) || input.eventKind === "note") return failed("invalid-request");
  if (!isUuid(input.correlationId)) return failed("invalid-request");

  if (input.eventKind === "action_start") {
    if (!SEMANTIC_ACTIONS.has(input.semanticAction) || input.semanticAction === "note") {
      return failed("invalid-request");
    }
    if (!SURFACES.has(input.surface)) return failed("invalid-request");
    const context = normalizeContext(input.context);
    if (!context) return failed("invalid-request");
    const commandTarget = normalizeCommandTarget(input.commandTarget);
    if (commandTarget === undefined) return failed("invalid-request");
    const editTarget = normalizeEditTarget(input.editTarget);
    if (editTarget === undefined) return failed("invalid-request");
    if (input.semanticAction === "cast_edit") {
      if (!editTarget || commandTarget != null) return failed("invalid-request");
    } else if (editTarget != null) {
      return failed("invalid-request");
    }
    if (input.submittedText != null && typeof input.submittedText !== "string") {
      return failed("invalid-request");
    }
    const protectedFailure = validateTextPolicy(input.submittedText, editTarget);
    if (protectedFailure) return protectedFailure;
    return {
      ok: true,
      eventKind: "action_start",
      id: input.id ?? randomUUID(),
      correlationId: input.correlationId,
      semanticAction: input.semanticAction,
      surface: input.surface,
      submittedText: input.submittedText ?? null,
      commandTarget,
      editTarget,
      context,
    };
  }

  // action_terminal
  if (!OUTCOMES.has(input.outcome)) return failed("invalid-request");
  const outcomeFlags = normalizeOutcomeFlags(input.outcomeFlags);
  if (outcomeFlags === undefined) return failed("invalid-request");
  if (input.outcomeKind != null && typeof input.outcomeKind !== "string") {
    return failed("invalid-request");
  }
  let startSnapshot = null;
  if (input.startSnapshot != null) {
    startSnapshot = validateStartSnapshot(input.startSnapshot);
    if (!startSnapshot) return failed("invalid-request");
    const protectedFailure = validateTextPolicy(
      startSnapshot.submittedText,
      startSnapshot.editTarget,
    );
    if (protectedFailure) return protectedFailure;
  }
  return {
    ok: true,
    eventKind: "action_terminal",
    id: input.id ?? randomUUID(),
    correlationId: input.correlationId,
    outcome: input.outcome,
    outcomeKind: input.outcomeKind ?? null,
    outcomeFlags,
    startSnapshot,
  };
}

function createMemoryStore() {
  const events = [];
  let seq = 0;

  async function appendNote(input) {
    const validated = validateNoteInput(input);
    if (!validated.ok) return validated;
    seq += 1;
    const event = {
      seq,
      id: validated.id,
      occurredAt: new Date().toISOString(),
      eventKind: "note",
      semanticAction: "note",
      correlationId: null,
      surface: "dock_notes",
      submittedText: validated.submittedText,
      commandTarget: null,
      editTarget: null,
      context: validated.context,
      outcome: null,
      outcomeKind: null,
      outcomeFlags: {},
      durationMs: null,
    };
    events.push(event);
    return { ok: true, event };
  }

  async function appendEvent(input) {
    const validated = validateEventInput(input);
    if (!validated.ok) return validated;

    if (validated.eventKind === "action_start") {
      if (events.some((event) => (
        event.eventKind === "action_start" && event.correlationId === validated.correlationId
      ))) {
        return failed("invalid-request");
      }
      seq += 1;
      const event = {
        seq,
        id: validated.id,
        occurredAt: new Date().toISOString(),
        eventKind: "action_start",
        semanticAction: validated.semanticAction,
        correlationId: validated.correlationId,
        surface: validated.surface,
        submittedText: validated.submittedText,
        commandTarget: validated.commandTarget,
        editTarget: validated.editTarget,
        context: validated.context,
        outcome: null,
        outcomeKind: null,
        outcomeFlags: {},
        durationMs: null,
      };
      events.push(event);
      return { ok: true, event };
    }

    if (events.some((event) => (
      event.eventKind === "action_terminal" && event.correlationId === validated.correlationId
    ))) {
      return failed("invalid-request");
    }

    const start = events.find((event) => (
      event.eventKind === "action_start" && event.correlationId === validated.correlationId
    ));

    let identity;
    let durationMs = null;
    let outcomeFlags = { ...validated.outcomeFlags };

    if (start) {
      identity = {
        semanticAction: start.semanticAction,
        surface: start.surface,
        submittedText: start.submittedText,
        commandTarget: start.commandTarget,
        editTarget: start.editTarget,
        context: start.context,
      };
      const startMs = Date.parse(start.occurredAt);
      const endMs = Date.now();
      durationMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : 0;
    } else {
      if (!validated.startSnapshot) return failed("invalid-request");
      identity = validated.startSnapshot;
      outcomeFlags = { ...outcomeFlags, evidenceIncomplete: true };
      durationMs = null;
    }

    seq += 1;
    const event = {
      seq,
      id: validated.id,
      occurredAt: new Date().toISOString(),
      eventKind: "action_terminal",
      semanticAction: identity.semanticAction,
      correlationId: validated.correlationId,
      surface: identity.surface,
      submittedText: identity.submittedText,
      commandTarget: identity.commandTarget,
      editTarget: identity.editTarget,
      context: identity.context,
      outcome: validated.outcome,
      outcomeKind: validated.outcomeKind,
      outcomeFlags,
      durationMs,
    };
    events.push(event);
    return { ok: true, event };
  }

  async function listTrace({ kind, surface } = {}) {
    let listed = events.slice();
    if (kind != null) listed = listed.filter((event) => event.eventKind === kind);
    if (surface != null) listed = listed.filter((event) => event.surface === surface);
    listed.sort((a, b) => a.seq - b.seq);
    return { ok: true, events: listed };
  }

  return { appendNote, appendEvent, listTrace };
}

async function withClient(pool, fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function isUniqueViolation(error) {
  return error?.code === "23505";
}

function createPgStore(pool) {
  async function insertRow(client, row) {
    const result = await client.query(`
      INSERT INTO research_event (
        id, event_kind, semantic_action, correlation_id, surface,
        submitted_text, command_target, edit_target, context,
        outcome, outcome_flags, outcome_kind, duration_ms
      ) VALUES (
        $1::uuid, $2, $3, $4::uuid, $5,
        $6, $7::jsonb, $8::jsonb, $9::jsonb,
        $10, $11::jsonb, $12, $13
      )
      RETURNING seq, id, occurred_at, event_kind, semantic_action, correlation_id, surface,
                submitted_text, command_target, edit_target, context,
                outcome, outcome_flags, outcome_kind, duration_ms
    `, [
      row.id,
      row.eventKind,
      row.semanticAction,
      row.correlationId,
      row.surface,
      row.submittedText,
      row.commandTarget == null ? null : JSON.stringify(row.commandTarget),
      row.editTarget == null ? null : JSON.stringify(row.editTarget),
      JSON.stringify(row.context),
      row.outcome,
      JSON.stringify(row.outcomeFlags ?? {}),
      row.outcomeKind,
      row.durationMs,
    ]);
    return mapRow(result.rows[0]);
  }

  async function appendNote(input) {
    const validated = validateNoteInput(input);
    if (!validated.ok) return validated;
    try {
      return await withClient(pool, async (client) => {
        const event = await insertRow(client, {
          id: validated.id,
          eventKind: "note",
          semanticAction: "note",
          correlationId: null,
          surface: "dock_notes",
          submittedText: validated.submittedText,
          commandTarget: null,
          editTarget: null,
          context: validated.context,
          outcome: null,
          outcomeFlags: {},
          outcomeKind: null,
          durationMs: null,
        });
        return { ok: true, event };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return failed("invalid-request");
      return failed("database", 503);
    }
  }

  async function appendEvent(input) {
    const validated = validateEventInput(input);
    if (!validated.ok) return validated;
    try {
      return await withClient(pool, async (client) => {
        if (validated.eventKind === "action_start") {
          const event = await insertRow(client, {
            id: validated.id,
            eventKind: "action_start",
            semanticAction: validated.semanticAction,
            correlationId: validated.correlationId,
            surface: validated.surface,
            submittedText: validated.submittedText,
            commandTarget: validated.commandTarget,
            editTarget: validated.editTarget,
            context: validated.context,
            outcome: null,
            outcomeFlags: {},
            outcomeKind: null,
            durationMs: null,
          });
          return { ok: true, event };
        }

        const startResult = await client.query(`
          SELECT seq, id, occurred_at, event_kind, semantic_action, correlation_id, surface,
                 submitted_text, command_target, edit_target, context,
                 outcome, outcome_flags, outcome_kind, duration_ms
          FROM research_event
          WHERE correlation_id = $1::uuid AND event_kind = 'action_start'
          LIMIT 1
        `, [validated.correlationId]);
        const startRow = startResult.rows[0] ? mapRow(startResult.rows[0]) : null;

        let identity;
        let durationMs = null;
        let outcomeFlags = { ...validated.outcomeFlags };

        if (startRow) {
          identity = {
            semanticAction: startRow.semanticAction,
            surface: startRow.surface,
            submittedText: startRow.submittedText,
            commandTarget: startRow.commandTarget,
            editTarget: startRow.editTarget,
            context: startRow.context,
          };
          const durationResult = await client.query(`
            SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - $1::timestamptz)) * 1000))::int AS ms
          `, [startRow.occurredAt]);
          durationMs = durationResult.rows[0].ms;
        } else {
          if (!validated.startSnapshot) return failed("invalid-request");
          identity = validated.startSnapshot;
          outcomeFlags = { ...outcomeFlags, evidenceIncomplete: true };
          durationMs = null;
        }

        const event = await insertRow(client, {
          id: validated.id,
          eventKind: "action_terminal",
          semanticAction: identity.semanticAction,
          correlationId: validated.correlationId,
          surface: identity.surface,
          submittedText: identity.submittedText,
          commandTarget: identity.commandTarget,
          editTarget: identity.editTarget,
          context: identity.context,
          outcome: validated.outcome,
          outcomeFlags,
          outcomeKind: validated.outcomeKind,
          durationMs,
        });
        return { ok: true, event };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return failed("invalid-request");
      return failed("database", 503);
    }
  }

  async function listTrace({ kind, surface } = {}) {
    try {
      return await withClient(pool, async (client) => {
        const clauses = [];
        const params = [];
        if (kind != null) {
          params.push(kind);
          clauses.push(`event_kind = $${params.length}`);
        }
        if (surface != null) {
          params.push(surface);
          clauses.push(`surface = $${params.length}`);
        }
        const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await client.query(`
          SELECT seq, id, occurred_at, event_kind, semantic_action, correlation_id, surface,
                 submitted_text, command_target, edit_target, context,
                 outcome, outcome_flags, outcome_kind, duration_ms
          FROM research_event
          ${where}
          ORDER BY seq ASC
        `, params);
        return { ok: true, events: result.rows.map(mapRow) };
      });
    } catch {
      return failed("database", 503);
    }
  }

  return { appendNote, appendEvent, listTrace };
}

export function createResearchStore(pool) {
  if (pool && pool.memory === true) return createMemoryStore();
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    return createMemoryStore();
  }
  return createPgStore(pool);
}
