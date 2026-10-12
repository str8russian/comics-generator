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
