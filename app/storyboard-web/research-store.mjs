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
const WORKFLOW_PHASES = new Set([
  "draft",
  "reading",
  "material",
  "structure",
  "characters",
  "visual",
  "approved",
]);
const COMMAND_KINDS = new Set(["storyboard", "panel", "frame", "character", "none"]);
const EDIT_KINDS = new Set(["character_rename", "alias_assignment", "speaker_assignment"]);
const CAST_PHASES = new Set(["pending_reading", "material_state"]);

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
  "mirrored",
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
const OUTCOME_KIND_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function failed(kind, httpStatus = 400) {
  return { ok: false, status: "failed", kind, httpStatus };
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasOnlyKeys(object, allowed) {
  return Object.keys(object).every((key) => allowed.has(key));
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function nullableIntegerMin(value, minimum) {
  return value === null || (isInteger(value) && value >= minimum);
}

function nullableNumber(value) {
  return value === null || isNumber(value);
}

function normalizeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const allowed = new Set(CONTEXT_KEYS);
  if (!hasOnlyKeys(context, allowed)) return null;

  const out = {};
  for (const key of CONTEXT_KEYS) {
    out[key] = Object.hasOwn(context, key) ? context[key] : null;
  }

  if (!(out.workflowPhase === null
    || (typeof out.workflowPhase === "string" && WORKFLOW_PHASES.has(out.workflowPhase)))) {
    return null;
  }
  if (!nullableString(out.storyboardVersionId)) return null;
  if (!nullableIntegerMin(out.displayFrameNumber, 1)) return null;
  if (!nullableString(out.displayFrameId)) return null;
  if (!nullableString(out.structureFrameId)) return null;
  if (!nullableIntegerMin(out.structureSegmentIndex, 0)) return null;
  if (!nullableIntegerMin(out.panelIndex, 0)) return null;
  if (!nullableString(out.panelSubject)) return null;
  if (!nullableString(out.imageAssetId)) return null;
  if (!nullableString(out.generationId)) return null;
  if (!nullableString(out.characterName)) return null;
  if (!nullableString(out.anchorVersionId)) return null;
  return out;
}

function normalizeCommandTarget(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const allowed = new Set(COMMAND_TARGET_KEYS);
  if (!hasOnlyKeys(value, allowed)) return undefined;
  if (!Object.hasOwn(value, "kind") || typeof value.kind !== "string" || !COMMAND_KINDS.has(value.kind)) {
    return undefined;
  }

  const out = { kind: value.kind };
  for (const key of COMMAND_TARGET_KEYS) {
    if (key === "kind") continue;
    const present = Object.hasOwn(value, key) ? value[key] : null;
    if (key === "displayFrameNumber") {
      if (!nullableIntegerMin(present, 1)) return undefined;
    } else if (key === "structureSegmentIndex" || key === "panelIndex") {
      if (!nullableIntegerMin(present, 0)) return undefined;
    } else if (key === "zoom" || key === "positionX" || key === "positionY") {
      if (!nullableNumber(present)) return undefined;
    } else if (key === "mirrored") {
      if (!(present === null || typeof present === "boolean")) return undefined;
    } else if (!nullableString(present)) {
      return undefined;
    }
    out[key] = present;
  }
  return out;
}

function normalizeEditTarget(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const allowed = new Set(EDIT_TARGET_KEYS);
  if (!hasOnlyKeys(value, allowed)) return undefined;
  if (!Object.hasOwn(value, "editKind") || !EDIT_KINDS.has(value.editKind)) return undefined;
  if (!Object.hasOwn(value, "castPhase") || !CAST_PHASES.has(value.castPhase)) return undefined;

  const out = {
    editKind: value.editKind,
    castPhase: value.castPhase,
  };
  for (const key of EDIT_TARGET_KEYS) {
    if (key === "editKind" || key === "castPhase") continue;
    const present = Object.hasOwn(value, key) ? value[key] : null;
    if (!nullableString(present)) return undefined;
    out[key] = present;
  }
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

function normalizeOutcomeKind(value) {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > 64) return undefined;
  if (!OUTCOME_KIND_RE.test(value)) return undefined;
  return value;
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
    if (snapshot.surface !== "product_control") return null;
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
      if (input.surface !== "product_control") return failed("invalid-request");
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

  if (!OUTCOMES.has(input.outcome)) return failed("invalid-request");
  const outcomeFlags = normalizeOutcomeFlags(input.outcomeFlags);
  if (outcomeFlags === undefined) return failed("invalid-request");
  const outcomeKind = normalizeOutcomeKind(input.outcomeKind);
  if (outcomeKind === undefined) return failed("invalid-request");
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
    outcomeKind,
    outcomeFlags,
    startSnapshot,
  };
}

function deriveTerminalFlags(clientFlags, { incomplete }) {
  const flags = {};
  if (clientFlags.retainedLastGoodImage === true) flags.retainedLastGoodImage = true;
  if (incomplete) flags.evidenceIncomplete = true;
  return flags;
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
    let outcomeFlags;

    if (start) {
      identity = {
        semanticAction: start.semanticAction,
        surface: start.surface,
        submittedText: start.submittedText,
        commandTarget: start.commandTarget,
        editTarget: start.editTarget,
        context: start.context,
      };
      outcomeFlags = deriveTerminalFlags(validated.outcomeFlags, { incomplete: false });
      const occurredAt = new Date();
      const startMs = Date.parse(start.occurredAt);
      durationMs = Number.isFinite(startMs) ? Math.max(0, occurredAt.getTime() - startMs) : 0;
      seq += 1;
      const event = {
        seq,
        id: validated.id,
        occurredAt: occurredAt.toISOString(),
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

    if (!validated.startSnapshot) return failed("invalid-request");
    identity = validated.startSnapshot;
    outcomeFlags = deriveTerminalFlags(validated.outcomeFlags, { incomplete: true });
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
      durationMs: null,
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
        id, occurred_at, event_kind, semantic_action, correlation_id, surface,
        submitted_text, command_target, edit_target, context,
        outcome, outcome_flags, outcome_kind, duration_ms
      ) VALUES (
        $1::uuid, COALESCE($2::timestamptz, clock_timestamp()), $3, $4, $5::uuid, $6,
        $7, $8::jsonb, $9::jsonb, $10::jsonb,
        $11, $12::jsonb, $13, $14
      )
      RETURNING seq, id, occurred_at, event_kind, semantic_action, correlation_id, surface,
                submitted_text, command_target, edit_target, context,
                outcome, outcome_flags, outcome_kind, duration_ms
    `, [
      row.id,
      row.occurredAt ?? null,
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
        const startRaw = startResult.rows[0] ?? null;
        const startRow = startRaw ? mapRow(startRaw) : null;

        let identity;
        let durationMs = null;
        let outcomeFlags;
        let occurredAt = null;

        if (startRow) {
          identity = {
            semanticAction: startRow.semanticAction,
            surface: startRow.surface,
            submittedText: startRow.submittedText,
            commandTarget: startRow.commandTarget,
            editTarget: startRow.editTarget,
            context: startRow.context,
          };
          outcomeFlags = deriveTerminalFlags(validated.outcomeFlags, { incomplete: false });
          // One DB timestamp for both the inserted terminal row and duration_ms.
          // Millisecond truncation matches JSON date-time precision of occurredAt.
          const stamp = await client.query(`
            WITH terminal AS (
              SELECT date_trunc('milliseconds', clock_timestamp()) AS occurred_at
            )
            SELECT
              terminal.occurred_at,
              GREATEST(
                0,
                (
                  (EXTRACT(EPOCH FROM terminal.occurred_at) * 1000)::bigint
                  - (EXTRACT(EPOCH FROM date_trunc('milliseconds', $1::timestamptz)) * 1000)::bigint
                )
              )::int AS duration_ms
            FROM terminal
          `, [startRaw.occurred_at]);
          occurredAt = stamp.rows[0].occurred_at;
          durationMs = stamp.rows[0].duration_ms;
        } else {
          if (!validated.startSnapshot) return failed("invalid-request");
          identity = validated.startSnapshot;
          outcomeFlags = deriveTerminalFlags(validated.outcomeFlags, { incomplete: true });
          durationMs = null;
        }

        const event = await insertRow(client, {
          id: validated.id,
          occurredAt,
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

export class ResearchStoreConfigurationError extends Error {
  constructor() {
    super("configuration");
    this.name = "ResearchStoreConfigurationError";
    this.kind = "configuration";
    this.httpStatus = 500;
  }
}

export function createResearchStore(pool) {
  if (pool && pool.memory === true) return createMemoryStore();
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw new ResearchStoreConfigurationError();
  }
  return createPgStore(pool);
}
