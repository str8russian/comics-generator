import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildImageRequest, extractGeneratedImage } from "../../../app/storyboard-web/image-provider.mjs";
import { inspectImage } from "../../../app/storyboard-web/image-info.mjs";
import {
  chatCompletionsUrl,
  postJson,
  sanitizeTimings,
  sha256,
} from "./transport.mjs";

export { sha256 };

export const MAX_LIVE_REQUESTS = 6;
export const MAX_THRESHOLD_REQUESTS = 2;
export const MAX_UNDER_LIMIT_REQUESTS = 1;
export const MAX_LIMIT_CHECK_REQUESTS = 2;

const UNDER_LIMIT_PROMPT = "Revise the current character image. Image 1 controls identity. Image 2 is the current image and controls composition and style. Make the expression visibly surprised and irritated. No text, borders, or extra people.";
const REVISION_THREE_PROMPT = "Revise the current character image. Image 1 controls identity. Image 2 controls visual style. Image 3 is the current image and controls composition. Make the expression visibly surprised and irritated. No text, borders, or extra people.";
const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

function findFixture(root, scale, role) {
  for (const extension of SUPPORTED_EXTENSIONS) {
    const path = join(root, scale, `${role}${extension}`);
    try {
      const bytes = readFileSync(path);
      const inspected = inspectImage(bytes);
      if (!inspected.mime) throw new Error(`unsupported image fixture: ${path}`);
      return { path, bytes, ...inspected };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`missing ${scale}/${role} image fixture`);
}

export function loadFixtureSet(root, scale) {
  return Object.fromEntries(["anchor", "style", "current"].map((role) => {
    const image = findFixture(root, scale, role);
    return [role, {
      ...image,
      byteLength: image.bytes.length,
      sha256: sha256(image.bytes),
    }];
  }));
}

function redact(value, secrets) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

function sanitizeError(text, secrets) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const error = payload?.error && typeof payload.error === "object" ? payload.error : payload;
  const shorten = (value) => {
    const cleaned = redact(value, secrets).replace(/\s+/g, " ").trim();
    return cleaned ? cleaned.slice(0, 240) : null;
  };
  return {
    type: shorten(error?.type),
    code: shorten(error?.code),
    message: shorten(error?.message || (!payload ? text : null)),
  };
}

function publicInput(role, image) {
  return {
    role,
    mime: image.mime,
    width: image.width,
    height: image.height,
    byteLength: image.byteLength,
    sha256: image.sha256,
  };
}

function outputExtension(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}

function forwardProgress(onProgress, event) {
  if (!onProgress) return;
  onProgress({
    type: event.type,
    elapsedMs: event.elapsedMs,
    httpStatus: event.httpStatus,
    timings: sanitizeTimings(event.timings),
    id: event.id,
    roles: event.roles,
    byteLength: event.byteLength,
    sha256Prefix: event.sha256Prefix,
    timeoutMs: event.timeoutMs,
    index: event.index,
    total: event.total,
  });
}

export async function runCase({ id, prompt, roles, fixtures, config, resultsDir, send = postJson, onProgress }) {
  const images = roles.map((role) => fixtures[role]);
  const body = JSON.stringify(buildImageRequest({
    prompt,
    images,
    aspectRatio: "5:4",
    model: config.model,
  }));
  const hash = sha256(body);
  forwardProgress(onProgress, {
    type: "before-request",
    id,
    roles,
    byteLength: Buffer.byteLength(body),
    sha256Prefix: hash.slice(0, 12),
    timeoutMs: config.timeoutMs,
  });
  const response = await send(chatCompletionsUrl(config.baseUrl), {
    token: config.token,
    body,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => forwardProgress(onProgress, { ...event, id, roles }),
  });
  forwardProgress(onProgress, {
    type: "timings",
    id,
    roles,
    elapsedMs: response.latencyMs,
    timings: sanitizeTimings(response.timings),
  });
  let output = null;
  if (response.status >= 200 && response.status < 300) {
    try {
      const image = extractGeneratedImage(JSON.parse(response.text));
      if (image) {
        mkdirSync(resultsDir, { recursive: true });
        const path = join(resultsDir, `${id}${outputExtension(image.mime)}`);
        writeFileSync(path, image.bytes);
        output = {
          path,
          mime: image.mime,
          width: image.width,
          height: image.height,
          byteLength: image.bytes.length,
          sha256: sha256(image.bytes),
        };
      }
    } catch {
      output = null;
    }
  }
  return {
    id,
    roles,
    inputs: roles.map((role) => publicInput(role, fixtures[role])),
    request: {
      byteLength: Buffer.byteLength(body),
      sha256: hash,
    },
    response: {
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      transportError: response.transportError,
      timings: sanitizeTimings(response.timings),
      headers: response.headers,
      error: response.status >= 200 && response.status < 300
        ? (output ? null : { type: "invalid-output", code: null, message: "response did not contain a supported image" })
        : sanitizeError(response.text, [config.token, config.baseUrl, new URL(config.baseUrl).origin, new URL(config.baseUrl).hostname]),
      output,
    },
  };
}

export async function runMatrix({ config, fixtureRoot, resultsDir, send }) {
  const full = loadFixtureSet(fixtureRoot, "full");
  const prompts = {
    health: "Generate a simple full-color portrait of one fictional adult on a solid matte background. No text or borders.",
    initial: "Generate one full-color character image. Image 1 controls identity. Image 2 controls visual style. Solid matte background. No text, borders, or extra people.",
    revisionTwo: "Revise the current character image. Image 1 controls identity. Image 2 is the current image and controls composition and style. Make the expression visibly surprised and irritated. No text, borders, or extra people.",
    revisionThree: "Revise the current character image. Image 1 controls identity. Image 2 controls visual style. Image 3 is the current image and controls composition. Make the expression visibly surprised and irritated. No text, borders, or extra people.",
  };
  const observations = [];
  const execute = async (input) => {
    if (observations.length >= MAX_LIVE_REQUESTS) throw new Error("live request cap exceeded");
    const observation = await runCase({ ...input, config, resultsDir, send });
    observations.push(observation);
    return observation;
  };

  const emptyFixtures = {};
  const health = await execute({ id: "health-no-refs", prompt: prompts.health, roles: [], fixtures: emptyFixtures });
  if (health.response.httpStatus < 200 || health.response.httpStatus >= 300 || !health.response.output) {
    return { requestsAttempted: observations.length, stopped: "health-failed", observations };
  }
  await execute({ id: "initial-anchor-style-full", prompt: prompts.initial, roles: ["anchor", "style"], fixtures: full });
  await execute({ id: "revision-anchor-current-full", prompt: prompts.revisionTwo, roles: ["anchor", "current"], fixtures: full });
  const threeFull = await execute({ id: "revision-three-full", prompt: prompts.revisionThree, roles: ["anchor", "style", "current"], fixtures: full });
  if (threeFull.response.httpStatus === 413) {
    const smaller = loadFixtureSet(fixtureRoot, "1024");
    const at1024 = await execute({ id: "revision-three-1024", prompt: prompts.revisionThree, roles: ["anchor", "style", "current"], fixtures: smaller });
    if (at1024.response.httpStatus === 413) {
      const smallest = loadFixtureSet(fixtureRoot, "768");
      await execute({ id: "revision-three-768", prompt: prompts.revisionThree, roles: ["anchor", "style", "current"], fixtures: smallest });
    }
  }
  return { requestsAttempted: observations.length, stopped: "matrix-complete", observations };
}

function controlSucceeded(observation) {
  return observation.response.httpStatus >= 200
    && observation.response.httpStatus < 300
    && Boolean(observation.response.output);
}

export async function runUnderLimit({ config, fixtureRoot, resultsDir, send }) {
  const cases = [{
    id: "revision-anchor-current-600",
    prompt: UNDER_LIMIT_PROMPT,
    roles: ["anchor", "current"],
    scale: "600",
  }];
  if (cases.length > MAX_UNDER_LIMIT_REQUESTS) throw new Error("under-limit request cap exceeded");
  const observations = [];
  for (const item of cases) {
    if (observations.length >= MAX_UNDER_LIMIT_REQUESTS) throw new Error("under-limit request cap exceeded");
    const fixtures = loadFixtureSet(fixtureRoot, item.scale);
    observations.push(await runCase({ ...item, fixtures, config, resultsDir, send }));
  }
  return { requestsAttempted: observations.length, stopped: "under-limit-complete", observations };
}

export async function runLimitCheck({ config, fixtureRoot, resultsDir, send, onProgress, onObservation }) {
  const observations = [];
  const publish = (extra) => {
    const snapshot = {
      requestsAttempted: observations.length,
      stopped: extra.stopped,
      verdict: extra.verdict ?? null,
      observations,
    };
    onObservation?.(snapshot);
    return snapshot;
  };
  const execute = async (input) => {
    if (observations.length >= MAX_LIMIT_CHECK_REQUESTS) throw new Error("limit-check request cap exceeded");
    const index = observations.length + 1;
    const observation = await runCase({
      ...input,
      config,
      resultsDir,
      send,
      onProgress: (event) => onProgress?.({ ...event, index, total: MAX_LIMIT_CHECK_REQUESTS }),
    });
    observations.push(observation);
    publish({ stopped: "running" });
    return observation;
  };

  const control = await execute({
    id: "control-anchor-current-600",
    prompt: UNDER_LIMIT_PROMPT,
    roles: ["anchor", "current"],
    fixtures: loadFixtureSet(fixtureRoot, "600"),
  });
  if (!controlSucceeded(control)) {
    return publish({ stopped: "control-failed", verdict: "provider-unhealthy" });
  }

  const legacy = await execute({
    id: "legacy-passthrough-full",
    prompt: REVISION_THREE_PROMPT,
    roles: ["anchor", "style", "current"],
    fixtures: loadFixtureSet(fixtureRoot, "full"),
  });
  const legacyOk = controlSucceeded(legacy);
  let verdict = "legacy-failed";
  if (legacyOk) verdict = "limit-relaxed";
  else if (legacy.response.httpStatus === 413) verdict = "legacy-rejected";
  return publish({ stopped: "limit-check-complete", verdict });
}

export async function runThresholdConfirmation({ config, fixtureRoot, resultsDir, send }) {
  const at768 = loadFixtureSet(fixtureRoot, "768");
  const at740 = loadFixtureSet(fixtureRoot, "740");
  const revisionTwo = "Revise the current character image. Image 1 controls identity. Image 2 is the current image and controls composition and style. Make the expression visibly surprised and irritated. No text, borders, or extra people.";
  const revisionThree = "Revise the current character image. Image 1 controls identity. Image 2 controls visual style. Image 3 is the current image and controls composition. Make the expression visibly surprised and irritated. No text, borders, or extra people.";
  const cases = [
    { id: "revision-anchor-current-768", prompt: revisionTwo, roles: ["anchor", "current"], fixtures: at768 },
    { id: "revision-three-740", prompt: revisionThree, roles: ["anchor", "style", "current"], fixtures: at740 },
  ];
  if (cases.length > MAX_THRESHOLD_REQUESTS) throw new Error("threshold request cap exceeded");
  const observations = [];
  for (const item of cases) observations.push(await runCase({ ...item, config, resultsDir, send }));
  return { requestsAttempted: observations.length, stopped: "threshold-complete", observations };
}
