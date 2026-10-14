#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLimitCheck } from "./lib/probe.mjs";
import {
  bindInterrupt,
  createIncrementalReport,
  formatProgressLine,
} from "./lib/transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(process.env.IMAGE_SPIKE_FIXTURE_DIR || resolve(here, "fixtures"));
const resultsDir = resolve(process.env.IMAGE_SPIKE_RESULTS_DIR || resolve(here, "results"));
const baseUrl = String(process.env.BASE_URL || "").trim();
const token = String(process.env.CONTEST_API_TOKEN || "").trim();
const model = String(process.env.IMAGE_MODEL || "gemini-3-pro-image-preview").trim();
const timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || process.env.CONTEST_TIMEOUT_MS || 180000);

if (!baseUrl || !token || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  process.stdout.write("IMAGE API LIMIT CHECK SKIPPED: required configuration is absent or invalid.\n");
  process.exit(0);
}

const verdictText = {
  "provider-unhealthy": "Provider is unhealthy. The under-limit control did not succeed, so the legacy probe was not sent.",
  "legacy-rejected": "The under-limit control succeeded, but the historical full passthrough body is still rejected.",
  "limit-relaxed": "The under-limit control and the historical full passthrough both succeeded. The external limit appears to have been relaxed.",
  "legacy-failed": "The under-limit control succeeded, but the historical request failed for a reason other than payload size.",
};

const store = createIncrementalReport({
  resultsDir,
  filename: "limit-check-report.json",
  initial: {
    spike: "image-api-diagnostics-limit-check",
    live: "RUN",
    model,
    status: "running",
    observations: [],
  },
});
let interrupted = false;
bindInterrupt(() => {
  interrupted = true;
  store.save({ status: "interrupted" });
});

let report;
try {
  report = await runLimitCheck({
    config: { baseUrl, token, model, timeoutMs },
    fixtureRoot,
    resultsDir,
    onProgress: (event) => process.stdout.write(formatProgressLine(event)),
    onObservation: (snapshot) => {
      if (!interrupted) store.save({ ...snapshot, model, status: "running" });
    },
  });
} catch (error) {
  process.stderr.write(`IMAGE API LIMIT CHECK NOT RUN: ${safeError(error)}\n`);
  process.exit(2);
}

if (!interrupted) store.save({ ...report, model, status: "complete" });
for (const item of report.observations) {
  process.stdout.write(`${item.id}: HTTP ${item.response.httpStatus}; refs=${item.roles.length}; body=${item.request.byteLength}; latency=${item.response.latencyMs}ms\n`);
}
process.stdout.write(`${verdictText[report.verdict] || report.verdict}\n`);
process.stdout.write(`Report: ${store.path}\n`);

function safeError(error) {
  return String(error?.message || "failed")
    .replace(/https?:\/\/\S+/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 200);
}
