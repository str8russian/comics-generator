import { assessDialogue, compileOverflow, pageState } from "/overflow.mjs";
import * as FrameRenderer from "/frame-renderer.mjs";

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

function showTerminal(view) {
  loading.hidden = true;
  readyFrames = [];
  grid.replaceChildren();
  openLast.hidden = true;
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
    return;
  }
  failureKind.hidden = false;
  failureKind.textContent = view.kind || "";
}

openLast.addEventListener("click", () => openDetail(readyFrames.length - 1));
closeDetail.addEventListener("click", () => detail.close());

const response = await fetch("/preview.json");
const payload = await response.json();
if (!payload || payload.status !== "checked" || !Array.isArray(payload.frames)) {
  showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
} else {
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
    fitted = null;
  }
  if (fitted) {
    const dialogue = fitted.ok ? assessDialogue(payload.sourceItems || [], fitted.frames) : null;
    const view = pageState({ http: payload, fitted, dialogue });
    if (view.state === "ready") showReady(fitted.frames);
    else showTerminal(view);
  }
}
