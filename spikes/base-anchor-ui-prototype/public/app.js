import {
  acceptDraft,
  cancelDelete,
  choosePath,
  confirmDelete,
  confirmDiscard,
  createState,
  dismissNotice,
  escapeKey,
  openCreate,
  openRefine,
  openReplace,
  redoCandidate,
  rejectSelectedFile,
  requestDelete,
  requestDismiss,
  requestGenerate,
  requestGenerateFromSource,
  resetEmpty,
  resolveGenerate,
  restoreSession,
  seedReadyAnchor,
  serializeSession,
  setInstruction,
  setSelectedImage,
  undoCandidate,
  undoDelete,
  view,
} from "./state.mjs";

const STORAGE_KEY = "base-anchor-ui-prototype/v1";
const MAX_FILE_BYTES = 12 * 1024 * 1024;

let state = loadState();
let pendingFocusId = "";
let generateLock = false;

const app = document.querySelector("#app");

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? restoreSession(JSON.parse(raw)) : createState();
  } catch {
    return createState();
  }
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSession(state)));
  } catch {
    // The accepted anchor remains in memory when sessionStorage is unavailable.
  }
}

function commit(next, options = {}) {
  const hadOverlay = Boolean(state.modal || state.notice);
  state = next;
  const hasOverlay = Boolean(state.modal || state.notice);
  if (options.restoreFocus || (hadOverlay && !hasOverlay)) pendingFocusId = state.focusRestoreId || "";
  persist();
  render();
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "inert") node.inert = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function button(props, label, onClick) {
  const node = el("button", { type: "button", ...props }, []);
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function figure(image, className) {
  return el("figure", { class: className }, [
    el("img", { src: image.dataUrl, alt: image.label }),
    el("figcaption", { text: image.label }),
  ]);
}

function renderBanner() {
  return el("p", {
    class: "banner",
    text: "Изолированный прототип базового образа. Рабочая страница storyboard не используется.",
  });
}

function renderCard(model) {
  const children = [
    el("p", { class: "eyebrow", text: "Персонаж" }),
    el("h1", { text: "Базовый образ" }),
  ];
  if (model.sessionUndo) {
    children.push(el("div", { class: "session-undo" }, [
      el("p", { text: model.sessionUndo.text }),
      button({ id: model.sessionUndo.id, class: "secondary" }, model.sessionUndo.label, () => {
        commit(undoDelete(state), { restoreFocus: true });
      }),
    ]));
  }
  if (!model.anchor) {
    children.push(el("div", { class: "empty-frame" }, [
      el("div", {}, [
        el("p", { class: "empty-title", text: "Принятого образа пока нет." }),
        el("p", { class: "empty-copy", text: "Создайте образ из готового anchor или из реальной фотографии." }),
      ]),
    ]));
  } else {
    const secondary = model.anchor.source ? figure(model.anchor.source, "source-card") : null;
    children.push(el("div", { class: model.anchor.source ? "stable-layout" : "" }, [
      el("div", { class: "stable-anchor" }, [
        el("img", { src: model.anchor.dataUrl, alt: model.anchor.label }),
        el("p", { class: "caption", text: model.anchor.label }),
        model.anchor.fixture ? el("p", { class: "fixture", text: model.anchor.fixture }) : null,
      ]),
      secondary,
    ]));
  }
  children.push(el("div", { class: "card-actions" }, model.actions.map((action) => button({
    id: action.id,
    class: action.tone === "primary" ? "primary" : action.tone === "destructive" ? "destructive" : "secondary",
  }, action.label, () => launch(action.action)))));
  return el("section", { class: "card", "aria-label": "Базовый образ" }, children);
}

function launch(action) {
  if (action === "create") commit(openCreate(state));
  if (action === "refine") commit(openRefine(state));
  if (action === "replace") commit(openReplace(state));
  if (action === "delete") commit(requestDelete(state));
}

function renderPreview(preview) {
  if (!preview?.dominant && !preview?.secondary?.length) return null;
  const secondary = preview.secondary?.length
    ? el("div", { class: "secondary-col" }, preview.secondary.map((image) => figure(image, "thumb")))
    : null;
  return el("div", { class: preview.secondary?.length ? "review" : "" }, [
    preview.dominant ? el("div", { class: "dominant" }, [
      el("img", { src: preview.dominant.dataUrl, alt: preview.dominant.label }),
      el("p", { class: "caption", text: preview.dominant.label }),
    ]) : null,
    secondary,
  ]);
}

function renderModal(modal, locked) {
  const body = el("div", { inert: locked }, [
    el("div", { class: "dialog-header" }, [
      el("h2", { id: "dialog-title", text: modal.title }),
      button({ class: "close", "aria-label": "Закрыть" }, "×", () => commit(requestDismiss(state))),
    ]),
    modal.preview?.note ? el("p", { class: "note", text: modal.preview.note }) : null,
    modal.paths.length ? el("div", { class: "path-list" }, modal.paths.map((path) => button({
      id: path.id,
      class: "choice",
    }, path.label, () => commit(choosePath(state, path.path))))) : null,
    modal.showFile ? fileField() : null,
    renderPreview(modal.preview),
    modal.position ? el("p", { class: "position", text: modal.position }) : null,
    modal.candidateOrigin ? el("p", { id: "candidate-origin", class: "candidate-origin", text: modal.candidateOrigin }) : null,
    modal.candidateCount ? el("div", { class: "variant-nav" }, [
      button({ id: "variant-undo", disabled: !modal.canUndo }, "Предыдущий вариант", () => commit(undoCandidate(state))),
      button({ id: "variant-redo", disabled: !modal.canRedo }, "Следующий вариант", () => commit(redoCandidate(state))),
    ]) : null,
    modal.showInstruction || modal.showGenerate ? el("div", { class: "generate-cluster" }, [
      modal.showInstruction ? instructionField(modal) : null,
      modal.basis ? el("p", { id: "generation-basis", class: "basis", text: modal.basis }) : null,
      modal.basisIdentity ? el("p", { id: "generation-basis-identity", class: "basis-identity", text: modal.basisIdentity }) : null,
      modal.showGenerate || modal.showGenerateFromSource ? el("div", { class: "generate-actions" }, [
        modal.showGenerate ? button({
          id: "generate",
          class: "primary",
          disabled: !modal.generateEnabled,
        }, modal.pending ? "Запрос к провайдеру…" : modal.generateLabel, () => onGenerate(requestGenerate)) : null,
        modal.showGenerateFromSource ? button({
          id: "generate-from-source",
          class: "secondary",
        }, modal.fromSourceLabel, () => onGenerate(requestGenerateFromSource)) : null,
      ]) : null,
    ]) : null,
    modal.pending ? el("p", { class: "status", "aria-live": "polite", text: "Идёт один запрос к провайдеру." }) : null,
    modal.error ? el("p", { class: "error", "aria-live": "polite", text: modal.error }) : null,
    el("div", { class: "dialog-actions" }, [
      button({ id: "draft-cancel", class: "secondary" }, "Отмена", () => commit(requestDismiss(state))),
      modal.step !== "choose" ? button({
        id: "draft-accept",
        class: "primary",
        disabled: !modal.acceptEnabled,
      }, "Принять", () => commit(acceptDraft(state), { restoreFocus: true })) : null,
    ]),
  ]);
  return body;
}

function fileField() {
  const input = el("input", {
    id: "draft-file",
    type: "file",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
  });
  input.addEventListener("change", onFile);
  return el("div", { class: "field" }, [
    el("label", { class: "file-label", for: "draft-file", text: "Файл JPEG, PNG или WebP" }),
    input,
  ]);
}

function instructionField(modal) {
  const area = el("textarea", {
    id: "draft-instruction",
    maxlength: "2000",
    placeholder: modal.instructionRequired ? "Что изменить в принятом образе" : "Необязательная инструкция",
  });
  area.value = modal.instruction;
  area.disabled = modal.pending;
  area.addEventListener("input", () => {
    commit(setInstruction(state, area.value));
  });
  const hint = modal.instructionRequired
    ? "Для первого варианта нужна инструкция."
    : "Инструкция необязательна. Пустой запрос всё равно создаёт следующий вариант на указанной основе.";
  return el("div", { class: "field" }, [
    el("label", { for: "draft-instruction", text: "Инструкция" }),
    area,
    el("p", { class: "hint", text: hint }),
  ]);
}

function renderNotice(notice) {
  const actions = [];
  if (notice.dismissLabel) {
    actions.push(button({ id: "notice-dismiss", class: "secondary" }, notice.dismissLabel, () => {
      if (notice.type === "delete") commit(cancelDelete(state), { restoreFocus: true });
      else commit(dismissNotice(state));
    }));
  }
  if (notice.confirmLabel) {
    actions.push(button({
      id: "notice-confirm",
      class: notice.type === "delete" ? "danger" : "secondary",
    }, notice.confirmLabel, () => {
      if (notice.type === "delete") commit(confirmDelete(state), { restoreFocus: true });
      if (notice.type === "discard") commit(confirmDiscard(state), { restoreFocus: true });
    }));
  }
  return el("div", { class: "notice", role: "alertdialog", "aria-labelledby": "notice-title" }, [
    el("h3", { id: "notice-title", text: notice.title }),
    el("p", { text: notice.text }),
    el("div", { class: "dialog-actions" }, actions),
  ]);
}

function renderOverlay(model) {
  const dialog = el("div", {
    class: "dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": model.modal ? "dialog-title" : "notice-title",
    "data-focus-root": "true",
  }, [
    model.modal ? renderModal(model.modal, Boolean(model.notice)) : null,
    model.notice ? renderNotice(model.notice) : null,
  ]);
  return el("div", { class: "overlay" }, [dialog]);
}

function renderPrototype(model) {
  return el("aside", { class: "prototype-shelf", "aria-label": "Управление прототипом" }, [
    el("p", { text: model.prototype.note }),
    el("div", { class: "prototype-actions" }, [
      button({ id: "proto-reset", disabled: !model.prototype.enabled }, model.prototype.resetLabel, () => {
        commit(resetEmpty(state));
      }),
      button({ id: "proto-seed", disabled: !model.prototype.enabled }, model.prototype.seedLabel, onSeed),
    ]),
  ]);
}

function render() {
  const active = document.activeElement;
  const activeId = active?.id || "";
  const selectionStart = active && "selectionStart" in active ? active.selectionStart : null;
  const selectionEnd = active && "selectionEnd" in active ? active.selectionEnd : null;
  const model = view(state);
  app.replaceChildren(el("div", { class: "shell" }, [
    renderBanner(),
    renderCard(model),
    renderPrototype(model),
    model.modal || model.notice ? renderOverlay(model) : null,
  ]));
  const dialog = document.querySelector("[data-focus-root]");
  if (dialog) {
    const kept = activeId ? dialog.querySelector(`#${CSS.escape(activeId)}`) : null;
    if (kept && !kept.closest("[inert]")) {
      kept.focus();
      if (selectionStart != null && kept.setSelectionRange) kept.setSelectionRange(selectionStart, selectionEnd);
    } else {
      focusFirst(dialog);
    }
    return;
  }
  if (pendingFocusId) {
    const target = document.getElementById(pendingFocusId) || document.querySelector(".card-actions button");
    target?.focus();
    pendingFocusId = "";
  }
}

function focusFirst(dialog) {
  const preferred = ["#notice-dismiss", "#path-ready", "#draft-instruction", "#draft-file"]
    .map((selector) => dialog.querySelector(selector))
    .find((node) => node && !node.disabled && !node.closest("[inert]"));
  if (preferred) {
    preferred.focus();
    return;
  }
  const item = [...dialog.querySelectorAll("button, textarea, input, a[href]")]
    .find((node) => !node.disabled && !node.closest("[inert]"));
  item?.focus();
}

function fileProblem(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  const typed = type === "image/jpeg" || type === "image/jpg" || type === "image/png" || type === "image/webp";
  const named = /\.(jpe?g|png|webp)$/.test(name);
  if (!typed && !(type === "" && named)) return "unsupported-file";
  if (file.size > MAX_FILE_BYTES) return "file-too-large";
  return "";
}

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function onFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    commit(setSelectedImage(state, null));
    return;
  }
  const problem = fileProblem(file);
  if (problem) {
    commit(rejectSelectedFile(state, problem));
    return;
  }
  try {
    const dataUrl = await readDataUrl(file);
    commit(setSelectedImage(state, { dataUrl, mime: file.type || "" }));
  } catch {
    commit(rejectSelectedFile(state, "unsupported-file"));
  }
}

async function onGenerate(request) {
  if (generateLock || state.modal?.pending) return;
  const next = request(state);
  if (!next.effect) {
    commit(next.state);
    return;
  }
  generateLock = true;
  const effect = next.effect;
  commit(next.state);
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(effect.body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const result = payload?.ok && typeof payload.imageDataUrl === "string"
      ? { ok: true, dataUrl: payload.imageDataUrl, requestId: effect.requestId }
      : { ok: false, kind: payload?.kind || "provider", requestId: effect.requestId };
    commit(resolveGenerate(state, result));
  } catch {
    commit(resolveGenerate(state, { ok: false, kind: "network", requestId: effect.requestId }));
  } finally {
    generateLock = false;
  }
}

async function onSeed() {
  if (state.modal || state.notice) return;
  const response = await fetch("/fixture/ready-anchor.png");
  if (!response.ok) return;
  const blob = await response.blob();
  const dataUrl = await readDataUrl(blob);
  commit(seedReadyAnchor(state, { dataUrl, mime: blob.type || "image/png" }));
}

function onKeyDown(event) {
  if (event.key === "Escape") {
    if (!state.modal && !state.notice) return;
    event.preventDefault();
    const next = escapeKey(state);
    const closed = Boolean(state.modal || state.notice) && !next.modal && !next.notice;
    commit(next, { restoreFocus: closed });
    return;
  }
  if (event.key !== "Tab") return;
  const dialog = document.querySelector("[data-focus-root]");
  if (!dialog) return;
  const items = [...dialog.querySelectorAll("button, textarea, input, a[href]")]
    .filter((node) => !node.disabled && !node.closest("[inert]"));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", onKeyDown);
render();
