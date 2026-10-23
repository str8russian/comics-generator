import { presentFrameForMount } from "./visual-anchors.mjs";

const ORIGIN_LABELS = {
  generation: "Генерация",
  upload: "Загружено",
  reuse: "Выбрано из библиотеки",
};

export function panelBasis(frame, panelIndex) {
  const panel = Array.isArray(frame?.panels) ? frame.panels[panelIndex] : null;
  if (!panel) return null;
  if (panel.assetId) {
    const origin = panel.assignmentOrigin;
    if (Object.hasOwn(ORIGIN_LABELS, origin)) return { kind: origin, label: ORIGIN_LABELS[origin] };
    return { kind: "image", label: "Изображение" };
  }
  if (presentFrameForMount(frame).source === "demo-anchor") {
    return {
      kind: "base-portrait",
      label: "Базовый образ персонажа",
      hint: "Показан базовый образ: изображение для этой панели ещё не создано. Это не ошибка генерации.",
    };
  }
  return { kind: "none", label: "Нет изображения" };
}

export function foregroundPresentation(panel) {
  if (!panel?.assetId) return null;
  const extraction = panel.extraction;
  if (!extraction) {
    return { label: "Фон не отделён", status: "not-extracted", codes: ["not-extracted"] };
  }
  const codes = Array.isArray(extraction.findings)
    ? extraction.findings.map((finding) => finding?.code).filter(Boolean)
    : [];
  return {
    label: extraction.usesForeground === true ? "Фон отделён" : "Фон не отделён",
    status: extraction.status || "not-extracted",
    codes,
  };
}

export function foregroundChip(panel, { document = globalThis.document } = {}) {
  const presentation = foregroundPresentation(panel);
  if (!presentation || !document?.createElement) return null;
  const wrap = document.createElement("span");
  wrap.className = "panel-foreground";
  wrap.dataset.status = presentation.status;
  const label = document.createElement("span");
  label.className = "panel-foreground-label";
  label.textContent = presentation.label;
  wrap.append(label);
  if (presentation.codes.length) {
    const details = document.createElement("details");
    details.className = "panel-foreground-findings";
    const summary = document.createElement("summary");
    summary.textContent = "Коды";
    details.append(summary);
    const codes = document.createElement("span");
    codes.className = "panel-foreground-codes";
    codes.textContent = presentation.codes.join(", ");
    details.append(codes);
    wrap.append(details);
  }
  return wrap;
}

export function basisChip(frame, panelIndex, { document = globalThis.document, prefix = null } = {}) {
  const basis = panelBasis(frame, panelIndex);
  if (!basis) return null;
  const chip = document.createElement("span");
  chip.className = "panel-basis";
  chip.dataset.basis = basis.kind;
  chip.textContent = prefix ? `${prefix} · ${basis.label}` : basis.label;
  if (basis.hint) chip.setAttribute?.("title", basis.hint);
  return chip;
}
