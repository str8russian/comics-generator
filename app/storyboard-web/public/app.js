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

let readyFrames = [];
let draftSync = { state: "boot", savedText: null };
let review = null;
let castChain = Promise.resolve();
let visual = null;
let detailIndex = -1;
let busy = false;

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

function mountFrame(host, frame, scale, mode = frame.visualReady ? "visual" : "structure") {
  host.replaceChildren();
  const stage = document.createElement("div");
  stage.className = "frame-stage";
  stage.style.width = `${FrameRenderer.FRAME_GEOMETRY.width * scale}px`;
  stage.style.height = `${FrameRenderer.FRAME_GEOMETRY.height * scale}px`;
  stage.style.setProperty("--frame-scale", String(scale));
  stage.append(FrameRenderer.render(frame, { mode }));
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

function actionMessage(kind) {
  const messages = {
    "identity-required": "Сначала выберите реальную фотографию персонажа.",
    "anchor-required": "Сначала утвердите базовый образ этого персонажа.",
    "invalid-image": "Не удалось прочитать изображение. Выберите JPEG, PNG или WebP.",
    "unsupported-image-format": "Этот формат пока не поддерживается. Выберите JPEG, PNG или WebP.",
    "image-too-large": "Файл слишком большой. Выберите фото меньшего размера.",
    "structure-rejected": "Не удалось применить эту правку, не меняя реплики. Опишите изменение кадра иначе.",
    "invalid-request": "Не удалось прочитать запрос. Проверьте файл или формулировку правки и попробуйте ещё раз.",
    "visual-incomplete": "Сначала создайте изображения для всех панелей.",
    timeout: "Генерация заняла слишком много времени. Попробуйте ещё раз.",
    provider: "Провайдер не завершил генерацию. Уже готовые результаты сохранены.",
    "invalid-output": "Провайдер не вернул пригодное изображение.",
    "nothing-to-undo": "Предыдущей структурной версии пока нет.",
  };
  return messages[kind] || "Не удалось выполнить действие. Попробуйте ещё раз.";
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

function fitFrames(frames) {
  try {
    const fitted = compileOverflow(frames, (text, options) => FrameRenderer.measureDialogue(document, {
      layout: options.layout,
      speakerPanel: options.speakerPanel,
      panels: options.panels,
      dialogue: text,
    }, options.fontSize));
    return fitted.ok ? fitted.frames : frames;
  } catch {
    return frames;
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
  await runBusy("Создаю изображения этого кадра по утверждённым образам…", async () => {
    const previous = button.textContent;
    button.textContent = "Создаю…";
    try {
      const next = await fetchJson(`/api/visual/frames/${encodeURIComponent(frameId)}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      applyVisual(next);
      if (Number.isInteger(index) && next.frames?.some((frame) => frame.id === frameId && frame.visualReady)) {
        openDetail(index);
      }
      const failures = next.generationFailures || [];
      showActionNotice(failures.length
        ? `Кадр создан частично. Не удалось создать панелей: ${failures.map((entry) => entry.panelIndex + 1).join(", ")}.`
        : "Кадр готов. Откройте его, чтобы проверить панели.", failures.length ? "error" : "info");
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
      });
    });
    section.append(title, description, instruction, performanceLabel, regenerate);
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
  await runBusy("Применяю структурную правку к раскадровке…", async () => {
    const next = await fetchJson("/api/visual/storyboard/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    applyVisual(next);
    structureInstruction.value = "";
    structureResult.hidden = false;
    structureResult.textContent = "Правка применена. Предыдущую структуру можно вернуть.";
    showActionNotice("Раскадровка обновлена.");
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
