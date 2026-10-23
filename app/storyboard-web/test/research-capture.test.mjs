globalThis.location = { pathname: "/projects/00000000-0000-4000-8000-000000000001" };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

const researchPosts = [];
const productPosts = [];
let page = null;
let fetchImpl = null;

function createElement(tag = "div") {
  const listeners = new Map();
  const element = {
    tagName: String(tag).toUpperCase(),
    id: "",
    hidden: false,
    textContent: "",
    value: "",
    type: "",
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
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
    },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[key] = String(value);
      }
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
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentNode = null;
      this.children = nodes.slice();
      for (const child of this.children) child.parentNode = this;
      this.textContent = "";
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node?.parentNode?.children) {
          const idx = node.parentNode.children.indexOf(node);
          if (idx >= 0) node.parentNode.children.splice(idx, 1);
        }
        if (node) {
          node.parentNode = this;
          this.children.push(node);
        }
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const out = [];
      const visit = (node) => {
        if (!node || node === this) {
          for (const child of node?.children || []) visit(child);
          return;
        }
        if (matches(node, selector)) out.push(node);
        for (const child of node.children || []) visit(child);
      };
      for (const child of this.children) visit(child);
      return out;
    },
  };
  return element;
}

function matches(node, selector) {
  if (!selector) return false;
  if (selector.startsWith(".")) return String(node.className || "").split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.includes("[")) {
    const tag = selector.replace(/\[.*/, "").toUpperCase();
    if (tag && node.tagName !== tag) return false;
    const attr = selector.match(/\[([^\]]+)\]/)?.[1];
    if (!attr) return true;
    if (attr.startsWith("data-")) {
      const key = attr.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      return node.dataset?.[key] != null;
    }
    return node.getAttribute?.(attr) != null || node[attr] != null;
  }
  return node.tagName === selector.toUpperCase();
}

function installDocument(html) {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const el = createElement();
    el.id = match[1];
    elements.set(match[1], el);
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
  globalThis.document = {
    body,
    fonts: { ready: Promise.resolve() },
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      return elements.get(selector.slice(1)) ?? null;
    },
    createElement,
  };
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    globalThis.crypto = {
      randomUUID() {
        return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
      },
    };
  }
  globalThis.FileReader = class {
    readAsDataURL() {
      queueMicrotask(() => {
        this.result = "data:image/png;base64,aGVsbG8=";
        this.onload?.();
      });
    }
  };
  return elements;
}

function statusText() {
  const status = document.querySelector("#action-status");
  return [status?.textContent, ...(status?.children || []).map((child) => child.textContent || "")].join(" ");
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

function readyVisual(overrides = {}) {
  return {
    status: "ready",
    storyboardVersionId: "sv-1",
    canUndo: true,
    allAnchorsApproved: true,
    complete: true,
    approved: false,
    readyForVideo: false,
    characters: [{
      name: "Путин",
      identity: { assetId: "identity-asset-1", assetUrl: "/id.png", comment: "исходный" },
      candidate: { id: "anchor-1", assetId: "anchor-asset-1", assetUrl: "/a.png", status: "ready" },
      approvedAnchorId: null,
    }],
    frames: [{
      id: "display-1",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      layout: "split2",
      speakerPanel: 0,
      dialogue: "Привет",
      outsideFrameText: "",
      visualReady: true,
      panels: [{
        description: "слева",
        subject: "Путин",
        assetId: "asset-1",
        zoom: 1.2,
      }, {
        description: "справа",
        subject: "Дуров",
        assetId: "asset-2",
        zoom: 1,
      }],
    }],
    ...overrides,
  };
}

function assertFixedContextKeys(context) {
  assert.ok(context && typeof context === "object");
  for (const key of [
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
  ]) {
    assert.equal(Object.hasOwn(context, key), true, `missing context key ${key}`);
  }
}

function assertCastEditTargetShape(editTarget, expected) {
  assert.equal(editTarget.editKind, expected.editKind);
  assert.equal(editTarget.castPhase, expected.castPhase);
  assert.equal(editTarget.characterName, expected.characterName);
  assert.equal(editTarget.previousCharacterName, expected.previousCharacterName ?? null);
  assert.equal(editTarget.surfaceForm, expected.surfaceForm ?? null);
  assert.equal(editTarget.sourceItemId, expected.sourceItemId ?? null);
  assert.deepEqual(Object.keys(editTarget).sort(), [
    "castPhase",
    "characterName",
    "editKind",
    "previousCharacterName",
    "sourceItemId",
    "surfaceForm",
  ]);
}

function assertSingleCastPair(editKind, castPhase) {
  const starts = researchStarts("cast_edit").filter((event) => (
    event.editTarget?.editKind === editKind
    && event.editTarget?.castPhase === castPhase
  ));
  assert.equal(starts.length, 1, `expected one start for ${editKind}/${castPhase}`);
  const start = starts[0];
  const terminals = researchPosts.filter((event) => (
    event.eventKind === "action_terminal"
    && event.correlationId === start.correlationId
  ));
  assert.equal(terminals.length, 1, `expected one terminal for ${editKind}/${castPhase}`);
  assert.equal(terminals[0].outcome, "success");
  return { start, terminal: terminals[0] };
}

function castReviewState(mode, castOverrides = {}) {
  const baseCast = {
    characters: [{ name: "Путин" }, { name: "Дуров" }],
    aliases: [{ surface: "Владимир", characterName: "Путин" }],
    speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
    ...castOverrides,
  };
  return {
    id: mode === "reading" ? "reading-1" : "material-1",
    text: "текст",
    sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Реплика" }],
    cast: baseCast,
    surfaceForms: [{ quote: "Владимир" }],
    findings: [],
  };
}

function researchStarts(action) {
  return researchPosts.filter((event) => (
    event.eventKind === "action_start"
    && event.semanticAction === action
    && event.surface === "product_control"
  ));
}

function researchPair(action) {
  const start = researchStarts(action).at(-1);
  assert.ok(start, `missing start for ${action}`);
  const terminal = researchPosts.find((event) => (
    event.eventKind === "action_terminal"
    && event.correlationId === start.correlationId
  ));
  assert.ok(terminal, `missing terminal for ${action}`);
  return { start, terminal };
}

async function loadCapturePage() {
  researchPosts.length = 0;
  productPosts.length = 0;
  installDocument(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"));
  fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url, "http://127.0.0.1");
    const path = parsed.pathname + parsed.search;
    const method = init.method ?? "GET";
    const scripted = (globalThis.__visualScript || []).find((entry) => entry.path === path && (entry.method || "POST") === method);
    if (scripted) {
      globalThis.__visualScript = globalThis.__visualScript.filter((entry) => entry !== scripted);
      let scriptBody = null;
      if (init.body != null) {
        try {
          scriptBody = JSON.parse(init.body);
        } catch {
          scriptBody = init.body;
        }
      }
      productPosts.push({ path, method, body: scriptBody, headers: init.headers || {} });
      return jsonResponse(scripted.status || 200, typeof scripted.body === "function" ? scripted.body(scriptBody) : scripted.body);
    }
    let body = null;
    if (init.body != null) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/events") && method === "POST") {
      researchPosts.push(body);
      const start = body.eventKind === "action_terminal"
        ? researchPosts.find((event) => (
          event.eventKind === "action_start" && event.correlationId === body.correlationId
        ))
        : null;
      return jsonResponse(201, {
        event: {
          ...body,
          semanticAction: body.semanticAction ?? start?.semanticAction ?? null,
          surface: body.surface ?? start?.surface ?? null,
          submittedText: body.submittedText ?? start?.submittedText ?? null,
          commandTarget: body.commandTarget ?? start?.commandTarget ?? null,
          editTarget: body.editTarget ?? start?.editTarget ?? null,
          context: {
            ...(start?.context && typeof start.context === "object" ? start.context : {}),
            ...(body.context && typeof body.context === "object" ? body.context : {}),
            ...(body.eventKind === "action_terminal" && body.resultContext && typeof body.resultContext === "object"
              ? body.resultContext
              : {}),
          },
          seq: researchPosts.length,
          occurredAt: `2026-10-13T12:00:${String(researchPosts.length).padStart(2, "0")}.000Z`,
          durationMs: body.eventKind === "action_terminal" ? 12 : null,
        },
      });
    }
    if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/trace")) return jsonResponse(200, { events: [] });
    if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/research/notes")) return jsonResponse(201, { event: { eventKind: "note" } });
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001") {
      return jsonResponse(200, {
        draft: {
          text: "",
          revisionToken: "11111111-1111-4111-8111-111111111111",
        },
      });
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/draft") {
      return jsonResponse(200, {
        revisionToken: "22222222-2222-4222-8222-222222222222",
        text: typeof body?.text === "string" ? body.text : (document.querySelector("#draft")?.value || ""),
      });
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/visual") return jsonResponse(200, { status: "missing" });

    productPosts.push({ path, method, body, headers: init.headers || {} });

    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/readings" && method === "POST") {
      return jsonResponse(200, {
        status: "ready",
        id: "reading-1",
        text: document.querySelector("#draft").value,
        sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Реплика" }],
        cast: { characters: [{ name: "Путин" }], aliases: [], speakers: [] },
        surfaceForms: [{ quote: "Владимир" }],
        findings: [],
      });
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/confirmations" && method === "POST") {
      return jsonResponse(200, { materialStateId: "material-1" });
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/storyboard-results" && method === "POST") {
      return jsonResponse(200, {
        status: "checked",
        frames: readyVisual().frames,
        sourceItems: [],
        readyEligible: true,
      });
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit") {
      return jsonResponse(200, readyVisual({ canUndo: true, undoLabel: "вставку кадра" }));
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo") {
      return jsonResponse(200, readyVisual({
        canUndo: false,
        undoLabel: null,
        undoneLabel: "вставку кадра",
        undoneTarget: { displayFrameNumber: 2, op: "insertFrame" },
      }));
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/approve") return jsonResponse(200, readyVisual({ approved: true, readyForVideo: true }));
    if (/\/api\/visual\/frames\/[^/]+\/generate$/.test(path)) return jsonResponse(200, readyVisual());
    if (/\/api\/visual\/frames\/[^/]+\/panels\/\d+\/generate$/.test(path)) {
      return jsonResponse(200, readyVisual());
    }
    if (/\/api\/visual\/frames\/[^/]+\/panels\/\d+\/placement$/.test(path)) {
      return jsonResponse(200, readyVisual());
    }
    if (/\/anchor-session$/.test(path)) {
      return jsonResponse(200, { status: "ready", imageDataUrl: "data:image/png;base64,aGVsbG8=", mime: "image/png" });
    }
    if (/\/anchor-accept$/.test(path)) {
      return jsonResponse(200, readyVisual({
        characters: [{
          name: "Путин",
          approvedAnchorId: "anchor-2",
          approvedAssetId: "anchor-asset-2",
          approvedAssetUrl: "/a2.png",
          anchorProvenance: "refined_from_accepted_anchor",
          sourcePhoto: { assetId: "identity-asset-1", assetUrl: "/id.png" },
          identity: { assetId: "identity-asset-1", assetUrl: "/id.png", comment: "" },
        }],
      }));
    }
    if (/\/identity$/.test(path)) return jsonResponse(200, readyVisual());
    if (/\/anchor-session$/.test(path)) {
      return jsonResponse(200, { status: "ready", imageDataUrl: "data:image/png;base64,YQ==", mime: "image/png" });
    }
    if (/\/anchor-accept$/.test(path)) {
      return jsonResponse(200, readyVisual({
        characters: [{
          name: "Путин",
          approvedAnchorId: "anchor-1",
          approvedAssetId: "anchor-asset-1",
          approvedAssetUrl: "/a.png",
          anchorProvenance: "refined_from_accepted_anchor",
          sourcePhoto: { assetId: "identity-asset-1", assetUrl: "/id.png" },
        }],
      }));
    }
    if (/\/anchor$/.test(path)) {
      return jsonResponse(200, readyVisual({
        characters: [{
          name: "Путин",
          identity: { assetUrl: "/id.png", comment: "коммент" },
          candidate: { id: "anchor-2", assetUrl: "/a2.png", status: "ready" },
          approvedAnchorId: null,
        }],
      }));
    }
    if (/\/approve$/.test(path) && path.includes("/anchors/")) {
      return jsonResponse(200, readyVisual({
        characters: [{
          name: "Путин",
          identity: { assetUrl: "/id.png", comment: "коммент" },
          candidate: { id: "anchor-1", assetUrl: "/a.png", status: "ready" },
          approvedAnchorId: "anchor-1",
        }],
      }));
    }
    if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/readings/") && path.endsWith("/cast") && method === "PUT") {
      return jsonResponse(200, { ok: true });
    }
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/material-states" && method === "POST") {
      return jsonResponse(200, { materialStateId: "material-1" });
    }
    return jsonResponse(404, { kind: "not-found" });
  };
  globalThis.fetch = (...args) => fetchImpl(...args);
  register(new URL("./draft-page-loader.mjs", import.meta.url));
  page = await import("../public/app.js");
  await page.draftAutosave.ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
  researchPosts.length = 0;
  productPosts.length = 0;
  return page;
}

async function ensurePage() {
  if (!page) await loadCapturePage();
  researchPosts.length = 0;
  productPosts.length = 0;
  return page;
}

test("reading submit captures full draft with commandTarget.kind=none", async () => {
  await ensurePage();
  const draft = "полный черновик для reading capture\nвторая строка";
  document.querySelector("#draft").value = draft;
  document.querySelector("#draft-form").dispatchEvent({ type: "submit", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { start, terminal } = researchPair("reading");
  assert.equal(start.submittedText, draft);
  assert.equal(start.commandTarget.kind, "none");
  assert.equal(start.editTarget, null);
  assert.equal(terminal.outcome, "success");
  assert.ok(productPosts.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/readings"));
});

test("confirm_material and stage_storyboard capture without submitted text", async () => {
  await ensurePage();
  const readingText = "текст подтверждения";
  document.querySelector("#draft").value = readingText;
  assert.equal(await page.draftAutosave.flush(), true);
  page.setResearchReviewState({
    id: "reading-1",
    text: readingText,
    sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Реплика" }],
    cast: {
      characters: [{ name: "Путин" }],
      aliases: [],
      speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
    },
    surfaceForms: [],
    findings: [],
  }, "reading");
  researchPosts.length = 0;
  const confirm = document.querySelector("#confirm-material");
  confirm.disabled = false;
  confirm.hidden = false;
  confirm.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const confirmPair = researchPair("confirm_material");
  assert.equal(confirmPair.start.submittedText, null);
  assert.equal(confirmPair.start.commandTarget.kind, "none");
  assert.equal(confirmPair.terminal.outcome, "success");

  researchPosts.length = 0;
  page.setResearchReviewState({
    id: "material-1",
    text: readingText,
    sourceItems: [],
    cast: { characters: [{ name: "Путин" }], aliases: [], speakers: [] },
    surfaceForms: [],
    findings: [],
  }, "material");
  const stage = document.querySelector("#stage-material");
  stage.hidden = false;
  stage.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stagePair = researchPair("stage_storyboard");
  assert.equal(stagePair.start.submittedText, null);
  assert.equal(stagePair.start.commandTarget.kind, "storyboard");
  assert.equal(stagePair.terminal.outcome, "success");
});

test("structure_edit and global undo capture storyboard targets on product controls", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual());
  document.querySelector("#structure-instruction").value = "сделай кадры плотнее";
  document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const edit = researchPair("structure_edit");
  assert.equal(edit.start.submittedText, "сделай кадры плотнее");
  assert.equal(edit.start.commandTarget.kind, "storyboard");
  assert.equal(edit.start.surface, "product_control");
  assert.equal(edit.terminal.outcome, "success");

  researchPosts.length = 0;
  assert.equal(document.querySelector("#undo-structure"), null);
  document.querySelector("#global-undo").disabled = false;
  document.querySelector("#global-undo").hidden = false;
  document.querySelector("#global-undo").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const undo = researchPair("storyboard_undo");
  assert.equal(undo.start.submittedText, null);
  assert.equal(undo.start.commandTarget.kind, "storyboard");
  assert.equal(undo.terminal.outcome, "success");
  const request = productPosts.find((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo");
  assert.deepEqual(request.body, {});
  assert.match(JSON.stringify(request.headers).toLowerCase(), /application\/json/);
  assert.match(statusText(), /Отменено: вставку кадра · кадр 2/);
  assert.equal(/Предыдущая структура восстановлена/.test(document.body.textContent || ""), false);
});

test("frame_generate and panel_generate capture display/structure identity; panel omits performance image", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), 0);
  const generateButtons = document.querySelector("#storyboard").querySelectorAll("button.generate-frame");
  if (generateButtons.length) {
    generateButtons[0].dispatchEvent({ type: "click" });
  } else {
    await page.runResearchFrameGenerate?.("display-1", 0);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Prefer exported seam if card button path unavailable in stub grid.
  if (!researchStarts("frame_generate").length) {
    await page.captureTestGenerateFrame("display-1", 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const frame = researchPair("frame_generate");
  assert.equal(frame.start.submittedText, null);
  assert.equal(frame.start.commandTarget.kind, "frame");
  assert.equal(frame.start.commandTarget.displayFrameId, "display-1");
  assert.equal(frame.start.commandTarget.structureFrameId, "structure-1");
  assert.equal(frame.start.commandTarget.structureSegmentIndex, 0);
  assert.notEqual(frame.start.commandTarget.displayFrameId, frame.start.commandTarget.structureFrameId);
  assertFixedContextKeys(frame.start.context);
  assert.equal(frame.start.context.displayFrameNumber, 1);
  assert.equal(frame.start.context.displayFrameId, "display-1");
  assert.equal(frame.start.context.structureFrameId, "structure-1");
  assert.equal(frame.start.context.structureSegmentIndex, 0);
  assert.equal(frame.start.context.panelIndex, null);
  assert.equal(frame.start.context.panelSubject, null);
  assert.equal(frame.start.context.imageAssetId, null);
  assert.equal(frame.start.context.generationId, null);

  researchPosts.length = 0;
  productPosts.length = 0;
  page.setResearchVisualState(readyVisual({
    frames: [{
      id: "display-1",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      layout: "split2",
      speakerPanel: 0,
      dialogue: "Привет",
      outsideFrameText: "",
      visualReady: true,
      panels: [{
        description: "слева",
        subject: "Путин",
        assetId: "asset-1",
        generationId: "gen-panel-1",
        zoom: 1.2,
      }, {
        description: "справа",
        subject: "Дуров",
        assetId: "asset-2",
        zoom: 1,
      }],
    }],
  }), 0);
  const panelSection = document.querySelector("#detail-panel-controls").children[0];
  const instruction = panelSection.querySelector("textarea");
  const regenerate = [...panelSection.querySelectorAll("button")].find((button) => /панел|Создать|Переделать/i.test(button.textContent));
  instruction.value = "перерисуй панель";
  regenerate.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const panel = researchPair("panel_generate");
  assert.equal(panel.start.submittedText, "перерисуй панель");
  assert.equal(panel.start.commandTarget.kind, "panel");
  assert.equal(panel.start.commandTarget.panelIndex, 0);
  assert.equal(panel.start.commandTarget.structureSegmentIndex, 0);
  assertFixedContextKeys(panel.start.context);
  assert.equal(panel.start.context.displayFrameNumber, 1);
  assert.equal(panel.start.context.displayFrameId, "display-1");
  assert.equal(panel.start.context.structureFrameId, "structure-1");
  assert.equal(panel.start.context.structureSegmentIndex, 0);
  assert.equal(panel.start.context.panelIndex, 0);
  assert.equal(panel.start.context.panelSubject, "Путин");
  assert.equal(panel.start.context.imageAssetId, "asset-1");
  assert.equal(panel.start.context.generationId, "gen-panel-1");
  const product = productPosts.find((entry) => /\/panels\/0\/generate$/.test(entry.path));
  assert.ok(product);
  assert.equal(product.body.instruction, "перерисуй панель");
  assert.equal(
    researchPosts.some((event) => JSON.stringify(event).includes("performanceImageDataUrl") || JSON.stringify(event).includes("data:image")),
    false,
  );
});

test("placement_commit records zoom change only; input scrubbing is a non-event", async () => {
  await ensurePage();
  const visual = readyVisual();
  visual.frames[0].panels[0] = {
    ...visual.frames[0].panels[0],
    zoom: 1.2,
    positionX: 41,
    positionY: 22,
    mirrored: false,
    position: "41% 22%",
    align: "41% 22%",
  };
  page.setResearchVisualState(visual, 0);
  const zoom = document.querySelector("#detail-panel-controls")
    .querySelectorAll("input")
    .find((input) => input.type === "range");
  assert.ok(zoom);
  assert.equal(zoom.type, "range");
  zoom.value = "1.55";
  zoom.dispatchEvent({ type: "input" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(researchStarts("placement_commit").length, 0);
  assert.equal(researchPosts.length, 0);

  zoom.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const placement = researchPair("placement_commit");
  assert.equal(placement.start.submittedText, null);
  assert.equal(placement.start.commandTarget.kind, "panel");
  assert.equal(placement.start.commandTarget.zoom, 1.55);
  assert.equal(placement.start.commandTarget.positionX, 41);
  assert.equal(placement.start.commandTarget.positionY, 22);
  assert.equal(placement.start.commandTarget.mirrored, false);
  assertFixedContextKeys(placement.start.context);
  assert.equal(placement.start.context.displayFrameId, "display-1");
  assert.equal(placement.start.context.structureFrameId, "structure-1");
  assert.equal(placement.start.context.structureSegmentIndex, 0);
  assert.equal(placement.start.context.panelIndex, 0);
  assert.equal(placement.start.context.panelSubject, "Путин");
  assert.equal(placement.start.context.imageAssetId, "asset-1");
  assert.equal(placement.start.context.generationId, null);
});

test("anchor_generate and anchor_approve capture the accepted session without image payloads", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual({
    characters: [{
      name: "Путин",
      identity: { assetId: "identity-asset-1", assetUrl: "/id.png", comment: "исходный" },
      sourcePhoto: { assetId: "identity-asset-1", assetUrl: "/id.png" },
      approvedAnchorId: "anchor-1",
      approvedAssetId: "anchor-asset-1",
      approvedAssetUrl: "/a.png",
      anchorProvenance: "generated_from_source",
    }],
  }), -1);
  const card = document.querySelector("#character-cards").children[0];
  const refine = [...card.querySelectorAll("button")].find((button) => button.textContent === "Уточнить образ");
  assert.ok(refine);
  refine.dispatchEvent({ type: "click" });
  const instruction = document.body.querySelector("#draft-instruction");
  instruction.value = "сделай строже";
  instruction.dispatchEvent({ type: "input" });
  document.body.querySelector("#generate").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const anchorGen = researchPair("anchor_generate");
  assert.equal(anchorGen.start.submittedText, "сделай строже");
  assert.equal(anchorGen.start.commandTarget.kind, "character");
  assert.equal(anchorGen.start.commandTarget.characterName, "Путин");
  assert.equal(anchorGen.start.context.anchorVersionId, "anchor-1");
  assert.equal(anchorGen.start.context.imageAssetId, "anchor-asset-1");
  assert.equal(JSON.stringify(anchorGen.start).includes("imageDataUrl"), false);
  assert.equal(JSON.stringify(anchorGen.start).includes("data:image"), false);

  researchPosts.length = 0;
  document.body.querySelector("#draft-accept").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const anchorApprove = researchPair("anchor_approve");
  assert.equal(anchorApprove.start.submittedText, null);
  assert.equal(anchorApprove.start.commandTarget.characterName, "Путин");
  assert.equal(JSON.stringify(anchorApprove.start).includes("data:image"), false);

  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual(), -1);
  document.querySelector("#approve-visual").hidden = false;
  document.querySelector("#approve-visual").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const visual = researchPair("visual_approve");
  assert.equal(visual.start.submittedText, null);
  assert.equal(visual.start.commandTarget.kind, "storyboard");
});

test("cast_edit covers all editKind × castPhase combinations with value-only editTarget", async () => {
  await ensurePage();

  async function runRename(mode, nextName) {
    researchPosts.length = 0;
    productPosts.length = 0;
    page.setResearchReviewState(castReviewState(mode), mode);
    const nameInput = document.querySelector("#material-characters").querySelector("input");
    nameInput.value = nextName;
    nameInput.dispatchEvent({ type: "input" });
    assert.equal(researchPosts.length, 0);
    nameInput.dispatchEvent({ type: "blur" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pair = assertSingleCastPair("character_rename", mode === "reading" ? "pending_reading" : "material_state");
    assert.equal(pair.start.surface, "product_control");
    assert.equal(pair.start.commandTarget, null);
    assert.equal(pair.start.submittedText, nextName);
    assertCastEditTargetShape(pair.start.editTarget, {
      editKind: "character_rename",
      castPhase: mode === "reading" ? "pending_reading" : "material_state",
      characterName: nextName,
      previousCharacterName: "Путин",
    });
    assert.equal(Object.hasOwn(pair.start, "cast"), false);
    assert.equal(JSON.stringify(pair.start).includes("sourceItems"), false);
    assert.equal(JSON.stringify(pair.start).includes('"characters"'), false);
    if (mode === "reading") {
      assert.ok(productPosts.some((entry) => entry.method === "PUT" && entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/readings/reading-1/cast"));
    } else {
      assert.ok(productPosts.some((entry) => entry.method === "POST" && entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/material-states"));
    }
  }

  async function runAlias(mode, nextName) {
    researchPosts.length = 0;
    productPosts.length = 0;
    page.setResearchReviewState(castReviewState(mode), mode);
    const aliasSelect = document.querySelector("#material-aliases").querySelector("select");
    aliasSelect.value = nextName;
    aliasSelect.dispatchEvent({ type: "change" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pair = assertSingleCastPair("alias_assignment", mode === "reading" ? "pending_reading" : "material_state");
    assert.equal(pair.start.surface, "product_control");
    assert.equal(pair.start.commandTarget, null);
    assert.equal(pair.start.submittedText, nextName);
    assertCastEditTargetShape(pair.start.editTarget, {
      editKind: "alias_assignment",
      castPhase: mode === "reading" ? "pending_reading" : "material_state",
      characterName: nextName,
      surfaceForm: "Владимир",
    });
    assert.equal(JSON.stringify(pair.start).includes("sourceItems"), false);
    if (mode === "reading") {
      assert.ok(productPosts.some((entry) => entry.method === "PUT" && entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/readings/reading-1/cast"));
    } else {
      assert.ok(productPosts.some((entry) => entry.method === "POST" && entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/material-states"));
    }
  }

  async function runSpeaker(mode, nextName) {
    researchPosts.length = 0;
    productPosts.length = 0;
    page.setResearchReviewState(castReviewState(mode), mode);
    const speakerSelect = document.querySelector("#material-speakers").querySelector("select");
    speakerSelect.value = nextName;
    speakerSelect.dispatchEvent({ type: "change" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pair = assertSingleCastPair("speaker_assignment", mode === "reading" ? "pending_reading" : "material_state");
    assert.equal(pair.start.surface, "product_control");
    assert.equal(pair.start.commandTarget, null);
    assert.equal(pair.start.submittedText, nextName);
    assertCastEditTargetShape(pair.start.editTarget, {
      editKind: "speaker_assignment",
      castPhase: mode === "reading" ? "pending_reading" : "material_state",
      characterName: nextName,
      sourceItemId: "utterance-1",
    });
    assert.equal(JSON.stringify(pair.start).includes("sourceQuote"), false);
    if (mode === "reading") {
      assert.ok(productPosts.some((entry) => entry.method === "PUT" && entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/readings/reading-1/cast"));
    } else {
      assert.ok(productPosts.some((entry) => entry.method === "POST" && entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/material-states"));
    }
  }

  await runRename("reading", "Песков");
  await runRename("material", "Медведев");
  await runAlias("reading", "Дуров");
  await runAlias("material", "Дуров");
  await runSpeaker("reading", "Дуров");
  await runSpeaker("material", "Дуров");
});

test("structure_edit research text keeps exact whitespace while product still receives trimmed instruction", async () => {
  await ensurePage();
  productPosts.length = 0;
  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual());
  const exact = "  сделай кадры плотнее\n  ";
  document.querySelector("#structure-instruction").value = exact;
  document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const edit = researchPair("structure_edit");
  assert.equal(edit.start.submittedText, exact);
  assert.notEqual(edit.start.submittedText, exact.trim());
  const product = productPosts.find((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit");
  assert.ok(product);
  assert.equal(product.body.instruction, exact.trim());

  researchPosts.length = 0;
  productPosts.length = 0;
  document.querySelector("#structure-instruction").value = "   \n\t  ";
  document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(researchPosts.length, 0);
  assert.equal(productPosts.filter((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit").length, 0);
});

test("failed cast save never claims cast_edit success terminal", async () => {
  await ensurePage();
  const original = fetchImpl;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path.startsWith("/api/projects/00000000-0000-4000-8000-000000000001/readings/") && path.endsWith("/cast")) {
      return jsonResponse(500, { status: "failed" });
    }
    return original(url, init);
  };
  page.setResearchReviewState({
    id: "reading-1",
    text: "текст",
    sourceItems: [],
    cast: { characters: [{ name: "Путин" }], aliases: [], speakers: [] },
    surfaceForms: [],
    findings: [],
  }, "reading");
  const nameInput = document.querySelector("#material-characters").querySelector("input");
  nameInput.value = "Новое";
  nameInput.dispatchEvent({ type: "blur" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const { start, terminal } = researchPair("cast_edit");
  assert.equal(start.editTarget.editKind, "character_rename");
  assert.equal(terminal.outcome, "failure");
  fetchImpl = original;
});

test("draft keystrokes and autosave flush produce no research events", async () => {
  await ensurePage();
  researchPosts.length = 0;
  const draft = document.querySelector("#draft");
  draft.value = "ключ";
  draft.dispatchEvent({ type: "input" });
  draft.value = "ключевой текст";
  draft.dispatchEvent({ type: "input" });
  await page.draftAutosave.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(researchPosts.length, 0);
  assert.equal(researchStarts("reading").length, 0);
});

test("navigation after start does not relabel terminal; incomplete startSnapshot retained in closure path", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), -1);
  const original = fetchImpl;
  let researchCalls = 0;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
      researchCalls += 1;
      const body = JSON.parse(init.body);
      if (body.eventKind === "action_start") return jsonResponse(500, { status: "failed" });
      researchPosts.push(body);
      return jsonResponse(201, { event: { ...body, seq: researchCalls, occurredAt: "2026-10-13T13:00:00.000Z" } });
    }
    return original(url, init);
  };
  document.querySelector("#structure-instruction").value = "snapshotted instruction";
  document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
  page.setResearchDetailState([{
    id: "display-99",
    structureFrameId: "structure-99",
    structureSegmentIndex: 9,
  }], 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const terminal = researchPosts.find((event) => event.eventKind === "action_terminal");
  assert.ok(terminal);
  assert.ok(terminal.startSnapshot);
  assert.equal(terminal.startSnapshot.submittedText, "snapshotted instruction");
  assert.equal(terminal.startSnapshot.semanticAction, "structure_edit");
  assert.equal(terminal.startSnapshot.commandTarget.kind, "storyboard");
  assert.notEqual(terminal.startSnapshot.context?.displayFrameId, "display-99");
  fetchImpl = original;
});

test("panel action-specific context stays frozen after navigation in startSnapshot path", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual({
    frames: [{
      id: "display-1",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      layout: "split2",
      speakerPanel: 0,
      dialogue: "Привет",
      outsideFrameText: "",
      visualReady: true,
      panels: [{
        description: "слева",
        subject: "Путин",
        assetId: "asset-1",
        generationId: "gen-frozen",
        zoom: 1.2,
      }, {
        description: "справа",
        subject: "Дуров",
        assetId: "asset-2",
        zoom: 1,
      }],
    }],
  }), 0);
  const original = fetchImpl;
  let researchCalls = 0;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
      researchCalls += 1;
      const body = JSON.parse(init.body);
      if (body.eventKind === "action_start") return jsonResponse(500, { status: "failed" });
      researchPosts.push(body);
      return jsonResponse(201, { event: { ...body, seq: researchCalls, occurredAt: "2026-10-13T13:00:00.000Z" } });
    }
    return original(url, init);
  };
  researchPosts.length = 0;
  const panelSection = document.querySelector("#detail-panel-controls").children[0];
  const instruction = panelSection.querySelector("textarea");
  const regenerate = [...panelSection.querySelectorAll("button")].find((button) => /панел|Создать|Переделать/i.test(button.textContent));
  instruction.value = "freeze panel context";
  regenerate.dispatchEvent({ type: "click" });
  page.setResearchDetailState([{
    id: "display-99",
    structureFrameId: "structure-99",
    structureSegmentIndex: 9,
    panels: [{ subject: "Другой", assetId: "other-asset", generationId: "other-gen" }],
  }], 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const terminal = researchPosts.find((event) => event.eventKind === "action_terminal");
  assert.ok(terminal?.startSnapshot);
  assert.equal(terminal.startSnapshot.semanticAction, "panel_generate");
  assert.equal(terminal.startSnapshot.commandTarget.kind, "panel");
  assert.equal(terminal.startSnapshot.commandTarget.panelIndex, 0);
  assertFixedContextKeys(terminal.startSnapshot.context);
  assert.equal(terminal.startSnapshot.context.displayFrameId, "display-1");
  assert.equal(terminal.startSnapshot.context.structureFrameId, "structure-1");
  assert.equal(terminal.startSnapshot.context.structureSegmentIndex, 0);
  assert.equal(terminal.startSnapshot.context.panelIndex, 0);
  assert.equal(terminal.startSnapshot.context.panelSubject, "Путин");
  assert.equal(terminal.startSnapshot.context.imageAssetId, "asset-1");
  assert.equal(terminal.startSnapshot.context.generationId, "gen-frozen");
  assert.notEqual(terminal.startSnapshot.context.displayFrameId, "display-99");
  assert.notEqual(terminal.startSnapshot.context.panelSubject, "Другой");
  fetchImpl = original;
});

test("T028 product success with failed terminal research write reports local evidence gap once", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual());
  const original = fetchImpl;
  let terminalPosts = 0;
  let startPosts = 0;
  try {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
        const body = JSON.parse(init.body);
        if (body.eventKind === "action_start") {
          startPosts += 1;
          researchPosts.push(body);
          return jsonResponse(201, {
            event: { ...body, seq: startPosts, occurredAt: "2026-10-13T15:00:00.000Z" },
          });
        }
        terminalPosts += 1;
        return jsonResponse(500, { status: "failed", kind: "database" });
      }
      return original(url, init);
    };
    document.querySelector("#structure-instruction").value = "правка при сбое evidence";
    document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(productPosts.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit"));
    assert.equal(startPosts, 1);
    assert.equal(terminalPosts, 1);
    assert.equal(researchPosts.some((event) => (
      event.eventKind === "action_terminal" && event.outcome === "success"
    )), false);
    const bound = page.getResearchDock();
    assert.ok(bound?.getOperationsProjection, "dock seam must expose operations projection");
    const items = bound.getOperationsProjection();
    const local = items.filter((item) => item.localOnly === true);
    assert.ok(local.length >= 1);
    assert.match(
      local.at(-1).label || "",
      /продукт.*выполн|исследован.*не сохран/i,
    );
    assert.equal(local.some((item) => item.status === "success"), false);
  } finally {
    fetchImpl = original;
  }
});

test("T028 panel regenerate failure sets retainedLastGoodImage only when prior asset exists", async () => {
  await ensurePage();
  const original = fetchImpl;
  try {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (/\/panels\/0\/generate$/.test(path)) {
        return jsonResponse(502, { status: "failed", kind: "provider" });
      }
      return original(url, init);
    };

    researchPosts.length = 0;
    productPosts.length = 0;
    page.setResearchVisualState(readyVisual(), 0);
    let panelSection = document.querySelector("#detail-panel-controls").children[0];
    let regenerate = [...panelSection.querySelectorAll("button")].find((button) => /панел|Создать|Переделать/i.test(button.textContent));
    regenerate.dispatchEvent({ type: "click" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retained = researchPair("panel_generate");
    assert.equal(retained.terminal.outcome, "failure");
    assert.equal(retained.terminal.outcomeKind, "provider");
    assert.equal(retained.terminal.outcomeFlags?.retainedLastGoodImage, true);

    researchPosts.length = 0;
    page.setResearchVisualState(readyVisual({
      frames: [{
        id: "display-1",
        structureFrameId: "structure-1",
        structureSegmentIndex: 0,
        layout: "split2",
        speakerPanel: 0,
        dialogue: "Привет",
        outsideFrameText: "",
        visualReady: false,
        panels: [{
          description: "слева",
          subject: "Путин",
          assetId: null,
          zoom: 1,
        }, {
          description: "справа",
          subject: "Дуров",
          assetId: null,
          zoom: 1,
        }],
      }],
    }), 0);
    panelSection = document.querySelector("#detail-panel-controls").children[0];
    regenerate = [...panelSection.querySelectorAll("button")].find((button) => /панел|Создать|Переделать/i.test(button.textContent));
    regenerate.dispatchEvent({ type: "click" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fresh = researchPair("panel_generate");
    assert.equal(fresh.terminal.outcome, "failure");
    assert.equal(fresh.terminal.outcomeKind, "provider");
    assert.notEqual(fresh.terminal.outcomeFlags?.retainedLastGoodImage, true);
  } finally {
    fetchImpl = original;
  }
});

test("T028 frame generationFailures write failure terminal with retention only for prior assets", async () => {
  await ensurePage();
  const original = fetchImpl;
  try {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (/\/frames\/[^/]+\/generate$/.test(path)) {
        return jsonResponse(200, readyVisual({
          generationFailures: [{ panelIndex: 0, kind: "provider" }],
          frames: [{
            id: "display-1",
            structureFrameId: "structure-1",
            structureSegmentIndex: 0,
            layout: "split2",
            speakerPanel: 0,
            dialogue: "Привет",
            outsideFrameText: "",
            visualReady: true,
            panels: [{
              description: "слева",
              subject: "Путин",
              assetId: "asset-1",
              zoom: 1.2,
            }, {
              description: "справа",
              subject: "Дуров",
              assetId: "asset-2",
              zoom: 1,
            }],
          }],
        }));
      }
      return original(url, init);
    };
    researchPosts.length = 0;
    page.setResearchVisualState(readyVisual(), 0);
    await page.captureTestGenerateFrame("display-1", 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retained = researchPair("frame_generate");
    assert.equal(retained.terminal.outcome, "failure");
    assert.equal(retained.terminal.outcomeKind, "provider");
    assert.equal(retained.terminal.outcomeFlags?.retainedLastGoodImage, true);

    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (/\/frames\/[^/]+\/generate$/.test(path)) {
        return jsonResponse(200, readyVisual({
          generationFailures: [{ panelIndex: 0, kind: "timeout" }],
          frames: [{
            id: "display-1",
            structureFrameId: "structure-1",
            structureSegmentIndex: 0,
            layout: "single",
            speakerPanel: 0,
            dialogue: "Привет",
            outsideFrameText: "",
            visualReady: false,
            panels: [{
              description: "слева",
              subject: "Путин",
              assetId: null,
              zoom: 1,
            }],
          }],
        }));
      }
      return original(url, init);
    };
    researchPosts.length = 0;
    page.setResearchVisualState(readyVisual({
      frames: [{
        id: "display-1",
        structureFrameId: "structure-1",
        structureSegmentIndex: 0,
        layout: "single",
        speakerPanel: 0,
        dialogue: "Привет",
        outsideFrameText: "",
        visualReady: false,
        panels: [{
          description: "слева",
          subject: "Путин",
          assetId: null,
          zoom: 1,
        }],
      }],
    }), 0);
    await page.captureTestGenerateFrame("display-1", 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fresh = researchPair("frame_generate");
    assert.equal(fresh.terminal.outcome, "failure");
    assert.equal(fresh.terminal.outcomeKind, "timeout");
    assert.notEqual(fresh.terminal.outcomeFlags?.retainedLastGoodImage, true);
  } finally {
    fetchImpl = original;
  }
});

test("T028 incomplete startSnapshot terminal carries evidenceIncomplete and null durationMs", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), -1);
  const original = fetchImpl;
  let researchCalls = 0;
  try {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
        researchCalls += 1;
        const body = JSON.parse(init.body);
        if (body.eventKind === "action_start") return jsonResponse(500, { status: "failed" });
        researchPosts.push(body);
        return jsonResponse(201, {
          event: {
            ...body,
            ...body.startSnapshot,
            seq: researchCalls,
            occurredAt: "2026-10-13T15:10:00.000Z",
            durationMs: null,
            outcomeFlags: { ...(body.outcomeFlags || {}), evidenceIncomplete: true },
          },
        });
      }
      return original(url, init);
    };
    document.querySelector("#structure-instruction").value = "incomplete evidence path";
    document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const terminal = researchPosts.find((event) => event.eventKind === "action_terminal");
    assert.ok(terminal?.startSnapshot);
    const bound = page.getResearchDock();
    assert.ok(bound?.getOperationsProjection);
    const items = bound.getOperationsProjection();
    assert.equal(items.some((item) => item.status === "running"), false);
    const incomplete = items.find((item) => item.outcomeFlags?.evidenceIncomplete === true);
    assert.ok(incomplete);
    assert.equal(incomplete.durationMs, null);
  } finally {
    fetchImpl = original;
  }
});

test("product_control start evidence save failure while product pending uses start wording then clears on incomplete terminal", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), -1);
  researchPosts.length = 0;
  productPosts.length = 0;
  const original = fetchImpl;
  let resolveEdit;
  const editPending = new Promise((resolve) => {
    resolveEdit = resolve;
  });
  let startPosts = 0;
  let terminalPosts = 0;
  try {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
        const body = JSON.parse(init.body);
        if (body.eventKind === "action_start") {
          startPosts += 1;
          return jsonResponse(500, { status: "failed", kind: "database" });
        }
        terminalPosts += 1;
        researchPosts.push(body);
        return jsonResponse(201, {
          event: {
            ...body,
            ...body.startSnapshot,
            seq: 2,
            occurredAt: "2026-10-13T15:20:00.000Z",
            durationMs: null,
            outcomeFlags: { ...(body.outcomeFlags || {}), evidenceIncomplete: true },
          },
        });
      }
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit") {
        productPosts.push({ path, method: init.method ?? "POST", body: init.body ? JSON.parse(init.body) : null });
        await editPending;
        return jsonResponse(200, readyVisual({ canUndo: true }));
      }
      return original(url, init);
    };
    document.querySelector("#structure-instruction").value = "правка при сбое start";
    document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });

    let pending = null;
    let running = null;
    let startFail = null;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const bound = page.getResearchDock();
      pending = bound?.getOperationsProjection?.() || [];
      running = pending.find((item) => item.status === "running");
      startFail = running?.correlationId
        ? pending.find((item) => item.localOnly === true && item.correlationId === running.correlationId)
        : null;
      if (running && startFail) break;
    }
    assert.ok(running?.correlationId);
    assert.ok(startFail);
    assert.equal(startFail.phase, "start");
    assert.match(startFail.label, /не удалось сохранить начало|начало исследования|продолжается/i);
    assert.equal(/выполнен|успех/i.test(startFail.label), false);
    assert.equal(startPosts, 1);
    assert.equal(terminalPosts, 0);
    assert.ok(productPosts.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit"));

    resolveEdit();
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (terminalPosts === 1) break;
    }
    const finished = page.getResearchDock().getOperationsProjection();
    assert.equal(finished.some((item) => item.status === "running"), false);
    assert.equal(finished.some((item) => (
      item.localOnly === true && item.correlationId === running.correlationId
    )), false);
    const incomplete = finished.find((item) => (
      item.outcomeFlags?.evidenceIncomplete === true
      && item.correlationId === running.correlationId
    ));
    assert.ok(incomplete);
    assert.equal(incomplete.durationMs, null);
    assert.equal(incomplete.status, "success");
    assert.equal(startPosts, 1);
    assert.equal(terminalPosts, 1);
  } finally {
    resolveEdit?.();
    for (let i = 0; i < 40 && terminalPosts === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    fetchImpl = original;
  }
});

test("product_control terminal evidence save failure after product success keeps completion wording", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), -1);
  researchPosts.length = 0;
  productPosts.length = 0;
  const original = fetchImpl;
  let startPosts = 0;
  let terminalPosts = 0;
  let correlationId = null;
  try {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (path === "/api/projects/00000000-0000-4000-8000-000000000001/research/events") {
        const body = JSON.parse(init.body);
        if (body.eventKind === "action_start") {
          startPosts += 1;
          correlationId = body.correlationId;
          researchPosts.push(body);
          return jsonResponse(201, {
            event: { ...body, seq: startPosts, occurredAt: "2026-10-13T15:21:00.000Z" },
          });
        }
        terminalPosts += 1;
        return jsonResponse(500, { status: "failed", kind: "database" });
      }
      return original(url, init);
    };
    document.querySelector("#structure-instruction").value = "правка при сбое terminal";
    document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(productPosts.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/edit"));
    assert.equal(startPosts, 1);
    assert.equal(terminalPosts, 1);
    assert.ok(correlationId);
    const items = page.getResearchDock().getOperationsProjection();
    const terminalFail = items.find((item) => (
      item.localOnly === true && item.correlationId === correlationId
    ));
    assert.ok(terminalFail);
    assert.equal(terminalFail.phase, "terminal");
    assert.match(terminalFail.label, /продукт.*выполн|исследован.*не сохран/i);
    assert.equal(/начало|продолжается/i.test(terminalFail.label), false);
    assert.equal(items.some((item) => item.status === "running"), false);
  } finally {
    fetchImpl = original;
  }
});

function commandSelectOptions() {
  const select = document.querySelector("#research-commands-target");
  return [...(select?.children || [])].map((child) => ({
    value: child.value,
    text: child.textContent,
  }));
}

function panelCommandOptions() {
  return commandSelectOptions().filter((option) => String(option.value || "").startsWith("panel:"));
}

async function openReadyDetailViaUi(page, frameIndex = 0) {
  page.setResearchVisualState(readyVisual({
    frames: readyVisual().frames.map((frame, index) => ({
      ...frame,
      id: `display-${index + 1}`,
      visualReady: true,
    })),
  }), -1);
  // Prefer explicit open seam when present; otherwise use open-last for sole frame.
  if (typeof page.openResearchDetail === "function") {
    page.openResearchDetail(frameIndex);
  } else {
    document.querySelector("#open-last").hidden = false;
    document.querySelector("#open-last").dispatchEvent({ type: "click" });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#detail").open, true);
}

test("detail close clears last-open-frame panel options and selected panel target", async () => {
  const page = await ensurePage();
  await openReadyDetailViaUi(page, 0);
  const dock = page.getResearchDock();
  assert.ok(panelCommandOptions().length >= 1, "open detail should expose panel options");

  const panel = panelCommandOptions()[0];
  document.querySelector("#research-commands-target").value = panel.value;
  document.querySelector("#research-commands-target").dispatchEvent({ type: "change" });
  assert.equal(dock.getCommandTarget()?.kind, "panel");
  document.querySelector("#research-commands-draft").value = "черновик команды остаётся";

  document.querySelector("#close-detail").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.querySelector("#detail").open, false);
  assert.equal(panelCommandOptions().length, 0);
  assert.equal(document.querySelector("#research-commands-target").value, "");
  assert.equal(dock.getCommandTarget(), null);
  assert.match(document.querySelector("#research-commands-target-label").textContent, /не выбрано|Выберите/i);
  assert.equal(document.querySelector("#research-commands-draft").value, "черновик команды остаётся");
  assert.ok(commandSelectOptions().some((option) => option.value === "storyboard"));
});

test("closed-detail panel send makes zero product and research calls", async () => {
  const page = await ensurePage();
  await openReadyDetailViaUi(page, 0);
  const panel = panelCommandOptions()[0];
  document.querySelector("#research-commands-target").value = panel.value;
  document.querySelector("#research-commands-target").dispatchEvent({ type: "change" });
  document.querySelector("#research-commands-draft").value = "после закрытия не вызывать";

  document.querySelector("#close-detail").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  researchPosts.length = 0;
  productPosts.length = 0;
  document.querySelector("#research-commands-send").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(productPosts.filter((post) => /\/panels\/\d+\/generate$/.test(post.path)).length, 0);
  assert.equal(researchPosts.filter((event) => event.eventKind === "action_start" || event.eventKind === "action_terminal").length, 0);
  assert.equal(document.querySelector("#research-commands-draft").value, "после закрытия не вызывать");
  assert.match(document.querySelector("#research-commands-status")?.textContent || "", /Выберите действие|не выполнены/i);
});

test("closed detail stays panel-empty across visual refresh", async () => {
  const page = await ensurePage();
  await openReadyDetailViaUi(page, 0);
  assert.ok(panelCommandOptions().length >= 1);
  document.querySelector("#close-detail").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(panelCommandOptions().length, 0);

  // Retain navigation index while dialog stays closed, then refresh visual state.
  page.setResearchVisualState(readyVisual(), 0);
  assert.equal(document.querySelector("#detail").open, false);
  assert.equal(panelCommandOptions().length, 0);
});

test("reopening detail repopulates current-frame panels without auto-selecting prior panel", async () => {
  const page = await ensurePage();
  await openReadyDetailViaUi(page, 0);
  const firstPanel = panelCommandOptions()[0];
  document.querySelector("#research-commands-target").value = firstPanel.value;
  document.querySelector("#research-commands-target").dispatchEvent({ type: "change" });
  assert.equal(page.getResearchDock().getCommandTarget()?.kind, "panel");

  document.querySelector("#close-detail").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.getResearchDock().getCommandTarget(), null);

  await openReadyDetailViaUi(page, 0);
  assert.ok(panelCommandOptions().length >= 1);
  assert.ok(panelCommandOptions().some((option) => /панель/i.test(option.text)));
  assert.equal(document.querySelector("#research-commands-target").value, "");
  assert.equal(page.getResearchDock().getCommandTarget(), null);
  assert.match(document.querySelector("#research-commands-target-label").textContent, /не выбрано|Выберите/i);
});

test("storyboard selection remains sticky across detail close and reopen", async () => {
  const page = await ensurePage();
  await openReadyDetailViaUi(page, 0);
  document.querySelector("#research-commands-target").value = "storyboard";
  document.querySelector("#research-commands-target").dispatchEvent({ type: "change" });
  assert.equal(page.getResearchDock().getCommandTarget()?.kind, "storyboard");

  document.querySelector("#close-detail").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.getResearchDock().getCommandTarget()?.kind, "storyboard");
  assert.equal(document.querySelector("#research-commands-target").value, "storyboard");
  assert.equal(panelCommandOptions().length, 0);

  await openReadyDetailViaUi(page, 0);
  assert.equal(page.getResearchDock().getCommandTarget()?.kind, "storyboard");
  assert.equal(document.querySelector("#research-commands-target").value, "storyboard");
  assert.ok(panelCommandOptions().length >= 1);
});

function placementVisual() {
  return readyVisual({
    frames: [{
      id: "display-1",
      structureFrameId: "structure-1",
      structureSegmentIndex: 0,
      layout: "split2",
      speakerPanel: 0,
      dialogue: "Привет",
      outsideFrameText: "",
      visualReady: true,
      panels: [{
        description: "слева",
        subject: "Путин",
        assetId: "asset-1",
        asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-1",
        zoom: 1.4,
        positionX: 41,
        positionY: 22,
        mirrored: false,
        position: "41% 22%",
        align: "41% 22%",
      }, {
        description: "справа",
        subject: "Дуров",
        assetId: "asset-2",
        asset: "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/asset-2",
        zoom: 1.1,
        positionX: 70,
        positionY: 55,
        mirrored: false,
        position: "70% 55%",
        align: "70% 55%",
      }],
    }],
  });
}

function placementButtons(panelIndex) {
  const sections = [...document.querySelector("#detail-panel-controls").children];
  const section = sections[panelIndex];
  const buttons = [...section.querySelectorAll("button")];
  return {
    section,
    reset: buttons.find((button) => button.dataset.placementAction === "reset"),
    mirror: buttons.find((button) => button.dataset.placementAction === "mirror"),
  };
}

function panelAsset(panelIndex) {
  const panels = [...document.querySelector("#detail-frame").querySelectorAll(".panel")];
  const column = panels.find((node) => Number(node.dataset.panelIndex) === panelIndex);
  return column?.querySelector(".panel-asset") ?? null;
}

test("drag previews one panel and commits placement once at pointerup", async () => {
  await ensurePage();
  page.setResearchVisualState(placementVisual(), -1);
  page.openResearchDetail(0);
  const left = panelAsset(0);
  const right = panelAsset(1);
  assert.equal(left.style.objectPosition, "41% 22%");
  assert.equal(right.style.objectPosition, "70% 55%");
  const before = productPosts.length;
  left.parentNode.dispatchEvent({ type: "pointerdown", clientX: 100, clientY: 80, button: 0, pointerId: 1, preventDefault() {} });
  left.parentNode.dispatchEvent({ type: "pointermove", clientX: 146.8, clientY: 80, button: 0, pointerId: 1, preventDefault() {} });
  left.parentNode.dispatchEvent({ type: "pointermove", clientX: 146.8, clientY: 119, button: 0, pointerId: 1, preventDefault() {} });
  assert.equal(productPosts.length, before);
  assert.equal(researchStarts("placement_commit").length, 0);
  assert.notEqual(left.style.objectPosition, "41% 22%");
  assert.equal(right.style.objectPosition, "70% 55%");
  assert.equal(left.style.transform.includes("scale(1.4)"), true);
  left.parentNode.dispatchEvent({ type: "pointerup", clientX: 146.8, clientY: 119, button: 0, pointerId: 1, preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const placementPosts = productPosts.slice(before).filter((entry) => /\/panels\/0\/placement$/.test(entry.path));
  assert.equal(placementPosts.length, 1);
  assert.equal(placementPosts[0].body.zoom, 1.4);
  assert.equal(placementPosts[0].body.mirrored, false);
  assert.notEqual(placementPosts[0].body.positionX, 41);
  assert.equal(researchStarts("placement_commit").length, 1);
  assert.equal(productPosts.slice(before).some((entry) => /\/panels\/1\/placement$/.test(entry.path)), false);
});

test("zoom after pan and pan after zoom retain both values", async () => {
  await ensurePage();
  const visual = placementVisual();
  const original = fetchImpl;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://storyboard.local").pathname;
    if (/\/panels\/0\/placement$/.test(path)) {
      const body = JSON.parse(init.body);
      const panel = visual.frames[0].panels[0];
      if (body.zoom != null) panel.zoom = body.zoom;
      if (body.positionX != null) panel.positionX = body.positionX;
      if (body.positionY != null) panel.positionY = body.positionY;
      if (body.mirrored != null) panel.mirrored = body.mirrored;
      panel.position = `${panel.positionX}% ${panel.positionY}%`;
      panel.align = panel.position;
      productPosts.push({ path, method: init.method, body });
      return jsonResponse(200, visual);
    }
    return original(url, init);
  };
  try {
    page.setResearchVisualState(visual, -1);
    page.openResearchDetail(0);
    const zoom = document.querySelector("#detail-panel-controls").querySelectorAll("input").find((input) => input.type === "range");
    zoom.value = "2";
    zoom.dispatchEvent({ type: "change" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const zoomPost = productPosts.filter((entry) => /\/panels\/0\/placement$/.test(entry.path)).at(-1);
    assert.equal(zoomPost.body.zoom, 2);
    assert.equal(zoomPost.body.positionX, 41);
    assert.equal(zoomPost.body.positionY, 22);
    assert.equal(zoomPost.body.mirrored, false);

    const left = panelAsset(0);
    left.parentNode.dispatchEvent({ type: "pointerdown", clientX: 0, clientY: 0, button: 0, pointerId: 2, preventDefault() {} });
    left.parentNode.dispatchEvent({ type: "pointermove", clientX: 46.8, clientY: 0, button: 0, pointerId: 2, preventDefault() {} });
    left.parentNode.dispatchEvent({ type: "pointerup", clientX: 46.8, clientY: 0, button: 0, pointerId: 2, preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const panPost = productPosts.filter((entry) => /\/panels\/0\/placement$/.test(entry.path)).at(-1);
    assert.equal(panPost.body.zoom, 2);
    assert.notEqual(panPost.body.positionX, 41);
    assert.equal(panPost.body.positionY, 22);
    assert.equal(panPost.body.mirrored, false);

    document.querySelector("#close-detail").dispatchEvent({ type: "click" });
    page.setResearchVisualState(visual, -1);
    page.openResearchDetail(0);
    const reopened = document.querySelector("#detail-panel-controls").querySelectorAll("input").find((input) => input.type === "range");
    assert.equal(reopened.value, "2");
    assert.equal(panelAsset(0).style.transform, "scale(2)");
    assert.equal(panelAsset(0).style.objectPosition, `${visual.frames[0].panels[0].positionX}% 22%`);
    assert.equal(panelAsset(1).style.objectPosition, "70% 55%");
    assert.equal(panelAsset(1).style.transform, "scale(1.1)");
  } finally {
    fetchImpl = original;
  }
});

test("reset and mirror address only the selected panel", async () => {
  await ensurePage();
  page.setResearchVisualState(placementVisual(), -1);
  page.openResearchDetail(0);
  const left = placementButtons(0);
  const right = placementButtons(1);
  assert.ok(left.reset);
  assert.ok(left.mirror);
  left.mirror.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const mirrorPost = productPosts.filter((entry) => /\/panels\/0\/placement$/.test(entry.path)).at(-1);
  assert.equal(mirrorPost.body.mirrored, true);
  assert.equal(mirrorPost.body.zoom, 1.4);
  assert.equal(mirrorPost.body.positionX, 41);
  assert.equal(mirrorPost.body.positionY, 22);
  assert.equal(productPosts.some((entry) => /\/panels\/1\/placement$/.test(entry.path)), false);
  assert.equal(right.mirror.getAttribute("aria-pressed"), "false");

  left.reset.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const resetPost = productPosts.filter((entry) => /\/panels\/0\/placement$/.test(entry.path)).at(-1);
  assert.deepEqual(resetPost.body, { reset: true });
  assert.equal(researchPair("placement_commit").start.commandTarget.zoom, 1);
  assert.equal(researchPair("placement_commit").start.commandTarget.positionX, 50);
  assert.equal(researchPair("placement_commit").start.commandTarget.positionY, 30);
  assert.equal(researchPair("placement_commit").start.commandTarget.mirrored, false);
  assert.equal(researchPair("placement_commit").start.commandTarget.panelIndex, 0);
});

test("failed placement save does not claim success and restores the prior rendition", async () => {
  await ensurePage();
  page.setResearchVisualState(placementVisual(), -1);
  page.openResearchDetail(0);
  const original = fetchImpl;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://storyboard.local").pathname;
    if (/\/placement$/.test(path)) return jsonResponse(500, { status: "failed", kind: "database" });
    return original(url, init);
  };
  try {
    const left = panelAsset(0);
    left.parentNode.dispatchEvent({ type: "pointerdown", clientX: 0, clientY: 0, button: 0, pointerId: 3, preventDefault() {} });
    left.parentNode.dispatchEvent({ type: "pointermove", clientX: 80, clientY: 40, button: 0, pointerId: 3, preventDefault() {} });
    assert.notEqual(left.style.objectPosition, "41% 22%");
    left.parentNode.dispatchEvent({ type: "pointerup", clientX: 80, clientY: 40, button: 0, pointerId: 3, preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const notice = document.querySelector("#action-status");
    assert.equal(notice.dataset.kind, "error");
    assert.equal(/Приближение сохранено|Кадрирование сохранено|Кадрирование сброшено|Отражение сохранено/.test(notice.textContent), false);
    assert.equal(left.style.objectPosition, "41% 22%");
    assert.equal(left.style.transform, "scale(1.4)");
    assert.equal(panelAsset(1).style.objectPosition, "70% 55%");
  } finally {
    fetchImpl = original;
  }
});

test("detail frame number follows the open frame when its display position changes", async () => {
  await ensurePage();
  const first = {
    id: "display-1",
    structureFrameId: "structure-1",
    durationFrames: 36,
    layout: "single",
    dialogue: "",
    visualReady: true,
    panels: [{ id: "panel-a", description: "слева", subject: "Путин", assetId: "asset-1" }],
  };
  const second = {
    id: "display-2",
    structureFrameId: "structure-2",
    durationFrames: 36,
    layout: "single",
    dialogue: "",
    visualReady: true,
    panels: [{ id: "panel-b", description: "справа", subject: "Дуров", assetId: "asset-2" }],
  };
  page.applyVisual(readyVisual({ frames: [first, second], complete: false }));
  openFrameCard(0);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
  assert.equal(document.querySelector("#detail-frame").querySelector("#detail-frame-number"), null);
  page.applyVisual(readyVisual({ frames: [second, first], complete: false }));
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 2");
});

test("assembly has one undo control and no panel note", async () => {
  await ensurePage();
  page.applyVisual(readyVisual({
    frames: [{
      id: "display-1",
      structureFrameId: "structure-1",
      durationFrames: 36,
      layout: "single",
      dialogue: "",
      panels: [{ id: "panel-a", description: "", subject: null, subjectEditable: true }],
    }],
  }));
  const controls = document.querySelector("#storyboard").textContent;
  assert.equal(document.querySelector("#undo-structure"), null);
  assert.equal(/Заметка к панели|Не используется при генерации/.test(controls), false);
  assert.equal(document.querySelector("#global-undo").hidden, false);
});

test("insert then undo removes the frame, and undo after delete restores it", async () => {
  await ensurePage();
  const baseFrame = {
    id: "display-1",
    structureFrameId: "structure-1",
    durationFrames: 36,
    layout: "single",
    dialogue: "",
    frameKind: "image",
    visualReady: false,
    panels: [{ id: "panel-a", description: "", subject: null }],
  };
  const extraFrame = {
    id: "display-2",
    structureFrameId: "structure-2",
    durationFrames: 36,
    layout: "single",
    dialogue: "",
    frameKind: "image",
    visualReady: false,
    panels: [{ id: "panel-b", description: "", subject: null }],
  };
  const base = readyVisual({ canUndo: false, storyboardVersionId: "version-1", frames: [baseFrame] });
  const inserted = readyVisual({
    canUndo: true,
    undoLabel: "вставку кадра",
    storyboardVersionId: "version-2",
    frames: [baseFrame, extraFrame],
  });
  page.applyVisual(base);
  globalThis.__visualScript = [{ path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations", body: inserted }];
  selectFrameCard(0);
  const insert = buttonNamed("Кадр с изображением после");
  insert.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#storyboard").querySelectorAll(".story-card").length, 2);

  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo",
    body: { ...base, undoneLabel: "вставку кадра", undoneTarget: { displayFrameNumber: 2, op: "insertFrame" } },
  }];
  document.querySelector("#global-undo").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#storyboard").querySelectorAll(".story-card").length, 1);
  assert.match(statusText(), /Отменено: вставку кадра/);
  assert.equal(/Не удалось выполнить действие/.test(statusText()), false);

  page.applyVisual(inserted);
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations",
    body: readyVisual({ ...base, canUndo: true, undoLabel: "удаление кадра", storyboardVersionId: "version-3" }),
  }];
  selectFrameCard(0);
  const remove = buttonNamed("Удалить кадр");
  remove.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#storyboard").querySelectorAll(".story-card").length, 1);
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo",
    body: {
      ...inserted,
      undoneLabel: "удаление кадра",
      undoneTarget: { displayFrameNumber: 2, op: "deleteFrame" },
    },
  }];
  document.querySelector("#global-undo").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#storyboard").querySelectorAll(".story-card").length, 2);
  assert.match(statusText(), /Отменено: удаление кадра/);
});

test("action status stays visible when the edited card is offscreen", async () => {
  await ensurePage();
  page.applyVisual(readyVisual({
    frames: [{
      id: "display-1",
      structureFrameId: "structure-1",
      durationFrames: 36,
      layout: "single",
      dialogue: "",
      frameKind: "image",
      panels: [{ id: "panel-a", description: "", subject: null }],
    }],
  }));
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations",
    body: readyVisual({ changed: false }),
  }];
  selectFrameCard(0);
  const duration = [...document.querySelector("#frame-inspector").querySelectorAll("input")]
    .find((input) => input.type === "number");
  duration.value = "36";
  duration.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = document.querySelector("#action-status");
  assert.equal(status.hidden, false);
  assert.match(statusText(), /Без изменений/);
  assert.equal(status.getAttribute("aria-live"), "polite");
});

test("cross dissolve is sent with render and does not post a storyboard operation", async () => {
  await ensurePage();
  page.applyVisual(readyVisual({
    storyboardVersionId: "version-locked",
    frames: [{
      ...readyVisual().frames[0],
      durationFrames: 36,
    }, {
      id: "display-2",
      structureFrameId: "structure-2",
      durationFrames: 36,
      frameKind: "image",
      dialogue: "",
      layout: "single",
      panels: [{ id: "panel-b", description: "" }],
    }],
  }));
  productPosts.length = 0;
  const select = document.querySelector("#render-transition");
  select.value = "cross-dissolve";
  select.dispatchEvent({ type: "change" });
  assert.match(document.querySelector("#render-runtime").textContent, /Cross dissolve 6/);
  assert.equal(productPosts.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations"), false);
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/render",
    status: 202,
    body: {
      status: "running",
      id: "render-1",
      transition: "cross-dissolve",
      overlapFrames: 6,
      totalDurationFrames: 66,
      nominalDurationFrames: 72,
    },
  }];
  document.querySelector("#start-render").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const renderPost = productPosts.find((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/render");
  assert.equal(renderPost.body.transition, "cross-dissolve");
  assert.equal(productPosts.some((entry) => entry.path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations"), false);
});

test("the intro selector is filled from the catalog response and only changes the render request", async () => {
  await ensurePage();
  const versionBefore = "version-locked";
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/intro-templates",
    method: "GET",
    body: {
      templates: [{
        id: "story-shards-v1",
        version: 1,
        label: "Шаблон из каталога",
        durationFrames: 180,
        available: true,
        reason: null,
        message: null,
      }],
    },
  }];
  page.applyVisual(readyVisual({
    storyboardVersionId: versionBefore,
    frames: [{
      ...readyVisual().frames[0],
      durationFrames: 36,
    }, {
      id: "display-2",
      structureFrameId: "structure-2",
      durationFrames: 36,
      frameKind: "image",
      dialogue: "",
      layout: "single",
      panels: [{ id: "panel-b", description: "" }],
    }],
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const transition = document.querySelector("#render-transition");
  transition.value = "hard-cut";
  transition.dispatchEvent({ type: "change" });
  const select = document.querySelector("#render-intro");
  assert.equal(select.value, "");
  const labels = select.querySelectorAll("option").map((option) => option.textContent);
  assert.deepEqual(labels, ["Без интро", "Шаблон из каталога"]);
  assert.match(document.querySelector("#render-runtime").textContent, /Итого 2\.4 с/);
  select.value = "story-shards-v1";
  select.dispatchEvent({ type: "change" });
  assert.match(document.querySelector("#render-runtime").textContent, /Итого 8\.4 с/);
  assert.equal(document.querySelector("#start-render").disabled, false);
  productPosts.length = 0;
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/render",
    status: 400,
    body: {
      status: "failed",
      kind: "intro-cast-count",
      message: "Осколки истории доступны только для двух или трёх персонажей текущей раскадровки.",
    },
  }];
  document.querySelector("#start-render").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const renderPost = productPosts.find((entry) => entry.method === "POST" && entry.path.endsWith("/visual/render"));
  assert.equal(renderPost.body.introTemplateId, "story-shards-v1");
  assert.equal(Object.hasOwn(renderPost.body, "title"), false);
  assert.equal(Object.hasOwn(renderPost.body, "names"), false);
  assert.equal(Object.hasOwn(renderPost.body, "assetIds"), false);
  assert.equal(productPosts.some((entry) => entry.path.endsWith("/visual/operations")), false);
  const error = document.querySelector("#render-error");
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /двух или трёх/);
});

function panelRegenerateButton() {
  const section = document.querySelector("#detail-panel-controls").children[0];
  return [...section.querySelectorAll("button")].find((button) => /Переделать|Создать/i.test(button.textContent));
}

async function flushTicks(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("detail dialog shows panel generation states without closing", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), 0);
  page.openResearchDetail(0);
  const detail = document.querySelector("#detail");
  assert.equal(detail.open, true);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
  const original = fetchImpl;
  let release = () => {};
  let started = false;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (/\/panels\/\d+\/generate$/.test(path)) {
      started = true;
      await new Promise((resolve) => { release = resolve; });
      return jsonResponse(200, readyVisual());
    }
    return original(url, init);
  };
  try {
    const button = panelRegenerateButton();
    button.dispatchEvent({ type: "click" });
    for (let index = 0; index < 10 && !started; index += 1) await flushTicks(1);
    const running = document.querySelector("#detail-generation-status");
    assert.equal(detail.open, true);
    assert.equal(running.hidden, false);
    assert.equal(running.dataset.kind, "running");
    assert.match(running.textContent, /Создаю панель 1 кадра 1/);
    assert.equal(running.getAttribute("aria-live"), "polite");
    assert.equal(button.disabled, true);
    assert.equal(document.querySelector("#action-status").dataset.kind, "running");
    release();
    await flushTicks(12);
    const success = document.querySelector("#detail-generation-status");
    assert.equal(detail.open, true);
    assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
    assert.equal(success.hidden, false);
    assert.equal(success.dataset.kind, "success");
    assert.match(success.textContent, /Панель 1 кадра 1 готова/);
    assert.equal(panelRegenerateButton().disabled, false);
    assert.equal(document.body.dataset.busy, undefined);
    assert.equal(document.querySelector("#action-status").dataset.kind, "success");
  } finally {
    fetchImpl = original;
  }

  for (const [kind, pattern] of [
    ["reference-payload-too-large", /не помещаются|не отправлялась/],
    ["provider-payload-too-large", /413/],
    ["provider", /Провайдер не завершил/],
    ["timeout", /слишком много времени/],
  ]) {
    fetchImpl = async (url, init = {}) => {
      const path = new URL(url, "http://127.0.0.1").pathname;
      if (/\/panels\/\d+\/generate$/.test(path)) return jsonResponse(422, { status: "failed", kind });
      return original(url, init);
    };
    page.openResearchDetail(0);
    panelRegenerateButton().dispatchEvent({ type: "click" });
    await flushTicks(12);
    const status = document.querySelector("#detail-generation-status");
    assert.equal(detail.open, true, kind);
    assert.equal(status.hidden, false, kind);
    assert.equal(status.dataset.kind, "error", kind);
    assert.match(status.textContent, pattern, kind);
    assert.equal(status.getAttribute("aria-live"), "assertive", kind);
    assert.equal(panelRegenerateButton().disabled, false, kind);
    assert.equal(document.querySelector("#action-status").dataset.kind, "error", kind);
    fetchImpl = original;
  }
});

test("page-level status still reports outside the frame detail dialog", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual({ canUndo: true, undoLabel: "кадр" }), -1);
  document.querySelector("#detail").close();
  const original = fetchImpl;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path === "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo") return jsonResponse(500, { status: "failed", kind: "database" });
    return original(url, init);
  };
  try {
    const undo = document.querySelector("#global-undo");
    undo.disabled = false;
    undo.dispatchEvent({ type: "click" });
    await flushTicks(12);
    const pageStatus = document.querySelector("#action-status");
    const localStatus = document.querySelector("#detail-generation-status");
    assert.equal(document.querySelector("#detail").open, false);
    assert.equal(pageStatus.hidden, false);
    assert.equal(pageStatus.dataset.kind, "error");
    assert.match(statusText(), /Не удалось сохранить|Не удалось выполнить/);
    assert.equal(localStatus.hidden, true);
  } finally {
    fetchImpl = original;
  }
});

function frameCards() {
  return [...document.querySelector("#storyboard").querySelectorAll(".story-card")];
}

function frameNumbers() {
  return frameCards().map((card) => (
    [...card.querySelectorAll("span")].map((node) => node.textContent).find((text) => String(text).startsWith("Кадр"))
  ));
}

function buttonNamed(text, root = document.querySelector("#frame-inspector")) {
  return [...root.querySelectorAll("button")].find((button) => button.textContent === text) ?? null;
}

function selectFrameCard(index) {
  frameCards()[index].dispatchEvent({ type: "click" });
}

function openFrameCard(index) {
  buttonNamed("Открыть", frameCards()[index]).dispatchEvent({ type: "click" });
}

function visualFrame(id, extras = {}) {
  return {
    id,
    structureFrameId: id,
    structureSegmentIndex: null,
    durationFrames: 36,
    layout: "single",
    frameKind: "image",
    dialogueMode: "spoken",
    dialogue: "Привет",
    visualReady: true,
    panels: [{ id: `${id}-panel`, description: "описание", subject: "Аня", assetId: "asset-1" }],
    ...extras,
  };
}

test("duplicate frame control opens the copy and one undo returns to the source", async () => {
  await ensurePage();
  const source = visualFrame("structure-a");
  const neighborFrame = visualFrame("structure-b", { dialogue: "Дальше", panels: [{ id: "panel-b", description: "сосед", assetId: "asset-2" }] });
  page.applyVisual(readyVisual({
    canUndo: false,
    frames: [source, neighborFrame],
  }));
  selectFrameCard(0);
  const duplicate = buttonNamed("Дублировать кадр");
  assert.ok(duplicate);
  assert.ok(buttonNamed("Кадр с изображением после"));
  assert.notEqual(duplicate.textContent, "Кадр с изображением после");
  const textCard = visualFrame("structure-card", { frameKind: "text", textCard: "Пауза", panels: [], dialogue: "" });
  page.applyVisual(readyVisual({ frames: [textCard] }));
  selectFrameCard(0);
  assert.ok(buttonNamed("Дублировать кадр"));
  page.applyVisual(readyVisual({
    canUndo: true,
    undoLabel: "дублирование кадра",
    frames: [source, neighborFrame],
  }));

  const copy = visualFrame("structure-copy", { dialogue: "Привет" });
  researchPosts.length = 0;
  productPosts.length = 0;
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations",
    body: readyVisual({
      canUndo: true,
      undoLabel: "дублирование кадра",
      storyboardVersionId: "version-copy",
      approved: false,
      readyForVideo: false,
      changed: true,
      operationResult: {
        op: "duplicateFrame",
        source: { structureFrameId: "structure-a", structureSegmentIndex: null },
        created: { structureFrameId: "structure-copy", structureSegmentIndex: null },
      },
      frames: [source, copy, neighborFrame],
    }),
  }];
  selectFrameCard(0);
  buttonNamed("Дублировать кадр").dispatchEvent({ type: "click" });
  await flushTicks(8);
  const operationPosts = productPosts.filter((entry) => entry.path.endsWith("/visual/operations"));
  assert.equal(operationPosts.length, 1);
  assert.equal(operationPosts[0].body.op, "duplicateFrame");
  assert.equal(operationPosts[0].body.structureFrameId, "structure-a");
  assert.deepEqual(frameNumbers(), ["Кадр 1", "Кадр 2", "Кадр 3"]);
  assert.equal(document.querySelector("#detail").open, true);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 2");
  document.querySelector("#next-frame").dispatchEvent({ type: "click" });
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 3");
  openFrameCard(0);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
  document.querySelector("#next-frame").dispatchEvent({ type: "click" });
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 2");

  const pair = researchPair("frame_duplicate");
  assert.equal(pair.start.context.structureFrameId, "structure-a");
  assert.equal(pair.start.context.displayFrameNumber, 1);
  assert.equal(pair.terminal.outcome, "success");
  assert.equal(pair.terminal.resultContext.createdStructureFrameId, "structure-copy");
  assert.equal(pair.terminal.resultContext.createdDisplayFrameNumber, 2);
  const operations = document.querySelector("#research-operations-list").textContent
    || [...document.querySelector("#research-operations-list").querySelectorAll("li")].map((item) => item.textContent).join(" ");
  assert.match(operations, /frame_duplicate/);
  assert.match(operations, /structure-a/);
  assert.match(operations, /structure-copy/);

  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/storyboard/undo",
    body: readyVisual({
      canUndo: false,
      undoLabel: null,
      storyboardVersionId: "version-source",
      frames: [source, neighborFrame],
      undoneLabel: "дублирование кадра",
      undoneTarget: {
        op: "duplicateFrame",
        structureFrameId: "structure-a",
        source: { structureFrameId: "structure-a", structureSegmentIndex: null },
        created: { structureFrameId: "structure-copy", structureSegmentIndex: null },
      },
    }),
  }];
  document.querySelector("#global-undo").dispatchEvent({ type: "click" });
  await flushTicks(8);
  assert.equal(document.querySelector("#detail").open, true);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
  assert.deepEqual(frameNumbers(), ["Кадр 1", "Кадр 2"]);
  assert.equal(frameCards()[1].dataset.structureFrameId, "structure-b");
});

test("duplicating a directing-beat card opens the copied segment, not the next ordinal guess", async () => {
  await ensurePage();
  const first = visualFrame("beat#1", { structureFrameId: "beat", structureSegmentIndex: 0, dialogue: "Раз" });
  const second = visualFrame("beat#2", { structureFrameId: "beat", structureSegmentIndex: 1, dialogue: "Два" });
  const after = visualFrame("after");
  page.applyVisual(readyVisual({ frames: [first, second, after] }));
  selectFrameCard(1);
  const note = [...document.querySelector("#frame-inspector").querySelectorAll(".assembly-note")].map((node) => node.textContent).join(" ");
  assert.match(note, /Дублирование, вставка, удаление и порядок/);
  const copyFirst = visualFrame("beat-copy#1", { structureFrameId: "beat-copy", structureSegmentIndex: 0, dialogue: "Раз" });
  const copySecond = visualFrame("beat-copy#2", { structureFrameId: "beat-copy", structureSegmentIndex: 1, dialogue: "Два" });
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations",
    body: readyVisual({
      canUndo: true,
      undoLabel: "дублирование кадра",
      changed: true,
      operationResult: {
        op: "duplicateFrame",
        source: { structureFrameId: "beat", structureSegmentIndex: 1 },
        created: { structureFrameId: "beat-copy", structureSegmentIndex: 1 },
      },
      frames: [first, second, copyFirst, copySecond, after],
    }),
  }];
  buttonNamed("Дублировать кадр").dispatchEvent({ type: "click" });
  await flushTicks(8);
  assert.deepEqual(frameNumbers(), ["Кадр 1", "Кадр 2", "Кадр 3", "Кадр 4", "Кадр 5"]);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 4");
  assert.equal(document.querySelector("#detail").open, true);
});

test("a failed duplicate leaves the source open and records failure", async () => {
  await ensurePage();
  const source = visualFrame("structure-a");
  page.applyVisual(readyVisual({ frames: [source, visualFrame("structure-b")] }));
  openFrameCard(0);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
  researchPosts.length = 0;
  productPosts.length = 0;
  globalThis.__visualScript = [{
    path: "/api/projects/00000000-0000-4000-8000-000000000001/visual/operations",
    status: 400,
    body: { status: "failed", kind: "frame-not-found" },
  }];
  buttonNamed("Дублировать кадр").dispatchEvent({ type: "click" });
  await flushTicks(8);
  assert.equal(document.querySelector("#detail").open, true);
  assert.equal(document.querySelector("#detail-frame-number").textContent, "Кадр 1");
  assert.equal(frameCards().length, 2);
  const pair = researchPair("frame_duplicate");
  assert.equal(pair.terminal.outcome, "failure");
  assert.equal(pair.terminal.resultContext, undefined);
  assert.equal(pair.start.context.structureFrameId, "structure-a");
  assert.match(statusText(), /структурный кадр|Не удалось/);
});

test("a second duplicate click while the first request is busy does not send another operation", async () => {
  await ensurePage();
  page.applyVisual(readyVisual({ frames: [visualFrame("structure-a"), visualFrame("structure-b")] }));
  const original = fetchImpl;
  let release = null;
  let operationPosts = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path.endsWith("/visual/operations")) {
      operationPosts += 1;
      await gate;
      return jsonResponse(200, readyVisual({
        changed: true,
        canUndo: true,
        undoLabel: "дублирование кадра",
        operationResult: {
          op: "duplicateFrame",
          source: { structureFrameId: "structure-a", structureSegmentIndex: null },
          created: { structureFrameId: "structure-copy", structureSegmentIndex: null },
        },
        frames: [visualFrame("structure-a"), visualFrame("structure-copy"), visualFrame("structure-b")],
      }));
    }
    return original(url, init);
  };
  try {
    selectFrameCard(0);
    buttonNamed("Дублировать кадр").dispatchEvent({ type: "click" });
    for (let i = 0; i < 20 && operationPosts === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    buttonNamed("Дублировать кадр").dispatchEvent({ type: "click" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(operationPosts, 1);
    release();
    await flushTicks(8);
  } finally {
    release?.();
    fetchImpl = original;
  }
});
