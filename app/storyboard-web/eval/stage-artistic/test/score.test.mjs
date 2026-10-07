import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readCandidateJson, ScoreError, scoreStageArtistic } from "../score.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
const target = JSON.parse(readFileSync(new URL("../target.json", import.meta.url), "utf8"));
const scorerSource = readFileSync(new URL("../score.mjs", import.meta.url), "utf8");
const labels = {
  D01: "Путин",
  D02: "Путин",
  D03: "Путин",
  D04: "Песков",
  D05: "Путин",
  D06: "Дуров",
  D07: "Путин",
  D08: "Дуров",
  D09: "Путин",
  D10: "Дуров",
  D11: "Путин",
  D12: "Дуров",
  D13: "Путин",
  D14: "Дуров",
  D15: "Путин",
};

function panels(layout) {
  const description = "Песков крупно, остальные персонажи отсутствуют";
  return layout === "single" ? [{ description }] : [{ description }, { description }];
}

function sourceFrame(spec, layout = spec.layout) {
  const frame = {
    id: spec.sourceItemId,
    layout,
    origin: "source",
    panels: panels(layout),
    sourceItemId: spec.sourceItemId,
    sourceRole: spec.sourceRole,
  };
  if (spec.sourceRole === "utterance") frame.speakerPanel = 0;
  return frame;
}

function candidateWith(layoutFor) {
  return {
    frames: target.frames.map((spec) => sourceFrame(spec, layoutFor(spec))),
    review: ["C01"],
  };
}

const targetLike = candidateWith((spec) => spec.layout);
const allDialogueSplit = candidateWith((spec) => (spec.sourceRole === "utterance" ? "split2" : spec.layout));

function withFile(name, contents, fn) {
  const directory = mkdtempSync(join(tmpdir(), "stage-artistic-"));
  try {
    const candidatePath = join(directory, name);
    writeFileSync(candidatePath, contents);
    return fn(candidatePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fixture has one context, fifteen utterances, two actions, and no offsets", () => {
  assert.deepEqual(Object.keys(fixture), ["sourceItems"]);
  assert.equal(fixture.sourceItems.length, 18);
  const counts = { context: 0, utterance: 0, action: 0 };
  for (const item of fixture.sourceItems) {
    counts[item.kind] += 1;
    assert.equal(JSON.stringify(item).includes("draftStart"), false);
    assert.equal(typeof item.text, "string");
  }
  assert.deepEqual(counts, { context: 1, utterance: 15, action: 2 });
  assert.deepEqual(fixture.sourceItems.map((item) => item.id), target.sourceOrder);
  for (const [id, label] of Object.entries(labels)) {
    const item = fixture.sourceItems.find((entry) => entry.id === id);
    assert.equal(item.speakerLabel, label);
    assert.equal(item.speakerStatus, "explicit");
    assert.equal(item.sourceQuote.startsWith(`${label}: `), true);
    assert.equal(item.text.startsWith(`${label}:`), false);
  }
  for (const id of ["C01", "A01", "A02"]) {
    const item = fixture.sourceItems.find((entry) => entry.id === id);
    assert.equal(Object.hasOwn(item, "speakerLabel"), false);
    assert.equal(item.speakerStatus, "none");
    assert.equal(item.text, item.sourceQuote);
  }
  const opening = fixture.sourceItems.find((item) => item.id === "D01");
  assert.match(opening.text, /телеграмм/);
  assert.equal(opening.text.includes("Telegram"), false);
  assert.match(fixture.sourceItems[0].text, /Telegram/);
  assert.equal(fixture.sourceItems.find((item) => item.id === "D02").text, "Дмитрий Сергеевич ...");
  assert.equal(fixture.sourceItems.find((item) => item.id === "D03").text, "ДМИТРИЙ СЕРГЕЕВИЧ!!");
  assert.match(fixture.sourceItems.find((item) => item.id === "A01").text, /спящий Песков/);
  assert.match(fixture.sourceItems.find((item) => item.id === "A02").text, /панике/);
});

test("target counts seventeen semantic frames and nineteen rendered frames", () => {
  assert.equal(target.semanticSourceFrames, 17);
  assert.equal(target.frames.length, 17);
  assert.equal(target.renderedFrames, 19);
  assert.equal(target.renderedDialogueDisplayBlocks, 17);
  assert.equal(target.renderedActions, 2);
  const rendered = target.frames.reduce((sum, frame) => sum + frame.expectedRenderedBlocks, 0);
  assert.equal(rendered, 19);
  assert.deepEqual(
    target.frames.filter((frame) => frame.expectedRenderedBlocks === 2).map((frame) => frame.sourceItemId),
    ["D01", "D06"],
  );
  const groups = { "deliberate-single": 0, "conversational-split": 0, "action-single": 0 };
  for (const frame of target.frames) groups[frame.agreementGroup] += 1;
  assert.deepEqual(groups, { "deliberate-single": 7, "conversational-split": 8, "action-single": 2 });
});

test("target-like candidate agrees on every layout group", () => {
  for (const frame of targetLike.frames) {
    assert.match(frame.panels[0].description, /Песков/);
  }
  const report = scoreStageArtistic(fixture, target, targetLike);
  assert.equal(report.schemaValid, true);
  assert.equal(report.sourceFidelity.ok, true);
  assert.deepEqual(report.sourceFidelity.sourceFrameCoverage, { covered: 17, expected: 17 });
  assert.deepEqual(report.sourceFidelity.contextReviewCoverage.covered, 1);
  assert.equal(report.artistic.verdict, "not-a-pass-fail");
  assert.deepEqual(report.artistic.layoutAgreement, { matched: 17, expected: 17 });
  assert.deepEqual(report.artistic.deliberateSingleAgreement, { matched: 7, expected: 7 });
  assert.deepEqual(report.artistic.conversationalSplitAgreement, { matched: 8, expected: 8 });
  assert.deepEqual(report.artistic.actionSingleAgreement, { matched: 2, expected: 2 });
  assert.equal(report.artistic.derivedFrameCount, 0);
  assert.deepEqual(report.artistic.layoutDisagreements, []);
});

test("all-dialogue-split candidate keeps conversational splits and loses deliberate singles", () => {
  const report = scoreStageArtistic(fixture, target, allDialogueSplit);
  assert.equal(report.schemaValid, true);
  assert.equal(report.sourceFidelity.ok, true);
  assert.deepEqual(report.sourceFidelity.sourceFrameCoverage, { covered: 17, expected: 17 });
  assert.deepEqual(report.sourceFidelity.missingSourceFrames, []);
  assert.deepEqual(report.sourceFidelity.duplicateSourceFrames, []);
  assert.equal(report.artistic.verdict, "not-a-pass-fail");
  assert.deepEqual(report.artistic.layoutAgreement, { matched: 10, expected: 17 });
  assert.deepEqual(report.artistic.deliberateSingleAgreement, { matched: 0, expected: 7 });
  assert.deepEqual(report.artistic.conversationalSplitAgreement, { matched: 8, expected: 8 });
  assert.deepEqual(report.artistic.actionSingleAgreement, { matched: 2, expected: 2 });
  assert.deepEqual(
    report.artistic.layoutDisagreements.map((entry) => entry.sourceItemId),
    ["D02", "D03", "D04", "D11", "D13", "D14", "D15"],
  );
});

test("directing segments stay inside one semantic frame", () => {
  const opening = fixture.sourceItems.find((item) => item.id === "D01");
  const splitAt = opening.text.indexOf("\n");
  const candidate = structuredClone(targetLike);
  candidate.frames[0] = {
    ...sourceFrame(target.frames[0]),
    directingBeat: true,
    segments: [
      {
        quote: opening.text.slice(0, splitAt + 1),
        layout: "split2",
        speakerPanel: 0,
        panels: panels("split2"),
      },
      {
        quote: opening.text.slice(splitAt + 1),
        layout: "split2",
        speakerPanel: 0,
        panels: [{ description: "другая левая панель" }, { description: "другая правая панель" }],
      },
    ],
  };
  const report = scoreStageArtistic(fixture, target, candidate);
  assert.equal(report.artistic.layoutAgreement.matched, 17);
  assert.equal(report.artistic.layoutAgreement.expected, 17);
  assert.equal(candidate.frames.length, 17);
});

test("a derived frame is counted and is not an artistic failure", () => {
  const candidate = structuredClone(targetLike);
  candidate.frames.unshift({
    id: "extra-beat",
    layout: "single",
    origin: "derived",
    panels: [{ description: "лишняя пауза" }],
    placement: { afterSourceItemId: "C01", beforeSourceItemId: "D01" },
  });
  const report = scoreStageArtistic(fixture, target, candidate);
  assert.equal(report.sourceFidelity.ok, true);
  assert.equal(report.artistic.verdict, "not-a-pass-fail");
  assert.equal(report.artistic.derivedFrameCount, 1);
  assert.deepEqual(report.artistic.layoutAgreement, { matched: 17, expected: 17 });
});

test("a missing source frame is a reported fidelity gap", () => {
  const candidate = structuredClone(targetLike);
  candidate.frames = candidate.frames.filter((frame) => frame.sourceItemId !== "D15");
  const report = scoreStageArtistic(fixture, target, candidate);
  assert.equal(report.schemaValid, true);
  assert.equal(report.sourceFidelity.ok, false);
  assert.deepEqual(report.sourceFidelity.missingSourceFrames, ["D15"]);
  assert.deepEqual(report.sourceFidelity.sourceFrameCoverage, { covered: 16, expected: 17 });
  assert.equal(report.artistic.verdict, "not-a-pass-fail");
  assert.deepEqual(report.artistic.deliberateSingleAgreement, { matched: 6, expected: 7 });
});

test("invalid fixture structure fails clearly", () => {
  const numbered = structuredClone(fixture);
  numbered.sourceItems[0].draftStart = 0;
  assert.throws(() => scoreStageArtistic(numbered, target, targetLike), (error) => {
    assert.equal(error instanceof ScoreError, true);
    assert.equal(error.code, "invalid-fixture");
    assert.match(error.message, /draftStart/);
    return true;
  });

  const shortened = structuredClone(fixture);
  shortened.sourceItems = shortened.sourceItems.filter((item) => item.id !== "D15");
  assert.throws(() => scoreStageArtistic(shortened, target, targetLike), (error) => {
    assert.equal(error.code, "invalid-fixture");
    assert.match(error.message, /source items/);
    return true;
  });
});

test("invalid candidate structure fails clearly", () => {
  const twoPanelsOnSingle = structuredClone(targetLike);
  twoPanelsOnSingle.frames[1].panels = panels("split2");
  assert.throws(() => scoreStageArtistic(fixture, target, twoPanelsOnSingle), (error) => {
    assert.equal(error instanceof ScoreError, true);
    assert.equal(error.code, "invalid-candidate");
    assert.match(error.message, /failed schema/);
    return true;
  });

  assert.throws(() => scoreStageArtistic(fixture, target, {
    choices: [{ message: { content: "{}" } }],
    frames: targetLike.frames,
    review: ["C01"],
  }), (error) => {
    assert.equal(error.code, "invalid-candidate");
    assert.match(error.message, /failed schema/);
    return true;
  });
});

test("scorer does not read the environment or a provider", () => {
  for (const token of [".env.local", "process.env", "chat/completions", "provider.mjs", "fetch(", ".description"]) {
    assert.equal(scorerSource.includes(token), false, token);
  }
  assert.equal(readFileSync(new URL("../fixture.json", import.meta.url), "utf8").includes("draftStart"), false);
});

test("command scores a saved candidate and rejects an env file", () => {
  const script = fileURLToPath(new URL("../score.mjs", import.meta.url));
  const scored = withFile("candidate.json", JSON.stringify(allDialogueSplit), (candidatePath) => spawnSync(process.execPath, [script, candidatePath], {
    encoding: "utf8",
    env: {},
  }));
  assert.equal(scored.status, 0);
  const report = JSON.parse(scored.stdout);
  assert.equal(report.schemaValid, true);
  assert.equal(report.sourceFidelity.ok, true);
  assert.deepEqual(report.artistic.deliberateSingleAgreement, { matched: 0, expected: 7 });
  assert.deepEqual(report.artistic.conversationalSplitAgreement, { matched: 8, expected: 8 });
  assert.deepEqual(report.artistic.actionSingleAgreement, { matched: 2, expected: 2 });
  assert.equal(report.artistic.verdict, "not-a-pass-fail");

  const rejected = withFile("broken.json", "{", (candidatePath) => spawnSync(process.execPath, [script, candidatePath], {
    encoding: "utf8",
    env: {},
  }));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /invalid-candidate/);

  assert.throws(() => readCandidateJson(join(tmpdir(), ".env.local")), (error) => {
    assert.equal(error.code, "invalid-candidate");
    assert.match(error.message, /environment file/);
    return true;
  });
});
