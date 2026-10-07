import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requestStageCandidate } from "../../stage.mjs";
import { scoreStageArtistic } from "./score.mjs";

const RESULT_NAMES = [
  "current-stage.candidate.json",
  "current-stage.score.json",
  "current-stage-summary.md",
  "current-stage.attempt.json",
];

export function createSingleUseFetch(fetchImpl) {
  let requestCount = 0;
  return {
    get requestCount() {
      return requestCount;
    },
    fetch(url, init) {
      if (requestCount >= 1) {
        throw new Error("refusing a second provider request");
      }
      requestCount += 1;
      return fetchImpl(url, init);
    },
  };
}

function writeNew(filePath, contents) {
  writeFileSync(filePath, contents, { encoding: "utf8", flag: "wx" });
}

function attemptRecord(result, requestCount) {
  const record = {
    requestCount,
    kind: result.kind,
    httpStatus: result.httpStatus,
  };
  const finishReason = result.diagnostics?.finishReason;
  if (typeof finishReason === "string") record.finishReason = finishReason;
  const schemaPaths = result.diagnostics?.schemaIssues?.map((issue) => issue.instancePath).filter((path) => typeof path === "string");
  if (schemaPaths && schemaPaths.length > 0) record.schemaPaths = schemaPaths;
  return record;
}

function summarize(candidate) {
  const lines = [
    "# Stage baseline candidate",
    "",
    "Panel descriptions are copied for owner review. This file does not assign human-rubric scores.",
    "",
  ];
  for (const frame of candidate.frames) {
    lines.push(`## ${frame.id}`);
    if (frame.sourceItemId) lines.push(`- sourceItemId: ${frame.sourceItemId}`);
    lines.push(`- layout: ${frame.layout}`);
    lines.push(`- origin: ${frame.origin}`);
    lines.push("- panels:");
    for (const panel of frame.panels) lines.push(`  - ${panel.description}`);
    if (Array.isArray(frame.segments)) {
      lines.push("- segments:");
      frame.segments.forEach((segment, index) => {
        lines.push(`  - ${index + 1}. layout: ${segment.layout}`);
        for (const panel of segment.panels) lines.push(`    - ${panel.description}`);
      });
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function runStageBaseline({ fixture, target, env, fetchImpl, resultsDir }) {
  mkdirSync(resultsDir, { recursive: true });
  const paths = Object.fromEntries(RESULT_NAMES.map((name) => [name, join(resultsDir, name)]));
  if (RESULT_NAMES.some((name) => existsSync(paths[name]))) {
    return { ok: false, requestCount: 0, kind: "result-exists" };
  }

  const transport = createSingleUseFetch(fetchImpl);
  const result = await requestStageCandidate({
    sourceItems: fixture.sourceItems,
    env,
    fetchImpl: transport.fetch,
  });
  const requestCount = transport.requestCount;
  if (!result.ok) {
    const attempt = attemptRecord(result, requestCount);
    writeNew(paths["current-stage.attempt.json"], `${JSON.stringify(attempt, null, 2)}\n`);
    return { ok: false, requestCount, kind: result.kind, httpStatus: result.httpStatus };
  }

  const candidate = {
    frames: result.value.frames,
    review: result.value.review,
  };
  const score = scoreStageArtistic(fixture, target, candidate);
  writeNew(paths["current-stage.candidate.json"], `${JSON.stringify(candidate, null, 2)}\n`);
  writeNew(paths["current-stage.score.json"], `${JSON.stringify(score, null, 2)}\n`);
  writeNew(paths["current-stage-summary.md"], summarize(candidate));
  return { ok: true, requestCount, kind: "stop" };
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
  const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
  const target = JSON.parse(readFileSync(new URL("./target.json", import.meta.url), "utf8"));
  const resultsDir = fileURLToPath(new URL("./results/", import.meta.url));
  const outcome = await runStageBaseline({
    fixture,
    target,
    env: process.env,
    fetchImpl: globalThis.fetch,
    resultsDir,
  });
  const line = JSON.stringify({
    ok: outcome.ok,
    requestCount: outcome.requestCount,
    kind: outcome.kind,
  });
  if (outcome.ok) process.stdout.write(`${line}\n`);
  else {
    process.stderr.write(`${line}\n`);
    process.exitCode = 1;
  }
}
