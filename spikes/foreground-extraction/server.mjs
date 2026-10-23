import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { containedPath, loadManifest } from "./manifest.mjs";

const spikeRoot = dirname(fileURLToPath(import.meta.url));
const publicDir = join(spikeRoot, "public");

export const ARTIFACT_NAMES = new Set([
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

export function unsafeRequestReason(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) return "invalid-request";
  if (rawUrl.includes("\\") || rawUrl.includes("\0")) return "forbidden-path";
  const lowered = rawUrl.toLowerCase();
  if (lowered.includes("..") || lowered.includes("%2e") || lowered.includes(".env")) return "forbidden-path";
  return null;
}

function envSegment(file) {
  const base = file.split(sep).pop() || "";
  return base === ".env" || base.startsWith(".env");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendFile(res, file, type, rootReal) {
  let real;
  try {
    real = realpathSync(file);
    const stat = statSync(real);
    if (!stat.isFile() || envSegment(real) || !containedPath(rootReal, real)) {
      sendJson(res, 403, { ok: false, error: "forbidden-path" });
      return;
    }
  } catch {
    sendJson(res, 404, { ok: false, error: "not-found" });
    return;
  }
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": statSync(real).size,
    "x-content-type-options": "nosniff",
  });
  createReadStream(real).pipe(res);
}

function contentType(name) {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function createDiagnosticServer({ manifest, runDir }) {
  const runReal = realpathSync(runDir);
  const publicReal = realpathSync(publicDir);
  const spikeReal = realpathSync(spikeRoot);
  const sources = new Map(manifest.items.map((item) => [item.id, item]));
  const run = readJson(join(runReal, "run.json"));

  return createServer((req, res) => {
    const blocked = unsafeRequestReason(req.url || "");
    if (blocked) {
      sendJson(res, 400, { ok: false, error: blocked });
      return;
    }
    let url;
    try {
      url = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid-request" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    const path = url.pathname;
    if (STATIC_FILES.has(path)) {
      const staticFile = STATIC_FILES.get(path);
      const root = path === "/review.mjs" ? spikeReal : publicReal;
      sendFile(res, staticFile.file, staticFile.type, root);
      return;
    }
    if (path === "/api/run") {
      const items = run.items.map((item) => {
        const source = sources.get(item.id);
        const reportPath = join(runReal, item.id, "report.json");
        const report = existsSync(reportPath) ? readJson(reportPath) : null;
        const files = { original: `/source/${item.id}` };
        for (const name of ARTIFACT_NAMES) {
          if (existsSync(join(runReal, item.id, name))) files[name] = `/artifact/${item.id}/${name}`;
        }
        return {
          id: item.id,
          alias: item.alias,
          corpus: item.corpus,
          extractionRole: item.extractionRole,
          corpusSelection: report?.corpusSelection || null,
          status: item.status,
          reasons: item.reasons,
          warnings: item.warnings,
          timing: report?.timing || {
            extractCoreMs: item.extractCoreMs,
            diagnosticMs: item.diagnosticMs,
            decodeMs: item.decodeMs,
          },
          metrics: report?.metrics || null,
          input: report?.input || null,
          sha256: source?.sha256 || report?.sha256 || null,
          crops: report?.crops || null,
          files,
        };
      });
      sendJson(res, 200, {
        ok: true,
        runId: runDir.split(sep).pop(),
        manifestHash: run.manifestHash,
        providerCalls: run.providerCalls,
        thresholds: run.thresholds,
        summary: run.summary,
        timing: run.timing,
        sourceImmutability: run.sourceImmutability,
        items,
        ownerReview: {
          schema: "spike-a-stage-a1-owner-review/v1",
          judgements: ["accept", "reject", "uncertain"],
          reloadLoss: "Judgements stay in this browser tab and disappear on reload. Download the JSON to keep them.",
        },
      });
      return;
    }
    const sourceMatch = path.match(/^\/source\/([a-z0-9][a-z0-9-]*)$/);
    if (sourceMatch) {
      const item = sources.get(sourceMatch[1]);
      if (!item) {
        sendJson(res, 404, { ok: false, error: "not-found" });
        return;
      }
      sendFile(res, item.resolvedPath, "image/png", item.rootReal);
      return;
    }
    const artifactMatch = path.match(/^\/artifact\/([a-z0-9][a-z0-9-]*)\/([a-z0-9.-]+)$/);
    if (artifactMatch) {
      const [, id, name] = artifactMatch;
      if (!sources.has(id) || !ARTIFACT_NAMES.has(name)) {
        sendJson(res, 404, { ok: false, error: "not-found" });
        return;
      }
      const itemRoot = join(runReal, id);
      sendFile(res, join(itemRoot, name), contentType(name), itemRoot);
      return;
    }
    sendJson(res, 404, { ok: false, error: "not-found" });
  });
}

export function latestRunDirectory(outputRoot = join(spikeRoot, "output")) {
  if (!existsSync(outputRoot)) return null;
  const runs = readdirSync(outputRoot)
    .filter((name) => existsSync(join(outputRoot, name, "run.json")))
    .sort();
  if (runs.length === 0) return null;
  return join(outputRoot, runs[runs.length - 1]);
}

function parseArgs(argv) {
  const args = { manifestPath: join(spikeRoot, "manifest.json"), port: 4391, runDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--manifest") args.manifestPath = resolve(argv[++i]);
    else if (token === "--run") args.runDir = resolve(argv[++i]);
    else if (token === "--port") args.port = Number(argv[++i]);
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function listen(server, port) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = args.runDir || latestRunDirectory();
  if (!runDir) {
    console.error("no extraction run directory; pass --run");
    process.exitCode = 1;
    return;
  }
  const manifest = loadManifest(args.manifestPath);
  const server = createDiagnosticServer({ manifest, runDir });
  let port = args.port;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const address = await listen(server, port);
      if (!address || address.address !== "127.0.0.1") {
        console.error("refusing to listen outside 127.0.0.1");
        process.exitCode = 1;
        return;
      }
      console.log(`review http://127.0.0.1:${address.port}/`);
      console.log(`run ${runDir}`);
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      port += 1;
    }
  }
  console.error("no local port available");
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
