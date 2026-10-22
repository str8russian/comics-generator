import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyJudgement, emptyJudgements, judgementPassComplete } from "./judgements.mjs";
import { verifyInputs } from "./inputs.mjs";
import { renderMatchedFaceCrop } from "./crops.mjs";
import { assertSafeEvidence } from "./evidence.mjs";
import { outputFilePath, promptFilePath, readJson } from "./persist.mjs";
import { buildReviewModel, renderReviewPage } from "./render-page.mjs";
import { REVIEW_HOST } from "./constants.mjs";

const PUBLIC_ID = /^source-[ab]\.C-(?:K4|M9|R2)\.r[12]$/;
const INPUT_ID = /^(?:source-a|source-b|style-reference)$/;
const MAX_BODY_BYTES = 256 * 1024;

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export function createReviewServer({ runDir, runtimePath, templatePath, verifiedInputs }) {
  return createServer(async (req, res) => {
    try {
      await route(req, res, { runDir, runtimePath, templatePath, verifiedInputs });
    } catch {
      sendJson(res, 500, { ok: false, kind: "review-error" });
    }
  });
}

export function listenReviewServer(server, { host = REVIEW_HOST, port = 0 } = {}) {
  if (host !== REVIEW_HOST) throw new Error("review server binds only to 127.0.0.1");
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server.address()));
  });
}

async function route(req, res, context) {
  const url = new URL(req.url || "/", `http://${REVIEW_HOST}`);
  const { pathname } = url;
  if (req.method === "GET" && pathname === "/review.css") return serveStatic(res, fileURLToPath(new URL("../public/review.css", import.meta.url)), "text/css; charset=utf-8");
  if (req.method === "GET" && pathname === "/review.js") return serveStatic(res, fileURLToPath(new URL("../public/review.js", import.meta.url)), "text/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/") return sendPage(res, context, url.searchParams.get("reveal") === "1");
  if (req.method === "GET" && pathname.startsWith("/media/input/")) return sendInput(res, context, pathname.slice("/media/input/".length));
  if (req.method === "GET" && pathname.startsWith("/media/output/")) return sendOutput(res, context, pathname.slice("/media/output/".length));
  if (req.method === "GET" && pathname.startsWith("/media/crop/")) return sendCrop(res, context, pathname.slice("/media/crop/".length));
  if (req.method === "GET" && pathname === "/api/judgements.json") return sendJudgementDownload(res, context);
  if (req.method === "POST" && pathname === "/api/judgements") return saveJudgement(req, res, context);
  sendJson(res, 404, { ok: false, kind: "not-found" });
}

async function sendPage(res, context, reveal) {
  const loaded = await loadRun(context.runDir);
  const pass = judgementPassComplete(loaded.manifest, loaded.judgements);
  const manifest = reveal && pass.complete ? await withPromptText(context.runDir, loaded.manifest) : loaded.manifest;
  const html = renderReviewPage(buildReviewModel({ manifest, judgements: loaded.judgements, reveal }));
  sendText(res, 200, "text/html; charset=utf-8", html);
}

async function sendInput(res, context, rawId) {
  const logicalId = decodeURIComponent(rawId);
  if (!INPUT_ID.test(logicalId)) return sendJson(res, 404, { ok: false, kind: "not-found" });
  const verified = context.verifiedInputs || await verifyInputs({ runtimePath: context.runtimePath, templatePath: context.templatePath });
  if (!verified.ok) return sendJson(res, 409, { ok: false, kind: "input-validation" });
  const input = verified.inputs[logicalId];
  sendBytes(res, 200, input.mime, input.bytes);
}

async function sendOutput(res, context, rawId) {
  const cell = await cellByPublicId(context.runDir, rawId);
  if (!cell?.outputPath) return sendJson(res, 404, { ok: false, kind: "not-found" });
  const path = outputFilePath(context.runDir, cell);
  if (!existsSync(path)) return sendJson(res, 404, { ok: false, kind: "not-found" });
  sendFile(res, path, cell.outputMime || "application/octet-stream");
}

async function sendCrop(res, context, rawId) {
  const cell = await cellByPublicId(context.runDir, rawId);
  if (!cell?.outputPath) return sendJson(res, 404, { ok: false, kind: "not-found" });
  const bytes = await readFile(outputFilePath(context.runDir, cell));
  const crop = await renderMatchedFaceCrop(bytes, cell.outputWidth, cell.outputHeight);
  if (!crop) return sendJson(res, 404, { ok: false, kind: "crop-unavailable" });
  sendBytes(res, 200, "image/png", crop.bytes);
}

async function saveJudgement(req, res, context) {
  const loaded = await loadRun(context.runDir);
  const known = new Set((loaded.manifest.cells || []).filter((cell) => cell.status === "succeeded").map((cell) => cell.publicId));
  const fields = await readRequestFields(req);
  const applied = applyJudgement(loaded.judgements, fields.publicId, fields, known);
  if (!applied.ok) return sendJson(res, 400, { ok: false, kind: applied.reason });
  assertSafeEvidence(applied.judgements);
  await writeFile(join(context.runDir, "review", "judgements.json"), `${JSON.stringify(applied.judgements, null, 2)}\n`);
  const pass = judgementPassComplete(loaded.manifest, applied.judgements);
  if ((req.headers.accept || "").includes("application/json")) {
    return sendJson(res, 200, { ok: true, ...pass });
  }
  res.writeHead(303, { ...SECURITY_HEADERS, location: "/" });
  res.end();
}

async function sendJudgementDownload(res, context) {
  const loaded = await loadRun(context.runDir);
  assertSafeEvidence(loaded.judgements);
  const body = JSON.stringify(loaded.judgements, null, 2);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-disposition": "attachment; filename=\"judgements.json\"",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function loadRun(runDir) {
  const manifest = await readJson(join(runDir, "manifest.json"));
  let judgements = emptyJudgements();
  try {
    judgements = await readJson(join(runDir, "review", "judgements.json"));
  } catch {
    judgements = emptyJudgements();
  }
  return { manifest, judgements };
}

async function withPromptText(runDir, manifest) {
  const cells = [];
  for (const cell of manifest.cells || []) {
    let promptText = "";
    try {
      promptText = await readFile(promptFilePath(runDir, cell), "utf8");
    } catch {
      promptText = "";
    }
    cells.push({ ...cell, promptText });
  }
  return { ...manifest, cells };
}

async function cellByPublicId(runDir, rawId) {
  const publicId = decodeURIComponent(rawId);
  if (!PUBLIC_ID.test(publicId)) return null;
  const manifest = await readJson(join(runDir, "manifest.json"));
  return (manifest.cells || []).find((cell) => cell.publicId === publicId) || null;
}

function serveStatic(res, path, type) {
  if (!existsSync(path)) return sendJson(res, 404, { ok: false, kind: "not-found" });
  sendFile(res, path, type);
}

function sendFile(res, file, type) {
  res.writeHead(200, { ...SECURITY_HEADERS, "content-type": type });
  createReadStream(file).pipe(res);
}

function sendBytes(res, status, type, bytes) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type, "content-length": bytes.length });
  res.end(bytes);
}

function sendText(res, status, type, text) {
  const body = Buffer.from(text);
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type, "content-length": body.length });
  res.end(body);
}

function sendJson(res, status, payload) {
  sendText(res, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

async function readRequestFields(req) {
  const raw = await readBody(req);
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) return JSON.parse(raw || "{}");
  return Object.fromEntries(new URLSearchParams(raw));
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
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
