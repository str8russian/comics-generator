import assert from "node:assert/strict";
import test from "node:test";
import {
  applySupportedPatch,
  assembleRevisionReferences,
  compileRevisionPrompt,
  initializeEffectiveIntent,
  moveCandidateSelection,
  summarizeRevision,
} from "../panel-revision.mjs";
import { revisionBasisText, revisionSummaryLines } from "../public/panel-revision-view.mjs";

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
  assert.match(lines[1], /взгляд/);
  assert.match(lines[2], /выражение/);
  assert.match(lines[3], /стул/);
  assert.equal(revisionBasisText({ basis: { kind: "none" } }).includes("не отправляется"), true);
  assert.match(revisionSummaryLines({
    ...summary,
    reconstruction: "partial",
    basis: { kind: "current-panel", ordinal: null },
  }).join(" "), /не восстанавливается/);
});
