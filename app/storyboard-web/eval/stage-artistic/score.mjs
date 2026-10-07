import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";

const stageSchema = JSON.parse(readFileSync(new URL("../../../../specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json", import.meta.url), "utf8"));

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SEGMENT_ID = /^seg-[0-9]+$/;
const FORBIDDEN_FIXTURE_KEYS = new Set([
  "draftStart",
  "draftEnd",
  "start",
  "end",
  "offset",
  "offsets",
  "fontSize",
  "utteranceQuote",
  "choices",
  "finish_reason",
  "frames",
  "review",
]);
const UTTERANCE_KEYS = new Set(["id", "kind", "segmentIds", "speakerStatus", "speakerLabel", "sourceQuote", "text"]);
const SILENT_KEYS = new Set(["id", "kind", "segmentIds", "speakerStatus", "sourceQuote", "text"]);
const GROUPS = {
  "deliberate-single": { expected: 7, layout: "single", sourceRole: "utterance" },
  "conversational-split": { expected: 8, layout: "split2", sourceRole: "utterance" },
  "action-single": { expected: 2, layout: "single", sourceRole: "action" },
};
const DOUBLE_DISPLAY = new Set(["D01", "D06"]);

let validateStage;

export class ScoreError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ScoreError";
    this.code = code;
  }
}

function stageValidator() {
  if (!validateStage) {
    const ajv = new Ajv({ allErrors: true, strict: true });
    validateStage = ajv.compile(structuredClone(stageSchema));
  }
  return validateStage;
}

function fail(code, message) {
  throw new ScoreError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNoFixtureOffsets(value, path) {
  if (typeof value === "number") fail("invalid-fixture", `numeric value at ${path}`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFixtureOffsets(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIXTURE_KEYS.has(key)) fail("invalid-fixture", `forbidden field ${key} at ${path}`);
    assertNoFixtureOffsets(value[key], `${path}.${key}`);
  }
}

function spokenText(item) {
  const spaced = `${item.speakerLabel}: `;
  const bare = `${item.speakerLabel}:`;
  if (item.sourceQuote.startsWith(spaced)) return item.sourceQuote.slice(spaced.length);
  if (item.sourceQuote.startsWith(bare)) return item.sourceQuote.slice(bare.length);
  fail("invalid-fixture", `${item.id} quote does not start with its speaker label`);
}

function assertSegments(item) {
  if (!Array.isArray(item.segmentIds) || item.segmentIds.length === 0) {
    fail("invalid-fixture", `${item.id} needs segment ids`);
  }
  const numbers = item.segmentIds.map((id) => {
    const match = SEGMENT_ID.exec(id);
    if (!match) fail("invalid-fixture", `${item.id} has a segment id outside seg-N`);
    return Number(id.slice(4));
  });
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) {
      fail("invalid-fixture", `${item.id} segment ids are not contiguous`);
    }
  }
}

function assertItemShape(item) {
  if (!isObject(item) || typeof item.id !== "string" || !ITEM_ID.test(item.id)) {
    fail("invalid-fixture", "a source item id is missing or invalid");
  }
  const allowed = item.kind === "utterance" ? UTTERANCE_KEYS : SILENT_KEYS;
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail("invalid-fixture", `${item.id} has unexpected field ${key}`);
  }
  if (typeof item.sourceQuote !== "string" || !/\S/u.test(item.sourceQuote)) {
    fail("invalid-fixture", `${item.id} needs a source quote`);
  }
  if (typeof item.text !== "string" || !/\S/u.test(item.text)) {
    fail("invalid-fixture", `${item.id} needs text`);
  }
  assertSegments(item);
  if (item.kind === "utterance") {
    if (item.speakerStatus !== "explicit" || typeof item.speakerLabel !== "string" || item.speakerLabel.length === 0) {
      fail("invalid-fixture", `${item.id} needs an explicit speaker label`);
    }
    if (item.text !== spokenText(item)) fail("invalid-fixture", `${item.id} text does not match its labeled quote`);
    return;
  }
  if (item.kind !== "action" && item.kind !== "context") fail("invalid-fixture", `${item.id} has kind ${item.kind}`);
  if (item.speakerStatus !== "none" || Object.hasOwn(item, "speakerLabel")) {
    fail("invalid-fixture", `${item.id} cannot carry a speaker label`);
  }
  if (item.text !== item.sourceQuote) fail("invalid-fixture", `${item.id} text must equal its source quote`);
}

export function assertFixture(fixture, sourceOrder) {
  if (!isObject(fixture) || Object.keys(fixture).length !== 1 || !Array.isArray(fixture.sourceItems)) {
    fail("invalid-fixture", "fixture must be { sourceItems }");
  }
  assertNoFixtureOffsets(fixture, "fixture");
  if (fixture.sourceItems.length !== sourceOrder.length) {
    fail("invalid-fixture", `expected ${sourceOrder.length} source items, found ${fixture.sourceItems.length}`);
  }
  const counts = { context: 0, utterance: 0, action: 0 };
  fixture.sourceItems.forEach((item, index) => {
    assertItemShape(item);
    if (item.id !== sourceOrder[index]) {
      fail("invalid-fixture", `source order at ${index} is ${item.id}, expected ${sourceOrder[index]}`);
    }
    counts[item.kind] += 1;
  });
  if (counts.context !== 1 || counts.utterance !== 15 || counts.action !== 2) {
    fail("invalid-fixture", `expected 1 context, 15 utterances, and 2 actions; found ${counts.context}, ${counts.utterance}, and ${counts.action}`);
  }
  const ids = new Set(fixture.sourceItems.map((item) => item.id));
  if (ids.size !== fixture.sourceItems.length) fail("invalid-fixture", "source item ids repeat");
}

function assertTarget(target) {
  if (!isObject(target) || !Array.isArray(target.frames) || !Array.isArray(target.sourceOrder) || !Array.isArray(target.contextReviewIds)) {
    fail("invalid-target", "target manifest is incomplete");
  }
  if (target.semanticSourceFrames !== 17 || target.frames.length !== 17) {
    fail("invalid-target", "target must name 17 semantic source frames");
  }
  if (target.renderedFrames !== 19 || target.renderedDialogueDisplayBlocks !== 17 || target.renderedActions !== 2) {
    fail("invalid-target", "rendered target must be 19 frames: 17 dialogue display blocks and 2 actions");
  }
  if (target.contextReviewIds.length !== 1) fail("invalid-target", "target must name one context review id");
  const contextId = target.contextReviewIds[0];
  const frameIds = target.frames.map((frame) => frame.sourceItemId);
  const expectedOrder = [contextId, ...frameIds];
  if (target.sourceOrder.length !== expectedOrder.length || expectedOrder.some((id, index) => target.sourceOrder[index] !== id)) {
    fail("invalid-target", "source order must be the context id followed by the semantic frames");
  }
  const seen = new Set();
  const groupCounts = { "deliberate-single": 0, "conversational-split": 0, "action-single": 0 };
  let rendered = 0;
  for (const frame of target.frames) {
    if (!isObject(frame) || seen.has(frame.sourceItemId)) fail("invalid-target", "semantic frame ids must be unique");
    seen.add(frame.sourceItemId);
    const group = GROUPS[frame.agreementGroup];
    if (!group || frame.layout !== group.layout || frame.sourceRole !== group.sourceRole) {
      fail("invalid-target", `${frame.sourceItemId} does not match its agreement group`);
    }
    groupCounts[frame.agreementGroup] += 1;
    const blocks = DOUBLE_DISPLAY.has(frame.sourceItemId) ? 2 : 1;
    if (frame.expectedRenderedBlocks !== blocks) {
      fail("invalid-target", `${frame.sourceItemId} must record ${blocks} rendered display blocks`);
    }
    rendered += frame.expectedRenderedBlocks;
    const participantCount = frame.layout === "split2" ? 2 : 1;
    if (!Array.isArray(frame.participants) || frame.participants.length !== participantCount || frame.participants.some((name) => typeof name !== "string" || name.length === 0)) {
      fail("invalid-target", `${frame.sourceItemId} needs human participant labels`);
    }
    if (typeof frame.intent !== "string" || frame.intent.length === 0) {
      fail("invalid-target", `${frame.sourceItemId} needs a directing intent`);
    }
  }
  if (rendered !== 19) fail("invalid-target", "display blocks must sum to 19 rendered frames");
  for (const [name, rule] of Object.entries(GROUPS)) {
    if (groupCounts[name] !== rule.expected) fail("invalid-target", `${name} must contain ${rule.expected} frames`);
  }
}

function schemaFailure(validate) {
  const details = (validate.errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
  fail("invalid-candidate", `stage response failed schema: ${details || "unknown schema error"}`);
}

function indexSourceFrames(frames, expectedById) {
  const matched = new Map();
  const unexpectedSourceFrames = [];
  for (const frame of frames) {
    if (frame.origin !== "source") continue;
    const expected = expectedById.get(frame.sourceItemId);
    if (!expected || frame.sourceRole !== expected.sourceRole) {
      unexpectedSourceFrames.push({
        frameId: frame.id,
        sourceItemId: frame.sourceItemId,
        sourceRole: frame.sourceRole,
      });
      continue;
    }
    const list = matched.get(frame.sourceItemId) || [];
    list.push(frame);
    matched.set(frame.sourceItemId, list);
  }
  return { matched, unexpectedSourceFrames };
}

function actualLayout(list) {
  if (!list || list.length === 0) return null;
  if (list.length > 1) return "duplicate";
  return list[0].layout;
}

export function scoreStageArtistic(fixture, target, candidate) {
  assertTarget(target);
  assertFixture(fixture, target.sourceOrder);
  const validate = stageValidator();
  if (!validate(candidate)) schemaFailure(validate);

  const expectedById = new Map(target.frames.map((frame) => [frame.sourceItemId, frame]));
  const { matched, unexpectedSourceFrames } = indexSourceFrames(candidate.frames, expectedById);
  const missingSourceFrames = [];
  const duplicateSourceFrames = [];
  const layoutDisagreements = [];
  const groupMatches = {
    "deliberate-single": 0,
    "conversational-split": 0,
    "action-single": 0,
  };

  for (const expected of target.frames) {
    const list = matched.get(expected.sourceItemId) || [];
    if (list.length === 0) missingSourceFrames.push(expected.sourceItemId);
    if (list.length > 1) duplicateSourceFrames.push(expected.sourceItemId);
    const layout = actualLayout(list);
    if (layout === expected.layout) groupMatches[expected.agreementGroup] += 1;
    else {
      layoutDisagreements.push({
        sourceItemId: expected.sourceItemId,
        expectedLayout: expected.layout,
        actualLayout: layout,
      });
    }
  }

  const missingReview = target.contextReviewIds.filter((id) => !candidate.review.includes(id));
  const unexpectedReview = candidate.review.filter((id) => !target.contextReviewIds.includes(id));
  const sourceFidelityOk = missingSourceFrames.length === 0
    && duplicateSourceFrames.length === 0
    && unexpectedSourceFrames.length === 0
    && missingReview.length === 0
    && unexpectedReview.length === 0;

  return {
    schemaValid: true,
    sourceFidelity: {
      ok: sourceFidelityOk,
      sourceFrameCoverage: {
        covered: target.frames.length - missingSourceFrames.length,
        expected: target.frames.length,
      },
      missingSourceFrames,
      duplicateSourceFrames,
      unexpectedSourceFrames,
      contextReviewCoverage: {
        covered: target.contextReviewIds.length - missingReview.length,
        expected: target.contextReviewIds.length,
        missing: missingReview,
        unexpected: unexpectedReview,
      },
    },
    artistic: {
      verdict: "not-a-pass-fail",
      layoutAgreement: {
        matched: target.frames.length - layoutDisagreements.length,
        expected: target.frames.length,
      },
      deliberateSingleAgreement: {
        matched: groupMatches["deliberate-single"],
        expected: GROUPS["deliberate-single"].expected,
      },
      conversationalSplitAgreement: {
        matched: groupMatches["conversational-split"],
        expected: GROUPS["conversational-split"].expected,
      },
      actionSingleAgreement: {
        matched: groupMatches["action-single"],
        expected: GROUPS["action-single"].expected,
      },
      derivedFrameCount: candidate.frames.filter((frame) => frame.origin === "derived").length,
      layoutDisagreements,
    },
  };
}

export function readCandidateJson(candidatePath) {
  const name = basename(candidatePath);
  if (name === ".env" || name.startsWith(".env.")) {
    fail("invalid-candidate", "refusing to read an environment file");
  }
  let text;
  try {
    text = readFileSync(candidatePath, "utf8");
  } catch (error) {
    fail("invalid-candidate", `could not read candidate: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("invalid-candidate", `candidate is not JSON: ${error.message}`);
  }
}

function loadBundled(name) {
  return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
}

function runCli() {
  const candidatePath = process.argv[2];
  if (!candidatePath) {
    process.stderr.write("usage: node app/storyboard-web/eval/stage-artistic/score.mjs <candidate.json>\n");
    process.exitCode = 1;
    return;
  }
  try {
    const report = scoreStageArtistic(loadBundled("fixture.json"), loadBundled("target.json"), readCandidateJson(candidatePath));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof ScoreError ? error.message : `invalid-candidate: ${error.message}`}\n`);
    process.exitCode = 1;
  }
}

function ranAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (ranAsCli()) runCli();
