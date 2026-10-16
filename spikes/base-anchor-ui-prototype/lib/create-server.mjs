import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "../../../app/storyboard-web/image-provider.mjs";
import { generatePrototypeImage } from "./generate.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "../public");
const defaultFixture = join(root, "../../../app/storyboard-web/public/character-anchors/putin.png");

export const FORBIDDEN_PORT = 4173;
export const DEFAULT_PORT = 4186;
export const MAX_BODY_BYTES = 52 * 1024 * 1024;

const STATIC_FILES = new Map([
  ["/", { path: join(publicDir, "index.html"), type: "text/html; charset=utf-8" }],
  ["/index.html", { path: join(publicDir, "index.html"), type: "text/html; charset=utf-8" }],
  ["/app.css", { path: join(publicDir, "app.css"), type: "text/css; charset=utf-8" }],
  ["/app.js", { path: join(publicDir, "app.js"), type: "text/javascript; charset=utf-8" }],
  ["/state.mjs", { path: join(root, "state.mjs"), type: "text/javascript; charset=utf-8" }],
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("too-large"), { code: "too-large" }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function serveFile(res, file) {
  if (!file || !existsSync(file.path)) {
    sendJson(res, 404, { ok: false, kind: "not-found" });
    return;
  }
  const normalized = normalize(file.path);
  res.writeHead(200, {
    "content-type": file.type,
    "cache-control": "no-store",
  });
  createReadStream(normalized).pipe(res);
}

export function createPrototypeServer({
  imageGenerator = generateImage,
  env = process.env,
  fetchImpl,
  logger = () => {},
  fixturePath = defaultFixture,
} = {}) {
  let inflight = false;
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "GET" && path === "/fixture/ready-anchor.png") {
      serveFile(res, { path: fixturePath, type: "image/png" });
      return;
    }

    if (req.method === "GET" && STATIC_FILES.has(path)) {
      serveFile(res, STATIC_FILES.get(path));
      return;
    }

    if (path === "/api/generate") {
      if (req.method !== "POST") {
        sendEmpty(res, 405, { Allow: "POST" });
        req.resume();
        return;
      }
      if (inflight) {
        sendJson(res, 409, { ok: false, kind: "busy" });
        req.resume();
        return;
      }
      inflight = true;
      try {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          sendJson(res, 400, { ok: false, kind: "invalid-request" });
          return;
        }
        const result = await generatePrototypeImage({
          body,
          env,
          imageGenerator,
          fetchImpl,
          logger,
        });
        if (!result.ok) {
          sendJson(res, result.httpStatus, { ok: false, kind: result.kind });
          return;
        }
        sendJson(res, 200, { ok: true, imageDataUrl: result.imageDataUrl, mime: result.mime });
      } catch (error) {
        if (error?.code === "too-large") {
          logger({ event: "prototype-generate", ok: false, kind: "invalid-request" });
          sendJson(res, 400, { ok: false, kind: "invalid-request" });
          return;
        }
        logger({ event: "prototype-generate", ok: false, kind: "provider" });
        sendJson(res, 502, { ok: false, kind: "provider" });
      } finally {
        inflight = false;
      }
      return;
    }

    sendJson(res, 404, { ok: false, kind: "not-found" });
    req.resume();
  });
}
