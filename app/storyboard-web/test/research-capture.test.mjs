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
      identity: { assetUrl: "/id.png", comment: "исходный" },
      candidate: { id: "anchor-1", assetId: "anchor-1", assetUrl: "/a.png", status: "ready" },
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

  researchPosts.length = 0;
  productPosts.length = 0;
  page.setResearchVisualState(readyVisual(), 0);
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

  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual({
    characters: [{
      name: "Путин",
      identity: { assetUrl: "/id.png", comment: "x" },
      candidate: { id: "anchor-1", assetId: "anchor-1", assetUrl: "/a.png", status: "ready" },
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

  researchPosts.length = 0;
  page.setResearchVisualState(readyVisual(), -1);
  document.querySelector("#approve-visual").hidden = false;
  document.querySelector("#approve-visual").dispatchEvent({ type: "click" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const visual = researchPair("visual_approve");
  assert.equal(visual.start.submittedText, null);
  assert.equal(visual.start.commandTarget.kind, "storyboard");
});

test("cast_edit captures rename/alias/speaker with phase and value-only editTarget", async () => {
  await ensurePage();
  page.setResearchReviewState({
    id: "reading-1",
    text: "текст",
    sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Реплика" }],
    cast: {
      characters: [{ name: "Путин" }],
      aliases: [{ surface: "Владимир", characterName: "Путин" }],
      speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
    },
    surfaceForms: [{ quote: "Владимир" }],
    findings: [],
  }, "reading");

  const nameInput = document.querySelector("#material-characters").querySelector("input");
  nameInput.value = "Песков";
  nameInput.dispatchEvent({ type: "input" });
  assert.equal(researchPosts.length, 0);
  nameInput.dispatchEvent({ type: "blur" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const rename = researchPair("cast_edit");
  assert.equal(rename.start.submittedText, "Песков");
  assert.equal(rename.start.commandTarget, null);
  assert.equal(rename.start.editTarget.editKind, "character_rename");
  assert.equal(rename.start.editTarget.castPhase, "pending_reading");
  assert.equal(rename.start.editTarget.characterName, "Песков");
  assert.equal(rename.start.editTarget.previousCharacterName, "Путин");
  assert.equal(Object.hasOwn(rename.start, "cast"), false);
  assert.equal(JSON.stringify(rename.start).includes("sourceItems"), false);
  assert.equal(rename.terminal.outcome, "success");

  researchPosts.length = 0;
  page.setResearchReviewState({
    id: "material-1",
    text: "текст",
    sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Реплика" }],
    cast: {
      characters: [{ name: "Песков" }, { name: "Дуров" }],
      aliases: [{ surface: "Владимир", characterName: "Песков" }],
      speakers: [{ sourceItemId: "utterance-1", characterName: "Песков" }],
    },
    surfaceForms: [{ quote: "Владимир" }],
    findings: [],
  }, "material");
  const aliasSelect = document.querySelector("#material-aliases").querySelector("select");
  aliasSelect.value = "Дуров";
  aliasSelect.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const alias = researchPair("cast_edit");
  assert.equal(alias.start.editTarget.editKind, "alias_assignment");
  assert.equal(alias.start.editTarget.castPhase, "material_state");
  assert.equal(alias.start.editTarget.surfaceForm, "Владимир");
  assert.equal(alias.start.submittedText, "Дуров");

  researchPosts.length = 0;
  const speakerSelect = document.querySelector("#material-speakers").querySelector("select");
  speakerSelect.value = "Дуров";
  speakerSelect.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const speaker = researchPair("cast_edit");
  assert.equal(speaker.start.editTarget.editKind, "speaker_assignment");
  assert.equal(speaker.start.editTarget.sourceItemId, "utterance-1");
  assert.equal(speaker.start.submittedText, "Дуров");
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
