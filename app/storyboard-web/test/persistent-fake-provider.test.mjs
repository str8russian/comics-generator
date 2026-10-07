import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import { interpretDraft } from "../interpret.mjs";
import { stageStoryboard } from "../stage.mjs";
import {
  PERSISTENT_DRAFT,
  startPersistentFakeProvider,
} from "./persistent-fake-provider.mjs";

const interpretSchema = JSON.parse(readFileSync(new URL("../../../specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json", import.meta.url), "utf8"));
const stageSchema = JSON.parse(readFileSync(new URL("../../../specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json", import.meta.url), "utf8"));

function compile(schema) {
  return new Ajv({ allErrors: true, strict: true }).compile(structuredClone(schema));
}

const validateInterpret = compile(interpretSchema);
const validateStage = compile(stageSchema);

function assistantContent(raw) {
  const payload = JSON.parse(raw);
  return JSON.parse(payload.choices[0].message.content);
}

function request(url, { method = "POST", path = "/v1/chat/completions", body } = {}) {
  const target = new URL(path, url);
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: payload == null ? {} : {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function fetchImpl(url, init) {
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1") {
    return Promise.reject(new Error("fake provider test refused a non-loopback request"));
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: init.method,
      headers: init.headers,
      signal: init.signal,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          async text() {
            return text;
          },
        });
      });
    });
    req.on("error", reject);
    if (init.body != null) req.write(init.body);
    req.end();
  });
}

test("persistent fake provider source does not read an env file, credentials, or every interface", () => {
  const source = readFileSync(new URL("./persistent-fake-provider.mjs", import.meta.url), "utf8");
  assert.equal(source.includes(".env.local"), false);
  assert.equal(source.includes("--env-file"), false);
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("CONTEST_API_TOKEN"), false);
  assert.equal(source.includes("dotenv"), false);
  assert.equal(source.includes("0.0.0.0"), false);
  assert.match(source, /127\.0\.0\.1/);
});

test("loopback fake counts one Interpret and one Stage, then rejects anything else", async () => {
  assert.equal(PERSISTENT_DRAFT.includes("Дмитрий Сергеевич"), true);
  assert.equal(PERSISTENT_DRAFT.includes("Песков"), true);
  const provider = await startPersistentFakeProvider();
  const seen = [];
  const env = {
    BASE_URL: provider.url,
    CONTEST_API_TOKEN: "placeholder-token",
    CONTEST_MODEL: "placeholder-model",
  };
  const recordingFetch = async (url, init) => {
    const response = await fetchImpl(url, init);
    const text = await response.text();
    seen.push(text);
    return {
      status: response.status,
      async text() {
        return text;
      },
    };
  };
  try {
    const address = provider.server.address();
    assert.equal(address.address, "127.0.0.1");
    assert.equal(provider.url, `http://127.0.0.1:${address.port}`);

    const otherPath = await request(provider.url, { path: "/v1/models", body: {} });
    assert.equal(otherPath.status, 404);
    const otherMethod = await request(provider.url, { method: "GET" });
    assert.equal(otherMethod.status, 404);
    assert.equal(provider.interpretCount, 0);
    assert.equal(provider.stageCount, 0);

    const interpreted = await interpretDraft({
      draft: PERSISTENT_DRAFT,
      env,
      fetchImpl: recordingFetch,
      acceptUnresolved: true,
    });
    assert.equal(interpreted.ok, true);
    assert.equal(provider.interpretCount, 1);
    assert.equal(provider.stageCount, 0);
    const interpretBody = assistantContent(seen[0]);
    assert.equal(validateInterpret(interpretBody), true, JSON.stringify(validateInterpret.errors));
    assert.equal(Array.isArray(interpretBody.sourceItems), true);
    assert.equal(Array.isArray(interpretBody.characters), true);
    assert.equal(Array.isArray(interpretBody.surfaceForms), true);
    assert.equal(interpretBody.characters.some((character) => character.name === "Песков"), true);
    assert.equal(interpretBody.surfaceForms.some((form) => form.quote === "Дмитрий Сергеевич"), true);
    assert.equal(interpretBody.sourceItems.some((item) => item.speakerStatus === "unresolved"), true);

    const staged = await stageStoryboard({
      draft: PERSISTENT_DRAFT,
      sourceItems: interpreted.sourceItems,
      env,
      fetchImpl: recordingFetch,
    });
    assert.equal(staged.ok, true);
    assert.equal(staged.body.status, "checked");
    assert.equal(provider.interpretCount, 1);
    assert.equal(provider.stageCount, 1);
    const stageBody = assistantContent(seen[1]);
    assert.equal(validateStage(stageBody), true, JSON.stringify(validateStage.errors));
    const spoken = staged.body.frames.find((frame) => frame.sourceItemId === "u1");
    assert.equal(spoken.dialogue.includes("Дмитрий Сергеевич"), true);

    const third = await request(provider.url, {
      body: { messages: [{ role: "user", content: "{\"sourceItems\":[]}" }] },
    });
    assert.equal(third.status, 409);
    assert.equal(provider.interpretCount, 1);
    assert.equal(provider.stageCount, 1);
  } finally {
    await new Promise((resolve, reject) => {
      provider.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
