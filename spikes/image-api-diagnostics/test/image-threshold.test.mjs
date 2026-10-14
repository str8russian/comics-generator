import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { buildImageRequest } from "../../../app/storyboard-web/image-provider.mjs";
import {
  BODY_MATCH_TOLERANCE,
  FIXED_PROMPT,
  HARD_BODY_CEILING,
  MAX_IMAGE_THRESHOLD_REQUESTS,
  MAX_SUCCESSFUL_GENERATIONS,
  TARGET_GAP_BYTES,
  base64CharacterCount,
  candidateNearTarget,
  classifyImageThresholdResponse,
  describeCandidate,
  formatImageThresholdLine,
  imageThresholdRerunRefused,
  padPng,
  readAncillaryTextChunk,
  runImageThreshold,
  serializeImageBody,
} from "../lib/image-threshold.mjs";
import { createIncrementalReport, bindInterrupt, sha256 } from "../lib/transport.mjs";

const MODEL = "image-test-model";
const TOKEN = "super-secret-token";
const HOST = "https://provider.example.test/v1";
const OUTPUT = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function makePng(role, width, height, red) {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: red, g: 40, b: 70 } },
  }).png().toBuffer();
  const meta = await sharp(bytes).metadata();
  return {
    role,
    mime: "image/png",
    width: meta.width,
    height: meta.height,
    originalBytes: bytes.length,
    bytes,
    encodedBytes: bytes,
    diagnosticPaddingBytes: 0,
  };
}

function sourcesFrom(anchor, style, current) {
  return { anchor, style, current };
}

function response({ status = 200, transportError = null, text = "ok-image", latencyMs = 9 } = {}) {
  return {
    status,
    transportError,
    text,
    latencyMs,
    headers: { server: "fake" },
    timings: { ttfbMs: 4, totalMs: latencyMs, finishMs: 1 },
  };
}

function extractImage(text) {
  return text === "ok-image" ? { bytes: OUTPUT, mime: "image/png", width: 1, height: 1 } : null;
}

async function harness({ classify, maxRequests = MAX_IMAGE_THRESHOLD_REQUESTS, maxSuccesses = MAX_SUCCESSFUL_GENERATIONS, ceiling = HARD_BODY_CEILING, existingReportText = "", allowRerun = false, onProgress } = {}) {
  const anchor = await makePng("anchor", 24, 18, 20);
  const style = await makePng("style", 24, 18, 80);
  const current = await makePng("current", 18, 24, 140);
  const padded = padPng(current.bytes, 18000);
  const largeCurrent = {
    ...current,
    bytes: padded.bytes,
    diagnosticPaddingBytes: padded.diagnosticPaddingBytes,
  };
  const calls = [];
  const report = await runImageThreshold({
    model: MODEL,
    baseUrl: HOST,
    token: TOKEN,
    timeoutMs: 1000,
    smallPair: [anchor, current],
    largePair: [anchor, largeCurrent],
    sources: sourcesFrom(anchor, style, current),
    maxRequests,
    maxSuccesses,
    ceiling,
    existingReportText,
    allowRerun,
    onProgress,
    extractImage,
    send: async (_url, request) => {
      calls.push(request);
      const expected = JSON.stringify(buildImageRequest({
        prompt: FIXED_PROMPT,
        images: [...request.body.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((match) => ({
          mime: "image/png",
          bytes: Buffer.from(match[1], "base64"),
        })),
        aspectRatio: "5:4",
        model: MODEL,
      }));
      assert.equal(request.body, expected);
      const size = Buffer.byteLength(request.body);
      const imageCount = [...request.body.matchAll(/data:image\/png;base64,/g)].length;
      return response(await classify({ size, imageCount, caseId: request.caseId, request }));
    },
  });
  return { report, calls, anchor, style, current, largeCurrent };
}

test("ancillary PNG padding keeps pixels, dimensions, and a valid CRC", async () => {
  const original = await makePng("current", 12, 8, 15);
  const before = await sharp(original.bytes).raw().toBuffer({ resolveWithObject: true });
  const padded = padPng(original.bytes, 32);
  const chunk = readAncillaryTextChunk(padded.bytes);
  assert.equal(chunk.crcValid, true);
  assert.equal(chunk.ancillary, true);
  assert.equal(chunk.type, "tEXt");
  assert.equal(padded.diagnosticPaddingBytes, padded.bytes.length - original.bytes.length);
  const after = await sharp(padded.bytes).raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(padded.bytes).metadata();
  assert.equal(meta.width, before.info.width);
  assert.equal(meta.height, before.info.height);
  assert.equal(after.info.width, before.info.width);
  assert.equal(after.info.height, before.info.height);
  assert.deepEqual(after.data, before.data);
});

test("candidate measurement uses the production serializer and approaches the target", async () => {
  const anchor = await makePng("anchor", 20, 16, 9);
  const current = await makePng("current", 16, 20, 90);
  const target = 12000;
  const candidate = await candidateNearTarget({
    model: MODEL,
    images: [anchor, current],
    targetBytes: target,
    minExclusive: 0,
    maxExclusive: HARD_BODY_CEILING,
  });
  assert.equal(candidate.serialized, JSON.stringify(buildImageRequest({
    prompt: FIXED_PROMPT,
    images: candidate.wire.map((image) => ({ mime: image.mime, bytes: image.bytes })),
    aspectRatio: "5:4",
    model: MODEL,
  })));
  assert.equal(Buffer.byteLength(candidate.serialized), candidate.exactBodyBytes);
  assert.equal(Math.abs(candidate.exactBodyBytes - target) <= BODY_MATCH_TOLERANCE, true);
  assert.equal(candidate.images.reduce((sum, image) => sum + image.transmittedBytes, 0), candidate.combinedImageBytes);
  assert.equal(candidate.images.reduce((sum, image) => sum + image.base64Chars, 0), candidate.base64Chars);
  assert.equal(candidate.images.every((image) => image.base64Chars === base64CharacterCount(candidate.wire.find((item) => item.role === image.role).bytes)), true);
  assert.equal(candidate.requestSha256, sha256(candidate.serialized));
  assert.equal(candidate.diagnosticPaddingBytes > 0, true);
});

test("known success and 413 narrow to the precision target and require confirmation", async () => {
  let threshold = 0;
  const { report, calls } = await harness({
    classify: async ({ size }) => {
      if (!threshold) threshold = size;
      return { status: size >= threshold + 15000 ? 413 : 200 };
    },
  });
  assert.equal(report.boundaryConfirmed, true);
  assert.equal(report.precisionMet, true);
  assert.equal(report.finalGapBytes <= TARGET_GAP_BYTES, true);
  assert.equal(report.smallest413BodyBytes - report.largestSuccessfulBodyBytes, report.finalGapBytes);
  assert.equal(report.confirmationObservations.length >= 2, true);
  assert.equal(calls.length <= MAX_IMAGE_THRESHOLD_REQUESTS, true);
  assert.equal(report.successfulGenerations <= MAX_SUCCESSFUL_GENERATIONS, true);
  assert.equal(new Set(calls.map((call) => call.caseId)).size <= calls.length, true);
});

test("inconsistent confirmation does not claim a boundary", async () => {
  const { report } = await harness({
    classify: async ({ size, caseId }) => {
      if (String(caseId).includes("confirm-low")) return { status: 413 };
      return { status: size >= 20000 ? 413 : 200 };
    },
  });
  assert.equal(report.boundaryConfirmed, false);
  assert.equal(report.precisionMet, false);
  assert.equal(report.largestSuccessfulBodyBytes, null);
  assert.equal(report.conclusion.includes("inconsistent-confirmation"), true);
});

test("three-reference requests can confirm the same body boundary", async () => {
  const { report } = await harness({
    classify: async ({ size }) => ({ status: size >= 18000 ? 413 : 200 }),
  });
  assert.equal(report.boundaryConfirmed, true);
  assert.equal(report.threeReferenceConsistent, true);
  assert.equal(report.threeReferenceBoundary, null);
});

test("divergent three-reference results stay explicit when a separate boundary is not confirmed", async () => {
  const { report, calls } = await harness({
    maxRequests: 12,
    ceiling: 60000,
    classify: async ({ size, imageCount }) => {
      if (imageCount >= 3) return { status: 200 };
      return { status: size >= 18000 ? 413 : 200 };
    },
  });
  assert.equal(report.threeReferenceConsistent, false);
  assert.equal(report.threeReferenceBoundary, null);
  assert.equal(report.reason, "three-reference-unconfirmed");
  assert.equal(calls.length <= 12, true);
});

test("request and success caps are enforced and failures are not retried", async () => {
  const capped = await harness({
    maxRequests: 4,
    maxSuccesses: 4,
    ceiling: 500000,
    classify: async () => ({ status: 200 }),
  });
  assert.equal(capped.calls.length, 4);
  assert.equal(capped.report.successfulGenerations, 4);
  assert.equal(capped.calls.length <= MAX_IMAGE_THRESHOLD_REQUESTS, true);

  const oneSuccess = await harness({
    maxSuccesses: 1,
    classify: async () => ({ status: 200 }),
  });
  assert.equal(oneSuccess.calls.length, 1);
  assert.equal(oneSuccess.report.successfulGenerations, 1);

  let networkCalls = 0;
  const network = await harness({
    classify: async () => {
      networkCalls += 1;
      return { status: 0, transportError: "network", text: "" };
    },
  });
  assert.equal(networkCalls, 1);
  assert.equal(network.report.status, "inconclusive");
});

test("non-413 failures and undecodable success responses stop immediately", async () => {
  for (const payload of [
    { status: 200, text: "not-an-image" },
    { status: 400 },
    { status: 401 },
    { status: 403 },
    { status: 404 },
    { status: 409 },
    { status: 422 },
    { status: 429 },
    { status: 500 },
    { status: 0, transportError: "timeout", text: "" },
    { status: 0, transportError: "abort", text: "" },
    { status: 0, transportError: "dns", text: "" },
  ]) {
    const { report, calls } = await harness({
      classify: async () => payload,
    });
    assert.equal(calls.length, 1, String(payload.status || payload.transportError));
    assert.equal(report.status, "inconclusive");
    assert.equal(report.boundaryConfirmed, false);
    assert.equal(classifyImageThresholdResponse({
      status: payload.status,
      transportError: payload.transportError,
      validImage: payload.text === "ok-image",
    }) === "size-accepted", false);
  }
});

test("the serialized body ceiling is enforced", async () => {
  const { report } = await harness({
    ceiling: 5000,
    maxRequests: 8,
    classify: async () => ({ status: 200 }),
  });
  assert.equal(report.observations.every((item) => item.exactBodyBytes <= 5000), true);
  assert.equal(report.boundaryConfirmed, false);
  assert.equal(report.exactBodyBytes > HARD_BODY_CEILING, false);
});

test("an existing report refuses a second live run unless rerun is explicit", async () => {
  assert.equal(imageThresholdRerunRefused({ existingReportText: "{\"status\":\"complete\"}" }), true);
  assert.equal(imageThresholdRerunRefused({ existingReportText: "" }), false);
  assert.equal(imageThresholdRerunRefused({ existingReportText: "{\"status\":\"complete\"}", allowRerun: true }), false);
  const refused = await harness({
    existingReportText: "{\"requestsAttempted\":2}",
    classify: async () => ({ status: 200 }),
  });
  assert.equal(refused.calls.length, 0);
  assert.equal(refused.report.status, "refused");
  const allowed = await harness({
    existingReportText: "{\"requestsAttempted\":2}",
    allowRerun: true,
    maxRequests: 1,
    classify: async () => ({ status: 413 }),
  });
  assert.equal(allowed.calls.length > 0, true);
});

test("progress and reports omit secrets, prompts, bodies, and image bytes", async () => {
  const leakedImage = OUTPUT.toString("base64");
  const lines = [];
  const { report } = await harness({
    maxRequests: 1,
    onProgress: (event) => lines.push(formatImageThresholdLine({
      ...event,
      token: TOKEN,
      url: HOST,
      prompt: FIXED_PROMPT,
      body: leakedImage,
    })),
    classify: async () => ({ status: 413, text: `${TOKEN} ${HOST} ${FIXED_PROMPT} data:image/png;base64,${leakedImage}` }),
  });
  const rendered = `${lines.join("")}\n${JSON.stringify(report)}`;
  assert.equal(rendered.includes(TOKEN), false);
  assert.equal(rendered.includes("provider.example.test"), false);
  assert.equal(rendered.includes(FIXED_PROMPT), false);
  assert.equal(rendered.includes(leakedImage), false);
  assert.equal(rendered.includes("data:image"), false);
  assert.match(lines[0], /remainingRequests=1/);
  assert.match(lines[0], /remainingSuccesses=30/);
});

test("partial observations survive an interrupt", async () => {
  const resultsDir = mkdtempSync(join(tmpdir(), "image-threshold-report-"));
  const store = createIncrementalReport({
    resultsDir,
    filename: "image-threshold-report.json",
    initial: { status: "running", observations: [] },
    nowIso: () => "2026-10-14T13:00:00.000Z",
  });
  store.save({
    requestsAttempted: 1,
    successfulGenerations: 1,
    observations: [{ id: "two-ref-small", exactBodyBytes: 1000, classification: "size-accepted" }],
  });
  let exitCode = null;
  let handler = null;
  bindInterrupt(() => store.save({ status: "interrupted" }), {
    subscribe(_event, saved) { handler = saved; },
    exit(code) { exitCode = code; },
  });
  handler();
  const saved = JSON.parse(readFileSync(store.path, "utf8"));
  assert.equal(saved.status, "interrupted");
  assert.equal(saved.observations[0].id, "two-ref-small");
  assert.equal(exitCode, 130);
  assert.equal(readdirSync(resultsDir).some((name) => name.endsWith(".tmp")), false);
  assert.equal(describeCandidate(MODEL, [await makePng("anchor", 4, 4, 1)]).exactBodyBytes > 0, true);
});
