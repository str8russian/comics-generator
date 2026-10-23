// Static server for the W1 workspace prototype. Serves public/ and, under
// /data/, either the local read-only snapshot export or the synthetic fixture.
// It has no write routes and never contacts the production app or database.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export const DEFAULT_PORT = 4190;
export const FORBIDDEN_PORTS = Object.freeze([4173, 5432]);
export const PUBLIC_DIR = join(root, "public");
export const SNAPSHOT_DIR = join(root, "snapshot");
export const FIXTURE_DIR = join(root, "fixture");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export function resolveDataDir({ prefer = process.env.W1_DATA } = {}) {
  if (prefer === "fixture") return { dir: FIXTURE_DIR, kind: "fixture" };
  if (existsSync(join(SNAPSHOT_DIR, "snapshot.json"))) return { dir: SNAPSHOT_DIR, kind: "snapshot" };
  return { dir: FIXTURE_DIR, kind: "fixture" };
}

function inside(base, relative) {
  const target = resolve(base, normalize(relative));
  return target === base || target.startsWith(base + sep) ? target : null;
}

export function createPrototypeServer({ data = resolveDataDir() } = {}) {
  return createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const isData = pathname.startsWith("/data/");
    const base = isData ? data.dir : PUBLIC_DIR;
    const relative = isData ? pathname.slice("/data/".length) : (pathname === "/" ? "index.html" : pathname.slice(1));
    const file = inside(base, relative);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const body = readFileSync(file);
    const immutableImage = isData && relative.startsWith("assets/");
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": immutableImage ? "private, max-age=3600" : "no-store",
      "X-W1-Data-Source": data.kind,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

function main() {
  const port = Number(process.env.W1_PROTOTYPE_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0 || FORBIDDEN_PORTS.includes(port)) {
    console.error(`Refusing to listen on port ${port}. Ports ${FORBIDDEN_PORTS.join(" and ")} belong to the production app and PostgreSQL.`);
    process.exit(1);
  }
  const data = resolveDataDir();
  const server = createPrototypeServer({ data });
  server.on("error", (error) => {
    console.error(error?.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Refusing to take over another service.`
      : "Prototype server failed to start.");
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`W1 workspace prototype: http://127.0.0.1:${port}/`);
    console.log(`Data source: ${data.kind === "snapshot" ? "local read-only snapshot export" : "synthetic fixture"} (${data.dir})`);
    console.log("State lives in browser memory only. Reload restores the snapshot.");
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
