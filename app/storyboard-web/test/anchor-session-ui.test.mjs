globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before, describe } from "node:test";
import { renderAnchorWorkspace } from "../public/anchor-session-ui.mjs";

const SOURCE = "data:image/png;base64,SOURCE";
const ANCHOR = "data:image/png;base64,ANCHOR";
const C1 = "data:image/png;base64,C1";
const VIEWPORT = 800;

let host = null;
let posts = [];
let fetchImpl = () => Promise.resolve({ imageDataUrl: C1 });

function createElement(tag = "div") {
  const listeners = new Map();
  const element = {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    text: "",
    value: "",
    disabled: false,
    inert: false,
    hidden: false,
    type: "",
    scrollTop: 0,
    scrollHeight: 0,
    attrs: {},
    children: [],
    parentNode: null,
    style: {},
    get textContent() {
      const nested = (this.children || []).map((child) => child.textContent || "").join("");
      return `${this.text || ""}${nested}`;
    },
    set textContent(value) {
      this.text = String(value ?? "");
    },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === "disabled") this.disabled = true;
      if (name === "id") this.id = String(value);
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const payload = event && typeof event === "object" ? event : { type: event };
      if (!payload.preventDefault) payload.preventDefault = () => {};
      for (const listener of listeners.get(payload.type) ?? []) listener(payload);
    },
    append(...nodes) {
      for (const node of nodes) {
        if (!node) continue;
        if (node.parentNode?.children) {
          const index = node.parentNode.children.indexOf(node);
          if (index >= 0) node.parentNode.children.splice(index, 1);
        }
        node.parentNode = this;
        this.children.push(node);
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this.append(...nodes);
    },
    remove() {
      const parent = this.parentNode;
      if (!parent?.children) return;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parentNode = null;
    },
    contains(node) {
      if (node === this) return true;
      return this.children.some((child) => child.contains?.(node));
    },
    focus() {
      activeElement = this;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return queryAll(this, selector);
    },
    getBoundingClientRect() {
      return boxFor(this);
    },
  };
  return element;
}

function queryAll(root, selector) {
  const parts = String(selector).split(",").map((part) => part.trim()).filter(Boolean);
  const out = [];
  const visit = (node) => {
    for (const child of node.children || []) {
      if (parts.some((part) => matches(child, part))) out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

function matches(node, selector) {
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith(".")) return String(node.className || "").split(/\s+/).includes(selector.slice(1));
  const attr = selector.match(/^([a-zA-Z0-9-]*)\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
  if (attr) {
    const tag = attr[1];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    if (attr[3] == null) return node.attrs[attr[2]] != null;
    return node.attrs[attr[2]] === attr[3];
  }
  return node.tagName === selector.toUpperCase();
}

function boxFor(node) {
  const cardHeight = 168;
  let current = node;
  let dialog = null;
  let layer = null;
  while (current) {
    const classes = String(current.className || "").split(/\s+/);
    if (!dialog && classes.includes("anchor-dialog")) dialog = current;
    if (!layer && classes.includes("anchor-confirm-layer")) layer = current;
    current = current.parentNode;
  }
  if (layer && !dialog) {
    const top = (VIEWPORT - cardHeight) / 2;
    return { top, bottom: top + cardHeight, left: 16, right: 436, width: 420, height: cardHeight };
  }
  if (dialog) {
    const top = (Number(dialog.scrollHeight) || cardHeight) - cardHeight - (Number(dialog.scrollTop) || 0);
    return { top, bottom: top + cardHeight, left: 16, right: 436, width: 420, height: cardHeight };
  }
  return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
}

let activeElement = null;
const keyListeners = [];

function installDocument() {
  const body = createElement("body");
  host = createElement("div");
  host.id = "character-cards";
  body.append(host);
  globalThis.innerHeight = VIEWPORT;
  globalThis.CSS = globalThis.CSS || { escape(value) { return String(value); } };
  globalThis.document = {
    body,
    get activeElement() {
      return activeElement;
    },
    createElement,
    getElementById(id) {
      return body.querySelector(`#${id}`);
    },
    querySelector(selector) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
    addEventListener(type, listener) {
      if (type === "keydown") keyListeners.push(listener);
    },
    dispatchEvent(event) {
      const payload = event && typeof event === "object" ? event : { type: event };
      if (!payload.preventDefault) payload.preventDefault = () => {};
      if (payload.type === "keydown") {
        for (const listener of keyListeners) listener(payload);
      }
    },
  };
}

function sourcedCharacter() {
  return {
    name: "Mira",
    approvedAnchorId: "anchor-1",
    approvedAssetId: "anchor-asset-1",
    approvedAssetUrl: ANCHOR,
    anchorProvenance: "generated_from_source",
    sourcePhoto: { assetId: "source-1", assetUrl: SOURCE },
  };
}

function uploadedCharacter() {
  return {
    name: "Mira",
    approvedAnchorId: "anchor-2",
    approvedAssetId: "anchor-asset-2",
    approvedAssetUrl: ANCHOR,
    anchorProvenance: "uploaded_as_ready_anchor",
  };
}

function mount(characters) {
  posts = [];
  renderAnchorWorkspace({
    root: host,
    characters,
    async runProductResearchAction({ operation }) {
      return operation();
    },
    fetchJson(_path, options) {
      const body = JSON.parse(options.body);
      posts.push(body);
      return fetchImpl(body);
    },
    characterActionContextOverrides() {
      return {};
    },
    applyVisual() {},
  });
}

function buttonByText(text) {
  return [...document.querySelectorAll("button")].find((node) => node.textContent === text) ?? null;
}

function click(id) {
  document.getElementById(id).dispatchEvent({ type: "click" });
}

function typeInstruction(value) {
  const area = document.getElementById("draft-instruction");
  area.value = value;
  area.dispatchEvent({ type: "input" });
  return area;
}

function key(name, extra = {}) {
  const event = {
    type: "keydown",
    key: name,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra,
  };
  document.dispatchEvent(event);
  return event;
}

function forceClose() {
  if (document.getElementById("notice-confirm")) click("notice-confirm");
  if (document.getElementById("draft-cancel")) click("draft-cancel");
  if (document.getElementById("notice-confirm")) click("notice-confirm");
}

describe("anchor refine actions and centered confirmation", { concurrency: false }, () => {
  before(() => {
    installDocument();
    fetchImpl = () => Promise.resolve({ imageDataUrl: C1 });
    mount([sourcedCharacter()]);
  });

  test("initial refine renders both actions and sends one matching provider request", async () => {
    forceClose();
    fetchImpl = () => Promise.resolve({ imageDataUrl: C1 });
    mount([sourcedCharacter()]);
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    const primary = document.getElementById("generate");
    const source = document.getElementById("generate-from-source");
    assert.equal(primary.textContent, "Создать вариант с уточнением");
    assert.equal(primary.disabled, true);
    assert.equal(source.textContent, "Создать вариант от исходного фото");
    assert.equal(source.disabled, false);
    assert.equal(document.getElementById("generation-basis").textContent, "Для варианта с уточнением основа — текущий принятый образ.");
    assert.equal(document.getElementById("instruction-hint").textContent, "Для уточнения принятого образа инструкция обязательна. Вариант от исходного фото можно создать без инструкции.");
    assert.deepEqual([...document.querySelector(".generate-actions").querySelectorAll("button")].map((node) => node.id), [
      "generate",
      "generate-from-source",
    ]);

    typeInstruction("   ");
    assert.equal(document.getElementById("generate").disabled, true);
    assert.equal(document.getElementById("generate-from-source").disabled, false);
    click("generate-from-source");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].basis, "from-source");
    assert.equal(posts[0].sourceImage, SOURCE);
    assert.equal(posts[0].previousImage, null);
    assert.equal(posts[0].anchorImage, null);
    assert.equal(posts[0].anchorAssetId, null);
    assert.equal(posts[0].instruction, "");
    click("generate");
    click("generate-from-source");
    assert.equal(posts.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    forceClose();
    posts = [];
    mount([sourcedCharacter()]);
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    typeInstruction("теплее фон");
    assert.equal(document.getElementById("generate").disabled, false);
    assert.equal(document.getElementById("generate-from-source").disabled, false);
    click("generate");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].basis, "accepted");
    assert.equal(posts[0].instruction, "теплее фон");
    assert.equal(posts[0].anchorImage, ANCHOR);
    assert.equal(posts[0].previousImage, null);
    click("generate-from-source");
    assert.equal(posts.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("a typed source request is included once and an upload has no source action", async () => {
    forceClose();
    fetchImpl = () => Promise.resolve({ imageDataUrl: C1 });
    mount([sourcedCharacter()]);
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    typeInstruction("  мягче свет  ");
    click("generate-from-source");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].basis, "from-source");
    assert.equal(posts[0].instruction, "мягче свет");
    assert.equal(posts[0].sourceImage, SOURCE);
    assert.equal(posts[0].previousImage, null);
    assert.equal(posts[0].anchorImage, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.querySelector(".position")?.textContent, "Вариант 1 из 1");
    assert.equal(document.getElementById("candidate-origin")?.textContent, "Этот вариант создан от исходного фото.");
    assert.equal(document.getElementById("generate").textContent, "Создать вариант на основе выбранного");
    assert.equal(document.getElementById("generation-basis").textContent, "Для первой кнопки основа — Вариант 1.");
    assert.equal(/Основа следующего варианта/.test(document.getElementById("generation-basis").textContent), false);
    assert.match(document.getElementById("instruction-hint").textContent, /необязательн/i);

    forceClose();
    mount([uploadedCharacter()]);
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    assert.equal(document.getElementById("generate").textContent, "Создать вариант с уточнением");
    assert.equal(document.getElementById("generate").disabled, true);
    assert.equal(document.getElementById("generate-from-source"), null);
    assert.equal(document.getElementById("generation-basis").textContent, "Основа следующего варианта: текущий принятый образ.");
  });

  test("dirty-draft confirmation is a centered inert overlay with a focus trap", async () => {
    forceClose();
    fetchImpl = () => Promise.resolve({ imageDataUrl: C1 });
    mount([sourcedCharacter()]);
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    typeInstruction("строже");
    click("generate");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.querySelector(".position").textContent, "Вариант 1 из 1");

    click("draft-close");
    const overlay = document.getElementById("anchor-session-overlay");
    const dialog = document.querySelector(".anchor-dialog");
    const layer = document.querySelector(".anchor-confirm-layer");
    const alert = document.querySelector("[role=alertdialog]");
    assert.equal(document.querySelectorAll(".anchor-overlay").length, 1);
    assert.equal(document.querySelectorAll("[role=alertdialog]").length, 1);
    assert.equal(layer.parentNode, overlay);
    assert.equal(dialog.parentNode, overlay);
    assert.equal(dialog.contains(layer), false);
    assert.equal(dialog.contains(alert), false);
    assert.ok(layer.querySelector(".anchor-confirm-scrim"));
    assert.equal(dialog.inert, true);
    assert.equal(alert.getAttribute("aria-modal"), "true");
    assert.equal(alert.getAttribute("aria-labelledby"), "anchor-notice-title");
    assert.equal(alert.getAttribute("aria-describedby"), "anchor-notice-text");
    assert.equal(document.getElementById("anchor-notice-title").textContent, "Закрыть черновик?");
    assert.equal(document.activeElement.id, "notice-dismiss");
    assert.equal(document.activeElement.textContent, "Продолжить работу");

    dialog.scrollHeight = 4800;
    dialog.scrollTop = 3600;
    const box = document.querySelector(".anchor-confirm").getBoundingClientRect();
    assert.ok(box.top >= 0 && box.bottom <= VIEWPORT);

    const tab = key("Tab");
    assert.equal(tab.defaultPrevented, true);
    assert.equal(document.activeElement.id, "notice-confirm");
    key("Tab", { shiftKey: true });
    assert.equal(document.activeElement.id, "notice-dismiss");
    key("Tab", { shiftKey: true });
    assert.equal(document.activeElement.id, "notice-confirm");
    assert.equal(document.getElementById("draft-instruction").value, "строже");

    key("Escape");
    assert.equal(document.querySelector("[role=alertdialog]"), null);
    assert.ok(document.querySelector(".anchor-dialog"));
    assert.equal(document.getElementById("draft-instruction").value, "строже");
    assert.equal(document.querySelector(".position").textContent, "Вариант 1 из 1");
    assert.equal(document.activeElement.id, "draft-close");

    key("Escape");
    assert.equal(document.querySelectorAll("[role=alertdialog]").length, 1);
    assert.ok(document.getElementById("draft-instruction"));
    key("Escape");
    assert.equal(document.querySelector("[role=alertdialog]"), null);
    assert.equal(document.getElementById("draft-instruction").value, "строже");

    click("draft-cancel");
    assert.equal(document.activeElement.textContent, "Продолжить работу");
    click("notice-dismiss");
    assert.equal(document.querySelector("[role=alertdialog]"), null);
    assert.equal(document.getElementById("draft-instruction").value, "строже");
    assert.equal(document.querySelector(".position").textContent, "Вариант 1 из 1");
    assert.equal(document.activeElement.id, "draft-cancel");

    click("draft-close");
    click("notice-dismiss");
    assert.equal(document.activeElement.id, "draft-close");
    key("Escape");
    assert.equal(document.querySelectorAll(".anchor-confirm-layer").length, 1);
    assert.equal(document.querySelectorAll(".anchor-overlay").length, 1);
    click("notice-confirm");
    assert.equal(document.getElementById("anchor-session-overlay"), null);
    assert.equal(document.querySelectorAll(".anchor-confirm-layer").length, 0);
    assert.equal(document.activeElement.id, "launch-refine-Mira");
    assert.equal(keyListeners.length, 1);

    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    typeInstruction("ещё");
    for (let index = 0; index < 3; index += 1) {
      key("Escape");
      assert.equal(document.querySelectorAll("[role=alertdialog]").length, 1);
      assert.equal(document.querySelectorAll(".anchor-overlay").length, 1);
      key("Escape");
      assert.equal(document.querySelectorAll("[role=alertdialog]").length, 0);
    }
    assert.equal(document.getElementById("draft-instruction").value, "ещё");
    assert.equal(keyListeners.length, 1);
    assert.equal(/window\.confirm|window\.alert/.test(readFileSync(new URL("../public/anchor-session-ui.mjs", import.meta.url), "utf8")), false);
  });

  test("accepting a source-origin refine candidate reuses the identity asset", async () => {
    forceClose();
    const requests = [];
    let characters = [{
      name: "Mira",
      approvedAnchorId: "anchor-1",
      approvedAssetId: "anchor-asset-1",
      approvedAssetUrl: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/anchor-asset-1",
      anchorProvenance: "generated_from_source",
      sourcePhoto: { assetId: "source-1", assetUrl: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/source-1" },
    }];
    const mountRetained = () => {
      renderAnchorWorkspace({
        root: host,
        characters,
        async runProductResearchAction({ operation }) {
          return operation();
        },
        fetchJson(path, options) {
          const body = JSON.parse(options.body);
          requests.push({ path, body });
          if (String(path).endsWith("/anchor-accept")) {
            return {
              status: "ready",
              characters: [{
                name: "Mira",
                approvedAnchorId: "anchor-accepted",
                approvedAssetId: "output-1",
                approvedAssetUrl: C1,
                anchorProvenance: body.provenance,
                sourcePhoto: {
                  assetId: body.sourceAssetId || "source-1",
                  assetUrl: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/source-1",
                },
              }],
            };
          }
          return { imageDataUrl: C1 };
        },
        applyVisual(next) {
          characters = next.characters;
          mountRetained();
        },
        characterActionContextOverrides() {
          return {};
        },
      });
    };
    mountRetained();
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    click("generate-from-source");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.querySelector(".position").textContent, "Вариант 1 из 1");
    click("draft-accept");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const accept = requests.find((entry) => entry.path.endsWith("/anchor-accept"));
    assert.equal(accept.body.provenance, "generated_from_source");
    assert.equal(accept.body.sourceAssetId, "source-1");
    assert.equal(accept.body.sourceImageDataUrl, undefined);
    assert.equal(accept.body.imageDataUrl, C1);
    assert.equal(requests.filter((entry) => entry.path.endsWith("/anchor-session")).length, 1);
    const captions = [...document.querySelectorAll("figcaption")].map((node) => node.textContent);
    assert.ok(captions.includes("Сгенерирован по исходному фото"));
    assert.ok(captions.includes("Исходное фото"));
    assert.equal(
      [...document.querySelectorAll("img")].some((img) => img.getAttribute("src") === "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/source-1"),
      true,
    );

    requests.length = 0;
    characters = [{
      name: "Mira",
      approvedAnchorId: "anchor-1",
      approvedAssetId: "anchor-asset-1",
      approvedAssetUrl: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/anchor-asset-1",
      anchorProvenance: "generated_from_source",
      sourcePhoto: { assetId: "source-1", assetUrl: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/source-1" },
    }];
    mountRetained();
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    typeInstruction("строже");
    click("generate");
    await new Promise((resolve) => setTimeout(resolve, 0));
    click("draft-accept");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refined = requests.find((entry) => entry.path.endsWith("/anchor-accept"));
    assert.equal(refined.body.provenance, "refined_from_accepted_anchor");
    assert.equal(refined.body.sourceAssetId, undefined);
    assert.equal(refined.body.sourceImageDataUrl, undefined);
    const refinedCaptions = [...document.querySelectorAll("figcaption")].map((node) => node.textContent);
    assert.ok(refinedCaptions.includes("Уточнён по принятому образу"));
  });

  test("a hung anchor generation times out once and a manual retry is a new request", async () => {
    forceClose();
    const requests = [];
    let mode = "ok";
    let releaseLate = null;
    const C2 = "data:image/png;base64,C2";
    const LATE = "data:image/png;base64,LATE";
    renderAnchorWorkspace({
      root: host,
      characters: [sourcedCharacter()],
      anchorClientTimeoutMs: 40,
      async runProductResearchAction({ operation }) {
        return operation();
      },
      fetchJson(_path, options) {
        const body = JSON.parse(options.body);
        requests.push({ body, signal: options.signal });
        if (mode === "hang") {
          return new Promise((resolve) => {
            releaseLate = () => resolve({ imageDataUrl: LATE });
          });
        }
        return Promise.resolve({ imageDataUrl: requests.length === 1 ? C1 : C2 });
      },
      characterActionContextOverrides() {
        return {};
      },
      applyVisual() {},
    });
    buttonByText("Уточнить образ").dispatchEvent({ type: "click" });
    typeInstruction("строже");
    click("generate");
    await new Promise((resolve) => setTimeout(resolve, 0));
    click("generate");
    await new Promise((resolve) => setTimeout(resolve, 0));
    click("variant-undo");
    assert.equal(document.querySelector(".position").textContent, "Вариант 1 из 2");
    mode = "hang";
    const before = requests.length;
    click("generate");
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).signal.aborted, false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(requests.at(-1).signal.aborted, true);
    assert.equal(document.querySelector(".error").textContent, "Создание заняло больше минуты. Попробуйте ещё раз.");
    assert.equal(document.getElementById("draft-instruction").value, "строже");
    assert.equal(document.querySelector(".position").textContent, "Вариант 1 из 2");
    assert.equal(document.getElementById("generation-basis").textContent, "Для первой кнопки основа — Вариант 1.");
    assert.equal(document.getElementById("generate").disabled, false);
    assert.equal(document.getElementById("generate-from-source").disabled, false);
    assert.equal(requests.length, before + 1);
    mode = "ok";
    click("generate");
    assert.equal(requests.length, before + 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseLate();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(document.querySelector(".position").textContent, "Вариант 3 из 3");
    const sources = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    assert.equal(sources.includes(LATE), false);
    assert.equal(sources.includes(C2), true);
    assert.equal(requests.length, before + 2);
  });

  test("confirmation stays in the viewport because it is outside the scrolling dialog", () => {
    const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
    assert.match(css, /\.anchor-dialog\s*\{[^}]*overflow:\s*auto/s);
    assert.match(css, /\.anchor-confirm-layer\s*\{[^}]*position:\s*(?:fixed|absolute)/s);
    assert.match(css, /\.anchor-confirm-layer\s*\{[^}]*inset:\s*0/s);
    assert.match(css, /\.anchor-confirm-scrim\s*\{[^}]*background:/s);
  });
});
