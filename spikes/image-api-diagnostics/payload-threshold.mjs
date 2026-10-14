#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertValidationOnlyBody,
  buildValidationProbeBody,
  loadPayloadThresholdRange,
  minimumValidationBodyBytes,
  runPayloadThreshold,
} from "./lib/payload-threshold.mjs";
import {
  bindInterrupt,
  createIncrementalReport,
  formatProgressLine,
} from "./lib/transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(process.env.IMAGE_SPIKE_RESULTS_DIR || resolve(here, "results"));
const baseUrl = String(process.env.BASE_URL || "").trim();
const token = String(process.env.CONTEST_API_TOKEN || "").trim();
const model = String(process.env.IMAGE_MODEL || "gemini-3-pro-image-preview").trim();
const timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || process.env.CONTEST_TIMEOUT_MS || 180000);

if (!baseUrl || !token || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  process.stdout.write("IMAGE API PAYLOAD THRESHOLD SKIPPED: required configuration is absent or invalid.\n");
  process.exit(0);
}

const range = loadPayloadThresholdRange(process.env, model);
if (!range.ok) {
  process.stderr.write("IMAGE API PAYLOAD THRESHOLD NOT RUN: the requested body range is invalid.\n");
  process.exit(2);
}

try {
  const baselineBytes = Math.max(range.minimumBytes, Math.min(4096, range.low));
  assertValidationOnlyBody(buildValidationProbeBody(model, baselineBytes));
} catch {
  process.stderr.write("IMAGE API PAYLOAD THRESHOLD NOT RUN: the validation-only body was rejected locally.\n");
  process.exit(2);
}

process.stdout.write("Validation-only payload threshold: no messages, prompts, modalities, or images will be sent.\n");

const store = createIncrementalReport({
  resultsDir,
  filename: "payload-threshold-report.json",
  initial: {
    spike: "image-api-diagnostics-payload-threshold",
    schemaVersion: 1,
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
  report = await runPayloadThreshold({
    model,
    baseUrl,
    token,
    timeoutMs,
    lowBytes: range.low,
    highBytes: range.high,
    onProgress: (event) => process.stdout.write(formatProgressLine(event)),
    onObservation: (snapshot) => {
      if (!interrupted) store.save(snapshot);
    },
  });
} catch {
  process.stderr.write("IMAGE API PAYLOAD THRESHOLD NOT RUN: the experiment stopped before a safe result was recorded.\n");
  process.exit(2);
}

if (!interrupted && report.requestsAttempted === 0) {
  process.stderr.write("IMAGE API PAYLOAD THRESHOLD NOT RUN: no validation request was sent.\n");
  process.exit(2);
}
process.stdout.write(`${report.conclusion}\n`);
process.stdout.write(`Report: ${store.path}\n`);
