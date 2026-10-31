import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import {
  API,
  buttonNamed,
  flush,
  harness,
  jsonResponse,
  loadWorkspacePage,
  readyVisual,
  researchStarts,
  resetRecorder,
  textOf,
} from "./workspace-harness.mjs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const page = await loadWorkspacePage({ instance: "story-async" });
const $ = (selector) => document.querySelector(selector);
const WAITING = "Это может занять некоторое время.";
const READING_SUCCESS = "Черновик разобран. Проверьте разбор и подтвердите.";
const STAGING_SUCCESS = "Раскадровка собрана.";

function posts(suffix, method = "POST") {
  return harness.requests.filter((entry) => entry.method === method && entry.path.endsWith(suffix));
}

function readingPayload(text) {
  return {
    status: "ready",
    id: "reading-1",
    text,
    sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Привет" }],
    cast: {
      characters: [{ name: "Путин", included: true }],
      aliases: [],
      speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
    },
    surfaceForms: [],
    findings: [],
  };
}

function checkedBoard() {
  return {
    status: "checked",
    readyEligible: true,
    sourceItems: [],
    frames: [{
      id: "f1",
      frameKind: "text",
      textCard: "Пауза",
      layout: "single",
      origin: "derived",
      dialogue: "",
      panels: [],
    }],
  };
}

function hold(predicate, body, status = 200) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  harness.respond = async (entry) => {
    if (!predicate(entry)) return null;
    await gate;
    return jsonResponse(status, typeof body === "function" ? body(entry) : body);
  };
  return release;
}

function assertNoFabricatedProgress(text) {
  assert.equal(/%/.test(text), false, text);
  assert.equal(/процент|провайдер|сервер|фаза|этап/i.test(text), false, text);
}

function assertPending(label) {
  const buttonId = label.startsWith("Разбираю") ? "read-draft" : "stage-material";
  const button = $(`#${buttonId}`);
  const story = $("#stage-view-story");
  assert.equal(button.textContent, label);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal($("#loading").hidden, false);
  assert.equal($("#loading").getAttribute("role"), "status");
  assert.equal($("#loading").getAttribute("aria-live"), "polite");
  const pendingText = textOf($("#loading"));
  assert.match(pendingText, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(pendingText, new RegExp(WAITING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok($("#loading").querySelector(".story-operation-spinner"), "indeterminate spinner");
  assertNoFabricatedProgress(pendingText);
  assert.equal(story.getAttribute("aria-busy"), "true");
  for (const id of ["draft", "reload-draft", "keep-draft", "read-draft", "confirm-material", "stage-material"]) {
    assert.equal($(`#${id}`).disabled, true, id);
  }
  assert.equal(document.body.dataset.busy, undefined);
}

function assertIdle() {
  assert.equal($("#loading").hidden, true);
  assert.equal($("#stage-view-story").getAttribute("aria-busy"), null);
  assert.equal($("#read-draft").textContent, "Разобрать черновик");
  assert.equal($("#read-draft").disabled, false);
  assert.equal($("#draft").disabled, false);
}

async function settle() {
  await flush(8);
}

describe("truthful Story long-running actions", { concurrency: false }, () => {
  test("reading enters pending during a deferred autosave and rejects a second activation", async () => {
    resetRecorder();
    const draft = "Путин: Привет";
    const release = hold(
      (entry) => entry.method === "PUT" && entry.path === `${API}/draft`,
      (entry) => ({ revisionToken: "33333333-3333-4333-8333-333333333333", text: entry.body.text }),
    );
    try {
    $("#draft").value = draft;
    $("#draft-form").dispatchEvent({ type: "submit", preventDefault() {} });
    assertPending("Разбираю черновик…");
    assert.equal(posts("/readings").length, 0);
    assert.equal(researchStarts("reading").length, 0);
    $("#draft-form").dispatchEvent({ type: "submit", preventDefault() {} });
    $("#read-draft").dispatchEvent({ type: "click" });
    $("#read-draft").dispatchEvent({ type: "keydown", key: "Enter" });
    $("#confirm-material").dispatchEvent({ type: "click" });
    $("#stage-material").dispatchEvent({ type: "click" });
    assert.equal($("#draft").value, draft);
    assert.equal(posts("/readings").length, 0);
    assert.equal(posts("/draft", "PUT").length, 1);
    release();
    harness.respond = async (entry) => {
      if (entry.method === "POST" && entry.path === `${API}/readings`) return jsonResponse(200, readingPayload(draft));
      return null;
    };
    await settle();
    assert.equal(posts("/readings").length, 1);
    assert.equal(posts("/readings")[0].method, "POST");
    assert.equal(posts("/readings")[0].body, null);
    assert.equal(researchStarts("reading").length, 1);
    assert.equal(researchStarts("reading")[0].submittedText, draft);
    assert.equal(researchStarts("reading")[0].commandTarget.kind, "none");
    assert.equal(researchStarts("reading")[0].surface, "product_control");
    const terminals = harness.researchPosts.filter((event) => (
      event.eventKind === "action_terminal" && event.correlationId === researchStarts("reading")[0].correlationId
    ));
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].outcome, "success");
    assertIdle();
    assert.equal($("#notice").hidden, false);
    assert.equal($("#notice").textContent, READING_SUCCESS);
    assert.equal($("#material-review").hidden, false);
    assert.equal($("#confirm-material").hidden, false);
    assert.equal($("#confirm-material").disabled, false);
    assert.equal($("#confirm-material").textContent, "Подтвердить");
    assert.equal($("#stage-header-story").querySelector(".stage-next"), null);
    assertNoFabricatedProgress($("#notice").textContent);
    } finally {
      release();
    }
  });

  test("reading failure keeps the draft, explains the retry, and one retry sends one new request", async () => {
    resetRecorder();
    const draft = "Путин: черновик остаётся";
    $("#draft").value = draft;
    harness.respond = async (entry) => {
      if (entry.method === "PUT" && entry.path === `${API}/draft`) {
        return jsonResponse(200, { revisionToken: "44444444-4444-4444-8444-444444444444", text: entry.body.text });
      }
      if (entry.method === "POST" && entry.path === `${API}/readings`) {
        return jsonResponse(500, { status: "failed", kind: "provider" });
      }
      return null;
    };
    $("#draft-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await settle();
    assertIdle();
    assert.equal($("#draft").value, draft);
    assert.match($("#notice").textContent, /не разобран/i);
    assert.match($("#notice").textContent, /попробовать/i);
    assert.equal($("#failure-kind").hidden, false);
    assert.equal($("#failure-kind").textContent, "provider");
    assert.equal($("#notice").textContent === "failed", false);
    assert.equal(posts("/readings").length, 1);
    assert.equal(researchStarts("reading").length, 1);
    $("#draft-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await settle();
    assert.equal(posts("/readings").length, 2);
    assert.equal(researchStarts("reading").length, 2);
    assert.equal($("#draft").value, draft);
    assertIdle();
  });

  test("staging failure and blocked results keep the confirmed review and one retry", async () => {
    resetRecorder();
    const draft = "Путин: Привет";
    $("#draft").value = draft;
    const material = {
      id: "material-1",
      text: draft,
      sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Привет" }],
      cast: { characters: [{ name: "Путин", included: true }], aliases: [], speakers: [] },
      surfaceForms: [],
      findings: [],
    };
    page.setResearchReviewState(material, "material");
    harness.respond = async (entry) => {
      if (entry.method === "POST" && entry.path === `${API}/storyboard-results`) {
        return jsonResponse(200, { status: "failed", kind: "provider" });
      }
      return null;
    };
    $("#stage-material").dispatchEvent({ type: "click" });
    await settle();
    assert.equal($("#loading").hidden, true);
    assert.equal($("#stage-view-story").getAttribute("aria-busy"), null);
    assert.equal($("#material-review").hidden, false);
    assert.equal($("#stage-material").hidden, false);
    assert.equal($("#stage-material").disabled, false);
    assert.equal($("#stage-material").textContent, "Собрать раскадровку");
    assert.match($("#notice").textContent, /собрать не удалось/i);
    assert.match($("#notice").textContent, /попробовать/i);
    assert.equal($("#failure-kind").textContent, "provider");
    assert.equal($("#notice").textContent === "failed", false);
    assert.equal($("#stage-header-story").querySelector(".stage-next"), null);

    harness.respond = async (entry) => {
      if (entry.method === "POST" && entry.path === `${API}/storyboard-results`) {
        return jsonResponse(200, { status: "blocked", failures: [{ code: "unresolved-speaker" }] });
      }
      return null;
    };
    $("#stage-material").dispatchEvent({ type: "click" });
    await settle();
    assert.equal(posts("/storyboard-results").length, 2);
    assert.equal(researchStarts("stage_storyboard").length, 2);
    assert.equal($("#material-review").hidden, false);
    assert.equal($("#stage-material").hidden, false);
    assert.equal($("#stage-material").textContent, "Собрать раскадровку");
    assert.match($("#notice").textContent, /собрать нельзя/i);
    assert.match(textOf($("#failure-codes")), /unresolved-speaker/);
    assert.equal($("#notice").textContent === "blocked", false);
    assert.equal($("#loading").hidden, true);
  });

  test("a cast save queued before staging still finishes during the Story lock", async () => {
    resetRecorder();
    const draft = "Путин: Привет";
    $("#draft").value = draft;
    page.setResearchReviewState({
      id: "material-1",
      text: draft,
      sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Привет" }],
      cast: {
        characters: [{ name: "Путин", included: true }, { name: "Дуров", included: true }],
        aliases: [{ surface: "Владимир", characterName: "Путин" }],
        speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
      },
      surfaceForms: [{ quote: "Владимир" }],
      findings: [],
    }, "material");
    let materialSeen = 0;
    let releaseMaterial;
    let releaseStage;
    const materialGate = new Promise((resolve) => {
      releaseMaterial = resolve;
    });
    const stageGate = new Promise((resolve) => {
      releaseStage = resolve;
    });
    harness.respond = async (entry) => {
      if (entry.method === "POST" && entry.path === `${API}/material-states`) {
        materialSeen += 1;
        if (materialSeen === 1) {
          await materialGate;
          return jsonResponse(200, { materialStateId: "material-2" });
        }
        return jsonResponse(200, { materialStateId: "material-3" });
      }
      if (entry.method === "POST" && entry.path === `${API}/storyboard-results`) {
        await stageGate;
        return jsonResponse(200, checkedBoard());
      }
      return null;
    };
    try {
      const alias = $("#material-aliases").querySelector("select");
      const speaker = $("#material-speakers").querySelector("select");
      alias.value = "Дуров";
      alias.dispatchEvent({ type: "change" });
      await flush(4);
      assert.equal(posts("/material-states").length, 1);
      assert.equal(researchStarts("cast_edit").length, 1);
      speaker.value = "Дуров";
      speaker.dispatchEvent({ type: "change" });
      assert.equal(posts("/material-states").length, 1, "second edit is queued, not sent");
      $("#stage-material").dispatchEvent({ type: "click" });
      assertPending("Собираю раскадровку…");
      await flush(4);
      assert.equal(posts("/storyboard-results").length, 1);
      assert.equal(researchStarts("stage_storyboard").length, 1);
      $("#stage-material").dispatchEvent({ type: "click" });
      $("#stage-material").click();
      assert.equal(posts("/storyboard-results").length, 1);
      assert.equal(researchStarts("stage_storyboard").length, 1);
      assert.equal(posts("/material-states").length, 1);
      releaseMaterial();
      await flush(6);
      assertPending("Собираю раскадровку…");
      assert.equal(posts("/material-states").length, 2);
      assert.equal(posts("/storyboard-results").length, 1);
      const speakerStarts = researchStarts("cast_edit").filter((event) => event.editTarget?.editKind === "speaker_assignment");
      assert.equal(speakerStarts.length, 1);
      const speakerTerminals = harness.researchPosts.filter((event) => (
        event.eventKind === "action_terminal" && event.correlationId === speakerStarts[0].correlationId
      ));
      assert.equal(speakerTerminals.length, 1);
      assert.equal(speakerTerminals[0].outcome, "success");
      const nextSpeaker = $("#material-speakers").querySelector("select");
      nextSpeaker.value = "Путин";
      nextSpeaker.dispatchEvent({ type: "change" });
      await flush(4);
      assert.equal(posts("/material-states").length, 2);
      assert.equal(researchStarts("cast_edit").length, 2);
      releaseStage();
      await settle();
      assert.equal($("#loading").hidden, true);
      assert.equal($("#stage-view-story").getAttribute("aria-busy"), null);
      assert.equal($("#notice").textContent, STAGING_SUCCESS);
      assert.equal($("#material-review").hidden, false);
      assert.equal(posts("/storyboard-results").length, 1);
      assert.equal(posts("/material-states").length, 2);
    } finally {
      releaseMaterial();
      releaseStage();
      await flush(8);
      page.setResearchVisualState(null);
    }
  });

  test("staging enters pending on a deferred storyboard request and rejects a second activation", async () => {
    resetRecorder();
    const draft = "Путин: Привет";
    $("#draft").value = draft;
    page.setResearchReviewState({
      id: "material-1",
      text: draft,
      sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Привет" }],
      cast: {
        characters: [{ name: "Путин", included: true }],
        aliases: [],
        speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
      },
      surfaceForms: [],
      findings: [],
    }, "material");
    const castButton = $("#material-characters").querySelector("button");
    assert.equal($("#stage-material").hidden, false);
    assert.equal($("#stage-material").textContent, "Собрать раскадровку");
    assert.equal($("#stage-header-story").querySelector(".stage-next"), null);
    const release = hold(
      (entry) => entry.method === "POST" && entry.path === `${API}/storyboard-results`,
      checkedBoard(),
    );
    try {
    $("#stage-material").dispatchEvent({ type: "click" });
    assertPending("Собираю раскадровку…");
    await flush(2);
    assertPending("Собираю раскадровку…");
    assert.equal(posts("/storyboard-results").length, 1);
    assert.equal(posts("/storyboard-results")[0].body, null);
    assert.equal(researchStarts("stage_storyboard").length, 1);
    $("#stage-material").click();
    $("#stage-material").dispatchEvent({ type: "click" });
    $("#stage-material").dispatchEvent({ type: "keydown", key: "Enter" });
    $("#draft-form").dispatchEvent({ type: "submit", preventDefault() {} });
    $("#confirm-material").dispatchEvent({ type: "click" });
    if (castButton) castButton.dispatchEvent({ type: "click" });
    assert.equal(posts("/storyboard-results").length, 1);
    assert.equal(researchStarts("stage_storyboard").length, 1);
    assert.equal(posts("/readings").length, 0);
    assert.equal(posts("/confirmations").length, 0);
    assert.equal(harness.requests.some((entry) => entry.path.endsWith("/cast")), false);
    const storyboard = $("#stage-nav").querySelectorAll("button").find((node) => node.dataset.stage === "storyboard");
    storyboard.dispatchEvent({ type: "click" });
    assert.equal($("#loading").hidden, false);
    assert.match(textOf($("#loading")), new RegExp(WAITING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    release();
    await settle();
    assert.equal($("#loading").hidden, true);
    assert.equal($("#stage-view-story").getAttribute("aria-busy"), null);
    assert.equal($("#notice").textContent, STAGING_SUCCESS);
    assert.equal($("#material-review").hidden, false);
    assert.equal($("#stage-material").hidden, true);
    assert.equal(buttonNamed($("#stage-header-story"), "Собрать раскадровку"), null);
    const next = $("#stage-header-story").querySelector(".stage-next");
    assert.equal(next.textContent, "Перейти к раскадровке");
    next.dispatchEvent({ type: "click" });
    assert.equal($("#stage-view-storyboard").hidden, false);
    assert.equal(posts("/storyboard-results").length, 1);
    assert.equal(researchStarts("stage_storyboard").length, 1);
    const start = researchStarts("stage_storyboard")[0];
    assert.equal(start.submittedText, null);
    assert.equal(start.commandTarget.kind, "storyboard");
    const terminals = harness.researchPosts.filter((event) => (
      event.eventKind === "action_terminal" && event.correlationId === start.correlationId
    ));
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].outcome, "success");
    assertNoFabricatedProgress(`${textOf($("#notice"))} ${$("#stage-material").textContent}`);
    } finally {
      release();
    }
  });

  test("pending Story review can add one trimmed silent character and refuses a blank or duplicate without a write", async () => {
    resetRecorder();
    const draft = "Путин: Привет";
    $("#draft").value = draft;
    page.setResearchReviewState({
      id: "reading-1",
      text: draft,
      sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Привет" }],
      cast: {
        characters: [{ name: "Путин", extractedName: "Путин", included: true }],
        aliases: [],
        speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
      },
      surfaceForms: [],
      findings: [],
    }, "reading");
    const add = $("#add-character");
    assert.equal(add?.textContent, "Добавить персонажа");
    assert.equal(add.hidden, false);
    assert.equal($("#add-character-form").hidden, true);
    assert.equal($("#material-characters").querySelectorAll("input").length, 1);
    const before = harness.requests.length;
    add.dispatchEvent({ type: "click" });
    assert.equal($("#add-character-form").hidden, false);
    $("#add-character-cancel").dispatchEvent({ type: "click" });
    assert.equal($("#add-character-form").hidden, true);
    assert.equal(harness.requests.length, before);
    assert.equal($("#material-characters").querySelectorAll("input").length, 1);

    add.dispatchEvent({ type: "click" });
    $("#add-character-name").value = "   ";
    $("#add-character-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await flush(4);
    assert.equal(harness.requests.length, before);
    assert.match($("#material-cast-status").textContent, /имя/i);
    assert.equal($("#material-characters").textContent.includes("Наблюдатель"), false);

    $("#add-character-name").value = "  Путин  ";
    $("#add-character-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await flush(4);
    assert.equal(harness.requests.length, before);
    assert.match($("#material-cast-status").textContent, /уже есть/i);

    harness.respond = async (entry) => {
      if (entry.method === "PUT" && entry.path.endsWith("/readings/reading-1/cast")) {
        return jsonResponse(200, { ok: true });
      }
      return null;
    };
    $("#add-character-name").value = "  Наблюдатель  ";
    $("#add-character-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await flush(6);
    const writes = harness.requests.filter((entry) => entry.method === "PUT" && entry.path.endsWith("/cast"));
    assert.equal(writes.length, 1);
    const names = writes[0].body.characters.map((character) => character.name);
    assert.deepEqual(names, ["Путин", "Наблюдатель"]);
    const added = writes[0].body.characters.find((character) => character.name === "Наблюдатель");
    assert.equal(added.included, true);
    assert.equal(added.extractedName, "Наблюдатель");
    assert.equal(writes[0].body.speakers.some((speaker) => speaker.characterName === "Наблюдатель"), false);
    assert.equal(writes[0].body.aliases.some((alias) => alias.characterName === "Наблюдатель"), false);
    assert.equal(harness.requests.some((entry) => entry.path.endsWith("/storyboard-results")), false);
    assert.equal(harness.requests.some((entry) => /\/generate$/.test(entry.path)), false);
    const shown = [...$("#material-characters").querySelectorAll("input")].map((input) => input.value);
    assert.deepEqual(shown, ["Путин", "Наблюдатель"]);
    assert.equal($("#character-cards").textContent.includes("Наблюдатель"), false);
    const starts = researchStarts("cast_edit").filter((event) => event.editTarget?.editKind === "character_add");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].submittedText, "Наблюдатель");
    assert.equal(JSON.stringify(starts[0]).includes("sourceQuote"), false);
    harness.respond = null;
  });

  test("a confirmed add refreshes Characters from the active visual cast and drops Video readiness", async () => {
    resetRecorder();
    const draft = "Путин: Привет";
    $("#draft").value = draft;
    page.setResearchReviewState({
      id: "material-1",
      text: draft,
      sourceItems: [{ id: "utterance-1", kind: "utterance", sourceQuote: "Привет" }],
      cast: {
        characters: [{ name: "Путин", extractedName: "Путин", included: true }],
        aliases: [],
        speakers: [{ sourceItemId: "utterance-1", characterName: "Путин" }],
      },
      surfaceForms: [],
      findings: [],
    }, "material");
    page.applyVisual(readyVisual({
      characters: [
        { name: "Путин", approvedAnchorId: "anchor-p", approvedAssetId: "anchor-asset-p", approvedAssetUrl: "/anchor-p.png", anchorProvenance: "uploaded_as_ready_anchor" },
      ],
      allAnchorsApproved: true,
      complete: true,
      approved: true,
      readyForVideo: true,
    }));
    assert.equal($("#ready-for-video").hidden, false);
    const nextVisual = readyVisual({
      characters: [
        { name: "Путин", approvedAnchorId: "anchor-p", approvedAssetId: "anchor-asset-p", approvedAssetUrl: "/anchor-p.png", anchorProvenance: "uploaded_as_ready_anchor" },
        { name: "Наблюдатель", approvedAnchorId: null, approvedAssetUrl: null },
      ],
      allAnchorsApproved: false,
      complete: true,
      approved: false,
      readyForVideo: false,
    });
    harness.respond = async (entry) => {
      if (entry.method === "POST" && entry.path.endsWith("/material-states")) {
        return jsonResponse(200, { materialStateId: "material-2", visualChanged: true });
      }
      if (entry.method === "GET" && entry.path.endsWith("/visual")) return jsonResponse(200, nextVisual);
      return null;
    };
    $("#add-character").dispatchEvent({ type: "click" });
    $("#add-character-name").value = "Наблюдатель";
    $("#add-character-form").dispatchEvent({ type: "submit", preventDefault() {} });
    await flush(8);
    const names = [...$("#character-cards").querySelectorAll("h3")].map((node) => node.textContent);
    assert.deepEqual(names, ["Путин", "Наблюдатель"]);
    const cards = [...$("#character-cards").querySelectorAll(".character-card")];
    assert.equal(textOf(cards[0]).includes("Образ утверждён"), true);
    assert.equal(textOf(cards[1]).includes("Нужен образ"), true);
    assert.equal($("#ready-for-video").hidden, true);
    assert.equal(harness.requests.some((entry) => entry.path.endsWith("/storyboard-results")), false);
    assert.equal(harness.requests.some((entry) => /\/generate$/.test(entry.path)), false);
    const frameIds = [...$("#storyboard").querySelectorAll(".story-card")].map((node) => node.dataset.structureFrameId);
    assert.deepEqual(frameIds, nextVisual.frames.map((frame) => frame.structureFrameId || frame.id));
    harness.respond = null;
  });

  test("other stages still render their own next actions", () => {
    page.applyVisual(readyVisual());
    assert.equal($("#stage-header-story").querySelector(".stage-next").textContent, "Перейти к раскадровке");
    assert.equal($("#stage-header-characters").querySelector(".stage-next").textContent, "Перейти к визуалу");
    assert.equal($("#stage-header-visual").querySelector(".stage-next").textContent, "Открыть кадр 2");
    assert.equal($("#stage-header-video").querySelector(".stage-next").textContent, "Собрать видео");
  });
});

test("Story pending markup is outside the stage views and is not a static duplicate of the old loading line", () => {
  assert.match(html, new RegExp(WAITING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const alerts = html.slice(html.indexOf('id="workspace-alerts"'), html.indexOf('id="stage-view-story"'));
  assert.match(alerts, /id="loading"/);
  assert.match(alerts, /story-operation-spinner/);
  assert.match(alerts, /role="status"/);
});
