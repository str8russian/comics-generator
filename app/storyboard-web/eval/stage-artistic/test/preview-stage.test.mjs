import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  defaultCandidatePath,
  framesForPreview,
  loadPreviewInputs,
  preparePreview,
  readPreviewJson,
  startPreview,
  stopPreview,
} from "../preview-stage.mjs";

const previewSource = readFileSync(new URL("../preview-stage.mjs", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../preview.js", import.meta.url), "utf8");
const candidateBytes = readFileSync(defaultCandidatePath);

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the preview process does not call fetch or read an environment file", async () => {
  assert.equal(previewSource.includes(".env.local"), false);
  assert.equal(previewSource.includes("process.env"), false);
  assert.equal(previewSource.includes("fetch("), false);
  assert.equal(previewSource.includes("writeFile"), false);
  assert.equal(pageSource.includes("chat/completions"), false);
  assert.match(pageSource, /fetch\("\/preview\.json"\)/);
  const fontsAt = pageSource.indexOf("await document.fonts.ready");
  const compileAt = pageSource.indexOf("compileOverflow(");
  assert.equal(fontsAt >= 0 && fontsAt < compileAt, true);
  let fetchCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("fetch called");
  };
  try {
    const inputs = loadPreviewInputs();
    const prepared = preparePreview(inputs);
    assert.equal(prepared.ok, true);
    const logs = [];
    const started = await startPreview(prepared.payload, (line) => logs.push(line));
    assert.equal(fetchCalls, 0);
    assert.match(logs[0], /^http:\/\/127\.0\.0\.1:\d+\/$/);
    await stopPreview(started.server);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(readFileSync(defaultCandidatePath), candidateBytes);
});

test("the default saved candidate path is used for dialogue from the fixture", () => {
  assert.equal(defaultCandidatePath.endsWith("/results/current-stage.candidate.json"), true);
  const inputs = loadPreviewInputs();
  assert.deepEqual(inputs.candidate, JSON.parse(candidateBytes.toString("utf8")));
  const prepared = preparePreview(inputs);
  assert.equal(prepared.ok, true);
  const byId = new Map(inputs.fixture.sourceItems.map((item) => [item.id, item]));
  assert.equal(prepared.payload.frames.length, 17);
  for (const frame of prepared.payload.frames) {
    const item = byId.get(frame.sourceItemId);
    if (frame.sourceRole === "utterance") {
      assert.equal(frame.dialogue, item.text);
      assert.equal(frame.dialogue.startsWith(`${item.speakerLabel}:`), false);
    }
    if (frame.sourceRole === "action") {
      assert.equal(frame.dialogue, "");
      assert.equal(frame.outsideFrameText, item.text);
    }
  }
  const poisoned = structuredClone(inputs.candidate);
  poisoned.frames[0] = { ...poisoned.frames[0], dialogue: "MODEL SAID THIS" };
  assert.equal(preparePreview({ ...inputs, candidate: poisoned }).ok, false);
  assert.equal(preparePreview({ ...inputs, candidate: poisoned }).kind, "schema");
  const ignored = framesForPreview(inputs.fixture, poisoned);
  assert.equal(ignored[0].dialogue, byId.get(poisoned.frames[0].sourceItemId).text);
  assert.equal(ignored[0].dialogue.includes("MODEL SAID THIS"), false);
});

test("schema or source-fidelity failure prevents preview readiness", () => {
  const inputs = loadPreviewInputs();
  const schema = preparePreview({
    ...inputs,
    candidate: { frames: [], review: [] },
  });
  assert.equal(schema.ok, false);
  assert.equal(schema.kind, "schema");
  assert.equal(schema.payload, undefined);

  const swapped = structuredClone(inputs.candidate);
  const first = swapped.frames.findIndex((frame) => frame.sourceItemId === "D07");
  const second = swapped.frames.findIndex((frame) => frame.sourceItemId === "D12");
  [swapped.frames[first], swapped.frames[second]] = [swapped.frames[second], swapped.frames[first]];
  const fidelity = preparePreview({ ...inputs, candidate: swapped });
  assert.equal(fidelity.ok, false);
  assert.equal(fidelity.kind, "source-fidelity");
  assert.equal(fidelity.payload, undefined);
});

test("the preview server binds to loopback, serves 17 semantic frames, and stops", async () => {
  const inputs = loadPreviewInputs();
  const prepared = preparePreview(inputs);
  const logs = [];
  const started = await startPreview(prepared.payload, (line) => logs.push(line));
  const address = started.server.address();
  try {
    assert.equal(address.address, "127.0.0.1");
    assert.equal(logs[0], started.url);
    assert.equal(started.url, `http://127.0.0.1:${address.port}/`);
    const page = await get(address.port, "/");
    assert.equal(page.status, 200);
    assert.match(page.body, /Offline preview of a saved Stage candidate/);
    assert.equal(page.body.includes("<textarea"), false);
    assert.equal(page.body.includes("/api/storyboard"), false);
    const preview = await get(address.port, "/preview.json");
    const payload = JSON.parse(preview.body);
    assert.equal(payload.status, "checked");
    assert.equal(payload.frames.length, 17);
    assert.deepEqual(payload.frames.map((frame) => frame.sourceItemId), inputs.candidate.frames.map((frame) => frame.sourceItemId));
    const renderer = await get(address.port, "/frame-renderer.mjs");
    assert.equal(renderer.status, 200);
    assert.match(renderer.body, /export function measureDialogue/);
    const overflow = await get(address.port, "/overflow.mjs");
    assert.equal(overflow.status, 200);
    assert.match(overflow.body, /export function compileOverflow/);
    const storyboard = await get(address.port, "/api/storyboard");
    assert.equal(storyboard.status, 404);
  } finally {
    await stopPreview(started.server);
  }
  assert.equal(started.server.address(), null);
  await assert.rejects(get(address.port, "/"));
  assert.deepEqual(readFileSync(defaultCandidatePath), candidateBytes);
});

test("a symlink to an environment file is refused before its contents are parsed", () => {
  const sentinel = "PREVIEW_ENV_SENTINEL_do_not_parse";
  const directory = mkdtempSync(join(tmpdir(), "stage-preview-"));
  const envPath = join(directory, ".env.local");
  const linkPath = join(directory, "candidate.json");
  try {
    writeFileSync(envPath, sentinel);
    symlinkSync(envPath, linkPath);
    assert.throws(() => readPreviewJson(pathToFileURL(linkPath)), (error) => {
      assert.match(error.message, /environment file/);
      assert.equal(error.message.includes(sentinel), false);
      assert.equal(String(error).includes("not JSON"), false);
      return true;
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(statSync(defaultCandidatePath).isFile(), true);
});
