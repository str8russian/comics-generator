import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/evidence.mjs";
import { ATTEMPT_ORDER, SAME_IDENTITY_STATEMENT } from "../lib/constants.mjs";
import { verifyInputs } from "../lib/inputs.mjs";
import { buildMatrix } from "../lib/matrix.mjs";
import { compileConditionPrompt } from "../lib/prompts.mjs";
import { buildCellEvidence } from "../lib/evidence.mjs";
import { buildReviewModel, renderReviewPage } from "../lib/render-page.mjs";
import { createReviewServer, listenReviewServer } from "../lib/review-server.mjs";
import { main } from "../live.mjs";
import { writeImageFixture } from "./fixture.mjs";

const JUDGEMENT = {
  overall: "acceptable",
  identity: "recognizable",
  contour: "target",
  identityDetail: "target",
  tonalComplexity: "target",
  facialShadow: "acceptable",
  color: "target",
  highlights: "absent",
  anatomyNote: "local note",
};

test("the review page shows the matrix, failures, rubric, and blinded labels", () => {
  const cells = buildMatrix().map((cell, index) => buildCellEvidence({
    cell,
    status: index === 0 ? "failed" : index === 1 ? "unattempted" : "succeeded",
    attemptNumber: index === 1 ? null : index + 1,
    failureKind: index === 0 ? "provider" : null,
    skippedReason: index === 1 ? "consecutive-same-failure" : null,
    prompt: compileConditionPrompt(cell.condition),
    referenceRoles: cell.roles,
    normalizedReferences: cell.roles.map((role) => ({ role, mime: "image/png", width: 8, height: 8, byteLength: 20 })),
    requestSha256: "a".repeat(64),
    requestBytes: 128,
    model: "gemini-3-pro-image-preview",
    output: index > 1 ? { sha256: "b".repeat(64), extension: "png", mime: "image/png", width: 200, height: 250 } : null,
  }));
  const manifest = reviewManifest(cells);
  const hidden = renderReviewPage(buildReviewModel({ manifest, judgements: { cells: {} }, reveal: true }));
  assert.equal(hidden.includes("prompt-only"), false);
  assert.equal(hidden.includes("style-reference-only"), false);
  assert.equal(hidden.includes("hybrid"), false);
  assert.equal(hidden.includes(SAME_IDENTITY_STATEMENT), true);
  assert.equal(hidden.includes("No output"), true);
  assert.equal(hidden.includes("Not attempted"), true);
  assert.equal(hidden.includes("provider"), true);
  assert.equal(hidden.includes("Reveal stays closed"), true);
  assert.equal(hidden.includes("invented/problematic"), true);
  assert.equal(hidden.includes("sparse acceptable"), true);
  assert.equal(hidden.includes("Planned"), true);
  assert.equal(hidden.includes("Save judgement"), true);
  assert.equal(hidden.includes("https://"), false);
  assert.equal(hidden.includes("http://"), false);
  for (const cell of cells) assert.equal(hidden.includes(cell.publicId), true);

  const judgements = {
    cells: Object.fromEntries(cells.filter((cell) => cell.status === "succeeded").map((cell) => [cell.publicId, JUDGEMENT])),
  };
  const revealed = renderReviewPage(buildReviewModel({ manifest, judgements, reveal: true }));
  assert.equal(revealed.includes("prompt-only"), true);
  assert.equal(revealed.includes("style-reference-only"), true);
  assert.equal(revealed.includes("hybrid"), true);
  assert.equal(revealed.includes("Categorical counts"), true);
  assert.equal(revealed.includes("not a winner"), true);
  assert.equal(revealed.includes("acceptable: 4"), true);
});

test("fake-provider review flow saves local judgements and makes no external request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "style-det-secret-path-"));
  const fixture = await writeImageFixture(directory);
  const logs = [];
  const env = {
    BASE_URL: "http://127.0.0.1:9",
    CONTEST_API_TOKEN: "super-secret-token",
    IMAGE_TIMEOUT_MS: "180000",
  };
  const checked = await main(["--check", "--runtime", fixture.runtimePath, "--template", fixture.templatePath], {
    env,
    git: { head: "abc", status: "" },
    logger: (line) => logs.push(line),
  });
  assert.equal(checked.exitCode, 0);
  assert.equal(checked.attempted, 0);
  assert.equal(checked.preflight.callCounter, 0);
  assert.equal(logs.join("\n").includes("super-secret-token"), false);
  const dirty = await main(["--check", "--runtime", fixture.runtimePath, "--template", fixture.templatePath], {
    env,
    git: { head: "abc", status: " M package.json" },
    logger: () => {},
  });
  assert.equal(dirty.exitCode, 2);
  assert.equal(dirty.attempted, 0);
  const runDir = join(directory, "fake-smoke");
  const ran = await main([
    "--fake",
    "--run-dir", runDir,
    "--run-id", "fake-smoke",
    "--runtime", fixture.runtimePath,
    "--template", fixture.templatePath,
  ], { env, git: { head: "abc", status: "" }, logger: (line) => logs.push(line) });
  assert.equal(ran.exitCode, 0);
  assert.equal(ran.succeeded, 12);
  assert.equal(ran.providerCalls, 12);
  assert.equal(logs.join("\n").includes("super-secret-token"), false);
  assert.equal(logs.join("\n").includes("127.0.0.1"), false);
  const manifestText = await readFile(join(runDir, "manifest.json"), "utf8");
  assert.equal(manifestText.includes(directory), false);
  assert.equal(manifestText.includes("data:image"), false);
  assert.equal(manifestText.includes("super-secret-token"), false);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.planned, 12);
  assert.equal(manifest.attempted, 12);
  const verified = await verifyInputs({ runtimePath: fixture.runtimePath, templatePath: fixture.templatePath });
  const server = createReviewServer({ runDir, verifiedInputs: verified });
  assert.throws(() => listenReviewServer(server, { host: "0.0.0.0", port: 0 }), /127\.0\.0\.1/);
  const address = await listenReviewServer(server, { host: "127.0.0.1", port: 0 });
  assert.equal(address.address, "127.0.0.1");
  try {
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.equal(page.headers.get("content-security-policy").includes("default-src 'self'"), true);
    assert.equal(html.includes("prompt-only"), false);
    assert.equal(html.includes(SAME_IDENTITY_STATEMENT), true);
    assert.equal(html.includes("Experiment-only style reference"), true);
    for (const cell of manifest.cells) assert.equal(html.includes(cell.publicId), true);
    const outputPath = join(runDir, manifest.cells[0].outputPath);
    const before = sha256(await readFile(outputPath));
    const image = await fetch(`${base}/media/output/${manifest.cells[0].publicId}`);
    assert.equal(image.status, 200);
    const crop = await fetch(`${base}/media/crop/${manifest.cells[0].publicId}`);
    assert.equal(crop.status, 200);
    assert.equal(crop.headers.get("content-type"), "image/png");
    assert.equal(sha256(await readFile(outputPath)), before);
    const source = await fetch(`${base}/media/input/source-a`);
    assert.equal(source.status, 200);
    const missing = await fetch(`${base}/condition-map.json`);
    assert.equal(missing.status, 404);
    const early = await fetch(`${base}/?reveal=1`);
    assert.equal((await early.text()).includes("prompt-only"), false);
    for (const cell of manifest.cells) {
      const saved = await fetch(`${base}/api/judgements`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ publicId: cell.publicId, ...JUDGEMENT }),
      });
      assert.equal(saved.status, 200);
    }
    const revealed = await (await fetch(`${base}/?reveal=1`)).text();
    assert.equal(revealed.includes("prompt-only"), true);
    assert.equal(revealed.includes("Categorical counts"), true);
    assert.equal(revealed.includes("not a winner"), true);
    const download = await fetch(`${base}/api/judgements.json`);
    assert.equal(download.headers.get("content-disposition").includes("judgements.json"), true);
    const stored = JSON.parse(await readFile(join(runDir, "review", "judgements.json"), "utf8"));
    assert.equal(stored.cells[manifest.cells[0].publicId].overall, "acceptable");
    assert.equal(JSON.stringify(stored).includes("super-secret-token"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function reviewManifest(cells) {
  return {
    runId: "fake-smoke",
    mode: "fake",
    sameIdentityStatement: SAME_IDENTITY_STATEMENT,
    model: "gemini-3-pro-image-preview",
    aspectRatio: "4:5",
    timeoutMs: 58000,
    budgetBytes: 850000,
    strategy: "budgeted",
    planned: 12,
    attempted: 11,
    succeeded: 10,
    failed: 1,
    unattempted: 1,
    stopReason: null,
    attemptOrder: ATTEMPT_ORDER,
    inputs: {
      "source-a": { logicalId: "source-a", role: "identity", sha256: "c".repeat(64), mime: "image/jpeg", width: 640, height: 640 },
      "source-b": { logicalId: "source-b", role: "identity", sha256: "d".repeat(64), mime: "image/jpeg", width: 640, height: 640 },
      "style-reference": { logicalId: "style-reference", role: "style", sha256: "e".repeat(64), mime: "image/png", width: 928, height: 1152 },
    },
    cells,
  };
}
