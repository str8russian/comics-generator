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
