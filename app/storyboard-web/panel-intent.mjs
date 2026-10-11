/**
 * Deterministic panel-intent readiness assessment for constrained Structure boards.
 * Prefer rejection. No rewrite/retry. No persistence. No provider calls.
 */

const FRAMING_SUPPORTED = [
  /close[-\s]?up/iu,
  /крупн(?:ый|ого|ом)?\s+план/iu,
  /head[-\s]?and[-\s]?shoulders/iu,
  /chest[-\s]?up/iu,
  /по\s+грудь/iu,
  /medium\s+close[-\s]?up/iu,
  /waist[-\s]?up/iu,
  /поясн(?:ой|ого|ом)?\s+план/iu,
];

const FRAMING_UNSUPPORTED = [
  /full[-\s]?body/iu,
  /full[-\s]?length/iu,
  /во\s+весь\s+рост/iu,
  /в\s+полный\s+рост/iu,
  /from\s+head\s+to\s+toe/iu,
  /ниже\s+пояса/iu,
  /below\s+the\s+waist/iu,
  /full[-\s]?frame\s+body/iu,
  /целиком\s+в\s+кадре/iu,
];

const MATTE_BACKGROUND = [
  /solid\s+matte(?:\s+background)?/iu,
  /сплошн(?:ой|ого|ом)?\s+матов(?:ый|ого|ом)?\s+фон/iu,
  /матов(?:ый|ого|ом)?\s+сплошн(?:ой|ого|ом)?\s+фон/iu,
];

/** Phrase/token detectors; avoid JS \\b, which does not treat Cyrillic as word chars. */
const UNSUPPORTED_PHRASES = [
  // locations / scenery
  "кабинет", "комнат", "улиц", "офис", "bedroom", "landscape", "scenery", "пейзаж", "локаци",
  "площад", "парк", "в офисе", "у окна", "at the office", "at the window", "at the street",
  // interiors
  "интерьер", "interior", "hallway", "коридор",
  // furniture
  "стул", "кресл", "стол", "кровать", "диван", "chair", "bed", "table", "sofa", "furniture",
  // props / objects
  "телефон", "phone", "книг", "book", "чашк", "предмет", "проп", "prop", "object", "держит",
  // additional people
  "толп", "crowd", "люди", "людей", "people", "групп", "партнёр", "партнер", "partner",
  // physical interaction
  "обнима", "касает", "касают", "handshake", "hug", "holds hands", "hold hands",
  // visible text
  "надпись", "вывеска", "lettering", "caption", "текст на",
  // rendering-style
  "в стиле", "style of", "cartoon style", "фотореализм", "rendering",
  // invisible narrative / temporal
  "потому что", "вспомина", "meanwhile", "after that", "thinking about",
  // support-dependent staging
  "сидит", "сидя", "sit", "sitting",
  "стоит", "стоя", "stand", "standing",
  "лежит", "лёжа", "лежа", "lying",
  "спит", "sleeping", "asleep",
  "просыпа", "waking", "wakes",
  "продолжая говорить", "continuing to speak",
  "на встрече", "в совещании", "meeting context", "meeting", "совещани",
];

function failure(code, frameId, panelIndex) {
  const entry = { code };
  if (frameId != null) entry.frameId = frameId;
  if (panelIndex != null) entry.panelIndex = panelIndex;
  return entry;
}

function characterSurfaces(cast) {
  const characters = cast?.characters || [];
  const aliases = cast?.aliases || [];
  const idToName = new Map(
    characters
      .filter((entry) => entry?.id && entry?.name)
      .map((entry) => [entry.id, entry.name]),
  );
  const surfaces = [];
  for (const character of characters) {
    if (!character?.name) continue;
    surfaces.push({ surface: character.name, characterName: character.name });
  }
  for (const alias of aliases) {
    if (!alias?.surface) continue;
    const characterName = alias.characterName || idToName.get(alias.characterId);
    if (!characterName) continue;
    surfaces.push({ surface: alias.surface, characterName });
  }
  surfaces.sort((left, right) => right.surface.length - left.surface.length);
  return surfaces;
}

export function distinctPanelSubjects(description, cast) {
  const text = String(description ?? "").toLocaleLowerCase("ru");
  const matched = new Set();
  for (const candidate of characterSurfaces(cast)) {
    const surface = candidate.surface.toLocaleLowerCase("ru");
    if (!surface) continue;
    if (text.includes(surface)) matched.add(candidate.characterName);
  }
  return [...matched];
}

function panelEntries(frames) {
  const entries = [];
  for (const frame of frames || []) {
    if (frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0) {
      frame.segments.forEach((segment) => {
        (segment?.panels || []).forEach((panel, panelIndex) => {
          entries.push({
            frameId: frame.id,
            panelIndex,
            description: panel?.description,
          });
        });
      });
      continue;
    }
    (frame?.panels || []).forEach((panel, panelIndex) => {
      entries.push({
        frameId: frame.id,
        panelIndex,
        description: panel?.description,
      });
    });
  }
  return entries;
}

function hasAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasUnsupportedPhrase(text) {
  const lower = String(text).toLocaleLowerCase("ru");
  return UNSUPPORTED_PHRASES.some((phrase) => lower.includes(phrase.toLocaleLowerCase("ru")));
}

function assessDescription(description, cast, frameId, panelIndex) {
  const text = String(description ?? "");
  const subjects = distinctPanelSubjects(text, cast);
  if (subjects.length === 0) {
    return failure("panel-subject-required", frameId, panelIndex);
  }
  if (subjects.length > 1) {
    return failure("panel-subject-ambiguous", frameId, panelIndex);
  }
  if (hasAny(FRAMING_UNSUPPORTED, text)) {
    return failure("panel-framing-unsupported", frameId, panelIndex);
  }
  if (!hasAny(FRAMING_SUPPORTED, text)) {
    return failure("panel-framing-unsupported", frameId, panelIndex);
  }
  if (!hasAny(MATTE_BACKGROUND, text)) {
    return failure("unsupported-panel-intent", frameId, panelIndex);
  }
  if (hasUnsupportedPhrase(text)) {
    return failure("unsupported-panel-intent", frameId, panelIndex);
  }
  return null;
}

export function assessPanelIntent(frames, cast) {
  const failures = [];
  for (const entry of panelEntries(frames)) {
    const issue = assessDescription(entry.description, cast, entry.frameId, entry.panelIndex);
    if (issue) failures.push(issue);
  }
  if (failures.length > 0) return { ok: false, failures };
  return { ok: true };
}
