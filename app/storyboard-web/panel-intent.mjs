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
  /однотонн(?:ый|ого|ом)?\s+матов(?:ый|ого|ом)?\s+фон/iu,
  /матов(?:ый|ого|ом)?\s+однотонн(?:ый|ого|ом)?\s+фон/iu,
];

/** Cyrillic stems/phrases: intentional inflectional / multiword includes. */
const UNSUPPORTED_STEMS = [
  // locations / scenery
  "кабинет", "комнат", "улиц", "офис", "пейзаж", "локаци", "площад", "парк", "в офисе", "у окна",
  // interiors
  "интерьер", "коридор",
  // furniture
  "стул", "кресл", "стол", "кровать", "диван",
  // props / objects
  "телефон", "книг", "чашк", "предмет", "проп", "держит",
  // additional people
  "толп", "люди", "людей", "групп", "партнёр", "партнер",
  // physical / relational interaction
  "обнима", "касает", "касают", "окликает", "обращается к", "передаёт слово", "передает слово", "присутствующ",
  // visible text
  "надпись", "вывеска", "текст на",
  // rendering-style
  "в стиле", "фотореализм",
  // invisible narrative / temporal
  "потому что", "вспомина",
  // observed temporal action/change (not bounded visible geometry)
  "резко наклоняется",
  "внезапно оживляется",
  // support-dependent / scenario staging
  "сидит", "сидя",
  "стоит", "стоя",
  "лежит", "лёжа", "лежа",
  "спит",
  "просыпа", "проснув",
  "продолжая говорить", "продолжает говорить",
  "на встрече", "в совещании", "совещани",
];

/** Bounded whole-token detectors (Unicode-aware). Avoid matching inside unrelated words. */
const UNSUPPORTED_BOUNDED = [
  "bedroom", "landscape", "scenery",
  "interior", "hallway",
  "chair", "bed", "table", "sofa", "furniture",
  "phone", "book", "prop", "object",
  "crowd", "people", "partner",
  "handshake", "hug",
  "lettering", "caption",
  "rendering",
  "meanwhile",
  "sit", "sits", "sitting",
  "stand", "stands", "standing",
  "lie", "lies", "lying",
  "sleep", "sleeps", "sleeping", "asleep",
  "wake", "wakes", "waking",
  "meeting",
];

const UNSUPPORTED_BOUNDED_PHRASES = [
  "at the office",
  "at the window",
  "at the street",
  "holds hands",
  "hold hands",
  "style of",
  "cartoon style",
  "after that",
  "thinking about",
  "continuing to speak",
  "meeting context",
];

function failure(code, frameId, panelIndex) {
  const entry = { code };
  if (frameId != null) entry.frameId = frameId;
  if (panelIndex != null) entry.panelIndex = panelIndex;
  return entry;
}

function isLetterOrNumber(ch) {
  return ch != null && /\p{L}|\p{N}/u.test(ch);
}

/** True when `needle` occurs in `haystack` with non-letter/number boundaries on both sides. */
function hasBoundedOccurrence(haystack, needle) {
  if (!needle) return false;
  const text = String(haystack);
  const target = String(needle);
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(target, from);
    if (index < 0) return false;
    const before = index === 0 ? null : text[index - 1];
    const afterIndex = index + target.length;
    const after = afterIndex >= text.length ? null : text[afterIndex];
    if (!isLetterOrNumber(before) && !isLetterOrNumber(after)) return true;
    from = index + 1;
  }
  return false;
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
    if (hasBoundedOccurrence(text, surface)) matched.add(candidate.characterName);
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
  if (UNSUPPORTED_STEMS.some((stem) => lower.includes(stem.toLocaleLowerCase("ru")))) {
    return true;
  }
  if (UNSUPPORTED_BOUNDED_PHRASES.some((phrase) => lower.includes(phrase.toLocaleLowerCase("ru")))) {
    return true;
  }
  return UNSUPPORTED_BOUNDED.some((token) => hasBoundedOccurrence(lower, token.toLocaleLowerCase("ru")));
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
