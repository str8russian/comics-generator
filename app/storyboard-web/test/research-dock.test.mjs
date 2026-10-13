import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CONTEXT_KEYS = [
  "workflowPhase",
  "storyboardVersionId",
  "displayFrameNumber",
  "displayFrameId",
  "structureFrameId",
  "structureSegmentIndex",
  "panelIndex",
  "panelSubject",
  "imageAssetId",
  "generationId",
  "characterName",
  "anchorVersionId",
];

function createElement(tag = "div") {
  const listeners = new Map();
  const element = {
    tagName: String(tag).toUpperCase(),
    id: "",
    hidden: false,
    textContent: "",
    value: "",
    dataset: {},
    style: {},
    className: "",
    disabled: false,
    children: [],
    parentNode: null,
    getAttribute(name) {
      if (name === "data-research-allow") return this.dataset.researchAllow ?? null;
      if (name === "aria-expanded") return this.dataset.ariaExpanded ?? this.getAttribute?.["_aria-expanded"] ?? null;
      return this.attrs?.[name] ?? null;
    },
    setAttribute(name, value) {
      this.attrs = this.attrs || {};
      this.attrs[name] = String(value);
      if (name === "data-research-allow") this.dataset.researchAllow = String(value);
      if (name === "aria-expanded") this.dataset.ariaExpanded = String(value);
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = nodes.slice();
      for (const child of this.children) child.parentNode = this;
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node.parentNode) {
          const idx = node.parentNode.children.indexOf(node);
          if (idx >= 0) node.parentNode.children.splice(idx, 1);
        }
        node.parentNode = this;
        this.children.push(node);
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    contains(node) {
      if (node === this) return true;
      return this.children.some((child) => child.contains?.(node) || child === node);
    },
    querySelector() {
      return null;
    },
  };
  return element;
}

function installDockDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const el = createElement();
    el.id = match[1];
    elements.set(match[1], el);
  }
  const notesSend = elements.get("research-notes-send");
  if (notesSend && /id="research-notes-send"[^>]*data-research-allow="notes-send"|data-research-allow="notes-send"[^>]*id="research-notes-send"/.test(html)) {
    notesSend.setAttribute("data-research-allow", "notes-send");
  }
  const body = createElement("body");
  body.id = "body";
  const host = elements.get("research-dock-host");
  const dock = elements.get("research-dock");
  const detail = elements.get("detail");
  if (host && dock) {
    host.appendChild(dock);
    body.appendChild(host);
  }
  if (detail) {
    detail.open = false;
    detail.showModal = () => {
      detail.open = true;
    };
    detail.close = () => {
      detail.open = false;
      detail.dispatchEvent({ type: "close" });
    };
    body.appendChild(detail);
  }
  for (const [id, el] of elements) {
    if (id.startsWith("research-") && id !== "research-dock" && id !== "research-dock-host" && dock) {
      dock.appendChild(el);
    }
  }
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

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("production markup has exactly one research dock with three labelled regions", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const dockIds = [...html.matchAll(/\bid="research-dock"/g)];
  assert.equal(dockIds.length, 1);
  assert.match(html, /id="research-dock-host"/);
  assert.match(html, /id="research-commands"/);
  assert.match(html, /id="research-notes"/);
  assert.match(html, /id="research-operations"/);
  assert.match(html, /id="research-dock-toggle"/);
  assert.match(html, /data-research-allow="notes-send"/);
  assert.match(html, /id="research-notes-draft"/);
  assert.match(html, /id="research-notes-send"/);
  assert.match(html, /id="research-notes-history"/);
  assert.match(html, /id="research-operations-list"/);
  const detailIndex = html.indexOf('id="detail"');
  const dockHostIndex = html.indexOf('id="research-dock-host"');
  assert.ok(dockHostIndex >= 0);
  assert.ok(detailIndex >= 0);
  assert.equal(html.includes('id="research-dock"', detailIndex), false);
});

test("busy CSS exempts only notes-send and keeps other buttons blocked", () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(
    css,
    /body\[data-busy="true"\]\s*button:not\(\[data-research-allow="notes-send"\]\)\s*\{[^}]*pointer-events:\s*none/,
  );
  assert.equal(/body\[data-busy="true"\]\s*button\s*\{[^}]*pointer-events:\s*none/.test(css), false);
  assert.match(css, /#research-dock/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /bottom:/);
  assert.match(css, /right:/);
});

test("Notes draft send posts fixed-key context and renders one timestamped history item without AI reply", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const requests = [];
  const occurredAt = "2026-10-13T00:00:00.000Z";
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname + (new URL(url, "http://127.0.0.1").search || "");
      const body = init.body == null ? null : JSON.parse(init.body);
      requests.push({ path, method: init.method ?? "GET", body });
      if (path === "/api/research/trace?kind=note") {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/research/trace") {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/research/notes" && init.method === "POST") {
        return jsonResponse(201, {
          event: {
            eventKind: "note",
            submittedText: body.submittedText,
            occurredAt,
            context: body.context,
            seq: 1,
          },
        });
      }
      return jsonResponse(404, { kind: "not-found" });
    },
  });
  await dock.ready;

  const draft = document.querySelector("#research-notes-draft");
  const send = document.querySelector("#research-notes-send");
  draft.value = "наблюдение владельца";
  send.dispatchEvent({ type: "click" });
  await dock.ready;
  await new Promise((resolve) => setTimeout(resolve, 0));

  const notePost = requests.find((entry) => entry.path === "/api/research/notes");
  assert.ok(notePost);
  assert.equal(notePost.method, "POST");
  assert.equal(notePost.body.submittedText, "наблюдение владельца");
  assert.deepEqual(Object.keys(notePost.body.context).sort(), CONTEXT_KEYS.slice().sort());
  for (const key of CONTEXT_KEYS) {
    assert.equal(Object.hasOwn(notePost.body.context, key), true);
  }
  assert.equal(notePost.body.context.workflowPhase, "structure");
  assert.equal(draft.value, "");

  const history = document.querySelector("#research-notes-history");
  assert.equal(history.children.length, 1);
  const itemText = history.children[0].textContent;
  assert.match(itemText, /наблюдение владельца/);
  assert.match(itemText, /2026-10-13T00:00:00\.000Z/);
  assert.equal(/AI|ассистент|ответ модели/i.test(itemText), false);
});

test("failed Notes save retains draft and reports failure without automatic retry", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let notePosts = 0;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/research/trace")) {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/research/notes" && init.method === "POST") {
        notePosts += 1;
        return jsonResponse(500, { status: "failed", kind: "database" });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;

  const draft = document.querySelector("#research-notes-draft");
  draft.value = "несохранившаяся заметка";
  document.querySelector("#research-notes-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(draft.value, "несохранившаяся заметка");
  assert.equal(notePosts, 1);
  const status = document.querySelector("#research-notes-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /не удалось|ошибк/i);
  assert.equal(document.querySelector("#research-notes-history").children.length, 0);
});

test("notes-send remains usable while body is busy; product busy latch stays single-flight for product work", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  document.body.dataset.busy = "true";
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const requests = [];
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      requests.push({ path, method: init.method ?? "GET" });
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/notes") {
        return jsonResponse(201, {
          event: {
            eventKind: "note",
            submittedText: "во время busy",
            occurredAt: "2026-10-13T01:00:00.000Z",
            seq: 2,
          },
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;

  const send = document.querySelector("#research-notes-send");
  assert.equal(send.getAttribute("data-research-allow"), "notes-send");
  assert.equal(send.disabled, false);
  document.querySelector("#research-notes-draft").value = "во время busy";
  send.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(requests.some((entry) => entry.path === "/api/research/notes"));
  assert.equal(document.body.dataset.busy, "true");

  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(appJs, /async function runBusy/);
  assert.match(appJs, /if \(busy\) return null;/);
  assert.match(appJs, /structure-edit-form[\s\S]*runBusy/);
  const dockSource = readFileSync(new URL("../public/research-dock.mjs", import.meta.url), "utf8");
  assert.equal(dockSource.includes("runBusy"), false);
});

test("Operations shows live running then terminal success or failure without percentages", async () => {
  const { projectOperations } = await import("../public/research-dock.mjs");
  const running = projectOperations({
    live: {
      correlationId: "11111111-1111-4111-8111-111111111111",
      semanticAction: "structure_edit",
      surface: "product_control",
    },
    events: [],
  });
  assert.equal(running.some((item) => item.status === "running"), true);
  assert.equal(running.every((item) => !String(item.label || item.text || "").includes("%")), true);
  assert.equal(running.every((item) => item.percent == null), true);

  const success = projectOperations({
    live: null,
    events: [{
      eventKind: "action_terminal",
      correlationId: "11111111-1111-4111-8111-111111111111",
      semanticAction: "structure_edit",
      outcome: "success",
      outcomeKind: null,
      occurredAt: "2026-10-13T02:00:00.000Z",
    }],
  });
  assert.equal(success.some((item) => item.status === "success"), true);
  assert.equal(success.some((item) => item.status === "running"), false);

  const failure = projectOperations({
    live: null,
    events: [{
      eventKind: "action_terminal",
      correlationId: "22222222-2222-4222-8222-222222222222",
      semanticAction: "structure_edit",
      outcome: "failure",
      outcomeKind: "structure-rejected",
      occurredAt: "2026-10-13T02:01:00.000Z",
    }],
  });
  assert.equal(failure.some((item) => item.status === "failure"), true);
  assert.equal(failure.some((item) => item.status === "success"), false);
});

test("hydrated unmatched action_start is historical interruption evidence and never live running", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, projectOperations } = await import("../public/research-dock.mjs");
  const unmatched = {
    eventKind: "action_start",
    correlationId: "33333333-3333-4333-8333-333333333333",
    semanticAction: "structure_edit",
    surface: "product_control",
    occurredAt: "2026-10-13T03:00:00.000Z",
  };
  const projected = projectOperations({ live: null, events: [unmatched] });
  assert.equal(projected.some((item) => item.status === "running"), false);
  assert.equal(projected.some((item) => item.historical === true || item.status === "interrupted"), true);
  assert.equal(projected.some((item) => item.replayed === true || item.resumed === true), false);

  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: async (url) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path === "/api/research/trace?kind=note") return jsonResponse(200, { events: [] });
      if (path === "/api/research/trace") return jsonResponse(200, { events: [unmatched] });
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  const ops = dock.getOperationsProjection();
  assert.equal(ops.some((item) => item.status === "running"), false);
  assert.equal(ops.some((item) => item.historical === true || item.status === "interrupted"), true);
  const list = document.querySelector("#research-operations-list");
  const rendered = list.children.map((child) => child.textContent).join("\n");
  assert.equal(/running|выполняется|идёт/i.test(rendered), false);
  assert.match(rendered, /прерв|interrupt|незаверш/i);
});

test("reparent helper moves the same dock node into detail and restores it on close", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const elements = installDockDocument(html);
  const { bindResearchDock, reparentDockIntoDetail, restoreDockToHost } = await import("../public/research-dock.mjs");
  const dockNode = document.querySelector("#research-dock");
  const host = document.querySelector("#research-dock-host");
  const detail = document.querySelector("#detail");
  const marker = { keep: true };
  dockNode.__marker = marker;

  const dock = bindResearchDock({
    root: dockNode,
    host,
    detail,
    getContext: () => ({}),
    fetchImpl: async () => jsonResponse(200, { events: [] }),
  });
  await dock.ready;

  reparentDockIntoDetail({ dock: dockNode, detail, host });
  assert.equal(detail.contains(dockNode), true);
  assert.equal(host.contains(dockNode), false);
  assert.equal(dockNode.__marker, marker);
  assert.equal(elements.get("research-dock"), dockNode);

  restoreDockToHost({ dock: dockNode, host, detail });
  assert.equal(host.contains(dockNode), true);
  assert.equal(detail.contains(dockNode), false);
  assert.equal(dockNode.__marker, marker);

  dock.enterDetail();
  assert.equal(detail.contains(dockNode), true);
  detail.close();
  assert.equal(host.contains(dockNode), true);
  assert.equal([...document.body.children, ...host.children, ...detail.children]
    .filter((node) => node?.id === "research-dock").length <= 1, true);
  assert.equal(document.querySelector("#research-dock"), dockNode);
});

test("collapse toggles open-page state only and does not require unsent draft persistence", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: async () => jsonResponse(200, { events: [] }),
  });
  await dock.ready;
  const root = document.querySelector("#research-dock");
  const toggle = document.querySelector("#research-dock-toggle");
  document.querySelector("#research-notes-draft").value = "черновик";
  assert.equal(dock.isCollapsed(), false);
  toggle.dispatchEvent({ type: "click" });
  assert.equal(dock.isCollapsed(), true);
  assert.match(root.className, /collapsed/);
  toggle.dispatchEvent({ type: "click" });
  assert.equal(dock.isCollapsed(), false);
  assert.equal(document.querySelector("#research-notes-draft").value, "черновик");
});

test("Notes send posts production captureResearchContext display vs structure identity", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { register } = await import("node:module");
  register(new URL("./draft-page-loader.mjs", import.meta.url));
  const page = await import("../public/app.js");
  const requests = [];
  const dock = (await import("../public/research-dock.mjs")).bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: page.captureResearchContext,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      const body = init.body == null ? null : JSON.parse(init.body);
      requests.push({ path, method: init.method ?? "GET", body });
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/notes") {
        return jsonResponse(201, {
          event: {
            eventKind: "note",
            submittedText: body.submittedText,
            occurredAt: "2026-10-13T05:00:00.000Z",
            context: body.context,
            seq: 1,
          },
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;

  page.setResearchDetailState([{
    id: "display-2",
    structureFrameId: "structure-1",
    structureSegmentIndex: 0,
  }], 0);
  document.querySelector("#research-notes-draft").value = "контекст кадра";
  document.querySelector("#research-notes-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const notePost = requests.find((entry) => entry.path === "/api/research/notes");
  assert.ok(notePost);
  assert.equal(notePost.body.context.displayFrameId, "display-2");
  assert.equal(notePost.body.context.structureFrameId, "structure-1");
  assert.equal(notePost.body.context.structureSegmentIndex, 0);
  assert.equal(notePost.body.context.displayFrameNumber, 1);
  assert.notEqual(notePost.body.context.displayFrameId, notePost.body.context.structureFrameId);
});

test("Notes hydrate from GET trace kind=note after bind", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: async (url) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path === "/api/research/trace?kind=note") {
        return jsonResponse(200, {
          events: [{
            eventKind: "note",
            submittedText: "после перезагрузки",
            occurredAt: "2026-10-13T04:00:00.000Z",
            seq: 9,
          }],
        });
      }
      if (path === "/api/research/trace") return jsonResponse(200, { events: [] });
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  const history = document.querySelector("#research-notes-history");
  assert.equal(history.children.length, 1);
  assert.match(history.children[0].textContent, /после перезагрузки/);
  assert.match(history.children[0].textContent, /2026-10-13T04:00:00\.000Z/);
});

function emptyTraceFetch() {
  return async (url) => {
    const parsed = new URL(url, "http://127.0.0.1");
    const path = parsed.pathname + parsed.search;
    if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
    return jsonResponse(404, {});
  };
}

test("Commands markup has distinct textarea, send, status, target controls, label, and history", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="research-commands-draft"/);
  assert.match(html, /id="research-commands-send"/);
  assert.match(html, /id="research-commands-status"/);
  assert.match(html, /id="research-commands-target"/);
  assert.match(html, /id="research-commands-target-label"/);
  assert.match(html, /id="research-commands-history"/);
  assert.notEqual(
    html.match(/id="research-commands-draft"/)?.[0],
    html.match(/id="research-notes-draft"/)?.[0],
  );
  assert.equal(html.includes('id="research-commands-draft"') && html.includes('id="research-notes-draft"'), true);
  assert.equal(/id="research-commands-send"[^>]*data-research-allow="notes-send"|data-research-allow="notes-send"[^>]*id="research-commands-send"/.test(html), false);
  const commandsDraft = html.indexOf('id="research-commands-draft"');
  const notesDraft = html.indexOf('id="research-notes-draft"');
  assert.notEqual(commandsDraft, notesDraft);
});

test("typing or sending Commands never changes Notes draft/history and the reverse", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext, createEmptyCommandTarget } = await import("../public/research-dock.mjs");
  const requests = [];
  let productCalls = 0;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    isProductBusy: () => false,
    executeDockCommand: async () => {
      productCalls += 1;
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      const body = init.body == null ? null : JSON.parse(init.body);
      requests.push({ path, method: init.method ?? "GET", body });
      if (path === "/api/research/trace?kind=note") return jsonResponse(200, { events: [] });
      if (path === "/api/research/trace?surface=dock_commands") return jsonResponse(200, { events: [] });
      if (path === "/api/research/trace") return jsonResponse(200, { events: [] });
      if (path === "/api/research/notes" && init.method === "POST") {
        return jsonResponse(201, {
          event: {
            eventKind: "note",
            submittedText: body.submittedText,
            occurredAt: "2026-10-13T06:00:00.000Z",
            seq: 1,
          },
        });
      }
      if (path === "/api/research/events" && init.method === "POST") {
        return jsonResponse(201, {
          event: {
            ...body,
            occurredAt: "2026-10-13T06:00:01.000Z",
            seq: requests.length,
          },
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets?.({
    storyboardAvailable: true,
    panels: [],
  });

  const notesDraft = document.querySelector("#research-notes-draft");
  const commandsDraft = document.querySelector("#research-commands-draft");
  assert.ok(notesDraft);
  assert.ok(commandsDraft);
  notesDraft.value = "заметка до команды";
  commandsDraft.value = "команда структуры";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(notesDraft.value, "заметка до команды");
  assert.equal(document.querySelector("#research-notes-history").children.length, 0);
  assert.equal(requests.some((entry) => entry.path === "/api/research/notes"), false);
  assert.ok(productCalls >= 1 || requests.some((entry) => entry.path === "/api/research/events"));

  const commandsHistoryBeforeNote = document.querySelector("#research-commands-history").children.length;
  notesDraft.value = "только заметка";
  document.querySelector("#research-notes-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#research-commands-history").children.length, commandsHistoryBeforeNote);
  assert.equal(commandsDraft.value === "команда структуры" || commandsDraft.value === "", true);
  assert.ok(createEmptyCommandTarget);
});

test("sticky storyboard target stays storyboard-wide when detail opens or ambient frame changes", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({
      workflowPhase: "structure",
      displayFrameNumber: 2,
      displayFrameId: "display-2",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
    }),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [],
  });
  assert.equal(dock.getCommandTarget().kind, "storyboard");

  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 2,
      displayFrameId: "display-2",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  dock.enterDetail();
  assert.equal(dock.getCommandTarget().kind, "storyboard");

  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 3,
      displayFrameId: "display-3",
      structureFrameId: "structure-2",
      structureSegmentIndex: 1,
      panelIndex: 1,
    }],
  });
  assert.equal(dock.getCommandTarget().kind, "storyboard");
  const label = document.querySelector("#research-commands-target-label").textContent;
  assert.match(label, /storyboard|раскадров/i);
});

test("panel target is used only after explicit selection with distinct display/structure identity", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let lastCommand = null;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    isProductBusy: () => false,
    executeDockCommand: async (payload) => {
      lastCommand = payload;
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/events") {
        return jsonResponse(201, { event: { ...JSON.parse(init.body), seq: 1, occurredAt: "2026-10-13T07:00:00.000Z" } });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 2,
      displayFrameId: "display-2",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  assert.equal(dock.getCommandTarget().kind, "storyboard");

  dock.selectCommandTarget({
    kind: "panel",
    displayFrameNumber: 2,
    displayFrameId: "display-2",
    structureFrameId: "structure-1",
    structureSegmentIndex: 0,
    panelIndex: 0,
  });
  const target = dock.getCommandTarget();
  assert.equal(target.kind, "panel");
  assert.equal(target.displayFrameId, "display-2");
  assert.equal(target.structureFrameId, "structure-1");
  assert.equal(target.structureSegmentIndex, 0);
  assert.equal(target.panelIndex, 0);
  assert.notEqual(target.displayFrameId, target.structureFrameId);

  const label = document.querySelector("#research-commands-target-label").textContent;
  assert.match(label, /display-2|кадр\s*2|frame\s*2/i);
  assert.match(label, /structure-1/);
  assert.match(label, /0|панел/i);

  document.querySelector("#research-commands-draft").value = "переделай панель";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(lastCommand);
  assert.equal(lastCommand.commandTarget.kind, "panel");
  assert.equal(lastCommand.commandTarget.panelIndex, 0);
  assert.equal(lastCommand.commandTarget.displayFrameId, "display-2");
  assert.equal(lastCommand.commandTarget.structureFrameId, "structure-1");
});

test("ambient detail/frame refresh without target-selection does not mutate sticky command target", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 1,
      displayFrameId: "d1",
      structureFrameId: "s1",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  dock.selectCommandTarget({
    kind: "panel",
    displayFrameNumber: 1,
    displayFrameId: "d1",
    structureFrameId: "s1",
    structureSegmentIndex: 0,
    panelIndex: 0,
  });
  const before = structuredClone(dock.getCommandTarget());
  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [
      {
        displayFrameNumber: 1,
        displayFrameId: "d1",
        structureFrameId: "s1",
        structureSegmentIndex: 0,
        panelIndex: 0,
      },
      {
        displayFrameNumber: 2,
        displayFrameId: "d2",
        structureFrameId: "s2",
        structureSegmentIndex: 1,
        panelIndex: 0,
      },
    ],
  });
  assert.deepEqual(dock.getCommandTarget(), before);
});

test("stale or unsupported selected target shows honest limitation and makes no product call", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let productCalls = 0;
  const requests = [];
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => false,
    executeDockCommand: async () => {
      productCalls += 1;
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      requests.push({ path, method: init.method ?? "GET", body: init.body == null ? null : JSON.parse(init.body) });
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/events") return jsonResponse(201, { event: { seq: 1 } });
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 1,
      displayFrameId: "d1",
      structureFrameId: "s1",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  dock.selectCommandTarget({
    kind: "panel",
    displayFrameNumber: 1,
    displayFrameId: "d1",
    structureFrameId: "s1",
    structureSegmentIndex: 0,
    panelIndex: 0,
  });
  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [],
  });
  document.querySelector("#research-commands-draft").value = "устаревшая цель";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(productCalls, 0);
  assert.equal(requests.some((entry) => entry.path === "/api/research/events"), false);
  const status = document.querySelector("#research-commands-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /недоступ|не поддержи|устарел|unsupported|stale/i);
  assert.equal(document.querySelector("#research-commands-draft").value, "устаревшая цель");
});

test("Commands is blocked while product busy including form/keyboard paths; Notes send remains usable", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  document.body.dataset.busy = "true";
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let productCalls = 0;
  const requests = [];
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => true,
    executeDockCommand: async () => {
      productCalls += 1;
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      requests.push({ path, method: init.method ?? "GET" });
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/notes") {
        return jsonResponse(201, {
          event: {
            eventKind: "note",
            submittedText: "busy note",
            occurredAt: "2026-10-13T08:00:00.000Z",
            seq: 1,
          },
        });
      }
      if (path === "/api/research/events") return jsonResponse(201, { event: { seq: 1 } });
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets({ storyboardAvailable: true, panels: [] });
  document.querySelector("#research-commands-draft").value = "нельзя во время busy";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  document.querySelector("#research-commands-draft").dispatchEvent({ type: "keydown", key: "Enter", ctrlKey: true });
  const form = document.querySelector("#research-commands-form");
  if (form) form.dispatchEvent({ type: "submit", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(productCalls, 0);

  document.querySelector("#research-notes-draft").value = "заметка во время busy";
  document.querySelector("#research-notes-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(requests.some((entry) => entry.path === "/api/research/notes"));
  assert.equal(document.querySelector("#research-commands-send").getAttribute("data-research-allow"), null);
});

test("Commands history hydrates from surface=dock_commands and excludes Notes and product_control", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const hydratedPaths = [];
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: async (url) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      hydratedPaths.push(path);
      if (path === "/api/research/trace?kind=note") {
        return jsonResponse(200, {
          events: [{
            eventKind: "note",
            submittedText: "note only",
            occurredAt: "2026-10-13T09:00:00.000Z",
            seq: 1,
          }],
        });
      }
      if (path === "/api/research/trace?surface=dock_commands") {
        return jsonResponse(200, {
          events: [
            {
              eventKind: "action_start",
              surface: "dock_commands",
              semanticAction: "structure_edit",
              submittedText: "dock command",
              correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              occurredAt: "2026-10-13T09:01:00.000Z",
              seq: 2,
            },
            {
              eventKind: "action_terminal",
              surface: "dock_commands",
              semanticAction: "structure_edit",
              outcome: "success",
              correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              occurredAt: "2026-10-13T09:01:01.000Z",
              seq: 3,
            },
            {
              eventKind: "action_start",
              surface: "product_control",
              semanticAction: "structure_edit",
              submittedText: "product form",
              correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              occurredAt: "2026-10-13T09:02:00.000Z",
              seq: 4,
            },
          ],
        });
      }
      if (path === "/api/research/trace") {
        return jsonResponse(200, {
          events: [{
            eventKind: "action_terminal",
            surface: "product_control",
            semanticAction: "structure_edit",
            outcome: "success",
            occurredAt: "2026-10-13T09:02:01.000Z",
            seq: 5,
          }],
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  assert.ok(hydratedPaths.includes("/api/research/trace?surface=dock_commands"));
  const commandsHistory = document.querySelector("#research-commands-history");
  const text = commandsHistory.children.map((child) => child.textContent).join("\n");
  assert.match(text, /dock command/);
  assert.equal(/note only/.test(text), false);
  assert.equal(/product form/.test(text), false);
  assert.equal(document.querySelector("#research-notes-history").children.length, 1);
});

test("successful Commands send clears only Commands draft; product or research failure keeps text", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let mode = "success";
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    isProductBusy: () => false,
    executeDockCommand: async () => {
      if (mode === "product-fail") return { ok: false, error: { kind: "structure-rejected" } };
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/events") {
        if (mode === "research-fail") return jsonResponse(500, { status: "failed" });
        return jsonResponse(201, {
          event: { ...JSON.parse(init.body), seq: 1, occurredAt: "2026-10-13T10:00:00.000Z" },
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets({ storyboardAvailable: true, panels: [] });
  const draft = document.querySelector("#research-commands-draft");
  const notesDraft = document.querySelector("#research-notes-draft");
  notesDraft.value = "заметка рядом";

  draft.value = "успешная команда";
  mode = "success";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(draft.value, "");
  assert.equal(notesDraft.value, "заметка рядом");

  draft.value = "продуктовый сбой";
  mode = "product-fail";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(draft.value, "продуктовый сбой");

  draft.value = "research сбой при успехе продукта";
  mode = "research-fail";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Product success remains authoritative for clearing; research-start failure must not block product.
  // If product ok despite research fail, draft clears; if research fail prevented product in this mode, keep text.
  // Spec: failed research start must not prevent product; clear only on product success.
  assert.equal(draft.value, "");
  assert.equal(notesDraft.value, "заметка рядом");
});

test("product Structure form and dock Commands remain separable by surface and do not share drafts", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const dockSource = readFileSync(new URL("../public/research-dock.mjs", import.meta.url), "utf8");
  assert.match(appJs, /surface:\s*"product_control"/);
  assert.match(dockSource, /surface:\s*"dock_commands"/);
  assert.match(appJs, /executeDockCommand/);
  assert.match(appJs, /structure-edit-form[\s\S]*product_control/);
  assert.equal(appJs.includes('surface: "dock_commands"'), false);
  assert.match(html, /id="structure-instruction"/);
  assert.match(html, /id="research-commands-draft"/);
  assert.notEqual(
    html.indexOf('id="structure-instruction"'),
    html.indexOf('id="research-commands-draft"'),
  );

  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const researchEvents = [];
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    isProductBusy: () => false,
    executeDockCommand: async ({ instruction, commandTarget }) => {
      researchEvents.push({
        eventKind: "action_start",
        surface: "dock_commands",
        semanticAction: commandTarget.kind === "panel" ? "panel_generate" : "structure_edit",
        submittedText: instruction,
        commandTarget,
      });
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/events") {
        const body = JSON.parse(init.body);
        researchEvents.push(body);
        return jsonResponse(201, { event: { ...body, seq: researchEvents.length, occurredAt: "2026-10-13T11:00:00.000Z" } });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets({ storyboardAvailable: true, panels: [] });

  const structureInstruction = document.querySelector("#structure-instruction") || (() => {
    const el = document.createElement("textarea");
    el.id = "structure-instruction";
    el.value = "";
    document.body.appendChild(el);
    return el;
  })();
  structureInstruction.value = "правка из product form";
  document.querySelector("#research-commands-draft").value = "правка из dock Commands";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(structureInstruction.value, "правка из product form");
  const dockStarts = researchEvents.filter((event) => (
    event.eventKind === "action_start" && event.surface === "dock_commands"
  ));
  assert.ok(dockStarts.length >= 1);
  assert.equal(dockStarts.every((event) => event.surface === "dock_commands"), true);
  assert.equal(dockStarts.some((event) => event.surface === "product_control"), false);
  assert.equal(structureInstruction.value.includes("dock Commands"), false);
});

function panelOptionValue(select, predicate = () => true) {
  const options = select.children || [];
  const match = options.find((option) => option.value && option.value !== "storyboard" && predicate(option));
  assert.ok(match, "expected a concrete panel option");
  return match.value;
}

test("sole available panel stays behind neutral placeholder until explicit selector change", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let productCalls = 0;
  const requests = [];
  let lastCommand = null;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    isProductBusy: () => false,
    executeDockCommand: async (payload) => {
      productCalls += 1;
      lastCommand = payload;
      return { ok: true };
    },
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      requests.push({ path, method: init.method ?? "GET", body: init.body == null ? null : JSON.parse(init.body) });
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/events") {
        return jsonResponse(201, {
          event: { ...JSON.parse(init.body), seq: requests.length, occurredAt: "2026-10-13T12:00:00.000Z" },
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;

  const solePanel = {
    displayFrameNumber: 1,
    displayFrameId: "display-sole",
    structureFrameId: "structure-sole",
    structureSegmentIndex: 0,
    panelIndex: 0,
  };
  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [solePanel],
  });

  assert.equal(dock.isCommandTargetUnsupported(), true);
  const select = document.querySelector("#research-commands-target");
  assert.equal(select.value, "");
  assert.match(select.children[0].textContent, /выберите цель явно/i);
  assert.notEqual(select.value, panelOptionValue(select));
  assert.match(document.querySelector("#research-commands-target-label").textContent, /недоступ|устарел|явно/i);

  document.querySelector("#research-commands-draft").value = "до явного выбора";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(productCalls, 0);
  assert.equal(requests.some((entry) => entry.path === "/api/research/events"), false);

  const panelValue = panelOptionValue(select);
  select.value = panelValue;
  select.dispatchEvent({ type: "change" });
  assert.equal(dock.isCommandTargetUnsupported(), false);
  const target = dock.getCommandTarget();
  assert.equal(target.kind, "panel");
  assert.equal(target.displayFrameId, "display-sole");
  assert.equal(target.structureFrameId, "structure-sole");
  assert.equal(target.structureSegmentIndex, 0);
  assert.equal(target.panelIndex, 0);
  assert.equal(select.value, panelValue);

  document.querySelector("#research-commands-draft").value = "после явного выбора";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(productCalls, 1);
  assert.ok(lastCommand);
  assert.equal(lastCommand.commandTarget.kind, "panel");
  assert.equal(lastCommand.commandTarget.structureSegmentIndex, 0);
  assert.equal(lastCommand.commandTarget.displayFrameId, "display-sole");
});

test("stale panel returns selector to neutral placeholder instead of auto-selecting replacement", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  let productCalls = 0;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => false,
    executeDockCommand: async () => {
      productCalls += 1;
      return { ok: true };
    },
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;

  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [{
      displayFrameNumber: 1,
      displayFrameId: "display-old",
      structureFrameId: "structure-old",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  const select = document.querySelector("#research-commands-target");
  select.value = panelOptionValue(select);
  select.dispatchEvent({ type: "change" });
  assert.equal(dock.getCommandTarget().displayFrameId, "display-old");
  assert.equal(dock.isCommandTargetUnsupported(), false);

  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [{
      displayFrameNumber: 2,
      displayFrameId: "display-new",
      structureFrameId: "structure-new",
      structureSegmentIndex: 1,
      panelIndex: 0,
    }],
  });
  assert.equal(dock.isCommandTargetUnsupported(), true);
  assert.equal(select.value, "");
  assert.match(select.children[0].textContent, /выберите цель явно/i);
  assert.equal(dock.getCommandTarget().displayFrameId, "display-old");
  assert.notEqual(select.value, panelOptionValue(select));

  document.querySelector("#research-commands-draft").value = "stale";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(productCalls, 0);

  select.value = panelOptionValue(select);
  select.dispatchEvent({ type: "change" });
  assert.equal(dock.isCommandTargetUnsupported(), false);
  assert.equal(dock.getCommandTarget().displayFrameId, "display-new");
  assert.equal(dock.getCommandTarget().structureSegmentIndex, 1);
});

test("panel target key and matching distinguish structureSegmentIndex including zero", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;

  const segmentZero = {
    displayFrameNumber: 1,
    displayFrameId: "display-same",
    structureFrameId: "structure-same",
    structureSegmentIndex: 0,
    panelIndex: 0,
  };
  const segmentOne = {
    displayFrameNumber: 1,
    displayFrameId: "display-same",
    structureFrameId: "structure-same",
    structureSegmentIndex: 1,
    panelIndex: 0,
  };
  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [segmentZero, segmentOne],
  });
  const select = document.querySelector("#research-commands-target");
  const values = select.children
    .filter((option) => option.value)
    .map((option) => option.value);
  assert.equal(values.length, 2);
  assert.notEqual(values[0], values[1]);
  assert.equal(values.some((value) => value.includes(":0:") || value.endsWith(":0") || /:0(:|$)/.test(value)), true);

  select.value = values[0];
  select.dispatchEvent({ type: "change" });
  assert.equal(dock.getCommandTarget().structureSegmentIndex, 0);

  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [segmentOne],
  });
  assert.equal(dock.isCommandTargetUnsupported(), true);
  assert.equal(select.value, "");

  select.value = panelOptionValue(select);
  select.dispatchEvent({ type: "change" });
  assert.equal(dock.getCommandTarget().structureSegmentIndex, 1);
  assert.equal(dock.isCommandTargetUnsupported(), false);

  dock.setAvailableTargets({
    storyboardAvailable: false,
    panels: [segmentZero, segmentOne],
  });
  assert.equal(dock.getCommandTarget().structureSegmentIndex, 1);
  assert.equal(dock.isCommandTargetUnsupported(), false);
  assert.equal(select.value, values.find((value) => value !== values[0]) || select.value);
});

test("valid storyboard default and explicit panel selection stay stable across ambient refreshes", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;

  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 1,
      displayFrameId: "d1",
      structureFrameId: "s1",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  const select = document.querySelector("#research-commands-target");
  assert.equal(dock.getCommandTarget().kind, "storyboard");
  assert.equal(dock.isCommandTargetUnsupported(), false);
  assert.equal(select.value, "storyboard");

  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 2,
      displayFrameId: "d2",
      structureFrameId: "s2",
      structureSegmentIndex: 1,
      panelIndex: 1,
    }],
  });
  assert.equal(dock.getCommandTarget().kind, "storyboard");
  assert.equal(select.value, "storyboard");

  select.value = panelOptionValue(select);
  select.dispatchEvent({ type: "change" });
  const explicit = structuredClone(dock.getCommandTarget());
  assert.equal(explicit.kind, "panel");
  assert.equal(explicit.structureSegmentIndex, 1);

  dock.setAvailableTargets({
    storyboardAvailable: true,
    panels: [{
      displayFrameNumber: 2,
      displayFrameId: "d2",
      structureFrameId: "s2",
      structureSegmentIndex: 1,
      panelIndex: 1,
    }, {
      displayFrameNumber: 3,
      displayFrameId: "d3",
      structureFrameId: "s3",
      structureSegmentIndex: 0,
      panelIndex: 0,
    }],
  });
  assert.deepEqual(dock.getCommandTarget(), explicit);
  assert.equal(dock.isCommandTargetUnsupported(), false);
  assert.equal(select.value, panelOptionValue(select, (option) => option.value.includes("d2")));
});

test("T028 Notes protected-content failure keeps exact text, no history, one request, no secret echo", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const secret = "Bearer t028-notes-protected-token";
  let notePosts = 0;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/notes" && init.method === "POST") {
        notePosts += 1;
        return jsonResponse(400, { status: "failed", kind: "protected-content" });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  const draft = document.querySelector("#research-notes-draft");
  draft.value = secret;
  document.querySelector("#research-notes-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(draft.value, secret);
  assert.equal(notePosts, 1);
  assert.equal(document.querySelector("#research-notes-history").children.length, 0);
  const status = document.querySelector("#research-notes-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /не удалось|ошибк|защищ/i);
  assert.equal(status.textContent.includes(secret), false);
  assert.equal(status.textContent.includes("t028-notes-protected-token"), false);
});

test("T028 Commands product success with terminal research failure shows local evidence gap once", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext, projectOperations } = await import("../public/research-dock.mjs");
  let eventPosts = 0;
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext({ workflowPhase: "structure" }),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/research/events") {
        eventPosts += 1;
        const body = JSON.parse(init.body);
        if (body.eventKind === "action_start") {
          return jsonResponse(201, {
            event: { ...body, seq: 1, occurredAt: "2026-10-13T14:00:00.000Z" },
          });
        }
        return jsonResponse(500, { status: "failed", kind: "database" });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.setAvailableTargets({ storyboardAvailable: true, panels: [] });
  const draft = document.querySelector("#research-commands-draft");
  draft.value = "команда при сбое terminal";
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(draft.value, "");
  assert.equal(eventPosts, 2);
  const status = document.querySelector("#research-commands-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /исследован|не сохран/i);
  assert.equal(/успех/i.test(status.textContent), false);
  const projection = dock.getOperationsProjection();
  assert.equal(projection.some((item) => item.status === "success"), false);
  assert.equal(projection.some((item) => item.localOnly === true), true);
  assert.match(
    projection.find((item) => item.localOnly)?.label || "",
    /продукт.*выполн|исследован.*не сохран/i,
  );
  assert.equal(typeof projectOperations, "function");
});

test("T028 incomplete evidence terminal projects flags, null duration, never running or replay", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext, projectOperations } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    fetchImpl: async (url) => {
      const path = new URL(url, "http://127.0.0.1").pathname + new URL(url, "http://127.0.0.1").search;
      if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  dock.reportEvidenceSaveFailure?.({
    correlationId: "00000000-0000-4000-8000-000000000001",
    semanticAction: "structure_edit",
    phase: "start",
  });
  dock.recordTerminalEvent({
    eventKind: "action_terminal",
    correlationId: "00000000-0000-4000-8000-000000000001",
    semanticAction: "structure_edit",
    surface: "product_control",
    outcome: "success",
    outcomeKind: null,
    outcomeFlags: { evidenceIncomplete: true },
    durationMs: null,
    occurredAt: "2026-10-13T14:01:00.000Z",
    seq: 9,
  });
  const projection = dock.getOperationsProjection();
  assert.equal(projection.some((item) => item.status === "running"), false);
  const incomplete = projection.find((item) => item.outcomeFlags?.evidenceIncomplete === true);
  assert.ok(incomplete);
  assert.equal(incomplete.durationMs, null);
  assert.equal(incomplete.status, "success");
  assert.equal(incomplete.historical, false);
  assert.equal(incomplete.localOnly, false);
  const localOnly = projection.filter((item) => item.localOnly === true);
  assert.equal(localOnly.length, 0);
  const source = readFileSync(new URL("../public/research-dock.mjs", import.meta.url), "utf8");
  assert.equal(/setInterval|setTimeout\([^)]*retry|resume|replay|poll/i.test(source), false);
  assert.equal(typeof projectOperations, "function");
});

test("T028 Operations projection exposes retainedLastGoodImage on failure terminals", async () => {
  const { projectOperations } = await import("../public/research-dock.mjs");
  const items = projectOperations({
    live: null,
    events: [{
      eventKind: "action_terminal",
      correlationId: "00000000-0000-4000-8000-000000000002",
      semanticAction: "panel_generate",
      surface: "product_control",
      outcome: "failure",
      outcomeKind: "provider",
      outcomeFlags: { retainedLastGoodImage: true },
      durationMs: 12,
      occurredAt: "2026-10-13T14:02:00.000Z",
    }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "failure");
  assert.equal(items[0].outcomeFlags.retainedLastGoodImage, true);
  assert.match(items[0].label, /ошибк|failure|панел|panel_generate/i);
  assert.equal(/успех/i.test(items[0].label), false);
});
