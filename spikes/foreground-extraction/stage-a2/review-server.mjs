import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { containedPath } from "../manifest.mjs";

const spikeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(spikeRoot, "public");

export const A2_ARTIFACT_NAMES = new Set([
  "original.png",
  "original.jpeg",
  "original.webp",
  "foreground.png",
  "alpha.png",
  "boundary-overlay.png",
  "composite-checkerboard.png",
  "composite-black.png",
  "composite-white.png",
  "composite-magenta.png",
  "composite-green.png",
  "composite-slate.png",
  "crop-hair.png",
  "crop-ear-silhouette.png",
  "crop-shoulder-contact.png",
  "crop-enclosed-pocket.png",
  "crop-contour-gap.png",
  "crop-matte-edge-contact.png",
  "crop-worst-boundary.png",
  "report.json",
]);

const STATIC_FILES = new Map([
  ["/", { file: join(publicDir, "index.html"), type: "text/html; charset=utf-8" }],
  ["/index.html", { file: join(publicDir, "index.html"), type: "text/html; charset=utf-8" }],
  ["/app.css", { file: join(publicDir, "app.css"), type: "text/css; charset=utf-8" }],
  ["/app.js", { file: join(publicDir, "app.js"), type: "text/javascript; charset=utf-8" }],
  ["/review.mjs", { file: join(spikeRoot, "review.mjs"), type: "text/javascript; charset=utf-8" }],
]);

export function isStageA2Run(runDir) {
  const file = join(runDir, "run.json");
  if (!existsSync(file)) return false;
  try {
    return JSON.parse(readFileSync(file, "utf8")).stage === "a2";
  } catch {
    return false;
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendFile(response, file, type, rootReal) {
  let real;
  try {
    real = realpathSync(file);
    const stat = statSync(real);
    if (!stat.isFile() || !containedPath(rootReal, real)) {
      sendJson(response, 403, { ok: false, error: "forbidden-path" });
      return;
    }
  } catch {
    sendJson(response, 404, { ok: false, error: "not-found" });
    return;
  }
  response.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": statSync(real).size,
    "x-content-type-options": "nosniff",
  });
  createReadStream(real).pipe(response);
}

function contentType(name) {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpeg") || name.endsWith(".jpg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function createStageA2Server({ runDir }) {
  const runReal = realpathSync(runDir);
  const publicReal = realpathSync(publicDir);
  const spikeReal = realpathSync(spikeRoot);
  const run = JSON.parse(readFileSync(join(runReal, "run.json"), "utf8"));
  const manifestHash = existsSync(join(runReal, "run.sha256"))
    ? readFileSync(join(runReal, "run.sha256"), "utf8").trim()
    : null;
  const sources = new Map((run.sources || []).map((source) => [source.id, source]));
  const cells = new Map((run.cells || []).map((cell) => [cell.id, cell]));

  return createServer((request, response) => {
    const rawUrl = request.url || "";
    if (rawUrl.length === 0 || rawUrl.length > 2048 || rawUrl.includes("\\") || rawUrl.includes("\0")) {
      sendJson(response, 400, { ok: false, error: "invalid-request" });
      return;
    }
    const lowered = rawUrl.toLowerCase();
    if (lowered.includes("..") || lowered.includes("%2e") || lowered.includes(".env")) {
      sendJson(response, 400, { ok: false, error: "forbidden-path" });
      return;
    }
    let url;
    try {
      url = new URL(rawUrl, "http://127.0.0.1");
    } catch {
      sendJson(response, 400, { ok: false, error: "invalid-request" });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    const path = url.pathname;
    if (STATIC_FILES.has(path)) {
      const staticFile = STATIC_FILES.get(path);
      sendFile(response, staticFile.file, staticFile.type, path === "/review.mjs" ? spikeReal : publicReal);
      return;
    }
    if (path === "/api/run") {
      const identities = [];
      for (const source of run.sources || []) {
        const identityCells = (run.cells || [])
          .filter((cell) => cell.identityId === source.id)
          .map((cell) => {
            const reportPath = join(runReal, cell.id, "report.json");
            const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
            const files = {};
            const cellRoot = join(runReal, cell.id);
            for (const name of A2_ARTIFACT_NAMES) {
              if (existsSync(join(cellRoot, name))) files[name] = `/artifact/${cell.id}/${name}`;
            }
            return {
              id: cell.id,
              identityId: cell.identityId,
              cell: cell.cell,
              state: cell.state,
              unattemptedReason: cell.unattemptedReason || null,
              reviewRisk: cell.reviewRisk === true,
              lineage: cell.lineage || null,
              automaticStatus: cell.extraction?.status || report?.extraction?.status || null,
              reasons: cell.extraction?.reasons || report?.extraction?.reasons || [],
              warnings: cell.extraction?.warnings || report?.extraction?.warnings || [],
              timing: report?.extraction?.timing || cell.extraction?.timing || null,
              metrics: report?.extraction?.metrics || null,
              contract: cell.contract || null,
              request: cell.request || null,
              provider: cell.provider || null,
              output: cell.output || null,
              crops: report?.extraction?.crops || null,
              files,
            };
          });
        identities.push({
          id: source.id,
          characterName: source.characterName,
          sha256: source.sha256,
          mime: source.mime,
          sourceUrl: `/source/${source.id}`,
          cells: identityCells,
        });
      }
      sendJson(response, 200, {
        ok: true,
        stage: "a2",
        runId: run.runId,
        manifestHash,
        providerCalls: run.providerInvocations,
        stopReason: run.stopReason,
        thresholds: run.extractor,
        matteContract: {
          version: run.matteContract?.version || null,
          sha256: run.matteContract?.sha256 || null,
        },
        summary: run.summary,
        timing: run.timing,
        model: run.model,
        identities,
        ownerReview: {
          schema: "spike-a-stage-a2-owner-review/v1",
          judgements: ["accept", "review", "reject"],
          reloadLoss: "Judgements stay in this browser tab and disappear on reload. Download the JSON to keep them.",
        },
      });
      return;
    }
    const sourceMatch = path.match(/^\/source\/(identity-[123])$/);
    if (sourceMatch) {
      const source = sources.get(sourceMatch[1]);
      if (!source?.copy) {
        sendJson(response, 404, { ok: false, error: "not-found" });
        return;
      }
      sendFile(response, join(runReal, source.copy), contentType(source.copy), runReal);
      return;
    }
    const artifactMatch = path.match(/^\/artifact\/(identity-[123]-(?:anchor|panel-close|panel-gesture))\/([a-z0-9.-]+)$/);
    if (artifactMatch) {
      const [, id, name] = artifactMatch;
      if (!cells.has(id) || !A2_ARTIFACT_NAMES.has(name)) {
        sendJson(response, 404, { ok: false, error: "not-found" });
        return;
      }
      const itemRoot = join(runReal, id);
      sendFile(response, join(itemRoot, name), contentType(name), itemRoot);
      return;
    }
    sendJson(response, 404, { ok: false, error: "not-found" });
  });
}

export function listenStageA2(server, port) {
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}
