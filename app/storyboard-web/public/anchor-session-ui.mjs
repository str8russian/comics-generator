import { createEmptyCommandTarget } from "./research-dock.mjs";
import {
  acceptDraft,
  acceptPayload,
  ANCHOR_CLIENT_DEADLINE_MS,
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
  resolveGenerate,
  setInstruction,
  setSelectedImage,
  undoCandidate,
  view,
} from "./anchor-session.mjs";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const IDENTITY_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

let session = null;
let deletedUndo = null;
let generateLock = false;
let generateAttempt = 0;
let host = null;

function timeoutError() {
  const error = new Error("timeout");
  error.name = "AbortError";
  error.kind = "timeout";
  return error;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "id") node.id = String(value);
    else if (key === "text") node.textContent = value;
    else if (key === "inert") node.inert = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function button(props, label, onClick) {
  const node = el("button", { type: "button", ...props });
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function acceptedAnchor(character) {
  if (!character?.approvedAssetUrl) return null;
  const provenance = character.anchorProvenance
    || (character.sourcePhoto ? "generated_from_source" : "uploaded_as_ready_anchor");
  return {
    id: character.approvedAnchorId,
    dataUrl: character.approvedAssetUrl,
    assetId: character.approvedAssetId,
    mime: "",
    provenance,
    source: character.sourcePhoto
      ? { dataUrl: character.sourcePhoto.assetUrl, assetId: character.sourcePhoto.assetId, mime: "" }
      : null,
    fixture: null,
  };
}

function withAccepted(character) {
  const anchor = acceptedAnchor(character);
  return anchor ? { ...createState(), anchor } : createState();
}

function launch(character, action) {
  if (session?.modal || session?.notice) return;
  const base = withAccepted(character);
  let next = base;
  if (action === "create") next = openCreate(base);
  if (action === "refine") next = openRefine(base);
  if (action === "replace") next = openReplace(base);
  if (action === "delete") next = requestDelete(base);
  if (next === base && action !== "delete") return;
  session = { characterName: character.name, character, state: next };
  render();
}

function cssName(name) {
  return encodeURIComponent(name);
}

function serverBody(effect, anchor) {
  const sourceIsData = String(effect.body.sourceImage || "").startsWith("data:");
  const anchorIsData = String(effect.body.anchorImage || "").startsWith("data:");
  return {
    basis: effect.body.basis,
    instruction: effect.body.instruction,
    sourceImage: sourceIsData ? effect.body.sourceImage : null,
    sourceAssetId: sourceIsData ? null : (anchor?.source?.assetId || null),
    anchorImage: effect.body.basis === "from-source" || !anchorIsData ? null : effect.body.anchorImage,
    anchorAssetId: effect.body.basis === "from-source" || anchorIsData ? null : (anchor?.assetId || null),
    previousImage: effect.body.basis === "selected" ? effect.body.previousImage : null,
  };
}

async function onGenerate(request, deps) {
  if (!session || generateLock || session.state.modal?.pending) return;
  const next = request(session.state);
  if (!next.effect) {
    session = { ...session, state: next.state };
    render();
    return;
  }
  generateLock = true;
  const attempt = ++generateAttempt;
  const effect = next.effect;
  const character = session.character;
  session = { ...session, state: next.state };
  render();
  const controller = new AbortController();
  const deadline = Number(deps.anchorClientTimeoutMs) > 0
    ? Number(deps.anchorClientTimeoutMs)
    : ANCHOR_CLIENT_DEADLINE_MS;
  const timer = setTimeout(() => controller.abort(), deadline);
  const current = () => attempt === generateAttempt && session?.state?.modal?.requestId === effect.requestId;
  const settle = (result) => {
    if (!current() || !session?.state?.modal?.pending) return;
    session = {
      ...session,
      state: resolveGenerate(session.state, { ...result, requestId: effect.requestId }),
    };
  };
  try {
    await deps.runProductResearchAction({
      semanticAction: "anchor_generate",
      submittedText: effect.body.instruction,
      commandTarget: createEmptyCommandTarget("character", { characterName: character.name }),
      contextOverrides: deps.characterActionContextOverrides(character, {
        anchorVersionId: character.approvedAnchorId ?? null,
        imageAssetId: character.approvedAssetId ?? null,
      }),
      busyMessage: `Создаю вариант для ${character.name}…`,
      async operation({ correlationId } = {}) {
        try {
          const payload = await new Promise((resolve, reject) => {
            const fail = () => reject(timeoutError());
            if (controller.signal.aborted) fail();
            else controller.signal.addEventListener("abort", fail, { once: true });
            const body = serverBody(effect, session.state.anchor);
            if (typeof correlationId === "string" && correlationId) body.correlationId = correlationId;
            Promise.resolve(deps.fetchJson(`/api/visual/characters/${encodeURIComponent(character.name)}/anchor-session`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            })).then((value) => {
              if (!current() || controller.signal.aborted) fail();
              else resolve(value);
            }, reject);
          });
          if (!current() || controller.signal.aborted) return payload;
          settle({ ok: true, dataUrl: payload.imageDataUrl });
          return payload;
        } catch (error) {
          const kind = error?.kind === "timeout" || error?.name === "AbortError" || controller.signal.aborted
            ? "timeout"
            : (error?.kind || "provider");
          settle({ ok: false, kind });
          throw error;
        }
      },
    });
  } catch (error) {
    const kind = error?.kind === "timeout" || error?.name === "AbortError" || controller.signal.aborted
      ? "timeout"
      : (error?.kind || "provider");
    settle({ ok: false, kind });
  } finally {
    clearTimeout(timer);
    if (attempt === generateAttempt) {
      generateLock = false;
      render();
    }
  }
}

async function onAccept(deps) {
  if (!session?.state.modal) return;
  const character = session.character;
  const payload = acceptPayload(session.state);
  if (!payload) return;
  const body = {
    provenance: payload.provenance,
    imageDataUrl: payload.imageDataUrl,
    instruction: payload.instruction,
  };
  if (payload.sourceImageDataUrl) body.sourceImageDataUrl = payload.sourceImageDataUrl;
  if (payload.sourceAssetId) body.sourceAssetId = payload.sourceAssetId;
  await deps.runProductResearchAction({
    semanticAction: "anchor_approve",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("character", { characterName: character.name }),
    contextOverrides: deps.characterActionContextOverrides(character, {}),
    busyMessage: `Принимаю образ ${character.name}…`,
    async operation() {
      const next = await deps.fetchJson(`/api/visual/characters/${encodeURIComponent(character.name)}/anchor-accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      session = null;
      deletedUndo = deletedUndo?.characterName === character.name ? null : deletedUndo;
      deps.applyVisual(next);
      return next;
    },
  });
}

async function onConfirmDelete(deps) {
  if (!session) return;
  const character = session.character;
  await deps.runProductResearchAction({
    semanticAction: "anchor_retire",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("character", { characterName: character.name }),
    contextOverrides: deps.characterActionContextOverrides(character, {
      anchorVersionId: character.approvedAnchorId ?? null,
    }),
    busyMessage: `Удаляю образ ${character.name}…`,
    async operation() {
      const next = await deps.fetchJson(`/api/visual/characters/${encodeURIComponent(character.name)}/anchor-retire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      deletedUndo = { characterName: character.name, anchorId: next.retiredAnchorId };
      session = null;
      deps.applyVisual(next);
      return next;
    },
  });
}

async function onRestore(character, deps) {
  if (!deletedUndo || deletedUndo.characterName !== character.name) return;
  await deps.runProductResearchAction({
    semanticAction: "anchor_restore",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("character", { characterName: character.name }),
    contextOverrides: deps.characterActionContextOverrides(character, { anchorVersionId: deletedUndo.anchorId }),
    busyMessage: `Возвращаю образ ${character.name}…`,
    async operation() {
      const next = await deps.fetchJson(
        `/api/visual/characters/${encodeURIComponent(character.name)}/anchors/${encodeURIComponent(deletedUndo.anchorId)}/restore`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      deletedUndo = null;
      deps.applyVisual(next);
      return next;
    },
  });
}

function fileKind(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (!IDENTITY_TYPES.has(type) && !(type === "" && /\.(jpe?g|png|webp)$/.test(name))) return "unsupported-file";
  if (file.size > MAX_FILE_BYTES) return "file-too-large";
  return "";
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("invalid-image"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function removeNode(node) {
  if (!node) return;
  if (typeof node.remove === "function") {
    node.remove();
    return;
  }
  const parent = node.parentNode;
  if (!parent?.children) return;
  const index = parent.children.indexOf(node);
  if (index >= 0) parent.children.splice(index, 1);
  node.parentNode = null;
}

function removeOverlay() {
  const node = document.getElementById?.("anchor-session-overlay")
    ?? document.body?.querySelector?.("#anchor-session-overlay");
  removeNode(node);
}

function byId(id) {
  if (!id) return null;
  if (typeof document.getElementById === "function") return document.getElementById(id);
  return document.body?.querySelector?.(`#${id}`) ?? null;
}

function launchDomId(focusRestoreId, name) {
  const action = String(focusRestoreId || "").replace(/^launch-/, "");
  if (!action || !name) return "";
  return `launch-${action}-${cssName(name)}`;
}

function finishClosed() {
  const launchId = launchDomId(session?.state?.focusRestoreId, session?.characterName);
  session = null;
  render();
  byId(launchId)?.focus?.();
}

function dismissDraft(triggerId) {
  const next = requestDismiss(session.state, triggerId);
  if (!next.modal && !next.notice) {
    finishClosed();
    return;
  }
  session = { ...session, state: next };
  render();
}

function renderModal(model, deps) {
  const modal = model.modal;
  const body = el("div", {}, [
    el("div", { class: "dialog-header" }, [
      el("h2", { id: "anchor-dialog-title", text: modal?.title || "" }),
      button({ id: "draft-close", class: "close", "aria-label": "Закрыть" }, "×", () => {
        dismissDraft("draft-close");
      }),
    ]),
    modal?.preview?.note ? el("p", { class: "note", text: modal.preview.note }) : null,
    modal?.paths?.length ? el("div", { class: "path-list" }, modal.paths.map((path) => button({
      id: path.id,
      class: "choice",
    }, path.label, () => {
      session = { ...session, state: choosePath(session.state, path.path) };
      render();
    }))) : null,
    modal?.showFile ? fileControl() : null,
    modal?.preview?.dominant ? el("div", { class: modal.preview.secondary?.length ? "anchor-review" : "" }, [
      el("figure", { class: "anchor-dominant" }, [
        el("img", { src: modal.preview.dominant.dataUrl, alt: modal.preview.dominant.label }),
        el("figcaption", { text: modal.preview.dominant.label }),
      ]),
      modal.preview.secondary?.length ? el("div", { class: "anchor-secondary" }, modal.preview.secondary.map((image) => el("figure", {}, [
        el("img", { src: image.dataUrl, alt: image.label }),
        el("figcaption", { text: image.label }),
      ]))) : null,
    ]) : null,
    modal?.position ? el("p", { class: "position", text: modal.position }) : null,
    modal?.candidateOrigin ? el("p", { id: "candidate-origin", class: "candidate-origin", text: modal.candidateOrigin }) : null,
    modal?.candidateCount ? el("div", { class: "variant-nav" }, [
      button({ id: "variant-undo", disabled: !modal.canUndo }, "Предыдущий вариант", () => {
        session = { ...session, state: undoCandidate(session.state) };
        render();
      }),
      button({ id: "variant-redo", disabled: !modal.canRedo }, "Следующий вариант", () => {
        session = { ...session, state: redoCandidate(session.state) };
        render();
      }),
    ]) : null,
    modal?.showInstruction ? instructionControl(modal) : null,
    modal?.instructionHint ? el("p", { id: "instruction-hint", class: "instruction-hint", text: modal.instructionHint }) : null,
    modal?.basis ? el("p", { id: "generation-basis", class: "basis", text: modal.basis }) : null,
    modal?.basisIdentity ? el("p", { class: "basis-identity", text: modal.basisIdentity }) : null,
    el("div", { class: "generate-actions" }, [
      modal?.showGenerate ? button({
        id: "generate",
        class: "primary",
        disabled: !modal.generateEnabled,
        "aria-describedby": modal.basis ? "generation-basis" : null,
      }, modal.pending ? "Запрос к провайдеру…" : modal.generateLabel, () => onGenerate(requestGenerate, deps)) : null,
      modal?.showGenerateFromSource ? button({
        id: "generate-from-source",
        class: "secondary",
        disabled: modal.pending,
      }, modal.fromSourceLabel, () => onGenerate(requestGenerateFromSource, deps)) : null,
    ]),
    modal?.error ? el("p", { class: "error", role: "status", text: modal.error }) : null,
    modal ? el("div", { class: "dialog-actions" }, [
      button({ id: "draft-cancel", class: "secondary" }, "Отмена", () => {
        dismissDraft("draft-cancel");
      }),
      modal.step !== "choose" ? button({
        id: "draft-accept",
        class: "primary",
        disabled: !modal.acceptEnabled,
      }, "Принять", () => onAccept(deps)) : null,
    ]) : null,
  ]);
  const dialog = modal ? el("div", {
    class: "anchor-dialog",
    role: "dialog",
    inert: Boolean(model.notice),
    "aria-modal": model.notice ? "false" : "true",
    "aria-labelledby": "anchor-dialog-title",
    "data-anchor-focus": "true",
  }, [body]) : null;
  return el("div", { class: "anchor-overlay" }, [
    dialog,
    confirmationLayer(model, deps),
  ]);
}

function confirmationLayer(model, deps) {
  const notice = model.notice;
  if (!notice) return null;
  return el("div", { class: "anchor-confirm-layer", "data-anchor-notice": "true" }, [
    el("div", { class: "anchor-confirm-scrim", "aria-hidden": "true" }),
    el("div", {
      class: "anchor-confirm",
      role: "alertdialog",
      "aria-modal": "true",
      "aria-labelledby": "anchor-notice-title",
      "aria-describedby": "anchor-notice-text",
    }, [
      el("h3", { id: "anchor-notice-title", text: notice.title }),
      el("p", { id: "anchor-notice-text", text: notice.text }),
      el("div", { class: "dialog-actions" }, [
        notice.dismissLabel ? button({ id: "notice-dismiss", class: "secondary" }, notice.dismissLabel, () => {
          if (notice.type === "delete") {
            session = { ...session, state: cancelDelete(session.state) };
            if (!session.state.notice) session = null;
            render();
            return;
          }
          const triggerId = session.state.notice?.triggerId || "draft-close";
          session = { ...session, state: dismissNotice(session.state) };
          render(triggerId);
        }) : null,
        notice.confirmLabel ? button({
          id: "notice-confirm",
          class: notice.type === "delete" ? "danger" : "secondary",
        }, notice.confirmLabel, () => {
          if (notice.type === "delete") onConfirmDelete(deps);
          if (notice.type === "discard") finishClosed();
        }) : null,
      ]),
    ]),
  ]);
}

function fileControl() {
  const input = el("input", {
    id: "draft-file",
    type: "file",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file || !session) return;
    const problem = fileKind(file);
    if (problem) {
      session = { ...session, state: rejectSelectedFile(session.state, problem) };
      render();
      return;
    }
    const dataUrl = await readDataUrl(file);
    if (!session) return;
    session = { ...session, state: setSelectedImage(session.state, { dataUrl, mime: file.type || "" }) };
    render();
  });
  return el("div", { class: "field" }, [
    el("label", { for: "draft-file", text: "Файл JPEG, PNG или WebP" }),
    input,
  ]);
}

function instructionControl(modal) {
  const area = el("textarea", { id: "draft-instruction", maxlength: "2000" });
  area.value = modal.instruction;
  area.disabled = modal.pending;
  area.addEventListener("input", () => {
    if (!session) return;
    session = { ...session, state: setInstruction(session.state, area.value) };
    render();
  });
  return el("div", { class: "field" }, [
    el("label", { for: "draft-instruction", text: "Инструкция" }),
    area,
  ]);
}

function renderCards(characters, deps) {
  host.replaceChildren();
  for (const character of characters) {
    const accepted = acceptedAnchor(character);
    const card = el("article", { class: "character-card" }, [
      el("div", { class: "character-heading" }, [
        el("h3", { text: character.name }),
        el("span", { class: "status-badge", text: accepted ? "Образ утверждён" : "Нужен образ" }),
      ]),
    ]);
    if (deletedUndo?.characterName === character.name && !accepted) {
      card.append(el("div", { class: "session-undo" }, [
        el("p", { text: "Образ удалён." }),
        button({ class: "secondary" }, "Вернуть образ", () => onRestore(character, deps)),
      ]));
    }
    if (!accepted) {
      card.append(el("div", { class: "empty-frame" }, [
        el("p", { text: "Принятого изображения пока нет." }),
      ]));
    } else {
      const row = el("div", { class: accepted.source ? "stable-layout" : "" }, [
        el("figure", { class: "stable-anchor" }, [
          el("img", { src: accepted.dataUrl, alt: accepted.provenance === "uploaded_as_ready_anchor" ? "Загружен как готовый anchor" : "Принятый образ" }),
          el("figcaption", {
            text: accepted.provenance === "uploaded_as_ready_anchor"
              ? "Загружен как готовый anchor"
              : (accepted.provenance === "refined_from_accepted_anchor" ? "Уточнён по принятому образу" : "Сгенерирован по исходному фото"),
          }),
        ]),
        accepted.source ? el("figure", { class: "source-card" }, [
          el("img", { src: accepted.source.dataUrl, alt: "Исходное фото" }),
          el("figcaption", { text: "Исходное фото" }),
        ]) : null,
      ]);
      card.append(row);
    }
    const actions = accepted
      ? [
        ["refine", "Уточнить образ", "secondary"],
        ["replace", "Создать замену", "secondary"],
        ["delete", "Удалить", "destructive"],
      ]
      : [["create", "Создать изображение", "primary"]];
    card.append(el("div", { class: "card-actions" }, actions.map(([action, label, tone]) => button({
      id: `launch-${action}-${cssName(character.name)}`,
      class: tone,
      disabled: Boolean(session),
    }, label, () => launch(character, action)))));
    host.append(card);
  }
}

function confirmationControls() {
  const layer = document.querySelector?.("[data-anchor-notice]");
  if (!layer?.querySelectorAll) return [];
  return [...layer.querySelectorAll("button")].filter((node) => !node.disabled);
}

function onKeyDown(event) {
  if (!session) return;
  if (event.key === "Tab" && session.state.notice) {
    const controls = confirmationControls();
    if (!controls.length) return;
    event.preventDefault();
    const current = controls.indexOf(document.activeElement);
    const delta = event.shiftKey ? -1 : 1;
    const next = controls[(current + delta + controls.length) % controls.length];
    next?.focus?.();
    return;
  }
  if (event.key !== "Escape") return;
  event.preventDefault();
  const notice = session.state.notice;
  const returning = notice?.type === "discard" || notice?.type === "pending";
  const returnId = notice?.triggerId || "draft-close";
  const triggerId = document.activeElement?.id === "draft-cancel" ? "draft-cancel" : "draft-close";
  const next = escapeKey(session.state, triggerId);
  if (!next.modal && !next.notice) {
    finishClosed();
    return;
  }
  session = { ...session, state: next };
  render(returning ? returnId : "");
}

let listening = false;

let currentDeps = null;

function render(focusId = "") {
  if (!host || !currentDeps) return;
  const active = document.activeElement;
  const activeId = active?.id || "";
  const selectionStart = active && "selectionStart" in active ? active.selectionStart : null;
  const selectionEnd = active && "selectionEnd" in active ? active.selectionEnd : null;
  const previousScroll = document.querySelector?.(".anchor-dialog")?.scrollTop || 0;
  renderCards(currentDeps.characters || [], currentDeps);
  removeOverlay();
  if (session?.state && (session.state.modal || session.state.notice) && document.body && typeof document.body.append === "function") {
    const overlay = renderModal(view(session.state), currentDeps);
    overlay.id = "anchor-session-overlay";
    document.body.append(overlay);
    const scrolled = document.querySelector(".anchor-dialog");
    if (scrolled && previousScroll) scrolled.scrollTop = previousScroll;
  }
  if (typeof document.querySelector !== "function") return;
  const noticeLayer = document.querySelector("[data-anchor-notice]");
  if (noticeLayer) {
    (noticeLayer.querySelector("#notice-dismiss") || noticeLayer.querySelector("button"))?.focus?.();
    return;
  }
  if (focusId) {
    const target = byId(focusId);
    if (target) {
      target.focus?.();
      return;
    }
  }
  const dialog = document.querySelector("[data-anchor-focus]");
  if (!dialog) return;
  const escapedId = activeId && globalThis.CSS?.escape ? CSS.escape(activeId) : activeId;
  const kept = escapedId ? dialog.querySelector(`#${escapedId}`) : null;
  if (kept) {
    kept.focus?.();
    if (selectionStart != null && kept.setSelectionRange) kept.setSelectionRange(selectionStart, selectionEnd);
    return;
  }
  dialog.querySelector("#path-ready, #draft-instruction, #draft-file, button")?.focus?.();
}

export function renderAnchorWorkspace(deps) {
  host = deps.root;
  currentDeps = deps;
  if (!listening && typeof document.addEventListener === "function") {
    document.addEventListener("keydown", onKeyDown);
    listening = true;
  }
  render();
}
