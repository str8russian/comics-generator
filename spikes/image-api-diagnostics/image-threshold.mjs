#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractGeneratedImage } from "../../app/storyboard-web/image-provider.mjs";
import { loadFixtureSet } from "./lib/probe.mjs";
import {
  FIXED_ASPECT_RATIO,
  imageThresholdRerunRefused,
  RERUN_FLAG,
  runImageThreshold,
  formatImageThresholdLine,
} from "./lib/image-threshold.mjs";
import {
  bindInterrupt,
  chatCompletionsUrl,
  createIncrementalReport,
  formatProgressLine,
  postJson,
  sha256,
} from "./lib/transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(process.env.IMAGE_SPIKE_FIXTURE_DIR || resolve(here, "fixtures"));
const resultsDir = resolve(process.env.IMAGE_SPIKE_RESULTS_DIR || resolve(here, "results"));
const reportPath = join(resultsDir, "image-threshold-report.json");
const baseUrl = String(process.env.BASE_URL || "").trim();
const token = String(process.env.CONTEST_API_TOKEN || "").trim();
const model = String(process.env.IMAGE_MODEL || "gemini-3-pro-image-preview").trim();
const timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || process.env.CONTEST_TIMEOUT_MS || 180000);
const allowRerun = process.env[RERUN_FLAG] === "1";

if (!baseUrl || !token || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  process.stdout.write("IMAGE THRESHOLD SKIPPED: required configuration is absent or invalid.\n");
  process.exit(0);
}

const existingReportText = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
if (imageThresholdRerunRefused({ existingReportText, allowRerun })) {
  process.stderr.write("IMAGE THRESHOLD NOT RUN: an image-threshold report already exists.\n");
  process.exit(2);
}

function sourceVersion() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: resolve(here, "../..") }).trim();
  } catch {
    return null;
  }
}

function asImage(image, role) {
  return {
    role,
    mime: image.mime,
    width: image.width,
    height: image.height,
    originalBytes: image.byteLength,
    bytes: image.bytes,
    encodedBytes: image.bytes,
    diagnosticPaddingBytes: 0,
  };
}

let small;
let large;
let full;
try {
  small = loadFixtureSet(fixtureRoot, "600");
  large = loadFixtureSet(fixtureRoot, "768");
  full = loadFixtureSet(fixtureRoot, "full");
} catch (error) {
  process.stderr.write(`IMAGE THRESHOLD NOT RUN: ${String(error?.message || "fixtures unavailable").replace(/https?:\/\/\S+/gi, "[REDACTED]")}\n`);
  process.exit(2);
}

const store = createIncrementalReport({
  resultsDir,
  filename: "image-threshold-report.json",
  initial: {
    spike: "image-api-diagnostics-image-threshold",
    schemaVersion: 1,
    model,
    aspectRatio: FIXED_ASPECT_RATIO,
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
  report = await runImageThreshold({
    model,
    baseUrl,
    token,
    timeoutMs,
    sourceVersion: sourceVersion(),
    allowRerun,
    smallPair: [asImage(small.anchor, "anchor"), asImage(small.current, "current")],
    largePair: [asImage(large.anchor, "anchor"), asImage(large.current, "current")],
    sources: {
      anchor: asImage(full.anchor, "anchor"),
      style: asImage(full.style, "style"),
      current: asImage(full.current, "current"),
    },
    extractImage: (text) => {
      try {
        return extractGeneratedImage(JSON.parse(text));
      } catch {
        return null;
      }
    },
    saveOutput: async (id, image) => {
      const extension = image.mime === "image/jpeg" ? "jpg" : image.mime === "image/webp" ? "webp" : "png";
      const path = join(resultsDir, `${id}-${sha256(image.bytes).slice(0, 12)}.${extension}`);
      writeFileSync(path, image.bytes);
      return {
        path,
        mime: image.mime,
        width: image.width,
        height: image.height,
        byteLength: image.bytes.length,
        sha256: sha256(image.bytes),
      };
    },
    onProgress: (event) => {
      process.stdout.write(event.type === "before-request"
        ? formatImageThresholdLine(event)
        : formatProgressLine(event));
    },
    onObservation: (snapshot) => {
      if (!interrupted) store.save(snapshot);
    },
    send: (url, options) => postJson(chatCompletionsUrl(url), options),
  });
} catch {
  process.stderr.write("IMAGE THRESHOLD NOT RUN: the experiment stopped before a safe result was recorded.\n");
  process.exit(2);
}

if (!interrupted && report.status === "refused") {
  process.stderr.write("IMAGE THRESHOLD NOT RUN: an image-threshold report already exists.\n");
  process.exit(2);
}
process.stdout.write(`${report.conclusion}\n`);
process.stdout.write(`Report: ${store.path}\n`);
