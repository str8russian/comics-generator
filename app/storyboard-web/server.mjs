import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPool } from "./db/pool.mjs";
import { migrate as migrateDatabase } from "./db/migrate.mjs";
import { interpretDraft } from "./interpret.mjs";
import { draftInputError, createProjectStore } from "./project-store.mjs";
import { stageStoryboard } from "./stage.mjs";

export const DEFAULT_MAX_BODY_BYTES = 262144;

export const routes = [
  { method: "GET", path: "/", file: "app/storyboard-web/public/index.html" },
  { method: "GET", path: "/app.js", file: "app/storyboard-web/public/app.js" },
  { method: "GET", path: "/app.css", file: "app/storyboard-web/public/app.css" },
  { method: "GET", path: "/draft-autosave.mjs", file: "app/storyboard-web/public/draft-autosave.mjs" },
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

async function handle(req, res, {
  load,
  maxBodyBytes,
  env,
  fetchImpl,
  logger,
  nextRequest,
  enableLegacyStoryboardRoute,
  runtime,
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
  enableLegacyStoryboardRoute = false,
} = {}) {
  const load = readFile ?? defaultRead;
  const runtime = { projectStore: projectStore ?? null, pool: null };
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
    }).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { status: "failed", kind: "configuration" });
    });
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  const runMigration = migrationRunner({ migrate, logger });
  const attachStore = () => {
    if (runtime.projectStore) return;
    runtime.pool = createPool();
    runtime.projectStore = createProjectStore(runtime.pool);
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
