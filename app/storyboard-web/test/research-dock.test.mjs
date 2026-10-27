globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
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
  "panelId",
  "transitionMode",
  "transitionOverlapFrames",
  "introTemplateId",
  "introTemplateVersion",
];

function createElement(tag = "div") {
  const listeners = new Map();
  const styleTarget = {};
  const element = {
    tagName: String(tag).toUpperCase(),
    id: "",
    hidden: false,
    textContent: "",
    title: "",
    value: "",
    dataset: {},
    className: "",
    disabled: false,
    children: [],
    parentNode: null,
    offsetWidth: 360,
    offsetHeight: 300,
    _capturedPointer: null,
    getAttribute(name) {
      if (name === "data-research-allow") return this.dataset.researchAllow ?? null;
      if (name === "aria-expanded") return this.dataset.ariaExpanded ?? this.getAttribute?.["_aria-expanded"] ?? null;
      if (name === "aria-label") return this.attrs?.["aria-label"] ?? null;
      if (name === "title") return this.title || this.attrs?.title || null;
      if (name === "hidden") return this.hidden ? "" : null;
      return this.attrs?.[name] ?? null;
    },
    setAttribute(name, value) {
      this.attrs = this.attrs || {};
      this.attrs[name] = String(value);
      if (name === "data-research-allow") this.dataset.researchAllow = String(value);
      if (name === "aria-expanded") this.dataset.ariaExpanded = String(value);
      if (name === "aria-label") this.attrs["aria-label"] = String(value);
      if (name === "title") this.title = String(value);
      if (name === "hidden") this.hidden = value !== null && value !== undefined;
    },
    removeAttribute(name) {
      if (name === "hidden") this.hidden = false;
      if (this.attrs) delete this.attrs[name];
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const payload = event && typeof event === "object" ? event : { type: event };
      if (payload.type == null && typeof event === "string") payload.type = event;
      for (const listener of listeners.get(payload.type) ?? []) listener(payload);
      return true;
    },
    setPointerCapture(pointerId) {
      this._capturedPointer = pointerId;
    },
    releasePointerCapture(pointerId) {
      if (this._capturedPointer === pointerId) this._capturedPointer = null;
    },
    hasPointerCapture(pointerId) {
      return this._capturedPointer === pointerId;
    },
    getBoundingClientRect() {
      const width = Number.parseFloat(this.style.width) || this.offsetWidth || 0;
      const height = Number.parseFloat(this.style.height) || this.offsetHeight || 0;
      // Prefer globalThis metrics — do not create globalThis.window (overflow.mjs
      // switches to a browser-only /frame-renderer.mjs import when window exists).
      const vw = Number(globalThis.innerWidth) || Number(globalThis.window?.innerWidth) || 1024;
      const vh = Number(globalThis.innerHeight) || Number(globalThis.window?.innerHeight) || 768;
      const right = vw - 16;
      const bottom = vh - 16;
      const left = right - width;
      const top = bottom - height;
      return { width, height, left, top, right, bottom, x: left, y: top };
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
    querySelector(selector) {
      if (!selector?.startsWith("#")) return null;
      const id = selector.slice(1);
      const stack = [...this.children];
      while (stack.length) {
        const node = stack.shift();
        if (node?.id === id) return node;
        if (node?.children?.length) stack.push(...node.children);
      }
      return null;
    },
  };
  element.style = new Proxy(styleTarget, {
    set(target, prop, value) {
      target[prop] = value;
      if (prop === "width") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) element.offsetWidth = parsed;
      }
      if (prop === "height") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) element.offsetHeight = parsed;
      }
      return true;
    },
    get(target, prop) {
      if (prop === "removeProperty") {
        return (name) => {
          delete target[name];
        };
      }
      return target[prop];
    },
  });
  return element;
}

function installDockDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const el = createElement(match[1] === "research-dock-resize" || match[1] === "research-dock-toggle" || match[1] === "close-detail" || match[1] === "next-frame" ? "button" : "div");
    el.id = match[1];
    elements.set(match[1], el);
  }
  const notesSend = elements.get("research-notes-send");
  if (notesSend && /id="research-notes-send"[^>]*data-research-allow="notes-send"|data-research-allow="notes-send"[^>]*id="research-notes-send"/.test(html)) {
    notesSend.setAttribute("data-research-allow", "notes-send");
  }
  const resizeGrip = elements.get("research-dock-resize");
  if (resizeGrip) {
    const aria = html.match(/id="research-dock-resize"[^>]*aria-label="([^"]+)"|aria-label="([^"]+)"[^>]*id="research-dock-resize"/);
    const title = html.match(/id="research-dock-resize"[^>]*title="([^"]+)"|title="([^"]+)"[^>]*id="research-dock-resize"/);
    if (aria) resizeGrip.setAttribute("aria-label", aria[1] || aria[2]);
    if (title) resizeGrip.setAttribute("title", title[1] || title[2]);
  }
  const body = createElement("body");
  body.id = "body";
  const host = elements.get("research-dock-host");
  const dock = elements.get("research-dock");
  const detail = elements.get("detail");
  const detailScroll = elements.get("detail-scroll");
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
    if (detailScroll) {
      detail.appendChild(detailScroll);
      for (const id of ["detail-frame", "detail-outside", "detail-panel-controls", "next-frame", "close-detail"]) {
        const child = elements.get(id);
        if (child) detailScroll.appendChild(child);
      }
    }
  }
  for (const [id, el] of elements) {
    if (id.startsWith("research-") && id !== "research-dock" && id !== "research-dock-host" && dock) {
      dock.appendChild(el);
    }
  }
  if (globalThis.innerWidth == null) globalThis.innerWidth = 1024;
  if (globalThis.innerHeight == null) globalThis.innerHeight = 768;
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

function pointerEvent(type, { clientX, clientY, pointerId = 1 } = {}) {
  return { type, clientX, clientY, pointerId, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1 };
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

test("production markup has exactly one research dock with Notes and Operations", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const dockIds = [...html.matchAll(/\bid="research-dock"/g)];
  assert.equal(dockIds.length, 1);
  assert.match(html, /id="research-dock-host"/);
  assert.equal(html.includes('id="research-commands"'), false);
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
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?kind=note") {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace") {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes" && init.method === "POST") {
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

  const notePost = requests.find((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes");
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
  assert.match(itemText, /13 октября 2026, 03:00:00 \(UTC\+3\)/);
  assert.equal(/2026-10-13T00:00:00\.000Z/.test(itemText), false);
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
      if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes" && init.method === "POST") {
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
      if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes") {
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
  assert.ok(requests.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes"));
  assert.equal(document.body.dataset.busy, "true");

  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(appJs, /async function runBusy/);
  assert.match(appJs, /if \(busy\) return null;/);
  assert.match(appJs, /if \(busyMessage\) return runBusy\(busyMessage, execute\)/);
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
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?kind=note") return jsonResponse(200, { events: [] });
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace") return jsonResponse(200, { events: [unmatched] });
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
      if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes") {
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

  const notePost = requests.find((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes");
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
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?kind=note") {
        return jsonResponse(200, {
          events: [{
            eventKind: "note",
            submittedText: "после перезагрузки",
            occurredAt: "2026-10-13T04:00:00.000Z",
            seq: 9,
          }],
        });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace") return jsonResponse(200, { events: [] });
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  const history = document.querySelector("#research-notes-history");
  assert.equal(history.children.length, 1);
  assert.match(history.children[0].textContent, /после перезагрузки/);
  assert.match(history.children[0].textContent, /13 октября 2026, 07:00:00 \(UTC\+3\)/);
  assert.equal(/2026-10-13T04:00:00\.000Z/.test(history.children[0].textContent), false);
});

function emptyTraceFetch() {
  return async (url) => {
    const parsed = new URL(url, "http://127.0.0.1");
    const path = parsed.pathname + parsed.search;
    if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) return jsonResponse(200, { events: [] });
    return jsonResponse(404, {});
  };
}

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
      if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) return jsonResponse(200, { events: [] });
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/notes" && init.method === "POST") {
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
      if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) return jsonResponse(200, { events: [] });
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

test("projectOperations distinguishes start vs terminal evidence-save failure labels", async () => {
  const { projectOperations } = await import("../public/research-dock.mjs");
  const items = projectOperations({
    live: {
      correlationId: "00000000-0000-4000-8000-000000000010",
      semanticAction: "structure_edit",
      surface: "dock_commands",
    },
    events: [],
    localEvidenceFailures: [
      {
        correlationId: "00000000-0000-4000-8000-000000000010",
        semanticAction: "structure_edit",
        surface: "dock_commands",
        phase: "start",
      },
      {
        correlationId: "00000000-0000-4000-8000-000000000011",
        semanticAction: "structure_edit",
        surface: "product_control",
        phase: "terminal",
      },
    ],
  });
  const startFail = items.find((item) => item.localOnly && item.phase === "start");
  const terminalFail = items.find((item) => item.localOnly && item.phase === "terminal");
  assert.ok(startFail);
  assert.ok(terminalFail);
  assert.equal(items.some((item) => item.status === "running"), true);
  assert.match(startFail.label, /не удалось сохранить начало|начало исследования|продолжается/i);
  assert.equal(/выполнен|успех/i.test(startFail.label), false);
  assert.match(terminalFail.label, /продукт.*выполн|исследован.*не сохран/i);
  assert.equal(/начало|продолжается/i.test(terminalFail.label), false);
});

test("T035 formatResearchTimestamp uses Russian UTC+3 and graceful invalid fallback", async () => {
  const { formatResearchTimestamp } = await import("../public/research-dock.mjs");
  assert.equal(
    formatResearchTimestamp("2026-10-13T10:40:57.000Z"),
    "13 октября 2026, 13:40:57 (UTC+3)",
  );
  assert.equal(formatResearchTimestamp("not-a-date"), "");
  assert.equal(formatResearchTimestamp(null), "");
  assert.equal(formatResearchTimestamp(undefined), "");
  assert.equal(/Invalid Date/i.test(formatResearchTimestamp("bad")), false);
});

test("T035 Notes Commands Operations render Russian UTC+3 timestamps", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const iso = "2026-10-13T10:40:57.000Z";
  const expected = "13 октября 2026, 13:40:57 (UTC+3)";
  const { bindResearchDock } = await import("../public/research-dock.mjs");
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
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?kind=note") {
        return jsonResponse(200, {
          events: [{ eventKind: "note", submittedText: "заметка", occurredAt: iso, seq: 1 }],
        });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?surface=dock_commands") {
        return jsonResponse(200, {
          events: [{
            eventKind: "action_start",
            surface: "dock_commands",
            semanticAction: "structure_edit",
            submittedText: "команда",
            commandTarget: { kind: "storyboard" },
            occurredAt: iso,
            seq: 2,
          }],
        });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace") {
        return jsonResponse(200, {
          events: [{
            eventKind: "action_terminal",
            surface: "product_control",
            semanticAction: "panel_generate",
            outcome: "success",
            occurredAt: iso,
            seq: 3,
          }],
        });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  const notesText = document.querySelector("#research-notes-history").children.map((c) => c.textContent).join("\n");
  assert.equal(document.querySelector("#research-commands-history"), null);
  const opsText = document.querySelector("#research-operations-list").children.map((c) => c.textContent).join("\n");
  assert.match(notesText, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(opsText, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(/2026-10-13T10:40:57/.test(notesText + opsText), false);
  assert.equal(/Invalid Date/i.test(notesText + opsText), false);
});

test("T035 expanded dock is resizable; collapsed handle is fixed; same-page restore; no persistence", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(html, /id="research-dock-resize"/);
  assert.equal(/#research-dock\s*\{[^}]*resize:\s*both/s.test(css), false);
  assert.match(css, /#research-dock\.research-dock--collapsed\s*\{[^}]*width:\s*148px/s);
  assert.match(css, /#research-dock\.research-dock--collapsed\s*\{[^}]*height:\s*40px/s);
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(
    readFileSync(new URL("../public/research-dock.mjs", import.meta.url), "utf8"),
  ), false);

  installDockDocument(html);
  const storageCalls = [];
  globalThis.localStorage = {
    getItem(...args) { storageCalls.push(["getItem", ...args]); return null; },
    setItem(...args) { storageCalls.push(["setItem", ...args]); },
    removeItem(...args) { storageCalls.push(["removeItem", ...args]); },
  };
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const root = document.querySelector("#research-dock");
  const grip = document.querySelector("#research-dock-resize");
  const dock = bindResearchDock({
    root,
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  root.offsetWidth = 360;
  root.offsetHeight = 300;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, clientY: 200 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 140, clientY: 120 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: 140, clientY: 120 }));
  assert.equal(root.style.width, "420px");
  assert.equal(root.style.height, "380px");
  dock.setCollapsed(true);
  assert.match(root.className, /collapsed/);
  assert.equal(root.style.width === "420px", false);
  dock.setCollapsed(false);
  assert.equal(root.style.width, "420px");
  assert.equal(root.style.height, "380px");
  const beforeReparent = { width: root.style.width, height: root.style.height };
  dock.enterDetail();
  assert.equal(root.style.width, beforeReparent.width);
  assert.equal(root.style.height, beforeReparent.height);
  dock.exitDetail();
  assert.equal(root.style.width, beforeReparent.width);
  assert.equal(storageCalls.length, 0);
});

test("T035 Operations projects persisted entries by authoritative seq including older unmatched start", async () => {
  const { projectOperations } = await import("../public/research-dock.mjs");
  const events = [
    {
      eventKind: "action_terminal",
      correlationId: "c-new",
      semanticAction: "panel_generate",
      outcome: "success",
      occurredAt: "2026-10-13T12:00:00.000Z",
      seq: 10,
    },
    {
      eventKind: "action_start",
      correlationId: "c-old",
      semanticAction: "structure_edit",
      occurredAt: "2026-10-13T09:00:00.000Z",
      seq: 3,
    },
    {
      eventKind: "action_terminal",
      correlationId: "c-mid",
      semanticAction: "frame_generate",
      outcome: "failure",
      occurredAt: "2026-10-13T11:00:00.000Z",
      seq: 7,
    },
  ];
  const projected = projectOperations({ live: null, events });
  const persisted = projected.filter((item) => item.localOnly !== true);
  assert.deepEqual(persisted.map((item) => item.seq), [3, 7, 10]);
  assert.equal(persisted[0].status, "interrupted");
  assert.equal(persisted[0].historical, true);
  assert.equal(persisted[0].correlationId, "c-old");
  assert.equal(persisted.at(-1).seq, 10);
  assert.equal(persisted.at(-1).correlationId, "c-new");

  const withLive = projectOperations({
    live: { correlationId: "live-1", semanticAction: "structure_edit" },
    events,
    localEvidenceFailures: [{ correlationId: "gap", phase: "terminal", semanticAction: "structure_edit" }],
  });
  assert.equal(withLive[0].status, "running");
  assert.equal(withLive.at(-1).localOnly, true);
  assert.deepEqual(
    withLive.filter((item) => item.localOnly !== true && item.status !== "running").map((item) => item.seq),
    [3, 7, 10],
  );
});

test("T035 Operations keeps hydrated historical command terminals and has no command history", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock, createEmptyContext } = await import("../public/research-dock.mjs");
  const correlationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => createEmptyContext(),
    isProductBusy: () => false,
    executeDockCommand: async () => ({ ok: true }),
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url, "http://127.0.0.1");
      const path = parsed.pathname + parsed.search;
      if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace") && path.includes("kind=note")) {
        return jsonResponse(200, { events: [] });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace?surface=dock_commands") {
        return jsonResponse(200, {
          events: [
            {
              eventKind: "action_start",
              surface: "dock_commands",
              semanticAction: "structure_edit",
              submittedText: "отправь это",
              commandTarget: { kind: "storyboard" },
              correlationId,
              occurredAt: "2026-10-13T10:40:57.000Z",
              seq: 2,
            },
            {
              eventKind: "action_terminal",
              surface: "dock_commands",
              semanticAction: "structure_edit",
              outcome: "success",
              correlationId,
              occurredAt: "2026-10-13T10:41:00.000Z",
              seq: 3,
            },
          ],
        });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/trace") {
        return jsonResponse(200, {
          events: [
            {
              eventKind: "action_start",
              surface: "dock_commands",
              semanticAction: "structure_edit",
              submittedText: "отправь это",
              commandTarget: { kind: "storyboard" },
              correlationId,
              occurredAt: "2026-10-13T10:40:57.000Z",
              seq: 2,
            },
            {
              eventKind: "action_terminal",
              surface: "dock_commands",
              semanticAction: "structure_edit",
              outcome: "success",
              correlationId,
              occurredAt: "2026-10-13T10:41:00.000Z",
              seq: 3,
            },
          ],
        });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
        return jsonResponse(201, { event: { ...JSON.parse(init.body), seq: 99, occurredAt: "2026-10-13T10:50:00.000Z" } });
      }
      return jsonResponse(404, {});
    },
  });
  await dock.ready;
  assert.equal(document.querySelector("#research-commands-history"), null);
  const opsText = document.querySelector("#research-operations-list").children
    .map((child) => child.textContent)
    .join("\n");
  assert.match(opsText, /Успех|success/i);
  assert.match(opsText, /structure_edit/);
});

test("createEmptyCommandTarget omits panelSubject even when override supplies it", async () => {
  const { createEmptyCommandTarget } = await import("../public/research-dock.mjs");
  const target = createEmptyCommandTarget("panel", {
    displayFrameNumber: 12,
    displayFrameId: "disp-12",
    structureFrameId: "struct-9",
    structureSegmentIndex: 0,
    panelIndex: 1,
    panelSubject: "Дуров",
  });
  assert.equal(Object.hasOwn(target, "panelSubject"), false);
  assert.equal(target.kind, "panel");
  assert.equal(target.displayFrameNumber, 12);
  assert.equal(target.displayFrameId, "disp-12");
  assert.equal(target.structureFrameId, "struct-9");
  assert.equal(target.structureSegmentIndex, 0);
  assert.equal(target.panelIndex, 1);
  assert.deepEqual(Object.keys(target).sort(), [
    "anchorVersionId",
    "characterName",
    "displayFrameId",
    "displayFrameNumber",
    "kind",
    "mirrored",
    "panelId",
    "panelIndex",
    "positionX",
    "positionY",
    "structureFrameId",
    "structureSegmentIndex",
    "zoom",
  ]);
});

test("storyboard createEmptyCommandTarget omits panelSubject key rather than null", async () => {
  const { createEmptyCommandTarget } = await import("../public/research-dock.mjs");
  const target = createEmptyCommandTarget("storyboard");
  assert.equal(Object.hasOwn(target, "panelSubject"), false);
  assert.equal(target.kind, "storyboard");
});

test("production markup has one Russian-labelled research dock resize grip", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const grips = [...html.matchAll(/\bid="research-dock-resize"/g)];
  assert.equal(grips.length, 1);
  assert.equal([...html.matchAll(/\bid="research-dock"/g)].length, 1);
  const gripChunk = html.slice(html.indexOf('id="research-dock-resize"') - 80, html.indexOf('id="research-dock-resize"') + 220);
  assert.match(gripChunk, /aria-label="[^"]*[Рр]азмер[^"]*"/);
  assert.match(gripChunk, /title="[^"]*[Рр]азмер|перетян|измен[^"]*"/i);
});

test("expanded resize grip is visible with nwse-resize cursor; collapsed grip is suppressed", async () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(css, /\.research-dock-resize\s*\{[^}]*cursor:\s*nwse-resize/s);
  assert.match(css, /#research-dock\.research-dock--collapsed[\s\S]*?\.research-dock-resize\s*\{[^}]*display:\s*none/s);
  assert.equal(/#research-dock\s*\{[^}]*resize:\s*both/s.test(css), false);

  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  const grip = document.querySelector("#research-dock-resize");
  assert.equal(Boolean(grip), true);
  assert.equal(grip.hidden, false);
  dock.setCollapsed(true);
  assert.equal(grip.hidden, true);
  dock.setCollapsed(false);
  assert.equal(grip.hidden, false);
});

test("pointer drag on top-left grip increases width when dragged left and height when dragged up", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const root = document.querySelector("#research-dock");
  const grip = document.querySelector("#research-dock-resize");
  root.offsetWidth = 360;
  root.offsetHeight = 300;
  const dock = bindResearchDock({
    root,
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 500, clientY: 400 }));
  assert.equal(grip.hasPointerCapture(1), true);
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 440, clientY: 340 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: 440, clientY: 340 }));
  assert.equal(root.style.width, "420px");
  assert.equal(root.style.height, "360px");
  assert.equal(grip.hasPointerCapture(1), false);
  assert.equal(dock.getRememberedExpandedSize()?.width, "420px");
  assert.equal(dock.getRememberedExpandedSize()?.height, "360px");
});

test("pointercancel releases capture and leaves no active drag state", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const root = document.querySelector("#research-dock");
  const grip = document.querySelector("#research-dock-resize");
  root.offsetWidth = 360;
  root.offsetHeight = 300;
  const dock = bindResearchDock({
    root,
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 500, clientY: 400 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 470, clientY: 370 }));
  grip.dispatchEvent(pointerEvent("pointercancel", { clientX: 470, clientY: 370 }));
  assert.equal(grip.hasPointerCapture(1), false);
  const widthAfterCancel = root.style.width;
  const heightAfterCancel = root.style.height;
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 100, clientY: 100 }));
  assert.equal(root.style.width, widthAfterCancel);
  assert.equal(root.style.height, heightAfterCancel);
  assert.equal(dock.isCollapsed(), false);
});

test("pointer resize clamps to named minimums and viewport-safe maximums", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 600;
  const { bindResearchDock, RESEARCH_DOCK_MIN_WIDTH, RESEARCH_DOCK_MIN_HEIGHT } = await import("../public/research-dock.mjs");
  assert.equal(typeof RESEARCH_DOCK_MIN_WIDTH, "number");
  assert.equal(typeof RESEARCH_DOCK_MIN_HEIGHT, "number");
  assert.ok(RESEARCH_DOCK_MIN_WIDTH >= 200);
  assert.ok(RESEARCH_DOCK_MIN_HEIGHT >= 120);
  const root = document.querySelector("#research-dock");
  const grip = document.querySelector("#research-dock-resize");
  root.offsetWidth = 360;
  root.offsetHeight = 300;
  const dock = bindResearchDock({
    root,
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;

  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 400, clientY: 300 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 4000, clientY: 3000 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: 4000, clientY: 3000 }));
  assert.equal(root.style.width, `${RESEARCH_DOCK_MIN_WIDTH}px`);
  assert.equal(root.style.height, `${RESEARCH_DOCK_MIN_HEIGHT}px`);

  root.offsetWidth = RESEARCH_DOCK_MIN_WIDTH;
  root.offsetHeight = RESEARCH_DOCK_MIN_HEIGHT;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 400, clientY: 300 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: -4000, clientY: -4000 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: -4000, clientY: -4000 }));
  const maxW = Number.parseFloat(root.style.width);
  const maxH = Number.parseFloat(root.style.height);
  assert.ok(maxW <= globalThis.innerWidth - 32);
  assert.ok(maxH <= globalThis.innerHeight - 32);
  const rect = root.getBoundingClientRect();
  assert.ok(rect.left >= 0);
  assert.ok(rect.top >= 0);
  assert.ok(rect.right <= globalThis.innerWidth);
  assert.ok(rect.bottom <= globalThis.innerHeight);
});

test("pointer resize works on host, inside open detail, and after restore; collapse restores last size", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const root = document.querySelector("#research-dock");
  const grip = document.querySelector("#research-dock-resize");
  const host = document.querySelector("#research-dock-host");
  const detail = document.querySelector("#detail");
  const scroll = document.querySelector("#detail-scroll");
  root.offsetWidth = 360;
  root.offsetHeight = 300;
  const dock = bindResearchDock({
    root,
    host,
    detail,
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;

  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 300, clientY: 300 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 250, clientY: 250 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: 250, clientY: 250 }));
  assert.equal(root.style.width, "410px");
  assert.equal(root.style.height, "350px");

  detail.showModal();
  dock.enterDetail();
  assert.equal(detail.contains(root), true);
  assert.equal(scroll.contains(root), false);
  assert.equal(host.contains(root), false);
  root.offsetWidth = 410;
  root.offsetHeight = 350;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 300, clientY: 300 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 280, clientY: 260 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: 280, clientY: 260 }));
  assert.equal(root.style.width, "430px");
  assert.equal(root.style.height, "390px");

  detail.close();
  assert.equal(host.contains(root), true);
  root.offsetWidth = 430;
  root.offsetHeight = 390;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 300, clientY: 300 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: 290, clientY: 290 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: 290, clientY: 290 }));
  assert.equal(root.style.width, "440px");
  assert.equal(root.style.height, "400px");

  dock.setCollapsed(true);
  assert.match(root.className, /collapsed/);
  assert.equal(root.style.width === "440px", false);
  assert.equal(grip.hidden, true);
  dock.setCollapsed(false);
  assert.equal(root.style.width, "440px");
  assert.equal(root.style.height, "400px");
  assert.equal(grip.hidden, false);
});

test("detail scroll wrapper owns product scrolling; dock stays outside clipped content and controls remain reachable", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(html, /id="detail-scroll"/);
  assert.match(html, /id="detail-scroll"[\s\S]*class="detail-layout"/);
  assert.match(html, /id="detail-scroll"[\s\S]*class="dialog-actions"/);
  assert.match(css, /#detail-scroll\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /#detail\s*\{[^}]*overflow:\s*visible/s);
  assert.equal(/#detail\s*\{[^}]*overflow:\s*auto/s.test(css), false);

  installDockDocument(html);
  const detail = document.querySelector("#detail");
  const scroll = document.querySelector("#detail-scroll");
  const dock = document.querySelector("#research-dock");
  const closeBtn = document.querySelector("#close-detail");
  const nextBtn = document.querySelector("#next-frame");
  const panelControls = document.querySelector("#detail-panel-controls");
  assert.equal(Boolean(scroll), true);
  assert.equal(scroll.contains(closeBtn), true);
  assert.equal(scroll.contains(nextBtn), true);
  assert.equal(scroll.contains(panelControls), true);
  assert.equal(scroll.contains(dock), false);

  const { reparentDockIntoDetail, restoreDockToHost } = await import("../public/research-dock.mjs");
  reparentDockIntoDetail({ dock, detail });
  assert.equal(detail.contains(dock), true);
  assert.equal(scroll.contains(dock), false);
  assert.equal(scroll.contains(closeBtn), true);
  const rect = dock.getBoundingClientRect();
  assert.ok(rect.left >= 0);
  assert.ok(rect.top >= 0);
  assert.ok(rect.right <= (globalThis.innerWidth || 1024));
  assert.ok(rect.bottom <= (globalThis.innerHeight || 768));
  restoreDockToHost({ dock, host: document.querySelector("#research-dock-host") });
  assert.equal(document.querySelector("#research-dock-host").contains(dock), true);
});

test("expanded dock CSS has no 720px or vh-fraction max caps; defaults vs viewport maxima stay distinct", () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  const hostBlock = css.match(/#research-dock\s*\{[^}]*\}/s)?.[0] || "";
  const modalBlock = css.match(/#detail\s+#research-dock\s*\{[^}]*\}/s)?.[0] || "";
  assert.ok(hostBlock.length > 0);
  assert.ok(modalBlock.length > 0);

  assert.equal(/max-width:\s*min\(\s*720px/i.test(hostBlock), false);
  assert.equal(/max-width:\s*720px/i.test(hostBlock), false);
  assert.equal(/max-height:\s*min\(\s*42vh/i.test(hostBlock), false);
  assert.equal(/max-height:\s*42vh/i.test(hostBlock), false);
  assert.equal(/max-height:\s*min\(\s*36vh/i.test(modalBlock), false);
  assert.equal(/max-height:\s*36vh/i.test(modalBlock), false);
  assert.equal(/max-height:\s*min\(\s*38vh/i.test(css), false);

  assert.match(hostBlock, /width:\s*min\(\s*360px/);
  assert.match(hostBlock, /height:\s*min\(\s*42vh/);
  assert.match(hostBlock, /max-width:\s*calc\(\s*100vw\s*-\s*var\(--research-dock-inset-right\)/);
  assert.match(hostBlock, /max-height:\s*calc\(\s*100vh\s*-\s*var\(--research-dock-inset-bottom\)/);
  assert.match(hostBlock, /--research-dock-inset-right:\s*16px/);
  assert.match(hostBlock, /--research-dock-inset-bottom:\s*16px/);
  assert.match(hostBlock, /--research-dock-inset-opposite:\s*16px/);
  // Modal only overrides insets; maxima inherit from the shared calc(var(...)) contract.
  assert.match(modalBlock, /--research-dock-inset-right:\s*12px/);
  assert.match(modalBlock, /--research-dock-inset-bottom:\s*64px/);
  assert.equal(/max-width\s*:/i.test(modalBlock), false);
  assert.equal(/max-height\s*:/i.test(modalBlock), false);
});

test("large pointer drag exceeds former 720px/42vh caps up to inset-aware viewport bounds", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  installDockDocument(html);
  globalThis.innerWidth = 1400;
  globalThis.innerHeight = 900;
  const hostInsets = { right: "16px", bottom: "16px", opposite: "16px" };
  const modalInsets = { right: "12px", bottom: "64px", opposite: "16px" };
  let activeInsets = hostInsets;
  globalThis.getComputedStyle = (el) => ({
    getPropertyValue(name) {
      if (name === "--research-dock-inset-right") return activeInsets.right;
      if (name === "--research-dock-inset-bottom") return activeInsets.bottom;
      if (name === "--research-dock-inset-opposite") return activeInsets.opposite;
      return "";
    },
    right: activeInsets.right,
    bottom: activeInsets.bottom,
  });

  const { bindResearchDock, RESEARCH_DOCK_MIN_WIDTH, RESEARCH_DOCK_MIN_HEIGHT } = await import("../public/research-dock.mjs");
  const root = document.querySelector("#research-dock");
  const grip = document.querySelector("#research-dock-resize");
  const detail = document.querySelector("#detail");
  const scroll = document.querySelector("#detail-scroll");
  root.offsetWidth = 360;
  root.offsetHeight = 300;
  const dock = bindResearchDock({
    root,
    host: document.querySelector("#research-dock-host"),
    detail,
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;

  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 900, clientY: 700 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: -200, clientY: -200 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: -200, clientY: -200 }));
  const hostW = Number.parseFloat(root.style.width);
  const hostH = Number.parseFloat(root.style.height);
  assert.ok(hostW > 720, `host width ${hostW} should exceed former 720px cap`);
  assert.ok(hostH > 0.42 * 900, `host height ${hostH} should exceed former 42vh default`);
  assert.equal(hostW, 1400 - 16 - 16);
  assert.equal(hostH, 900 - 16 - 16);
  assert.equal(root.style.maxWidth, `${hostW}px`);
  assert.equal(root.style.maxHeight, `${hostH}px`);

  detail.showModal();
  dock.enterDetail();
  activeInsets = modalInsets;
  root.offsetWidth = hostW;
  root.offsetHeight = hostH;
  grip.dispatchEvent(pointerEvent("pointerdown", { clientX: 900, clientY: 700 }));
  grip.dispatchEvent(pointerEvent("pointermove", { clientX: -400, clientY: -400 }));
  grip.dispatchEvent(pointerEvent("pointerup", { clientX: -400, clientY: -400 }));
  const modalW = Number.parseFloat(root.style.width);
  const modalH = Number.parseFloat(root.style.height);
  assert.ok(modalW > 720);
  assert.ok(modalH > 0.36 * 900, `modal height ${modalH} should exceed former 36vh cap`);
  assert.equal(modalW, 1400 - 12 - 16);
  assert.equal(modalH, 900 - 64 - 16);
  assert.equal(detail.contains(root), true);
  assert.equal(scroll.contains(root), false);

  dock.setCollapsed(true);
  assert.match(root.className, /collapsed/);
  assert.equal(root.style.width === `${modalW}px`, false);
  dock.setCollapsed(false);
  assert.equal(root.style.width, `${modalW}px`);
  assert.equal(root.style.height, `${modalH}px`);
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(
    readFileSync(new URL("../public/research-dock.mjs", import.meta.url), "utf8"),
  ), false);
  assert.ok(RESEARCH_DOCK_MIN_WIDTH >= 200);
  assert.ok(RESEARCH_DOCK_MIN_HEIGHT >= 120);
  assert.equal([...html.matchAll(/\bid="research-dock"/g)].length, 1);
});

test("resize grip stays draggable after toggle collapse, expand, and detail reparenting", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(html, /aria-label="Заметки"/);
  assert.match(html, /Заметки ▾/);
  assert.equal(html.includes(">Команды<"), false);
  assert.match(html, />Заметки</);
  assert.match(html, />История операций</);
  assert.match(html, /Изменить размер заметок/);
  assert.match(css, /\.research-dock-body\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /#research-dock\s*\{[^}]*overflow:\s*hidden/s);

  installDockDocument(html);
  const { bindResearchDock } = await import("../public/research-dock.mjs");
  const dock = bindResearchDock({
    root: document.querySelector("#research-dock"),
    host: document.querySelector("#research-dock-host"),
    detail: document.querySelector("#detail"),
    getContext: () => ({}),
    fetchImpl: emptyTraceFetch(),
  });
  await dock.ready;
  const root = document.querySelector("#research-dock");
  const toggle = document.querySelector("#research-dock-toggle");
  const grip = document.querySelector("#research-dock-resize");
  root.offsetWidth = 360;
  root.offsetHeight = 280;

  function cycle() {
    toggle.dispatchEvent({ type: "click" });
    assert.match(root.className, /collapsed/);
    assert.equal(grip.hidden, true);
    assert.equal(toggle.textContent, "Заметки ▴");
    toggle.dispatchEvent({ type: "click" });
    assert.equal(/collapsed/.test(root.className), false);
    assert.equal(grip.hidden, false);
    assert.equal(grip.style.display || "", "");
    assert.equal(toggle.textContent, "Заметки ▾");
    const before = Number.parseFloat(root.style.width) || root.offsetWidth;
    grip.dispatchEvent({ type: "pointerdown", button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    grip.dispatchEvent({ type: "pointermove", pointerId: 7, clientX: 60, clientY: 70 });
    grip.dispatchEvent({ type: "pointerup", pointerId: 7, clientX: 60, clientY: 70 });
    assert.ok(Number.parseFloat(root.style.width) > before);
  }

  cycle();
  cycle();
  dock.enterDetail();
  cycle();
  dock.exitDetail();
  cycle();
});
