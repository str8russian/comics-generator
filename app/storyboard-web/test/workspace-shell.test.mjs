import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  API,
  buttonNamed,
  flush,
  harness,
  loadWorkspacePage,
  mutatingRequests,
  parityFrames,
  productRequests,
  readyVisual,
  requestSignature,
  researchSignature,
  researchStarts,
  resetRecorder,
  textOf,
  visibleTextOf,
} from "./workspace-harness.mjs";

const baseline = JSON.parse(readFileSync(new URL("./workspace-operation-baseline.json", import.meta.url), "utf8"));
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

const page = await loadWorkspacePage();

const $ = (selector) => document.querySelector(selector);
const cards = () => $("#storyboard").querySelectorAll(".story-card");
const card = (index) => cards()[index];
const inspector = () => $("#frame-inspector");
const inspectorButton = (text) => buttonNamed(inspector(), text);
const panelSection = (index) => $("#detail-panel-controls").children[index];
const stageButton = (id) => $("#stage-nav").querySelectorAll("button").find((node) => node.dataset.stage === id);

function selectCard(index) {
  card(index).dispatchEvent({ type: "click" });
}

function openCard(index) {
  buttonNamed(card(index), "Открыть").dispatchEvent({ type: "click", stopPropagation() {} });
}

function pickerPopover() {
  return document.body.children.find((node) => String(node.className).includes("asset-picker")) ?? null;
}

function inspectorSection(name) {
  return inspector().querySelectorAll("[data-inspector-section]").find((node) => node.dataset.inspectorSection === name) ?? null;
}

function setEditorMode(mode) {
  for (const radio of $("#frame-dialogue").querySelectorAll("input[name='frame-dialogue-mode']")) {
    radio.checked = radio.value === mode;
  }
}

function saveDialogueAndLeave() {
  $("#close-detail").click();
  $("#frame-editor-leave-save").click();
}

async function reset(visual = readyVisual()) {
  const detail = $("#detail");
  if (detail.open) detail.close();
  harness.visual = visual;
  harness.script = [];
  harness.respond = null;
  page.applyVisual(visual);
  page.clearFrameSelection?.();
  await flush(4);
  resetRecorder();
}

async function typeSupportedRevision(section) {
  const field = section.querySelector("textarea");
  field.value = "смотрит влево";
  field.dispatchEvent({ type: "input" });
  await new Promise((resolve) => setTimeout(resolve, 260));
}

async function captured(run) {
  await run();
  await flush(12);
  const requests = productRequests().filter((entry) => entry.method !== "GET");
  const starts = researchStarts();
  return { requests, starts };
}

async function assertParity(name, run) {
  const expected = baseline.scenarios[name];
  assert.ok(expected, `baseline has ${name}`);
  await reset();
  const { requests, starts } = await captured(run);
  assert.equal(requests.length, 1, `${name}: one product request`);
  assert.equal(starts.length, 1, `${name}: one research start`);
  assert.deepEqual(requestSignature(requests[0]), expected.request, `${name}: request`);
  if (/\/generate$/.test(requests[0].path)) {
    assert.equal(requests[0].body.correlationId, starts[0].correlationId, `${name}: correlation`);
  }
  assert.deepEqual(researchSignature(starts[0]), expected.research, `${name}: research`);
}

test("locked Video stage shows its reason and enables nothing before a storyboard exists", async () => {
  resetRecorder();
  const startRender = $("#start-render");
  const before = { panel: $("#render-panel").hidden, disabled: startRender.disabled };
  stageButton("video").dispatchEvent({ type: "click" });
  assert.equal($("#stage-view-video").hidden, false);
  const header = textOf($("#stage-header-video"));
  assert.match(header, /Заблокировано/);
  assert.match(header, /раскадровк/i);
  assert.equal($("#render-panel").hidden, before.panel);
  assert.equal($("#render-panel").hidden, true);
  assert.equal(startRender.disabled, before.disabled);
  const next = $("#stage-header-video").querySelectorAll("button");
  assert.equal(next.length, 1);
  next[0].dispatchEvent({ type: "click" });
  assert.equal($("#stage-view-video").hidden, true);
  assert.deepEqual(mutatingRequests(), []);
});

test("header keeps Projects, rename, project duplicate, Undo, build marker and the five stages", () => {
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  for (const marker of ['class="project-back"', 'id="rename-form"', 'id="duplicate-project"', 'id="global-undo"', 'id="build-marker"', 'id="stage-nav"']) {
    assert.ok(header.includes(marker), marker);
  }
  const labels = $("#stage-nav").querySelectorAll("button").map((node) => node.dataset.stage);
  assert.deepEqual(labels, ["story", "storyboard", "characters", "visual", "video"]);
  assert.match(textOf(stageButton("storyboard")), /Раскадровка/);
});

test("loading, notice, failure and action status live outside every stage view", () => {
  const views = [...html.matchAll(/<section id="stage-view-[a-z]+"[\s\S]*?<\/section>\s*<!-- \/stage-view -->/g)].map((m) => [m.index, m.index + m[0].length]);
  assert.equal(views.length, 5);
  const frames = html.indexOf('id="frames-area"');
  for (const id of ["loading", "notice", "failure-codes", "failure-kind", "action-status"]) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    assert.equal(views.some(([start, end]) => at > start && at < end), false, `${id} is not inside a stage view`);
    assert.ok(at < frames, `${id} precedes the frames area`);
  }
});

test("active failure stays visible while navigating every stage", async () => {
  await reset();
  harness.script = [{ path: `${API}/visual/operations`, status: 500, body: { status: "failed", kind: "database" } }];
  selectCard(0);
  inspectorButton("Кадр с изображением после").dispatchEvent({ type: "click" });
  await flush(12);
  const status = $("#action-status");
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.kind, "error");
  $("#loading").hidden = false;
  for (const id of ["story", "storyboard", "characters", "visual", "video"]) {
    stageButton(id).dispatchEvent({ type: "click" });
    assert.equal(status.hidden, false, id);
    assert.equal($("#loading").hidden, false, id);
  }
  $("#loading").hidden = true;
});

test("stage navigation switches the visible view and the shared frame grid", async () => {
  await reset();
  const expectations = {
    story: ["stage-view-story"],
    storyboard: ["stage-view-storyboard", "frames-area"],
    characters: ["stage-view-characters"],
    visual: ["stage-view-visual", "frames-area"],
    video: ["stage-view-video"],
  };
  for (const [id, shown] of Object.entries(expectations)) {
    stageButton(id).dispatchEvent({ type: "click" });
    assert.equal(stageButton(id).getAttribute("aria-current"), "step", id);
    for (const view of ["stage-view-story", "stage-view-storyboard", "stage-view-characters", "stage-view-visual", "stage-view-video", "frames-area"]) {
      assert.equal($(`#${view}`).hidden, !shown.includes(view), `${id}: ${view}`);
    }
  }
  const sections = {
    "stage-view-story": ["draft-form", "material-review"],
    "stage-view-storyboard": ["stage-header-storyboard"],
    "stage-view-characters": ["characters-workspace"],
    "stage-view-visual": ["visual-heading", "visual-approval", "open-last"],
    "stage-view-video": ["ready-for-video", "render-panel"],
    "frames-area": ["storyboard", "frame-inspector"],
  };
  for (const [view, ids] of Object.entries(sections)) {
    const start = html.indexOf(`id="${view}"`);
    const end = html.indexOf(view === "frames-area" ? "<!-- /frames-area -->" : "<!-- /stage-view -->", start);
    for (const id of ids) {
      const at = html.indexOf(`id="${id}"`);
      assert.ok(at > start && at < end, `${id} inside ${view}`);
    }
  }
});

test("stage statuses in the navigation come from loaded state", async () => {
  await reset(readyVisual({ allAnchorsApproved: false, characters: [{ name: "Путин", approvedAnchorId: "a" }, { name: "Дуров", approvedAnchorId: null }] }));
  assert.match(textOf(stageButton("storyboard")), /5 кадров/);
  assert.match(textOf(stageButton("characters")), /1\/2 утверждены/);
  assert.match(textOf(stageButton("visual")), /Нужны базовые образы/);
  await reset();
  assert.match(textOf(stageButton("characters")), /2\/2 утверждены/);
  assert.match(textOf(stageButton("visual")), /3\/5 готовы/);
  stageButton("visual").dispatchEvent({ type: "click" });
  const next = $("#stage-header-visual").querySelector(".stage-next");
  assert.equal(next.textContent, "Открыть кадр 2");
});

test("Visual next action opens the frame and does not batch-generate", async () => {
  await reset();
  stageButton("visual").dispatchEvent({ type: "click" });
  const next = $("#stage-header-visual").querySelector(".stage-next");
  assert.equal(next.textContent, "Открыть кадр 2");
  next.dispatchEvent({ type: "click" });
  assert.equal($("#detail").open, true);
  assert.equal($("#detail-frame-number").textContent, "Кадр 2");
  assert.equal(harness.requests.some((entry) => /generate/.test(entry.path)), false);
});

test("cards are content-first: one Открыть, no assembly, generation or asset controls", async () => {
  await reset();
  assert.equal(cards().length, 5);
  for (const [index, node] of cards().entries()) {
    const controls = node.querySelectorAll("button");
    assert.equal(controls.length, 1, `card ${index + 1} has one button`);
    assert.equal(controls[0].textContent, "Открыть");
    assert.equal(node.querySelectorAll("input").length, 0, `card ${index + 1} inputs`);
    assert.equal(node.querySelectorAll("select").length, 0, `card ${index + 1} selects`);
    assert.equal(node.querySelectorAll("textarea").length, 0, `card ${index + 1} textareas`);
    assert.equal(node.querySelectorAll(".assembly").length, 0);
    assert.equal(node.getAttribute("tabindex"), "0");
  }
  const first = textOf(card(0));
  assert.match(first, /Кадр 1/);
  assert.equal(card(0).querySelector(".card-meta"), null);
  assert.equal(card(0).querySelector(".card-line"), null);
  assert.equal(card(0).querySelector(".card-status"), null);
  assert.equal(card(0).querySelector(".card-duration"), null);
  assert.equal(card(0).querySelector(".panel-basis"), null);
  assert.match(textOf(card(1)), /Без реплики/);
  assert.equal(card(1).querySelector(".card-line"), null);
  assert.match(textOf(card(2)), /Текстовая карточка/);
  assert.match(textOf(card(2)), /Пауза/);
});

test("card body selection is keyboard accessible and visibly marked", async () => {
  await reset();
  assert.match(textOf(inspector()), /Выберите кадр/);
  assert.equal(inspector().querySelectorAll("button").length, 0);
  card(1).dispatchEvent({ type: "keydown", key: "Enter", target: card(1) });
  assert.equal(card(1).getAttribute("aria-current"), "true");
  assert.ok(card(1).classList.contains("is-selected"));
  assert.equal(card(0).getAttribute("aria-current"), null);
  assert.match(textOf(inspector()), /Кадр 2/);
  card(3).dispatchEvent({ type: "keydown", key: " ", target: card(3) });
  assert.equal(card(3).getAttribute("aria-current"), "true");
  assert.equal(card(1).getAttribute("aria-current"), null);
  assert.match(textOf(inspector()), /Кадр 4/);
  assert.equal($("#detail").open, false);
  openCard(0);
  assert.equal($("#detail").open, true);
  assert.equal($("#detail-frame-number").textContent, "Кадр 1");
});

test("inspector groups the frame vocabulary into the accepted sections", async () => {
  await reset();
  selectCard(0);
  for (const name of ["header", "timing", "frame", "more"]) assert.ok(inspectorSection(name), name);
  assert.equal(inspectorSection("dialogue"), null);
  const header = textOf(inspectorSection("header"));
  assert.match(header, /Кадр 1/);
  assert.match(header, /split2/);
  assert.ok(buttonNamed(inspectorSection("header"), "Открыть редактор кадра"));
  assert.ok(buttonNamed(inspectorSection("header"), "Дублировать кадр"));
  for (const label of ["Кадр с изображением после", "Переместить кадр раньше", "Переместить кадр позже", "Удалить кадр"]) {
    assert.ok(buttonNamed(inspectorSection("frame"), label), label);
  }
  assert.equal(buttonNamed(inspectorSection("frame"), "Текстовая карточка после"), null);
  assert.equal(buttonNamed(inspectorSection("frame"), "Переместить кадр раньше").disabled, true);
  const more = inspectorSection("more");
  assert.equal(more.tagName, "DETAILS");
  assert.equal(more.open, false);
  for (const label of ["Поменять панели", "Удалить панель 1.1", "Удалить панель 1.2"]) assert.ok(buttonNamed(more, label), label);
  assert.equal(more.querySelectorAll("button").filter((node) => node.textContent === "Выбрать изображение…").length, 2);
  selectCard(2);
  assert.equal(inspectorSection("dialogue"), null);
  assert.ok(inspectorSection("more").querySelector("textarea"));
});

for (const [name, run] of Object.entries({
  "duplicateFrame": () => { selectCard(0); inspectorButton("Дублировать кадр").click(); },
  "insertFrame.image": () => { selectCard(0); inspectorButton("Кадр с изображением после").click(); },
  "reorderFrames.earlier": () => { selectCard(1); inspectorButton("Переместить кадр раньше").click(); },
  "reorderFrames.later": () => { selectCard(1); inspectorButton("Переместить кадр позже").click(); },
  "deleteFrame": () => { selectCard(1); inspectorButton("Удалить кадр").click(); },
  "setDuration": () => {
    selectCard(0);
    const input = inspectorSection("timing").querySelector("input");
    input.value = "90";
    input.dispatchEvent({ type: "change" });
  },
  "setTextCard": () => {
    selectCard(2);
    const text = inspectorSection("more").querySelector("textarea");
    text.value = "Новый текст";
    text.dispatchEvent({ type: "change" });
  },
  "addPanel": () => { selectCard(1); inspectorButton("Добавить панель").click(); },
  "reorderPanels": () => { selectCard(0); inspectorButton("Поменять панели").click(); },
  "deletePanel.listener": () => { selectCard(0); inspectorButton("Удалить панель 1.2").click(); },
  "deletePanel.speaker": () => { selectCard(0); inspectorButton("Удалить панель 1.1").click(); },
  "setManualSubject": () => {
    selectCard(1);
    const select = inspectorSection("more").querySelectorAll("select").find((node) => node.getAttribute("aria-label") === "Персонаж панели 2.1");
    select.value = "Путин";
    select.dispatchEvent({ type: "change" });
  },
  "assignAsset.imageOnly": () => {
    selectCard(1);
    inspectorSection("more").querySelectorAll("button").find((node) => node.textContent === "Выбрать изображение…").click();
    pickerPopover().querySelectorAll("button").find((node) => node.dataset.assetId === "asset-1").click();
  },
  "assignAsset.carryMetadata": () => {
    selectCard(4);
    const mode = inspectorSection("more").querySelectorAll("select").find((node) => node.getAttribute("aria-label") === "Что перенести с изображением");
    mode.value = "metadata";
    mode.dispatchEvent({ type: "change" });
    inspectorSection("more").querySelectorAll("button").find((node) => node.textContent === "Выбрать изображение…").click();
    pickerPopover().querySelectorAll("button").find((node) => node.dataset.assetId === "asset-1").click();
  },
  "uploadAsset": () => {
    selectCard(1);
    inspectorSection("more").querySelectorAll("button").find((node) => node.textContent === "Выбрать изображение…").click();
    pickerPopover().querySelector(".asset-picker-upload").click();
    const input = document.created.filter((node) => node.tagName === "INPUT" && node.type === "file").at(-1);
    input.files = [{ name: "x.png", type: "image/png", size: 10 }];
    input.dispatchEvent({ type: "change" });
  },
})) {
  test(`parity · inspector · ${name}`, async () => {
    await assertParity(name, run);
  });
}

for (const [name, run] of Object.entries({
  "setFrameDialogue.silent": async () => {
    openCard(0);
    resetRecorder();
    setEditorMode("silent");
    saveDialogueAndLeave();
  },
  "setFrameDialogue.speaker": async () => {
    openCard(0);
    resetRecorder();
    setEditorMode("spoken");
    for (const radio of $("#frame-dialogue-speaker").querySelectorAll("input")) radio.checked = radio.value === "p-1b";
    saveDialogueAndLeave();
  },
  "setFrameDialogue.hidden": async () => {
    openCard(0);
    resetRecorder();
    setEditorMode("hidden");
    saveDialogueAndLeave();
  },
  "setFrameDialogue.singleSilent": async () => {
    openCard(3);
    resetRecorder();
    setEditorMode("silent");
    saveDialogueAndLeave();
  },
  "placement.zoom": async () => {
    openCard(0);
    resetRecorder();
    const zoom = panelSection(0).querySelectorAll("input").find((node) => node.type === "range");
    zoom.value = "1.5";
    zoom.dispatchEvent({ type: "input" });
    zoom.dispatchEvent({ type: "change" });
  },
  "placement.mirror": async () => {
    openCard(0);
    resetRecorder();
    panelSection(0).querySelectorAll("button").find((node) => node.dataset.placementAction === "mirror").click();
  },
  "placement.reset": async () => {
    openCard(0);
    resetRecorder();
    panelSection(0).querySelectorAll("button").find((node) => node.dataset.placementAction === "reset").click();
  },
  "placement.pan": async () => {
    openCard(0);
    resetRecorder();
    const column = $("#detail-frame").querySelectorAll(".panel").find((node) => Number(node.dataset.panelIndex) === 0);
    column.dispatchEvent({ type: "pointerdown", clientX: 100, clientY: 80, button: 0, pointerId: 1 });
    column.dispatchEvent({ type: "pointermove", clientX: 146.8, clientY: 119, button: 0, pointerId: 1 });
    column.dispatchEvent({ type: "pointerup", clientX: 146.8, clientY: 119, button: 0, pointerId: 1 });
  },
  "panelGenerate": async () => {
    openCard(0);
    resetRecorder();
    buttonNamed($("#frame-editor-tabs"), "Панель 1").click();
    const section = panelSection(0);
    await typeSupportedRevision(section);
    section.querySelectorAll("button").find((node) => node.textContent === "Создать кандидат").click();
  },
})) {
  test(`parity · Frame Editor · ${name}`, async () => {
    await assertParity(name, run);
  });
}

test("parity · inspector panel shortcut opens the Panel Editor on that panel for the existing regenerate", async () => {
  await assertParity("panelGenerate", async () => {
    selectCard(0);
    inspectorButton("Изображение панели 1.1…").click();
    assert.equal($("#detail").open, true);
    assert.equal(panelSection(0).hidden, false);
    resetRecorder();
    await typeSupportedRevision(panelSection(0));
    panelSection(0).querySelectorAll("button").find((node) => node.textContent === "Создать кандидат").click();
  });
});

test("Frame Editor spoken mode without a stored line asks for text and sends nothing", async () => {
  await reset();
  openCard(1);
  resetRecorder();
  setEditorMode("spoken");
  $("#frame-dialogue-text").value = "";
  saveDialogueAndLeave();
  await flush(8);
  assert.deepEqual(mutatingRequests(), []);
  assert.match($("#frame-dialogue-error").textContent, /Введите текст реплики/);
});

test("batch frame generation is absent from the inspector while panel image access remains", async () => {
  await reset();
  selectCard(3);
  assert.equal(inspectorButton("Создать изображения кадра"), null);
  selectCard(0);
  assert.equal(inspectorButton("Создать изображения кадра"), null);
  assert.ok(inspectorButton("Изображение панели 1.1…"));
  await reset(readyVisual({ allAnchorsApproved: false }));
  selectCard(3);
  assert.equal(inspectorButton("Создать изображения кадра"), null);
  assert.ok(inspectorButton("Изображение панели 4.1…"));
});

test("duplicate selects and opens the copy, and Undo does not leave a stale inspector", async () => {
  await reset();
  const frames = parityFrames();
  const copy = { ...frames[0], id: "display-copy", structureFrameId: "s-copy", panels: frames[0].panels.map((panel) => ({ ...panel, id: `${panel.id}-copy` })) };
  harness.script = [{
    path: `${API}/visual/operations`,
    body: readyVisual({
      canUndo: true,
      undoLabel: "дублирование кадра",
      changed: true,
      operationResult: {
        op: "duplicateFrame",
        source: { structureFrameId: "s-1", structureSegmentIndex: null },
        created: { structureFrameId: "s-copy", structureSegmentIndex: null },
      },
      frames: [frames[0], copy, ...frames.slice(1)],
    }),
  }];
  selectCard(0);
  inspectorButton("Дублировать кадр").click();
  await flush(12);
  assert.equal($("#detail").open, true);
  assert.equal($("#detail-frame-number").textContent, "Кадр 2");
  assert.equal(card(1).getAttribute("aria-current"), "true");
  assert.equal(card(1).dataset.structureFrameId, "s-copy");
  assert.match(textOf(inspectorSection("header")), /Кадр 2/);

  $("#detail").close();
  harness.script = [{
    path: `${API}/visual/storyboard/undo`,
    body: readyVisual({
      undoneLabel: "дублирование кадра",
      undoneTarget: { op: "duplicateFrame", structureFrameId: "s-1", source: { structureFrameId: "s-1" }, created: { structureFrameId: "s-copy" } },
    }),
  }];
  $("#global-undo").click();
  await flush(12);
  assert.equal(cards().length, 5);
  const selected = cards().filter((node) => node.getAttribute("aria-current") === "true");
  assert.ok(selected.length <= 1);
  assert.equal(selected.some((node) => node.dataset.structureFrameId === "s-copy"), false);
  const shown = textOf(inspector());
  if (selected.length) assert.match(shown, new RegExp(`Кадр ${cards().indexOf(selected[0]) + 1}`));
  else assert.match(shown, /Выберите кадр/);
});

test("delete selects a neighbour or nothing, never the deleted frame", async () => {
  await reset();
  const frames = parityFrames();
  harness.script = [{
    path: `${API}/visual/operations`,
    body: readyVisual({ canUndo: true, undoLabel: "удаление кадра", frames: [frames[0], ...frames.slice(2)] }),
  }];
  selectCard(1);
  inspectorButton("Удалить кадр").click();
  await flush(12);
  assert.equal(cards().length, 4);
  assert.equal(cards().some((node) => node.dataset.structureFrameId === "s-2"), false);
  const selected = cards().filter((node) => node.getAttribute("aria-current") === "true");
  assert.ok(selected.length <= 1);
  const header = inspectorSection("header");
  if (selected.length) {
    assert.match(textOf(header), new RegExp(`Кадр ${cards().indexOf(selected[0]) + 1}\\b`));
  } else {
    assert.equal(header, null);
    assert.match(textOf(inspector()), /Выберите кадр/);
  }
});

test("Frame Editor keeps the final frame visible and opens one panel tab", async () => {
  await reset();
  openCard(0);
  assert.equal($("#detail").dataset.editorTab, "frame");
  assert.equal($("#detail-frame").hidden, false);
  assert.equal($("#panel-editor").hidden, true);
  assert.equal($("#frame-dialogue").hidden, true);
  buttonNamed($("#frame-editor-tabs"), "Панель 1").click();
  assert.equal($("#detail").dataset.editorTab, "panel-0");
  assert.equal($("#detail-frame").hidden, false);
  assert.equal($("#panel-editor").hidden, false);
  assert.equal($("#frame-dialogue").hidden, true);
  assert.equal(panelSection(0).hidden, false);
  assert.equal(panelSection(1).hidden, true);
  const parts = (index) => Object.fromEntries(panelSection(index).querySelectorAll("[data-panel-section]").map((node) => [node.dataset.panelSection, node]));
  const first = parts(0);
  assert.deepEqual(Object.keys(first), ["image", "framing", "references"]);
  assert.equal(first.image.querySelector(".panel-basis").dataset.basis, "generation");
  assert.match(textOf(first.image), /Текущее изображение/);
  assert.match(textOf(first.image), /Уточнить текущее/);
  assert.match(textOf(first.image), /Новая вариация/);
  assert.match(textOf(first.image), /Что изменить/);
  assert.ok(first.image.querySelectorAll("button").find((node) => node.textContent === "Создать кандидат"));
  assert.equal(first.image.querySelectorAll("button").some((node) => node.textContent === "Принять кандидат"), false);
  assert.equal(first.image.querySelectorAll("button").some((node) => node.textContent === "Отменить черновик"), false);
  assert.equal(first.image.querySelectorAll("button").some((node) => node.textContent === "Переделать эту панель"), false);
  assert.ok(first.image.querySelector("textarea"));
  assert.ok(first.framing.querySelectorAll("input").find((node) => node.type === "range"));
  assert.ok(first.framing.querySelectorAll("button").find((node) => node.dataset.placementAction === "reset"));
  assert.ok(first.framing.querySelectorAll("button").find((node) => node.dataset.placementAction === "mirror"));
  assert.match(textOf(first.framing), /Перетащите/);
  const identity = first.references.querySelector("img");
  assert.equal(identity.src, "/anchor-p.png");
  assert.match(textOf(first.references), /Базовый образ/);
  assert.equal(first.references.querySelector("input"), null);
  assert.equal(panelSection(0).querySelector(".panel-view-header"), null);
  assert.equal(textOf(panelSection(0)).includes("фото позы"), false);

  buttonNamed($("#frame-editor-tabs"), "Панель 2").click();
  assert.equal(panelSection(0).hidden, true);
  assert.equal(panelSection(1).hidden, false);
  assert.equal(parts(1).image.querySelector(".panel-basis").dataset.basis, "upload");
});

test("basis label marks a base character portrait as intentional", async () => {
  const frames = parityFrames();
  const demo = { ...frames[3], panels: [{ id: "p-4", description: "Путин говорит", subject: "Путин", assetId: null }] };
  await reset(readyVisual({ frames: [demo] }));
  assert.equal(card(0).querySelector(".panel-basis"), null);
  selectCard(0);
  const inspectorChip = inspectorSection("more").querySelector(".panel-basis");
  assert.equal(inspectorChip.dataset.basis, "base-portrait");
  assert.match(inspectorChip.textContent, /Базовый образ/);
  openCard(0);
  assert.match(textOf(panelSection(0)), /Базовый образ персонажа/);
});

test("the dock is Notes and Operations, and selecting a panel does not expose a command target", async () => {
  await reset();
  assert.equal($("#research-commands"), null);
  assert.equal($("#research-commands-send"), null);
  assert.equal(html.includes('id="research-commands"'), false);
  const dock = page.getResearchDock();
  assert.equal(typeof dock.getCommandTarget, "undefined");
  assert.equal(typeof dock.setAvailableTargets, "undefined");
  selectCard(0);
  openCard(0);
  buttonNamed($("#frame-editor-tabs"), "Панель 2").click();
  await flush(4);
  assert.equal(productRequests().some((entry) => entry.path.includes("/revision") && entry.method !== "GET"), false);
  assert.equal($("#research-commands-send"), null);
  $("#detail").close();
});

test("Notes and Operations stay separate dock parts", () => {
  for (const id of ["research-notes", "research-operations", "research-notes-send", "research-dock-toggle", "research-dock-resize"]) {
    assert.ok($(`#${id}`), id);
  }
  assert.equal($("#research-commands-draft"), null);
  assert.match($("#research-dock-toggle").textContent, /Заметки/);
});

test("navigation, selection, inspector and editors make no mutation or provider call", async () => {
  await reset();
  for (const id of ["story", "storyboard", "characters", "visual", "video", "storyboard"]) stageButton(id).dispatchEvent({ type: "click" });
  for (let index = 0; index < cards().length; index += 1) {
    selectCard(index);
    card(index).dispatchEvent({ type: "keydown", key: "Enter", target: card(index) });
  }
  const more = inspectorSection("more");
  if (more) more.open = true;
  selectCard(0);
  inspectorButton("Открыть редактор кадра").click();
  for (const button of $("#frame-editor-tabs").querySelectorAll("button")) button.click();
  $("#detail").close();
  selectCard(0);
  inspectorButton("Изображение панели 1.2…").click();
  $("#detail").close();
  openCard(3);
  $("#detail").close();
  await flush(8);
  assert.deepEqual(mutatingRequests(), []);
  assert.equal(harness.requests.some((entry) => /generate/.test(entry.path)), false);
  assert.equal(harness.researchPosts.length, 0);
});

test("visible inspector text never shows another frame after reselecting", async () => {
  await reset();
  selectCard(4);
  assert.match(visibleTextOf(inspectorSection("header")), /Кадр 5/);
  page.clearFrameSelection();
  assert.match(textOf(inspector()), /Выберите кадр/);
});
