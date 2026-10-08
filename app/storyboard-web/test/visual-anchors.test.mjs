import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { register } from "node:module";
import test from "node:test";
import { render } from "../../../prototypes/storyboard-viewer/frame-renderer.mjs";
import { ANCHOR_ASSETS, ANCHOR_GEOMETRY, presentVisualFrame, resolveAnchor } from "../public/visual-anchors.mjs";
import { createServer, routes } from "../server.mjs";

const note = "Демонстрация с базовыми образами персонажей; эмоции и позы пока не меняются между кадрами.";
const putinLine = "Значит, Павел Валерьевич, мы решили.";
const durovLine = "А что с блокировкой?";
const actionLine = "(Песков встаёт)";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method: "GET", path }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        type: res.headers["content-type"],
        bytes: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

function createElement(tag) {
  const listeners = new Map();
  const style = {};
  style.setProperty = (name, value) => {
    style[name] = value;
  };
  return {
    tag,
    hidden: false,
    open: false,
    textContent: "",
    value: "",
    dataset: {},
    style,
    className: "",
    disabled: false,
    type: "",
    alt: "",
    src: "",
    children: [],
    parentElement: null,
    clientWidth: 800,
    clientHeight: 400,
    scrollWidth: 80,
    scrollHeight: 40,
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      for (const node of nodes) this.append(node);
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
      }
    },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    },
    querySelector(selector) {
      const wanted = selector.startsWith(".") ? selector.slice(1) : null;
      if (!wanted) return null;
      const stack = [...this.children];
      while (stack.length > 0) {
        const current = stack.shift();
        if (String(current.className || "").split(/\s+/).includes(wanted)) return current;
        stack.push(...(current.children || []));
      }
      return null;
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
}

function byClass(node, className) {
  const found = [];
  const walk = (current) => {
    if (!current || typeof current !== "object") return;
    if (String(current.className || "").split(/\s+/).includes(className)) found.push(current);
    for (const child of current.children || []) walk(child);
  };
  walk(node);
  return found;
}

function installDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], createElement(match[1]));
  }
  const body = createElement("body");
  globalThis.document = {
    body,
    documentElement: body,
    defaultView: {
      getComputedStyle() {
        return {
          paddingLeft: "0px",
          paddingRight: "0px",
          paddingTop: "0px",
          paddingBottom: "0px",
        };
      },
    },
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      return elements.get(selector.slice(1)) ?? null;
    },
    createElement,
  };
  return elements;
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
      res.on("end", () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function waitFor(predicate) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      if (predicate()) {
        resolve();
        return;
      }
      if (remaining <= 0) {
        reject(new Error("timed out waiting for the storyboard"));
        return;
      }
      setTimeout(() => check(remaining - 1), 10);
    };
    check(50);
  });
}

test("serves the three character anchors from the static map", async () => {
  const expected = [
    ["/character-anchors/putin.png", "app/storyboard-web/public/character-anchors/putin.png"],
    ["/character-anchors/durov.png", "app/storyboard-web/public/character-anchors/durov.png"],
    ["/character-anchors/peskov.png", "app/storyboard-web/public/character-anchors/peskov.png"],
  ];
  for (const [path, file] of expected) {
    const route = routes.find((item) => item.path === path);
    assert.equal(route?.method, "GET", path);
    assert.equal(route?.file, file, path);
  }
  assert.equal(routes.some((route) => route.path === "/visual-anchors.mjs"), true);
  const server = createServer({ migrate: false });
  const port = await listen(server);
  try {
    for (const [path, file] of expected) {
      const response = await get(port, path);
      const disk = readFileSync(new URL(`../../../${file}`, import.meta.url));
      assert.equal(response.status, 200, path);
      assert.equal(response.type, "image/png", path);
      assert.equal(response.bytes[0], 0x89, path);
      assert.deepEqual(response.bytes, disk, path);
    }
  } finally {
    await close(server);
  }
});

test("maps the four Russian surface forms and ignores an unknown name", () => {
  assert.equal(resolveAnchor("Путин").asset, ANCHOR_ASSETS.putin);
  assert.equal(resolveAnchor("на кадре путин").asset, ANCHOR_ASSETS.putin);
  assert.equal(resolveAnchor("Дуров слушает").asset, ANCHOR_ASSETS.durov);
  assert.equal(resolveAnchor("ПЕСКОВ").asset, ANCHOR_ASSETS.peskov);
  assert.equal(resolveAnchor("Дмитрий Сергеевич кивает").asset, ANCHOR_ASSETS.peskov);
  assert.equal(resolveAnchor("Путин сидит за столом, обращаясь к Дурову.").asset, ANCHOR_ASSETS.putin);
  assert.equal(resolveAnchor("Дуров напротив Путина внимательно слушает.").asset, ANCHOR_ASSETS.durov);
  assert.equal(resolveAnchor("Путин резко окликает Пескова через стол.").asset, ANCHOR_ASSETS.putin);
  assert.equal(resolveAnchor("Аня"), null);
  for (const description of ["Путин", "Дуров", "Песков", "Дмитрий Сергеевич"]) {
    const anchor = resolveAnchor(description);
    assert.equal(anchor.position, ANCHOR_GEOMETRY.position);
    assert.equal(anchor.align, ANCHOR_GEOMETRY.align);
    assert.equal(anchor.zoom, ANCHOR_GEOMETRY.zoom);
    assert.equal(anchor.role, "Базовый образ");
  }
});

test("keeps an unresolved frame in structure mode without changing dialogue", () => {
  const frame = {
    layout: "split2",
    speakerPanel: 0,
    dialogue: putinLine,
    panels: [
      { description: "Путин за столом" },
      { description: "Слушатель без имени" },
    ],
  };
  assert.equal(presentVisualFrame(frame), null);
  assert.equal(frame.dialogue, putinLine);
  assert.deepEqual(frame.panels, [
    { description: "Путин за столом" },
    { description: "Слушатель без имени" },
  ]);
  const canvas = render(frame, { mode: "structure", document: { createElement } });
  assert.equal(canvas.dataset.mode, "structure");
  assert.equal(byClass(canvas, "panel-asset").length, 0);
  assert.deepEqual(byClass(canvas, "panel-description").map((node) => node.textContent), [
    "Путин за столом",
    "Слушатель без имени",
  ]);
  assert.equal(byClass(canvas, "dialogue-text")[0].textContent, putinLine);
});

test("keeps split-panel order and speakerPanel when every panel resolves", () => {
  const frame = {
    layout: "split2",
    speakerPanel: 1,
    dialogue: durovLine,
    fontSize: 31,
    panels: [
      { description: "Дуров смотрит" },
      { description: "Дмитрий Сергеевич отвечает" },
    ],
  };
  const pictured = presentVisualFrame(frame);
  assert.equal(frame.dialogue, durovLine);
  assert.equal(frame.speakerPanel, 1);
  assert.equal(pictured.dialogue, durovLine);
  assert.equal(pictured.speakerPanel, 1);
  assert.deepEqual(pictured.panels.map((panel) => panel.asset), [
    ANCHOR_ASSETS.durov,
    ANCHOR_ASSETS.peskov,
  ]);
  assert.deepEqual(pictured.panels.map((panel) => panel.description), [
    "Дуров смотрит",
    "Дмитрий Сергеевич отвечает",
  ]);
  const canvas = render(pictured, { mode: "visual", document: { createElement } });
  assert.equal(canvas.dataset.mode, "visual");
  assert.equal(canvas.style.width, "1920px");
  assert.equal(canvas.style.height, "1080px");
  const images = byClass(canvas, "panel-asset");
  assert.deepEqual(images.map((image) => image.src), [
    ANCHOR_ASSETS.durov,
    ANCHOR_ASSETS.peskov,
  ]);
  assert.equal(images[0].style.objectPosition, "50% 30%");
  assert.equal(images[0].style.transform, "scale(1)");
  const cells = byClass(canvas, "dialogue-cell");
  assert.equal(byClass(cells[0], "dialogue-text").length, 0);
  assert.equal(byClass(cells[1], "dialogue-text")[0].textContent, durovLine);
});

test("the visual adapter source makes no provider request", () => {
  const source = readFileSync(new URL("../public/visual-anchors.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("fetch"), false);
  assert.equal(source.includes("provider"), false);
  assert.equal(source.includes("/api/"), false);
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (...args) => {
    calls.push(args);
    throw new Error("provider");
  };
  try {
    resolveAnchor("Путин");
    resolveAnchor("Дуров");
    resolveAnchor("Песков");
    resolveAnchor("Дмитрий Сергеевич");
    presentVisualFrame({
      dialogue: durovLine,
      speakerPanel: 1,
      panels: [
        { description: "Дуров смотрит" },
        { description: "Песков отвечает" },
      ],
    });
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = previous;
  }
});

test("places the base-anchor note next to the storyboard", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.equal(html.includes(note), true);
  assert.equal(html.indexOf('id="anchor-note"') < html.indexOf('id="storyboard"'), true);
  assert.match(appJs, /from "\/visual-anchors\.mjs"/);
  assert.match(appJs, /presentVisualFrame\(frame\)/);
  assert.match(appJs, /mode: pictured \? "visual" : "structure"/);
});

test("the last stored frame still opens, with structure fallback for an unknown panel", async () => {
  const board = {
    materialStateId: "m1",
    status: "checked",
    readyEligible: true,
    sourceItems: [
      { id: "u-putin", kind: "utterance", text: putinLine },
      { id: "a-peskov", kind: "action", text: actionLine },
      { id: "u-durov", kind: "utterance", text: durovLine },
    ],
    frames: [
      {
        id: "f-putin",
        layout: "split2",
        origin: "source",
        panels: [
          { description: "Путин за столом" },
          { description: "Слушатель без имени" },
        ],
        sourceItemId: "u-putin",
        sourceRole: "utterance",
        speakerPanel: 0,
        dialogue: putinLine,
        displayBlock: { sourceItemId: "u-putin", start: 0, end: putinLine.length },
      },
      {
        id: "f-action",
        layout: "single",
        origin: "source",
        panels: [{ description: "Песков молчит" }],
        sourceItemId: "a-peskov",
        sourceRole: "action",
        dialogue: "",
        outsideFrameText: actionLine,
      },
      {
        id: "f-durov",
        layout: "split2",
        origin: "source",
        panels: [
          { description: "Дуров смотрит" },
          { description: "Дмитрий Сергеевич отвечает" },
        ],
        sourceItemId: "u-durov",
        sourceRole: "utterance",
        speakerPanel: 1,
        dialogue: durovLine,
        displayBlock: { sourceItemId: "u-durov", start: 0, end: durovLine.length },
      },
    ],
  };
  const projectStore = {
    async loadProject() {
      return {
        draft: { text: "черновик", revisionToken: "11111111-1111-4111-8111-111111111111" },
        activeSourceRevisionId: null,
        activeMaterialStateId: "m1",
        reading: null,
        material: null,
        sourceRevisions: [],
        storyboards: [board],
      };
    },
  };
  const requests = [];
  const server = createServer({ migrate: false, projectStore });
  const port = await listen(server);
  const previousFetch = globalThis.fetch;
  try {
    installDocument(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"));
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      requests.push(path);
      const response = await httpRequest(port, { method: init.method ?? "GET", path });
      return {
        status: response.status,
        ok: response.status === 200,
        async json() {
          return JSON.parse(response.text);
        },
      };
    };
    const registration = register(new URL("./draft-page-loader.mjs", import.meta.url));
    if (registration?.then) await registration;
    const page = await import("../public/app.js");
    await page.draftAutosave.ready;
    const grid = document.querySelector("#storyboard");
    await waitFor(() => grid.children.length === 3);
    const cards = grid.children;
    assert.equal(byClass(cards[0], "panel-asset").length, 0);
    assert.deepEqual(byClass(cards[0], "panel-description").map((node) => node.textContent), [
      "Путин за столом",
      "Слушатель без имени",
    ]);
    assert.equal(byClass(cards[0], "dialogue-text")[0].textContent, putinLine);
    assert.equal(cards[0].dataset.mode ?? byClass(cards[0], "frame-canvas")[0].dataset.mode, "structure");
    assert.equal(byClass(cards[1], "panel-asset")[0].src, ANCHOR_ASSETS.peskov);
    assert.equal(cards[1].children.some((node) => node.textContent === actionLine), true);
    assert.equal(byClass(cards[1], "dialogue-bar").length, 0);
    const lastImages = byClass(cards[2], "panel-asset");
    assert.deepEqual(lastImages.map((image) => image.src), [ANCHOR_ASSETS.durov, ANCHOR_ASSETS.peskov]);
    const lastCells = byClass(cards[2], "dialogue-cell");
    assert.equal(byClass(lastCells[0], "dialogue-text").length, 0);
    assert.equal(byClass(lastCells[1], "dialogue-text")[0].textContent, durovLine);
    assert.equal(document.querySelector("#open-last").hidden, false);
    document.querySelector("#open-last").dispatchEvent({ type: "click" });
    const detail = document.querySelector("#detail");
    assert.equal(detail.open, true);
    const detailImages = byClass(document.querySelector("#detail-frame"), "panel-asset");
    assert.deepEqual(detailImages.map((image) => image.src), [ANCHOR_ASSETS.durov, ANCHOR_ASSETS.peskov]);
    const detailCells = byClass(document.querySelector("#detail-frame"), "dialogue-cell");
    assert.equal(byClass(detailCells[1], "dialogue-text")[0].textContent, durovLine);
    assert.equal(byClass(document.querySelector("#detail-frame"), "frame-canvas")[0].style.width, "1920px");
    assert.deepEqual(requests, ["/api/project", "/api/project"]);
  } finally {
    globalThis.fetch = previousFetch;
    await close(server);
  }
});
