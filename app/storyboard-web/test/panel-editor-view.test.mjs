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
  productRequests,
  readyVisual,
  resetRecorder,
  textOf,
} from "./workspace-harness.mjs";

const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
const page = await loadWorkspacePage();
const $ = (selector) => document.querySelector(selector);
const panelSection = (index) => $("#detail-panel-controls").children[index];
const cards = () => $("#storyboard").querySelectorAll(".story-card");

function visualWithCandidate() {
  const visual = readyVisual();
  visual.frames[0].panels[0] = {
    ...visual.frames[0].panels[0],
    revision: {
      draftMode: "refine",
      draftInstruction: "смотрит влево",
      selectedCandidateId: "cand-2",
      summary: {
        basis: { kind: "candidate", ordinal: 1 },
        changes: [{ property: "gaze", value: "screen-left" }],
        preserved: [
          { property: "expression", value: "calm" },
          { property: "framing", value: "close-up" },
        ],
        notApplied: [{ kind: "unsupported", text: "стул" }],
        providerCall: true,
      },
      candidates: [
        { id: "cand-1", ordinal: 1, assetUrl: "/cand-1.png", mode: "refine" },
        { id: "cand-2", ordinal: 2, assetUrl: "/cand-2.png", mode: "refine" },
      ],
    },
  };
  return visual;
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

function openPanelFromInspector() {
  const inspector = $("#frame-inspector");
  buttonNamed(inspector, "Изображение панели 1.1…").click();
}

test("panel shortcut and dock command open focused Panel view without frame dialogue", async () => {
  await reset();
  cards()[0].dispatchEvent({ type: "click" });
  openPanelFromInspector();
  assert.equal($("#detail").open, true);
  assert.equal($("#detail").dataset.view, "panel");
  assert.equal($("#frame-dialogue").hidden, true);
  assert.equal($("#detail-frame").hidden, true);
  assert.match(textOf(panelSection(0).querySelector(".panel-view-header")), /← К кадру/);
  assert.match(textOf(panelSection(0).querySelector(".panel-view-header")), /Панель 1\.1 · Путин/);
  assert.ok(buttonNamed(panelSection(0), "Закрыть"));
  assert.equal(mutatingRequests().length, 0);

  panelSection(0).querySelectorAll("button").find((node) => node.textContent === "← К кадру").click();
  assert.equal($("#detail").dataset.view, "frame");
  assert.equal($("#frame-dialogue").hidden, false);
  assert.equal(mutatingRequests().length, 0);

  const dock = page.getResearchDock();
  const option = $("#research-commands-target").children.find((node) => String(node.value).startsWith("panel:display-1:0"));
  $("#research-commands-target").value = option.value;
  $("#research-commands-target").dispatchEvent({ type: "change" });
  $("#research-commands-draft").value = "смотрит влево";
  harness.script = [{
    path: `${API}/visual/frames/display-1/panels/0/revision`,
    body: (payload) => {
      const next = readyVisual();
      next.frames[0].panels[0].revision = {
        draftMode: payload.mode,
        draftInstruction: payload.instruction,
        candidates: [],
        summary: {
          basis: { kind: "current-panel" },
          changes: [{ property: "gaze", value: "screen-left" }],
          preserved: [{ property: "expression", value: "calm" }],
          notApplied: [],
          providerCall: true,
        },
      };
      return next;
    },
  }];
  $("#research-commands-send").click();
  await flush(16);
  assert.equal($("#detail").dataset.view, "panel");
  assert.equal($("#frame-dialogue").hidden, true);
  assert.equal(panelSection(0).querySelector("textarea").value, "смотрит влево");
  assert.equal(productRequests().some((entry) => /revision-candidate$|\/generate$/.test(entry.path)), false);
  assert.equal(dock.getCommandTarget()?.panelIndex, 0);
});

test("mode selection does not call the provider and the summary stays short", async () => {
  await reset();
  cards()[0].dispatchEvent({ type: "click" });
  openPanelFromInspector();
  resetRecorder();
  const variation = panelSection(0).querySelectorAll("input").find((input) => input.value === "new-variation");
  variation.checked = true;
  variation.dispatchEvent({ type: "change" });
  await flush(8);
  assert.equal(mutatingRequests().length, 0);
  const summary = textOf(panelSection(0).querySelector("[data-revision-summary]"));
  assert.match(summary, /Основа: предыдущее изображение не отправляется/);
  assert.match(summary, /Что изменится/);
  assert.equal(summary.includes("Не применяется: нет"), false);
  assert.equal(summary.includes("Что сохранится"), false);
  const refine = panelSection(0).querySelectorAll("input").find((input) => input.value === "refine");
  refine.checked = true;
  refine.dispatchEvent({ type: "change" });
  assert.equal(productRequests().some((entry) => /revision-candidate$|\/generate$|\/revision$/.test(entry.path)), false);
});

test("candidate comparison, navigation and accept sit together, and cancel confirmation starts hidden", async () => {
  await reset(visualWithCandidate());
  cards()[0].dispatchEvent({ type: "click" });
  openPanelFromInspector();
  const image = panelSection(0).querySelector("[data-panel-section='image']");
  const compare = image.querySelector(".revision-compare");
  assert.equal(compare.children[0].className.includes("revision-current"), true);
  assert.equal(compare.children[1].className.includes("revision-candidate"), true);
  assert.match(textOf(compare.children[0]), /Текущее изображение/);
  assert.match(textOf(compare.children[1]), /Кандидат 2/);
  assert.match(textOf(compare.children[1]), /Кандидат 2 из 2/);
  assert.match(textOf(compare.children[1]), /только после «Принять кандидат»/);
  assert.match(textOf(image), /Что сохранится · 2 свойств/);
  assert.match(textOf(image), /Не применяется:[\s\S]*стул/);
  assert.equal(textOf(image).includes("Не применяется: нет"), false);
  const order = image.children.map((node) => node.className);
  const acceptAt = order.findIndex((name) => name.includes("revision-review"));
  const compareAt = order.findIndex((name) => name.includes("revision-compare"));
  const framingAt = panelSection(0).children.findIndex((node) => node.dataset?.panelSection === "framing");
  const reviewAt = panelSection(0).children.findIndex((node) => node.className?.includes("revision-review") || node.querySelector?.(".revision-review"));
  assert.ok(compareAt >= 0 && acceptAt > compareAt);
  assert.ok(framingAt > panelSection(0).children.indexOf(image));
  assert.ok(buttonNamed(image, "Принять кандидат"));
  assert.equal($("#revision-confirm").hidden, true);
  assert.match(css, /\.revision-confirm\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /#research-dock\.research-dock--suspended\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /overflow-x:\s*hidden/);

  resetRecorder();
  buttonNamed(compare, "←").click();
  await flush(8);
  assert.equal(productRequests().some((entry) => /revision-candidate$|\/generate$/.test(entry.path)), false);
  assert.equal(productRequests().some((entry) => /revision-navigate$/.test(entry.path)), true);

  $("#detail").close();
  await reset(visualWithCandidate());
  cards()[0].dispatchEvent({ type: "click" });
  openPanelFromInspector();
  resetRecorder();
  buttonNamed(panelSection(0), "Отменить черновик").click();
  assert.equal($("#revision-confirm").hidden, false);
  assert.match(css, /\.revision-confirm\s*\{[^}]*place-items:\s*center/);
  assert.equal(mutatingRequests().length, 0);
  $("#revision-confirm-keep").click();
  assert.equal($("#revision-confirm").hidden, true);
  assert.equal(mutatingRequests().length, 0);
  assert.equal($("#detail").dataset.view, "panel");
  assert.equal(reviewAt >= 0, true);
});

test("focused Panel view suspends the dock and deterministic controls stay provider-free", async () => {
  await reset();
  cards()[0].dispatchEvent({ type: "click" });
  const dock = $("#research-dock");
  assert.equal(dock.classList.contains("research-dock--suspended"), false);
  openPanelFromInspector();
  assert.equal(dock.classList.contains("research-dock--suspended"), true);
  assert.equal(dock.classList.contains("research-dock--collapsed"), true);
  resetRecorder();
  const framing = panelSection(0).querySelector("[data-panel-section='framing']");
  const zoom = framing.querySelectorAll("input").find((node) => node.type === "range");
  zoom.value = "1.6";
  zoom.dispatchEvent({ type: "change" });
  framing.querySelectorAll("button").find((node) => node.dataset.placementAction === "mirror").click();
  await flush(8);
  assert.equal(productRequests().some((entry) => /revision-candidate$|\/generate$|\/revision$/.test(entry.path)), false);
  assert.equal(productRequests().some((entry) => /placement/.test(entry.path)), true);
  panelSection(0).querySelectorAll("button").find((node) => node.textContent === "← К кадру").click();
  assert.equal(dock.classList.contains("research-dock--suspended"), false);
  assert.equal(dock.classList.contains("research-dock--collapsed"), false);
});
