export function deterministicRevisionControl(instruction) {
  const text = normalizeRevisionInstruction(instruction);
  if (!text) return null;
  for (const entry of DETERMINISTIC_CONTROLS) {
    if (entry.phrases.some((phrase) => normalizeRevisionInstruction(phrase) === text)) return entry.control;
  }
  return null;
}

export function deterministicRevisionFragments(instruction) {
  const raw = String(instruction ?? "");
  const lower = raw.toLocaleLowerCase("ru");
  const found = [];
  for (const entry of DETERMINISTIC_CONTROLS) {
    for (const phrase of entry.phrases) {
      const needle = phrase.toLocaleLowerCase("ru");
      const index = lower.indexOf(needle);
      if (index < 0) continue;
      const before = index === 0 ? "" : lower[index - 1];
      const afterIndex = index + needle.length;
      const after = afterIndex >= lower.length ? "" : lower[afterIndex];
      const bounded = !/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after);
      if (!bounded) continue;
      const fragment = raw.slice(index, index + phrase.length);
      if (!found.includes(fragment)) found.push(fragment);
    }
  }
  return found;
}

function normalizeRevisionInstruction(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ").replace(/[.!?]+$/u, "");
}

const DETERMINISTIC_CONTROLS = [
  { control: "zoom", phrases: ["zoom", "приблизить", "приблизь", "отдалить", "масштаб"] },
  { control: "pan", phrases: ["pan", "сдвинуть", "панорамировать"] },
  { control: "mirror", phrases: ["mirror", "отразить", "отзеркалить", "зеркало"] },
  { control: "reset", phrases: ["reset", "сбросить", "сбросить кадрирование"] },
  { control: "reuse", phrases: ["reuse", "выбрать изображение", "использовать существующее", "назначить изображение"] },
];

const PROPERTY_LABELS = {
  characterName: "персонаж",
  framing: "кадр",
  upperBody: "корпус и плечи",
  gesture: "жест",
  headPose: "поворот головы",
  gaze: "взгляд",
  expression: "выражение",
  eyes: "глаза",
  eyebrows: "брови",
  background: "фон",
};

const VALUE_LABELS = {
  "close-up": "крупный план",
  "chest-up": "по грудь",
  "waist-up": "поясной план",
  "head-and-shoulders": "голова и плечи",
  "medium-close-up": "средний крупный план",
  "hands outside crop": "руки вне кадра",
  "near-frontal head": "голова прямо",
  "head lowered": "голова опущена",
  "head turned slightly screen-right": "голова чуть вправо",
  "head turned slightly screen-left": "голова чуть влево",
  "screen-left": "влево",
  "screen-right": "вправо",
  "to-camera": "в камеру",
  neutral: "нейтральное",
  calm: "спокойное",
  irritated: "раздражённое",
  confused: "растерянное",
  relaxed: "расслабленное",
  "self-confident": "уверенное",
  closed: "закрыты",
  "wide-open": "широко открыты",
  raised: "подняты",
  "solid-matte": "сплошной матовый фон",
  "visible shoulders and upper torso": "видимые плечи и верх корпуса",
  "forward-leaning upper body": "корпус наклонён вперёд",
};

export const REVISION_COPY = Object.freeze({
  refine: "Уточнить текущее",
  variation: "Новая вариация",
  generate: "Создать кандидат",
  accept: "Принять кандидат",
  cancel: "Отменить черновик",
  undo: "Кандидат назад",
  redo: "Кандидат вперёд",
  confirmCancel: "Отменить черновик",
  keepDraft: "Вернуться к черновику",
});

function labelValue(value) {
  if (value == null) return "не задано";
  return VALUE_LABELS[value] || String(value);
}

function formatFacts(facts) {
  if (!facts?.length) return "нет";
  return facts.map((fact) => `${PROPERTY_LABELS[fact.property] || fact.property}: ${labelValue(fact.value)}`).join("; ");
}

export function revisionBasisText(summary) {
  if (summary?.basis?.kind === "none") return "Основа: предыдущее изображение не отправляется.";
  if (summary?.basis?.kind === "candidate") return `Основа: кандидат ${summary.basis.ordinal}.`;
  return "Основа: текущая панель.";
}

export function revisionPreservedDisclosure(summary) {
  const facts = summary?.preserved || [];
  if (!facts.length) return null;
  return {
    label: `Что сохранится · ${facts.length} свойств`,
    text: formatFacts(facts),
  };
}

export function revisionSummaryLines(summary) {
  if (!summary) return [];
  const lines = [
    revisionBasisText(summary),
    `Что изменится: ${formatFacts(summary.changes)}.`,
  ];
  if (summary.notApplied?.length) {
    lines.push(`Не применяется: ${summary.notApplied.map((entry) => entry.text).join("; ")}.`);
  }
  if (summary.reconstruction === "partial") {
    lines.push("Прошлое описание не восстанавливается: в запросе только уже известные свойства и эта правка. Основой остаётся само изображение.");
  } else if (summary.reconstruction === "known-supported") {
    lines.push("Сохраняются только свойства, которые уже были явно известны, и эта правка.");
  }
  if (summary.blockReason === "empty-refine") lines.push("Уточнение требует непустую правку.");
  if (summary.blockReason === "no-supported-change") lines.push("В правке нет поддерживаемого изменения изображения.");
  if (summary.blockReason === "deterministic-only") lines.push("Это действие выполняется без генерации изображения.");
  return lines;
}

export function renderRevisionSummary(document, summary) {
  const box = document.createElement("div");
  box.className = "revision-summary";
  box.dataset.revisionSummary = "true";
  if (summary?.basis?.kind) box.dataset.basis = summary.basis.kind;
  if (summary?.basis?.ordinal) box.dataset.basisOrdinal = String(summary.basis.ordinal);
  for (const line of revisionSummaryLines(summary)) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    box.append(paragraph);
  }
  const preserved = revisionPreservedDisclosure(summary);
  if (preserved) {
    const details = document.createElement("details");
    details.className = "revision-preserved";
    const disclosure = document.createElement("summary");
    disclosure.textContent = preserved.label;
    const paragraph = document.createElement("p");
    paragraph.textContent = preserved.text;
    details.append(disclosure, paragraph);
    box.append(details);
  }
  return box;
}
