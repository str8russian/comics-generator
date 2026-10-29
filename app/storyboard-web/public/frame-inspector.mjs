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
  let carryMetadata = false;
  if (panel.carryChoice) {
    const mode = el(document, "select", "inspector-select");
    mode.setAttribute?.("aria-label", "Что перенести с изображением");
    const imageOnly = el(document, "option", "", "Только изображение");
    imageOnly.value = "image";
    const withMetadata = el(document, "option", "", "Изображение, персонаж и описание");
    withMetadata.value = "metadata";
    mode.append(imageOnly, withMetadata);
    mode.addEventListener("change", () => {
      carryMetadata = mode.value === "metadata";
    });
    block.append(mode);
  }
  const choose = button(document, "Выбрать изображение…", (event, node) => actions.chooseAsset(panel.index, node, () => carryMetadata));
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
  root.append(headerSection(document, model, actions));
  if (!model.assembly) {
    root.append(el(document, "p", "helper", "Действия с кадром появятся, когда визуальная раскадровка загрузится."));
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
