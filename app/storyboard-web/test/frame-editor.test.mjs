import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyOperation } from "../assembly.mjs";
import { defaultDurationFrames } from "../timing.mjs";
import {
  buttonNamed,
  flush,
  harness,
  jsonResponse,
  loadWorkspacePage,
  mutatingRequests,
  productRequests,
  readyVisual,
  resetRecorder,
  textOf,
} from "./workspace-harness.mjs";

const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
const page = await loadWorkspacePage();
const $ = (selector) => document.querySelector(selector);
const cards = () => $("#storyboard").querySelectorAll(".story-card");
const panelSection = (index) => $("#detail-panel-controls").children[index];

function openCard(index) {
  buttonNamed(cards()[index], "Открыть").dispatchEvent({ type: "click", stopPropagation() {} });
}

function setEditorMode(mode) {
  const radio = $("#frame-dialogue").querySelectorAll("input[name='frame-dialogue-mode']").find((input) => input.value === mode);
  for (const input of $("#frame-dialogue").querySelectorAll("input[name='frame-dialogue-mode']")) {
    input.checked = input.value === mode;
  }
  $("#frame-dialogue").dispatchEvent({ type: "change", target: radio });
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

function stageBox() {
  return $("#detail-frame").querySelector(".frame-stage");
}

test("the final frame stays visible on every Frame Editor tab", async () => {
  await reset();
  openCard(0);
  assert.equal($("#detail-frame").hidden, false);
  assert.ok($("#detail-frame").querySelector(".frame-canvas"));
  for (const label of ["Диалог", "Панель 1", "Панель 2", "Кадр"]) {
    buttonNamed($("#frame-editor-tabs"), label).click();
    assert.equal($("#detail-frame").hidden, false, label);
    assert.ok($("#detail-frame").querySelector(".frame-canvas"), label);
  }
  assert.equal(mutatingRequests().length, 0);
});

test("clicking the dialogue region and each visual panel selects that tab", async () => {
  await reset();
  openCard(0);
  $("#detail-frame").querySelector(".dialogue-bar").dispatchEvent({ type: "click" });
  assert.equal($("#detail").dataset.editorTab, "dialogue");
  assert.equal($("#frame-dialogue").hidden, false);
  assert.equal($("#detail-frame").querySelector(".dialogue-bar").className.includes("is-selected"), true);
  $("#detail-frame").querySelector(".panel[data-panel-index='1']").dispatchEvent({ type: "click" });
  assert.equal($("#detail").dataset.editorTab, "panel-1");
  assert.equal(panelSection(1).hidden, false);
  assert.equal($("#detail-frame").querySelector(".panel[data-panel-index='1']").className.includes("panel-selected"), true);
  $("#detail-frame").querySelector(".panel[data-panel-index='0']").dispatchEvent({ type: "click" });
  assert.equal($("#detail").dataset.editorTab, "panel-0");
  assert.equal(mutatingRequests().length, 0);
});

test("Молчание is empty and Без реплики removes the dialogue area", async () => {
  await reset();
  openCard(0);
  setEditorMode("silent");
  const bar = $("#detail-frame").querySelector(".dialogue-bar");
  assert.ok(bar);
  assert.equal(bar.querySelector(".dialogue-text"), null);
  assert.equal(textOf(bar).includes("…"), false);
  assert.equal(textOf(bar).includes("..."), false);
  assert.equal(textOf(bar).includes("Путин"), false);
  setEditorMode("hidden");
  assert.equal($("#detail-frame").querySelector(".dialogue-bar"), null);
  assert.equal(mutatingRequests().length, 0);
});

test("duration fields stay synchronized, reset, refuse truncation, and undo", async () => {
  await reset();
  openCard(0);
  const frames = $("#frame-editor-frame").querySelector("#frame-duration-frames");
  const seconds = $("#frame-editor-frame").querySelector("#frame-duration-seconds");
  assert.equal(frames.value, "72");
  assert.equal(seconds.value, "2.4");
  seconds.value = "3";
  seconds.dispatchEvent({ type: "input" });
  assert.equal(frames.value, "90");
  frames.value = "80";
  frames.dispatchEvent({ type: "input" });
  assert.equal(seconds.value, formatSeconds(80 / 30));
  frames.dispatchEvent({ type: "change" });
  await flush(16);
  const saved = productRequests().filter((entry) => entry.body?.op === "setDuration");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body.durationFrames, 80);
  assert.equal(harness.requests.some((entry) => /generate|revision/.test(entry.path)), false);

  resetRecorder();
  const resetFrames = defaultDurationFrames("Привет");
  buttonNamed($("#frame-editor-frame"), `Сбросить длительность · ${formatSeconds(resetFrames / 30)} с`).click();
  await flush(16);
  const resetRequest = productRequests().find((entry) => entry.body?.op === "setDuration");
  assert.equal(resetRequest.body.durationFrames, resetFrames);

  await reset();
  openCard(0);
  harness.respond = (entry) => {
    if (entry.body?.op === "setDuration") {
      return jsonResponse(409, { status: "failed", kind: "duration-truncates-dialogue" });
    }
    return null;
  };
  const short = $("#frame-editor-frame").querySelector("#frame-duration-frames");
  short.value = "10";
  short.dispatchEvent({ type: "change" });
  await flush(16);
  assert.equal($("#detail").open, true);
  assert.equal($("#action-status").dataset.kind, "error");
  assert.match(textOf($("#action-status")), /оборвёт реплику/);

  await reset(readyVisual({ canUndo: true, undoLabel: "длительность кадра" }));
  openCard(0);
  assert.equal($("#global-undo").disabled, false);
  assert.match($("#global-undo").textContent, /Отменить: длительность кадра/);
  resetRecorder();
  $("#global-undo").click();
  await flush(16);
  assert.equal(productRequests().some((entry) => entry.path.endsWith("/visual/storyboard/undo")), true);
});

test("Кадр tab adds, swaps, and deletes panels with the existing speaker rule", async () => {
  await reset();
  openCard(1);
  buttonNamed($("#frame-editor-frame"), "Добавить панель").click();
  await flush(16);
  assert.equal(productRequests().find((entry) => entry.body?.op === "addPanel").body.op, "addPanel");

  await reset();
  openCard(0);
  buttonNamed($("#frame-editor-frame"), "Поменять панели местами").click();
  await flush(16);
  const swapped = productRequests().find((entry) => entry.body?.op === "reorderPanels");
  assert.deepEqual(swapped.body.panelIds, ["p-1b", "p-1a"]);

  await reset();
  openCard(0);
  resetRecorder();
  const previous = globalThis.confirm;
  globalThis.confirm = () => false;
  buttonNamed($("#frame-editor-frame"), "Удалить панель 1").click();
  assert.equal(mutatingRequests().length, 0);
  globalThis.confirm = () => true;
  buttonNamed($("#frame-editor-frame"), "Удалить панель 1").click();
  await flush(16);
  const removedSpeaker = productRequests().find((entry) => entry.body?.op === "deletePanel");
  assert.equal(removedSpeaker.body.panelId, "p-1a");
  assert.equal(removedSpeaker.body.confirmSpeakerTransfer, true);
  resetRecorder();
  buttonNamed($("#frame-editor-frame"), "Удалить панель 2").click();
  await flush(16);
  const removedListener = productRequests().find((entry) => entry.body?.op === "deletePanel");
  assert.equal(removedListener.body.panelId, "p-1b");
  assert.equal(removedListener.body.confirmSpeakerTransfer, false);
  globalThis.confirm = previous;
  assert.equal(harness.requests.some((entry) => /generate|revision-candidate/.test(entry.path)), false);
});

test("a dialogue draft survives tabs and leave confirmation appears only when it is dirty", async () => {
  await reset();
  openCard(0);
  $("#close-detail").click();
  assert.equal($("#frame-editor-leave").hidden, true);
  assert.equal($("#detail").open, false);

  openCard(0);
  buttonNamed($("#frame-editor-tabs"), "Диалог").click();
  $("#frame-dialogue-text").value = "Черновик реплики";
  $("#frame-dialogue-text").dispatchEvent({ type: "input" });
  buttonNamed($("#frame-editor-tabs"), "Кадр").click();
  buttonNamed($("#frame-editor-tabs"), "Панель 1").click();
  buttonNamed($("#frame-editor-tabs"), "Диалог").click();
  assert.equal($("#frame-dialogue-text").value, "Черновик реплики");
  assert.equal(mutatingRequests().length, 0);

  $("#next-frame").click();
  assert.equal($("#frame-editor-leave").hidden, false);
  assert.equal($("#detail-frame-number").textContent, "Кадр 1");
  $("#frame-editor-leave-stay").click();
  assert.equal($("#frame-editor-leave").hidden, true);
  assert.equal($("#detail").open, true);
  assert.equal($("#frame-dialogue-text").value, "Черновик реплики");

  $("#next-frame").click();
  assert.equal($("#frame-editor-leave").hidden, false);
  $("#frame-editor-leave-discard").click();
  assert.equal($("#detail-frame-number").textContent, "Кадр 2");
  $("#prev-frame").click();
  assert.equal($("#detail-frame-number").textContent, "Кадр 1");
  assert.equal($("#frame-dialogue-text").value, "Привет");
  assert.equal(mutatingRequests().length, 0);

  $("#frame-dialogue-text").value = "Сохранённый черновик";
  $("#close-detail").click();
  assert.equal($("#frame-editor-leave").hidden, false);
  resetRecorder();
  $("#frame-editor-leave-save").click();
  await flush(40);
  const saved = productRequests().filter((entry) => entry.body?.op === "setFrameDialogue");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body.text, "Сохранённый черновик");
  assert.equal(saved[0].body.dialogueMode, "spoken");
  assert.equal($("#detail").open, false);
});

test("failed dialogue save keeps the editor and the draft", async () => {
  await reset();
  openCard(0);
  buttonNamed($("#frame-editor-tabs"), "Диалог").click();
  $("#frame-dialogue-text").value = "   ";
  $("#close-detail").click();
  $("#frame-editor-leave-save").click();
  await flush(4);
  assert.equal($("#detail").open, true);
  assert.equal($("#frame-editor-leave").hidden, true);
  assert.match($("#frame-dialogue-error").textContent, /Введите текст реплики/);
  assert.equal($("#frame-dialogue-text").value, "   ");
  assert.equal(mutatingRequests().length, 0);
});

test("the editor shows one global Undo and no Redo", async () => {
  await reset(readyVisual({ canUndo: true, undoLabel: "реплику кадра" }));
  openCard(0);
  assert.equal($("#frame-editor-undo").querySelectorAll("button").length, 1);
  assert.equal($("#frame-editor-undo").contains($("#global-undo")), true);
  assert.match($("#global-undo").textContent, /Отменить: реплику кадра/);
  assert.equal($("#detail").textContent.includes("Redo"), false);
  assert.equal($("#detail").textContent.includes("Повторить"), false);
  $("#detail").close();
  assert.equal($("#workspace-undo-slot").contains($("#global-undo")), true);
});

test("hidden controls are absent while text-card insert and reference data remain", async () => {
  const visual = readyVisual();
  visual.frames[0].panels[0].performanceAssetId = "pose-1";
  visual.frames[2].textCard = "Пауза";
  await reset(visual);
  openCard(0);
  assert.equal($("#utterance-edit").hidden, true);
  assert.equal(buttonNamed($("#frame-inspector"), "Текстовая карточка после"), null);
  assert.equal(buttonNamed($("#frame-inspector"), "Создать изображения кадра"), null);
  buttonNamed($("#frame-editor-tabs"), "Панель 1").click();
  assert.equal(panelSection(0).querySelector("input[type='file']"), null);
  assert.equal(textOf(panelSection(0)).includes("фото позы"), false);
  assert.match(textOf(panelSection(0)), /Базовый образ/);
  assert.equal(visual.frames[0].panels[0].performanceAssetId, "pose-1");
  assert.equal(visual.frames[2].textCard, "Пауза");
  const inserted = applyOperation([{
    id: "frame-1",
    layout: "single",
    dialogue: "",
    panels: [{ id: "solo", description: "" }],
  }], {
    op: "insertFrame",
    afterStructureFrameId: "frame-1",
    kind: "text",
  }, { idFactory: () => "frame-text" });
  assert.equal(inserted.ok, true);
  assert.equal(inserted.frames[1].frameKind, "text");
});

test("panel zoom and pan stay inside the frame and leave Кадрирование open", async () => {
  await reset();
  openCard(0);
  buttonNamed($("#frame-editor-tabs"), "Панель 1").click();
  const stage = stageBox();
  const width = stage.style.width;
  const height = stage.style.height;
  const framing = panelSection(0).querySelector("[data-panel-section='framing']");
  assert.equal(framing.tagName, "SECTION");
  const zoom = framing.querySelector("input[type='range']");
  zoom.value = zoom.max;
  zoom.dispatchEvent({ type: "input" });
  assert.match($("#detail-frame").querySelector(".panel-asset").style.transform, /scale\(3\)/);
  zoom.dispatchEvent({ type: "change" });
  await flush(16);
  assert.equal(stageBox().style.width, width);
  assert.equal(stageBox().style.height, height);
  const framingNow = panelSection(0).querySelector("[data-panel-section='framing']");
  assert.equal(framingNow.tagName, "SECTION");
  assert.ok(framingNow.querySelector("input"));

  const column = $("#detail-frame").querySelector(".panel");
  column.dispatchEvent({ type: "pointerdown", clientX: 40, clientY: 40, button: 0, pointerId: 4 });
  column.dispatchEvent({ type: "pointermove", clientX: 90, clientY: 70, button: 0, pointerId: 4 });
  column.dispatchEvent({ type: "pointerup", clientX: 90, clientY: 70, button: 0, pointerId: 4 });
  await flush(16);
  assert.equal(stageBox().style.width, width);
  assert.equal(stageBox().style.height, height);
  const framingAfter = panelSection(0).querySelector("[data-panel-section='framing']");
  assert.equal(framingAfter.querySelector("input").hidden, false);
  assert.match(css, /#detail-frame \.panel,/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.frame-editor-body\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.equal(productRequests().some((entry) => /generate|revision-candidate/.test(entry.path)), false);
  assert.equal(productRequests().some((entry) => /placement/.test(entry.path)), true);
});

test("the temporary legacy panel revision entry stays reachable without a provider call", async () => {
  await reset();
  openCard(0);
  buttonNamed($("#frame-editor-tabs"), "Панель 1").click();
  const image = panelSection(0).querySelector("[data-panel-section='image']");
  assert.match(textOf(image), /Уточнить текущее/);
  assert.match(textOf(image), /Новая вариация/);
  assert.ok(image.querySelector("textarea"));
  assert.equal($("#detail-frame").hidden, false);
  assert.equal(productRequests().some((entry) => /revision-candidate|\/generate$/.test(entry.path)), false);
});

function formatSeconds(value) {
  return String(Math.round(Number(value) * 1000) / 1000);
}
