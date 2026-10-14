#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runUnderLimit } from "./lib/probe.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(process.env.IMAGE_SPIKE_FIXTURE_DIR || resolve(here, "fixtures"));
const resultsDir = resolve(process.env.IMAGE_SPIKE_RESULTS_DIR || resolve(here, "results"));
const baseUrl = String(process.env.BASE_URL || "").trim();
const token = String(process.env.CONTEST_API_TOKEN || "").trim();
const model = String(process.env.IMAGE_MODEL || "gemini-3-pro-image-preview").trim();
const timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || process.env.CONTEST_TIMEOUT_MS || 180000);

if (!baseUrl || !token || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  process.stdout.write("IMAGE API UNDER-LIMIT SKIPPED: required configuration is absent or invalid.\n");
  process.exit(0);
}

let report;
try {
  report = await runUnderLimit({
    config: { baseUrl, token, model, timeoutMs },
    fixtureRoot,
    resultsDir,
  });
} catch (error) {
  process.stderr.write(`IMAGE API UNDER-LIMIT NOT RUN: ${String(error?.message || error)}\n`);
  process.exit(2);
}

mkdirSync(resultsDir, { recursive: true });
const reportPath = resolve(resultsDir, "under-limit-report.json");
writeFileSync(reportPath, `${JSON.stringify({
  spike: "image-api-diagnostics-under-limit",
  live: "RUN",
  model,
  ...report,
}, null, 2)}\n`);

for (const item of report.observations) {
  process.stdout.write(`${item.id}: HTTP ${item.response.httpStatus}; refs=${item.roles.length}; body=${item.request.byteLength}; latency=${item.response.latencyMs}ms\n`);
}
process.stdout.write(`Report: ${reportPath}\n`);
