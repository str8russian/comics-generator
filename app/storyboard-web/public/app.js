import { bindDraftAutosave } from "/draft-autosave.mjs";
import { assessDialogue, compileOverflow, pageState } from "/overflow.mjs";
import * as FrameRenderer from "/frame-renderer.mjs";
import {
  bindResearchDock,
  createEmptyCommandTarget,
  createEmptyContext,
} from "/research-dock.mjs";
import { presentVisualFrame } from "/visual-anchors.mjs";

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
const detailPanelControls = document.querySelector("#detail-panel-controls");
const nextFrame = document.querySelector("#next-frame");
const structureTools = document.querySelector("#structure-tools");
const structureEditForm = document.querySelector("#structure-edit-form");
const structureInstruction = document.querySelector("#structure-instruction");
const structureResult = document.querySelector("#structure-result");
const undoStructure = document.querySelector("#undo-structure");
const charactersWorkspace = document.querySelector("#characters-workspace");
const characterCards = document.querySelector("#character-cards");
const visualHeading = document.querySelector("#visual-heading");
const visualProgress = document.querySelector("#visual-progress");
const visualApproval = document.querySelector("#visual-approval");
const approveVisual = document.querySelector("#approve-visual");
const approvalCopy = document.querySelector("#approval-copy");
const readyForVideo = document.querySelector("#ready-for-video");

const materialReview = document.querySelector("#material-review");
const materialSources = document.querySelector("#material-sources");
const materialCharacters = document.querySelector("#material-characters");
const materialAliases = document.querySelector("#material-aliases");
const materialSpeakers = document.querySelector("#material-speakers");
const materialFindings = document.querySelector("#material-findings");
const materialMismatch = document.querySelector("#material-mismatch");
const confirmMaterial = document.querySelector("#confirm-material");
const stageMaterial = document.querySelector("#stage-material");
const researchDockHost = document.querySelector("#research-dock-host");
const researchDockRoot = document.querySelector("#research-dock");

let readyFrames = [];
let draftSync = { state: "boot", savedText: null };
let review = null;
let castChain = Promise.resolve();
let visual = null;
let detailIndex = -1;
let busy = false;

export function setResearchDetailState(frames, index = -1) {
  readyFrames = Array.isArray(frames) ? frames.slice() : [];
  detailIndex = Number.isInteger(index) ? index : -1;
}

export function captureResearchContext() {
  let workflowPhase = null;
  if (visual?.readyForVideo || visual?.approved) workflowPhase = "approved";
  else if (visual?.allAnchorsApproved) workflowPhase = "visual";
  else if (visual?.characters?.length) workflowPhase = "characters";
  else if (readyFrames.length) workflowPhase = "structure";
  else if (review?.mode === "material") workflowPhase = "material";
  else if (review?.mode === "reading") workflowPhase = "reading";
  else if (typeof draftField?.value === "string" && draftField.value.length > 0) workflowPhase = "draft";

  const frame = detailIndex >= 0 ? readyFrames[detailIndex] : null;
  return createEmptyContext({
    workflowPhase,
    storyboardVersionId: typeof visual?.storyboardVersionId === "string" ? visual.storyboardVersionId : null,
    displayFrameNumber: detailIndex >= 0 ? detailIndex + 1 : null,
    displayFrameId: typeof frame?.id === "string" ? frame.id : null,
    structureFrameId: typeof frame?.structureFrameId === "string" ? frame.structureFrameId : null,
    structureSegmentIndex: Number.isInteger(frame?.structureSegmentIndex) ? frame.structureSegmentIndex : null,
    panelIndex: null,
    panelSubject: null,
    imageAssetId: null,
    generationId: null,
    characterName: null,
    anchorVersionId: null,
  });
}

function collectResearchCommandTargets() {
  const storyboardAvailable = Boolean(visual) && structureTools && !structureTools.hidden;
  const panels = [];
  const frame = detailIndex >= 0 ? readyFrames[detailIndex] : null;
  if (frame && Array.isArray(frame.panels)) {
    frame.panels.forEach((_, panelIndex) => {
      panels.push({
        displayFrameNumber: detailIndex + 1,
        displayFrameId: typeof frame.id === "string" ? frame.id : null,
        structureFrameId: typeof frame.structureFrameId === "string" ? frame.structureFrameId : null,
        structureSegmentIndex: Number.isInteger(frame.structureSegmentIndex)
          ? frame.structureSegmentIndex
          : null,
        panelIndex,
      });
    });
  }
  return { storyboardAvailable, panels };
}

function syncResearchCommandTargets() {
  researchDock?.setAvailableTargets?.(collectResearchCommandTargets());
}

async function postResearchEvent(body) {
  try {
    const response = await fetch("/api/research/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.event ?? null;
  } catch {
    return null;
  }
}

async function runStructureEditProduct(instruction, { clearProductForm = false } = {}) {
  const next = await fetchJson("/api/visual/storyboard/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction }),
  });
  applyVisual(next);
  if (clearProductForm && structureInstruction) {
    structureInstruction.value = "";
    if (structureResult) {
      structureResult.hidden = false;
      structureResult.textContent = "Правка применена. Предыдущую структуру можно вернуть.";
    }
  }
  showActionNotice("Раскадровка обновлена.");
  return next;
}

async function runPanelGenerateProduct({ frameId, panelIndex, instruction, displayFrameNumber = null }) {
  const next = await fetchJson(
    `/api/visual/frames/${encodeURIComponent(frameId)}/panels/${panelIndex}/generate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction }),
    },
  );
  applyVisual(next);
  const frameLabel = displayFrameNumber == null ? "" : ` кадра ${displayFrameNumber}`;
  showActionNotice(`Панель ${panelIndex + 1}${frameLabel} готова.`);
  return next;
}

async function executeDockCommand({ instruction, commandTarget }) {
  if (busy) return { ok: false, blocked: true };
  if (!commandTarget || (commandTarget.kind !== "storyboard" && commandTarget.kind !== "panel")) {
    return { ok: false, unsupported: true };
  }

  let outcome = { ok: false };
  if (commandTarget.kind === "storyboard") {
    await runBusy("Применяю структурную правку к раскадровке…", async () => {
      try {
        await runStructureEditProduct(instruction, { clearProductForm: false });
        outcome = { ok: true };
      } catch (error) {
        outcome = { ok: false, error };
        throw error;
      }
    });
    return outcome;
  }

  const frameId = commandTarget.displayFrameId;
  const panelIndex = commandTarget.panelIndex;
  if (typeof frameId !== "string" || !Number.isInteger(panelIndex)) {
    return { ok: false, unsupported: true };
  }
  await runBusy(
    `Создаю панель ${panelIndex + 1}${
      commandTarget.displayFrameNumber == null ? "" : ` кадра ${commandTarget.displayFrameNumber}`
    }…`,
    async () => {
      try {
        await runPanelGenerateProduct({
          frameId,
          panelIndex,
          instruction,
          displayFrameNumber: commandTarget.displayFrameNumber,
        });
        outcome = { ok: true };
      } catch (error) {
        outcome = { ok: false, error };
        throw error;
      }
    },
  );
  return outcome;
}

const researchDock = researchDockRoot
  ? bindResearchDock({
    root: researchDockRoot,
    host: researchDockHost,
    detail,
    getContext: captureResearchContext,
    isProductBusy: () => busy,
    executeDockCommand,
  })
  : null;

syncResearchCommandTargets();

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
  visual = null;
  grid.replaceChildren();
  openLast.hidden = true;
  structureTools.hidden = true;
  charactersWorkspace.hidden = true;
  visualHeading.hidden = true;
  visualApproval.hidden = true;
  readyForVideo.hidden = true;
  document.body.dataset.state = "";
  syncResearchCommandTargets();
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

function hasGeneratedVisualState(frame) {
  const panels = Array.isArray(frame?.panels) ? frame.panels : [];
  return panels.some((panel) => (
    Boolean(panel?.assetId)
    || panel?.generationStatus != null
    || panel?.generationError != null
  ));
}

export function presentFrameForMount(frame, mode) {
  if (hasGeneratedVisualState(frame)) {
    return {
      frame,
      mode: mode ?? (frame.visualReady ? "visual" : "structure"),
      source: "generated",
    };
  }
  const pictured = presentVisualFrame(frame);
  if (pictured) {
    return {
      frame: pictured,
      mode: "visual",
      source: "demo-anchor",
    };
  }
  return {
    frame,
    mode: "structure",
    source: "structure",
  };
}

function mountFrame(host, frame, scale, mode) {
  host.replaceChildren();
  const stage = document.createElement("div");
  stage.className = "frame-stage";
  stage.style.width = `${FrameRenderer.FRAME_GEOMETRY.width * scale}px`;
  stage.style.height = `${FrameRenderer.FRAME_GEOMETRY.height * scale}px`;
  stage.style.setProperty("--frame-scale", String(scale));
  const presented = presentFrameForMount(frame, mode);
  stage.append(FrameRenderer.render(presented.frame, { mode: presented.mode }));
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
    const card = document.createElement("article");
    card.className = "story-card";
    card.dataset.ready = frame.visualReady ? "true" : "false";
    const top = document.createElement("div");
    top.className = "card-heading";
    const number = document.createElement("span");
    number.textContent = `Кадр ${index + 1}`;
    const status = document.createElement("span");
    status.className = "card-status";
    status.textContent = frame.visualReady ? "Изображения готовы" : "Текст";
    top.append(number, status);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "frame-preview";
    const host = document.createElement("div");
    host.className = "frame-host";
    mountFrame(host, frame, 0.2);
    preview.append(host);
    if (frame.outsideFrameText) {
      const outside = document.createElement("p");
      outside.className = "outside-frame";
      outside.textContent = frame.outsideFrameText;
      preview.append(outside);
    }
    preview.addEventListener("click", () => openDetail(index));
    card.append(top, preview);
    if (visual?.allAnchorsApproved) {
      const generate = document.createElement("button");
      generate.type = "button";
      generate.className = "generate-frame";
      generate.textContent = frame.visualReady ? "Открыть и изменить" : "Создать изображения кадра";
      generate.addEventListener("click", async () => {
        if (frame.visualReady) {
          openDetail(index);
          return;
        }
        await generateFrame(frame.id, generate, index);
      });
      card.append(generate);
    }
    grid.append(card);
  });
  openLast.hidden = frames.length === 0;
}

function openDetail(index) {
  const frame = readyFrames[index];
  if (!frame) return;
  detailIndex = index;
  mountFrame(detailHost, frame, 0.5);
  detailOutside.textContent = frame.outsideFrameText || "";
  renderPanelControls(frame);
  const following = readyFrames[index + 1];
  nextFrame.hidden = !frame.visualReady || !following;
  if (following) {
    nextFrame.textContent = following.visualReady ? "Открыть следующий кадр" : "Создать следующий кадр";
  }
  syncResearchCommandTargets();
  researchDock?.enterDetail();
  if (!detail.open) detail.showModal();
}

openLast.addEventListener("click", () => openDetail(readyFrames.length - 1));
closeDetail.addEventListener("click", () => detail.close());
nextFrame.addEventListener("click", async () => {
  const index = detailIndex + 1;
  const frame = readyFrames[index];
  if (!frame) return;
  if (frame.visualReady) {
    openDetail(index);
    return;
  }
  await generateFrame(frame.id, nextFrame, index);
});

function showActionNotice(text, kind = "info") {
  notice.hidden = false;
  notice.textContent = text;
  notice.dataset.kind = kind;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const kind = payload?.kind
      || (response.status === 413 ? "image-too-large" : null)
      || (response.status === 409 && payload?.status === "blocked" ? "structure-rejected" : "request-failed");
    const error = new Error(kind);
    error.kind = kind;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function actionMessage(kind) {
  const messages = {
    "identity-required": "Сначала выберите реальную фотографию персонажа.",
    "anchor-required": "Сначала утвердите базовый образ этого персонажа.",
    "style-required": "Сначала утвердите стиль проекта — без него нельзя создать панели этого кадра.",
    "subject-required": "Сначала укажите персонажа для каждой панели этого кадра.",
    "invalid-image": "Не удалось прочитать изображение. Выберите JPEG, PNG или WebP.",
    "unsupported-image-format": "Этот формат пока не поддерживается. Выберите JPEG, PNG или WebP.",
    "image-too-large": "Файл слишком большой. Выберите фото меньшего размера.",
    "structure-rejected": "Не удалось применить эту правку, не меняя реплики. Опишите изменение кадра иначе.",
    "invalid-request": "Не удалось прочитать запрос. Проверьте файл или формулировку правки и попробуйте ещё раз.",
    "visual-incomplete": "Сначала создайте изображения для всех панелей.",
    timeout: "Генерация заняла слишком много времени. Попробуйте ещё раз.",
    provider: "Провайдер не завершил генерацию. Уже готовые результаты сохранены.",
    "invalid-output": "Провайдер не вернул пригодное изображение.",
    database: "Не удалось сохранить результат. Попробуйте ещё раз.",
    "stale-version": "Раскадровка уже изменилась. Обновите страницу и повторите действие.",
    "asset-load-failed": "Изображение не удалось показать. Обновите страницу или создайте панель заново.",
    "nothing-to-undo": "Предыдущей структурной версии пока нет.",
  };
  return messages[kind] || "Не удалось выполнить действие. Попробуйте ещё раз.";
}

function failureNotice(failures) {
  if (!failures?.length) return null;
  if (failures.length === 1) {
    const entry = failures[0];
    return `Не удалось создать панель ${entry.panelIndex + 1}. ${actionMessage(entry.kind)}`;
  }
  return `Кадр создан частично. Не удалось создать панели: ${failures.map((entry) => entry.panelIndex + 1).join(", ")}.`;
}

export function frameAttemptNotice({ generationFailures = [], visualReady = false } = {}) {
  const notice = failureNotice(generationFailures);
  if (notice) return { text: notice, kind: "error" };
  return {
    text: visualReady
      ? "Кадр готов. Проверьте изображения."
      : "Генерация завершилась, но кадр ещё не полностью готов.",
    kind: "info",
  };
}

export function describePanelAttempt(panel = {}) {
  const retainedAssetId = panel.assetId || null;
  if (panel.generationStatus !== "failed") {
    return {
      failureText: null,
      retained: Boolean(retainedAssetId),
      retainedAssetId,
    };
  }
  const base = actionMessage(panel.generationError || "provider");
  const failureText = retainedAssetId
    ? `${base} Показан предыдущий готовый вариант.`
    : base;
  return {
    failureText,
    retained: Boolean(retainedAssetId),
    retainedAssetId,
  };
}

async function runBusy(message, operation) {
  if (busy) return null;
  busy = true;
  document.body.dataset.busy = "true";
  showActionNotice(message);
  try {
    return await operation();
  } catch (error) {
    showActionNotice(actionMessage(error.kind), "error");
    return null;
  } finally {
    busy = false;
    delete document.body.dataset.busy;
  }
}

const IDENTITY_MAX_BYTES = 12 * 1024 * 1024;
const IDENTITY_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function identityFileKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/.test(name)) {
    return "unsupported-image-format";
  }
  if (Number(file?.size) > IDENTITY_MAX_BYTES) return "image-too-large";
  if (type && !IDENTITY_TYPES.has(type) && !/\.(jpe?g|png|webp)$/.test(name)) {
    return "unsupported-image-format";
  }
  return null;
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      const error = new Error("invalid-image");
      error.kind = "invalid-image";
      reject(error);
    };
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function withVisualReady(frames) {
  return (frames || []).map((frame) => {
    const panels = Array.isArray(frame?.panels) ? frame.panels : [];
    return {
      ...frame,
      visualReady: panels.length > 0 && panels.every((panel) => Boolean(panel?.assetId)),
    };
  });
}

function fitFrames(frames) {
  try {
    const fitted = compileOverflow(frames, (text, options) => FrameRenderer.measureDialogue(document, {
      layout: options.layout,
      speakerPanel: options.speakerPanel,
      panels: options.panels,
      dialogue: text,
    }, options.fontSize));
    if (!fitted.ok) return withVisualReady(frames);
    return withVisualReady(fitted.frames);
  } catch (error) {
    console.warn("[visual] fitFrames failed", { kind: "measurement" });
    return withVisualReady(frames);
  }
}

function renderCharacterCards() {
  characterCards.replaceChildren();
  for (const character of visual.characters || []) {
    const card = document.createElement("article");
    card.className = "character-card";
    const heading = document.createElement("div");
    heading.className = "character-heading";
    const title = document.createElement("h3");
    title.textContent = character.name;
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = character.approvedAnchorId ? "Образ утверждён" : "Нужен образ";
    heading.append(title, badge);

    const media = document.createElement("div");
    media.className = "anchor-media";
    if (character.identity?.assetUrl) {
      const identity = document.createElement("figure");
      const image = document.createElement("img");
      image.src = character.identity.assetUrl;
      image.alt = `Исходная фотография: ${character.name}`;
      const caption = document.createElement("figcaption");
      caption.textContent = "Реальное фото";
      identity.append(image, caption);
      media.append(identity);
    }
    if (character.candidate?.assetUrl) {
      const candidate = document.createElement("figure");
      const image = document.createElement("img");
      image.src = character.candidate.assetUrl;
      image.alt = `Базовый образ: ${character.name}`;
      const caption = document.createElement("figcaption");
      caption.textContent = character.approvedAnchorId === character.candidate.id ? "Утверждённый образ" : "Текущий вариант";
      candidate.append(image, caption);
      media.append(candidate);
    }

    const identityLabel = document.createElement("label");
    identityLabel.textContent = character.identity ? "Заменить реальное фото" : "Выбрать реальное фото";
    const identityInput = document.createElement("input");
    identityInput.type = "file";
    identityInput.accept = "image/png,image/jpeg,image/jpg,image/webp,.jpg,.jpeg,.png,.webp";
    identityLabel.append(identityInput);
    const comment = document.createElement("textarea");
    comment.placeholder = "Комментарий к внешности и базовому образу";
    comment.value = character.identity?.comment || "";
    const saveIdentity = document.createElement("button");
    saveIdentity.type = "button";
    saveIdentity.className = "secondary";
    saveIdentity.textContent = character.identity ? "Сохранить новое фото" : "Сохранить фото";
    saveIdentity.addEventListener("click", async () => {
      const file = identityInput.files?.[0];
      if (!file) {
        showActionNotice("Выберите локальную фотографию.", "error");
        return;
      }
      const fileKind = identityFileKind(file);
      if (fileKind) {
        showActionNotice(actionMessage(fileKind), "error");
        return;
      }
      await runBusy(`Сохраняю фотографию для ${character.name}…`, async () => {
        const imageDataUrl = await fileAsDataUrl(file);
        const next = await fetchJson(`/api/visual/characters/${encodeURIComponent(character.name)}/identity`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageDataUrl, comment: comment.value }),
        });
        applyVisual(next);
        showActionNotice(`Фотография для ${character.name} сохранена.`);
      });
    });

    const instruction = document.createElement("textarea");
    instruction.placeholder = character.candidate?.assetUrl
      ? "Что изменить в следующем варианте?"
      : "Дополнительные пожелания к первому варианту";
    const generate = document.createElement("button");
    generate.type = "button";
    generate.disabled = !character.identity;
    generate.textContent = character.candidate?.assetUrl ? "Создать новый вариант" : "Создать base anchor";
    generate.addEventListener("click", async () => {
      await runBusy(`Создаю базовый образ для ${character.name}. Это может занять около минуты…`, async () => {
        const next = await fetchJson(`/api/visual/characters/${encodeURIComponent(character.name)}/anchor`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction: instruction.value }),
        });
        applyVisual(next);
        showActionNotice(`Новый вариант для ${character.name} готов.`);
      });
    });

    const actions = document.createElement("div");
    actions.className = "anchor-actions";
    actions.append(generate);
    if (character.candidate?.status === "ready" && character.candidate.assetId) {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "primary-soft";
      approve.textContent = "Утвердить этот образ";
      approve.addEventListener("click", async () => {
        await runBusy(`Утверждаю образ ${character.name}…`, async () => {
          const next = await fetchJson(
            `/api/visual/characters/${encodeURIComponent(character.name)}/anchors/${character.candidate.id}/approve`,
            { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
          );
          applyVisual(next);
          showActionNotice(`Образ ${character.name} утверждён.`);
        });
      });
      actions.append(approve);
    }
    card.append(heading, media, identityLabel, comment, saveIdentity, instruction, actions);
    characterCards.append(card);
  }
}

function applyVisual(next) {
  if (!next || next.status !== "ready") return;
  visual = next;
  const fitted = fitFrames(next.frames || []);
  showReady(fitted, "ready");
  structureTools.hidden = false;
  undoStructure.hidden = !next.canUndo;
  charactersWorkspace.hidden = false;
  visualHeading.hidden = !next.allAnchorsApproved;
  renderCharacterCards();
  const completed = (next.frames || []).filter((frame) => frame.visualReady).length;
  visualProgress.textContent = next.allAnchorsApproved
    ? `${completed} из ${(next.frames || []).length} кадров готовы`
    : "Сначала утвердите базовый образ каждого персонажа";
  visualApproval.hidden = !next.complete;
  approveVisual.hidden = next.readyForVideo;
  approvalCopy.textContent = next.approved
    ? "Текущая версия утверждена."
    : "Просмотрите все кадры и утвердите текущую версию.";
  readyForVideo.hidden = !next.readyForVideo;
  syncResearchCommandTargets();
  if (detail.open && detailIndex >= 0) openDetail(detailIndex);
}

async function refreshVisual() {
  try {
    const next = await fetchJson("/api/visual");
    if (next.status === "ready") applyVisual(next);
  } catch {
    // Earlier checkpoints and isolated UI tests do not expose the visual API.
  }
}

async function generateFrame(frameId, button, index) {
  const source = (visual?.frames || []).find((frame) => frame.id === frameId);
  const panelCount = source?.panels?.length || 1;
  const progress = panelCount > 1
    ? `Создаю изображения этого кадра: ${panelCount} панели…`
    : "Создаю изображение этого кадра…";
  await runBusy(progress, async () => {
    const previous = button.textContent;
    button.textContent = panelCount > 1 ? `Создаю ${panelCount} панели…` : "Создаю…";
    try {
      const next = await fetchJson(`/api/visual/frames/${encodeURIComponent(frameId)}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      applyVisual(next);
      const fittedIndex = readyFrames.findIndex((frame) => frame.id === frameId);
      const openIndex = fittedIndex >= 0 ? fittedIndex : index;
      if (Number.isInteger(openIndex) && readyFrames[openIndex]) {
        openDetail(openIndex);
      }
      const attempt = frameAttemptNotice({
        generationFailures: next.generationFailures || [],
        visualReady: Boolean(next.frames?.find((frame) => frame.id === frameId)?.visualReady),
      });
      showActionNotice(attempt.text, attempt.kind);
    } catch (error) {
      console.error("[visual] frame generation failed", { kind: error?.kind || "request-failed", frameId });
      throw error;
    } finally {
      button.textContent = previous;
    }
  });
}

function renderPanelControls(frame) {
  detailPanelControls.replaceChildren();
  frame.panels.forEach((panel, panelIndex) => {
    const section = document.createElement("section");
    section.className = "panel-control";
    const title = document.createElement("h3");
    title.textContent = frame.panels.length > 1
      ? `Панель ${panelIndex + 1}${panel.subject ? ` · ${panel.subject}` : ""}`
      : (panel.subject || "Изображение кадра");
    const description = document.createElement("p");
    description.className = "panel-description-copy";
    description.textContent = panel.description;
    const attempt = describePanelAttempt(panel);
    let failure = null;
    if (attempt.failureText) {
      failure = document.createElement("p");
      failure.className = "panel-failure";
      failure.textContent = attempt.failureText;
      if (attempt.retainedAssetId) failure.dataset.assetId = attempt.retainedAssetId;
    }
    const instruction = document.createElement("textarea");
    instruction.placeholder = "Опишите, что изменить в этой панели";
    const performanceLabel = document.createElement("label");
    performanceLabel.textContent = panel.performanceAssetId
      ? "Заменить фото позы или выражения (необязательно)"
      : "Добавить фото позы или выражения (необязательно)";
    const performance = document.createElement("input");
    performance.type = "file";
    performance.accept = "image/png,image/jpeg,image/webp";
    performanceLabel.append(performance);
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.textContent = panel.assetId ? "Переделать эту панель" : "Создать эту панель";
    regenerate.addEventListener("click", async () => {
      await runBusy(`Создаю панель ${panelIndex + 1} кадра ${detailIndex + 1}…`, async () => {
        const file = performance.files?.[0];
        const performanceImageDataUrl = file ? await fileAsDataUrl(file) : undefined;
        try {
          const next = await fetchJson(
            `/api/visual/frames/${encodeURIComponent(frame.id)}/panels/${panelIndex}/generate`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ instruction: instruction.value, performanceImageDataUrl }),
            },
          );
          applyVisual(next);
          showActionNotice(`Панель ${panelIndex + 1} кадра ${detailIndex + 1} готова.`);
        } catch (error) {
          console.error("[visual] panel generation failed", {
            kind: error?.kind || "request-failed",
            frameId: frame.id,
            panelIndex,
          });
          throw error;
        }
      });
    });
    section.append(title, description);
    if (failure) section.append(failure);
    section.append(instruction, performanceLabel, regenerate);
    if (panel.assetId) {
      const zoomLabel = document.createElement("label");
      zoomLabel.className = "zoom-control";
      const zoomCopy = document.createElement("span");
      zoomCopy.textContent = `Приближение без генерации · ${Number(panel.zoom).toFixed(2)}×`;
      const zoom = document.createElement("input");
      zoom.type = "range";
      zoom.min = "1";
      zoom.max = "3";
      zoom.step = "0.05";
      zoom.value = String(panel.zoom);
      zoom.addEventListener("input", () => {
        zoomCopy.textContent = `Приближение без генерации · ${Number(zoom.value).toFixed(2)}×`;
        readyFrames[detailIndex].panels[panelIndex].zoom = Number(zoom.value);
        mountFrame(detailHost, readyFrames[detailIndex], 0.5);
      });
      zoom.addEventListener("change", async () => {
        await runBusy("Сохраняю приближение…", async () => {
          const next = await fetchJson(
            `/api/visual/frames/${encodeURIComponent(frame.id)}/panels/${panelIndex}/placement`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ zoom: Number(zoom.value), positionX: 50, positionY: 30 }),
            },
          );
          applyVisual(next);
          showActionNotice("Приближение сохранено без новой генерации.");
        });
      });
      zoomLabel.append(zoomCopy, zoom);
      section.append(zoomLabel);
    }
    detailPanelControls.append(section);
  });
}

structureEditForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const instruction = structureInstruction.value.trim();
  if (!instruction) return;
  const correlationId = crypto.randomUUID();
  const context = captureResearchContext();
  const commandTarget = createEmptyCommandTarget("storyboard");
  const startSnapshot = {
    semanticAction: "structure_edit",
    surface: "product_control",
    submittedText: instruction,
    commandTarget,
    editTarget: null,
    context,
  };
  await runBusy("Применяю структурную правку к раскадровке…", async () => {
    researchDock?.setLiveOperation({
      correlationId,
      semanticAction: "structure_edit",
      surface: "product_control",
    });
    let startSaved = false;
    try {
      const startEvent = await postResearchEvent({
        eventKind: "action_start",
        correlationId,
        ...startSnapshot,
      });
      startSaved = Boolean(startEvent);
    } catch {
      startSaved = false;
    }

    try {
      await runStructureEditProduct(instruction, { clearProductForm: true });
      const terminalBody = {
        eventKind: "action_terminal",
        correlationId,
        outcome: "success",
        outcomeFlags: {},
      };
      if (!startSaved) terminalBody.startSnapshot = startSnapshot;
      const terminalEvent = await postResearchEvent(terminalBody);
      if (terminalEvent) researchDock?.recordTerminalEvent(terminalEvent);
    } catch (error) {
      const terminalBody = {
        eventKind: "action_terminal",
        correlationId,
        outcome: "failure",
        outcomeKind: typeof error?.kind === "string" ? error.kind : "request-failed",
        outcomeFlags: {},
      };
      if (!startSaved) terminalBody.startSnapshot = startSnapshot;
      const terminalEvent = await postResearchEvent(terminalBody);
      if (terminalEvent) researchDock?.recordTerminalEvent(terminalEvent);
      throw error;
    } finally {
      researchDock?.clearLiveOperation();
    }
  });
});

undoStructure?.addEventListener("click", async () => {
  await runBusy("Возвращаю предыдущую структуру…", async () => {
    const next = await fetchJson("/api/visual/storyboard/undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    applyVisual(next);
    structureResult.hidden = false;
    structureResult.textContent = "Предыдущая структура восстановлена.";
  });
});

approveVisual?.addEventListener("click", async () => {
  await runBusy("Утверждаю текущую визуальную раскадровку…", async () => {
    const next = await fetchJson("/api/visual/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    applyVisual(next);
    showActionNotice("Визуальная раскадровка утверждена.");
  });
});

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
  await refreshVisual();
});

draftAutosave.ready.then(async () => {
  try {
    const response = await fetch("/api/project");
    if (!response.ok) return;
    const project = await response.json();
    restoreReview(project);
    await restoreStoryboard(project);
    await refreshVisual();
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
