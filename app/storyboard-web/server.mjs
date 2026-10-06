import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_MAX_BODY_BYTES = 262144;

export const routes = [
  { method: "GET", path: "/", file: "app/storyboard-web/public/index.html" },
  { method: "GET", path: "/app.js", file: "app/storyboard-web/public/app.js" },
  { method: "GET", path: "/app.css", file: "app/storyboard-web/public/app.css" },
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

async function handleStoryboard(req, res, maxBodyBytes) {
  const declared = req.headers["content-length"];
  if (declared != null && declared !== "") {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBodyBytes) {
      closeEmpty(res, 413);
      return;
    }
  }
  if (!isJsonContentType(req.headers["content-type"])) {
    sendEmpty(res, 415);
    req.resume();
    return;
  }
  const read = await readLimited(req, maxBodyBytes);
  if (read.tooBig) {
    if (!res.headersSent) closeEmpty(res, 413);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(read.body.toString("utf8"));
  } catch {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.draft !== "string") {
    sendJson(res, 400, { status: "failed", kind: "invalid-request" });
    return;
  }
  // Storyboard generation is a later pass. This route does not call a provider.
  sendJson(res, 500, { status: "failed", kind: "configuration" });
}

async function handle(req, res, { load, maxBodyBytes }) {
  const pathname = pathnameOf(req.url);
  const method = req.method || "GET";
  if (pathname == null) {
    sendEmpty(res, 404);
    return;
  }
  if (pathname === "/api/storyboard") {
    if (method !== "POST") {
      sendEmpty(res, 405, { Allow: "POST" });
      return;
    }
    await handleStoryboard(req, res, maxBodyBytes);
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

export function createServer({ readFile, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const load = readFile ?? defaultRead;
  const server = createHttpServer((req, res) => {
    handle(req, res, { load, maxBodyBytes }).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { status: "failed", kind: "configuration" });
    });
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.STORYBOARD_PORT || 4173);
  const server = createServer();
  server.listen(port, "127.0.0.1");
}
