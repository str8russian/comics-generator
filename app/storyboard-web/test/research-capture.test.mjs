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
    let body = null;
    if (init.body != null) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    if (path.startsWith("/api/research/events") && method === "POST") {
      researchPosts.push(body);
      return jsonResponse(201, {
        event: {
          ...body,
          seq: researchPosts.length,
          occurredAt: `2026-10-13T12:00:${String(researchPosts.length).padStart(2, "0")}.000Z`,
          durationMs: body.eventKind === "action_terminal" ? 12 : null,
        },
      });
    }
    if (path.startsWith("/api/research/trace")) return jsonResponse(200, { events: [] });
    if (path.startsWith("/api/research/notes")) return jsonResponse(201, { event: { eventKind: "note" } });
    if (path === "/api/project") {
      return jsonResponse(200, {
        draft: {
          text: "",
          revisionToken: "11111111-1111-4111-8111-111111111111",
        },
      });
    }
    if (path === "/api/draft") {
      return jsonResponse(200, {
        revisionToken: "22222222-2222-4222-8222-222222222222",
        text: typeof body?.text === "string" ? body.text : (document.querySelector("#draft")?.value || ""),
      });
    }
    if (path === "/api/visual") return jsonResponse(200, { status: "missing" });

    productPosts.push({ path, method, body });

    if (path === "/api/readings" && method === "POST") {
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
    if (path === "/api/confirmations" && method === "POST") {
      return jsonResponse(200, { materialStateId: "material-1" });
    }
    if (path === "/api/storyboard-results" && method === "POST") {
      return jsonResponse(200, {
        status: "checked",
        frames: readyVisual().frames,
        sourceItems: [],
        readyEligible: true,
      });
    }
    if (path === "/api/visual/storyboard/edit" || path === "/api/visual/storyboard/undo") {
      return jsonResponse(200, readyVisual({ canUndo: path.endsWith("edit") }));
    }
    if (path === "/api/visual/approve") return jsonResponse(200, readyVisual({ approved: true, readyForVideo: true }));
    if (/\/api\/visual\/frames\/[^/]+\/generate$/.test(path)) return jsonResponse(200, readyVisual());
    if (/\/api\/visual\/frames\/[^/]+\/panels\/\d+\/generate$/.test(path)) {
      return jsonResponse(200, readyVisual());
    }
    if (/\/api\/visual\/frames\/[^/]+\/panels\/\d+\/placement$/.test(path)) {
      return jsonResponse(200, readyVisual());
    }
    if (/\/identity$/.test(path)) return jsonResponse(200, readyVisual());
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
    if (path.startsWith("/api/readings/") && path.endsWith("/cast") && method === "PUT") {
      return jsonResponse(200, { ok: true });
    }
    if (path === "/api/material-states" && method === "POST") {
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
  assert.ok(productPosts.some((entry) => entry.path === "/api/readings"));
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

test("structure_edit and structure_undo capture storyboard targets on product controls", async () => {
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
  document.querySelector("#undo-structure").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const undo = researchPair("structure_undo");
  assert.equal(undo.start.submittedText, null);
  assert.equal(undo.start.commandTarget.kind, "storyboard");
  assert.equal(undo.terminal.outcome, "success");
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
  page.setResearchVisualState(readyVisual(), 0);
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
  assert.equal(placement.start.commandTarget.positionX, 50);
  assert.equal(placement.start.commandTarget.positionY, 30);
  assertFixedContextKeys(placement.start.context);
  assert.equal(placement.start.context.displayFrameId, "display-1");
  assert.equal(placement.start.context.structureFrameId, "structure-1");
  assert.equal(placement.start.context.structureSegmentIndex, 0);
  assert.equal(placement.start.context.panelIndex, 0);
  assert.equal(placement.start.context.panelSubject, "Путин");
  assert.equal(placement.start.context.imageAssetId, "asset-1");
  assert.equal(placement.start.context.generationId, null);
});

test("identity_save comment-only; anchor_generate/approve and visual_approve capture targets", async () => {
  await ensurePage();
  page.setResearchVisualState(readyVisual(), -1);
  let card = document.querySelector("#character-cards").children[0];
  assert.ok(card);
  const comment = card.querySelectorAll("textarea")[0];
  const saveIdentity = card.querySelectorAll("button").find((button) => /Сохранить фото|Сохранить новое фото/.test(button.textContent));
  const identityInput = card.querySelector("input");
  comment.value = "только комментарий идентичности";
  identityInput.files = [{ name: "face.png", type: "image/png", size: 128 }];
  saveIdentity.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const identity = researchPair("identity_save");
  assert.equal(identity.start.submittedText, "только комментарий идентичности");
  assert.equal(identity.start.commandTarget.kind, "character");
  assert.equal(identity.start.commandTarget.characterName, "Путин");
  assertFixedContextKeys(identity.start.context);
  assert.equal(identity.start.context.characterName, "Путин");
  assert.equal(identity.start.context.imageAssetId, "identity-asset-1");
  assert.equal(identity.start.context.anchorVersionId, null);
  assert.equal(identity.start.context.generationId, null);
  assert.equal(JSON.stringify(identity.start).includes("imageDataUrl"), false);
  assert.equal(JSON.stringify(identity.start).includes("data:image"), false);

  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual(), -1);
  card = document.querySelector("#character-cards").children[0];
  const textareas = card.querySelectorAll("textarea");
  const anchorInstruction = textareas[1] || textareas[0];
  const generateAnchor = card.querySelectorAll("button").find((button) => /base anchor|новый вариант|Создать/.test(button.textContent));
  assert.ok(generateAnchor);
  anchorInstruction.value = "сделай строже";
  generateAnchor.disabled = false;
  generateAnchor.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const anchorGen = researchPair("anchor_generate");
  assert.equal(anchorGen.start.submittedText, "сделай строже");
  assert.equal(anchorGen.start.commandTarget.kind, "character");
  assertFixedContextKeys(anchorGen.start.context);
  assert.equal(anchorGen.start.context.characterName, "Путин");
  assert.equal(anchorGen.start.context.anchorVersionId, "anchor-1");
  assert.equal(anchorGen.start.context.imageAssetId, "anchor-asset-1");

  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual({
    characters: [{
      name: "Путин",
      identity: { assetId: "identity-asset-1", assetUrl: "/id.png", comment: "x" },
      candidate: { id: "anchor-1", assetId: "anchor-asset-1", assetUrl: "/a.png", status: "ready" },
      approvedAnchorId: null,
    }],
  }), -1);
  const approveAnchor = document.querySelector("#character-cards").children[0].querySelectorAll("button")
    .find((button) => /Утвердить этот образ/.test(button.textContent));
  assert.ok(approveAnchor);
  approveAnchor.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const anchorApprove = researchPair("anchor_approve");
  assert.equal(anchorApprove.start.submittedText, null);
  assert.equal(anchorApprove.start.commandTarget.characterName, "Путин");
  assert.equal(anchorApprove.start.commandTarget.anchorVersionId, "anchor-1");
  assertFixedContextKeys(anchorApprove.start.context);
  assert.equal(anchorApprove.start.context.characterName, "Путин");
  assert.equal(anchorApprove.start.context.anchorVersionId, "anchor-1");
  assert.equal(anchorApprove.start.context.imageAssetId, "anchor-asset-1");

  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual({
    characters: [{
      name: "Путин",
      identity: { assetUrl: "/id.png", comment: "без assetId" },
      candidate: { id: "anchor-orphan", assetUrl: "/a.png", status: "ready" },
      approvedAnchorId: null,
    }],
  }), -1);
  card = document.querySelector("#character-cards").children[0];
  const orphanComment = card.querySelectorAll("textarea")[0];
  const orphanSave = card.querySelectorAll("button").find((button) => /Сохранить фото|Сохранить новое фото/.test(button.textContent));
  const orphanInput = card.querySelector("input");
  orphanComment.value = "коммент без asset";
  orphanInput.files = [{ name: "face.png", type: "image/png", size: 128 }];
  orphanSave.dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const identityNullAsset = researchPair("identity_save");
  assert.equal(identityNullAsset.start.context.characterName, "Путин");
  assert.equal(identityNullAsset.start.context.imageAssetId, null);

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
      assert.ok(productPosts.some((entry) => entry.method === "PUT" && entry.path === "/api/readings/reading-1/cast"));
    } else {
      assert.ok(productPosts.some((entry) => entry.method === "POST" && entry.path === "/api/material-states"));
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
      assert.ok(productPosts.some((entry) => entry.method === "PUT" && entry.path === "/api/readings/reading-1/cast"));
    } else {
      assert.ok(productPosts.some((entry) => entry.method === "POST" && entry.path === "/api/material-states"));
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
      assert.ok(productPosts.some((entry) => entry.method === "PUT" && entry.path === "/api/readings/reading-1/cast"));
    } else {
      assert.ok(productPosts.some((entry) => entry.method === "POST" && entry.path === "/api/material-states"));
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
  const product = productPosts.find((entry) => entry.path === "/api/visual/storyboard/edit");
  assert.ok(product);
  assert.equal(product.body.instruction, exact.trim());

  researchPosts.length = 0;
  productPosts.length = 0;
  document.querySelector("#structure-instruction").value = "   \n\t  ";
  document.querySelector("#structure-edit-form").dispatchEvent({ type: "submit", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(researchPosts.length, 0);
  assert.equal(productPosts.filter((entry) => entry.path === "/api/visual/storyboard/edit").length, 0);
});

test("failed cast save never claims cast_edit success terminal", async () => {
  await ensurePage();
  const original = fetchImpl;
  fetchImpl = async (url, init = {}) => {
    const path = new URL(url, "http://127.0.0.1").pathname;
    if (path.startsWith("/api/readings/") && path.endsWith("/cast")) {
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
    if (path === "/api/research/events") {
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
    if (path === "/api/research/events") {
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
      if (path === "/api/research/events") {
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
    assert.ok(productPosts.some((entry) => entry.path === "/api/visual/storyboard/edit"));
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
      if (path === "/api/research/events") {
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
      if (path === "/api/research/events") {
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
      if (path === "/api/visual/storyboard/edit") {
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
    assert.ok(productPosts.some((entry) => entry.path === "/api/visual/storyboard/edit"));

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
      if (path === "/api/research/events") {
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
    assert.ok(productPosts.some((entry) => entry.path === "/api/visual/storyboard/edit"));
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
