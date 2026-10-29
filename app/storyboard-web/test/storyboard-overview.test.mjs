import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectOperations } from "../public/research-dock.mjs";
import {
  buttonNamed,
  flush,
  harness,
  loadWorkspacePage,
  mutatingRequests,
  productRequests,
  readyVisual,
  researchStarts,
  resetRecorder,
  textOf,
} from "./workspace-harness.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
const page = await loadWorkspacePage();

const $ = (selector) => document.querySelector(selector);
const cards = () => $("#storyboard").querySelectorAll(".story-card");
const card = (index) => cards()[index];
const inspector = () => $("#frame-inspector");

const DESKTOP_BORDER_BOX = 384;
const CARD_PADDING = 12;
const CARD_BORDER = 1;
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;
const DESKTOP_CONTENT = DESKTOP_BORDER_BOX - CARD_PADDING * 2 - CARD_BORDER * 2;

function panel(overrides = {}) {
  return {
    id: "panel",
    description: "",
    subject: "Катерина",
    assetId: null,
    ...overrides,
  };
}

function imageFrame(overrides = {}) {
  return {
    id: "display",
    structureFrameId: "structure",
    structureSegmentIndex: null,
    layout: "single",
    origin: "source",
    frameKind: "image",
    dialogueMode: "spoken",
    speakerPanel: 0,
    dialogue: "Обычная реплика",
    durationFrames: 58,
    durationSeconds: 1.933,
    minimumDurationFrames: 1,
    visualReady: false,
    outsideFrameText: "",
    panels: [panel()],
    ...overrides,
  };
}

function overviewVisual(frames) {
  return readyVisual({
    frames: frames.map((frame, index) => ({
      ...frame,
      id: frame.id || `display-${index + 1}`,
      structureFrameId: frame.structureFrameId || `s-${index + 1}`,
    })),
  });
}

async function show(frames) {
  const detail = $("#detail");
  if (detail.open) detail.close();
  harness.visual = overviewVisual(frames);
  harness.script = [];
  harness.respond = null;
  page.applyVisual(harness.visual);
  page.clearFrameSelection?.();
  await flush(4);
  resetRecorder();
}

function chromeText(node) {
  if (!node || node.hidden) return "";
  const className = String(node.className || "");
  if (className.split(/\s+/).includes("frame-host")) return "";
  if (!node.children?.length) return String(node.textContent || "");
  return node.children.map(chromeText).filter(Boolean).join(" ");
}

function assertImageFooter(index) {
  const node = card(index);
  const preview = node.querySelector(".frame-preview");
  const foot = node.querySelector(".card-foot");
  const children = [...node.children];
  assert.equal(node.querySelector(".card-heading"), null, `card ${index + 1} has no top heading`);
  assert.equal(children[0], preview, `card ${index + 1} preview is first`);
  assert.ok(children.indexOf(preview) < children.indexOf(foot), `card ${index + 1} preview before footer`);
  assert.equal(foot.querySelector(".card-frame-number")?.textContent, `Кадр ${index + 1}`);
  assert.equal(foot.children.at(-1)?.textContent, "Открыть");
  assert.equal(foot.querySelectorAll("button").length, 1);
  assert.equal(foot.querySelector(".card-status"), null);
  const statuses = node.querySelector(".card-statuses");
  if (statuses) {
    assert.ok(children.indexOf(statuses) > children.indexOf(preview));
    assert.ok(children.indexOf(statuses) < children.indexOf(foot));
    assert.equal(foot.contains(statuses), false);
  }
}

function stageOf(index) {
  return card(index).querySelector(".frame-stage");
}

function stageBox(index) {
  const stage = stageOf(index);
  const width = Number.parseFloat(stage.style.width);
  const height = Number.parseFloat(stage.style.height);
  const scale = Number(stage.dataset.frameScale);
  return { stage, width, height, scale };
}

function assertPreviewFits(index, contentWidth) {
  const box = stageBox(index);
  assert.ok(Number.isFinite(box.width) && box.width > 0, `card ${index} width`);
  assert.ok(box.width <= contentWidth + 0.01, `card ${index} preview ${box.width}px exceeds content ${contentWidth}px`);
  assert.ok(Math.abs(box.width - contentWidth) < 0.01, `card ${index} width ${box.width} is not the content box ${contentWidth}`);
  assert.ok(Math.abs(box.height / box.width - FRAME_HEIGHT / FRAME_WIDTH) < 1e-9, `card ${index} is not 16:9`);
  assert.ok(Math.abs(box.scale - box.width / FRAME_WIDTH) < 1e-9, `card ${index} scale is not width/1920`);
  assert.notEqual(box.width, FRAME_WIDTH * 0.2);
  assert.notEqual(box.scale, 0.2);
  assert.equal(box.stage.style.overflow || "", "");
}

test("ordinary spoken single and split2 cards keep only overview content", async () => {
  await show([
    imageFrame({
      layout: "single",
      dialogue: "Реплика Катерины",
      panels: [panel({ id: "p-a", subject: "Катерина", assetId: null })],
    }),
    imageFrame({
      layout: "split2",
      dialogue: "Реплика Ильи",
      speakerPanel: 1,
      panels: [
        panel({ id: "p-b", subject: "Катерина", assetId: null }),
        panel({ id: "p-c", subject: "Илья", assetId: null }),
      ],
    }),
  ]);
  for (const [index, layout] of [[0, "single"], [1, "split2"]]) {
    const node = card(index);
    const text = chromeText(node);
    assert.match(text, new RegExp(`Кадр ${index + 1}`));
    assert.equal(node.querySelector(".frame-stage") != null, true, layout);
    assert.equal(buttonNamed(node, "Открыть") != null, true, layout);
    assert.equal(node.querySelector(".card-meta"), null, layout);
    assert.equal(node.querySelector(".card-line"), null, layout);
    assert.equal(node.querySelector(".card-bases"), null, layout);
    assert.equal(node.querySelector(".panel-basis"), null, layout);
    assert.equal(node.querySelector(".card-duration"), null, layout);
    assert.equal(node.querySelector(".card-status"), null, layout);
    assertImageFooter(index);
    for (const piece of [layout, "Реплика", "Катерина", "Илья", "Текст", "1.933", "58 кадров", "Нет изображения"]) {
      assert.equal(text.includes(piece), false, `${layout} still shows ${piece}`);
    }
  }
  card(0).dispatchEvent({ type: "keydown", key: "Enter", target: card(0) });
  assert.equal(card(0).getAttribute("aria-current"), "true");
  assert.equal(card(0).classList.contains("is-selected"), true);
  assert.equal(mutatingRequests().length, 0);
});

test("explicit silent and hidden cards show only those dialogue statuses", async () => {
  await show([
    imageFrame({ dialogueMode: "silent", dialogue: "Спрятанная строка", panels: [panel({ subject: "Катерина" })] }),
    imageFrame({ dialogueMode: "hidden", dialogue: "Ещё строка", panels: [panel({ subject: "Илья" })] }),
  ]);
  assert.equal(card(0).querySelector(".card-status").textContent, "Молчание");
  assert.equal(card(0).querySelector(".card-status-error"), null);
  assert.equal(textOf(card(0)).includes("Спрятанная строка"), false);
  assert.equal(card(1).querySelector(".card-status").textContent, "Без реплики");
  assert.equal(textOf(card(1)).includes("Ещё строка"), false);
  assert.equal(textOf(card(0)).includes("Реплика"), false);
  assertImageFooter(0);
  assertImageFooter(1);
});

test("persisted generation failure is an overview error and a missing image is not", async () => {
  await show([
    imageFrame({
      dialogueMode: "spoken",
      dialogue: "Реплика",
      retainedImageNotice: "Показан предыдущий готовый вариант.",
      panels: [panel({
        subject: "Катерина",
        assetId: "asset-kept",
        asset: "/kept.png",
        generationStatus: "failed",
        generationError: "provider",
      })],
    }),
    imageFrame({
      dialogueMode: "silent",
      panels: [panel({ assetId: null, generationStatus: "failed", generationError: "provider" })],
    }),
    imageFrame({
      dialogueMode: "spoken",
      dialogue: "",
      panels: [panel({ assetId: null, subject: "Илья" })],
    }),
  ]);
  const retained = card(0).querySelector(".card-status-error");
  assert.equal(retained?.textContent, "Ошибка генерации");
  assert.equal(retained.dataset.status, "generation-error");
  assert.match(chromeText(card(0)), /Показан предыдущий готовый вариант/);
  assert.equal(chromeText(card(0)).includes("Реплика"), false);
  assert.equal(chromeText(card(0)).includes("Изображение"), false);
  const both = [...card(1).querySelectorAll(".card-status")].map((node) => node.textContent);
  assert.deepEqual(both, ["Молчание", "Ошибка генерации"]);
  assert.equal(card(1).querySelector(".card-status-error").textContent, "Ошибка генерации");
  assert.equal(card(2).querySelector(".card-status"), null);
  assert.equal(card(2).querySelector(".card-status-error"), null);
  assert.equal(textOf(card(2)).includes("Ошибка"), false);
  assertImageFooter(0);
  assertImageFooter(1);
  assertImageFooter(2);
});

test("text cards, open, selection, and outside-frame text stay available", async () => {
  await show([
    imageFrame({
      layout: "single",
      dialogueMode: "spoken",
      dialogue: "Не на карточке",
      outsideFrameText: "За кадром: стук",
      panels: [panel({ assetId: "asset-1", asset: "/a.png" })],
    }),
    {
      layout: "single",
      origin: "derived",
      frameKind: "text",
      textCard: "Пауза на экране",
      dialogue: "",
      durationFrames: 36,
      durationSeconds: 1.2,
      minimumDurationFrames: 1,
      visualReady: true,
      panels: [],
    },
  ]);
  assert.match(chromeText(card(0)), /За кадром: стук/);
  assert.equal(card(0).querySelector(".card-line"), null);
  assert.equal(chromeText(card(0)).includes("Не на карточке"), false);
  card(0).dispatchEvent({ type: "click" });
  assert.equal(card(0).getAttribute("aria-current"), "true");
  assert.equal(card(0).classList.contains("is-selected"), true);
  assert.equal(mutatingRequests().length, 0);
  card(0).dispatchEvent({ type: "dblclick" });
  assert.equal($("#detail").open, true);
  $("#detail").close();
  assertImageFooter(0);
  const textNode = card(1);
  assert.deepEqual([...textNode.children].map((node) => node.className), [
    "card-heading",
    "card-meta",
    "frame-preview",
    "card-line",
    "card-foot",
  ]);
  assert.match(textOf(textNode.querySelector(".card-heading")), /Кадр 2/);
  assert.match(textOf(textNode.querySelector(".card-heading")), /Текстовая карточка/);
  assert.equal(textNode.querySelector(".card-frame-number"), null);
  assert.match(textNode.querySelector(".card-meta").textContent, /Текстовая карточка/);
  assert.match(textNode.querySelector(".card-line").textContent, /Пауза на экране/);
  assert.match(textNode.querySelector(".card-duration").textContent, /1\.2 с · 36 кадров/);
  assert.equal(buttonNamed(textNode, "Открыть") != null, true);
  buttonNamed(textNode, "Открыть").dispatchEvent({ type: "click", stopPropagation() {} });
  assert.equal($("#detail").open, true);
  assert.equal($("#detail-frame-number").textContent, "Кадр 2");
  $("#detail").close();
  card(1).dispatchEvent({ type: "click" });
  assert.match(textOf(inspector()), /Выбран кадр/);
  assert.ok(buttonNamed(inspector(), "Открыть редактор кадра"));
  assert.ok(inspector().querySelector("input.inspector-duration"));
  assert.ok(inspector().querySelector("textarea.inspector-text-card"));
  assert.equal(buttonNamed(inspector(), "Текстовая карточка после"), null);
  assert.equal(mutatingRequests().length, 0);
});

test("a directing-beat image frame keeps the whole-frame segment note", async () => {
  await show([imageFrame({ structureSegmentIndex: 1 })]);
  card(0).dispatchEvent({ type: "click" });
  assert.match(textOf(inspector()), /Это часть структурного кадра/);
  assert.equal(inspector().querySelector("[data-inspector-section='more']"), null);
  assert.equal(inspector().querySelector("[data-inspector-section='images']"), null);
  assertImageFooter(0);
  assert.equal(mutatingRequests().length, 0);
});

test("preview width and height follow the card content box for single and split2", async () => {
  await show([
    imageFrame({ layout: "single", panels: [panel({ id: "one" })] }),
    imageFrame({
      layout: "split2",
      panels: [panel({ id: "left" }), panel({ id: "right", subject: "Илья" })],
    }),
  ]);
  assert.equal(DESKTOP_CONTENT < FRAME_WIDTH * 0.2, true);
  for (const index of [0, 1]) assertPreviewFits(index, DESKTOP_CONTENT);

  const widths = [358, 280, 220];
  for (const contentWidth of widths) {
    for (const index of [0, 1]) {
      const host = card(index).querySelector(".frame-host");
      host.clientWidth = contentWidth;
    }
    page.refitFramePreviews();
    for (const index of [0, 1]) assertPreviewFits(index, contentWidth);
  }
  const geometry = page.framePreviewGeometry(DESKTOP_CONTENT);
  assert.equal(geometry.width, DESKTOP_CONTENT);
  assert.equal(geometry.height, DESKTOP_CONTENT * (FRAME_HEIGHT / FRAME_WIDTH));
  assert.equal(geometry.scale, DESKTOP_CONTENT / FRAME_WIDTH);
  assert.equal(/\.story-card\s*\{[^}]*overflow:\s*hidden/.test(css), false);
  const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.equal(/\.story-card\s*\{[^}]*overflow:\s*(?:auto|hidden|clip)/.test(narrow), false);
});

test("inspector has no dialogue block and the frame editor keeps dialogue save", async () => {
  await show([
    imageFrame({
      layout: "split2",
      dialogueMode: "spoken",
      speakerPanel: 0,
      dialogue: "Сохранённая реплика",
      panels: [
        panel({ id: "p-kate", subject: "Катерина" }),
        panel({ id: "p-ilya", subject: "Илья" }),
      ],
    }),
  ]);
  card(0).dispatchEvent({ type: "click" });
  assert.equal(inspector().querySelector("[data-inspector-section='dialogue']"), null);
  assert.equal(textOf(inspector()).includes("Диалог"), false);
  assert.equal(textOf(inspector()).includes("Кто говорит"), false);
  assert.equal(textOf(inspector()).includes("Сохранённая реплика"), false);
  assert.equal(textOf(inspector()).includes("Черновик диалога не меняется"), false);
  assert.equal(buttonNamed(inspector(), "Открыть редактор кадра"), null);
  assert.equal(textOf(inspector()).includes("Выбран кадр"), false);
  assert.equal(textOf(inspector()).includes("split2"), false);
  assert.equal(inspector().querySelector("[data-inspector-section='timing']"), null);
  assert.equal(inspector().querySelector("[data-inspector-section='more']"), null);
  assert.equal(inspector().querySelector("[data-inspector-section='images']"), null);
  assert.equal(inspector().querySelector("input"), null);
  assert.equal(inspector().querySelector("select"), null);
  assert.ok(buttonNamed(inspector(), "Дублировать кадр"));
  assert.equal(mutatingRequests().length, 0);
  assert.equal(researchStarts().length, 0);

  buttonNamed(card(0), "Открыть").dispatchEvent({ type: "click", stopPropagation() {} });
  buttonNamed($("#frame-editor-tabs"), "Диалог").dispatchEvent({ type: "click" });
  const editor = $("#frame-dialogue");
  assert.equal(editor.hidden, false);
  const modes = [...editor.querySelectorAll("input[name='frame-dialogue-mode']")].map((input) => input.value);
  assert.deepEqual(modes, ["spoken", "silent", "hidden"]);
  assert.equal($("#frame-dialogue-text").value, "Сохранённая реплика");
  const speakers = [...$("#frame-dialogue-speaker").querySelectorAll("input")].map((input) => input.value);
  assert.deepEqual(speakers, ["p-kate", "p-ilya"]);
  assert.equal($("#frame-dialogue-save"), null);
  assert.equal($("#frame-dialogue-add"), null);
  assert.equal($("#frame-dialogue-remove"), null);
  assert.match(html, /id="frame-editor-leave-save"[^>]*>Сохранить/);
  assert.match(html, /id="frame-editor-leave-discard"[^>]*>Не сохранять/);
  assert.match(html, /id="frame-editor-leave-stay"[^>]*>Остаться/);

  $("#frame-dialogue-text").value = "   ";
  $("#close-detail").click();
  $("#frame-editor-leave-save").click();
  await flush(4);
  assert.equal($("#detail").open, true);
  assert.match($("#frame-dialogue-error").textContent, /Введите текст реплики/);
  assert.equal(mutatingRequests().length, 0);

  $("#frame-dialogue-text").value = "Новая реплика кадра";
  for (const input of $("#frame-dialogue-speaker").querySelectorAll("input")) input.checked = input.value === "p-ilya";
  $("#close-detail").click();
  $("#frame-editor-leave-save").click();
  await flush(8);
  const posts = productRequests().filter((entry) => entry.method !== "GET");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.op, "setFrameDialogue");
  assert.equal(posts[0].body.dialogueMode, "spoken");
  assert.equal(posts[0].body.text, "Новая реплика кадра");
  assert.equal(posts[0].body.speakerPanelId, "p-ilya");
  assert.equal(researchStarts("frame_dialogue").length, 1);
});

test("command surfaces and the obsolete demonstration sentence are gone", async () => {
  await show([imageFrame()]);
  assert.equal(html.includes("Демонстрация с базовыми образами персонажей"), false);
  assert.equal($("#anchor-note"), null);
  assert.equal($("#structure-tools"), null);
  assert.equal($("#structure-instruction"), null);
  assert.equal($("#structure-edit-form"), null);
  assert.equal(html.includes("Что изменить в кадрах?"), false);
  for (const id of [
    "research-commands",
    "research-commands-scope",
    "research-commands-target",
    "research-commands-draft",
    "research-commands-send",
    "research-commands-history",
    "research-commands-form",
  ]) {
    assert.equal($(`#${id}`), null, id);
    assert.equal(html.includes(`id="${id}"`), false, id);
  }
  assert.ok($("#research-notes"));
  assert.ok($("#research-operations"));
  const toggle = $("#research-dock-toggle");
  const resize = $("#research-dock-resize");
  assert.match(html, /id="research-dock"[^>]*aria-label="Заметки"/);
  assert.match(html, /id="research-dock-resize"[^>]*aria-label="Изменить размер заметок"/);
  assert.match(toggle.textContent, /Заметки/);
  assert.equal(/[Кк]оманд/.test(html.slice(html.indexOf('id="research-dock"'), html.indexOf('id="research-notes"'))), false);
  assert.equal(/[Кк]оманд/.test(toggle.textContent), false);
  assert.equal(/команд/.test(resize.getAttribute?.("aria-label") || ""), false);
  assert.equal(resize.hidden, false);
  toggle.click();
  assert.match(toggle.textContent, /Заметки/);
  assert.equal(page.getResearchDock().isCollapsed(), true);
  toggle.click();
  assert.equal(page.getResearchDock().isCollapsed(), false);
});

test("historical command events stay in the operations projection and product controls still capture research", async () => {
  const projected = projectOperations({
    events: [
      {
        eventKind: "action_start",
        correlationId: "old-command",
        surface: "dock_commands",
        semanticAction: "structure_edit",
        submittedText: "старая команда",
        commandTarget: { kind: "storyboard" },
        seq: 4,
      },
      {
        eventKind: "action_terminal",
        correlationId: "old-command",
        surface: "dock_commands",
        semanticAction: "structure_edit",
        outcome: "success",
        submittedText: "старая команда",
        commandTarget: { kind: "storyboard" },
        seq: 5,
      },
    ],
  });
  assert.equal(projected.some((item) => item.surface === "dock_commands" && item.status === "success"), true);
  assert.match(projected.map((item) => item.label).join("\n"), /structure_edit/);

  await show([imageFrame({ durationFrames: 36, minimumDurationFrames: 1 })]);
  card(0).dispatchEvent({ type: "click" });
  assert.equal(inspector().querySelector("input.inspector-duration"), null);
  buttonNamed(card(0), "Открыть").dispatchEvent({ type: "click", stopPropagation() {} });
  const input = $("#frame-editor-frame").querySelector("#frame-duration-frames");
  input.value = "40";
  input.dispatchEvent({ type: "change" });
  await flush(8);
  assert.equal(researchStarts("frame_duration").length, 1);
  assert.equal(researchStarts("frame_duration")[0].surface, "product_control");
  const dock = page.getResearchDock();
  assert.equal(typeof dock.executeDockCommand, "undefined");
  assert.equal(typeof dock.setAvailableTargets, "undefined");
  assert.equal(typeof dock.selectCommandTarget, "undefined");
});
