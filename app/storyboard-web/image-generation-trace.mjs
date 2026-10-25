import { createHash, randomUUID } from "node:crypto";
import { loadBuildInfo } from "./build-info.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["panel", "frame-panel"]);
const ROLES = new Set(["anchor", "identity", "style", "previous", "current", "performance"]);
const REASONS = new Set(["reference-priority", "reference-limit", "request-budget"]);
const USAGE_FIELDS = ["prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"];
const MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

const LOOKUP_COLUMNS = Object.freeze({
  attemptId: "id",
  panelGenerationId: "panel_generation_id",
  correlationId: "correlation_id",
});

let processBuildId = null;

export function traceBuildId(env = process.env) {
  const fromEnv = typeof env.STORYBOARD_BUILD_ID === "string" ? env.STORYBOARD_BUILD_ID.trim() : "";
  if (fromEnv) return sanitizeToken(fromEnv, 64) || "unknown";
  if (!processBuildId) processBuildId = sanitizeToken(loadBuildInfo({ env }).id, 64) || "dev";
  return processBuildId;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeToken(value, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || !/^[A-Za-z0-9_.:/-]+$/.test(text)) return null;
  return text;
}

function uuidOrNull(value) {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function safeIdentity(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 128 || /[\u0000-\u001f]/.test(text)) return null;
  return text;
}

function safeAssetId(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (UUID_RE.test(text)) return text;
  if (/^[A-Za-z0-9_-]{1,64}$/.test(text)) return text;
  return null;
}

function safeMime(value) {
  const mime = value === "image/jpg" ? "image/jpeg" : value;
  return MIMES.has(mime) ? mime : null;
}

function safeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function safeKind(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value) ? value : null;
}

function safeFinish(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

export function allowlistedUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const fields = {};
  for (const key of USAGE_FIELDS) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
  }
  return Object.keys(fields).length ? fields : null;
}

function compactOmission(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!ROLES.has(entry.role) || !REASONS.has(entry.reason)) return null;
  return {
    role: entry.role,
    assetId: safeAssetId(entry.assetId),
    reason: entry.reason,
  };
}

export function mergeTraceOmissions(upstream, omittedRoles, originalReferences) {
  const omissions = [];
  const seen = new Set();
  const source = Array.isArray(upstream) ? upstream : [];
  for (const entry of source) {
    const compact = compactOmission(entry);
    if (!compact || seen.has(compact.role)) continue;
    seen.add(compact.role);
    omissions.push(compact);
  }
  const roles = Array.isArray(omittedRoles) ? omittedRoles : [];
  for (const role of roles) {
    if (!ROLES.has(role) || seen.has(role)) continue;
    const ref = (originalReferences || []).find((item) => item?.role === role);
    const compact = compactOmission({
      role,
      assetId: ref?.assetId ?? null,
      reason: "request-budget",
    });
    if (!compact) continue;
    seen.add(role);
    omissions.push(compact);
  }
  return omissions.slice(0, 8);
}

function sentReference(ref) {
  if (!ref || !ROLES.has(ref.role) || !Buffer.isBuffer(ref.bytes)) return null;
  return {
    role: ref.role,
    assetId: safeAssetId(ref.assetId),
    sha256: sha256(ref.bytes),
    mime: safeMime(ref.mime),
    byteLength: ref.bytes.length,
    width: safeInteger(ref.width) ?? 0,
    height: safeInteger(ref.height) ?? 0,
  };
}

function traceCode(error) {
  const code = error?.code;
  if (code === "23505") return "conflict";
  if (code === "23503" || code === "23514") return "constraint";
  if (code === "22P02") return "invalid-field";
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return "database";
  return "trace-write";
}

function logTraceFailure(logger, { attemptId, stage, code }) {
  if (!logger || typeof logger.log !== "function") return;
  const attempt = uuidOrNull(attemptId) || "-";
  const safeStage = stage === "prepared" || stage === "terminal" ? stage : "trace";
  const safeCode = /^[a-z0-9-]{1,40}$/.test(code) ? code : "trace-write";
  logger.log(`storyboard event=image-generation-trace status=failed stage=${safeStage} code=${safeCode} attempt=${attempt}`);
}

export function createImageGenerationTraceRecorder({
  query,
  logger = null,
  buildId = "dev",
  available = () => true,
} = {}) {
  const marker = sanitizeToken(buildId, 64) || "unknown";

  async function insertPrepared({
    traceContext,
    prepared,
    originalReferences,
    aspectRatio,
    model,
    budgetBytes,
    timeoutMs,
  }) {
    const attemptId = randomUUID();
    try {
      if (!available() || typeof query !== "function") return null;
      const context = traceContext || {};
      const projectId = uuidOrNull(context.projectId);
      const generationKind = KINDS.has(context.generationKind) ? context.generationKind : null;
      const actionKind = KINDS.has(context.actionKind) ? context.actionKind : null;
      const panelGenerationId = uuidOrNull(context.panelGenerationId);
      const safeModel = sanitizeToken(model, 128);
      const safeAspect = sanitizeToken(aspectRatio, 16);
      const safeBudget = safeInteger(budgetBytes, { min: 1 });
      const safeStrategy = sanitizeToken(prepared?.strategy, 32);
      const compilerId = sanitizeToken(context.compilerId, 64);
      const compilerVersion = sanitizeToken(context.compilerVersion, 64);
      if (!projectId || !generationKind || !actionKind || !panelGenerationId || !prepared?.prompt
        || !/^[0-9a-f]{64}$/.test(prepared?.requestSha256 || "")
        || !safeModel || !safeAspect || !safeBudget || !safeStrategy || !compilerId || !compilerVersion) {
        logTraceFailure(logger, { attemptId, stage: "prepared", code: "invalid-context" });
        return null;
      }
      const sent = [];
      for (const ref of prepared.references || []) {
        const item = sentReference(ref);
        if (item) sent.push(item);
      }
      const omissions = mergeTraceOmissions(
        context.upstreamOmissions,
        prepared.omittedRoles,
        originalReferences,
      );
      await query(`
        INSERT INTO image_generation_attempt (
          id, diagnostic_id, project_id, generation_kind, action_kind,
          panel_generation_id, storyboard_version_id, frame_id, panel_id, panel_index,
          correlation_id, compiler_id, compiler_version, build_id, state,
          prompt, prompt_sha256, model, aspect_ratio, reference_strategy, budget_bytes,
          original_body_bytes, final_body_bytes, request_sha256,
          sent_references, omissions, provider_io_started, timeout_ms
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, 'prepared',
          $15, $16, $17, $18, $19, $20,
          $21, $22, $23,
          $24::jsonb, $25::jsonb, false, $26
        )
      `, [
        attemptId,
        sanitizeToken(context.diagnosticId, 64) || "request",
        projectId,
        generationKind,
        actionKind,
        panelGenerationId,
        uuidOrNull(context.storyboardVersionId),
        safeIdentity(context.frameId),
        safeIdentity(context.panelId),
        safeInteger(context.panelIndex),
        uuidOrNull(context.correlationId),
        compilerId,
        compilerVersion,
        marker,
        prepared.prompt,
        sha256(prepared.prompt),
        safeModel,
        safeAspect,
        safeStrategy,
        safeBudget,
        safeInteger(prepared.originalBodyBytes) ?? 0,
        safeInteger(prepared.finalBodyBytes) ?? 0,
        prepared.requestSha256,
        JSON.stringify(sent.slice(0, 8)),
        JSON.stringify(omissions),
        safeInteger(timeoutMs, { min: 1 }),
      ]);
      return attemptId;
    } catch (error) {
      logTraceFailure(logger, { attemptId, stage: "prepared", code: traceCode(error) });
      return null;
    }
  }

  async function updateTerminal({ attemptId, result }) {
    if (!uuidOrNull(attemptId)) return;
    try {
      if (!available() || typeof query !== "function") return;
      const ok = result?.ok === true && Buffer.isBuffer(result?.image?.bytes);
      const providerStatus = safeHttpStatus(result?.diagnostics?.providerStatus ?? result?.metadata?.providerStatus);
      const httpStatus = providerStatus ?? safeHttpStatus(result?.httpStatus);
      const latency = safeInteger(result?.metadata?.latencyMs ?? result?.diagnostics?.latencyMs);
      const outcomeKind = ok
        ? (safeFinish(result?.metadata?.finishReason) || "succeeded")
        : (safeKind(result?.kind) || "provider");
      const usage = ok ? allowlistedUsage(result?.metadata?.usage) : null;
      let outputSha = null;
      let outputMime = null;
      let outputBytes = null;
      let outputWidth = null;
      let outputHeight = null;
      if (ok) {
        outputSha = sha256(result.image.bytes);
        outputMime = safeMime(result.image.mime);
        outputBytes = result.image.bytes.length;
        outputWidth = safeInteger(result.image.width);
        outputHeight = safeInteger(result.image.height);
      }
      await query(`
        UPDATE image_generation_attempt
        SET state = $2,
            terminal_at = now(),
            provider_io_started = true,
            latency_ms = $3,
            http_status = $4,
            outcome_kind = $5,
            usage = $6::jsonb,
            output_sha256 = $7,
            output_mime = $8,
            output_byte_length = $9,
            output_width = $10,
            output_height = $11
        WHERE id = $1 AND state = 'prepared'
      `, [
        attemptId,
        ok ? "succeeded" : "failed",
        latency,
        httpStatus,
        outcomeKind,
        usage ? JSON.stringify(usage) : null,
        outputSha,
        outputMime,
        outputBytes,
        outputWidth,
        outputHeight,
      ]);
    } catch (error) {
      logTraceFailure(logger, { attemptId, stage: "terminal", code: traceCode(error) });
    }
  }

  return { insertPrepared, updateTerminal };
}

const ATTEMPT_COLUMNS = `
  id, diagnostic_id, project_id, generation_kind, action_kind,
  panel_generation_id, storyboard_version_id, frame_id, panel_id, panel_index,
  correlation_id, compiler_id, compiler_version, build_id,
  prepared_at, terminal_at, state,
  prompt, prompt_sha256, model, aspect_ratio, reference_strategy, budget_bytes,
  original_body_bytes, final_body_bytes, request_sha256,
  sent_references, omissions,
  provider_io_started, timeout_ms, latency_ms, http_status, outcome_kind, usage,
  output_sha256, output_mime, output_byte_length, output_width, output_height
`;

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function presentImageGenerationAttempt(row) {
  if (!row) return null;
  return {
    attemptId: row.id,
    diagnosticId: row.diagnostic_id,
    projectId: row.project_id,
    generationKind: row.generation_kind,
    actionKind: row.action_kind,
    panelGenerationId: row.panel_generation_id,
    storyboardVersionId: row.storyboard_version_id,
    frameId: row.frame_id,
    panelId: row.panel_id,
    panelIndex: row.panel_index,
    correlationId: row.correlation_id,
    compilerId: row.compiler_id,
    compilerVersion: row.compiler_version,
    buildId: row.build_id,
    preparedAt: iso(row.prepared_at),
    terminalAt: iso(row.terminal_at),
    state: row.state,
    prompt: row.prompt,
    promptSha256: row.prompt_sha256,
    model: row.model,
    aspectRatio: row.aspect_ratio,
    referenceStrategy: row.reference_strategy,
    budgetBytes: row.budget_bytes,
    originalBodyBytes: row.original_body_bytes,
    finalBodyBytes: row.final_body_bytes,
    requestSha256: row.request_sha256,
    sentReferences: jsonArray(row.sent_references),
    omissions: jsonArray(row.omissions),
    providerIoStarted: row.provider_io_started === true,
    timeoutMs: row.timeout_ms,
    latencyMs: row.latency_ms,
    httpStatus: row.http_status,
    outcomeKind: row.outcome_kind,
    usage: row.usage && typeof row.usage === "object" ? row.usage : null,
    output: row.output_sha256 ? {
      sha256: row.output_sha256,
      mime: row.output_mime,
      byteLength: row.output_byte_length,
      width: row.output_width,
      height: row.output_height,
    } : null,
  };
}

export async function readImageGenerationAttempts(queryable, selector) {
  const key = Object.keys(LOOKUP_COLUMNS).find((name) => selector?.[name]);
  if (!key) return [];
  const value = selector[key];
  if (!uuidOrNull(value)) return [];
  const column = LOOKUP_COLUMNS[key];
  const result = await queryable.query(`
    SELECT ${ATTEMPT_COLUMNS}
    FROM image_generation_attempt
    WHERE ${column} = $1
    ORDER BY prepared_at ASC, id ASC
  `, [value]);
  return result.rows.map(presentImageGenerationAttempt);
}
