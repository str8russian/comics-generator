export const ANCHOR_ASSETS = {
  putin: "/character-anchors/putin.png",
  durov: "/character-anchors/durov.png",
  peskov: "/character-anchors/peskov.png",
};

export const ANCHOR_GEOMETRY = {
  position: "50% 30%",
  align: "50% 30%",
  zoom: 1,
};

const RULES = [
  { id: "putin", subject: "Путин", needle: "путин" },
  { id: "durov", subject: "Дуров", needle: "дуров" },
  { id: "peskov", subject: "Песков", needle: "песков" },
  { id: "peskov", subject: "Песков", needle: "дмитрий сергеевич" },
];

export function resolveAnchor(description) {
  if (typeof description !== "string" || description.length === 0) return null;
  const haystack = description.toLocaleLowerCase("ru");
  let matched = null;
  let at = -1;
  for (const rule of RULES) {
    const index = haystack.indexOf(rule.needle);
    if (index < 0) continue;
    if (matched && matched.id !== rule.id && index === at) return null;
    if (at < 0 || index < at) {
      matched = rule;
      at = index;
    }
  }
  if (!matched) return null;
  return {
    asset: ANCHOR_ASSETS[matched.id],
    subject: matched.subject,
    role: "Базовый образ",
    position: ANCHOR_GEOMETRY.position,
    align: ANCHOR_GEOMETRY.align,
    zoom: ANCHOR_GEOMETRY.zoom,
  };
}

export function presentVisualFrame(frame) {
  if (!frame || !Array.isArray(frame.panels) || frame.panels.length === 0) return null;
  const panels = [];
  for (const panel of frame.panels) {
    const anchor = resolveAnchor(panel?.description);
    if (!anchor) return null;
    panels.push({ ...panel, ...anchor });
  }
  return {
    ...frame,
    panels,
    speakerPanel: frame.speakerPanel,
    dialogue: frame.dialogue,
  };
}
