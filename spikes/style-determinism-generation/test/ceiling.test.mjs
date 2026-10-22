import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/evidence.mjs";
import { createCallCeiling } from "../lib/ceiling.mjs";
import { resolveRunConfig } from "../lib/config.mjs";
import { verifyInputs } from "../lib/inputs.mjs";
import { buildMatrix } from "../lib/matrix.mjs";
import { ACCEPTED_STYLE_BLOCK, compileConditionPrompt } from "../lib/prompts.mjs";
import { executeRun, runMatrix } from "../lib/runner.mjs";
import { writeImageFixture } from "./fixture.mjs";

const referenceConfig = { ok: true, strategy: "budgeted", budgetBytes: 850_000 };
const model = "gemini-3-pro-image-preview";
const timeoutMs = 58_000;

test("input mismatch and missing configuration make zero provider calls", async () => {
  let calls = 0;
  const blocked = await executeRun({
    verified: { ok: false, reason: "input-mismatch" },
    imageGenerator: async () => { calls += 1; return { ok: true }; },
  });
  assert.equal(blocked.attempted, 0);
  assert.equal(blocked.providerCalls, 0);
  const directory = await mkdtemp(join(tmpdir(), "style-det-secret-path-"));
  const fixture = await writeImageFixture(directory);
  const badTemplate = JSON.parse(JSON.stringify({ version: 1, samePerson: true, inputs: {} }));
  const verified = await verifyInputs({ runtimePath: fixture.runtimePath, templatePath: fixture.templatePath });
  assert.equal(verified.ok, true);
  const mismatch = await verifyInputs({
    runtimePath: join(directory, "missing-runtime.json"),
    templatePath: fixture.templatePath,
  });
  assert.equal(mismatch.ok, false);
  const wrong = structuredClone(verified);
  wrong.inputs["source-a"].width = 641;
  const templatePath = join(directory, "wrong-template.json");
  const { writeFile } = await import("node:fs/promises");
  const template = JSON.parse(await (await import("node:fs/promises")).readFile(fixture.templatePath, "utf8"));
  template.inputs["source-a"].width = 641;
  await writeFile(templatePath, JSON.stringify(template));
  const dimensionMismatch = await verifyInputs({ runtimePath: fixture.runtimePath, templatePath });
  assert.equal(dimensionMismatch.ok, false);
  assert.equal(dimensionMismatch.failures.some((failure) => failure.logicalId === "source-a" && failure.problem.includes("dimensions")), true);
  assert.equal(JSON.stringify(dimensionMismatch).includes(directory), false);
  assert.equal(badTemplate.samePerson, true);
  assert.equal(calls, 0);
  const unconfigured = await runMatrix({
    inputs: fixture.inputs,
    imageGenerator: async () => { calls += 1; },
    model: "",
    timeoutMs,
    referenceConfig,
  });
  assert.equal(unconfigured.attempted, 0);
  assert.equal(unconfigured.providerCalls, 0);
  assert.equal(calls, 0);
});

test("a real request uses 4:5, the configured model and timeout, and identity before style", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-secret-path-"));
  const fixture = await writeImageFixture(directory);
  const seen = [];
  let active = 0;
  let maxActive = 0;
  const result = await runMatrix({
    inputs: fixture.inputs,
    model,
    timeoutMs,
    referenceConfig,
    imageGenerator: async (request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const body = JSON.parse(request.serializedBody);
      const content = body.messages[0].content;
      const first = Buffer.from(content[1].image_url.url.split(",")[1], "base64");
      const identityHashes = new Set([fixture.inputs["source-a"].sha256, fixture.inputs["source-b"].sha256]);
      assert.equal(identityHashes.has(sha256(first)), true);
      assert.equal(content[0].type, "text");
      assert.equal(body.model, model);
      assert.equal(body.image_config.aspect_ratio, "4:5");
      assert.equal(request.aspectRatio, "4:5");
      assert.equal(request.timeoutMs, timeoutMs);
      if (content.length === 3) {
        const style = Buffer.from(content[2].image_url.url.split(",")[1], "base64");
        assert.equal(sha256(style), fixture.inputs["style-reference"].sha256);
        assert.equal(request.prompt.includes("Image 2 controls rendering language only"), true);
      } else {
        assert.equal(content.length, 2);
        assert.equal(request.prompt.includes("Image 2"), false);
      }
      seen.push(request.prompt);
      active -= 1;
      return {
        ok: true,
        image: { bytes: fixture.inputs["style-reference"].bytes, mime: "image/png", width: 14, height: 16 },
        metadata: { latencyMs: 7, providerStatus: 200 },
      };
    },
  });
  assert.equal(result.providerCalls, 12);
  assert.equal(result.attempted, 12);
  assert.equal(result.succeeded, 12);
  assert.equal(result.failed, 0);
  assert.equal(maxActive, 1);
  assert.equal(seen.filter((prompt) => prompt.includes(ACCEPTED_STYLE_BLOCK)).length, 8);
  assert.equal(seen.filter((prompt) => !prompt.includes(ACCEPTED_STYLE_BLOCK)).length, 4);
  const promptOnly = result.cells.filter((cell) => cell.condition === "prompt-only");
  assert.deepEqual(promptOnly.map((cell) => cell.referenceRoles), [["identity"], ["identity"], ["identity"], ["identity"]]);
  const repeated = result.cells.filter((cell) => cell.id === "source-a.hybrid.r1" || cell.id === "source-a.hybrid.r2");
  assert.equal(repeated[0].promptSha256, repeated[1].promptSha256);
  assert.equal(repeated[0].requestSha256, repeated[1].requestSha256);
  assert.equal(JSON.stringify(result.cells).includes("data:image"), false);
  assert.equal(JSON.stringify(result.cells).includes(directory), false);
  assert.equal(result.cells.every((cell) => cell.model === model), true);
});

test("a retryable transport failure is retried once and the systemic stop waits for exhausted cells", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-secret-path-"));
  const fixture = await writeImageFixture(directory);
  let calls = 0;
  const result = await runMatrix({
    inputs: fixture.inputs,
    model,
    timeoutMs,
    referenceConfig,
    imageGenerator: async () => {
      calls += 1;
      return { ok: false, kind: "provider", diagnostics: { providerStatus: 502, latencyMs: 9 } };
    },
  });
  assert.equal(calls, 4);
  assert.equal(result.providerCalls, 4);
  assert.equal(result.attempted, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.unattempted, 10);
  assert.equal(result.stopReason, "consecutive-same-failure");
  assert.equal(result.cells[0].failureKind, "provider");
  assert.equal(result.cells[0].invocations.length, 2);
  assert.equal(result.cells[0].invocations[0].attemptNumber, 1);
  assert.equal(result.cells[0].invocations[1].attemptNumber, 2);
  assert.equal(result.cells[2].status, "unattempted");
});

test("a payload-size failure consumes an attempt without calling or retrying the provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-secret-path-"));
  const fixture = await writeImageFixture(directory);
  let calls = 0;
  const result = await runMatrix({
    inputs: fixture.inputs,
    model,
    timeoutMs,
    referenceConfig,
    prepare: async (input) => ({
      ok: false,
      kind: "reference-payload-too-large",
      omittedRoles: [],
      finalBodyBytes: 900_000,
      diagnostics: {
        referenceRoles: input.references.map((ref) => ref.role).join(","),
        references: input.references.map((ref) => ({
          role: ref.role,
          mime: ref.mime,
          width: ref.width,
          height: ref.height,
          byteLength: ref.bytes.length,
        })),
      },
    }),
    imageGenerator: async () => { calls += 1; return { ok: true }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.attempted, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.cells[0].failureKind, "reference-payload-too-large");
  assert.equal(result.stopReason, "consecutive-same-failure");
});

test("different terminal failure kinds do not halt before the invocation ceiling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-secret-path-"));
  const fixture = await writeImageFixture(directory);
  const plan = [
    ["timeout", "timeout"],
    ["provider", "provider"],
    ["invalid-output", "invalid-output"],
  ];
  let calls = 0;
  const mixed = await runMatrix({
    cells: buildMatrix().slice(0, 3),
    inputs: fixture.inputs,
    model,
    timeoutMs,
    referenceConfig,
    imageGenerator: async () => {
      const kind = plan[Math.floor(calls / 2)][calls % 2];
      calls += 1;
      if (kind === "invalid-output") return { ok: true, image: { bytes: Buffer.from("not-an-image") } };
      return { ok: false, kind, diagnostics: { latencyMs: 1, providerStatus: 502 } };
    },
  });
  assert.equal(calls, 6);
  assert.equal(mixed.attempted, 3);
  assert.equal(mixed.failed, 3);
  assert.equal(mixed.stopReason, null);
  assert.equal(mixed.providerCalls, 6);
});

test("concurrent ceiling callers cannot pass 24 and a terminal failure is counted only when recorded", async () => {
  const ceiling = createCallCeiling();
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 30 }, () => ceiling.invoke(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { ok: false, kind: "timeout" };
  })));
  assert.equal(calls, 24);
  assert.equal(results.filter((result) => result.consumed).length, 24);
  assert.equal(ceiling.attempted, 24);
  const sequential = createCallCeiling();
  let thrown = 0;
  const first = await sequential.invoke(async () => { thrown += 1; throw new Error("boom"); });
  assert.equal(first.kind, "provider");
  assert.equal(sequential.halted, false);
  sequential.noteTerminal("provider");
  assert.equal(sequential.halted, false);
  sequential.noteTerminal("provider");
  assert.equal(sequential.haltReason, "consecutive-same-failure");
  const blocked = await sequential.invoke(async () => { thrown += 1; return { ok: true }; });
  assert.equal(thrown, 1);
  assert.equal(blocked.consumed, false);
  assert.throws(() => createCallCeiling({ limit: 25 }), /fixed at 24/);
});

test("provider configuration stays capped and secret-free", () => {
  const config = resolveRunConfig({
    BASE_URL: "http://127.0.0.1:9",
    CONTEST_API_TOKEN: "super-secret-token",
    IMAGE_TIMEOUT_MS: "180000",
  });
  assert.equal(config.timeoutMs, 58_000);
  assert.equal(config.providerConfigured, true);
  assert.equal(config.model, model);
  assert.equal(config.aspectRatio, "4:5");
  const text = JSON.stringify(config);
  assert.equal(text.includes("super-secret-token"), false);
  assert.equal(text.includes("127.0.0.1"), false);
  const shorter = resolveRunConfig({ IMAGE_TIMEOUT_MS: "10000", BASE_URL: "http://127.0.0.1:9", CONTEST_API_TOKEN: "secret" });
  assert.equal(shorter.timeoutMs, 10_000);
  assert.equal(compileConditionPrompt("prompt-only").includes(ACCEPTED_STYLE_BLOCK), true);
});
