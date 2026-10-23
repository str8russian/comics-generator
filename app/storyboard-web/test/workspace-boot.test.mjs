import assert from "node:assert/strict";
import test from "node:test";
import { API, flush, harness, jsonResponse, loadWorkspacePage, mutatingRequests, readyVisual } from "./workspace-harness.mjs";

const replaced = [];
globalThis.history = {
  replaceState(state, title, url) {
    replaced.push(url);
    globalThis.location.hash = String(url).slice(String(url).indexOf("#"));
  },
};

function bootWith(visual) {
  harness.respond = (entry) => {
    if (entry.path === API) {
      return jsonResponse(200, {
        title: "Проект",
        draft: { text: "Путин: Привет", revisionToken: "11111111-1111-4111-8111-111111111111" },
        material: { id: "material-1", text: "Путин: Привет", sourceItems: [], cast: { characters: [], aliases: [], speakers: [] } },
      });
    }
    if (entry.path === `${API}/visual` && entry.method === "GET") return jsonResponse(200, visual);
    return null;
  };
}

function currentStage() {
  return document.querySelector("#stage-nav").querySelectorAll("button")
    .find((node) => node.getAttribute("aria-current") === "step")?.dataset.stage ?? null;
}

test("without a hash the page opens the stage of the current workflow position", async () => {
  globalThis.location.hash = "";
  bootWith(readyVisual());
  await loadWorkspacePage({ instance: "default" });
  await flush(12);
  assert.equal(currentStage(), "visual");
  assert.equal(document.querySelector("#stage-view-visual").hidden, false);
  assert.equal(document.querySelector("#frames-area").hidden, false);
  assert.deepEqual(replaced, []);
  assert.deepEqual(mutatingRequests(), []);

  document.querySelector("#stage-nav").querySelectorAll("button").find((node) => node.dataset.stage === "characters")
    .dispatchEvent({ type: "click" });
  assert.equal(currentStage(), "characters");
  assert.equal(replaced.at(-1), "#stage=characters");
  assert.deepEqual(mutatingRequests(), []);
});

test("a stage in the hash survives reload even when the workflow position differs", async () => {
  globalThis.location.hash = "#stage=storyboard";
  bootWith(readyVisual({ complete: true, approved: true, readyForVideo: true }));
  await loadWorkspacePage({ instance: "hash" });
  await flush(12);
  assert.equal(currentStage(), "storyboard");
  assert.equal(document.querySelector("#stage-view-storyboard").hidden, false);
  assert.equal(document.querySelector("#stage-view-video").hidden, true);
});

test("an approved storyboard without a hash opens Video", async () => {
  globalThis.location.hash = "";
  bootWith(readyVisual({ complete: true, approved: true, readyForVideo: true }));
  await loadWorkspacePage({ instance: "video" });
  await flush(12);
  assert.equal(currentStage(), "video");
  assert.equal(document.querySelector("#render-panel").hidden, false);
});
