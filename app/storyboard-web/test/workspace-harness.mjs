import { readFileSync } from "node:fs";
import { register } from "node:module";

export const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const API = `/api/projects/${PROJECT_ID}`;

globalThis.location = { pathname: `/projects/${PROJECT_ID}`, hash: "" };

export function isMutatingRequest(entry) {
  return Boolean(entry) && entry.method !== "GET";
}

function parseCompound(selector) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let rest = selector.trim();
  const tag = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tag) {
    out.tag = tag[0].toUpperCase();
    rest = rest.slice(tag[0].length);
  }
  while (rest.length) {
    if (rest[0] === ".") {
      const m = rest.match(/^\.([\w-]+)/);
      out.classes.push(m[1]);
      rest = rest.slice(m[0].length);
    } else if (rest[0] === "#") {
      const m = rest.match(/^#([\w-]+)/);
      out.id = m[1];
      rest = rest.slice(m[0].length);
    } else if (rest[0] === "[") {
      const m = rest.match(/^\[([\w-]+)(?:=(?:'([^']*)'|"([^"]*)"|([^\]]*)))?\]/);
      out.attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
      rest = rest.slice(m[0].length);
    } else {
      throw new Error(`unsupported selector: ${selector}`);
    }
  }
  return out;
}

function attrValue(node, name) {
  if (name.startsWith("data-")) {
    const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    return node.dataset?.[key] ?? null;
  }
  if (node.attrs && Object.hasOwn(node.attrs, name)) return node.attrs[name];
  const prop = node[name];
  if (prop == null || prop === false) return null;
  return String(prop);
}

export function matches(node, selector) {
  if (!node || !selector) return false;
  return selector.split(",").some((part) => {
    const compound = parseCompound(part);
    if (compound.tag && node.tagName !== compound.tag) return false;
    if (compound.id && node.id !== compound.id) return false;
    const classes = String(node.className || "").split(/\s+/);
    if (compound.classes.some((name) => !classes.includes(name))) return false;
    return compound.attrs.every(({ name, value }) => {
      const actual = attrValue(node, name);
      if (actual == null) return false;
      return value == null || actual === value;
    });
  });
}

export function createElement(tag = "div") {
  const listeners = new Map();
  const element = {
    tagName: String(tag).toUpperCase(),
    id: "",
    hidden: false,
    textContent: "",
    value: "",
    type: "",
    name: "",
    checked: false,
    disabled: false,
    className: "",
    dataset: {},
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    children: [],
    parentNode: null,
    files: null,
    attrs: {},
    scrolledIntoView: 0,
    get classList() {
      const node = this;
      const list = () => String(node.className || "").split(/\s+/).filter(Boolean);
      return {
        add(...names) { node.className = [...new Set([...list(), ...names])].join(" "); },
        remove(...names) { node.className = list().filter((name) => !names.includes(name)).join(" "); },
        toggle(name, force) {
          const on = force == null ? !list().includes(name) : Boolean(force);
          if (on) this.add(name); else this.remove(name);
          return on;
        },
        contains(name) { return list().includes(name); },
      };
    },
    getAttribute(name) {
      return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[key] = String(value);
      }
      if (name === "hidden") this.hidden = true;
    },
    removeAttribute(name) {
      delete this.attrs[name];
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        delete this.dataset[key];
      }
      if (name === "hidden") this.hidden = false;
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attrs, name);
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    dispatchEvent(event) {
      const payload = event && typeof event === "object" ? event : { type: event };
      if (!payload.preventDefault) payload.preventDefault = () => { payload.defaultPrevented = true; };
      if (!payload.stopPropagation) payload.stopPropagation = () => { payload.propagationStopped = true; };
      if (!payload.target) payload.target = this;
      payload.currentTarget = this;
      for (const listener of [...(listeners.get(payload.type) ?? [])]) listener(payload);
      return !payload.defaultPrevented;
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
    click() {
      if (this.disabled) return;
      this.dispatchEvent({ type: "click" });
    },
    focus() {
      if (globalThis.document) globalThis.document.activeElement = this;
    },
    blur() {},
    scrollIntoView() {
      this.scrolledIntoView += 1;
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
    },
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this.append(...nodes);
      this.textContent = "";
    },
    append(...nodes) {
      for (const raw of nodes) {
        if (raw == null) continue;
        const node = typeof raw === "string" ? Object.assign(createElement("#text"), { textContent: raw }) : raw;
        if (node.parentNode?.children) {
          const idx = node.parentNode.children.indexOf(node);
          if (idx >= 0) node.parentNode.children.splice(idx, 1);
        }
        node.parentNode = this;
        this.children.push(node);
      }
    },
    prepend(...nodes) {
      const existing = this.children.slice();
      this.children = [];
      this.append(...nodes);
      this.children.push(...existing);
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    remove() {
      if (!this.parentNode) return;
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    },
    contains(node) {
      let current = node;
      while (current) {
        if (current === this) return true;
        current = current.parentNode;
      }
      return false;
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const out = [];
      const visit = (node) => {
        if (matches(node, selector)) out.push(node);
        for (const child of node.children || []) visit(child);
      };
      for (const child of this.children) visit(child);
      return out;
    },
  };
  return element;
}

export function textOf(node) {
  if (!node) return "";
  return [node.textContent || "", ...(node.children || []).map(textOf)].join(" ").replace(/\s+/g, " ").trim();
}

export function visibleTextOf(node) {
  if (!node || node.hidden) return "";
  return [node.textContent || "", ...(node.children || []).map(visibleTextOf)].join(" ").replace(/\s+/g, " ").trim();
}

export function buttons(root) {
  return root ? root.querySelectorAll("button") : [];
}

export function buttonNamed(root, text) {
  return buttons(root).find((node) => node.textContent === text) ?? null;
}

export function installDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = createElement(match[1]);
    el.id = match[2];
    el.hidden = /\shidden(?=[\s>=])/.test(match[0]);
    elements.set(match[2], el);
  }
  const body = createElement("body");
  body.dataset = {};
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
  const frameDialogue = elements.get("frame-dialogue");
  if (frameDialogue) {
    for (const value of ["spoken", "silent", "hidden"]) {
      const radio = createElement("input");
      radio.type = "radio";
      radio.name = "frame-dialogue-mode";
      radio.value = value;
      frameDialogue.appendChild(radio);
    }
  }
  globalThis.document = {
    body,
    activeElement: null,
    fonts: { ready: Promise.resolve() },
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      return elements.get(selector.slice(1)) ?? null;
    },
    createElement(tag) {
      const node = createElement(tag);
      created.push(node);
      return node;
    },
  };
  const created = [];
  globalThis.document.created = created;
  globalThis.crypto ??= {};
  if (typeof globalThis.crypto.randomUUID !== "function") {
    let n = 0;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
  }
  globalThis.FileReader = class {
    readAsDataURL() {
      queueMicrotask(() => {
        this.result = "data:image/png;base64,aGVsbG8=";
        this.onload?.();
      });
    }
  };
  globalThis.confirm = () => true;
  return elements;
}

export function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

export async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

export const harness = {
  requests: [],
  researchPosts: [],
  visual: null,
  script: [],
  respond: null,
};

export function productRequests() {
  return harness.requests.filter((entry) => !entry.path.includes("/research/"));
}

export function mutatingRequests() {
  return harness.requests.filter(isMutatingRequest);
}

export function researchStarts(action = null) {
  return harness.researchPosts.filter((event) => (
    event.eventKind === "action_start" && (action == null || event.semanticAction === action)
  ));
}

export function resetRecorder() {
  harness.requests.length = 0;
  harness.researchPosts.length = 0;
}

async function fakeFetch(url, init = {}) {
  const parsed = new URL(url, "http://127.0.0.1");
  const path = parsed.pathname + parsed.search;
  const method = init.method ?? "GET";
  let body = null;
  if (init.body != null) {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  const entry = { path, method, body };
  harness.requests.push(entry);
  const scripted = harness.script.find((item) => item.path === path && (item.method || "POST") === method);
  if (scripted) {
    harness.script = harness.script.filter((item) => item !== scripted);
    return jsonResponse(scripted.status || 200, typeof scripted.body === "function" ? scripted.body(body) : scripted.body);
  }
  if (typeof harness.respond === "function") {
    const custom = await harness.respond(entry);
    if (custom) return custom;
  }
  if (path.startsWith(`${API}/research/events`) && method === "POST") {
    harness.researchPosts.push(body);
    const start = body.eventKind === "action_terminal"
      ? harness.researchPosts.find((event) => event.eventKind === "action_start" && event.correlationId === body.correlationId)
      : null;
    return jsonResponse(201, {
      event: {
        ...body,
        semanticAction: body.semanticAction ?? start?.semanticAction ?? null,
        surface: body.surface ?? start?.surface ?? null,
        commandTarget: body.commandTarget ?? start?.commandTarget ?? null,
        context: { ...(start?.context || {}), ...(body.context || {}) },
        seq: harness.researchPosts.length,
        occurredAt: "2026-10-23T12:00:00.000Z",
      },
    });
  }
  if (path.startsWith(`${API}/research/`)) return jsonResponse(200, { events: [] });
  if (path === API) {
    return jsonResponse(200, { title: "Проект", draft: { text: "", revisionToken: "11111111-1111-4111-8111-111111111111" } });
  }
  if (path === `${API}/draft`) {
    return jsonResponse(200, { revisionToken: "22222222-2222-4222-8222-222222222222", text: body?.text ?? "" });
  }
  if (path === `${API}/visual` && method === "GET") return jsonResponse(200, { status: "missing" });
  if (path === `${API}/visual/render` && method === "GET") return jsonResponse(200, { status: "idle" });
  if (path === `${API}/visual/intro-templates`) return jsonResponse(200, { templates: [] });
  if (path === "/api/build") return jsonResponse(200, { id: "test" });
  if (path === `${API}/open`) return jsonResponse(200, {});
  if (harness.visual && (
    path.endsWith("/visual/operations")
    || /\/generate$/.test(path)
    || /\/placement$/.test(path)
    || path.endsWith("/visual/storyboard/undo")
    || path.endsWith("/visual/approve")
  )) {
    return jsonResponse(200, harness.visual);
  }
  return jsonResponse(404, { kind: "not-found" });
}

export async function loadWorkspacePage({ instance = null } = {}) {
  installDocument(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"));
  globalThis.fetch = (...args) => fakeFetch(...args);
  register(new URL("./draft-page-loader.mjs", import.meta.url));
  const page = await import(instance ? `../public/app.js?instance=${instance}` : "../public/app.js");
  await page.draftAutosave.ready;
  await flush(4);
  resetRecorder();
  return page;
}

export function readyVisual(overrides = {}) {
  return {
    status: "ready",
    storyboardVersionId: "sv-1",
    materialStateId: "material-1",
    canUndo: false,
    undoLabel: null,
    allAnchorsApproved: true,
    complete: false,
    approved: false,
    readyForVideo: false,
    characters: [
      { name: "Путин", approvedAnchorId: "anchor-p", approvedAssetId: "anchor-asset-p", approvedAssetUrl: "/anchor-p.png" },
      { name: "Дуров", approvedAnchorId: "anchor-d", approvedAssetId: "anchor-asset-d", approvedAssetUrl: "/anchor-d.png" },
    ],
    reusableAssets: [
      { id: "asset-1", url: "/a1.png", provenance: { origin: "generation", subject: "Путин" } },
      { id: "asset-2", url: "/a2.png", provenance: { origin: "upload" } },
    ],
    frames: parityFrames(),
    ...overrides,
  };
}

export function parityFrames() {
  return [
    {
      id: "display-1",
      structureFrameId: "s-1",
      structureSegmentIndex: null,
      layout: "split2",
      origin: "source",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: "Привет",
      durationFrames: 72,
      durationSeconds: 2.4,
      minimumDurationFrames: 60,
      visualReady: true,
      panels: [
        { id: "p-1a", description: "Путин слева", subject: "Путин", assetId: "asset-1", asset: "/a1.png", assignmentOrigin: "generation", zoom: 1.2, positionX: 41, positionY: 22, mirrored: false },
        { id: "p-1b", description: "Дуров справа", subject: "Дуров", assetId: "asset-2", asset: "/a2.png", assignmentOrigin: "upload", zoom: 1, positionX: 50, positionY: 30, mirrored: false },
      ],
    },
    {
      id: "display-2",
      structureFrameId: "s-2",
      structureSegmentIndex: null,
      layout: "single",
      origin: "derived",
      frameKind: "image",
      dialogueMode: "hidden",
      dialogue: "",
      durationFrames: 36,
      durationSeconds: 1.2,
      minimumDurationFrames: 1,
      visualReady: false,
      panels: [
        { id: "p-2", description: "", subject: null, manualSubject: "", subjectEditable: true, assetId: null },
      ],
    },
    {
      id: "display-3",
      structureFrameId: "s-3",
      structureSegmentIndex: null,
      layout: "single",
      origin: "derived",
      frameKind: "text",
      textCard: "Пауза",
      dialogue: "",
      durationFrames: 36,
      durationSeconds: 1.2,
      minimumDurationFrames: 1,
      visualReady: true,
      panels: [],
    },
    {
      id: "display-4",
      structureFrameId: "s-4",
      structureSegmentIndex: null,
      layout: "single",
      origin: "source",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: "Ответ",
      durationFrames: 60,
      durationSeconds: 2,
      minimumDurationFrames: 50,
      visualReady: false,
      panels: [
        { id: "p-4", description: "Путин говорит", subject: "Путин", assetId: null },
      ],
    },
    {
      id: "display-5",
      structureFrameId: "s-5",
      structureSegmentIndex: null,
      layout: "single",
      origin: "derived",
      frameKind: "image",
      dialogueMode: "hidden",
      dialogue: "",
      durationFrames: 36,
      durationSeconds: 1.2,
      minimumDurationFrames: 1,
      visualReady: true,
      panels: [
        { id: "p-5", description: "описание вручную", subject: "Дуров", manualSubject: "Дуров", assetId: "asset-2", asset: "/a2.png", assignmentOrigin: "reuse" },
      ],
    },
  ];
}

export function requestSignature(entry) {
  const body = entry.body && typeof entry.body === "object" && !Array.isArray(entry.body)
    ? { ...entry.body }
    : entry.body;
  if (body && typeof body === "object") delete body.correlationId;
  return { method: entry.method, path: entry.path, body };
}

export function researchSignature(event) {
  if (!event) return null;
  return {
    semanticAction: event.semanticAction,
    surface: event.surface,
    submittedText: event.submittedText ?? null,
    commandTarget: event.commandTarget ?? null,
    context: event.context ?? null,
  };
}
