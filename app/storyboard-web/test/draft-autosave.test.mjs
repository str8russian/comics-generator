import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "../server.mjs";
import { bindDraftAutosave } from "../public/draft-autosave.mjs";

const startText = "ЧЕРНОВИК-СТАРТ-550";
const debouncedAway = "ЧЕРНОВИК-РАННИЙ-551";
const firstSent = "ЧЕРНОВИК-ПЕРВЫЙ-552";
const intermediate = "ЧЕРНОВИК-ПРОМЕЖУТОЧНЫЙ-553";
const newest = "ЧЕРНОВИК-НОВЕЙШИЙ-554";
const localConflict = "ЧЕРНОВИК-ЛОКАЛЬНЫЙ-555";
const storedConflict = "ЧЕРНОВИК-СОХРАНЁННЫЙ-556";
const keepLocal = "ЧЕРНОВИК-ОСТАВИТЬ-557";
const initialToken = "11111111-1111-4111-8111-111111111111";

function createElement() {
  const listeners = new Map();
  return {
    hidden: false,
    textContent: "",
    value: "",
    dataset: {},
    style: {},
    className: "",
    disabled: false,
    children: [],
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    replaceChildren() {
      this.children = [];
    },
    append(node) {
      this.children.push(node);
    },
  };
}

function installDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], createElement());
  }
  const body = createElement();
  globalThis.document = {
    body,
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      return elements.get(selector.slice(1)) ?? null;
    },
    createElement,
  };
  return elements;
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

function waitFor(predicate, delay, attempts = 50) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      if (predicate()) {
        resolve();
        return;
      }
      if (remaining <= 0) {
        reject(new Error("timed out waiting for the page"));
        return;
      }
      delay(() => check(remaining - 1), 10);
    };
    check(attempts);
  });
}

function httpRequest(port, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: payload == null ? {} : {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

test("page textarea coalesces one save and keeps local text through a stale conflict", async () => {
  const autosaveModule = await import("../public/draft-autosave.mjs");
  assert.equal(typeof autosaveModule.bindDraftAutosave, "function");

  const state = { text: startText, token: initialToken };
  let conflictsRemaining = 0;
  let releaseFirst = null;
  let firstSave = true;
  const savedTexts = [];
  const projectStore = {
    async loadProject() {
      return {
        draft: { text: state.text, revisionToken: state.token },
        activeSourceRevisionId: null,
        activeMaterialStateId: null,
        reading: null,
        sourceRevisions: [],
        storyboards: [],
      };
    },
    async saveDraft({ text, revisionToken }) {
      savedTexts.push(text);
      if (firstSave) {
        firstSave = false;
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      if (conflictsRemaining > 0) {
        conflictsRemaining -= 1;
        return { ok: false, httpStatus: 409, kind: "stale-draft" };
      }
      if (revisionToken !== state.token) {
        return { ok: false, httpStatus: 409, kind: "stale-draft" };
      }
      state.text = text;
      state.token = randomUUID();
      return { ok: true, httpStatus: 200, revisionToken: state.token };
    },
  };
  const logs = [];
  const server = createServer({
    migrate: false,
    projectStore,
    logger: { log(line) { logs.push(String(line)); } },
  });
  const pendingTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const responseTexts = [];
  const requests = [];
  let port;
  try {
    port = await listen(server);
    installDocument(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"));
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      const body = init.body == null ? null : JSON.parse(init.body);
      requests.push({ path, method: init.method ?? "GET", body });
      const response = await httpRequest(port, { method: init.method ?? "GET", path, body });
      responseTexts.push(response.text);
      return {
        status: response.status,
        async json() {
          return JSON.parse(response.text);
        },
      };
    };
    globalThis.setTimeout = (fn, ms) => {
      const handle = { fn, ms };
      pendingTimers.push(handle);
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      const index = pendingTimers.indexOf(handle);
      if (index >= 0) pendingTimers.splice(index, 1);
    };
    const registration = register(new URL("./draft-page-loader.mjs", import.meta.url));
    if (registration?.then) await registration;
    const page = await import("../public/app.js");
    await page.draftAutosave.ready;

    const textarea = document.querySelector("#draft");
    const conflict = document.querySelector("#draft-conflict");
    const reloadButton = document.querySelector("#reload-draft");
    const keepButton = document.querySelector("#keep-draft");
    assert.equal(textarea.value, startText);
    assert.equal(conflict.hidden, true);

    textarea.value = debouncedAway;
    textarea.dispatchEvent({ type: "input" });
    textarea.value = firstSent;
    textarea.dispatchEvent({ type: "input" });
    assert.equal(pendingTimers.length, 1);
    assert.equal(pendingTimers[0].ms, 400);
    pendingTimers.splice(0).forEach((handle) => handle.fn());
    await waitFor(() => releaseFirst != null, originalSetTimeout);
    assert.equal(savedTexts.length, 1);
    assert.equal(savedTexts[0], firstSent);

    textarea.value = intermediate;
    textarea.dispatchEvent({ type: "input" });
    textarea.value = newest;
    textarea.dispatchEvent({ type: "input" });
    assert.deepEqual(savedTexts, [firstSent]);
    releaseFirst();
    await waitFor(() => savedTexts.length === 2, originalSetTimeout);
    assert.deepEqual(savedTexts, [firstSent, newest]);
    assert.equal(requests.filter((request) => request.path === "/api/draft").every((request) => request.body.text !== intermediate), true);
    assert.equal(requests.filter((request) => request.path === "/api/draft").every((request) => request.body.text !== debouncedAway), true);
    assert.equal(requests.some((request) => request.path === "/api/storyboard"), false);

    conflictsRemaining = 1;
    const beforeConflict = requests.length;
    textarea.value = localConflict;
    textarea.dispatchEvent({ type: "input" });
    pendingTimers.splice(0).forEach((handle) => handle.fn());
    await waitFor(() => conflict.hidden === false, originalSetTimeout);
    assert.equal(textarea.value, localConflict);
    assert.equal(conflict.hidden, false);
    assert.equal(reloadButton.hidden, false);
    assert.equal(keepButton.hidden, false);
    assert.equal(requests.length, beforeConflict + 1);
    textarea.value = `${localConflict}-ещё`;
    textarea.dispatchEvent({ type: "input" });
    pendingTimers.splice(0).forEach((handle) => handle.fn());
    await waitFor(() => requests.length === beforeConflict + 1, originalSetTimeout);
    assert.equal(requests.length, beforeConflict + 1);
    assert.equal(textarea.value, `${localConflict}-ещё`);

    const conflictBodies = responseTexts.filter((text) => text.includes("stale-draft"));
    assert.equal(conflictBodies.length > 0, true);
    for (const body of conflictBodies) {
      assert.deepEqual(JSON.parse(body), { status: "failed", kind: "stale-draft" });
    }
    state.text = storedConflict;
    reloadButton.dispatchEvent({ type: "click" });
    await waitFor(() => textarea.value === storedConflict, originalSetTimeout);
    assert.equal(textarea.value, storedConflict);
    assert.equal(conflict.hidden, true);

    conflictsRemaining = 1;
    textarea.value = keepLocal;
    textarea.dispatchEvent({ type: "input" });
    pendingTimers.splice(0).forEach((handle) => handle.fn());
    await waitFor(() => conflict.hidden === false && textarea.value === keepLocal, originalSetTimeout);
    assert.equal(textarea.value, keepLocal);
    const putsBeforeKeep = requests.filter((request) => request.method === "PUT").length;
    const tokenForKeep = state.token;
    keepButton.dispatchEvent({ type: "click" });
    await waitFor(() => requests.filter((request) => request.method === "PUT").length === putsBeforeKeep + 1, originalSetTimeout);
    const keepPuts = requests.filter((request) => request.method === "PUT").slice(putsBeforeKeep);
    assert.equal(keepPuts.length, 1);
    assert.equal(keepPuts[0].body.text, keepLocal);
    assert.equal(keepPuts[0].body.revisionToken, tokenForKeep);
    assert.equal(textarea.value, keepLocal);
    assert.equal(textarea.value === storedConflict, false);

    const captured = [...logs, ...conflictBodies, conflict.textContent].join("\n");
    for (const secret of [localConflict, storedConflict, keepLocal, newest, intermediate, firstSent, initialToken]) {
      assert.equal(captured.includes(secret), false, secret);
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (port != null) await close(server);
  }
});

const tokenReady = "22222222-2222-4222-8222-222222222222";
const tokenFromGet = "33333333-3333-4333-8333-333333333333";
const tokenSaved = "44444444-4444-4444-8444-444444444444";

function projectDocument(text, revisionToken) {
  return {
    draft: { text, revisionToken },
    activeSourceRevisionId: null,
    activeMaterialStateId: null,
    reading: null,
    sourceRevisions: [],
    storyboards: [],
  };
}

function jsonResponse(status, payload) {
  return {
    status,
    async json() {
      return payload;
    },
  };
}

function fakeTimers() {
  const pending = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const handle = { fn, ms };
    pending.push(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    const index = pending.indexOf(handle);
    if (index >= 0) pending.splice(index, 1);
  };
  return {
    flush() {
      const batch = pending.splice(0);
      for (const handle of batch) handle.fn();
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
    delay: originalSetTimeout,
  };
}

function resolutionControls() {
  const textarea = createElement();
  const conflict = createElement();
  const reloadButton = createElement();
  const keepButton = createElement();
  return { textarea, conflict, reloadButton, keepButton };
}

function assertLocked(controls) {
  assert.equal(controls.textarea.disabled, true);
  assert.equal(controls.reloadButton.disabled, true);
  assert.equal(controls.keepButton.disabled, true);
}

function assertUnlockedConflict(controls, text) {
  assert.equal(controls.textarea.disabled, false);
  assert.equal(controls.reloadButton.disabled, false);
  assert.equal(controls.keepButton.disabled, false);
  assert.equal(controls.conflict.hidden, false);
  assert.equal(controls.textarea.value, text);
}

async function trackRejections(run) {
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on("unhandledRejection", onRejection);
  try {
    await run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
}

test("keep local locks resolution and saves the text visible at the click", async () => {
  const timers = fakeTimers();
  const calls = [];
  let releaseGet;
  const heldGet = new Promise((resolve) => {
    releaseGet = resolve;
  });
  let phase = "boot";
  const controls = resolutionControls();
  const startedText = "ТЕКСТ-В-МОМЕНТ-НАЖАТИЯ";
  const editedDuring = "ТЕКСТ-ВО-ВРЕМЯ-ЗАПРОСА";
  try {
    const autosave = bindDraftAutosave({
      ...controls,
      fetchImpl: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        const body = init.body == null ? null : JSON.parse(String(init.body));
        calls.push({ method, body });
        if (phase === "boot") return jsonResponse(200, projectDocument("сервер", tokenReady));
        if (phase === "conflict-save") return jsonResponse(409, { status: "failed", kind: "stale-draft" });
        if (phase === "hold-get") return heldGet;
        if (phase === "keep-put") {
          return jsonResponse(200, { revisionToken: tokenSaved });
        }
        if (phase === "after") return jsonResponse(200, { revisionToken: "55555555-5555-4555-8555-555555555555" });
        throw new Error(`unexpected ${method}`);
      },
    });
    await autosave.ready;
    phase = "conflict-save";
    controls.textarea.value = "вызовет-конфликт";
    controls.textarea.dispatchEvent({ type: "input" });
    timers.flush();
    await waitFor(() => controls.conflict.hidden === false, timers.delay);
    controls.textarea.value = startedText;
    phase = "hold-get";
    const callsBefore = calls.length;
    controls.keepButton.dispatchEvent({ type: "click" });
    assertLocked(controls);
    controls.textarea.value = editedDuring;
    controls.keepButton.dispatchEvent({ type: "click" });
    controls.reloadButton.dispatchEvent({ type: "click" });
    assert.equal(calls.length, callsBefore + 1);
    assert.equal(calls.at(-1).method, "GET");
    phase = "keep-put";
    releaseGet(jsonResponse(200, projectDocument("ЧУЖОЙ-ЧЕРНОВИК", tokenFromGet)));
    await waitFor(() => calls.some((call) => call.method === "PUT" && call.body?.text === startedText), timers.delay);
    const keepPut = calls.find((call) => call.method === "PUT" && call.body?.text === startedText);
    assert.equal(keepPut.body.revisionToken, tokenFromGet);
    assert.equal(calls.filter((call) => call.method === "PUT" && call.body?.text === editedDuring).length, 0);
    await waitFor(() => controls.conflict.hidden === true && controls.textarea.disabled === false, timers.delay);
    assert.equal(controls.reloadButton.disabled, false);
    assert.equal(controls.keepButton.disabled, false);
    phase = "after";
    controls.textarea.value = "ПОСЛЕ-УСПЕХА";
    controls.textarea.dispatchEvent({ type: "input" });
    timers.flush();
    await waitFor(() => calls.some((call) => call.body?.text === "ПОСЛЕ-УСПЕХА"), timers.delay);
    const followUp = calls.find((call) => call.body?.text === "ПОСЛЕ-УСПЕХА");
    assert.equal(followUp.body.revisionToken, tokenSaved);
  } finally {
    timers.restore();
  }
});

test("reload replaces the textarea only after its GET succeeds", async () => {
  const timers = fakeTimers();
  const calls = [];
  let releaseGet;
  const heldGet = new Promise((resolve) => {
    releaseGet = resolve;
  });
  let phase = "boot";
  const controls = resolutionControls();
  const localText = "ЛОКАЛЬНЫЙ-ДО-ЗАГРУЗКИ";
  const storedText = "СОХРАНЁННЫЙ-ПОСЛЕ-GET";
  try {
    const autosave = bindDraftAutosave({
      ...controls,
      fetchImpl: async (_url, init = {}) => {
        const method = init.method ?? "GET";
        const body = init.body == null ? null : JSON.parse(String(init.body));
        calls.push({ method, body });
        if (phase === "boot") return jsonResponse(200, projectDocument("сервер", tokenReady));
        if (phase === "conflict-save") return jsonResponse(409, { status: "failed", kind: "stale-draft" });
        if (phase === "hold-get") return heldGet;
        if (phase === "after") return jsonResponse(200, { revisionToken: tokenSaved });
        throw new Error(`unexpected ${method}`);
      },
    });
    await autosave.ready;
    phase = "conflict-save";
    controls.textarea.value = localText;
    controls.textarea.dispatchEvent({ type: "input" });
    timers.flush();
    await waitFor(() => controls.conflict.hidden === false, timers.delay);
    phase = "hold-get";
    const callsBefore = calls.length;
    controls.reloadButton.dispatchEvent({ type: "click" });
    assertLocked(controls);
    assert.equal(controls.textarea.value, localText);
    controls.reloadButton.dispatchEvent({ type: "click" });
    controls.keepButton.dispatchEvent({ type: "click" });
    assert.equal(calls.length, callsBefore + 1);
    assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
    releaseGet(jsonResponse(200, projectDocument(storedText, tokenFromGet)));
    await waitFor(() => controls.textarea.value === storedText, timers.delay);
    assert.equal(controls.conflict.hidden, true);
    assert.equal(controls.textarea.disabled, false);
    assert.equal(controls.reloadButton.disabled, false);
    assert.equal(controls.keepButton.disabled, false);
    phase = "after";
    controls.textarea.value = "ПОСЛЕ-ЗАГРУЗКИ";
    controls.textarea.dispatchEvent({ type: "input" });
    timers.flush();
    await waitFor(() => calls.some((call) => call.body?.text === "ПОСЛЕ-ЗАГРУЗКИ"), timers.delay);
    assert.equal(calls.find((call) => call.body?.text === "ПОСЛЕ-ЗАГРУЗКИ").body.revisionToken, tokenFromGet);
  } finally {
    timers.restore();
  }
});

test("a failed resolution preserves local text and does not reject", async () => {
  const timers = fakeTimers();
  try {
    await trackRejections(async () => {
      let resolutionCalls = 0;
      const failing = resolutionControls();
      let mode = "boot";
      const autosave = bindDraftAutosave({
        ...failing,
        fetchImpl: async (_url, init = {}) => {
          const method = init.method ?? "GET";
          const body = init.body == null ? null : JSON.parse(String(init.body));
          if (mode === "boot") return jsonResponse(200, projectDocument("сервер", tokenReady));
          if (mode === "conflict-save") return jsonResponse(409, { status: "failed", kind: "stale-draft" });
          resolutionCalls += 1;
          if (mode === "throw-get") throw new Error("socket closed");
          if (mode === "bad-get") return jsonResponse(200, { draft: { text: 5, revisionToken: tokenFromGet } });
          if (mode === "bad-put" && method === "GET") return jsonResponse(200, projectDocument("сервер", tokenFromGet));
          if (mode === "bad-put") return jsonResponse(500, { status: "failed", kind: "database" });
          throw new Error(`unexpected ${method} ${body?.text}`);
        },
      });
      await autosave.ready;
      mode = "conflict-save";
      failing.textarea.value = "ЛОКАЛЬНЫЙ-СБОЙ";
      failing.textarea.dispatchEvent({ type: "input" });
      timers.flush();
      await waitFor(() => failing.conflict.hidden === false, timers.delay);

      mode = "throw-get";
      failing.keepButton.dispatchEvent({ type: "click" });
      await waitFor(() => failing.textarea.disabled === false && resolutionCalls >= 1, timers.delay);
      assertUnlockedConflict(failing, "ЛОКАЛЬНЫЙ-СБОЙ");

      mode = "bad-get";
      failing.reloadButton.dispatchEvent({ type: "click" });
      await waitFor(() => failing.textarea.disabled === false && resolutionCalls >= 2, timers.delay);
      assertUnlockedConflict(failing, "ЛОКАЛЬНЫЙ-СБОЙ");

      mode = "bad-put";
      failing.keepButton.dispatchEvent({ type: "click" });
      await waitFor(() => failing.textarea.disabled === false && resolutionCalls >= 3, timers.delay);
      assertUnlockedConflict(failing, "ЛОКАЛЬНЫЙ-СБОЙ");
    });
  } finally {
    timers.restore();
  }
});
