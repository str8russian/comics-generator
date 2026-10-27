import { requireProjectId } from "./project-scope.mjs";

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

function sendResearchStoreResult(res, result, sendJson, successStatus = 201) {
  if (!result?.ok) {
    sendJson(res, result?.httpStatus || 500, {
      status: "failed",
      kind: result?.kind || "database",
    });
    return;
  }
  sendJson(res, successStatus, { event: result.event });
}

async function handleResearchNotes(req, res, {
  maxBodyBytes,
  logger,
  nextRequest,
  runtime,
  sendEmpty,
  sendJson,
  readJsonBody,
  logLine,
}) {
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
  const result = await runtime.researchStore.appendNote({ ...body.payload, projectId: requireProjectId() });
  if (!result.ok) {
    logLine(logger, {
      request,
      event: "research-note",
      status: "failed",
      kind: result.kind,
      http: result.httpStatus || 400,
    });
    sendResearchStoreResult(res, result, sendJson);
    return;
  }
  logLine(logger, { request, event: "research-note", status: "ok", http: 201 });
  sendResearchStoreResult(res, result, sendJson, 201);
}

async function handleResearchEvents(req, res, {
  maxBodyBytes,
  logger,
  nextRequest,
  runtime,
  sendEmpty,
  sendJson,
  readJsonBody,
  logLine,
}) {
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
  const result = await runtime.researchStore.appendEvent({ ...body.payload, projectId: requireProjectId() });
  if (!result.ok) {
    logLine(logger, {
      request,
      event: "research-event",
      status: "failed",
      kind: result.kind,
      http: result.httpStatus || 400,
    });
    sendResearchStoreResult(res, result, sendJson);
    return;
  }
  logLine(logger, { request, event: "research-event", status: "ok", http: 201 });
  sendResearchStoreResult(res, result, sendJson, 201);
}

async function handleResearchTrace(req, res, {
  logger,
  nextRequest,
  runtime,
  sendEmpty,
  sendJson,
  logLine,
}) {
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
  const result = await runtime.researchStore.listTrace({ kind, surface, projectId: requireProjectId() });
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

export async function routeResearch(req, res, pathname, {
  maxBodyBytes,
  logger,
  nextRequest,
  runtime,
  sendEmpty,
  sendJson,
  readJsonBody,
  logLine,
}) {
  if (pathname === "/api/research/notes") {
    await handleResearchNotes(req, res, {
      maxBodyBytes,
      logger,
      nextRequest,
      runtime,
      sendEmpty,
      sendJson,
      readJsonBody,
      logLine,
    });
    return true;
  }
  if (pathname === "/api/research/events") {
    await handleResearchEvents(req, res, {
      maxBodyBytes,
      logger,
      nextRequest,
      runtime,
      sendEmpty,
      sendJson,
      readJsonBody,
      logLine,
    });
    return true;
  }
  if (pathname === "/api/research/trace") {
    await handleResearchTrace(req, res, {
      logger,
      nextRequest,
      runtime,
      sendEmpty,
      sendJson,
      logLine,
    });
    return true;
  }
  return false;
}
