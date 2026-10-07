import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stageStoryboard } from "../../../stage.mjs";
import { scoreStageArtistic } from "../score.mjs";
import { createSingleUseFetch, runStageBaseline } from "../run-stage.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixture.json", import.meta.url), "utf8"));
const target = JSON.parse(readFileSync(new URL("../target.json", import.meta.url), "utf8"));
const stagePrompt = readFileSync(new URL("../../../prompts/stage.md", import.meta.url), "utf8");
const interpretPrompt = readFileSync(new URL("../../../prompts/interpret.md", import.meta.url), "utf8");
const runnerSource = readFileSync(new URL("../run-stage.mjs", import.meta.url), "utf8");
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

const SECRET_TOKEN = "stage-baseline-test-token";
const PROVIDER_HOST = "provider.example.test";
const RAW_SENTINEL = "RAW_PROVIDER_ENVELOPE_SENTINEL";
const PROMPT_MARK = "You are the staging step";

function env() {
  return {
    BASE_URL: `https://${PROVIDER_HOST}/v1`,
    CONTEST_API_TOKEN: SECRET_TOKEN,
    STAGE_MODEL: "stage-baseline-model",
    CONTEST_MODEL: "unused-contest-model",
    INTERPRET_MODEL: "interpret-must-not-run",
  };
}

function panels(layout, sourceItemId) {
  const description = `${sourceItemId} baseline panel`;
  return layout === "single"
    ? [{ description }]
    : [{ description }, { description: `${sourceItemId} other panel` }];
}

function candidateFromTarget() {
  return {
    frames: target.frames.map((spec) => {
      const frame = {
        id: spec.sourceItemId,
        layout: spec.layout,
        origin: "source",
        panels: panels(spec.layout, spec.sourceItemId),
        sourceItemId: spec.sourceItemId,
        sourceRole: spec.sourceRole,
      };
      if (spec.sourceRole === "utterance") frame.speakerPanel = 0;
      return frame;
    }),
    review: ["C01"],
  };
}

function envelope(content, extra = {}) {
  return JSON.stringify({
    ...extra,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
  });
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body;
    },
  };
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "stage-baseline-"));
}

function savedText(resultsDir) {
  return readdirSync(resultsDir).map((name) => readFileSync(join(resultsDir, name), "utf8")).join("\n");
}

test("one stage completion writes the candidate and score", async () => {
  const candidate = candidateFromTarget();
  const calls = [];
  const resultsDir = tempDir();
  try {
    const outcome = await runStageBaseline({
      fixture,
      target,
      env: env(),
      resultsDir,
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, envelope(JSON.stringify(candidate), { debug: RAW_SENTINEL }));
      },
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.requestCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, "/v1/chat/completions");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "stage-baseline-model");
    assert.equal(body.reasoning_effort, "medium");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.messages[0].content, stagePrompt);
    assert.notEqual(body.messages[0].content, interpretPrompt);
    assert.equal(body.messages.length, 2);
    assert.deepEqual(readdirSync(resultsDir).sort(), [
      "current-stage-summary.md",
      "current-stage.candidate.json",
      "current-stage.score.json",
    ]);
    const savedCandidate = JSON.parse(readFileSync(join(resultsDir, "current-stage.candidate.json"), "utf8"));
    assert.deepEqual(savedCandidate, candidate);
    assert.deepEqual(Object.keys(savedCandidate).sort(), ["frames", "review"]);
    const savedScore = JSON.parse(readFileSync(join(resultsDir, "current-stage.score.json"), "utf8"));
    assert.deepEqual(savedScore, scoreStageArtistic(fixture, target, candidate));
    const summary = readFileSync(join(resultsDir, "current-stage-summary.md"), "utf8");
    assert.match(summary, /sourceItemId: D01/);
    assert.match(summary, /layout: split2/);
    assert.match(summary, /origin: source/);
    assert.match(summary, /D01 baseline panel/);
    assert.match(summary, /does not assign human-rubric scores/);
    assert.equal(summary.includes("Character and alias focus"), false);
    const artifacts = savedText(resultsDir);
    for (const secret of [SECRET_TOKEN, PROVIDER_HOST, RAW_SENTINEL, PROMPT_MARK, "choices", "Authorization"]) {
      assert.equal(artifacts.includes(secret), false, secret);
    }
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});

test("the application and the runner share one stage request", async () => {
  const candidate = candidateFromTarget();
  const resultsDir = tempDir();
  const seen = [];
  const fetchImpl = (url, init) => {
    seen.push(JSON.parse(init.body));
    return jsonResponse(200, envelope(JSON.stringify(candidate)));
  };
  try {
    await runStageBaseline({ fixture, target, env: env(), resultsDir, fetchImpl });
    await stageStoryboard({
      draft: { text: "draft" },
      sourceItems: fixture.sourceItems,
      env: env(),
      fetchImpl,
    });
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0].messages, seen[1].messages);
    assert.equal(seen[0].model, seen[1].model);
    assert.equal(seen[0].reasoning_effort, seen[1].reasoning_effort);
    assert.deepEqual(seen[0].response_format, seen[1].response_format);
    assert.equal(runnerSource.includes("requestStageCandidate"), true);
    assert.equal(runnerSource.includes(PROMPT_MARK), false);
    assert.equal(runnerSource.includes("interpret.mjs"), false);
    assert.equal(runnerSource.includes("completeInterpret"), false);
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});

test("a second fetch is refused before transmission", () => {
  let transmitted = 0;
  const guarded = createSingleUseFetch(() => {
    transmitted += 1;
    return jsonResponse(200, "{}");
  });
  guarded.fetch("https://provider.example.test/v1/chat/completions", { method: "POST" });
  assert.equal(transmitted, 1);
  assert.equal(guarded.requestCount, 1);
  assert.throws(
    () => guarded.fetch("https://provider.example.test/v1/chat/completions", { method: "POST" }),
    /refusing a second provider request/,
  );
  assert.equal(transmitted, 1);
  assert.equal(guarded.requestCount, 1);
});

test("an invalid completion writes only a sanitized attempt and does not retry", async () => {
  let calls = 0;
  const resultsDir = tempDir();
  const rawBody = `{"frames":[],"review":[],"leak":"${RAW_SENTINEL}"}`;
  try {
    const outcome = await runStageBaseline({
      fixture,
      target,
      env: env(),
      resultsDir,
      fetchImpl: () => {
        calls += 1;
        if (calls > 1) throw new Error("retry was sent");
        return jsonResponse(200, envelope(rawBody));
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.requestCount, 1);
    assert.equal(calls, 1);
    assert.deepEqual(readdirSync(resultsDir), ["current-stage.attempt.json"]);
    const attempt = JSON.parse(readFileSync(join(resultsDir, "current-stage.attempt.json"), "utf8"));
    assert.equal(attempt.requestCount, 1);
    assert.equal(attempt.kind, "invalid-output");
    assert.equal(attempt.httpStatus, 502);
    assert.equal(attempt.finishReason, "stop");
    assert.ok(Array.isArray(attempt.schemaPaths));
    assert.equal(attempt.schemaPaths.length > 0, true);
    const text = readFileSync(join(resultsDir, "current-stage.attempt.json"), "utf8");
    for (const secret of [SECRET_TOKEN, PROVIDER_HOST, RAW_SENTINEL, PROMPT_MARK, rawBody]) {
      assert.equal(text.includes(secret), false, secret);
    }
    assert.equal(Object.hasOwn(attempt, "frames"), false);
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});

test("an existing result file blocks the provider request", async () => {
  let calls = 0;
  const resultsDir = tempDir();
  try {
    writeFileSync(join(resultsDir, "current-stage.attempt.json"), "{}\n");
    const outcome = await runStageBaseline({
      fixture,
      target,
      env: env(),
      resultsDir,
      fetchImpl: () => {
        calls += 1;
        return jsonResponse(500, "nope");
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.kind, "result-exists");
    assert.equal(outcome.requestCount, 0);
    assert.equal(calls, 0);
    assert.equal(readFileSync(join(resultsDir, "current-stage.attempt.json"), "utf8"), "{}\n");
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
  }
});

test("stage baseline results are ignored by git", () => {
  const ignored = spawnSync("git", [
    "check-ignore",
    "-q",
    "app/storyboard-web/eval/stage-artistic/results/current-stage.candidate.json",
  ], { cwd: repoRoot });
  assert.equal(ignored.status, 0);
  assert.equal(runnerSource.includes(".env.local"), false);
});
