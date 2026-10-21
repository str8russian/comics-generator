export const DUPLICATE_LABEL = "Дублировать проект";
export const DUPLICATE_TITLE_LABEL = "Название копии";
export const DUPLICATE_SUBMIT_LABEL = "Создать копию";
export const DUPLICATE_CANCEL_LABEL = "Отмена";
export const DUPLICATE_TITLE_LIMIT = 120;
const DUPLICATE_PREFIX = "Копия — ";

export function proposedDuplicateTitle(sourceTitle) {
  const source = typeof sourceTitle === "string" ? sourceTitle : "";
  const budget = DUPLICATE_TITLE_LIMIT - DUPLICATE_PREFIX.length;
  if (budget <= 0) return DUPLICATE_PREFIX.slice(0, DUPLICATE_TITLE_LIMIT);
  if (source.length <= budget) return DUPLICATE_PREFIX + source;
  return DUPLICATE_PREFIX + truncateGraphemes(source, budget);
}

function truncateGraphemes(text, maxUnits) {
  const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > maxUnits) break;
    out += segment;
  }
  return out;
}

export function duplicateFailureMessage({ status, kind } = {}) {
  if (kind === "invalid-request" || status === 400) {
    return "Название копии не подходит. Укажите непустое название не длиннее 120 символов.";
  }
  if (kind === "not-found" || status === 404) {
    return "Исходный проект не найден. Копия не создана.";
  }
  return "Не удалось дублировать проект. Копия не создана.";
}

function setDisabled(controls, disabled) {
  for (const control of controls) {
    if (control) control.disabled = disabled;
  }
}

export function bindDuplicateDialog({
  dialog,
  form,
  titleInput,
  statusNode,
  submitButton,
  cancelButton,
  openButton,
  getSource,
  requestDuplicate,
  onSuccess,
} = {}) {
  if (!dialog || !form || !titleInput || !submitButton || !cancelButton) return { open() {} };
  if (!submitButton.textContent) submitButton.textContent = DUPLICATE_SUBMIT_LABEL;
  if (!cancelButton.textContent) cancelButton.textContent = DUPLICATE_CANCEL_LABEL;
  let pending = false;
  let source = null;

  function showStatus(text) {
    if (!statusNode) return;
    statusNode.textContent = text || "";
  }

  function open(explicit) {
    if (pending) return;
    source = explicit?.id ? explicit : (getSource?.() ?? null);
    if (!source?.id) return;
    titleInput.value = proposedDuplicateTitle(source.title);
    showStatus("");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute?.("open", "");
    titleInput.focus?.();
  }

  function closeWithoutCreating() {
    if (pending) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute?.("open");
  }

  async function submit(event) {
    event?.preventDefault?.();
    if (pending || !source?.id) return;
    pending = true;
    setDisabled([titleInput, submitButton, cancelButton, openButton], true);
    showStatus("");
    try {
      const result = await requestDuplicate({ id: source.id, title: titleInput.value });
      if (!result?.ok) {
        showStatus(result?.message || duplicateFailureMessage(result));
        return;
      }
      if (typeof dialog.close === "function") dialog.close();
      onSuccess?.(result.project);
    } catch {
      showStatus(duplicateFailureMessage({ status: 503, kind: "database" }));
    } finally {
      pending = false;
      setDisabled([titleInput, submitButton, cancelButton, openButton], false);
    }
  }

  form.addEventListener("submit", (event) => {
    void submit(event);
  });
  cancelButton.addEventListener("click", (event) => {
    event?.preventDefault?.();
    closeWithoutCreating();
  });
  dialog.addEventListener("cancel", (event) => {
    if (pending) event?.preventDefault?.();
  });
  openButton?.addEventListener("click", () => open());
  return { open };
}

export async function requestProjectDuplicate({ id, title, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`/api/projects/${id}/duplicate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      kind: payload.kind,
      message: duplicateFailureMessage({ status: response.status, kind: payload.kind }),
    };
  }
  return { ok: true, project: payload };
}
