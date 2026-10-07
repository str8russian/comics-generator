import { bindDraftAutosave } from "/draft-autosave.mjs";
import { assessDialogue, compileOverflow, pageState } from "/overflow.mjs";
import * as FrameRenderer from "/frame-renderer.mjs";

const form = document.querySelector("#draft-form");
const draftField = document.querySelector("#draft");
const loading = document.querySelector("#loading");
const notice = document.querySelector("#notice");
const failureCodes = document.querySelector("#failure-codes");
const failureKind = document.querySelector("#failure-kind");
const grid = document.querySelector("#storyboard");
const openLast = document.querySelector("#open-last");
const detail = document.querySelector("#detail");
const detailHost = document.querySelector("#detail-frame");
const detailOutside = document.querySelector("#detail-outside");
const closeDetail = document.querySelector("#close-detail");

let readyFrames = [];

export const draftAutosave = bindDraftAutosave({
  textarea: draftField,
  conflict: document.querySelector("#draft-conflict"),
  reloadButton: document.querySelector("#reload-draft"),
  keepButton: document.querySelector("#keep-draft"),
});

function clearBoard() {
  readyFrames = [];
  grid.replaceChildren();
  openLast.hidden = true;
  document.body.dataset.state = "";
}

function showLoading() {
  clearBoard();
  notice.hidden = true;
  notice.textContent = "";
  loading.hidden = false;
  failureCodes.replaceChildren();
  failureCodes.hidden = true;
  failureKind.hidden = true;
  failureKind.textContent = "";
  delete document.body.dataset.kind;
}

function hideFailure() {
  failureCodes.replaceChildren();
  failureCodes.hidden = true;
  failureKind.hidden = true;
  failureKind.textContent = "";
  delete document.body.dataset.kind;
}

function showTerminal(view) {
  loading.hidden = true;
  clearBoard();
  document.body.dataset.state = view.state;
  notice.hidden = false;
  notice.textContent = view.state;
  failureCodes.replaceChildren();
  if (view.state === "blocked") {
    failureCodes.hidden = false;
    for (const code of view.codes || []) {
      const item = document.createElement("li");
      item.textContent = code;
      failureCodes.append(item);
    }
    failureKind.hidden = true;
    failureKind.textContent = "";
    delete document.body.dataset.kind;
    return;
  }
  failureCodes.hidden = true;
  failureKind.hidden = false;
  failureKind.textContent = view.kind || "";
  document.body.dataset.kind = view.kind || "";
}

function mountFrame(host, frame, scale) {
  host.replaceChildren();
  const stage = document.createElement("div");
  stage.className = "frame-stage";
  stage.style.width = `${FrameRenderer.FRAME_GEOMETRY.width * scale}px`;
  stage.style.height = `${FrameRenderer.FRAME_GEOMETRY.height * scale}px`;
  stage.style.setProperty("--frame-scale", String(scale));
  stage.append(FrameRenderer.render(frame, { mode: "structure" }));
  host.append(stage);
}

function showReady(frames) {
  loading.hidden = true;
  notice.hidden = true;
  hideFailure();
  readyFrames = frames;
  document.body.dataset.state = "ready";
  grid.replaceChildren();
  frames.forEach((frame, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "story-card";
    const host = document.createElement("div");
    host.className = "frame-host";
    mountFrame(host, frame, 0.2);
    card.append(host);
    if (frame.outsideFrameText) {
      const outside = document.createElement("p");
      outside.className = "outside-frame";
      outside.textContent = frame.outsideFrameText;
      card.append(outside);
    }
    card.addEventListener("click", () => openDetail(index));
    grid.append(card);
  });
  openLast.hidden = frames.length === 0;
}

function openDetail(index) {
  const frame = readyFrames[index];
  if (!frame) return;
  mountFrame(detailHost, frame, 0.5);
  detailOutside.textContent = frame.outsideFrameText || "";
  if (!detail.open) detail.showModal();
}

openLast.addEventListener("click", () => openDetail(readyFrames.length - 1));
closeDetail.addEventListener("click", () => detail.close());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showLoading();
  let response;
  try {
    response = await fetch("/api/storyboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: draftField.value }),
    });
  } catch {
    showTerminal(pageState({ http: { status: "failed", kind: "provider" } }));
    return;
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    showTerminal(pageState({ http: { status: "failed", kind: "invalid-request" } }));
    return;
  }
  if (!payload || payload.status !== "checked" || !Array.isArray(payload.frames)) {
    showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
    return;
  }
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  let fitted;
  try {
    fitted = compileOverflow(payload.frames, (text, options) => FrameRenderer.measureDialogue(document, {
      layout: options.layout,
      speakerPanel: options.speakerPanel,
      panels: options.panels,
      dialogue: text,
    }, options.fontSize));
  } catch {
    showTerminal(pageState({ measurementError: true, http: payload }));
    return;
  }
  const dialogue = fitted.ok ? assessDialogue(payload.sourceItems || [], fitted.frames) : null;
  const view = pageState({ http: payload, fitted, dialogue });
  if (view.state !== "ready") {
    showTerminal(view);
    return;
  }
  showReady(fitted.frames);
});
