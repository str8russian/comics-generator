import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPool } from "./db/pool.mjs";
import { migrate as migrateDatabase } from "./db/migrate.mjs";
import { loadConfig } from "./config.mjs";
import { isEmptyDraft } from "./fidelity.mjs";
import { interpretDraft } from "./interpret.mjs";
import { draftInputError, createProjectStore } from "./project-store.mjs";
import { stageStoryboard } from "./stage.mjs";
import { IDENTITY_MAX_BODY_BYTES, parseIdentityImage, parseImageDataUrl } from "./image-info.mjs";
import { generateImage } from "./image-provider.mjs";
import { editStoryboard } from "./storyboard-edit.mjs";
import {
  anchorPrompt,
  aspectRatioForFrame,
  assembleAnchorReferences,
  assemblePanelReferences,
  isEligibleHybridDialogueFrame,
  panelPrompt,
} from "./visual-model.mjs";
import { createVisualStore } from "./visual-store.mjs";

export const DEFAULT_MAX_BODY_BYTES = 262144;
export const IMAGE_MAX_BODY_BYTES = IDENTITY_MAX_BODY_BYTES;

export const routes = [
  { method: "GET", path: "/", file: "app/storyboard-web/public/index.html" },
  { method: "GET", path: "/app.js", file: "app/storyboard-web/public/app.js" },
  { method: "GET", path: "/app.css", file: "app/storyboard-web/public/app.css" },
  { method: "GET", path: "/draft-autosave.mjs", file: "app/storyboard-web/public/draft-autosave.mjs" },
  { method: "GET", path: "/hybrid-ui.mjs", file: "app/storyboard-web/public/hybrid-ui.mjs" },
  { method: "GET", path: "/overflow.mjs", file: "app/storyboard-web/overflow.mjs" },
  { method: "GET", path: "/frame-renderer.mjs", file: "prototypes/storyboard-viewer/frame-renderer.mjs" },
  { method: "GET", path: "/viewer.css", file: "prototypes/storyboard-viewer/viewer.css" },
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
  const operation = pathname.match(
    /^\/api\/visual\/frames\/([^/]+)\/operations\/([0-9a-f-]{36})$/i,
  );
  if (operation) {
    return {
      frameId: decodeURIComponent(operation[1]),
      operationId: operation[2],
      kind: "operation",
    };
  }
  const diagnostics = pathname.match(/^\/api\/visual\/frames\/([^/]+)\/diagnostics$/);
  if (diagnostics) {
    return { frameId: decodeURIComponent(diagnostics[1]), kind: "diagnostics" };
  }
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

function validateHybridAuthorities(visual, frame) {
  if (!visual?.styleSeedAssetId) {
    return { ok: false, kind: "style-required", httpStatus: 409 };
  }
  for (const panel of frame.panels || []) {
    const subject = panel.subject;
    if (!subject) {
      return { ok: false, kind: "anchor-required", httpStatus: 409 };
    }
    const character = (visual.characters || []).find((entry) => entry.name === subject);
    if (!character?.approvedAnchorId) {
      return { ok: false, kind: "anchor-required", httpStatus: 409 };
    }
  }
  return { ok: true };
}

function mapHybridFailureKind(kind) {
  const allowed = new Set([
    "configuration",
    "invalid-request",
    "invalid-image",
    "unsupported-image-format",
    "anchor-required",
    "style-required",
    "frame-generation-required",
    "provider",
    "timeout",
    "invalid-output",
    "matte-failed",
    "assembly-failed",
    "database",
    "conflict",
    "not-found",
    "stale-version",
  ]);
  return allowed.has(kind) ? kind : "provider";
}

function scheduleHybridDeferredWork(work) {
  setImmediate(() => {
    Promise.resolve()
      .then(work)
      .catch(() => {
        // Contained: orchestration/finalizers convert failures into terminal outcomes.
      });
  });
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

function imageMeta(image) {
  if (!image?.ok && !image?.mime && !image?.bytes) return {};
  return {
    mime: image.mime || image.image?.mime,
    width: image.width ?? image.image?.width,
    height: image.height ?? image.image?.height,
    byteLength: image.byteLength ?? image.bytes?.length ?? image.image?.bytes?.length,
  };
}

async function sendVisualState(res, runtime, { logger, request } = {}) {
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
  sendJson(res, 200, visual);
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

function imageInput(asset) {
  return asset ? { mime: asset.mime, bytes: asset.bytes } : null;
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
  const result = await imageGenerator({
    prompt: anchorPrompt({
      characterName,
      identityComment: pending.identityComment,
      instruction: pending.instruction,
      hasPrevious: assembled.hasPrevious,
      hasStyle: assembled.hasStyle,
    }),
    images: assembled.images.map(imageInput),
    aspectRatio: "4:5",
    env,
    fetchImpl,
  });
  logVisual(logger, request, "visual-anchor-provider", {
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
}) {
  const performanceImage = body?.performanceImageDataUrl
    ? parseImageDataUrl(body.performanceImageDataUrl)
    : null;
  if (body?.performanceImageDataUrl && !performanceImage) return failedVisual("invalid-image", 400);
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
  const assembled = assemblePanelReferences(pending.refs);
  const providerStarted = Date.now();
  const result = await imageGenerator({
    prompt: panelPrompt({
      characterName: pending.subject,
      description: pending.panel.description,
      instruction: pending.instruction,
      layout: pending.frame.layout,
      panelIndex,
      speakerPanel: pending.frame.speakerPanel,
      hasPrevious: assembled.hasPrevious,
      hasPerformance: assembled.hasPerformance,
      hasStyle: assembled.hasStyle,
    }),
    images: assembled.images.map(imageInput),
    aspectRatio: aspectRatioForFrame(pending.frame),
    env,
    fetchImpl,
  });
  logVisual(logger, request, "visual-panel-provider", {
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
  });
  const finished = await runtime.visualStore.finishPanelGeneration({ id: pending.id, result });
  logVisual(logger, request, "visual-panel-storage", {
    status: finished.ok ? "ok" : "failed",
    kind: finished.ok ? undefined : safeKind(finished.kind),
    http: finished.ok ? 200 : finished.httpStatus,
    frameId,
    panelIndex,
    generationId: pending.id,
    ...imageMeta(result?.image),
  });
  return finished;
}

function failedVisual(kind, httpStatus) {
  return { ok: false, status: "failed", kind, httpStatus };
}

async function handleHybridOperationPoll(req, res, {
  runtime,
  target,
}) {
  if (req.method !== "GET") {
    sendEmpty(res, 405, { Allow: "GET" });
    req.resume();
    return;
  }
  if (typeof runtime.visualStore.getFrameOperation !== "function") {
    sendJson(res, 404, { status: "failed", kind: "not-found" });
    return;
  }
  const operation = await runtime.visualStore.getFrameOperation({
    frameId: target.frameId,
    operationId: target.operationId,
  });
  if (!operation?.ok) {
    sendJson(res, operation?.httpStatus || 404, {
      status: "failed",
      kind: mapHybridFailureKind(operation?.kind || "not-found"),
    });
    return;
  }
  sendJson(res, 200, {
    operationId: operation.operationId,
    frameId: operation.frameId,
    storyboardVersionId: operation.storyboardVersionId,
    writeVersion: operation.writeVersion,
    phase: operation.phase,
    status: operation.status,
    errorKind: operation.errorKind,
    componentFailures: operation.componentFailures || [],
    visualReady: Boolean(operation.visualReady),
    hybrid: operation.hybrid,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    finishedAt: operation.finishedAt,
  });
}

function safeDiagnosticsFilename(frameId, provided) {
  const sanitized = String(frameId || "frame")
    .replace(/\.\./g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/\.\./g, "")
    .slice(0, 80) || "frame";
  const fallback = `frame-${sanitized}-diagnostics.zip`;
  if (typeof provided !== "string") return fallback;
  if (!/^frame-[A-Za-z0-9._-]+-diagnostics\.zip$/.test(provided)) return fallback;
  if (provided.includes("..")) return fallback;
  return provided;
}

async function handleVisualDiagnostics(req, res, {
  runtime,
  target,
  logger,
  request,
}) {
  const started = Date.now();
  if (req.method !== "GET") {
    sendEmpty(res, 405, { Allow: "GET" });
    req.resume();
    return;
  }
  if (typeof runtime.visualStore?.exportFrameDiagnostics !== "function") {
    logVisual(logger, request, "visual-diagnostics-export", {
      status: "failed",
      kind: "not-found",
      frameId: target.frameId,
      latencyMs: Date.now() - started,
    });
    sendJson(res, 404, { status: "failed", kind: "not-found" });
    return;
  }
  let result;
  try {
    result = await runtime.visualStore.exportFrameDiagnostics({ frameId: target.frameId });
  } catch {
    result = { ok: false, status: "failed", kind: "database", httpStatus: 503 };
  }
  if (!result?.ok) {
    const kind = mapHybridFailureKind(result?.kind || "not-found");
    logVisual(logger, request, "visual-diagnostics-export", {
      status: "failed",
      kind,
      frameId: target.frameId,
      storyboardResultId: result?.storyboardResultId,
      storyboardVersionId: result?.storyboardVersionId,
      latencyMs: Date.now() - started,
    });
    sendJson(res, result?.httpStatus || 404, { status: "failed", kind });
    return;
  }
  const filename = safeDiagnosticsFilename(target.frameId, result.filename);
  const bytes = Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes || []);
  logVisual(logger, request, "visual-diagnostics-export", {
    status: "ok",
    frameId: target.frameId,
    storyboardResultId: result.storyboardResultId,
    storyboardVersionId: result.storyboardVersionId,
    byteLength: bytes.length,
    entryCount: Number.isInteger(result.entryCount) ? result.entryCount : undefined,
    latencyMs: Date.now() - started,
  });
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(bytes);
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
  if (target.kind === "operation") {
    await handleHybridOperationPoll(req, res, { runtime, target });
    return;
  }
  if (target.kind === "diagnostics") {
    await handleVisualDiagnostics(req, res, { runtime, target, logger, request });
    return;
  }
  if (target.kind === "placement") {
    if (req.method !== "PATCH") {
      sendEmpty(res, 405, { Allow: "PATCH" });
      req.resume();
      return;
    }
    const body = await readVisualBody(req, res);
    if (body.done) return;
    const result = body.invalid ? failedVisual("invalid-request", 400) : await runtime.visualStore.updatePlacement({
      frameId: target.frameId,
      panelIndex: target.panelIndex,
      zoom: body.payload?.zoom,
      positionX: body.payload?.positionX,
      positionY: body.payload?.positionY,
      fitMode: body.payload?.fitMode,
      expectedStoryboardVersionId: body.payload?.expectedStoryboardVersionId || null,
    });
    logVisual(logger, request, "visual-placement", {
      status: result.ok ? "ok" : "failed",
      kind: result.ok ? undefined : safeKind(result.kind),
      http: result.ok ? 200 : result.httpStatus,
      frameId: target.frameId,
      panelIndex: target.panelIndex,
      fitMode: result.ok ? (result.fitMode || body.payload?.fitMode || "manual") : undefined,
    });
    if (!result.ok) {
      sendVisualFailure(res, result);
      return;
    }
    await sendVisualState(res, runtime, { logger, request });
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
    const visual = await runtime.visualStore.load();
    const frame = visual?.frames?.find((entry) => entry.id === target.frameId);
    if (!frame) {
      sendJson(res, 404, { status: "failed", kind: "not-found" });
      return;
    }
    if (isEligibleHybridDialogueFrame(frame)) {
      await handleHybridPanelAcceptFromParsed({
        res,
        runtime,
        target,
        frame,
        visual,
        imageGenerator,
        env,
        fetchImpl,
        logger,
        request,
      });
      return;
    }
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
  if (isEligibleHybridDialogueFrame(frame)) {
    await handleHybridFrameAcceptFromParsed({
      res,
      runtime,
      target,
      frame,
      visual,
      imageGenerator,
      env,
      fetchImpl,
      logger,
      request,
    });
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

function bindHybridLogger(logger, request) {
  return (event, fields = {}) => {
    logVisual(logger, request, event, fields);
  };
}

function scheduleHybridOrchestration({
  runtime,
  operationId,
  frameId,
  scope,
  panelIndex = null,
  imageGenerator,
  env,
  fetchImpl,
  logger,
  request,
  startedAt,
}) {
  const onHybridLog = bindHybridLogger(logger, request);
  scheduleHybridDeferredWork(async () => {
    try {
      if (typeof runtime.visualStore.orchestrateHybridFrameOperation !== "function") {
        return;
      }
      const outcome = await runtime.visualStore.orchestrateHybridFrameOperation({
        operationId,
        env,
        onHybridLog,
        generateImage: (input) => imageGenerator({
          ...input,
          env,
          fetchImpl,
        }),
      });
      logVisual(logger, request, scope === "panel"
        ? "visual-hybrid-panel-outcome"
        : "visual-hybrid-frame-outcome", {
        status: outcome?.ok ? "ok" : "failed",
        kind: outcome?.ok ? undefined : mapHybridFailureKind(outcome?.kind || "provider"),
        operationId,
        frameId,
        scope,
        panelIndex,
        latencyMs: Date.now() - startedAt,
        visualReady: Boolean(outcome?.visualReady),
      });
    } catch {
      logVisual(logger, request, scope === "panel"
        ? "visual-hybrid-panel-outcome"
        : "visual-hybrid-frame-outcome", {
        status: "failed",
        kind: "provider",
        operationId,
        frameId,
        scope,
        panelIndex,
        latencyMs: Date.now() - startedAt,
      });
      if (typeof runtime.visualStore.updateFrameOperation === "function") {
        await runtime.visualStore.updateFrameOperation({
          operationId,
          phase: "failed",
          status: "failed",
          errorKind: "provider",
          componentFailures: [{ component: "operation", kind: "provider" }],
        }).catch(() => {});
      }
    }
  });
}

async function handleHybridFrameAcceptFromParsed({
  res,
  runtime,
  target,
  frame,
  visual,
  imageGenerator,
  env,
  fetchImpl,
  logger,
  request,
}) {
  const startedAt = Date.now();
  const authorities = validateHybridAuthorities(visual, frame);
  if (!authorities.ok) {
    logVisual(logger, request, "visual-hybrid-frame-outcome", {
      status: "failed",
      kind: mapHybridFailureKind(authorities.kind),
      http: authorities.httpStatus,
      frameId: target.frameId,
      scope: "frame",
    });
    sendJson(res, authorities.httpStatus, {
      status: "failed",
      kind: mapHybridFailureKind(authorities.kind),
    });
    return;
  }
  if (typeof runtime.visualStore.ensureHybridHeads === "function") {
    const heads = await runtime.visualStore.ensureHybridHeads({
      frameId: target.frameId,
      compositionMode: frame.hybrid?.compositionMode || "near-frontal-pair",
    });
    if (!heads?.ok) {
      sendVisualFailure(res, heads || failedVisual("database", 503));
      return;
    }
  }
  if (typeof runtime.visualStore.createFrameOperation !== "function") {
    sendJson(res, 503, { status: "failed", kind: "configuration" });
    return;
  }
  const created = await runtime.visualStore.createFrameOperation({
    frameId: target.frameId,
    scope: "frame",
    phase: "queued",
  });
  if (!created?.ok) {
    sendVisualFailure(res, created || failedVisual("database", 503));
    return;
  }
  logVisual(logger, request, "visual-hybrid-frame-start", {
    operation: "hybrid-frame-generate",
    operationId: created.operationId,
    frameId: created.frameId,
    scope: "frame",
    writeVersion: created.writeVersion,
    storyboardResultId: created.storyboardResultId || visual.storyboardResultId,
    storyboardVersionId: created.storyboardVersionId,
    phase: created.phase || "queued",
  });
  sendJson(res, 202, {
    status: "accepted",
    operationId: created.operationId,
    frameId: created.frameId,
    storyboardVersionId: created.storyboardVersionId,
    phase: created.phase || "queued",
    writeVersion: created.writeVersion,
    scope: "frame",
  });
  scheduleHybridOrchestration({
    runtime,
    operationId: created.operationId,
    frameId: created.frameId,
    scope: "frame",
    imageGenerator,
    env,
    fetchImpl,
    logger,
    request,
    startedAt,
  });
}

async function handleHybridPanelAcceptFromParsed({
  res,
  runtime,
  target,
  frame,
  visual,
  imageGenerator,
  env,
  fetchImpl,
  logger,
  request,
}) {
  const startedAt = Date.now();
  const panelIndex = target.panelIndex;
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= (frame.panels?.length || 0)) {
    sendJson(res, 404, { status: "failed", kind: "not-found" });
    return;
  }
  const authorities = validateHybridAuthorities(visual, {
    ...frame,
    panels: [frame.panels[panelIndex]],
  });
  if (!authorities.ok) {
    logVisual(logger, request, "visual-hybrid-panel-outcome", {
      status: "failed",
      kind: mapHybridFailureKind(authorities.kind),
      http: authorities.httpStatus,
      frameId: target.frameId,
      panelIndex,
      scope: "panel",
    });
    sendJson(res, authorities.httpStatus, {
      status: "failed",
      kind: mapHybridFailureKind(authorities.kind),
    });
    return;
  }
  if (typeof runtime.visualStore.hasReadyPrimaryBackground === "function") {
    const ready = await runtime.visualStore.hasReadyPrimaryBackground();
    if (!ready?.ok) {
      sendVisualFailure(res, ready || failedVisual("database", 503));
      return;
    }
    if (!ready.ready) {
      logVisual(logger, request, "visual-hybrid-panel-outcome", {
        status: "failed",
        kind: "frame-generation-required",
        http: 409,
        frameId: target.frameId,
        panelIndex,
        scope: "panel",
      });
      sendJson(res, 409, { status: "failed", kind: "frame-generation-required" });
      return;
    }
  } else if (frame.hybrid?.background?.status !== "ready") {
    sendJson(res, 409, { status: "failed", kind: "frame-generation-required" });
    return;
  }
  if (typeof runtime.visualStore.ensureHybridHeads === "function") {
    const heads = await runtime.visualStore.ensureHybridHeads({
      frameId: target.frameId,
      compositionMode: frame.hybrid?.compositionMode || "near-frontal-pair",
    });
    if (!heads?.ok) {
      sendVisualFailure(res, heads || failedVisual("database", 503));
      return;
    }
  }
  const created = await runtime.visualStore.createFrameOperation({
    frameId: target.frameId,
    scope: "panel",
    panelIndex,
    phase: "queued",
  });
  if (!created?.ok) {
    sendVisualFailure(res, created || failedVisual("database", 503));
    return;
  }
  logVisual(logger, request, "visual-hybrid-panel-start", {
    operation: "hybrid-panel-generate",
    operationId: created.operationId,
    frameId: created.frameId,
    scope: "panel",
    panelIndex,
    writeVersion: created.writeVersion,
    storyboardResultId: created.storyboardResultId || visual.storyboardResultId,
    storyboardVersionId: created.storyboardVersionId,
    phase: created.phase || "queued",
  });
  sendJson(res, 202, {
    status: "accepted",
    operationId: created.operationId,
    frameId: created.frameId,
    storyboardVersionId: created.storyboardVersionId,
    phase: created.phase || "queued",
    writeVersion: created.writeVersion,
    scope: "panel",
    panelIndex,
  });
  scheduleHybridOrchestration({
    runtime,
    operationId: created.operationId,
    frameId: created.frameId,
    scope: "panel",
    panelIndex,
    imageGenerator,
    env,
    fetchImpl,
    logger,
    request,
    startedAt,
  });
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
  await sendVisualState(res, runtime);
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
  imageGenerator = generateImage,
  enableLegacyStoryboardRoute = false,
} = {}) {
  const load = readFile ?? defaultRead;
  const runtime = { projectStore: projectStore ?? null, visualStore: visualStore ?? null, pool: null };
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
    if (runtime.projectStore && runtime.visualStore) return;
    if (!runtime.pool) runtime.pool = createPool();
    if (!runtime.projectStore) runtime.projectStore = createProjectStore(runtime.pool);
    if (!runtime.visualStore) runtime.visualStore = createVisualStore(runtime.pool);
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
