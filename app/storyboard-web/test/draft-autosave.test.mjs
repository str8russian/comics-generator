import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "../server.mjs";

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
