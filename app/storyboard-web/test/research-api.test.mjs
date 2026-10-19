globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createServer, DEFAULT_MAX_BODY_BYTES } from "../server.mjs";

const schema = JSON.parse(readFileSync(
  new URL("../../../specs/009-research-workspace-dock/contracts/research-event.schema.json", import.meta.url),
  "utf8",
));

function nullContext(overrides = {}) {
  return {
    workflowPhase: null,
    storyboardVersionId: null,
    displayFrameNumber: null,
    displayFrameId: null,
    structureFrameId: null,
    structureSegmentIndex: null,
    panelIndex: null,
    panelSubject: null,
    imageAssetId: null,
    generationId: null,
    characterName: null,
    anchorVersionId: null,
    panelId: null,
    transitionMode: null,
    transitionOverlapFrames: null,
    introTemplateId: null,
    introTemplateVersion: null,
    ...overrides,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function send(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : body;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        ...headers,
        ...(payload == null ? {} : { "content-length": Buffer.byteLength(payload) }),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function json(value) {
  return JSON.stringify(value);
}

async function withServer(fn, { logger } = {}) {
  const { createResearchStore } = await import("../research-store.mjs");
  const researchStore = createResearchStore({ memory: true });
  const server = createServer({
    migrate: false,
    researchStore,
    projectStore: {
      async loadProject() {
        throw new Error("project store should not be required for research routes");
      },
    },
    visualStore: {
      async load() {
        throw new Error("visual store should not be required for research routes");
      },
    },
    logger: logger ?? { log() {} },
  });
  const port = await listen(server);
  try {
    return await fn({ port, researchStore, server });
  } finally {
    await close(server);
  }
}

function compileResearchEventValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(structuredClone(schema));
}

const validateResearchEvent = compileResearchEventValidator();

test("research-event schema compiles with Ajv Draft 2020-12 and formats (baseline)", () => {
  assert.equal(typeof validateResearchEvent, "function");
});

test("POST notes, POST events, GET trace with kind and surface filters", async () => {
  await withServer(async ({ port }) => {
    const note = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: json({ submittedText: "заметка", context: nullContext({ workflowPhase: "structure" }) }),
    });
    assert.equal(note.status, 201);
    const noteBody = JSON.parse(note.body);
    assert.equal(noteBody.event.eventKind, "note");
    assert.equal(noteBody.event.submittedText, "заметка");
    assert.equal(validateResearchEvent(noteBody.event), true, JSON.stringify(validateResearchEvent.errors));

    const correlationId = randomUUID();
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "structure_edit",
        correlationId,
        surface: "dock_commands",
        submittedText: "команда",
        commandTarget: { kind: "storyboard" },
        editTarget: null,
        context: nullContext({ workflowPhase: "structure" }),
      }),
    });
    assert.equal(start.status, 201);
    assert.equal(validateResearchEvent(JSON.parse(start.body).event), true, JSON.stringify(validateResearchEvent.errors));

    const terminal = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_terminal",
        correlationId,
        outcome: "success",
        outcomeFlags: {},
      }),
    });
    assert.equal(terminal.status, 201);
    assert.equal(validateResearchEvent(JSON.parse(terminal.body).event), true, JSON.stringify(validateResearchEvent.errors));

    const productNote = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: json({ submittedText: "ещё", context: nullContext() }),
    });
    assert.equal(productNote.status, 201);

    const all = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    assert.equal(all.status, 200);
    const allBody = JSON.parse(all.body);
    assert.ok(allBody.events.length >= 4);
    for (const event of allBody.events) {
      assert.equal(validateResearchEvent(event), true, JSON.stringify(validateResearchEvent.errors));
    }

    const notes = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?kind=note" });
    assert.equal(notes.status, 200);
    const notesBody = JSON.parse(notes.body);
    assert.ok(notesBody.events.every((event) => event.eventKind === "note"));
    assert.ok(notesBody.events.length >= 2);

    const commands = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?surface=dock_commands" });
    assert.equal(commands.status, 200);
    const commandsBody = JSON.parse(commands.body);
    assert.ok(commandsBody.events.every((event) => event.surface === "dock_commands"));
    assert.ok(commandsBody.events.length >= 2);
  });
});

test("protected-content rejects without echoing secret in body or logs", async () => {
  const secret = "Bearer eyJhbGciOiJIUzI1NiJ9.secret-payload.signature";
  const logs = [];
  await withServer(async ({ port }) => {
    const before = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    assert.equal(before.status, 200);
    const beforeCount = JSON.parse(before.body).events.length;

    const response = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: json({ submittedText: secret, context: nullContext() }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "protected-content" });
    const captured = [...logs, response.body].join("\n");
    assert.equal(captured.includes(secret), false);
    assert.equal(captured.includes("eyJhbGciOiJIUzI1NiJ9"), false);

    const after = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    assert.equal(after.status, 200);
    assert.equal(JSON.parse(after.body).events.length, beforeCount);
  }, { logger: { log(line) { logs.push(String(line)); } } });
});

test("HTTP cast_edit requires product_control surface and schema-validates accepted events", async () => {
  await withServer(async ({ port }) => {
    const before = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    assert.equal(before.status, 200);
    const beforeCount = JSON.parse(before.body).events.length;

    const invalid = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "cast_edit",
        correlationId: randomUUID(),
        surface: "dock_commands",
        submittedText: "А",
        commandTarget: null,
        editTarget: {
          editKind: "character_rename",
          castPhase: "pending_reading",
          characterName: "А",
          previousCharacterName: "Б",
          surfaceForm: null,
          sourceItemId: null,
        },
        context: nullContext({ workflowPhase: "material" }),
      }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(JSON.parse(invalid.body), { status: "failed", kind: "invalid-request" });
    const afterInvalid = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    assert.equal(JSON.parse(afterInvalid.body).events.length, beforeCount);

    const correlationId = randomUUID();
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "cast_edit",
        correlationId,
        surface: "product_control",
        submittedText: "А",
        commandTarget: null,
        editTarget: {
          editKind: "character_rename",
          castPhase: "pending_reading",
          characterName: "А",
          previousCharacterName: "Б",
          surfaceForm: null,
          sourceItemId: null,
        },
        context: nullContext({ workflowPhase: "material" }),
      }),
    });
    assert.equal(start.status, 201, start.body);
    assert.equal(validateResearchEvent(JSON.parse(start.body).event), true, JSON.stringify(validateResearchEvent.errors));

    const terminal = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_terminal",
        correlationId,
        outcome: "success",
        outcomeFlags: {},
      }),
    });
    assert.equal(terminal.status, 201, terminal.body);
    assert.equal(validateResearchEvent(JSON.parse(terminal.body).event), true, JSON.stringify(validateResearchEvent.errors));
  });
});

test("HTTP outcomeKind rejects secret-like values without echo", async () => {
  const secret = "Bearer fake-secret-token-value";
  const logs = [];
  await withServer(async ({ port }) => {
    const correlationId = randomUUID();
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "structure_edit",
        correlationId,
        surface: "product_control",
        submittedText: null,
        commandTarget: { kind: "storyboard" },
        editTarget: null,
        context: nullContext({ workflowPhase: "structure" }),
      }),
    });
    assert.equal(start.status, 201);
    const response = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_terminal",
        correlationId,
        outcome: "failure",
        outcomeKind: secret,
        outcomeFlags: {},
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-request" });
    const captured = [...logs, response.body].join("\n");
    assert.equal(captured.includes(secret), false);
  }, { logger: { log(line) { logs.push(String(line)); } } });
});

test("forbidden object keys are invalid-request", async () => {
  await withServer(async ({ port }) => {
    const response = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: json({
        submittedText: "ok",
        context: nullContext(),
        imageBytes: "not-allowed",
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-request" });
  });
});

test("ordinary invalid request is invalid-request", async () => {
  await withServer(async ({ port }) => {
    const response = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({ eventKind: "not-a-kind", correlationId: randomUUID() }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-request" });
  });
});

test("genuinely oversized research body returns empty 413", async () => {
  await withServer(async ({ port }) => {
    const response = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(DEFAULT_MAX_BODY_BYTES + 1, 0x61),
    });
    assert.equal(response.status, 413);
    assert.equal(response.body, "");
  });
});

test("reading submittedText longer than 8000 is accepted within DEFAULT_MAX_BODY_BYTES without truncation", async () => {
  const longText = "Я".repeat(9000);
  assert.ok(longText.length > 8000);
  await withServer(async ({ port }) => {
    const correlationId = randomUUID();
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "reading",
        correlationId,
        surface: "product_control",
        submittedText: longText,
        commandTarget: null,
        editTarget: null,
        context: nullContext({ workflowPhase: "draft" }),
      }),
    });
    assert.equal(start.status, 201, start.body);
    const body = JSON.parse(start.body);
    assert.equal(body.event.submittedText, longText);
    assert.equal(body.event.submittedText.length, 9000);
  });
});

test("operational logLine never includes research submittedText", async () => {
  const marker = "УНИКАЛЬНЫЙ-ТЕКСТ-ИССЛЕДОВАНИЯ-009";
  const logs = [];
  await withServer(async ({ port }) => {
    const response = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: json({ submittedText: marker, context: nullContext() }),
    });
    assert.equal(response.status, 201);
    const captured = logs.join("\n");
    assert.equal(captured.includes(marker), false);
    assert.match(captured, /event=research-note/);
  }, { logger: { log(line) { logs.push(String(line)); } } });
});

test("T023 baseline: HTTP terminal derive-from-start, duplicate rejection, unmatched start extractable", async () => {
  await withServer(async ({ port }) => {
    const correlationId = randomUUID();
    const startContext = nullContext({
      workflowPhase: "structure",
      displayFrameNumber: 1,
      displayFrameId: "d1",
      structureFrameId: "s1",
      structureSegmentIndex: 0,
    });
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "structure_edit",
        correlationId,
        surface: "product_control",
        submittedText: "исходная правка",
        commandTarget: { kind: "storyboard" },
        editTarget: null,
        context: startContext,
      }),
    });
    assert.equal(start.status, 201);
    assert.equal(validateResearchEvent(JSON.parse(start.body).event), true);

    const unmatchedId = randomUUID();
    const unmatched = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "visual_approve",
        correlationId: unmatchedId,
        surface: "product_control",
        submittedText: null,
        commandTarget: { kind: "storyboard" },
        editTarget: null,
        context: nullContext({ workflowPhase: "visual" }),
      }),
    });
    assert.equal(unmatched.status, 201);

    const terminal = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_terminal",
        correlationId,
        semanticAction: "panel_generate",
        surface: "dock_commands",
        submittedText: "rewrite after navigation",
        commandTarget: { kind: "panel" },
        context: nullContext({ displayFrameId: "later" }),
        outcome: "success",
        outcomeFlags: {},
      }),
    });
    assert.equal(terminal.status, 201);
    const terminalEvent = JSON.parse(terminal.body).event;
    assert.equal(validateResearchEvent(terminalEvent), true);
    assert.equal(terminalEvent.semanticAction, "structure_edit");
    assert.equal(terminalEvent.surface, "product_control");
    assert.equal(terminalEvent.submittedText, "исходная правка");
    assert.equal(terminalEvent.commandTarget.kind, "storyboard");
    assert.deepEqual(terminalEvent.context, startContext);
    assert.equal(typeof terminalEvent.durationMs, "number");

    const dupStart = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "structure_edit",
        correlationId,
        surface: "product_control",
        submittedText: "dup",
        commandTarget: { kind: "storyboard" },
        editTarget: null,
        context: startContext,
      }),
    });
    assert.equal(dupStart.status, 400);

    const dupTerminal = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_terminal",
        correlationId,
        outcome: "failure",
        outcomeFlags: {},
      }),
    });
    assert.equal(dupTerminal.status, 400);

    const trace = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    assert.equal(trace.status, 200);
    const events = JSON.parse(trace.body).events;
    for (const event of events) {
      assert.equal(validateResearchEvent(event), true, JSON.stringify(validateResearchEvent.errors));
      assert.equal(Object.hasOwn(event, "imageDataUrl"), false);
      assert.equal(Object.hasOwn(event, "performanceImageDataUrl"), false);
    }
    assert.ok(events.some((event) => (
      event.eventKind === "action_start" && event.correlationId === unmatchedId
    )));
    assert.equal(events.some((event) => (
      event.eventKind === "action_terminal" && event.correlationId === unmatchedId
    )), false);
    const seqs = events.map((event) => event.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  });
});

test("T027 protected-content canaries reject notes and action starts without echo or row growth", async () => {
  const canaries = [
    {
      label: "bearer",
      text: "Bearer eyJhbGciOiJIUzI1NiJ9.t027-secret-payload.signature",
      substring: "t027-secret-payload",
    },
    {
      label: "authorization",
      text: "Authorization: Bearer t027-auth-token-value",
      substring: "t027-auth-token-value",
    },
    {
      label: "dsn",
      text: "postgres://comics:t027-db-password@127.0.0.1:5432/comics",
      substring: "t027-db-password",
    },
    {
      label: "sensitive-query",
      text: "https://example.test/callback?access_token=t027-query-leak&ok=1",
      substring: "t027-query-leak",
    },
    {
      label: "data-base64",
      text: "data:image/png;base64,t027IMAGEBYTESAAAA",
      substring: "t027IMAGEBYTESAAAA",
    },
  ];

  for (const canary of canaries) {
    for (const route of ["notes", "events"]) {
      const logs = [];
      await withServer(async ({ port }) => {
        const before = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
        assert.equal(before.status, 200);
        const beforeCount = JSON.parse(before.body).events.length;

        const body = route === "notes"
          ? { submittedText: canary.text, context: nullContext() }
          : {
            eventKind: "action_start",
            semanticAction: "structure_edit",
            correlationId: randomUUID(),
            surface: "product_control",
            submittedText: canary.text,
            commandTarget: { kind: "storyboard" },
            editTarget: null,
            context: nullContext({ workflowPhase: "structure" }),
          };
        const response = await send(port, {
          method: "POST",
          path: route === "notes" ? "/api/projects/00000000-0000-4000-8000-000000000001/research/notes" : "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
          headers: { "content-type": "application/json" },
          body: json(body),
        });
        assert.equal(response.status, 400, `${canary.label}/${route}`);
        assert.deepEqual(
          JSON.parse(response.body),
          { status: "failed", kind: "protected-content" },
          `${canary.label}/${route}`,
        );
        const captured = [...logs, response.body].join("\n");
        assert.equal(captured.includes(canary.text), false, `${canary.label}/${route} full`);
        assert.equal(captured.includes(canary.substring), false, `${canary.label}/${route} substring`);

        const after = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
        assert.equal(after.status, 200);
        assert.equal(JSON.parse(after.body).events.length, beforeCount, `${canary.label}/${route} rows`);
      }, { logger: { log(line) { logs.push(String(line)); } } });
    }
  }
});

test("T027 nested forbidden keys are rejected at depth without persistence", async () => {
  const nestedKeys = [
    { imageBytes: "not-allowed" },
    { providerResponse: { raw: "x" } },
    { wrapper: { requestBody: { instruction: "x" } } },
    { wrapper: { authorization: "Bearer nested-secret" } },
    { wrapper: { performanceImageDataUrl: "data:image/png;base64,AAA" } },
  ];
  for (const nested of nestedKeys) {
    await withServer(async ({ port }) => {
      const before = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
      const beforeCount = JSON.parse(before.body).events.length;
      const response = await send(port, {
        method: "POST",
        path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
        headers: { "content-type": "application/json" },
        body: json({
          submittedText: "обычная заметка",
          context: nullContext(),
          ...nested,
        }),
      });
      assert.equal(response.status, 400, JSON.stringify(nested));
      assert.deepEqual(JSON.parse(response.body), { status: "failed", kind: "invalid-request" });
      const after = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
      assert.equal(JSON.parse(after.body).events.length, beforeCount);
    });
  }
});

test("T027 ordinary owner prose persists byte-for-byte on notes and starts", async () => {
  const prose = "Обычная заметка владельца: кадр 2 слабее структуры.\nВторая строка.";
  await withServer(async ({ port }) => {
    const note = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/notes",
      headers: { "content-type": "application/json" },
      body: json({ submittedText: prose, context: nullContext({ workflowPhase: "structure" }) }),
    });
    assert.equal(note.status, 201);
    assert.equal(JSON.parse(note.body).event.submittedText, prose);

    const correlationId = randomUUID();
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "structure_edit",
        correlationId,
        surface: "product_control",
        submittedText: prose,
        commandTarget: { kind: "storyboard" },
        editTarget: null,
        context: nullContext({ workflowPhase: "structure" }),
      }),
    });
    assert.equal(start.status, 201);
    assert.equal(JSON.parse(start.body).event.submittedText, prose);

    const trace = await send(port, { path: "/api/projects/00000000-0000-4000-8000-000000000001/research/trace" });
    const events = JSON.parse(trace.body).events;
    assert.ok(events.some((event) => event.eventKind === "note" && event.submittedText === prose));
    assert.ok(events.some((event) => (
      event.eventKind === "action_start"
      && event.correlationId === correlationId
      && event.submittedText === prose
    )));
  });
});

test("UI dock panel action_start without commandTarget.panelSubject is accepted by store and Ajv-valid", async () => {
  const { createEmptyCommandTarget, createEmptyContext } = await import("../public/research-dock.mjs");
  const commandTarget = createEmptyCommandTarget("panel", {
    displayFrameNumber: 12,
    displayFrameId: "disp-12",
    structureFrameId: "struct-9",
    structureSegmentIndex: 0,
    panelIndex: 1,
    panelSubject: "Дуров",
  });
  assert.equal(Object.hasOwn(commandTarget, "panelSubject"), false);

  const context = createEmptyContext({
    workflowPhase: "visual",
    displayFrameNumber: 12,
    displayFrameId: "disp-12",
    structureFrameId: "struct-9",
    structureSegmentIndex: 0,
    panelIndex: 1,
    panelSubject: "Дуров",
  });
  assert.equal(context.panelSubject, "Дуров");

  await withServer(async ({ port }) => {
    const correlationId = randomUUID();
    const start = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "panel_generate",
        correlationId,
        surface: "dock_commands",
        submittedText: "переделай панель",
        commandTarget,
        editTarget: null,
        context,
      }),
    });
    assert.equal(start.status, 201, start.body);
    const event = JSON.parse(start.body).event;
    assert.equal(Object.hasOwn(event.commandTarget, "panelSubject"), false);
    assert.equal(event.context.panelSubject, "Дуров");
    assert.equal(validateResearchEvent(event), true, JSON.stringify(validateResearchEvent.errors));

    const storyboardTarget = createEmptyCommandTarget("storyboard");
    assert.equal(Object.hasOwn(storyboardTarget, "panelSubject"), false);
    const productStart = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000001/research/events",
      headers: { "content-type": "application/json" },
      body: json({
        eventKind: "action_start",
        semanticAction: "structure_edit",
        correlationId: randomUUID(),
        surface: "product_control",
        submittedText: "правка структуры",
        commandTarget: storyboardTarget,
        editTarget: null,
        context: nullContext({ workflowPhase: "structure" }),
      }),
    });
    assert.equal(productStart.status, 201, productStart.body);
    const productEvent = JSON.parse(productStart.body).event;
    assert.equal(Object.hasOwn(productEvent.commandTarget, "panelSubject"), false);
    assert.equal(validateResearchEvent(productEvent), true, JSON.stringify(validateResearchEvent.errors));
  });
});
