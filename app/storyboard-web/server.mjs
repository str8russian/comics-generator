import { randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadBuildInfo } from "./build-info.mjs";
import { createPool } from "./db/pool.mjs";
import { migrate as migrateDatabase } from "./db/migrate.mjs";
import { loadConfig } from "./config.mjs";
import { isEmptyDraft } from "./fidelity.mjs";
import { interpretDraft } from "./interpret.mjs";
import { draftInputError, createProjectStore } from "./project-store.mjs";
import { createRenderController } from "./render-service.mjs";
import { stageStoryboard } from "./stage.mjs";
import { IDENTITY_MAX_BODY_BYTES, parseIdentityImage, parseImageDataUrl } from "./image-info.mjs";
import { generateImage, resolveImageModel } from "./image-provider.mjs";
import {
  executeImageRequest,
  loadImageReferenceConfig,
  toReference,
  transportLogFields,
} from "./image-reference-strategy.mjs";
import { editStoryboard } from "./storyboard-edit.mjs";
import { compileVideoSpec } from "./video-spec.mjs";
import { createEmptyContext, createEmptyCommandTarget } from "./public/research-dock.mjs";
import { normalizeExportTransition } from "./public/export-timing.mjs";
import {
  anchorPrompt,
  aspectRatioForFrame,
  assembleAnchorReferences,
  assemblePanelReferences,
  compilePanelReadyIntent,
  compilePanelReadyPrompt,
  panelPrompt,
  usesConstrainedPanelPrompt,
  validateCharacterGeneration,
  validatePanelReadyAuthorities,
} from "./visual-model.mjs";
import { createResearchStore } from "./research-store.mjs";
import { createVisualStore } from "./visual-store.mjs";

export const DEFAULT_MAX_BODY_BYTES = 262144;
export const IMAGE_MAX_BODY_BYTES = IDENTITY_MAX_BODY_BYTES;

export const routes = [
  { method: "GET", path: "/", file: "app/storyboard-web/public/index.html" },
  { method: "GET", path: "/app.js", file: "app/storyboard-web/public/app.js" },
  { method: "GET", path: "/app.css", file: "app/storyboard-web/public/app.css" },
  { method: "GET", path: "/draft-autosave.mjs", file: "app/storyboard-web/public/draft-autosave.mjs" },
  { method: "GET", path: "/research-dock.mjs", file: "app/storyboard-web/public/research-dock.mjs" },
  { method: "GET", path: "/overflow.mjs", file: "app/storyboard-web/overflow.mjs" },
  { method: "GET", path: "/frame-renderer.mjs", file: "prototypes/storyboard-viewer/frame-renderer.mjs" },
  { method: "GET", path: "/viewer.css", file: "prototypes/storyboard-viewer/viewer.css" },
  { method: "GET", path: "/visual-anchors.mjs", file: "app/storyboard-web/public/visual-anchors.mjs" },
  { method: "GET", path: "/asset-picker.mjs", file: "app/storyboard-web/public/asset-picker.mjs" },
  { method: "GET", path: "/export-timing.mjs", file: "app/storyboard-web/public/export-timing.mjs" },
  { method: "GET", path: "/character-anchors/putin.png", file: "app/storyboard-web/public/character-anchors/putin.png" },
  { method: "GET", path: "/character-anchors/durov.png", file: "app/storyboard-web/public/character-anchors/durov.png" },
  { method: "GET", path: "/character-anchors/peskov.png", file: "app/storyboard-web/public/character-anchors/peskov.png" },
];

const routesByPath = new Map(routes.map((route) => [route.path, route]));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function defaultRead(filePath) {
  if (!routes.some((route) => route.file === filePath)) {
    throw new Error("file is not on the storyboard route map");
  }
  return readFileSync(join(repoRoot, filePath));
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "text/javascript; charset=utf-8";
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function closeEmpty(res, status) {
  res.writeHead(status, { Connection: "close" });
  res.end();
  res.on("finish", () => res.socket?.destroy());
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendVisualFailure(res, result) {
  sendJson(res, result?.httpStatus || 500, {
    status: "failed",
    kind: safeKind(result?.kind) || "database",
  });
}

function isJsonContentType(value) {
  if (!value) return false;
  const [type, ...params] = String(value).split(";").map((part) => part.trim()).filter(Boolean);
  if (type.toLowerCase() !== "application/json") return false;
  if (params.length === 0) return true;
  return params.length === 1 && params[0].toLowerCase().replace(/\s+/g, "") === "charset=utf-8";
}

function pathnameOf(url) {
  try {
    return new URL(url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
}

function readLimited(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        chunks.length = 0;
        finish({ tooBig: true, body: Buffer.alloc(0) });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ tooBig: false, body: Buffer.concat(chunks) }));
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendOutcome(res, outcome) {
  if (outcome.status === "blocked") {
    sendJson(res, 200, { status: "blocked", failures: outcome.failures });
    return;
  }
  if (outcome.status === "failed") {
    sendJson(res, outcome.httpStatus, { status: "failed", kind: outcome.kind });
    return;
  }
  sendJson(res, 200, outcome.body);
}

const FAILURE_KINDS = new Set(["provider", "invalid-output", "timeout", "configuration", "invalid-request"]);

function logLine(logger, fields) {
  if (!logger || typeof logger.log !== "function") return;
  const parts = ["storyboard"];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    parts.push(`${key}=${value}`);
  }
  logger.log(parts.join(" "));
}

function formatCodes(failures) {
  if (!Array.isArray(failures)) return undefined;
  const codes = [];
  for (const failure of failures) {
    if (typeof failure?.code === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(failure.code)) codes.push(failure.code);
  }
  return codes.length > 0 ? codes.join(",") : undefined;
}

function formatSchema(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  return issues.map((issue) => `${issue.instancePath}:${issue.keyword}`).join(",");
}

function outcomeFields(result) {
  const fields = {};
  if (result?.ok) {
    fields.status = "ok";
  } else if (result?.status === "blocked") {
    fields.status = "blocked";
    fields.codes = formatCodes(result.failures);
  } else {
    fields.status = "failed";
    if (FAILURE_KINDS.has(result?.kind)) fields.kind = result.kind;
    if (Number.isInteger(result?.httpStatus)) fields.http = result.httpStatus;
  }
  const diagnostics = result?.diagnostics;
  if (diagnostics && Number.isInteger(diagnostics.providerStatus)) fields.providerStatus = diagnostics.providerStatus;
  if (diagnostics && typeof diagnostics.finishReason === "string") fields.finishReason = diagnostics.finishReason;
  fields.schema = formatSchema(diagnostics?.schemaIssues);
  return fields;
}

async function handleStoryboard(req, res, { maxBodyBytes, env, fetchImpl, logger, request }) {
  let terminalLogged = false;
  const terminal = (fields) => {
    logLine(logger, { request, event: "terminal", ...fields });
    terminalLogged = true;
  };
  try {
    const declared = req.headers["content-length"];
    if (declared != null && declared !== "") {
      const size = Number(declared);
      if (Number.isFinite(size) && size > maxBodyBytes) {
        terminal({ status: "failed", http: 413 });
        closeEmpty(res, 413);
        return;
      }
    }
    if (!isJsonContentType(req.headers["content-type"])) {
      terminal({ status: "failed", http: 415 });
      sendEmpty(res, 415);
      req.resume();
      return;
    }
    const read = await readLimited(req, maxBodyBytes);
    if (read.tooBig) {
      if (!res.headersSent) {
        terminal({ status: "failed", http: 413 });
        closeEmpty(res, 413);
      }
      return;
    }
    let payload;
    try {
      payload = JSON.parse(read.body.toString("utf8"));
    } catch {
      terminal({ status: "failed", kind: "invalid-request", http: 400 });
      sendJson(res, 400, { status: "failed", kind: "invalid-request" });
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.draft !== "string") {
      terminal({ status: "failed", kind: "invalid-request", http: 400 });
      sendJson(res, 400, { status: "failed", kind: "invalid-request" });
      return;
    }
    logLine(logger, { request, event: "interpret-start" });
    const interpreted = await interpretDraft({ draft: payload.draft, env, fetchImpl });
    logLine(logger, { request, event: "interpret-outcome", ...outcomeFields(interpreted) });
    if (!interpreted.ok) {
      terminal({
        status: interpreted.status === "blocked" ? "blocked" : "failed",
        kind: interpreted.status === "blocked" ? undefined : (FAILURE_KINDS.has(interpreted.kind) ? interpreted.kind : undefined),
        during: interpreted.kind === "invalid-output" ? "interpret" : undefined,
        http: interpreted.httpStatus,
        codes: interpreted.status === "blocked" ? formatCodes(interpreted.failures) : undefined,
      });
      sendOutcome(res, interpreted);
      return;
    }
    logLine(logger, { request, event: "stage-start" });
    const staged = await stageStoryboard({
      draft: payload.draft,
      sourceItems: interpreted.sourceItems,
      env,
      fetchImpl,
    });
    logLine(logger, { request, event: "stage-outcome", ...outcomeFields(staged) });
    if (!staged.ok) {
      terminal({
        status: staged.status === "blocked" ? "blocked" : "failed",
        kind: staged.status === "blocked" ? undefined : (FAILURE_KINDS.has(staged.kind) ? staged.kind : undefined),
        during: staged.kind === "invalid-output" ? "stage" : undefined,
        http: staged.httpStatus,
        codes: staged.status === "blocked" ? formatCodes(staged.failures) : undefined,
      });
      sendOutcome(res, staged);
      return;
    }
    terminal({ status: "checked", http: 200 });
    sendOutcome(res, staged);
  } catch {
    if (!terminalLogged) {
      terminal({ status: "failed", kind: "configuration", http: 500 });
    }
    if (!res.headersSent) sendJson(res, 500, { status: "failed", kind: "configuration" });
  }
}

function logDraft(logger, request, result) {
  logLine(logger, {
    request,
    event: "draft-save",
    status: result.ok ? "ok" : "failed",
    kind: result.ok ? undefined : result.kind,
    http: result.httpStatus,
  });
}

function safeKind(kind) {
  return typeof kind === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(kind) ? kind : undefined;
}

function logAllowlisted(logger, request, event, result) {
  const blocked = result?.status === "blocked";
  logLine(logger, {
    request,
    event,
    status: result?.ok ? "ok" : (blocked ? "blocked" : "failed"),
    kind: result?.ok || blocked ? undefined : safeKind(result?.kind),
    http: result?.httpStatus,
    codes: blocked ? formatCodes(result.failures) : undefined,
    providerStatus: Number.isInteger(result?.diagnostics?.providerStatus) ? result.diagnostics.providerStatus : undefined,
    finishReason: typeof result?.diagnostics?.finishReason === "string"
      && /^[A-Za-z0-9_-]{1,64}$/.test(result.diagnostics.finishReason)
      ? result.diagnostics.finishReason
      : undefined,
    schema: formatSchema(result?.diagnostics?.schemaIssues),
  });
}

function logMaterial(logger, request, result) {
  logLine(logger, {
    request,
    event: "material-state",
    status: result?.ok ? "ok" : "failed",
    kind: result?.ok ? undefined : safeKind(result?.kind),
    http: result?.httpStatus,
    codes: result?.status === "blocked" ? formatCodes(result.failures) : undefined,
  });
}

function sendFailure(res, result) {
  sendJson(res, result.httpStatus || 500, {
    status: "failed",
    kind: safeKind(result.kind) || "database",
  });
}

function readingCastPath(pathname) {
  const match = pathname.match(/^\/api\/readings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/cast$/i);
  return match ? match[1] : null;
}

async function readJsonBody(req, res, maxBodyBytes) {
  const declared = req.headers["content-length"];
  if (declared != null && declared !== "") {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBodyBytes) {
      closeEmpty(res, 413);
      return { done: true };
    }
  }
  if (!isJsonContentType(req.headers["content-type"])) {
    sendEmpty(res, 415);
    req.resume();
    return { done: true };
  }
  const read = await readLimited(req, maxBodyBytes);
  if (read.tooBig) {
    if (!res.headersSent) closeEmpty(res, 413);
    return { done: true };
  }
  try {
    return { done: false, payload: JSON.parse(read.body.toString("utf8")) };
  } catch {
    return { done: false, invalid: true };
  }
}

async function handleReadings(req, res, { maxBodyBytes, env, fetchImpl, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const declared = req.headers["content-length"];
  if (declared != null && declared !== "" && Number(declared) > maxBodyBytes) {
    closeEmpty(res, 413);
    return;
  }
  const read = await readLimited(req, maxBodyBytes);
  if (read.tooBig) {
    if (!res.headersSent) closeEmpty(res, 413);
    return;
  }
  if (read.body.length > 0) {
    if (!isJsonContentType(req.headers["content-type"])) {
      sendEmpty(res, 415);
      return;
    }
    try {
      JSON.parse(read.body.toString("utf8"));
    } catch {
      sendJson(res, 400, { status: "failed", kind: "invalid-request" });
      return;
    }
  }
  if (!runtime.projectStore) {
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  let project;
  try {
    project = await runtime.projectStore.loadProject();
  } catch {
    project = null;
  }
  if (!project) {
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  if (isEmptyDraft(project.draft?.text)) {
    const blocked = { ok: true, httpStatus: 200, status: "blocked", failures: [{ code: "empty-draft" }] };
    logAllowlisted(logger, request, "reading-outcome", blocked);
    sendJson(res, 200, { status: "blocked", failures: blocked.failures });
    return;
  }
  const providerEnv = env ?? process.env;
  if (!loadConfig(providerEnv).ok) {
    const failed = { ok: false, httpStatus: 500, status: "failed", kind: "configuration" };
    logAllowlisted(logger, request, "reading-outcome", failed);
    sendJson(res, 500, { status: "failed", kind: "configuration" });
    return;
  }
  const started = await runtime.projectStore.beginReading();
  if (started?.status === "blocked") {
    logAllowlisted(logger, request, "reading-outcome", started);
    sendJson(res, 200, { status: "blocked", failures: started.failures });
    return;
  }
  if (!started?.ok) {
    logAllowlisted(logger, request, "reading-outcome", started);
    sendFailure(res, started || { httpStatus: 503, kind: "database" });
    return;
  }
  logLine(logger, { request, event: "reading-start" });
  const interpreted = await interpretDraft({
    draft: started.draftText,
    env: providerEnv,
    fetchImpl,
    acceptUnresolved: true,
  });
  let finished;
  if (interpreted.ok) {
    finished = await runtime.projectStore.finishReading({
      readingId: started.readingId,
      sourceItems: interpreted.sourceItems,
      characters: interpreted.characters,
      surfaceForms: interpreted.surfaceForms,
    });
  } else if (interpreted.status === "blocked") {
    finished = await runtime.projectStore.finishReading({
      readingId: started.readingId,
      blocked: { failures: interpreted.failures },
    });
  } else {
    finished = await runtime.projectStore.finishReading({
      readingId: started.readingId,
      failure: { kind: interpreted.kind, httpStatus: interpreted.httpStatus },
    });
  }
  logAllowlisted(logger, request, "reading-outcome", { ...finished, diagnostics: interpreted.diagnostics });
  if (finished?.status === "blocked") {
    sendJson(res, 200, { status: "blocked", failures: finished.failures });
    return;
  }
  if (!finished?.ok) {
    sendFailure(res, finished || { httpStatus: 503, kind: "database" });
    return;
  }
  sendJson(res, 200, { status: "ready", ...finished.reading });
}

async function handleReadingCast(req, res, { maxBodyBytes, logger, nextRequest, runtime, readingId }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "PUT") {
    sendEmpty(res, 405, { Allow: "PUT" });
    req.resume();
    return;
  }
  const body = await readJsonBody(req, res, maxBodyBytes);
  if (body.done) return;
  if (body.invalid || !runtime.projectStore) {
    const failed = { ok: false, httpStatus: body.invalid ? 400 : 503, kind: body.invalid ? "invalid-request" : "database" };
    logAllowlisted(logger, request, "cast-edit", failed);
    sendFailure(res, failed);
    return;
  }
  const result = await runtime.projectStore.replacePendingCast(readingId, body.payload);
  logAllowlisted(logger, request, "cast-edit", result);
  if (!result.ok) {
    sendFailure(res, result);
    return;
  }
  sendJson(res, 200, { status: "ok" });
}

async function handleConfirmations(req, res, { maxBodyBytes, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const body = await readJsonBody(req, res, maxBodyBytes);
  if (body.done) return;
  if (body.invalid || !body.payload || typeof body.payload.readingId !== "string" || !runtime.projectStore) {
    const failed = {
      ok: false,
      httpStatus: runtime.projectStore && !body.invalid ? 400 : (body.invalid ? 400 : 503),
      kind: runtime.projectStore && (body.invalid || body.payload) ? "invalid-request" : "database",
    };
    if (!runtime.projectStore && !body.invalid) failed.kind = "database";
    logAllowlisted(logger, request, "confirm", failed);
    sendFailure(res, failed);
    return;
  }
  const result = await runtime.projectStore.confirmReading({ readingId: body.payload.readingId });
  logAllowlisted(logger, request, "confirm", result);
  if (!result.ok) {
    sendFailure(res, result);
    return;
  }
  sendJson(res, 200, {
    sourceRevisionId: result.sourceRevisionId,
    interpretationId: result.interpretationId,
    materialStateId: result.materialStateId,
  });
}

async function handleMaterialStates(req, res, { maxBodyBytes, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const body = await readJsonBody(req, res, maxBodyBytes);
  if (body.done) return;
  if (body.invalid || !runtime.projectStore) {
    const failed = { ok: false, httpStatus: body.invalid ? 400 : 503, kind: body.invalid ? "invalid-request" : "database" };
    logMaterial(logger, request, failed);
    sendFailure(res, failed);
    return;
  }
  let result;
  try {
    result = await runtime.projectStore.reviseMaterialState(body.payload);
  } catch {
    result = { ok: false, httpStatus: 503, kind: "database" };
  }
  logMaterial(logger, request, result);
  if (!result?.ok) {
    sendFailure(res, result || { httpStatus: 503, kind: "database" });
    return;
  }
  sendJson(res, 200, {
    materialStateId: result.materialStateId,
    sourceRevisionId: result.sourceRevisionId,
    interpretationId: result.interpretationId,
  });
}

async function handleProject(req, res, { logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "GET") {
    sendEmpty(res, 405, { Allow: "GET" });
    return;
  }
  if (!runtime.projectStore) {
    logLine(logger, { request, status: "failed", kind: "database", http: 503 });
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  try {
    const project = await runtime.projectStore.loadProject();
    if (!project) {
      logLine(logger, { request, status: "failed", kind: "database", http: 503 });
      sendJson(res, 503, { status: "failed", kind: "database" });
      return;
    }
    sendJson(res, 200, project);
  } catch {
    logLine(logger, { request, status: "failed", kind: "database", http: 503 });
    if (!res.headersSent) sendJson(res, 503, { status: "failed", kind: "database" });
  }
}

async function handleDraft(req, res, { maxBodyBytes, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "PUT") {
    sendEmpty(res, 405, { Allow: "PUT" });
    req.resume();
    return;
  }
  const declared = req.headers["content-length"];
  if (declared != null && declared !== "") {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBodyBytes) {
      logDraft(logger, request, { ok: false, httpStatus: 413 });
      closeEmpty(res, 413);
      return;
    }
  }
  if (!isJsonContentType(req.headers["content-type"])) {
    logDraft(logger, request, { ok: false, kind: "invalid-request", httpStatus: 415 });
    sendEmpty(res, 415);
    req.resume();
    return;
  }
  const read = await readLimited(req, maxBodyBytes);
  if (read.tooBig) {
    if (!res.headersSent) {
      logDraft(logger, request, { ok: false, httpStatus: 413 });
      closeEmpty(res, 413);
    }
    return;
  }
  let payload;
  try {
    payload = JSON.parse(read.body.toString("utf8"));
  } catch {
    logDraft(logger, request, { ok: false, kind: "invalid-request", httpStatus: 400 });
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const inputError = draftInputError({
    text: payload && typeof payload === "object" && !Array.isArray(payload) ? payload.text : undefined,
    revisionToken: payload && typeof payload === "object" && !Array.isArray(payload) ? payload.revisionToken : undefined,
  });
  if (inputError) {
    logDraft(logger, request, { ok: false, kind: inputError, httpStatus: 400 });
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  if (!runtime.projectStore) {
    logDraft(logger, request, { ok: false, kind: "database", httpStatus: 503 });
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  try {
    const result = await runtime.projectStore.saveDraft({
      text: payload.text,
      revisionToken: payload.revisionToken,
    });
    logDraft(logger, request, result);
    if (!result.ok) {
      sendJson(res, result.httpStatus, { status: "failed", kind: result.kind });
      return;
    }
    sendJson(res, 200, { revisionToken: result.revisionToken });
  } catch {
    logDraft(logger, request, { ok: false, kind: "database", httpStatus: 503 });
    if (!res.headersSent) sendJson(res, 503, { status: "failed", kind: "database" });
  }
}

function publicFailures(failures) {
  if (!Array.isArray(failures)) return [];
  const clean = [];
  for (const failure of failures) {
    if (!failure || typeof failure.code !== "string" || !/^[a-z]+(?:-[a-z]+)*$/.test(failure.code)) continue;
    const entry = { code: failure.code };
    if (typeof failure.sourceItemId === "string") entry.sourceItemId = failure.sourceItemId;
    clean.push(entry);
  }
  return clean;
}

async function handleStoryboardResults(req, res, { maxBodyBytes, env, fetchImpl, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const declared = req.headers["content-length"];
  if (declared != null && declared !== "" && Number(declared) > maxBodyBytes) {
    closeEmpty(res, 413);
    return;
  }
  const read = await readLimited(req, maxBodyBytes);
  if (read.tooBig) {
    if (!res.headersSent) closeEmpty(res, 413);
    return;
  }
  if (read.body.length > 0) {
    if (!isJsonContentType(req.headers["content-type"])) {
      sendEmpty(res, 415);
      return;
    }
    try {
      JSON.parse(read.body.toString("utf8"));
    } catch {
      const failed = { ok: false, httpStatus: 400, status: "failed", kind: "invalid-request" };
      logAllowlisted(logger, request, "storyboard-persist", failed);
      sendJson(res, 400, { status: "failed", kind: "invalid-request" });
      return;
    }
  }
  if (typeof runtime.projectStore?.stageActiveMaterial !== "function") {
    const failed = { ok: false, httpStatus: 503, status: "failed", kind: "database" };
    logAllowlisted(logger, request, "storyboard-persist", failed);
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  const providerEnv = env ?? process.env;
  let result;
  try {
    result = await runtime.projectStore.stageActiveMaterial({
      stage(input) {
        if (!loadConfig(providerEnv).ok) {
          return { ok: false, httpStatus: 500, status: "failed", kind: "configuration" };
        }
        return stageStoryboard({
          draft: input?.draftText,
          sourceItems: input?.sourceItems,
          cast: input?.cast,
          env: providerEnv,
          fetchImpl,
        });
      },
    });
  } catch {
    result = { ok: false, httpStatus: 503, status: "failed", kind: "database" };
  }
  logAllowlisted(logger, request, "storyboard-persist", result);
  if (result?.status === "blocked") {
    sendJson(res, 200, {
      status: "blocked",
      failures: publicFailures(result.failures),
      materialStateId: result.materialStateId,
      readyEligible: false,
    });
    return;
  }
  if (result?.status === "checked") {
    sendJson(res, 200, {
      status: "checked",
      materialStateId: result.materialStateId,
      sourceRevisionId: result.sourceRevisionId,
      readyEligible: result.readyEligible === true,
      sourceItems: result.sourceItems,
      frames: result.frames,
      review: result.review,
    });
    return;
  }
  sendJson(res, result?.httpStatus || 500, {
    status: "failed",
    kind: safeKind(result?.kind) || "database",
  });
}

function visualCharacterPath(pathname, suffix) {
  const pattern = suffix === "identity"
    ? /^\/api\/visual\/characters\/([^/]+)\/identity$/
    : /^\/api\/visual\/characters\/([^/]+)\/anchor$/;
  const match = pathname.match(pattern);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function visualAnchorApprovalPath(pathname) {
  const match = pathname.match(/^\/api\/visual\/characters\/([^/]+)\/anchors\/([0-9a-f-]{36})\/approve$/i);
  if (!match) return null;
  try {
    return { characterName: decodeURIComponent(match[1]), anchorId: match[2] };
  } catch {
    return null;
  }
}

function visualFramePath(pathname) {
  const frame = pathname.match(/^\/api\/visual\/frames\/([^/]+)\/generate$/);
  if (frame) return { frameId: decodeURIComponent(frame[1]), kind: "frame" };
  const panel = pathname.match(/^\/api\/visual\/frames\/([^/]+)\/panels\/(\d+)\/(generate|placement)$/);
  if (!panel) return null;
  return {
    frameId: decodeURIComponent(panel[1]),
    panelIndex: Number(panel[2]),
    kind: panel[3],
  };
}

async function readVisualBody(req, res, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return readJsonBody(req, res, maxBytes);
}

function logVisual(logger, request, event, fields = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    if (typeof value === "string" && value.length > 120) continue;
    safe[key] = value;
  }
  logLine(logger, { request, event, ...safe });
}

/** Compact allowlisted canonical-intent evidence for eligible panel logs. No raw prose. */
function panelReadyDiagnosticFields(intent, refs = {}, assembled = {}) {
  if (!intent?.compilerVersion) return {};
  const identityAuthorityId = refs?.anchor?.id || undefined;
  const styleAuthorityId = assembled?.identityAlsoStyle === true
    ? identityAuthorityId
    : (refs?.style?.id || undefined);
  const fields = {
    compilerVersion: intent.compilerVersion,
    intentFraming: intent.framing,
    intentUpperBody: intent.upperBody,
    intentGesture: intent.gesture,
    intentHeadPose: intent.headPose,
    intentGaze: intent.gaze == null ? "none" : intent.gaze,
    intentExpression: intent.expression,
    intentBackground: intent.background,
    identityAuthorityId,
    styleAuthorityId,
  };
  if (intent.eyes) fields.intentEyes = intent.eyes;
  if (intent.eyebrows) fields.intentEyebrows = intent.eyebrows;
  return fields;
}

function imageMeta(image) {
  if (!image?.ok && !image?.mime && !image?.bytes) return {};
  return {
    mime: image.mime || image.image?.mime,
    width: image.width ?? image.image?.width,
    height: image.height ?? image.image?.height,
    byteLength: image.byteLength ?? image.bytes?.length ?? image.image?.bytes?.length,
  };
}

async function sendVisualState(res, runtime, { logger, request, extra = null } = {}) {
  const visual = await runtime.visualStore.load();
  if (!visual?.ok) {
    logVisual(logger, request, "visual-load-failed", {
      status: "failed",
      kind: safeKind(visual?.kind) || "database",
      http: visual?.httpStatus || 503,
    });
    sendVisualFailure(res, visual);
    return;
  }
  sendJson(res, 200, extra ? { ...visual, ...extra } : visual);
}

function handleBuild(req, res) {
  if ((req.method || "GET") !== "GET") {
    sendEmpty(res, 405, { Allow: "GET" });
    req.resume();
    return;
  }
  sendJson(res, 200, loadBuildInfo());
}

async function handleOperations(req, res, { runtime, logger, nextRequest }) {
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  if (!runtime.visualStore?.applyOperation) {
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  const body = await readVisualBody(req, res, IMAGE_MAX_BODY_BYTES);
  if (body.done) return;
  if (body.invalid || !body.payload || typeof body.payload !== "object") {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const request = nextRequest();
  const result = await runtime.visualStore.applyOperation(body.payload);
  if (!result.ok) {
    logVisual(logger, request, "visual-operation", {
      status: "failed",
      kind: safeKind(result.kind),
      http: result.httpStatus || 400,
    });
    sendVisualFailure(res, result);
    return;
  }
  logVisual(logger, request, "visual-operation", { status: "ok", http: 200 });
  await sendVisualState(res, runtime, {
    logger,
    request,
    extra: { changed: result.changed !== false },
  });
}

async function handleRender(req, res, { runtime, logger, nextRequest }) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    sendEmpty(res, 405, { Allow: "GET, POST" });
    req.resume();
    return;
  }
  const controller = runtime.ensureRender();
  if (method === "GET") {
    req.resume();
    sendJson(res, 200, controller.status());
    return;
  }
  const request = nextRequest();
  const declaredLength = Number(req.headers["content-length"] || 0);
  let payload = {};
  if (declaredLength > 0) {
    const body = await readVisualBody(req, res);
    if (body.done) return;
    if (body.invalid || !body.payload || typeof body.payload !== "object") {
      sendJson(res, 400, { status: "failed", kind: "invalid-request" });
      return;
    }
    payload = body.payload;
  } else {
    req.resume();
  }
  const transition = normalizeExportTransition(payload.transition ?? "hard-cut");
  if (!transition) {
    sendJson(res, 400, { status: "failed", kind: "invalid-transition" });
    return;
  }
  if (!runtime.visualStore) {
    sendJson(res, 503, { status: "failed", kind: "database" });
    return;
  }
  const visual = await runtime.visualStore.load();
  if (!visual?.ok || visual.status !== "ready") {
    sendJson(res, 409, { status: "failed", kind: "no-storyboard" });
    return;
  }
  const port = req.socket?.localPort;
  if (!port) {
    sendJson(res, 500, { status: "failed", kind: "configuration" });
    return;
  }
  const compiled = compileVideoSpec(visual, {
    assetOrigin: `http://127.0.0.1:${port}`,
    transition,
  });
  if (!compiled.ok) {
    sendJson(res, 400, { status: "failed", kind: safeKind(compiled.kind) || "invalid-request" });
    return;
  }
  const correlationId = randomUUID();
  const overlapFrames = compiled.spec.project.exportTransition?.overlapFrames ?? 0;
  let resolveStarted;
  const startedGate = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  const renderContext = createEmptyContext({
    workflowPhase: "visual",
    storyboardVersionId: visual.storyboardVersionId ?? null,
    transitionMode: transition,
    transitionOverlapFrames: overlapFrames,
  });
  const started = controller.start(compiled.spec, {
    onStart: async () => {
      try {
        await recordRenderEvent(runtime, {
          eventKind: "action_start",
          correlationId,
          semanticAction: "render",
          surface: "product_control",
          submittedText: null,
          commandTarget: createEmptyCommandTarget("storyboard"),
          editTarget: null,
          context: renderContext,
        });
      } finally {
        resolveStarted();
      }
    },
    onTerminal: async ({ status }) => {
      await recordRenderEvent(runtime, {
        eventKind: "action_terminal",
        correlationId,
        outcome: status === "success" ? "success" : "failure",
        outcomeKind: status === "success" ? null : "render-failed",
        outcomeFlags: {},
      });
    },
  });
  if (!started.ok) {
    resolveStarted();
    logVisual(logger, request, "render", { status: "failed", kind: safeKind(started.kind), http: started.httpStatus || 409 });
    sendVisualFailure(res, started);
    return;
  }
  await startedGate;
  logVisual(logger, request, "render", { status: "running", http: 202 });
  sendJson(res, 202, {
    status: "running",
    id: started.id,
    transition,
    overlapFrames,
    totalDurationFrames: compiled.spec.project.totalDurationFrames,
    nominalDurationFrames: compiled.spec.project.nominalDurationFrames,
  });
}

async function recordRenderEvent(runtime, input) {
  if (!runtime.researchStore?.appendEvent) return;
  await runtime.researchStore.appendEvent(input).catch(() => {});
}

async function handleRenderResult(req, res, { runtime }) {
  if ((req.method || "GET") !== "GET") {
    sendEmpty(res, 405, { Allow: "GET" });
    req.resume();
    return;
  }
  const file = runtime.ensureRender().resultFile();
  if (!file) {
    sendEmpty(res, 404);
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    sendEmpty(res, 404);
    return;
  }
  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": info.size,
    "Cache-Control": "no-store",
    "Content-Disposition": "inline; filename=\"storyboard.mp4\"",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

async function handleVisualIdentity(req, res, { runtime, characterName, logger, nextRequest }) {
  if (req.method !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const request = nextRequest ? nextRequest() : undefined;
  const started = Date.now();
  logVisual(logger, request, "visual-identity-start", { operation: "identity-save" });
  const body = await readVisualBody(req, res, IMAGE_MAX_BODY_BYTES);
  if (body.done) return;
  if (body.invalid) {
    logVisual(logger, request, "visual-identity-outcome", {
      status: "failed",
      kind: "invalid-request",
      http: 400,
      latencyMs: Date.now() - started,
    });
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const image = parseIdentityImage(body.payload?.imageDataUrl);
  if (!image.ok) {
    logVisual(logger, request, "visual-identity-outcome", {
      status: "failed",
      kind: safeKind(image.kind),
      http: 400,
      latencyMs: Date.now() - started,
    });
    sendJson(res, 400, { status: "failed", kind: image.kind });
    return;
  }
  const result = await runtime.visualStore.saveIdentity({
    characterName,
    image,
    comment: body.payload?.comment || "",
  });
  logVisual(logger, request, "visual-identity-outcome", {
    status: result.ok ? "ok" : "failed",
    kind: result.ok ? undefined : safeKind(result.kind),
    http: result.ok ? 200 : result.httpStatus,
    latencyMs: Date.now() - started,
    ...imageMeta(image),
  });
  if (!result.ok) {
    sendVisualFailure(res, result);
    return;
  }
  await sendVisualState(res, runtime, { logger, request });
}

function promptFlags(references, assembled = {}) {
  const roles = new Set(references.map((ref) => ref.role));
  const omittedStyle = Boolean(assembled.roles?.has?.("style")) && !roles.has("style");
  const hasCurrent = roles.has("previous") || roles.has("current");
  return {
    hasPrevious: hasCurrent,
    hasPerformance: roles.has("performance"),
    hasStyle: omittedStyle ? false : Boolean(assembled.hasStyle),
    identityAlsoStyle: omittedStyle ? false : assembled.identityAlsoStyle === true,
    previousDropped: assembled.previousDropped === true && !hasCurrent,
  };
}

function referenceGenerationMode(assembled = {}) {
  if (assembled.hasPerformance) return "performance";
  if (assembled.hasPrevious) return "revision";
  return "initial";
}

async function deliverPreparedImage({
  slots,
  generationMode,
  assembled,
  compile,
  aspectRatio,
  imageGenerator,
  env,
  fetchImpl,
}) {
  const sourceEnv = env ?? process.env;
  const config = loadImageReferenceConfig(sourceEnv);
  if (!config.ok) {
    return {
      ok: false,
      status: "failed",
      kind: "configuration",
      httpStatus: 500,
      diagnostics: { strategy: "invalid" },
    };
  }
  return executeImageRequest({
    strategy: config.strategy,
    budgetBytes: config.budgetBytes,
    references: (slots || []).filter((slot) => slot?.asset).map((slot) => toReference(slot.role, slot.asset)),
    generationMode,
    compilePrompt: (references) => compile(promptFlags(references, assembled)),
    aspectRatio,
    model: resolveImageModel(sourceEnv),
    imageGenerator,
    env: sourceEnv,
    fetchImpl,
  });
}

async function handleVisualAnchor(req, res, {
  runtime,
  characterName,
  imageGenerator,
  env,
  fetchImpl,
  logger,
  nextRequest,
}) {
  if (req.method !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const request = nextRequest ? nextRequest() : undefined;
  const started = Date.now();
  logVisual(logger, request, "visual-anchor-start", { operation: "anchor-generate" });
  const body = await readVisualBody(req, res);
  if (body.done) return;
  if (body.invalid) {
    logVisual(logger, request, "visual-anchor-provider", {
      status: "failed",
      kind: "invalid-request",
      http: 400,
      latencyMs: Date.now() - started,
    });
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const pending = await runtime.visualStore.beginAnchor({
    characterName,
    instruction: body.payload?.instruction || "",
  });
  if (!pending.ok) {
    logVisual(logger, request, "visual-anchor-provider", {
      status: "failed",
      kind: safeKind(pending.kind),
      http: pending.httpStatus,
      latencyMs: Date.now() - started,
    });
    sendVisualFailure(res, pending);
    return;
  }
  const assembled = assembleAnchorReferences({
    identity: pending.identity,
    previous: pending.previous,
    style: pending.style,
  });
  const providerStarted = Date.now();
  const result = await deliverPreparedImage({
    slots: assembled.slots,
    generationMode: "anchor",
    assembled,
    compile: (flags) => anchorPrompt({
      characterName,
      identityComment: pending.identityComment,
      instruction: pending.instruction,
      hasPrevious: flags.hasPrevious,
      hasStyle: flags.hasStyle,
    }),
    aspectRatio: "4:5",
    imageGenerator,
    env,
    fetchImpl,
  });
  logVisual(logger, request, "visual-anchor-provider", {
    ...transportLogFields(result?.diagnostics),
    status: result?.ok ? "ok" : "failed",
    kind: result?.ok ? undefined : safeKind(result?.kind),
    providerStatus: Number.isInteger(result?.diagnostics?.providerStatus)
      ? result.diagnostics.providerStatus
      : undefined,
    latencyMs: Date.now() - providerStarted,
    model: typeof result?.metadata?.model === "string" ? result.metadata.model : undefined,
    hasStyle: assembled.hasStyle,
    hasPrevious: assembled.hasPrevious,
    generationId: pending.id,
  });
  const finished = await runtime.visualStore.finishAnchor({ id: pending.id, result });
  logVisual(logger, request, "visual-anchor-storage", {
    status: finished.ok ? "ok" : "failed",
    kind: finished.ok ? undefined : safeKind(finished.kind),
    http: finished.ok ? 200 : finished.httpStatus,
    generationId: pending.id,
    latencyMs: Date.now() - started,
    ...imageMeta(result?.image),
  });
  if (!finished.ok) {
    sendVisualFailure(res, finished);
    return;
  }
  await sendVisualState(res, runtime, { logger, request });
}

async function handleVisualAnchorApproval(req, res, { runtime, target, logger, nextRequest }) {
  if (req.method !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const request = nextRequest ? nextRequest() : undefined;
  const body = await readVisualBody(req, res);
  if (body.done) return;
  if (body.invalid) {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const result = await runtime.visualStore.approveAnchor(target);
  logVisual(logger, request, "visual-anchor-approve", {
    status: result.ok ? "ok" : "failed",
    kind: result.ok ? undefined : safeKind(result.kind),
    http: result.ok ? 200 : result.httpStatus,
    generationId: target.anchorId,
    styleSeedAssetId: result.styleSeedAssetId,
  });
  if (!result.ok) {
    sendVisualFailure(res, result);
    return;
  }
  await sendVisualState(res, runtime, { logger, request });
}

async function generateOnePanel({
  runtime,
  frameId,
  panelIndex,
  body,
  imageGenerator,
  env,
  fetchImpl,
  logger,
  request,
  authoritiesPrechecked = false,
}) {
  const performanceImage = body?.performanceImageDataUrl
    ? parseImageDataUrl(body.performanceImageDataUrl)
    : null;
  if (body?.performanceImageDataUrl && !performanceImage) return failedVisual("invalid-image", 400);
  if (!authoritiesPrechecked) {
    const visual = await runtime.visualStore.load();
    const frame = visual?.frames?.find((entry) => entry.id === frameId);
    const preflight = frame
      ? validateCharacterGeneration({
        frame,
        characters: visual.characters,
        styleSeedAssetId: visual.styleSeedAssetId,
        panelIndex,
      })
      : null;
    if (preflight && !preflight.ok) {
      logVisual(logger, request, "visual-panel-provider", {
        status: "failed",
        kind: safeKind(preflight.kind),
        http: preflight.httpStatus,
        frameId,
        panelIndex,
      });
      return preflight;
    }
  }
  logVisual(logger, request, "visual-panel-start", {
    operation: "panel-generate",
    frameId,
    panelIndex,
  });
  const pending = await runtime.visualStore.beginPanelGeneration({
    frameId,
    panelIndex,
    instruction: body?.instruction || "",
    performanceImage,
    clearPerformance: body?.clearPerformance === true,
  });
  if (!pending.ok) {
    logVisual(logger, request, "visual-panel-provider", {
      status: "failed",
      kind: safeKind(pending.kind),
      http: pending.httpStatus,
      frameId,
      panelIndex,
    });
    return pending;
  }
  const constrained = usesConstrainedPanelPrompt(pending.frame, panelIndex);
  const assembled = assemblePanelReferences({ ...pending.refs, panelReady: constrained });
  const providerStarted = Date.now();
  let diagnosticFields = {};
  let intent = null;
  if (constrained) {
    intent = compilePanelReadyIntent({
      frame: pending.frame,
      panelIndex,
      characterName: pending.subject,
      description: pending.panel.description,
      instruction: pending.instruction,
      hasPerformance: assembled.hasPerformance,
      partnerName: pending.frame?.panels?.[panelIndex === 0 ? 1 : 0]?.subject ?? null,
    });
    diagnosticFields = panelReadyDiagnosticFields(intent, pending.refs, assembled);
  }
  const result = await deliverPreparedImage({
    slots: assembled.slots,
    generationMode: referenceGenerationMode(assembled),
    assembled,
    compile: (flags) => (constrained
      ? compilePanelReadyPrompt(intent, flags)
      : panelPrompt({
        characterName: pending.subject,
        description: pending.panel.description,
        instruction: pending.instruction,
        layout: pending.frame.layout,
        panelIndex,
        speakerPanel: pending.frame.speakerPanel,
        hasPrevious: flags.hasPrevious,
        hasPerformance: flags.hasPerformance,
        hasStyle: flags.hasStyle,
      })),
    aspectRatio: aspectRatioForFrame(pending.frame),
    imageGenerator,
    env,
    fetchImpl,
  });
  logVisual(logger, request, "visual-panel-provider", {
    ...transportLogFields(result?.diagnostics),
    status: result?.ok ? "ok" : "failed",
    kind: result?.ok ? undefined : safeKind(result?.kind),
    providerStatus: Number.isInteger(result?.diagnostics?.providerStatus)
      ? result.diagnostics.providerStatus
      : undefined,
    latencyMs: Date.now() - providerStarted,
    frameId,
    panelIndex,
    generationId: pending.id,
    storyboardVersionId: pending.storyboardVersionId,
    ...diagnosticFields,
  });
  const finished = await runtime.visualStore.finishPanelGeneration({
    id: pending.id,
    result,
    provenance: {
      origin: "generation",
      subject: pending.subject || null,
      description: pending.panel?.description || "",
      submittedText: pending.instruction || null,
      intent: constrained ? intent : null,
      structureFrameId: pending.frame?.structureFrameId || pending.frame?.id || null,
      panelId: pending.panel?.id || null,
      panelIndex,
      styleAssetId: pending.refs?.style?.id || pending.refs?.anchor?.id || null,
      sourceAssetId: pending.refs?.previous?.id || null,
    },
  });
  logVisual(logger, request, "visual-panel-storage", {
    status: finished.ok ? "ok" : "failed",
    kind: finished.ok ? undefined : safeKind(finished.kind),
    http: finished.ok ? 200 : finished.httpStatus,
    frameId,
    panelIndex,
    generationId: pending.id,
    ...imageMeta(result?.image),
    ...diagnosticFields,
  });
  return finished;
}

function failedVisual(kind, httpStatus) {
  return { ok: false, status: "failed", kind, httpStatus };
}

async function handleVisualGeneration(req, res, {
  runtime,
  target,
  imageGenerator,
  env,
  fetchImpl,
  logger,
  nextRequest,
}) {
  const request = nextRequest ? nextRequest() : undefined;
  if (target.kind === "placement") {
    if (req.method !== "PATCH") {
      sendEmpty(res, 405, { Allow: "PATCH" });
      req.resume();
      return;
    }
    const body = await readVisualBody(req, res);
    if (body.done) return;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const patch = {
      frameId: target.frameId,
      panelIndex: target.panelIndex,
    };
    for (const key of ["zoom", "positionX", "positionY", "mirrored", "reset"]) {
      if (Object.hasOwn(payload, key)) patch[key] = payload[key];
    }
    const result = body.invalid ? failedVisual("invalid-request", 400) : await runtime.visualStore.updatePlacement(patch);
    logVisual(logger, request, "visual-placement", {
      status: result.ok ? "ok" : "failed",
      kind: result.ok ? undefined : safeKind(result.kind),
      http: result.ok ? 200 : result.httpStatus,
      frameId: target.frameId,
      panelIndex: target.panelIndex,
    });
    if (!result.ok) {
      sendVisualFailure(res, result);
      return;
    }
    await sendVisualState(res, runtime, {
      logger,
      request,
      extra: { changed: result.changed !== false },
    });
    return;
  }
  if (req.method !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const body = await readVisualBody(req, res, IMAGE_MAX_BODY_BYTES);
  if (body.done) return;
  if (body.invalid) {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  if (target.kind === "generate") {
    const result = await generateOnePanel({
      runtime,
      frameId: target.frameId,
      panelIndex: target.panelIndex,
      body: body.payload,
      imageGenerator,
      env,
      fetchImpl,
      logger,
      request,
    });
    if (!result.ok) {
      sendVisualFailure(res, result);
      return;
    }
    await sendVisualState(res, runtime, { logger, request });
    return;
  }
  const visual = await runtime.visualStore.load();
  const frame = visual?.frames?.find((entry) => entry.id === target.frameId);
  if (!frame) {
    logVisual(logger, request, "visual-frame-outcome", {
      status: "failed",
      kind: "not-found",
      http: 404,
      frameId: target.frameId,
    });
    sendJson(res, 404, { status: "failed", kind: "not-found" });
    return;
  }
  const framePreflight = validatePanelReadyAuthorities({
    frame,
    characters: visual.characters,
    styleSeedAssetId: visual.styleSeedAssetId,
  });
  if (framePreflight && !framePreflight.ok) {
    logVisual(logger, request, "visual-frame-outcome", {
      status: "failed",
      kind: safeKind(framePreflight.kind),
      http: framePreflight.httpStatus,
      frameId: target.frameId,
    });
    sendVisualFailure(res, framePreflight);
    return;
  }
  const started = Date.now();
  logVisual(logger, request, "visual-frame-start", {
    operation: "frame-generate",
    frameId: target.frameId,
    panelCount: frame.panels.length,
    storyboardResultId: visual.storyboardResultId,
    storyboardVersionId: visual.storyboardVersionId,
  });
  const failures = [];
  for (let panelIndex = 0; panelIndex < frame.panels.length; panelIndex += 1) {
    const result = await generateOnePanel({
      runtime,
      frameId: target.frameId,
      panelIndex,
      body: {},
      imageGenerator,
      env,
      fetchImpl,
      logger,
      request,
      authoritiesPrechecked: true,
    });
    if (!result.ok) failures.push({ panelIndex, kind: safeKind(result.kind) || "provider" });
  }
  logVisual(logger, request, "visual-frame-outcome", {
    status: failures.length ? "partial" : "ok",
    frameId: target.frameId,
    failureCount: failures.length,
    latencyMs: Date.now() - started,
    storyboardResultId: visual.storyboardResultId,
    storyboardVersionId: visual.storyboardVersionId,
  });
  const refreshed = await runtime.visualStore.load();
  sendJson(res, 200, { ...refreshed, generationFailures: failures });
}

async function handleVisualEdit(req, res, { runtime, env, fetchImpl, logger, nextRequest }) {
  if (req.method !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const request = nextRequest ? nextRequest() : "visual-edit";
  const body = await readVisualBody(req, res);
  if (body.done) return;
  const instruction = body.invalid ? "" : String(body.payload?.instruction ?? "").trim();
  if (!instruction) {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const [project, visual, structure] = await Promise.all([
    runtime.projectStore.loadProject(),
    runtime.visualStore.load(),
    runtime.visualStore.loadStructure(),
  ]);
  if (!project?.material || visual?.status !== "ready" || !structure?.ok) {
    sendJson(res, 404, { status: "failed", kind: "not-found" });
    return;
  }
  const board = (project.storyboards || []).find((entry) => entry.materialStateId === project.activeMaterialStateId);
  const edited = await editStoryboard({
    draft: project.draft.text,
    sourceItems: board?.sourceItems || [],
    cast: project.material.cast,
    frames: structure.frames,
    displayFrames: visual.frames,
    instruction,
    env,
    fetchImpl,
  });
  if (!edited.ok) {
    if (edited.status === "blocked" || edited.kind === "structure-rejected") {
      logLine(logger, {
        request,
        event: "visual-edit",
        status: "blocked",
        kind: "structure-rejected",
        http: 409,
        codes: formatCodes(edited.failures),
      });
      sendJson(res, 409, { status: "failed", kind: "structure-rejected" });
    } else {
      logLine(logger, {
        request,
        event: "visual-edit",
        status: "failed",
        kind: safeKind(edited.kind),
        http: edited.httpStatus,
      });
      sendVisualFailure(res, edited);
    }
    return;
  }
  const saved = await runtime.visualStore.saveStoryboardEdit({ instruction, frames: edited.body.frames });
  if (!saved.ok) {
    sendVisualFailure(res, saved);
    return;
  }
  await sendVisualState(res, runtime);
}

async function handleVisualSimple(req, res, { runtime, action }) {
  if (req.method !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  const body = await readVisualBody(req, res);
  if (body.done) return;
  if (body.invalid) {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const result = await runtime.visualStore[action]();
  if (!result.ok) {
    sendVisualFailure(res, result);
    return;
  }
  const extra = action === "undoStoryboardEdit"
    ? {
      changed: true,
      undoneLabel: result.undoneLabel ?? null,
      undoneTarget: result.undoneTarget ?? null,
    }
    : null;
  await sendVisualState(res, runtime, { extra });
}

const RESEARCH_FORBIDDEN_KEYS = new Set([
  "image",
  "bytes",
  "imageBytes",
  "performanceImageDataUrl",
  "dataUrl",
  "dataURL",
  "authorization",
  "token",
  "apiKey",
  "DATABASE_URL",
  "providerResponse",
  "rawResponse",
  "messages",
  "prompt",
  "headers",
  "requestBody",
  "responseBody",
]);

function researchPayloadHasForbiddenKeys(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => researchPayloadHasForbiddenKeys(entry));
  }
  for (const [key, child] of Object.entries(value)) {
    if (RESEARCH_FORBIDDEN_KEYS.has(key)) return true;
    if (researchPayloadHasForbiddenKeys(child)) return true;
  }
  return false;
}

function sendResearchStoreResult(res, result, successStatus = 201) {
  if (!result?.ok) {
    sendJson(res, result?.httpStatus || 500, {
      status: "failed",
      kind: result?.kind || "database",
    });
    return;
  }
  sendJson(res, successStatus, { event: result.event });
}

async function handleResearchNotes(req, res, { maxBodyBytes, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  if (!runtime.researchStore) {
    logLine(logger, { request, event: "research-note", status: "failed", kind: "configuration", http: 500 });
    sendJson(res, 500, { status: "failed", kind: "configuration" });
    return;
  }
  const body = await readJsonBody(req, res, maxBodyBytes);
  if (body.done) return;
  if (body.invalid || researchPayloadHasForbiddenKeys(body.payload)) {
    logLine(logger, { request, event: "research-note", status: "failed", kind: "invalid-request", http: 400 });
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const result = await runtime.researchStore.appendNote(body.payload);
  if (!result.ok) {
    logLine(logger, {
      request,
      event: "research-note",
      status: "failed",
      kind: result.kind,
      http: result.httpStatus || 400,
    });
    sendResearchStoreResult(res, result);
    return;
  }
  logLine(logger, { request, event: "research-note", status: "ok", http: 201 });
  sendResearchStoreResult(res, result, 201);
}

async function handleResearchEvents(req, res, { maxBodyBytes, logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "POST") {
    sendEmpty(res, 405, { Allow: "POST" });
    req.resume();
    return;
  }
  if (!runtime.researchStore) {
    logLine(logger, { request, event: "research-event", status: "failed", kind: "configuration", http: 500 });
    sendJson(res, 500, { status: "failed", kind: "configuration" });
    return;
  }
  const body = await readJsonBody(req, res, maxBodyBytes);
  if (body.done) return;
  if (body.invalid || researchPayloadHasForbiddenKeys(body.payload)) {
    logLine(logger, { request, event: "research-event", status: "failed", kind: "invalid-request", http: 400 });
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const result = await runtime.researchStore.appendEvent(body.payload);
  if (!result.ok) {
    logLine(logger, {
      request,
      event: "research-event",
      status: "failed",
      kind: result.kind,
      http: result.httpStatus || 400,
    });
    sendResearchStoreResult(res, result);
    return;
  }
  logLine(logger, { request, event: "research-event", status: "ok", http: 201 });
  sendResearchStoreResult(res, result, 201);
}

async function handleResearchTrace(req, res, { logger, nextRequest, runtime }) {
  const request = nextRequest();
  if ((req.method || "GET") !== "GET") {
    sendEmpty(res, 405, { Allow: "GET" });
    req.resume();
    return;
  }
  if (!runtime.researchStore) {
    logLine(logger, { request, event: "research-trace", status: "failed", kind: "configuration", http: 500 });
    sendJson(res, 500, { status: "failed", kind: "configuration" });
    return;
  }
  let kind;
  let surface;
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    kind = url.searchParams.get("kind") || undefined;
    surface = url.searchParams.get("surface") || undefined;
  } catch {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  if (kind != null && kind !== "note" && kind !== "action_start" && kind !== "action_terminal") {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  if (surface != null && surface !== "dock_notes" && surface !== "dock_commands" && surface !== "product_control") {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  const result = await runtime.researchStore.listTrace({ kind, surface });
  if (!result.ok) {
    logLine(logger, {
      request,
      event: "research-trace",
      status: "failed",
      kind: result.kind,
      http: result.httpStatus || 503,
    });
    sendJson(res, result.httpStatus || 503, { status: "failed", kind: result.kind || "database" });
    return;
  }
  logLine(logger, { request, event: "research-trace", status: "ok", http: 200 });
  sendJson(res, 200, { events: result.events });
}

async function handle(req, res, {
  load,
  maxBodyBytes,
  env,
  fetchImpl,
  logger,
  nextRequest,
  enableLegacyStoryboardRoute,
  runtime,
  imageGenerator,
}) {
  const pathname = pathnameOf(req.url);
  const method = req.method || "GET";
  if (pathname == null) {
    sendEmpty(res, 404);
    return;
  }
  if (pathname === "/api/research/notes") {
    await handleResearchNotes(req, res, { maxBodyBytes, logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/research/events") {
    await handleResearchEvents(req, res, { maxBodyBytes, logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/research/trace") {
    await handleResearchTrace(req, res, { logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/storyboard") {
    if (!enableLegacyStoryboardRoute) {
      sendEmpty(res, 404);
      req.resume();
      return;
    }
    if (method !== "POST") {
      sendEmpty(res, 405, { Allow: "POST" });
      return;
    }
    await handleStoryboard(req, res, { maxBodyBytes, env, fetchImpl, logger, request: nextRequest() });
    return;
  }
  if (pathname === "/api/project") {
    await handleProject(req, res, { logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/draft") {
    await handleDraft(req, res, { maxBodyBytes, logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/readings") {
    await handleReadings(req, res, { maxBodyBytes, env, fetchImpl, logger, nextRequest, runtime });
    return;
  }
  const readingId = readingCastPath(pathname);
  if (readingId) {
    await handleReadingCast(req, res, { maxBodyBytes, logger, nextRequest, runtime, readingId });
    return;
  }
  if (pathname === "/api/confirmations") {
    await handleConfirmations(req, res, { maxBodyBytes, logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/material-states") {
    await handleMaterialStates(req, res, { maxBodyBytes, logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/storyboard-results") {
    await handleStoryboardResults(req, res, { maxBodyBytes, env, fetchImpl, logger, nextRequest, runtime });
    return;
  }
  if (pathname === "/api/build") {
    handleBuild(req, res);
    return;
  }
  if (pathname === "/api/visual/operations") {
    await handleOperations(req, res, { runtime, logger, nextRequest });
    return;
  }
  if (pathname === "/api/visual/render") {
    await handleRender(req, res, { runtime, logger, nextRequest });
    return;
  }
  if (pathname === "/api/visual/render/result") {
    await handleRenderResult(req, res, { runtime });
    return;
  }
  if (pathname === "/api/visual") {
    if (method !== "GET") {
      sendEmpty(res, 405, { Allow: "GET" });
      req.resume();
      return;
    }
    if (!runtime.visualStore) {
      sendJson(res, 503, { status: "failed", kind: "database" });
      return;
    }
    await sendVisualState(res, runtime, { logger, request: nextRequest() });
    return;
  }
  const assetMatch = pathname.match(/^\/api\/visual\/assets\/([0-9a-f-]{36})$/i);
  if (assetMatch) {
    if (method !== "GET") {
      sendEmpty(res, 405, { Allow: "GET" });
      req.resume();
      return;
    }
    const asset = await runtime.visualStore?.readAsset(assetMatch[1]);
    if (!asset) {
      sendEmpty(res, 404);
      return;
    }
    res.writeHead(200, {
      "Content-Type": asset.mime,
      "Content-Length": asset.bytes.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(asset.bytes);
    return;
  }
  if (pathname === "/api/visual/storyboard/edit") {
    await handleVisualEdit(req, res, { runtime, env, fetchImpl, logger, nextRequest });
    return;
  }
  if (pathname === "/api/visual/storyboard/undo") {
    await handleVisualSimple(req, res, { runtime, action: "undoStoryboardEdit" });
    return;
  }
  if (pathname === "/api/visual/approve") {
    await handleVisualSimple(req, res, { runtime, action: "approveVisual" });
    return;
  }
  const identityCharacter = visualCharacterPath(pathname, "identity");
  if (identityCharacter) {
    await handleVisualIdentity(req, res, {
      runtime,
      characterName: identityCharacter,
      logger,
      nextRequest,
    });
    return;
  }
  const anchorCharacter = visualCharacterPath(pathname, "anchor");
  if (anchorCharacter) {
    await handleVisualAnchor(req, res, {
      runtime,
      characterName: anchorCharacter,
      imageGenerator,
      env,
      fetchImpl,
      logger,
      nextRequest,
    });
    return;
  }
  const anchorApproval = visualAnchorApprovalPath(pathname);
  if (anchorApproval) {
    await handleVisualAnchorApproval(req, res, {
      runtime,
      target: anchorApproval,
      logger,
      nextRequest,
    });
    return;
  }
  const visualTarget = visualFramePath(pathname);
  if (visualTarget) {
    await handleVisualGeneration(req, res, {
      runtime,
      target: visualTarget,
      imageGenerator,
      env,
      fetchImpl,
      logger,
      nextRequest,
    });
    return;
  }
  const route = routesByPath.get(pathname);
  if (!route) {
    sendEmpty(res, 404);
    req.resume();
    return;
  }
  if (method !== route.method) {
    sendEmpty(res, 405, { Allow: route.method });
    req.resume();
    return;
  }
  let bytes;
  try {
    bytes = load(route.file);
  } catch {
    sendEmpty(res, 404);
    return;
  }
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  res.writeHead(200, {
    "Content-Type": contentType(route.file),
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function migrationRunner({ migrate, logger }) {
  if (migrate === false) return null;
  if (typeof migrate === "function") return migrate;
  const migrationLogger = logger ?? console;
  return () => migrateDatabase({ logger: migrationLogger });
}

export function createServer({
  readFile,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  env,
  fetchImpl,
  logger,
  migrate,
  projectStore,
  visualStore,
  researchStore,
  imageGenerator = generateImage,
  enableLegacyStoryboardRoute = false,
  renderController,
} = {}) {
  const load = readFile ?? defaultRead;
  const runtime = {
    projectStore: projectStore ?? null,
    visualStore: visualStore ?? null,
    researchStore: researchStore ?? null,
    pool: null,
    renderController: renderController ?? null,
    ensureRender() {
      if (!this.renderController) this.renderController = createRenderController({ logger });
      return this.renderController;
    },
  };
  let requestSerial = 0;
  const nextRequest = () => {
    requestSerial += 1;
    return String(requestSerial);
  };
  const server = createHttpServer((req, res) => {
    handle(req, res, {
      load,
      maxBodyBytes,
      env,
      fetchImpl,
      logger,
      nextRequest,
      enableLegacyStoryboardRoute,
      runtime,
      imageGenerator,
    }).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { status: "failed", kind: "configuration" });
    });
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  const runMigration = migrationRunner({ migrate, logger });
  const attachStore = () => {
    if (runtime.projectStore && runtime.visualStore && runtime.researchStore) return;
    if (!runtime.pool) runtime.pool = createPool();
    if (!runtime.projectStore) runtime.projectStore = createProjectStore(runtime.pool);
    if (!runtime.visualStore) runtime.visualStore = createVisualStore(runtime.pool);
    if (!runtime.researchStore) runtime.researchStore = createResearchStore(runtime.pool);
  };
  if (runMigration) {
    const listen = server.listen.bind(server);
    let started = false;
    server.listen = (...args) => {
      const callback = typeof args.at(-1) === "function" ? args.pop() : undefined;
      const open = () => listen(...args, ...(callback ? [callback] : []));
      if (started) return open();
      started = true;
      runMigration().then(() => {
        attachStore();
        open();
      }, (error) => {
        server.emit("error", error);
      });
      return server;
    };
  }
  server.on("close", () => {
    runtime.pool?.end().catch(() => {});
  });
  return server;
}

export function startServer({
  port = 4173,
  host = "127.0.0.1",
  logger = console,
  ...options
} = {}) {
  const server = createServer({ ...options, logger });
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      reject(error);
    };
    const ready = () => {
      server.removeListener("error", fail);
      const address = server.address();
      const actualPort = address && typeof address === "object" ? address.port : port;
      const actualHost = address && typeof address === "object" && address.address ? address.address : host;
      logger.log(`Storyboard server listening at http://${actualHost}:${actualPort}/`);
      resolve(server);
    };
    server.once("error", fail);
    server.listen(port, host, ready);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.STORYBOARD_PORT || 4173);
  const host = process.env.STORYBOARD_HOST || "127.0.0.1";
  startServer({ port, host }).catch((error) => {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? ` code=${error.code}` : "";
    console.error(`Storyboard server failed to start${code}`);
    process.exitCode = 1;
  });
}
