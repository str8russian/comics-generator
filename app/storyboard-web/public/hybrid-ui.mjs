/** Concise Russian copy for hybrid Visual phases and failure kinds. */

const PHASE_COPY = {
  queued: "Подготавливаем кадр…",
  "preparing-background": "Подготавливаем кадр…",
  "generating-background": "Создаём фон…",
  "generating-character-states": "Создаём персонажей…",
  assembling: "Собираем кадр…",
  complete: "Изображения готовы.",
};

const FAILURE_COPY = {
  "matte-failed": "Не удалось чисто подготовить персонажа. Повторите генерацию.",
  "style-required": "Сначала утвердите базовый визуальный стиль проекта.",
  "anchor-required": "Сначала утвердите базовый образ нужного персонажа.",
  "frame-generation-required": "Сначала создайте изображения всего выбранного кадра.",
  "assembly-failed": "Не удалось собрать кадр из готовых частей. Повторите генерацию.",
  provider: "Провайдер не завершил генерацию. Уже готовые результаты сохранены.",
  timeout: "Генерация заняла слишком много времени. Повторите попытку.",
  "invalid-output": "Провайдер не вернул пригодное изображение. Повторите попытку.",
  conflict: "Более новая генерация заменила эту попытку. Показано актуальное состояние.",
  "not-found": "Не удалось найти этот кадр или операцию. Обновите страницу.",
  configuration: "Генерация недоступна из‑за настройки окружения. Проверьте конфигурацию и повторите.",
  "invalid-request": "Не удалось прочитать запрос. Проверьте данные и попробуйте ещё раз.",
  "invalid-image": "Не удалось прочитать изображение. Выберите JPEG, PNG или WebP.",
  "unsupported-image-format": "Этот формат пока не поддерживается. Выберите JPEG, PNG или WebP.",
  database: "Не удалось сохранить результат. Попробуйте ещё раз.",
  "identity-required": "Сначала выберите реальную фотографию персонажа.",
  "structure-rejected": "Не удалось применить эту правку, не меняя реплики. Опишите изменение кадра иначе.",
  "visual-incomplete": "Сначала создайте изображения для всех панелей.",
  "stale-version": "Раскадровка уже изменилась. Обновите страницу и повторите действие.",
  "asset-load-failed": "Изображение не удалось показать. Обновите страницу или создайте панель заново.",
  "nothing-to-undo": "Предыдущей структурной версии пока нет.",
  "image-too-large": "Файл слишком большой. Выберите фото меньшего размера.",
};

export function hybridPhaseMessage(phase) {
  if (phase == null) return "Подготавливаем кадр…";
  return PHASE_COPY[phase] || "Подготавливаем кадр…";
}

export function hybridFailureMessage(kind) {
  if (!kind) return "Не удалось выполнить действие. Попробуйте ещё раз.";
  return FAILURE_COPY[kind] || "Не удалось выполнить действие. Попробуйте ещё раз.";
}

export function actionMessage(kind) {
  return hybridFailureMessage(kind);
}

/** Defaults used by reset (agreed character placement). */
export const DEFAULT_PLACEMENT = Object.freeze({
  zoom: 1,
  positionX: 50,
  positionY: 30,
  fitMode: "manual",
});

export function fitPlacement() {
  return {
    zoom: 1,
    positionX: 50,
    positionY: 50,
    fitMode: "fit",
  };
}
