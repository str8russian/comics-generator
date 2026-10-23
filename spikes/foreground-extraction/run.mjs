import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeItemDirectory } from "./artifacts.mjs";
import { EXTRACTION_CONFIG } from "./config.mjs";
import { decodeImage } from "./decode.mjs";
import { extractForeground } from "./extract.mjs";
import { hashMismatches, loadManifest, sha256File } from "./manifest.mjs";

const spikeRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(spikeRoot, "../..");

export const PROVIDER_CALLS = 0;

export function makeRunId(date = new Date()) {
  return `a1-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

export function allocateRunDirectory(outputRoot, runId = makeRunId()) {
  if (!/^a1-[0-9]{8}T[0-9]{6}Z$/.test(runId) && !/^a1-test-[a-z0-9-]+$/.test(runId)) {
    throw new Error(`refusing run id: ${runId}`);
  }
  mkdirSync(outputRoot, { recursive: true });
  const directory = join(outputRoot, runId);
  if (existsSync(directory)) {
    const error = new Error(`run directory already exists: ${directory}`);
    error.code = "run-directory-exists";
    throw error;
  }
  mkdirSync(directory);
  return directory;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function tally(items, key) {
  const counts = {};
  for (const item of items) {
    for (const code of item[key] || []) counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

function summarize(values) {
  if (values.length === 0) return { totalMs: 0, maxMs: 0, meanMs: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    totalMs: round(total),
    maxMs: round(Math.max(...values)),
    meanMs: round(total / values.length),
  };
}

function failedDecode(error) {
  return {
    status: "reject",
    reasons: ["decode-failed"],
    warnings: [],
    findings: [{ code: "decode-failed", level: "reject", detail: { message: String(error?.message || "decode-failed") } }],
    rgba: null,
    alpha: null,
    boundary: null,
    metrics: {},
    config: EXTRACTION_CONFIG,
  };
}

export async function runManifest({
  manifestPath = join(spikeRoot, "manifest.json"),
  outputRoot = join(spikeRoot, "output"),
  runId = makeRunId(),
} = {}) {
  const manifest = loadManifest(manifestPath);
  const mismatches = hashMismatches(manifest);
  if (mismatches.length > 0) {
    const error = new Error("manifest hash mismatch");
    error.code = "manifest-hash-mismatch";
    error.mismatches = mismatches;
    throw error;
  }
  const hashesBefore = new Map(manifest.items.map((item) => [item.id, sha256File(item.resolvedPath)]));
  const directory = allocateRunDirectory(outputRoot, runId);
  const started = performance.now();
  const items = [];
  for (const item of manifest.items) {
    const sourceBytes = readFileSync(item.resolvedPath);
    const decodeStart = performance.now();
    let decoded = null;
    let extracted;
    try {
      decoded = await decodeImage(sourceBytes);
    } catch (error) {
      extracted = failedDecode(error);
    }
    const decodeMs = performance.now() - decodeStart;
    const extractStart = performance.now();
    if (!extracted) extracted = extractForeground(decoded);
    const extractCoreMs = performance.now() - extractStart;
    const report = {
      id: item.id,
      alias: item.alias,
      corpus: item.corpus,
      extractionRole: item.extractionRole,
      corpusSelection: {
        ownerStyleJudgement: item.ownerStyleJudgement ?? null,
        identity: item.identity ?? null,
        contourAndTonalComplexity: item.contourAndTonalComplexity ?? null,
        selectionNote: item.selectionNote ?? null,
      },
      sha256: item.sha256,
      input: {
        format: decoded?.format || null,
        space: decoded?.space || null,
        width: decoded?.width || null,
        height: decoded?.height || null,
        channels: decoded?.channels || null,
        hasAlpha: decoded ? Boolean(decoded.hasAlpha) : null,
      },
      status: extracted.status,
      reasons: extracted.reasons,
      warnings: extracted.warnings,
      findings: extracted.findings,
      metrics: extracted.metrics,
      thresholds: extracted.config,
      timing: {
        decodeMs: round(decodeMs),
        extractCoreMs: round(extractCoreMs),
      },
    };
    const diagnosticStart = performance.now();
    const crops = await writeItemDirectory(join(directory, item.id), {
      rgba: extracted.rgba,
      source: decoded,
      boundary: extracted.boundary,
      report,
    });
    report.crops = crops;
    report.timing.diagnosticMs = round(performance.now() - diagnosticStart);
    writeFileSync(join(directory, item.id, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    items.push({
      id: item.id,
      alias: item.alias,
      corpus: item.corpus,
      extractionRole: item.extractionRole,
      status: extracted.status,
      reasons: extracted.reasons,
      warnings: extracted.warnings,
      extractCoreMs: report.timing.extractCoreMs,
      diagnosticMs: report.timing.diagnosticMs,
      decodeMs: report.timing.decodeMs,
    });
  }
  const hashesAfter = manifest.items.map((item) => {
    const sha256After = sha256File(item.resolvedPath);
    return {
      id: item.id,
      alias: item.alias,
      sha256Before: hashesBefore.get(item.id),
      sha256After,
      equal: hashesBefore.get(item.id) === sha256After,
    };
  });
  const run = {
    tool: {
      name: "spike-a-foreground-extraction",
      stage: "A1",
      configVersion: EXTRACTION_CONFIG.version,
    },
    implementationCommit: gitCommit(),
    manifestHash: manifest.hash,
    manifestId: manifest.id,
    providerCalls: PROVIDER_CALLS,
    thresholds: EXTRACTION_CONFIG,
    startedAt: new Date(Date.now() - (performance.now() - started)).toISOString(),
    finishedAt: new Date().toISOString(),
    summary: {
      itemCount: items.length,
      statuses: {
        "candidate-pass": items.filter((item) => item.status === "candidate-pass").length,
        review: items.filter((item) => item.status === "review").length,
        reject: items.filter((item) => item.status === "reject").length,
      },
      reasonCounts: tally(items, "reasons"),
      warningCounts: tally(items, "warnings"),
    },
    timing: {
      extractCore: summarize(items.map((item) => item.extractCoreMs)),
      diagnostic: summarize(items.map((item) => item.diagnosticMs)),
      decode: summarize(items.map((item) => item.decodeMs)),
    },
    sourceImmutability: {
      unchanged: hashesAfter.every((item) => item.equal),
      items: hashesAfter,
    },
    items,
  };
  writeFileSync(join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return { directory, run, manifest };
}

function parseArgs(argv) {
  const args = { manifestPath: join(spikeRoot, "manifest.json"), outputRoot: join(spikeRoot, "output") };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--manifest") args.manifestPath = resolve(argv[++i]);
    else if (token === "--out") args.outputRoot = resolve(argv[++i]);
    else if (token === "--run-id") args.runId = argv[++i];
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const { directory, run } = await runManifest(args);
    console.log(`run ${directory}`);
    console.log(`providerCalls ${run.providerCalls}`);
    console.log(`sourceImmutability ${run.sourceImmutability.unchanged ? "unchanged" : "CHANGED"}`);
    console.log(`extractCore mean ${run.timing.extractCore.meanMs}ms max ${run.timing.extractCore.maxMs}ms`);
    console.log(`diagnostic mean ${run.timing.diagnostic.meanMs}ms max ${run.timing.diagnostic.maxMs}ms`);
    for (const item of run.items) {
      console.log(`${item.status}\t${item.extractCoreMs}ms\t${item.id}\t${item.reasons.join(",") || "-"}\t${item.warnings.join(",") || "-"}`);
    }
    if (!run.sourceImmutability.unchanged) process.exitCode = 1;
  } catch (error) {
    if (error.code === "manifest-hash-mismatch") {
      console.error("manifest hash mismatch; extraction stopped");
      for (const mismatch of error.mismatches) {
        console.error(`${mismatch.id} expected ${mismatch.expected} actual ${mismatch.actual}`);
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
