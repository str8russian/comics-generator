import assert from "node:assert/strict";
import test from "node:test";
import { serializeImageRequest, toReference } from "../image-reference-strategy.mjs";
import {
  applySupportedPatch,
  assembleRevisionReferences,
  compileRevisionPrompt,
  initializeEffectiveIntent,
  moveCandidateSelection,
  summarizeRevision,
} from "../panel-revision.mjs";
import { revisionBasisText, revisionPreservedDisclosure, revisionSummaryLines } from "../public/panel-revision-view.mjs";
import { deliverPreparedImage } from "../server.mjs";

const knownIntent = {
  framing: "close-up",
  upperBody: "visible shoulders and upper torso",
  gesture: "hands outside crop",
  headPose: "near-frontal head",
  gaze: "screen-right",
  expression: "calm",
  background: "solid-matte",
};

function baseline() {
  return initializeEffectiveIntent({
    provenanceIntent: knownIntent,
    characterName: "Маша",
    identityAuthorityId: "anchor-1",
  });
}

test("effective intent inherits, overrides one property, and stays bounded", () => {
  const initial = baseline();
  assert.equal(initial.reconstruction, "known-supported");
  assert.equal(initial.gaze, "screen-right");
  const first = applySupportedPatch(initial, "смотрит влево");
  assert.equal(first.snapshot.gaze, "screen-left");
  assert.equal(first.snapshot.expression, "calm");
  assert.equal(first.snapshot.framing, "close-up");
  const second = applySupportedPatch(first.snapshot, "раздражённое выражение");
  assert.equal(second.snapshot.gaze, "screen-left");
  assert.equal(second.snapshot.expression, "irritated");
  assert.equal(JSON.stringify(second.snapshot).includes("смотрит"), false);
  assert.equal(JSON.stringify(second.snapshot).includes("раздраж"), false);
});

test("legacy images do not invent unknown historical semantics", () => {
  const legacy = initializeEffectiveIntent({
    snapshot: null,
    provenanceIntent: null,
    characterName: "Маша",
    identityAuthorityId: "anchor-1",
  });
  assert.equal(legacy.reconstruction, "partial");
  assert.equal(legacy.gaze, null);
  assert.equal(legacy.expression, null);
  assert.equal(legacy.background, "solid-matte");
  const patched = applySupportedPatch(legacy, "смотрит влево");
  assert.equal(patched.snapshot.gaze, "screen-left");
  assert.equal(patched.snapshot.expression, null);
  assert.equal(patched.snapshot.reconstruction, "partial");
});

test("accepted revision snapshot is the next baseline", () => {
  const accepted = applySupportedPatch(baseline(), "смотрит влево").snapshot;
  const next = initializeEffectiveIntent({ snapshot: accepted, characterName: "Маша" });
  assert.equal(next.gaze, "screen-left");
  assert.equal(next.expression, "calm");
  const later = applySupportedPatch(next, "раздражённое выражение");
  assert.equal(later.snapshot.gaze, "screen-left");
  assert.equal(later.snapshot.expression, "irritated");
});

test("unsupported and deterministic text never enter the prompt", () => {
  const summary = summarizeRevision({
    mode: "refine",
    instruction: "смотрит влево и добавь стул в кабинете",
    baseline: baseline(),
    basis: { kind: "current-panel" },
  });
  assert.equal(summary.providerCall, true);
  assert.equal(summary.changes.some((change) => change.property === "gaze"), true);
  assert.equal(summary.notApplied.some((entry) => entry.text.toLocaleLowerCase("ru").includes("стул")), true);
  const prompt = compileRevisionPrompt(summary.snapshot, {
    aspectRatio: "5:4",
    hasPrevious: true,
  });
  assert.match(prompt, /screen-left|viewer's left/);
  assert.equal(prompt.includes("стул"), false);
  assert.equal(prompt.includes("кабинет"), false);
  assert.equal(prompt.includes("смотрит влево"), false);
  assert.match(prompt, /calm/);
});

test("refine requires a supported change and new variation allows an empty instruction", () => {
  const empty = summarizeRevision({
    mode: "refine",
    instruction: "   ",
    baseline: baseline(),
    basis: { kind: "current-panel" },
  });
  assert.equal(empty.providerCall, false);
  assert.equal(empty.blockReason, "empty-refine");
  const prose = summarizeRevision({
    mode: "refine",
    instruction: "сделай красивее",
    baseline: baseline(),
    basis: { kind: "current-panel" },
  });
  assert.equal(prose.providerCall, false);
  assert.equal(prose.blockReason, "no-supported-change");
  const variation = summarizeRevision({
    mode: "new-variation",
    instruction: "",
    baseline: baseline(),
    basis: { kind: "none" },
  });
  assert.equal(variation.providerCall, true);
  assert.equal(variation.changes.length, 0);
  assert.equal(variation.basis.kind, "none");
  const mirror = summarizeRevision({
    mode: "refine",
    instruction: "отразить",
    baseline: baseline(),
    basis: { kind: "current-panel" },
  });
  assert.equal(mirror.providerCall, false);
  assert.equal(mirror.deterministicControl, "mirror");
});

test("refine keeps the declared basis and new variation sends no previous image", () => {
  const anchor = { id: "identity" };
  const previous = { id: "panel" };
  const performance = { id: "pose" };
  const style = { id: "style" };
  const refine = assembleRevisionReferences({ mode: "refine", anchor, previous, performance, style });
  assert.equal(refine.ok, true);
  assert.deepEqual(refine.slots.map((slot) => slot.role), ["anchor", "previous", "performance"]);
  assert.equal(refine.previousDropped, false);
  assert.equal(refine.styleDroppedByLimit, true);
  assert.equal(refine.generationMode, "revision");
  assert.equal(refine.omissions[0].reason, "reference-limit");
  const variation = assembleRevisionReferences({
    mode: "new-variation",
    anchor,
    previous,
    performance,
    style,
  });
  assert.equal(variation.slots.some((slot) => slot.role === "previous"), false);
  assert.equal(variation.generationMode, "performance");
  const missing = assembleRevisionReferences({ mode: "refine", anchor, previous: null, style });
  assert.equal(missing.ok, false);
  assert.equal(missing.kind, "basis-required");
});

test("candidate selection undoes without dropping later provenance", () => {
  const candidates = [
    { id: "c1", ordinal: 1, mode: "refine" },
    { id: "c2", ordinal: 2, mode: "new-variation" },
  ];
  assert.equal(moveCandidateSelection(candidates, "c2", "undo"), "c1");
  assert.equal(moveCandidateSelection(candidates, "c1", "redo"), "c2");
  assert.equal(moveCandidateSelection(candidates, "c1", "undo"), "c1");
  assert.equal(candidates[1].mode, "new-variation");
});

test("summary names basis, changes, preserved state, and text that is not applied", () => {
  const summary = summarizeRevision({
    mode: "refine",
    instruction: "смотрит влево и стул",
    baseline: baseline(),
    basis: { kind: "candidate", ordinal: 1 },
  });
  const lines = revisionSummaryLines(summary);
  assert.match(lines[0], /Основа: кандидат 1/);
  assert.match(lines[1], /Что изменится:[\s\S]*взгляд/);
  assert.equal(lines.some((line) => line.startsWith("Что сохранится")), false);
  assert.equal(lines.some((line) => line.startsWith("Не применяется: нет")), false);
  assert.match(lines.join(" "), /Не применяется:[\s\S]*стул/);
  const preserved = revisionPreservedDisclosure(summary);
  assert.equal(preserved.label, `Что сохранится · ${summary.preserved.length} свойств`);
  assert.match(preserved.text, /выражение/);
  const emptyNotApplied = revisionSummaryLines({ ...summary, notApplied: [] });
  assert.equal(emptyNotApplied.some((line) => line.startsWith("Не применяется")), false);
  assert.equal(revisionBasisText({ basis: { kind: "none" } }).includes("не отправляется"), true);
  assert.match(revisionSummaryLines({
    ...summary,
    reconstruction: "partial",
    basis: { kind: "current-panel", ordinal: null },
  }).join(" "), /не восстанавливается/);
});

const ROLE_LINE = {
  anchor: "is the approved identity anchor for Маша. It controls identity.",
  previous: "is the previous result for this panel. Use it as the staging draft and apply only the supported changes named below.",
  performance: "is the performance reference. It controls pose, expression, gaze, head angle, composition, and crop, but never identity.",
  style: "is the project style anchor. It controls rendering language only, never identity or staging.",
};

const PASSTHROUGH_ENV = {
  IMAGE_REFERENCE_STRATEGY: "passthrough",
  IMAGE_MODEL: "image-test",
  BASE_URL: "https://gateway.invalid.example/v1",
  CONTEST_API_TOKEN: "not-sent",
};

function expectedImageLines(roles) {
  return roles.map((role, index) => `Image ${index + 1} ${ROLE_LINE[role]}`);
}

function imageLines(prompt) {
  return String(prompt ?? "").split("\n").filter((line) => /^Image \d+ /.test(line));
}

function markedAsset(id, role, size = 96) {
  const bytes = Buffer.concat([
    Buffer.from(`role:${role}:`),
    Buffer.alloc(size, role.charCodeAt(0)),
  ]);
  return { id, mime: "image/png", bytes, width: 8, height: 8 };
}

function sentRoles(images) {
  return images.map((image) => {
    const match = /^role:([a-z]+):/.exec(image.bytes.toString("utf8"));
    if (!match) throw new Error("provider image is missing its role marker");
    return match[1];
  });
}

async function sendRevision({ mode, assets, env }) {
  const assembled = assembleRevisionReferences({ mode, ...assets });
  assert.equal(assembled.ok, true, mode);
  const fetches = [];
  const calls = [];
  const result = await deliverPreparedImage({
    slots: assembled.slots,
    generationMode: assembled.generationMode,
    assembled,
    compile: (flags) => compileRevisionPrompt(baseline(), {
      aspectRatio: "5:4",
      hasPrevious: flags.hasPrevious,
      hasPerformance: flags.hasPerformance,
      hasStyle: flags.hasStyle,
      identityAlsoStyle: flags.identityAlsoStyle,
    }),
    aspectRatio: "5:4",
    imageGenerator: async (input) => {
      calls.push(input);
      return { ok: true, image: { bytes: Buffer.from("fake-output"), mime: "image/png", width: 1, height: 1 } };
    },
    env,
    fetchImpl: async () => {
      fetches.push("fetch");
      throw new Error("provider fetch is not used");
    },
  });
  return { assembled, result, calls, fetches };
}

function assertProviderBoundary(label, sent, expectedRoles) {
  assert.equal(sent.fetches.length, 0, label);
  assert.equal(sent.result.ok, true, `${label} result`);
  assert.equal(sent.calls.length, 1, label);
  const call = sent.calls[0];
  const lines = expectedImageLines(expectedRoles);
  assert.equal(call.transport.referenceRoles, expectedRoles.join(","), label);
  assert.deepEqual(sentRoles(call.images), expectedRoles, label);
  assert.deepEqual(imageLines(call.prompt), lines, label);
  let cursor = -1;
  for (const line of lines) {
    const at = call.serializedBody.indexOf(line);
    assert.equal(at > cursor, true, `${label} serialized ${line}`);
    cursor = at;
  }
}

test("Image N declarations match the references included in the provider request", async () => {
  const anchor = markedAsset("identity", "anchor");
  const previous = markedAsset("panel", "previous");
  const performance = markedAsset("pose", "performance");
  const style = markedAsset("look", "style");

  const refinePerformance = await sendRevision({
    mode: "refine",
    assets: { anchor, previous, performance, style },
    env: PASSTHROUGH_ENV,
  });
  assert.deepEqual(
    refinePerformance.assembled.slots.map((slot) => slot.role),
    ["anchor", "previous", "performance"],
  );
  assert.deepEqual(refinePerformance.assembled.omissions, [
    { role: "style", assetId: "look", reason: "reference-limit" },
  ]);
  assertProviderBoundary(
    "refine anchor + previous + performance",
    refinePerformance,
    ["anchor", "previous", "performance"],
  );

  const refineStyle = await sendRevision({
    mode: "refine",
    assets: { anchor, previous, performance: null, style },
    env: PASSTHROUGH_ENV,
  });
  assert.deepEqual(
    refineStyle.assembled.slots.map((slot) => slot.role),
    ["anchor", "previous", "style"],
  );
  assertProviderBoundary(
    "refine anchor + previous + style",
    refineStyle,
    ["anchor", "previous", "style"],
  );

  const variation = await sendRevision({
    mode: "new-variation",
    assets: { anchor, previous, performance, style },
    env: PASSTHROUGH_ENV,
  });
  assert.deepEqual(
    variation.assembled.slots.map((slot) => slot.role),
    ["anchor", "performance", "style"],
  );
  assertProviderBoundary(
    "new variation anchor + performance + style",
    variation,
    ["anchor", "performance", "style"],
  );

  const bulkyStyle = markedAsset("look", "style", 16000);
  const preview = assembleRevisionReferences({
    mode: "refine",
    anchor,
    previous,
    performance: null,
    style: bulkyStyle,
  });
  const kept = preview.slots
    .filter((slot) => slot.role !== "style")
    .map((slot) => toReference(slot.role, slot.asset));
  const stalePrompt = compileRevisionPrompt(baseline(), {
    aspectRatio: "5:4",
    hasPrevious: true,
    hasPerformance: false,
    hasStyle: true,
    identityAlsoStyle: false,
  });
  const budget = Buffer.byteLength(serializeImageRequest({
    prompt: stalePrompt,
    references: kept,
    aspectRatio: "5:4",
    model: "image-test",
  }));
  const budgeted = await sendRevision({
    mode: "refine",
    assets: { anchor, previous, performance: null, style: bulkyStyle },
    env: {
      IMAGE_REFERENCE_STRATEGY: "budgeted",
      IMAGE_REQUEST_BUDGET_BYTES: String(budget),
      IMAGE_MODEL: "image-test",
      BASE_URL: "https://gateway.invalid.example/v1",
      CONTEST_API_TOKEN: "not-sent",
    },
  });
  assert.deepEqual(
    budgeted.assembled.slots.map((slot) => slot.role),
    ["anchor", "previous", "style"],
  );
  assert.equal(budgeted.result.diagnostics?.omittedRoles, "style");
  assertProviderBoundary(
    "budget omits included style",
    budgeted,
    ["anchor", "previous"],
  );
});
