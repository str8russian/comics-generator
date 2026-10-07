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

const materialReview = document.querySelector("#material-review");
const materialSources = document.querySelector("#material-sources");
const materialCharacters = document.querySelector("#material-characters");
const materialAliases = document.querySelector("#material-aliases");
const materialSpeakers = document.querySelector("#material-speakers");
const materialFindings = document.querySelector("#material-findings");
const materialMismatch = document.querySelector("#material-mismatch");
const confirmMaterial = document.querySelector("#confirm-material");
const stageMaterial = document.querySelector("#stage-material");

let readyFrames = [];
let draftSync = { state: "boot", savedText: null };
let review = null;
let castChain = Promise.resolve();

export const draftAutosave = bindDraftAutosave({
  textarea: draftField,
  conflict: document.querySelector("#draft-conflict"),
  reloadButton: document.querySelector("#reload-draft"),
  keepButton: document.querySelector("#keep-draft"),
  onActivity(activity) {
    draftSync = activity;
    refreshConfirmation();
  },
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

async function presentCheckedStoryboard(payload) {
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
  showReady(fitted.frames, payload.readyEligible === true ? "ready" : "checked");
}

function showReady(frames, state = "ready") {
  loading.hidden = true;
  hideFailure();
  readyFrames = frames;
  document.body.dataset.state = state;
  notice.hidden = state === "ready";
  notice.textContent = state === "ready" ? "" : state;
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

function textsMatch(readingText) {
  return draftSync.state === "idle"
    && typeof draftSync.savedText === "string"
    && draftField.value === draftSync.savedText
    && draftField.value === readingText;
}

function refreshConfirmation() {
  if (!confirmMaterial || !materialMismatch) return;
  const readingMode = review?.mode === "reading";
  confirmMaterial.hidden = !readingMode;
  if (stageMaterial) stageMaterial.hidden = review?.mode !== "material";
  const matched = readingMode && textsMatch(review.text);
  confirmMaterial.disabled = !matched;
  materialMismatch.hidden = !readingMode || matched;
}

function hideReview() {
  review = null;
  if (materialReview) materialReview.hidden = true;
  refreshConfirmation();
}

function characterNames() {
  return [...materialCharacters.querySelectorAll("input")].map((input) => input.value);
}

function fillSelect(select, selected) {
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Не назначен";
  select.append(empty);
  for (const name of characterNames()) {
    if (!name) continue;
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  select.value = characterNames().includes(selected) ? selected : "";
}

function collectCast() {
  const characters = [];
  for (const input of materialCharacters.querySelectorAll("input")) {
    if (!input.value) return null;
    characters.push({ name: input.value });
  }
  const aliases = [];
  for (const select of materialAliases.querySelectorAll("select")) {
    if (!select.value) continue;
    aliases.push({ surface: select.dataset.surface, characterName: select.value });
  }
  const speakers = [];
  for (const select of materialSpeakers.querySelectorAll("select")) {
    if (!select.value) continue;
    speakers.push({ sourceItemId: select.dataset.sourceId, characterName: select.value });
  }
  return { characters, aliases, speakers };
}

function syncSelects() {
  for (const select of materialAliases.querySelectorAll("select")) fillSelect(select, select.value);
  for (const select of materialSpeakers.querySelectorAll("select")) fillSelect(select, select.value);
}

function scheduleCastSave() {
  castChain = castChain.then(() => saveCast()).catch(() => {});
}

async function saveCast() {
  if (!review) return { ok: false };
  const cast = collectCast();
  if (!cast) return { ok: false };
  const path = review.mode === "reading"
    ? `/api/readings/${review.id}/cast`
    : "/api/material-states";
  const method = review.mode === "reading" ? "PUT" : "POST";
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cast),
    });
  } catch {
    return { ok: false };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 409) {
    refreshConfirmation();
    return { ok: false, stale: true };
  }
  if (!response.ok) return { ok: false };
  review.cast = cast;
  if (review.mode === "material" && payload?.materialStateId) review.id = payload.materialStateId;
  renderSources();
  renderFindings();
  return { ok: true };
}

function renderSources() {
  materialSources.replaceChildren();
  for (const item of review.sourceItems || []) {
    const row = document.createElement("li");
    row.dataset.sourceId = item.id;
    const owner = (review.cast?.speakers || []).find((speaker) => speaker.sourceItemId === item.id);
    row.textContent = owner ? `${item.sourceQuote} — ${owner.characterName}` : item.sourceQuote;
    materialSources.append(row);
  }
}

function renderFindings() {
  const blocking = (review.findings || []).filter((finding) => finding.code === "unresolved-speaker");
  if (review.cast) {
    const assigned = new Set((review.cast.speakers || []).map((speaker) => speaker.sourceItemId));
    const fromCast = (review.sourceItems || [])
      .filter((item) => item.kind === "utterance" && !assigned.has(item.id))
      .map((item) => ({ code: "unresolved-speaker", sourceItemId: item.id, sourceQuote: item.sourceQuote }));
    materialFindings.replaceChildren();
    materialFindings.hidden = fromCast.length === 0;
    for (const finding of fromCast) {
      const row = document.createElement("li");
      row.dataset.code = finding.code;
      row.dataset.sourceId = finding.sourceItemId;
      row.textContent = `Нет говорящего: ${finding.sourceQuote}`;
      materialFindings.append(row);
    }
    return;
  }
  materialFindings.replaceChildren();
  materialFindings.hidden = blocking.length === 0;
  for (const finding of blocking) {
    const row = document.createElement("li");
    row.dataset.code = finding.code;
    row.textContent = `Нет говорящего: ${finding.sourceQuote}`;
    materialFindings.append(row);
  }
}

function renderReview() {
  materialReview.hidden = false;
  renderSources();
  materialCharacters.replaceChildren();
  for (const character of review.cast?.characters || []) {
    const row = document.createElement("li");
    row.className = "material-row";
    const input = document.createElement("input");
    input.value = character.name;
    input.addEventListener("input", () => syncSelects());
    input.addEventListener("blur", () => scheduleCastSave());
    row.append(input);
    materialCharacters.append(row);
  }
  const aliasSurfaces = [];
  const seen = new Set();
  for (const form of review.surfaceForms || []) {
    if (seen.has(form.quote)) continue;
    seen.add(form.quote);
    aliasSurfaces.push(form.quote);
  }
  for (const alias of review.cast?.aliases || []) {
    if (seen.has(alias.surface)) continue;
    seen.add(alias.surface);
    aliasSurfaces.push(alias.surface);
  }
  materialAliases.replaceChildren();
  for (const surface of aliasSurfaces) {
    const row = document.createElement("li");
    row.className = "material-row";
    const label = document.createElement("span");
    label.textContent = surface;
    const select = document.createElement("select");
    select.dataset.surface = surface;
    const current = (review.cast?.aliases || []).find((alias) => alias.surface === surface);
    fillSelect(select, current?.characterName || "");
    select.addEventListener("change", () => scheduleCastSave());
    row.append(label, select);
    materialAliases.append(row);
  }
  materialSpeakers.replaceChildren();
  for (const item of (review.sourceItems || []).filter((entry) => entry.kind === "utterance")) {
    const row = document.createElement("li");
    row.className = "material-row";
    const label = document.createElement("span");
    label.textContent = item.sourceQuote;
    const select = document.createElement("select");
    select.dataset.sourceId = item.id;
    const current = (review.cast?.speakers || []).find((speaker) => speaker.sourceItemId === item.id);
    fillSelect(select, current?.characterName || "");
    select.addEventListener("change", () => scheduleCastSave());
    row.append(label, select);
    materialSpeakers.append(row);
  }
  renderFindings();
  refreshConfirmation();
}

function showMaterial(documentState, mode) {
  review = {
    mode,
    id: documentState.id,
    text: documentState.text,
    sourceItems: documentState.sourceItems || [],
    characters: documentState.characters || [],
    surfaceForms: documentState.surfaceForms || [],
    cast: documentState.cast || { characters: [], aliases: [], speakers: [] },
    findings: documentState.findings || [],
  };
  renderReview();
}

function restoreReview(project) {
  if (project?.reading?.status === "ready") {
    showMaterial(project.reading, "reading");
    return;
  }
  if (project?.material) {
    showMaterial(project.material, "material");
    return;
  }
  hideReview();
}

draftField.addEventListener("input", () => refreshConfirmation());

confirmMaterial?.addEventListener("click", async () => {
  if (!review || review.mode !== "reading" || confirmMaterial.disabled) return;
  const synced = await draftAutosave.flush();
  refreshConfirmation();
  if (!synced || !textsMatch(review.text)) return;
  const saved = await saveCast();
  if (!saved.ok) return;
  let response;
  try {
    response = await fetch("/api/confirmations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readingId: review.id }),
    });
  } catch {
    showTerminal(pageState({ http: { status: "failed", kind: "provider" } }));
    return;
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 409) {
    refreshConfirmation();
    return;
  }
  if (!response.ok || !payload?.materialStateId) {
    showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
    return;
  }
  review.mode = "material";
  review.id = payload.materialStateId;
  renderFindings();
  refreshConfirmation();
});

function restoreStoryboard(project) {
  const board = (project?.storyboards || []).find((item) => item?.materialStateId === project?.activeMaterialStateId);
  if (!board) return null;
  if (board.status === "blocked" || board.status === "failed") {
    showTerminal(pageState({ http: board }));
    return null;
  }
  if (board.status === "checked" && Array.isArray(board.frames) && board.frames.length > 0) {
    return presentCheckedStoryboard(board);
  }
  return null;
}

stageMaterial?.addEventListener("click", async () => {
  if (!review || review.mode !== "material") return;
  showLoading();
  loading.textContent = "Сборка раскадровки…";
  let response;
  try {
    response = await fetch("/api/storyboard-results", { method: "POST" });
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
  if (!response.ok || !payload || payload.status === "failed") {
    showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
    return;
  }
  if (payload.status === "blocked") {
    showTerminal(pageState({ http: payload }));
    return;
  }
  if (payload.status !== "checked") {
    showTerminal(pageState({ http: { status: "failed", kind: "invalid-request" } }));
    return;
  }
  await presentCheckedStoryboard(payload);
});

draftAutosave.ready.then(async () => {
  try {
    const response = await fetch("/api/project");
    if (!response.ok) return;
    const project = await response.json();
    restoreReview(project);
    await restoreStoryboard(project);
  } catch {
    hideReview();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const synced = await draftAutosave.flush();
  if (!synced) return;
  showLoading();
  loading.textContent = "Разбор черновика…";
  let response;
  try {
    response = await fetch("/api/readings", { method: "POST" });
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
  loading.hidden = true;
  if (response.status === 409 || payload?.kind === "stale-reading") {
    materialMismatch.hidden = false;
    return;
  }
  if (!payload || payload.status !== "ready") {
    hideReview();
    showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
    return;
  }
  hideFailure();
  notice.hidden = true;
  showMaterial(payload, "reading");
});
