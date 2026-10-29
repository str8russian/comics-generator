import { defaultDurationFrames, typedDialogue } from "../timing.mjs";

function el(document, tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(document, label, onClick, { className = "", disabled = false } = {}) {
  const node = el(document, "button", className, label);
  node.type = "button";
  node.disabled = Boolean(disabled);
  node.addEventListener("click", (event) => onClick?.(event, node));
  return node;
}

function section(document, name, title, tag = "section") {
  const node = el(document, tag, `inspector-section inspector-${name}`);
  node.dataset.inspectorSection = name;
  if (title && tag !== "details") node.append(el(document, "h4", "inspector-heading", title));
  return node;
}

function emptyState(document) {
  const node = el(document, "div", "inspector-empty");
  node.append(
    el(document, "p", "inspector-empty-title", "Выберите кадр"),
    el(document, "p", "helper", "Нажмите на карточку кадра, чтобы увидеть его действия. Открыть — редактор кадра."),
  );
  return node;
}

function headerSection(document, model, actions) {
  const header = section(document, "header", null, "header");
  const titleRow = el(document, "div", "inspector-title-row");
  const copy = el(document, "div");
  copy.append(
    el(document, "p", "eyebrow", "Выбран кадр"),
    el(document, "h3", "inspector-title", `Кадр ${model.displayNumber}`),
    el(document, "p", "helper", model.layoutLabel),
  );
  const clear = button(document, "×", () => actions.clearSelection?.(), { className: "inspector-clear secondary" });
  clear.setAttribute?.("aria-label", "Снять выбор");
  titleRow.append(copy, clear);
  const row = el(document, "div", "inspector-primary");
  row.append(button(document, "Открыть редактор кадра", () => actions.openEditor(), { className: "primary-soft" }));
  if (model.assembly) row.append(button(document, "Дублировать кадр", () => actions.duplicate()));
  header.append(titleRow, row);
  if (model.statusText) header.append(el(document, "p", "card-status", model.statusText));
  return header;
}

function timingSection(document, model, actions) {
  const node = section(document, "timing", "Время");
  node.append(el(document, "p", "assembly-timing", model.timing.label));
  const input = el(document, "input", "inspector-duration");
  input.type = "number";
  input.min = String(model.timing.min);
  input.step = "1";
  input.value = String(model.timing.frames);
  input.setAttribute?.("aria-label", "Длительность в кадрах");
  input.addEventListener("change", () => actions.setDuration(input.value));
  const label = el(document, "label", "inspector-field");
  label.append(el(document, "span", "", "Длительность, кадров"), input);
  node.append(label);
  return node;
}

function frameSection(document, model, actions) {
  const node = section(document, "frame", "Кадр");
  const list = el(document, "div", "inspector-actions");
  list.append(
    button(document, "Кадр с изображением после", () => actions.insertImageAfter()),
    button(document, "Переместить кадр раньше", () => actions.moveEarlier(), { disabled: !model.canMoveEarlier }),
    button(document, "Переместить кадр позже", () => actions.moveLater(), { disabled: !model.canMoveLater }),
    button(document, "Удалить кадр", () => actions.deleteFrame(), { className: "destructive" }),
  );
  node.append(list);
  if (model.segmentNote) node.append(el(document, "p", "assembly-note", model.segmentNote));
  return node;
}

function panelBlock(document, model, panel, actions) {
  const block = el(document, "div", "inspector-panel");
  block.dataset.panelIndex = String(panel.index);
  const title = el(document, "p", "inspector-panel-title", `Панель ${panel.address}${panel.subject ? ` · ${panel.subject}` : ""}`);
  block.append(title);
  if (panel.basisChip) block.append(panel.basisChip);
  const choose = button(document, "Выбрать изображение…", (event, node) => actions.chooseAsset(panel.index, node, false));
  choose.dataset.panelIndex = String(panel.index);
  block.append(choose);
  if (panel.subjectEditable) {
    const subject = el(document, "select", "inspector-select");
    subject.setAttribute?.("aria-label", `Персонаж панели ${panel.address}`);
    const blank = el(document, "option", "", "Выберите персонажа");
    blank.value = "";
    subject.append(blank);
    for (const name of model.characterNames) {
      const option = el(document, "option", "", name);
      option.value = name;
      if (panel.manualSubject === name || panel.subject === name) option.selected = true;
      subject.append(option);
    }
    subject.addEventListener("change", () => {
      if (!subject.value) return;
      actions.setManualSubject(panel.index, subject.value);
    });
    block.append(subject);
  }
  if (model.panels.length === 2) {
    block.append(button(document, `Удалить панель ${panel.address}`, () => actions.deletePanel(panel.index), { className: "destructive" }));
  }
  return block;
}

function moreSection(document, model, actions, open) {
  const node = section(document, "more", null, "details");
  node.open = Boolean(open);
  node.append(el(document, "summary", "inspector-summary", "Ещё"));
  const body = el(document, "div", "inspector-more-body");
  if (model.frameKind === "text") {
    const text = el(document, "textarea", "inspector-text-card");
    text.value = model.textCard;
    text.placeholder = "Текст карточки";
    text.setAttribute?.("aria-label", "Текст карточки");
    text.addEventListener("change", () => actions.setTextCard(text.value));
    body.append(text);
  } else if (model.panels.length === 1) {
    body.append(button(document, "Добавить панель", () => actions.addPanel()));
  }
  if (model.panels.length === 2) body.append(button(document, "Поменять панели", () => actions.swapPanels()));
  for (const panel of model.panels) body.append(panelBlock(document, model, panel, actions));
  node.append(body);
  return node;
}

function imagesSection(document, model, actions) {
  if (!model.showGenerate && !model.panels.length) return null;
  const node = section(document, "images", "Изображения");
  for (const panel of model.panels) {
    const open = button(document, `Изображение панели ${panel.address}…`, () => actions.openPanel(panel.index));
    open.dataset.panelIndex = String(panel.index);
    node.append(open);
  }
  if (model.panels.length) {
    node.append(el(document, "p", "helper", "Кадрирование и изображение панели — в редакторе кадра."));
  }
  return node;
}

function unavailableState(document) {
  return el(document, "p", "helper", "Действия с кадром появятся, когда визуальная раскадровка загрузится.");
}

function renderTextCardInspector(root, model, actions, document, moreOpen) {
  root.append(headerSection(document, model, actions));
  if (!model.assembly) {
    root.append(unavailableState(document));
    return;
  }
  root.append(
    timingSection(document, model, actions),
    frameSection(document, model, actions),
    moreSection(document, model, actions, moreOpen),
  );
  const images = imagesSection(document, model, actions);
  if (images) root.append(images);
}

function imageHeaderSection(document, model, actions) {
  const header = section(document, "header", null, "header");
  const titleRow = el(document, "div", "inspector-title-row");
  const copy = el(document, "div");
  copy.append(el(document, "h3", "inspector-title", `Кадр ${model.displayNumber}`));
  const clear = button(document, "×", () => actions.clearSelection?.(), { className: "inspector-clear secondary" });
  clear.setAttribute?.("aria-label", "Снять выбор");
  titleRow.append(copy, clear);
  header.append(titleRow);
  return header;
}

function imageActionsSection(document, model, actions) {
  const node = section(document, "frame", null);
  const list = el(document, "div", "inspector-actions");
  list.append(
    button(document, "Дублировать кадр", () => actions.duplicate()),
    button(document, "Кадр с изображением после", () => actions.insertImageAfter()),
    button(document, "Переместить кадр раньше", () => actions.moveEarlier(), { disabled: !model.canMoveEarlier }),
    button(document, "Переместить кадр позже", () => actions.moveLater(), { disabled: !model.canMoveLater }),
    button(document, "Удалить кадр", () => actions.deleteFrame(), { className: "destructive" }),
  );
  node.append(list);
  if (model.segmentNote) node.append(el(document, "p", "assembly-note", model.segmentNote));
  return node;
}

export function renderFrameInspector(root, model, actions, { document = globalThis.document } = {}) {
  if (!root) return;
  const previousMore = root.querySelector?.("details");
  const moreOpen = Boolean(previousMore?.open && root.dataset?.frameKey === model?.key);
  root.replaceChildren();
  if (!model) {
    if (root.dataset) delete root.dataset.frameKey;
    root.append(emptyState(document));
    return;
  }
  if (root.dataset) root.dataset.frameKey = model.key;
  if (model.frameKind === "text") {
    renderTextCardInspector(root, model, actions, document, moreOpen);
    return;
  }
  root.append(imageHeaderSection(document, model, actions));
  if (!model.assembly) {
    root.append(unavailableState(document));
    return;
  }
  root.append(imageActionsSection(document, model, actions));
}

export function createFrameEditor({
  document = globalThis.document,
  elements,
  renderer,
  getFrames,
  formatSeconds,
  mountFrame,
  frameAddress,
  runAssembly,
  deletePanel,
  renderPanelControls,
  setSelection,
  markSelectedCards,
  renderInspector,
  prepareUtteranceEditor,
  saveDialogue,
  enterDetail,
  leaveDetail,
  undo,
  commitPlacement,
}) {
  const {
    detail,
    detailHost,
    detailOutside,
    detailRetained,
    detailScroll,
    detailTitle,
    detailFrameNumber,
    detailPanelControls,
    panelEditor,
    frameDialogue,
    frameDialogueSpoken,
    frameDialogueText,
    frameDialogueSpeaker,
    frameDialogueError,
    closeDetail,
    openLast,
    nextFrame,
    prevFrame,
    frameEditorTabs,
    frameEditorFrame,
    frameEditorUndo,
    workspaceUndoSlot,
    globalUndo,
    frameEditorLeave,
    frameEditorLeaveStay,
    frameEditorLeaveDiscard,
    frameEditorLeaveSave,
  } = elements;

  let currentIndex = -1;
  let currentPanelIndex = 0;
  let currentTab = "frame";
  let currentStructureId = null;
  let currentSegmentIndex = null;
  let dialogueDraft = null;
  let renderedDialogue = null;
  let pendingLeave = null;
  let detailFrameObserver = null;

  const frames = () => getFrames?.() || [];
  const currentFrame = () => frames()[currentIndex] || null;

  function namedInputs(root, name) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    return [...root.querySelectorAll(`input[name='${name}']`)];
  }

  function frameDraftKey(frame) {
    if (!frame) return "";
    const segment = Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : "";
    return `${frame.structureFrameId || frame.id || ""}#${segment}`;
  }

  function selectedDialogueMode() {
    return namedInputs(frameDialogue, "frame-dialogue-mode").find((input) => input.checked)?.value || null;
  }

  function selectedSpeakerPanelId() {
    return namedInputs(frameDialogueSpeaker, "frame-dialogue-speaker").find((input) => input.checked)?.value || null;
  }

  function dialogueFormSnapshot() {
    return {
      mode: selectedDialogueMode(),
      text: frameDialogueText?.value ?? "",
      speakerPanelId: selectedSpeakerPanelId(),
    };
  }

  function persistedDialogueMode(frame) {
    if (["spoken", "silent", "hidden"].includes(frame?.dialogueMode)) return frame.dialogueMode;
    return String(frame?.dialogue || "").trim() ? "spoken" : "hidden";
  }

  function sameDialogueUnit(left, right) {
    return (left?.structureFrameId || left?.id) === (right?.structureFrameId || right?.id)
      && (Number.isInteger(left?.structureSegmentIndex) ? left.structureSegmentIndex : null)
        === (Number.isInteger(right?.structureSegmentIndex) ? right.structureSegmentIndex : null);
  }

  function storedDialogueLine(frame) {
    return frames()
      .filter((entry) => sameDialogueUnit(entry, frame))
      .slice()
      .sort((left, right) => (left.displayBlock?.start || 0) - (right.displayBlock?.start || 0))
      .map((entry) => entry.dialogue || "")
      .join("");
  }

  function persistedDialogueSnapshot(frame) {
    const mode = persistedDialogueMode(frame);
    const panels = frame?.panels || [];
    const speakerPanel = mode === "spoken" ? panels[frame.speakerPanel] : null;
    return {
      mode,
      text: storedDialogueLine(frame),
      speakerPanelId: speakerPanel?.id || null,
    };
  }

  function dialogueSnapshotsMatch(left, right) {
    if (!left || !right || left.mode !== right.mode) return false;
    if (left.mode !== "spoken") return true;
    return left.text === right.text && (left.speakerPanelId || null) === (right.speakerPanelId || null);
  }

  function dialogueDirty(frame) {
    if (!frame || frame.frameKind === "text" || !frameDialogue || frameDialogueText == null) return false;
    const current = dialogueFormSnapshot();
    if (!current.mode) return false;
    return !dialogueSnapshotsMatch(current, persistedDialogueSnapshot(frame));
  }

  function showDialogueError(message) {
    if (!frameDialogueError) return;
    frameDialogueError.hidden = !message;
    frameDialogueError.textContent = message || "";
  }

  function syncDialogueFields(frame) {
    const mode = selectedDialogueMode();
    if (frameDialogueSpoken) frameDialogueSpoken.hidden = mode !== "spoken";
    if (frameDialogueSpeaker) {
      frameDialogueSpeaker.hidden = mode !== "spoken" || (frame?.panels || []).length < 2;
    }
  }

  function syncSegmentedSelection(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    for (const input of root.querySelectorAll("input[type='radio']")) {
      const option = input.closest?.(".segmented-option") || input.parentNode;
      const list = option?.classList;
      if (!list) continue;
      if (typeof list.toggle === "function") list.toggle("is-selected", Boolean(input.checked));
      else if (input.checked) list.add?.("is-selected");
      else list.remove?.("is-selected");
    }
  }

  function speakerOptionsRoot() {
    if (!frameDialogueSpeaker) return null;
    frameDialogueSpeaker.classList?.add?.("dialogue-speaker-control");
    const options = frameDialogueSpeaker.querySelector?.(".dialogue-speaker-options");
    if (options && typeof options.replaceChildren === "function") return options;
    if (typeof frameDialogueSpeaker.replaceChildren !== "function") return null;
    return frameDialogueSpeaker;
  }

  function applyDialogueDraft(frame) {
    if (!dialogueDraft || dialogueDraft.key !== frameDraftKey(frame)) return;
    for (const input of namedInputs(frameDialogue, "frame-dialogue-mode")) {
      input.checked = input.value === dialogueDraft.mode;
    }
    if (frameDialogueText) frameDialogueText.value = dialogueDraft.text ?? "";
    if (dialogueDraft.speakerPanelId) {
      for (const input of namedInputs(frameDialogueSpeaker, "frame-dialogue-speaker")) {
        input.checked = input.value === dialogueDraft.speakerPanelId;
      }
    }
  }

  function renderDialogue(frame) {
    if (!frameDialogue) return;
    const eligible = frame && frame.frameKind !== "text";
    frameDialogue.hidden = !eligible;
    if (!eligible) return;
    const mode = persistedDialogueMode(frame);
    for (const input of namedInputs(frameDialogue, "frame-dialogue-mode")) {
      input.checked = input.value === mode;
    }
    if (frameDialogueText) frameDialogueText.value = storedDialogueLine(frame);
    const speakerOptions = speakerOptionsRoot();
    if (speakerOptions && typeof speakerOptions.replaceChildren === "function") {
      speakerOptions.replaceChildren();
      const panels = frame.panels || [];
      const currentId = mode === "spoken" ? panels[frame.speakerPanel]?.id : frame.dormantSpeakerPanelId;
      panels.forEach((panel, index) => {
        const label = document.createElement("label");
        label.className = "segmented-option";
        const input = document.createElement("input");
        input.className = "segmented-input";
        input.type = "radio";
        input.name = "frame-dialogue-speaker";
        input.value = panel.id || "";
        input.checked = Boolean(panel.id) && panel.id === currentId;
        const caption = document.createElement("span");
        caption.className = "segmented-option-text";
        caption.textContent = panel.subject || `Панель ${index + 1}`;
        label.append(input, caption);
        speakerOptions.append(label);
      });
    }
    showDialogueError("");
    applyDialogueDraft(frame);
    syncDialogueFields(frame);
    syncSegmentedSelection(frameDialogue);
    renderedDialogue = dialogueFormSnapshot();
  }

  function previewFrame(frame) {
    if (!frame || !dialogueDirty(frame)) return frame;
    const snapshot = dialogueFormSnapshot();
    const panels = frame.panels || [];
    let speakerPanel = frame.speakerPanel;
    if (snapshot.mode === "spoken" && panels.length > 1) {
      const index = panels.findIndex((panel) => panel.id === snapshot.speakerPanelId);
      if (index >= 0) speakerPanel = index;
    }
    return {
      ...frame,
      dialogueMode: snapshot.mode,
      dialogue: snapshot.mode === "spoken" ? snapshot.text : frame.dialogue,
      speakerPanel: snapshot.mode === "spoken" ? speakerPanel : null,
    };
  }

  async function saveCurrentDialogue(frame, mode) {
    const multiPanel = (frame?.panels || []).length > 1;
    if (!frame || !mode) return false;
    if (mode === "spoken") {
      if (!(frameDialogueText?.value ?? "").trim()) {
        showDialogueError("Введите текст реплики.");
        return false;
      }
      if (multiPanel && !selectedSpeakerPanelId()) {
        showDialogueError("Выберите панель, которая говорит.");
        return false;
      }
    }
    showDialogueError("");
    const result = await saveDialogue?.({
      frame,
      mode,
      text: mode === "spoken" ? (frameDialogueText?.value ?? "") : null,
      speakerPanelId: mode === "spoken" && multiPanel ? selectedSpeakerPanelId() : null,
      previousDialogueMode: persistedDialogueMode(frame),
      showError: showDialogueError,
    });
    return Boolean(result);
  }

  function detailPanels() {
    if (!detailHost || typeof detailHost.querySelectorAll !== "function") return [];
    return [...detailHost.querySelectorAll(".panel")];
  }

  function panelColumn(panelIndex) {
    return detailPanels().find((node) => Number(node.dataset?.panelIndex) === panelIndex) ?? null;
  }

  function panelImage(panelIndex) {
    const column = panelColumn(panelIndex);
    return column?.querySelector?.(".panel-asset") || null;
  }

  function editorTabFor(frame, requested) {
    const panels = frame?.panels || [];
    let tab = requested || "frame";
    if (tab === "dialogue" && frame?.frameKind === "text") tab = "frame";
    if (String(tab).startsWith("panel-")) {
      const index = Number(String(tab).slice("panel-".length));
      if (!Number.isInteger(index) || index < 0 || index >= panels.length) return "frame";
      currentPanelIndex = index;
    }
    return tab;
  }

  function placeUndo(open) {
    const slot = open ? frameEditorUndo : workspaceUndoSlot;
    if (!slot || !globalUndo || globalUndo.parentNode === slot) return;
    slot.append(globalUndo);
  }

  function syncNavigation() {
    if (prevFrame) prevFrame.disabled = currentIndex <= 0;
    if (nextFrame) nextFrame.disabled = currentIndex < 0 || currentIndex >= frames().length - 1;
  }

  function paintTabs(frame) {
    if (!frameEditorTabs) return;
    frameEditorTabs.replaceChildren();
    const panels = frame?.panels || [];
    const tabs = [
      { id: "frame", label: "Кадр" },
      ...(frame?.frameKind === "text" ? [] : [{ id: "dialogue", label: "Диалог" }]),
      ...panels.map((_, index) => ({
        id: `panel-${index}`,
        label: panels.length === 1 ? "Панель" : `Панель ${index + 1}`,
      })),
    ];
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "frame-editor-tab";
      button.dataset.editorTab = tab.id;
      button.setAttribute?.("role", "tab");
      button.setAttribute?.("aria-pressed", tab.id === currentTab ? "true" : "false");
      button.textContent = tab.label;
      button.addEventListener("click", () => selectTab(tab.id));
      frameEditorTabs.append(button);
    }
  }

  function applyPanes(frame) {
    const showPanel = currentTab.startsWith("panel-");
    if (frameEditorFrame) frameEditorFrame.hidden = currentTab !== "frame";
    if (frameDialogue) frameDialogue.hidden = currentTab !== "dialogue" || frame?.frameKind === "text";
    if (panelEditor) panelEditor.hidden = !showPanel || !(detailPanelControls?.children?.length);
    [...(detailPanelControls?.children || [])].forEach((section, index) => {
      section.hidden = !showPanel || index !== currentPanelIndex;
    });
    if (detailHost) detailHost.hidden = false;
    if (detailTitle) {
      detailTitle.hidden = false;
      detailTitle.textContent = "Редактор кадра";
    }
    if (detailFrameNumber) detailFrameNumber.hidden = false;
    if (detailOutside) detailOutside.hidden = false;
    if (closeDetail) closeDetail.hidden = false;
    if (detail) {
      detail.dataset.editorTab = currentTab;
      detail.dataset.view = "frame";
    }
  }

  function markFrameSelection() {
    for (const column of detailPanels()) {
      const classes = String(column.className || "").split(/\s+/).filter((name) => name && name !== "panel-selected");
      if (currentTab === `panel-${column.dataset?.panelIndex}`) classes.push("panel-selected");
      column.className = classes.join(" ");
    }
    const bar = detailHost?.querySelector?.(".dialogue-bar");
    if (!bar) return;
    const classes = String(bar.className || "").split(/\s+/).filter((name) => name && name !== "is-selected");
    if (currentTab === "dialogue") classes.push("is-selected");
    bar.className = classes.join(" ");
  }

  function selectTab(tab) {
    const frame = currentFrame();
    currentTab = editorTabFor(frame, tab);
    paintTabs(frame);
    applyPanes(frame);
    markFrameSelection();
  }

  function frameScale() {
    const column = detailHost?.parentElement;
    const width = Number(column?.clientWidth) || Number(detailHost?.clientWidth) || 0;
    const frameWidth = renderer.FRAME_GEOMETRY.width;
    if (width > 120 && frameWidth > 0) return Math.min(0.48, Math.max(0.16, (width - 2) / frameWidth));
    return 0.5;
  }

  function mountCurrentFrame(frame) {
    if (!detailHost || !frame) return;
    mountFrame(detailHost, previewFrame(frame), frameScale());
  }

  function fitOpenFrame() {
    if (!detail?.open) return;
    const frame = currentFrame();
    if (!frame || !detailHost) return;
    const scale = frameScale();
    const current = Number(detailHost.querySelector?.(".frame-stage")?.dataset?.frameScale);
    if (scale === 0.5 && !(Number(detailHost.parentElement?.clientWidth) > 120)) return;
    if (Number.isFinite(current) && Math.abs(current - scale) < 0.008) return;
    mountCurrentFrame(frame);
    bindFrameChrome(frame);
  }

  function watchFrameColumn() {
    const column = detailHost?.parentElement;
    if (!column || typeof ResizeObserver !== "function") return;
    if (!detailFrameObserver) detailFrameObserver = new ResizeObserver(() => fitOpenFrame());
    detailFrameObserver.disconnect?.();
    detailFrameObserver.observe(column);
  }

  function refreshPreview() {
    const frame = currentFrame();
    if (!detail?.open || !frame) return;
    mountCurrentFrame(frame);
    bindFrameChrome(frame);
  }

  function renderFrameStructure(frame) {
    if (!frameEditorFrame) return;
    frameEditorFrame.replaceChildren();
    if (!frame) return;
    const stored = Number.isInteger(frame.durationFrames) ? frame.durationFrames : 36;
    const resetFrames = defaultDurationFrames(typedDialogue(frame));
    const heading = document.createElement("h3");
    heading.textContent = "Длительность";
    const grid = document.createElement("div");
    grid.className = "frame-editor-duration";
    const secondsField = document.createElement("label");
    secondsField.className = "inspector-field";
    const seconds = document.createElement("input");
    seconds.id = "frame-duration-seconds";
    seconds.type = "number";
    seconds.min = "0.01";
    seconds.step = "any";
    seconds.value = formatSeconds(stored / 30);
    seconds.setAttribute?.("aria-label", "Длительность в секундах");
    const secondsLabel = document.createElement("span");
    secondsLabel.textContent = "Секунды";
    secondsField.append(secondsLabel, seconds);
    const framesField = document.createElement("label");
    framesField.className = "inspector-field";
    const framesInput = document.createElement("input");
    framesInput.id = "frame-duration-frames";
    framesInput.type = "number";
    framesInput.min = "1";
    framesInput.step = "1";
    framesInput.value = String(stored);
    framesInput.setAttribute?.("aria-label", "Длительность в кадрах");
    const framesLabel = document.createElement("span");
    framesLabel.textContent = "Кадры";
    framesField.append(framesLabel, framesInput);
    grid.append(secondsField, framesField);
    const rate = document.createElement("p");
    rate.className = "helper";
    rate.textContent = "30 кадр/с";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.dataset.frameAction = "reset-duration";
    reset.textContent = `Сбросить длительность · ${formatSeconds(resetFrames / 30)} с`;
    const syncSeconds = () => {
      const count = Math.round(Number(seconds.value) * 30);
      if (Number.isInteger(count) && count > 0) framesInput.value = String(count);
    };
    const syncFrames = () => {
      const count = Number(framesInput.value);
      if (Number.isInteger(count) && count > 0) seconds.value = formatSeconds(count / 30);
    };
    const commit = (count) => {
      const current = currentFrame();
      if (!current || !Number.isInteger(count) || count <= 0) return;
      runAssembly({
        op: "setDuration",
        ...frameAddress(current),
        durationFrames: count,
      }, "Сохраняю длительность…", { submittedText: String(count), frame: current });
    };
    seconds.addEventListener("input", syncSeconds);
    framesInput.addEventListener("input", syncFrames);
    seconds.addEventListener("change", () => {
      syncSeconds();
      commit(Number(framesInput.value));
    });
    framesInput.addEventListener("change", () => {
      syncFrames();
      commit(Number(framesInput.value));
    });
    reset.addEventListener("click", () => {
      const current = currentFrame();
      if (!current) return;
      const next = defaultDurationFrames(typedDialogue(current));
      framesInput.value = String(next);
      seconds.value = formatSeconds(next / 30);
      commit(next);
    });
    frameEditorFrame.append(heading, grid, rate, reset);
    if (frame.frameKind === "text") return;
    const structure = document.createElement("div");
    structure.className = "frame-structure-actions";
    const panels = frame.panels || [];
    if (panels.length < 2) {
      const add = document.createElement("button");
      add.type = "button";
      add.dataset.frameAction = "add-panel";
      add.textContent = "Добавить панель";
      add.addEventListener("click", () => {
        const current = currentFrame();
        if (current) runAssembly({ op: "addPanel", ...frameAddress(current) }, "Добавляю панель…", { frame: current });
      });
      structure.append(add);
    }
    if (panels.length === 2) {
      const swap = document.createElement("button");
      swap.type = "button";
      swap.dataset.frameAction = "swap-panels";
      swap.textContent = "Поменять панели местами";
      swap.addEventListener("click", () => {
        const current = currentFrame();
        const ids = current?.panels || [];
        if (!current || ids.length < 2) return;
        runAssembly({
          op: "reorderPanels",
          ...frameAddress(current),
          panelIds: [ids[1].id, ids[0].id],
        }, "Меняю панели местами…", { frame: current });
      });
      structure.append(swap);
      panels.forEach((panel, panelIndex) => {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.frameAction = "delete-panel";
        remove.dataset.panelIndex = String(panelIndex);
        remove.textContent = `Удалить панель ${panelIndex + 1}`;
        remove.addEventListener("click", () => {
          const current = currentFrame();
          const target = current?.panels?.[panelIndex];
          if (current && target) deletePanel(current, target, panelIndex);
        });
        structure.append(remove);
      });
    }
    frameEditorFrame.append(structure);
  }

  function placeScroll(top) {
    if (detailScroll) detailScroll.scrollTop = top > 0 ? top : 0;
  }

  function hideLeaveModal() {
    pendingLeave = null;
    if (frameEditorLeave) frameEditorLeave.hidden = true;
  }

  function requestLeave(action) {
    const frame = currentFrame();
    if (!dialogueDirty(frame)) {
      if (dialogueDraft?.key === frameDraftKey(frame)) dialogueDraft = null;
      action();
      return;
    }
    pendingLeave = action;
    if (frameEditorLeave) frameEditorLeave.hidden = false;
    frameEditorLeaveSave?.focus?.();
  }

  function open(index, { panelIndex = null, tab = null } = {}) {
    const frame = frames()[index];
    if (!frame) return;
    const wasOpen = Boolean(detail?.open);
    const preservedScroll = Number(detailScroll?.scrollTop) || 0;
    const structureId = frame.structureFrameId || frame.id;
    const segmentIndex = Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : null;
    const sameFrame = wasOpen && currentStructureId === structureId && currentSegmentIndex === segmentIndex;
    if (sameFrame) {
      const current = dialogueFormSnapshot();
      const edited = Boolean(renderedDialogue && current.mode && !dialogueSnapshotsMatch(current, renderedDialogue));
      dialogueDraft = edited ? { key: frameDraftKey(currentFrame()), ...current } : null;
    } else dialogueDraft = null;
    let requested = sameFrame ? currentTab : "frame";
    if (typeof tab === "string" && tab) requested = tab;
    if (Number.isInteger(panelIndex)) requested = `panel-${panelIndex}`;
    currentTab = editorTabFor(frame, requested);
    currentIndex = index;
    currentStructureId = structureId;
    currentSegmentIndex = segmentIndex;
    setSelection?.(index);
    markSelectedCards?.();
    renderInspector?.();
    if (detailFrameNumber) detailFrameNumber.textContent = `Кадр ${index + 1}`;
    if (detailOutside) detailOutside.textContent = frame.outsideFrameText || "";
    if (detailRetained) {
      detailRetained.hidden = !frame.retainedImageNotice;
      detailRetained.textContent = frame.retainedImageNotice || "";
    }
    prepareUtteranceEditor?.();
    renderDialogue(frame);
    renderFrameStructure(frame);
    mountCurrentFrame(frame);
    renderPanelControls?.(frame);
    syncNavigation();
    placeUndo(true);
    enterDetail?.();
    if (!detail?.open) detail?.showModal?.();
    watchFrameColumn();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => fitOpenFrame()));
    } else fitOpenFrame();
    placeScroll(wasOpen && sameFrame ? preservedScroll : 0);
  }

  function selectPanel(panelIndex) {
    selectTab(`panel-${panelIndex}`);
  }

  function finishPanelRender(frame) {
    const panelCount = (frame?.panels || []).length;
    if (!Number.isInteger(currentPanelIndex) || currentPanelIndex < 0 || currentPanelIndex >= panelCount) {
      currentPanelIndex = 0;
    }
    paintTabs(frame);
    applyPanes(frame);
    bindFrameChrome(frame);
  }

  function handleCancel(event) {
    if (frameEditorLeave && !frameEditorLeave.hidden) {
      event?.preventDefault?.();
      hideLeaveModal();
      return true;
    }
    if (dialogueDirty(currentFrame())) {
      event?.preventDefault?.();
      requestLeave(() => detail?.close?.());
      return true;
    }
    return false;
  }

  function handleClose() {
    currentTab = "frame";
    dialogueDraft = null;
    hideLeaveModal();
    placeUndo(false);
    leaveDetail?.();
  }

  function syncUndo(next) {
    if (!globalUndo) return;
    const available = Boolean(next?.canUndo);
    globalUndo.hidden = !next || next.status !== "ready";
    globalUndo.disabled = !available;
    globalUndo.textContent = available && next.undoLabel
      ? `Отменить: ${next.undoLabel}`
      : "Нечего отменять";
  }

  function reconcile() {
    if (!detail?.open || !currentStructureId) return;
    const nextIndex = frames().findIndex((frame) => {
      if ((frame.structureFrameId || frame.id) !== currentStructureId) return false;
      const segment = Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : null;
      return segment === currentSegmentIndex;
    });
    if (nextIndex < 0) detail.close();
    else open(nextIndex, currentTab.startsWith("panel-") ? { panelIndex: currentPanelIndex } : { tab: currentTab });
  }

  function placementOf(panel) {
    const defaults = renderer.PLACEMENT_DEFAULTS;
    const parsed = typeof panel?.position === "string"
      ? panel.position.match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/)
      : null;
    return {
      zoom: Number.isFinite(Number(panel?.zoom)) ? Number(panel.zoom) : defaults.zoom,
      positionX: Number.isFinite(Number(panel?.positionX)) ? Number(panel.positionX) : (parsed ? Number(parsed[1]) : defaults.positionX),
      positionY: Number.isFinite(Number(panel?.positionY)) ? Number(panel.positionY) : (parsed ? Number(parsed[2]) : defaults.positionY),
      mirrored: panel?.mirrored === true,
    };
  }

  function rememberPlacement(panel, value) {
    panel.zoom = value.zoom;
    panel.positionX = value.positionX;
    panel.positionY = value.positionY;
    panel.mirrored = value.mirrored === true;
    panel.position = `${value.positionX}% ${value.positionY}%`;
    panel.align = panel.position;
  }

  function applyRendition(image, value) {
    if (!image?.style) return;
    const position = `${value.positionX}% ${value.positionY}%`;
    image.style.objectPosition = position;
    image.style.transformOrigin = position;
    image.style.transform = renderer.renditionTransform(value);
  }

  function applyPanelRendition(panelIndex, value) {
    applyRendition(panelImage(panelIndex), value);
    const section = detailPanelControls?.children?.[panelIndex];
    const current = section?.querySelector?.(".revision-current")?.querySelector?.("img");
    if (current) applyRendition(current, value);
  }

  function placementReadout(panelIndex) {
    const section = detailPanelControls?.children?.[panelIndex];
    if (!section) return null;
    const found = section.querySelector?.("[data-placement-readout]");
    if (found) return found;
    const stack = [...(section.children || [])];
    while (stack.length) {
      const node = stack.shift();
      if (node?.dataset?.placementReadout != null) return node;
      if (node?.children?.length) stack.push(...node.children);
    }
    return null;
  }

  function placementCopy(value) {
    return `Приближение без генерации · ${Number(value.zoom).toFixed(2)}× · ${value.positionX} / ${value.positionY}`;
  }

  function updatePlacementCopy(panelIndex, value) {
    const copy = placementReadout(panelIndex);
    if (copy) copy.textContent = placementCopy(value);
    const section = detailPanelControls?.children?.[panelIndex];
    const mirror = [...(section?.querySelectorAll?.("button") || section?.children || [])]
      .find((node) => node?.dataset?.placementAction === "mirror");
    if (mirror) {
      const on = value.mirrored === true;
      mirror.textContent = on ? "Отражено по горизонтали" : "Отразить по горизонтали";
      mirror.setAttribute?.("aria-pressed", on ? "true" : "false");
    }
  }

  function restorePlacement(panel, panelIndex, value) {
    rememberPlacement(panel, value);
    applyPanelRendition(panelIndex, value);
    const section = detailPanelControls?.children?.[panelIndex];
    const zoom = [...(section?.querySelectorAll?.("input") || [])].find((input) => input.type === "range");
    if (zoom) zoom.value = String(value.zoom);
    updatePlacementCopy(panelIndex, value);
  }

  function frameScaleOf(node) {
    let current = node;
    while (current) {
      const scale = Number(current.dataset?.frameScale);
      if (Number.isFinite(scale) && scale > 0) return scale;
      current = current.parentNode;
    }
    return 1;
  }

  function bindPan(frame) {
    const columns = [...detailPanels(), ...(detailPanelControls?.querySelectorAll?.(".revision-current") || [])];
    for (const column of columns) {
      const panelIndex = Number(column.dataset?.panelIndex);
      const panel = frame.panels?.[panelIndex];
      if (!panel?.assetId) continue;
      const image = column.querySelector?.(".panel-asset") || column.querySelector?.("img");
      if (!image) continue;
      if (!String(column.className || "").split(/\s+/).includes("panel-pannable")) {
        column.className = `${column.className || ""} panel-pannable`.trim();
      }
      let drag = null;
      const stop = (event, cancelled) => {
        if (!drag) return;
        const samePointer = event?.pointerId == null || drag.pointerId == null || event.pointerId === drag.pointerId;
        if (!samePointer && event?.type === "pointermove") return;
        if (!samePointer && event?.type !== "pointerup" && event?.type !== "pointercancel") return;
        const moved = drag.moved;
        drag = null;
        column.className = String(column.className || "").replace(/\bis-panning\b/g, "").replace(/\s+/g, " ").trim();
        column.releasePointerCapture?.(event?.pointerId);
        if (!moved || cancelled) return;
        commitPlacement?.(frame, panel, panelIndex, placementOf(panel), {
          busy: "Сохраняю кадрирование…",
          success: "Кадрирование сохранено без новой генерации.",
        }, () => restorePlacement(panel, panelIndex, panel.authoritativePlacement || placementOf(panel)));
      };
      column.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault?.();
        drag = { pointerId: event.pointerId, lastX: Number(event.clientX) || 0, lastY: Number(event.clientY) || 0, moved: false };
        if (!String(column.className || "").split(/\s+/).includes("is-panning")) {
          column.className = `${column.className || ""} is-panning`.trim();
        }
        column.setPointerCapture?.(event.pointerId);
      });
      column.addEventListener("pointermove", (event) => {
        if (!drag || (event.pointerId != null && drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
        const clientX = Number(event.clientX);
        const clientY = Number(event.clientY);
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
        const deltaX = clientX - drag.lastX;
        const deltaY = clientY - drag.lastY;
        if (deltaX === 0 && deltaY === 0) return;
        const current = placementOf(panel);
        const size = renderer.panelContentSize(frame.panels.length, renderer.dialogueRegionVisible(frame));
        const nextPan = renderer.panByPointer({
          positionX: current.positionX,
          positionY: current.positionY,
          deltaX,
          deltaY,
          frameScale: frameScaleOf(column),
          panelWidth: size.width,
          panelHeight: size.height,
          mirrored: current.mirrored,
        });
        if (!nextPan) return;
        drag.lastX = clientX;
        drag.lastY = clientY;
        drag.moved = true;
        const next = { ...current, ...nextPan };
        rememberPlacement(panel, next);
        applyPanelRendition(panelIndex, next);
        updatePlacementCopy(panelIndex, next);
      });
      column.addEventListener("pointerup", (event) => stop(event, false));
      column.addEventListener("pointercancel", (event) => {
        if (drag) restorePlacement(panel, panelIndex, panel.authoritativePlacement || placementOf(panel));
        stop(event, true);
      });
    }
  }

  function bindFrameChrome(frame) {
    bindPan(frame);
    for (const column of detailPanels()) {
      const panelIndex = Number(column.dataset?.panelIndex);
      if (Number.isInteger(panelIndex)) column.addEventListener("click", () => selectTab(`panel-${panelIndex}`));
    }
    detailHost?.querySelector?.(".dialogue-bar")?.addEventListener("click", () => selectTab("dialogue"));
    markFrameSelection();
  }

  function renderPlacementControls({ frame, panel, panelIndex, framingPart, textElement }) {
    if (!panel.assetId) {
      framingPart.append(textElement("p", "helper", "Кадрирование появится, когда у панели будет своё изображение."));
      return;
    }
    const initial = placementOf(panel);
    rememberPlacement(panel, initial);
    panel.authoritativePlacement = { ...initial };
    const zoomLabel = document.createElement("label");
    zoomLabel.className = "zoom-control";
    const zoomCopy = document.createElement("span");
    zoomCopy.dataset.placementReadout = "true";
    zoomCopy.textContent = placementCopy(initial);
    const zoom = document.createElement("input");
    zoom.type = "range";
    zoom.min = "1";
    zoom.max = "3";
    zoom.step = "0.05";
    zoom.value = String(initial.zoom);
    zoom.addEventListener("input", () => {
      const next = { ...placementOf(panel), zoom: Number(zoom.value) };
      rememberPlacement(panel, next);
      updatePlacementCopy(panelIndex, next);
      applyPanelRendition(panelIndex, next);
    });
    zoom.addEventListener("change", () => {
      const next = { ...placementOf(panel), zoom: Number(zoom.value) };
      rememberPlacement(panel, next);
      commitPlacement?.(frame, panel, panelIndex, next, {
        busy: "Сохраняю приближение…",
        success: "Приближение сохранено без новой генерации.",
      }, () => restorePlacement(panel, panelIndex, panel.authoritativePlacement || placementOf(panel)));
    });
    const actions = document.createElement("div");
    actions.className = "placement-actions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.dataset.placementAction = "reset";
    reset.dataset.panelIndex = String(panelIndex);
    reset.textContent = "Сбросить кадрирование";
    reset.addEventListener("click", () => {
      const defaults = { ...renderer.PLACEMENT_DEFAULTS };
      rememberPlacement(panel, defaults);
      applyPanelRendition(panelIndex, defaults);
      zoom.value = String(defaults.zoom);
      updatePlacementCopy(panelIndex, defaults);
      commitPlacement?.(frame, panel, panelIndex, { reset: true }, {
        busy: "Сбрасываю кадрирование…",
        success: "Кадрирование сброшено.",
      }, () => restorePlacement(panel, panelIndex, panel.authoritativePlacement || placementOf(panel)));
    });
    const mirror = document.createElement("button");
    mirror.type = "button";
    mirror.dataset.placementAction = "mirror";
    mirror.dataset.panelIndex = String(panelIndex);
    mirror.textContent = initial.mirrored ? "Отражено по горизонтали" : "Отразить по горизонтали";
    mirror.setAttribute?.("aria-pressed", initial.mirrored ? "true" : "false");
    mirror.addEventListener("click", () => {
      const current = placementOf(panel);
      const next = { ...current, mirrored: !current.mirrored };
      rememberPlacement(panel, next);
      applyPanelRendition(panelIndex, next);
      updatePlacementCopy(panelIndex, next);
      commitPlacement?.(frame, panel, panelIndex, next, {
        busy: "Сохраняю отражение…",
        success: "Отражение сохранено без новой генерации.",
      }, () => restorePlacement(panel, panelIndex, panel.authoritativePlacement || placementOf(panel)));
    });
    actions.append(reset, mirror);
    zoomLabel.append(zoomCopy, zoom);
    framingPart.append(
      zoomLabel,
      textElement("p", "helper panel-pan-hint", "Перетащите изображение в кадре выше, чтобы сдвинуть его."),
      actions,
    );
  }

  openLast?.addEventListener("click", () => open(frames().length - 1));
  closeDetail?.addEventListener("click", () => requestLeave(() => detail?.close?.()));
  prevFrame?.addEventListener("click", () => {
    if (currentIndex <= 0) return;
    requestLeave(() => open(currentIndex - 1, { tab: currentTab }));
  });
  nextFrame?.addEventListener("click", () => {
    if (currentIndex < 0 || currentIndex >= frames().length - 1) return;
    requestLeave(() => open(currentIndex + 1, { tab: currentTab }));
  });
  frameDialogue?.addEventListener("change", (event) => {
    const name = event.target?.name;
    if (name !== "frame-dialogue-mode" && name !== "frame-dialogue-speaker") return;
    const frame = currentFrame();
    showDialogueError("");
    syncDialogueFields(frame);
    syncSegmentedSelection(frameDialogue);
    refreshPreview();
  });
  frameDialogueText?.addEventListener("input", () => {
    showDialogueError("");
    refreshPreview();
  });
  frameEditorLeaveStay?.addEventListener("click", hideLeaveModal);
  frameEditorLeaveDiscard?.addEventListener("click", () => {
    const action = pendingLeave;
    dialogueDraft = null;
    const frame = currentFrame();
    hideLeaveModal();
    if (frame) {
      renderDialogue(frame);
      refreshPreview();
    }
    action?.();
  });
  frameEditorLeaveSave?.addEventListener("click", async () => {
    if (!pendingLeave) return;
    const frame = currentFrame();
    const action = pendingLeave;
    const ok = await saveCurrentDialogue(frame, selectedDialogueMode());
    if (!ok) {
      hideLeaveModal();
      selectTab("dialogue");
      return;
    }
    hideLeaveModal();
    action?.();
  });
  detail?.addEventListener("close", handleClose);
  globalUndo?.addEventListener("click", () => undo?.());

  return {
    open,
    selectPanel,
    selectTab,
    handleCancel,
    finishPanelRender,
    renderPlacementControls,
    refreshPreview,
    reconcile,
    syncUndo,
    placementOf,
    rememberPlacement,
    applyRendition,
    get index() { return currentIndex; },
    get panelIndex() { return currentPanelIndex; },
    get tab() { return currentTab; },
    get structureId() { return currentStructureId; },
    get segmentIndex() { return currentSegmentIndex; },
    setCurrentIndex(index) { currentIndex = Number.isInteger(index) ? index : -1; },
  };
}
