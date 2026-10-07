import { createServer } from "node:http";
import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ScoreError, scoreStageArtistic } from "./score.mjs";

const fixtureUrl = new URL("./fixture.json", import.meta.url);
const targetUrl = new URL("./target.json", import.meta.url);
const candidateUrl = new URL("./results/current-stage.candidate.json", import.meta.url);

export const defaultCandidatePath = fileURLToPath(candidateUrl);

const files = {
  "/": new URL("./preview.html", import.meta.url),
  "/preview.js": new URL("./preview.js", import.meta.url),
  "/overflow.mjs": new URL("../../overflow.mjs", import.meta.url),
  "/frame-renderer.mjs": new URL("../../../../prototypes/storyboard-viewer/frame-renderer.mjs", import.meta.url),
  "/viewer.css": new URL("../../../../prototypes/storyboard-viewer/viewer.css", import.meta.url),
  "/app.css": new URL("../../public/app.css", import.meta.url),
};

function isEnvironmentName(name) {
  return name === ".env" || name.startsWith(".env.");
}

export function readPreviewJson(fileUrl) {
  const canonical = realpathSync(fileURLToPath(fileUrl));
  if (isEnvironmentName(basename(canonical))) {
    throw new Error("refusing to read an environment file");
  }
  return JSON.parse(readFileSync(canonical, "utf8"));
}

function copyPanels(panels) {
  return panels.map((panel) => ({ description: panel.description }));
}

function fixtureQuotes(text, segments) {
  if (!Array.isArray(segments) || segments.length < 2) return null;
  let cursor = 0;
  const quotes = [];
  for (const segment of segments) {
    if (typeof segment.quote !== "string" || !text.startsWith(segment.quote, cursor)) return null;
    quotes.push(text.slice(cursor, cursor + segment.quote.length));
    cursor += segment.quote.length;
  }
  if (cursor !== text.length) return null;
  return quotes;
}

export function framesForPreview(fixture, candidate) {
  const byId = new Map(fixture.sourceItems.map((item) => [item.id, item]));
  return candidate.frames.map((frame) => {
    const panels = copyPanels(frame.panels);
    if (frame.origin === "derived") {
      return {
        id: frame.id,
        layout: frame.layout,
        origin: "derived",
        panels,
        placement: frame.placement,
        dialogue: "",
      };
    }
    const item = byId.get(frame.sourceItemId);
    const base = {
      id: frame.id,
      layout: frame.layout,
      origin: "source",
      panels,
      sourceItemId: frame.sourceItemId,
      sourceRole: frame.sourceRole,
    };
    if (frame.sourceRole === "action") {
      return { ...base, dialogue: "", outsideFrameText: item.text };
    }
    const shown = {
      ...base,
      speakerPanel: frame.speakerPanel,
      dialogue: item.text,
      displayBlock: { sourceItemId: item.id, start: 0, end: item.text.length },
    };
    const quotes = frame.directingBeat === true ? fixtureQuotes(item.text, frame.segments) : null;
    if (quotes) {
      shown.directingBeat = true;
      shown.segments = frame.segments.map((segment, index) => ({
        quote: quotes[index],
        layout: segment.layout,
        speakerPanel: segment.speakerPanel,
        panels: copyPanels(segment.panels),
      }));
    }
    return shown;
  });
}

export function preparePreview({ fixture, target, candidate }) {
  let score;
  try {
    score = scoreStageArtistic(fixture, target, candidate);
  } catch (error) {
    return {
      ok: false,
      kind: error instanceof ScoreError && error.code === "invalid-candidate" ? "schema" : "invalid-preview",
    };
  }
  if (!score.sourceFidelity.ok) return { ok: false, kind: "source-fidelity" };
  return {
    ok: true,
    payload: {
      status: "checked",
      sourceItems: fixture.sourceItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
      })),
      frames: framesForPreview(fixture, candidate),
    },
  };
}

export function loadPreviewInputs() {
  return {
    fixture: readPreviewJson(fixtureUrl),
    target: readPreviewJson(targetUrl),
    candidate: readPreviewJson(candidateUrl),
  };
}

function contentType(pathname) {
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname === "/") return "text/html; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/javascript; charset=utf-8";
}

function send(res, status, body, type) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": buffer.length,
  });
  res.end(buffer);
}

export function startPreview(payload, log = console.log) {
  const bytes = new Map(Object.entries(files).map(([pathname, url]) => [pathname, readFileSync(url)]));
  const previewJson = Buffer.from(JSON.stringify(payload));
  const server = createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" });
      res.end();
      return;
    }
    if (pathname === "/preview.json") {
      send(res, 200, previewJson, contentType(pathname));
      return;
    }
    const file = bytes.get(pathname);
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    send(res, 200, file, contentType(pathname));
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object" || address.address !== "127.0.0.1") {
        server.close(() => reject(new Error("preview must bind to 127.0.0.1")));
        return;
      }
      const url = `http://127.0.0.1:${address.port}/`;
      log(url);
      resolve({ server, url });
    });
  });
}

export function stopPreview(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function ranAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (ranAsCli()) {
  let prepared;
  try {
    prepared = preparePreview(loadPreviewInputs());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "preview-not-ready");
    process.exitCode = 1;
  }
  if (prepared && !prepared.ok) {
    console.error(`preview-not-ready: ${prepared.kind}`);
    process.exitCode = 1;
  } else if (prepared?.ok) {
    await startPreview(prepared.payload);
  }
}
