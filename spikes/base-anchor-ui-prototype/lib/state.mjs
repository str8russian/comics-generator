export const PROVENANCE = Object.freeze({
  generatedFromSource: "generated_from_source",
  uploadedAsReadyAnchor: "uploaded_as_ready_anchor",
  seededRepositoryAnchor: "seeded_repository_anchor",
  refinedFromAcceptedAnchor: "refined_from_accepted_anchor",
});

export const LABELS = Object.freeze({
  create: "Создать образ",
  refine: "Уточнить образ",
  replace: "Создать замену",
  delete: "Удалить",
  uploadReady: "Загрузить готовый anchor",
  fromPhoto: "Создать по реальному фото",
  uploadedCaption: "Загружен как готовый anchor",
  sourcePhoto: "Исходное фото",
  generate: "Сгенерировать",
  another: "Создать ещё вариант",
  accept: "Принять",
  cancel: "Отмена",
  close: "Закрыть",
  generatedVariant: "Сгенерированный вариант",
  currentAnchor: "Текущий принятый образ",
  generatedCaption: "Сгенерирован по исходному фото",
  seededCaption: "Готовый anchor из фикстуры репозитория",
  refinedCaption: "Уточнён по принятому образу",
  undoVariant: "Предыдущий вариант",
  redoVariant: "Следующий вариант",
  sessionUndo: "Вернуть образ",
  reset: "Сбросить: нет anchor",
  seed: "Засеять готовый anchor",
  prototypeNote: "Только прототип. Не входит в интерфейс продукта.",
});

const LAUNCH_IDS = Object.freeze({
  create: "launch-create",
  refine: "launch-refine",
  replace: "launch-replace",
  delete: "launch-delete",
});

const PROVENANCE_SET = new Set(Object.values(PROVENANCE));
const KNOWN_ERRORS = new Set([
  "instruction-required",
  "source-required",
  "unsupported-file",
  "file-too-large",
  "provider",
  "timeout",
  "invalid-output",
  "provider-payload-too-large",
  "reference-payload-too-large",
  "echoed-source",
  "configuration",
  "invalid-request",
  "busy",
  "network",
]);

let anchorSequence = 0;

export function createState() {
  return {
    anchor: null,
    deleteUndo: null,
    modal: null,
    notice: null,
    focusRestoreId: null,
  };
}

function cloneImage(image) {
  if (!image || typeof image.dataUrl !== "string" || !image.dataUrl) return null;
  return { dataUrl: image.dataUrl, mime: typeof image.mime === "string" ? image.mime : "" };
}

function cloneAnchor(anchor) {
  const normalized = normalizeAnchor(anchor);
  if (!normalized) return null;
  return { ...normalized, source: normalized.source ? { ...normalized.source } : null };
}

function normalizeAnchor(anchor) {
  if (!anchor || typeof anchor.dataUrl !== "string" || !anchor.dataUrl) return null;
  if (!PROVENANCE_SET.has(anchor.provenance)) return null;
  const source = cloneImage(anchor.source);
  if (anchor.provenance === PROVENANCE.generatedFromSource) {
    if (!source) return null;
    return {
      id: String(anchor.id || "restored"),
      dataUrl: anchor.dataUrl,
      mime: typeof anchor.mime === "string" ? anchor.mime : "",
      provenance: anchor.provenance,
      source,
      fixture: null,
    };
  }
  return {
    id: String(anchor.id || "restored"),
    dataUrl: anchor.dataUrl,
    mime: typeof anchor.mime === "string" ? anchor.mime : "",
    provenance: anchor.provenance,
    source: null,
    fixture: typeof anchor.fixture === "string" ? anchor.fixture : null,
  };
}

export function serializeSession(state) {
  return {
    anchor: cloneAnchor(state?.anchor),
    deleteUndo: state?.deleteUndo?.anchor ? { anchor: cloneAnchor(state.deleteUndo.anchor) } : null,
  };
}

export function restoreSession(saved) {
  const next = createState();
  if (!saved || typeof saved !== "object") return next;
  next.anchor = cloneAnchor(saved.anchor);
  const undone = cloneAnchor(saved.deleteUndo?.anchor);
  next.deleteUndo = undone ? { anchor: undone } : null;
  return next;
}

function nextAnchorId() {
  anchorSequence += 1;
  return `anchor-${anchorSequence}`;
}

function blankModal(operation, extra = {}) {
  return {
    operation,
    step: operation === "refine" ? "refine" : "choose",
    source: null,
    anchorImage: null,
    preservedAnchor: null,
    instruction: "",
    candidates: [],
    index: -1,
    pending: false,
    error: null,
    requestId: 0,
    ...extra,
  };
}

function blocked(state) {
  return Boolean(state.modal || state.notice);
}

export function openCreate(state) {
  if (state.anchor || blocked(state)) return state;
  return {
    ...state,
    focusRestoreId: LAUNCH_IDS.create,
    modal: blankModal("create"),
  };
}

export function openReplace(state) {
  if (!state.anchor || blocked(state)) return state;
  return {
    ...state,
    focusRestoreId: LAUNCH_IDS.replace,
    modal: blankModal("replace", { preservedAnchor: cloneAnchor(state.anchor) }),
  };
}

export function openRefine(state) {
  if (!state.anchor || blocked(state)) return state;
  return {
    ...state,
    focusRestoreId: LAUNCH_IDS.refine,
    modal: blankModal("refine", {
      source: cloneImage(state.anchor.source),
      anchorImage: state.anchor.dataUrl,
      preservedAnchor: cloneAnchor(state.anchor),
    }),
  };
}

export function choosePath(state, path) {
  const modal = state.modal;
  if (!modal || state.notice || modal.pending || modal.step !== "choose") return state;
  if (path !== "ready" && path !== "photo") return state;
  return { ...state, modal: { ...modal, step: path, error: null } };
}

export function setSelectedImage(state, image) {
  const modal = state.modal;
  if (!modal || state.notice || modal.pending) return state;
  if (modal.step !== "ready" && modal.step !== "photo") return state;
  if (image && (typeof image.dataUrl !== "string" || !image.dataUrl)) return state;
  return {
    ...state,
    modal: {
      ...modal,
      source: image ? { dataUrl: image.dataUrl, mime: image.mime || "" } : null,
      error: null,
    },
  };
}

export function rejectSelectedFile(state, reason = "unsupported-file") {
  const modal = state.modal;
  if (!modal || state.notice || modal.pending) return state;
  if (modal.step !== "ready" && modal.step !== "photo") return state;
  return { ...state, modal: { ...modal, source: null, error: reason } };
}

export function setInstruction(state, instruction) {
  const modal = state.modal;
  if (!modal || state.notice || modal.pending) return state;
  if (modal.step !== "photo" && modal.step !== "refine") return state;
  const text = String(instruction ?? "").slice(0, 2000);
  return {
    ...state,
    modal: {
      ...modal,
      instruction: text,
      error: modal.error === "instruction-required" ? null : modal.error,
    },
  };
}

function selectedCandidate(modal) {
  if (!modal || modal.index < 0) return null;
  return modal.candidates[modal.index] ?? null;
}

function canRequest(modal) {
  if (!modal || modal.pending) return false;
  if (modal.step === "photo") return Boolean(modal.source?.dataUrl);
  if (modal.step === "refine") {
    if (!modal.anchorImage) return false;
    if (modal.candidates.length === 0) return Boolean(modal.instruction.trim());
    return true;
  }
  return false;
}

export function requestGenerate(state) {
  const modal = state.modal;
  if (!modal) return { state, effect: null, blocked: "closed" };
  if (state.notice) return { state, effect: null, blocked: "notice" };
  if (modal.pending) return { state, effect: null, blocked: "pending" };
  if (modal.step !== "photo" && modal.step !== "refine") {
    return { state, effect: null, blocked: "not-generative" };
  }
  if (!canRequest(modal)) {
    const error = modal.step === "refine" && modal.candidates.length === 0
      ? "instruction-required"
      : "source-required";
    return {
      state: { ...state, modal: { ...modal, error } },
      effect: null,
      blocked: error,
    };
  }
  const requestId = modal.requestId + 1;
  const previous = selectedCandidate(modal);
  const body = modal.step === "photo"
    ? {
      operation: "from-source",
      instruction: modal.instruction.trim(),
      sourceImage: modal.source.dataUrl,
      anchorImage: null,
      previousImage: previous?.dataUrl ?? null,
    }
    : {
      operation: "refine",
      instruction: modal.instruction.trim(),
      sourceImage: modal.source?.dataUrl ?? null,
      anchorImage: modal.anchorImage,
      previousImage: previous?.dataUrl ?? null,
    };
  return {
    state: {
      ...state,
      modal: { ...modal, pending: true, error: null, requestId },
    },
    effect: { type: "generate", requestId, body },
    blocked: null,
  };
}

export function resolveGenerate(state, result) {
  const modal = state.modal;
  if (!modal?.pending) return state;
  if (!result || result.requestId !== modal.requestId) return state;
  const notice = state.notice?.type === "pending" ? null : state.notice;
  if (!result.ok || typeof result.dataUrl !== "string" || !result.dataUrl) {
    return {
      ...state,
      notice,
      modal: { ...modal, pending: false, error: result?.kind || "provider" },
    };
  }
  const echoesSource = modal.source?.dataUrl && result.dataUrl === modal.source.dataUrl;
  const echoesReady = modal.step === "ready" && echoesSource;
  if (echoesSource || echoesReady) {
    return {
      ...state,
      modal: { ...modal, pending: false, error: "echoed-source" },
    };
  }
  const candidate = {
    id: `candidate-${modal.candidates.length + 1}`,
    dataUrl: result.dataUrl,
  };
  const candidates = [...modal.candidates, candidate];
  return {
    ...state,
    notice,
    modal: {
      ...modal,
      pending: false,
      error: null,
      candidates,
      index: candidates.length - 1,
    },
  };
}

export function undoCandidate(state) {
  const modal = state.modal;
  if (!modal || modal.pending || modal.index <= 0) return state;
  return { ...state, modal: { ...modal, index: modal.index - 1 } };
}

export function redoCandidate(state) {
  const modal = state.modal;
  if (!modal || modal.pending || modal.index < 0 || modal.index >= modal.candidates.length - 1) return state;
  return { ...state, modal: { ...modal, index: modal.index + 1 } };
}

function closeModal(state) {
  return { ...state, modal: null, notice: null };
}

function isDirty(modal) {
  if (!modal) return false;
  if (modal.candidates.length > 0) return true;
  if (modal.instruction.trim()) return true;
  if ((modal.step === "ready" || modal.step === "photo") && modal.source?.dataUrl) return true;
  if (modal.error && modal.error !== "instruction-required" && modal.error !== "source-required") return true;
  return false;
}

export function requestDismiss(state) {
  if (state.notice?.type === "delete") return cancelDelete(state);
  const modal = state.modal;
  if (!modal) return state;
  if (modal.pending) return { ...state, notice: { type: "pending" } };
  if (isDirty(modal)) return { ...state, notice: { type: "discard" } };
  return closeModal(state);
}

export function confirmDiscard(state) {
  if (state.notice?.type !== "discard" || !state.modal || state.modal.pending) return state;
  return closeModal(state);
}

export function dismissNotice(state) {
  if (state.notice?.type === "discard" || state.notice?.type === "pending") {
    return { ...state, notice: null };
  }
  return state;
}

export function escapeKey(state) {
  if (state.notice?.type === "discard" || state.notice?.type === "pending") return dismissNotice(state);
  if (state.notice?.type === "delete") return cancelDelete(state);
  return requestDismiss(state);
}

export function acceptDraft(state) {
  const modal = state.modal;
  if (!modal || modal.pending || state.notice) return state;
  let anchor = null;
  if (modal.step === "ready") {
    if (!modal.source?.dataUrl) return state;
    anchor = {
      id: nextAnchorId(),
      dataUrl: modal.source.dataUrl,
      mime: modal.source.mime || "",
      provenance: PROVENANCE.uploadedAsReadyAnchor,
      source: null,
      fixture: null,
    };
  } else if (modal.step === "photo") {
    const candidate = selectedCandidate(modal);
    if (!candidate || !modal.source?.dataUrl) return state;
    anchor = {
      id: nextAnchorId(),
      dataUrl: candidate.dataUrl,
      mime: "",
      provenance: PROVENANCE.generatedFromSource,
      source: cloneImage(modal.source),
      fixture: null,
    };
  } else if (modal.step === "refine") {
    const candidate = selectedCandidate(modal);
    if (!candidate) return state;
    const source = cloneImage(modal.source);
    anchor = source
      ? {
        id: nextAnchorId(),
        dataUrl: candidate.dataUrl,
        mime: "",
        provenance: PROVENANCE.generatedFromSource,
        source,
        fixture: null,
      }
      : {
        id: nextAnchorId(),
        dataUrl: candidate.dataUrl,
        mime: "",
        provenance: PROVENANCE.refinedFromAcceptedAnchor,
        source: null,
        fixture: null,
      };
  } else {
    return state;
  }
  return {
    ...closeModal(state),
    anchor,
    deleteUndo: null,
  };
}

export function requestDelete(state) {
  if (!state.anchor || blocked(state)) return state;
  return { ...state, notice: { type: "delete" }, focusRestoreId: LAUNCH_IDS.delete };
}

export function confirmDelete(state) {
  if (state.notice?.type !== "delete" || !state.anchor || state.modal) return state;
  return {
    ...state,
    deleteUndo: { anchor: cloneAnchor(state.anchor) },
    anchor: null,
    notice: null,
    focusRestoreId: "session-undo",
  };
}

export function cancelDelete(state) {
  if (state.notice?.type !== "delete") return state;
  return { ...state, notice: null, focusRestoreId: LAUNCH_IDS.delete };
}

export function undoDelete(state) {
  if (!state.deleteUndo?.anchor || state.modal || state.notice) return state;
  return {
    ...state,
    anchor: cloneAnchor(state.deleteUndo.anchor),
    deleteUndo: null,
    focusRestoreId: LAUNCH_IDS.refine,
  };
}

export function resetEmpty(state) {
  if (state.modal || state.notice) return state;
  return createState();
}

export function seedReadyAnchor(state, image, fixture = "app/storyboard-web/public/character-anchors/putin.png") {
  if (state.modal || state.notice) return state;
  if (!image?.dataUrl) return state;
  return {
    ...createState(),
    anchor: {
      id: "seed-repository-anchor",
      dataUrl: image.dataUrl,
      mime: image.mime || "image/png",
      provenance: PROVENANCE.seededRepositoryAnchor,
      source: null,
      fixture,
    },
  };
}

function provenanceLabel(anchor) {
  switch (anchor.provenance) {
    case PROVENANCE.uploadedAsReadyAnchor:
      return LABELS.uploadedCaption;
    case PROVENANCE.generatedFromSource:
      return LABELS.generatedCaption;
    case PROVENANCE.seededRepositoryAnchor:
      return LABELS.seededCaption;
    case PROVENANCE.refinedFromAcceptedAnchor:
      return LABELS.refinedCaption;
    default:
      return "";
  }
}

const ERROR_TEXT = {
  "instruction-required": "Для первого уточнения нужна инструкция.",
  "source-required": "Сначала выберите фотографию.",
  "unsupported-file": "Нужен файл JPEG, PNG или WebP.",
  "file-too-large": "Файл больше 12 МБ.",
  provider: "Провайдер не вернул изображение. Выбор, инструкция и уже полученные варианты сохранены. Можно повторить.",
  timeout: "Провайдер не ответил вовремя. Выбор, инструкция и уже полученные варианты сохранены. Можно повторить.",
  "invalid-output": "Провайдер вернул неразборчивый ответ. Выбор, инструкция и уже полученные варианты сохранены. Можно повторить.",
  "provider-payload-too-large": "Запрос оказался слишком большим для провайдера. Выбор и варианты сохранены. Можно повторить.",
  "reference-payload-too-large": "Изображение не помещается в запрос к провайдеру. Выбор и варианты сохранены.",
  "echoed-source": "Ответ совпал с исходным изображением и не принят как вариант. Можно повторить.",
  configuration: "На сервере прототипа не настроен провайдер изображений.",
  "invalid-request": "Прототип не смог отправить этот запрос. Выбор и варианты сохранены.",
  busy: "Уже выполняется один запрос к провайдеру.",
  network: "Не удалось связаться с сервером прототипа. Выбор, инструкция и варианты сохранены.",
};

function errorText(code) {
  if (!KNOWN_ERRORS.has(code)) return ERROR_TEXT.provider;
  return ERROR_TEXT[code];
}

function modalTitle(modal) {
  if (modal.operation === "refine") return LABELS.refine;
  if (modal.step === "choose") return modal.operation === "replace" ? LABELS.replace : LABELS.create;
  if (modal.step === "ready") return LABELS.uploadReady;
  if (modal.operation === "replace") return "Создать замену по реальному фото";
  return LABELS.fromPhoto;
}

function preview(modal) {
  const candidate = selectedCandidate(modal);
  const preserved = modal.operation !== "create" && modal.preservedAnchor?.dataUrl
    ? { dataUrl: modal.preservedAnchor.dataUrl, label: LABELS.currentAnchor, role: "accepted" }
    : null;
  const source = modal.source?.dataUrl
    ? { dataUrl: modal.source.dataUrl, label: LABELS.sourcePhoto, role: "source" }
    : null;
  const keepNote = "Принятый образ не изменится, пока вы не нажмёте «Принять».";

  if (modal.step === "ready") {
    return {
      dominant: modal.source?.dataUrl
        ? { dataUrl: modal.source.dataUrl, label: LABELS.uploadedCaption, role: "ready" }
        : null,
      secondary: preserved ? [preserved] : [],
      note: modal.operation === "replace" ? keepNote : "",
    };
  }

  if (modal.step === "photo" && !candidate) {
    return {
      dominant: source,
      secondary: preserved ? [preserved] : [],
      note: "Это исходное фото. Оно не является сгенерированным вариантом.",
    };
  }

  if (modal.step === "photo" && candidate) {
    return {
      dominant: { dataUrl: candidate.dataUrl, label: LABELS.generatedVariant, role: "candidate" },
      secondary: [source, preserved].filter(Boolean),
      note: modal.operation === "replace" ? keepNote : "",
    };
  }

  if (modal.step === "refine" && !candidate) {
    return {
      dominant: modal.anchorImage
        ? { dataUrl: modal.anchorImage, label: LABELS.currentAnchor, role: "accepted" }
        : null,
      secondary: source ? [source] : [],
      note: keepNote,
    };
  }

  if (modal.step === "refine" && candidate) {
    const accepted = modal.anchorImage
      ? { dataUrl: modal.anchorImage, label: LABELS.currentAnchor, role: "accepted" }
      : null;
    return {
      dominant: { dataUrl: candidate.dataUrl, label: LABELS.generatedVariant, role: "candidate" },
      secondary: [accepted, source].filter(Boolean),
      note: keepNote,
    };
  }

  return { dominant: null, secondary: [], note: "" };
}

export function view(state) {
  const actions = state.anchor
    ? [
      { id: LAUNCH_IDS.refine, action: "refine", label: LABELS.refine, tone: "secondary" },
      { id: LAUNCH_IDS.replace, action: "replace", label: LABELS.replace, tone: "secondary" },
      { id: LAUNCH_IDS.delete, action: "delete", label: LABELS.delete, tone: "destructive" },
    ]
    : [{ id: LAUNCH_IDS.create, action: "create", label: LABELS.create, tone: "primary" }];

  let modal = null;
  if (state.modal) {
    const draft = state.modal;
    const generative = draft.step === "photo" || draft.step === "refine";
    modal = {
      operation: draft.operation,
      step: draft.step,
      title: modalTitle(draft),
      paths: draft.step === "choose"
        ? [
          { id: "path-ready", path: "ready", label: LABELS.uploadReady },
          { id: "path-photo", path: "photo", label: LABELS.fromPhoto },
        ]
        : [],
      instruction: draft.instruction,
      instructionRequired: draft.step === "refine" && draft.candidates.length === 0,
      showInstruction: generative,
      showFile: draft.step === "ready" || draft.step === "photo",
      showGenerate: generative,
      pending: draft.pending,
      error: draft.error ? errorText(draft.error) : "",
      errorCode: draft.error,
      generateLabel: draft.candidates.length > 0 ? LABELS.another : LABELS.generate,
      generateEnabled: canRequest(draft),
      acceptEnabled: !draft.pending && (
        (draft.step === "ready" && Boolean(draft.source?.dataUrl))
        || ((draft.step === "photo" || draft.step === "refine") && draft.index >= 0)
      ),
      canUndo: !draft.pending && draft.index > 0,
      canRedo: !draft.pending && draft.index >= 0 && draft.index < draft.candidates.length - 1,
      position: draft.candidates.length ? `Вариант ${draft.index + 1} из ${draft.candidates.length}` : "",
      candidateCount: draft.candidates.length,
      preview: preview(draft),
    };
  }

  let notice = null;
  if (state.notice?.type === "pending") {
    notice = {
      type: "pending",
      title: "Запрос уже отправлен",
      text: "Идёт запрос к провайдеру изображений. Закрытие сейчас не отменит уже отправленный запрос и может привести к повторной отправке. Дождитесь ответа.",
      confirmLabel: "",
      dismissLabel: "Понятно",
    };
  } else if (state.notice?.type === "discard") {
    notice = {
      type: "discard",
      title: "Закрыть черновик?",
      text: state.anchor
        ? "Непринятые варианты и введённые данные будут потеряны. Принятый образ не изменится."
        : "Непринятые варианты и введённые данные будут потеряны.",
      confirmLabel: "Закрыть без сохранения",
      dismissLabel: "Продолжить работу",
    };
  } else if (state.notice?.type === "delete") {
    notice = {
      type: "delete",
      title: "Удалить принятый образ?",
      text: "Образ исчезнет с карточки. В этом сеансе его можно вернуть без нового запроса к провайдеру.",
      confirmLabel: "Удалить",
      dismissLabel: "Отмена",
    };
  }

  return {
    stable: state.anchor ? "ANCHOR_AVAILABLE" : "NO_BASE_ANCHOR",
    actions,
    hasGenericEdit: actions.some((action) => action.action === "edit"),
    anchor: state.anchor
      ? {
        dataUrl: state.anchor.dataUrl,
        provenance: state.anchor.provenance,
        label: provenanceLabel(state.anchor),
        fixture: state.anchor.fixture,
        source: state.anchor.source
          ? { dataUrl: state.anchor.source.dataUrl, label: LABELS.sourcePhoto }
          : null,
      }
      : null,
    sessionUndo: state.deleteUndo
      ? { id: "session-undo", label: LABELS.sessionUndo, text: "Образ удалён." }
      : null,
    modal,
    notice,
    prototype: {
      note: LABELS.prototypeNote,
      resetLabel: LABELS.reset,
      seedLabel: LABELS.seed,
      enabled: !state.modal && !state.notice,
    },
    focusRestoreId: state.focusRestoreId,
  };
}
