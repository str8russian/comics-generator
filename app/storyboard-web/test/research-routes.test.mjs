import assert from "node:assert/strict";
import test from "node:test";
import { SEEDED_PROJECT_ID, withProject } from "../project-scope.mjs";
import { routeResearch } from "../research-routes.mjs";

function decliningDeps() {
  return {
    maxBodyBytes: 10,
    logger: { log() { throw new Error("logger called"); } },
    nextRequest() { throw new Error("request serial allocated"); },
    runtime: {
      researchStore: {
        appendNote() { throw new Error("research store called"); },
        appendEvent() { throw new Error("research store called"); },
        listTrace() { throw new Error("research store called"); },
      },
    },
    sendEmpty() { throw new Error("sendEmpty called"); },
    sendJson() { throw new Error("sendJson called"); },
    readJsonBody() { throw new Error("readJsonBody called"); },
    logLine() { throw new Error("logLine called"); },
  };
}

test("research router declines an unrelated path without consuming the request or responding", async () => {
  let consumed = false;
  const req = {
    method: "POST",
    url: "/api/storyboard",
    resume() { consumed = true; },
    on() { consumed = true; },
  };
  const res = {
    writeHead() { throw new Error("response started"); },
    end() { throw new Error("response started"); },
    headersSent: false,
  };
  const handled = await routeResearch(req, res, "/api/draft", decliningDeps());
  assert.equal(handled, false);
  assert.equal(consumed, false);
  assert.equal(res.headersSent, false);
});

test("research notes keep the server-owned project id and one operational log record", async () => {
  const forged = "00000000-0000-4000-8000-000000000099";
  const submittedText = "owner note that must stay out of the log";
  const calls = [];
  const logs = [];
  let serials = 0;
  let status;
  let payload;
  const req = {
    method: "POST",
    url: `/api/projects/${SEEDED_PROJECT_ID}/research/notes`,
    resume() { throw new Error("request resumed"); },
  };
  const res = {};
  const handled = await withProject(SEEDED_PROJECT_ID, () => routeResearch(req, res, "/api/research/notes", {
    maxBodyBytes: 262144,
    logger: { log() {} },
    nextRequest() {
      serials += 1;
      return String(serials);
    },
    runtime: {
      researchStore: {
        async appendNote(input) {
          calls.push(input);
          return { ok: true, event: { id: "note-1", eventKind: "note" } };
        },
      },
    },
    sendEmpty() { throw new Error("sendEmpty called"); },
    sendJson(_res, responseStatus, body) {
      status = responseStatus;
      payload = body;
    },
    async readJsonBody() {
      return {
        done: false,
        payload: { submittedText, projectId: forged, context: { workflowPhase: null } },
      };
    },
    logLine(_logger, fields) {
      logs.push(fields);
    },
  }));
  assert.equal(handled, true);
  assert.equal(serials, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectId, SEEDED_PROJECT_ID);
  assert.equal(calls[0].submittedText, submittedText);
  assert.equal(status, 201);
  assert.deepEqual(payload, { event: { id: "note-1", eventKind: "note" } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].request, "1");
  assert.equal(logs[0].event, "research-note");
  assert.equal(logs[0].status, "ok");
  assert.equal(logs[0].http, 201);
  const captured = JSON.stringify(logs);
  assert.equal(captured.includes(submittedText), false);
  assert.equal(captured.includes(forged), false);
});
