import { dialogueCompletes, isPositiveFrameCount, minimumDurationFrames } from "./timing.mjs";
import { resolvePanelSubject } from "./visual-model.mjs";

export const RETAINED_IMAGE_NOTICE = "Текст изменён — изображение сохранено для проверки";

function hasUnpairedSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function spokenOf(item) {
  if (typeof item?.spokenText === "string") return item.spokenText;
  if (typeof item?.text === "string") return item.text;
  return "";
}

export function utteranceImpactMessage(count) {
  const noun = count % 10 === 1 && count % 100 !== 11 ? "реплике" : "репликах";
  return `Нельзя исключить: персонаж говорит в ${count} ${noun}.`;
}

function lineageKey(character) {
  const extracted = character?.extracted_name ?? character?.extractedName;
  if (typeof extracted === "string" && extracted.length > 0) return extracted;
  return typeof character?.name === "string" ? character.name : "";
}

function castReconciliation(message) {
  return {
    ok: false,
    status: "blocked",
    httpStatus: 409,
    kind: "cast-reconciliation",
    message,
  };
}

export function planCastRevision(previousRows, characters) {
  const previousByKey = new Map();
  for (const row of previousRows || []) {
    const extractedName = lineageKey(row);
    if (!extractedName) continue;
    if (previousByKey.has(extractedName)) {
      return castReconciliation("Нельзя согласовать состав: прежние персонажи неразличимы.");
    }
    previousByKey.set(extractedName, {
      name: row.name,
      extractedName,
      included: row.included !== false,
    });
  }
  const seen = new Set();
  const pairs = [];
  const added = [];
  for (const character of characters || []) {
    const extractedName = lineageKey(character);
    if (!extractedName || seen.has(extractedName)) {
      return castReconciliation("Нельзя согласовать состав: одинаковая прежняя идентичность.");
    }
    seen.add(extractedName);
    const previous = previousByKey.get(extractedName);
    if (previous) pairs.push({ previous, next: character });
    else if (character.name !== extractedName) {
      return castReconciliation("Нельзя согласовать состав: новая личность не совпадает с именем.");
    } else added.push(character);
  }
  const removed = [...previousByKey.values()].filter((entry) => !seen.has(entry.extractedName));
  if (removed.length > 0) {
    return castReconciliation("Нельзя согласовать состав: персонаж исчез из списка.");
  }
  const byPreviousName = new Map(pairs.map((pair) => [pair.previous.name, pair]));
  for (const pair of pairs) {
    if (pair.previous.name === pair.next.name) continue;
    const other = byPreviousName.get(pair.next.name);
    if (other && other !== pair && other.next.name === pair.previous.name) {
      return castReconciliation("Нельзя согласовать состав: прежние личности переставлены.");
    }
  }
  return {
    ok: true,
    pairs,
    added,
    renamed: pairs.filter((pair) => pair.previous.name !== pair.next.name),
    inclusionChanged: pairs.some((pair) => pair.previous.included !== (pair.next.included !== false)),
  };
}

export function speakingExclusion(cast) {
  const counts = new Map();
  for (const speaker of cast?.speakers || []) {
    counts.set(speaker.characterName, (counts.get(speaker.characterName) || 0) + 1);
  }
  for (const character of cast?.characters || []) {
    if (character.included !== false) continue;
    const count = counts.get(character.name) || 0;
    if (count < 1) continue;
    return {
      ok: false,
      httpStatus: 409,
      status: "blocked",
      kind: "speaking-character",
      message: utteranceImpactMessage(count),
    };
  }
  return null;
}

export function applyExclusions(cast, excludedNames) {
  const excluded = new Set(excludedNames || []);
  return {
    ...cast,
    characters: (cast.characters || []).map((character) => {
      const extractedName = character.extractedName || character.name;
      const included = excluded.has(extractedName) ? false : character.included !== false;
      return { ...character, extractedName, included };
    }),
  };
}

export function replaceSpokenSpan({ text, items, sourceItemId, spokenText }) {
  if (typeof text !== "string" || !Array.isArray(items)) return { ok: false, kind: "invalid-request" };
  if (typeof spokenText !== "string" || !spokenText.trim() || spokenText.includes("\u0000") || hasUnpairedSurrogate(spokenText)) {
    return { ok: false, kind: "invalid-request" };
  }
  const item = items.find((entry) => entry?.id === sourceItemId);
  if (!item || item.kind !== "utterance") return { ok: false, kind: "not-found" };
  if (!Number.isInteger(item.draftStart) || !Number.isInteger(item.draftEnd)) {
    return { ok: false, kind: "invalid-request" };
  }
  const currentQuote = text.slice(item.draftStart, item.draftEnd);
  if (currentQuote !== item.sourceQuote) return { ok: false, kind: "invalid-request" };
  const spoken = spokenOf(item);
  if (!currentQuote.endsWith(spoken)) return { ok: false, kind: "invalid-request" };
  const prefix = currentQuote.slice(0, currentQuote.length - spoken.length);
  if (spokenText === spoken) {
    return { ok: true, unchanged: true, text, items, sourceItemId };
  }
  const overlaps = items.some((entry) => (
    entry.id !== item.id
    && entry.draftStart < item.draftEnd
    && entry.draftEnd > item.draftStart
  ));
  if (overlaps) return { ok: false, kind: "invalid-request" };
  const newQuote = `${prefix}${spokenText}`;
  const delta = newQuote.length - currentQuote.length;
  const nextText = text.slice(0, item.draftStart) + newQuote + text.slice(item.draftEnd);
  const nextItems = items.map((entry) => {
    if (entry.id === item.id) {
      return {
        ...entry,
        sourceQuote: newQuote,
        spokenText,
        text: spokenText,
        draftEnd: entry.draftStart + newQuote.length,
      };
    }
    if (entry.draftStart >= item.draftEnd) {
      return {
        ...entry,
        draftStart: entry.draftStart + delta,
        draftEnd: entry.draftEnd + delta,
      };
    }
    return { ...entry };
  });
  for (const entry of nextItems) {
    if (nextText.slice(entry.draftStart, entry.draftEnd) !== entry.sourceQuote) {
      return { ok: false, kind: "invalid-request" };
    }
  }
  const before = text.slice(0, item.draftStart);
  const after = text.slice(item.draftEnd);
  if (nextText.slice(0, before.length) !== before || !nextText.endsWith(after)) {
    return { ok: false, kind: "invalid-request" };
  }
  return { ok: true, unchanged: false, text: nextText, items: nextItems, sourceItemId, delta };
}

export function repartitionSegments(segments, spokenText) {
  if (!Array.isArray(segments) || segments.length < 2) return { ok: false, kind: "directing-repartition" };
  if (segments.some((segment) => typeof segment?.quote !== "string" || segment.quote.length === 0)) {
    return { ok: false, kind: "directing-repartition" };
  }
  const oldText = segments.map((segment) => segment.quote).join("");
  if (spokenText === oldText) {
    let cursor = 0;
    return {
      ok: true,
      segments: segments.map((segment) => {
        const start = cursor;
        const end = cursor + segment.quote.length;
        cursor = end;
        return { ...segment, start, end };
      }),
    };
  }
  let prefix = 0;
  const limit = Math.min(oldText.length, spokenText.length);
  while (prefix < limit && oldText[prefix] === spokenText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix
    && suffix < spokenText.length - prefix
    && oldText[oldText.length - 1 - suffix] === spokenText[spokenText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldStart = prefix;
  const oldEnd = oldText.length - suffix;
  let cursor = 0;
  let hit = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const start = cursor;
    const end = cursor + segments[index].quote.length;
    cursor = end;
    if (oldStart < end && oldEnd > start) {
      if (hit >= 0) return { ok: false, kind: "directing-repartition" };
      hit = index;
    }
  }
  if (hit < 0) return { ok: false, kind: "directing-repartition" };
  const segStart = segments.slice(0, hit).reduce((total, segment) => total + segment.quote.length, 0);
  const segEnd = segStart + segments[hit].quote.length;
  const tail = oldText.length - segEnd;
  const quote = spokenText.slice(segStart, spokenText.length - tail);
  if (!quote) return { ok: false, kind: "directing-repartition" };
  let offset = 0;
  const next = segments.map((segment, index) => {
    const nextQuote = index === hit ? quote : segment.quote;
    const start = offset;
    const end = offset + nextQuote.length;
    offset = end;
    return { ...segment, quote: nextQuote, start, end };
  });
  if (next.some((segment) => segment.quote.length === 0)) return { ok: false, kind: "directing-repartition" };
  if (next.map((segment) => segment.quote).join("") !== spokenText) {
    return { ok: false, kind: "directing-repartition" };
  }
  return { ok: true, segments: next };
}

export function raisedDuration(explicit, text) {
  if (!isPositiveFrameCount(explicit)) return explicit ?? null;
  const minimum = minimumDurationFrames(text);
  if (explicit >= minimum && dialogueCompletes(explicit, text)) return explicit;
  return minimum;
}

function withNotice(frame, spokenText, extra = {}) {
  return {
    ...frame,
    ...extra,
    dialogue: spokenText,
    retainedImageNotice: RETAINED_IMAGE_NOTICE,
    durationFrames: raisedDuration(frame.durationFrames, spokenText),
  };
}

export function applyUtteranceToFrames(frames, sourceItemId, spokenText) {
  const list = Array.isArray(frames) ? frames : [];
  const related = list.filter((frame) => frame?.sourceItemId === sourceItemId);
  if (related.length === 0) return { ok: true, frames: list, affected: false };
  const directing = related.filter((frame) => frame.directingBeat === true && Array.isArray(frame.segments));
  if (directing.length !== related.length && directing.length !== 0) {
    return { ok: false, kind: "directing-repartition" };
  }
  if (directing.length > 0) {
    const next = [];
    for (const frame of list) {
      if (frame?.sourceItemId !== sourceItemId) {
        next.push(frame);
        continue;
      }
      const parted = repartitionSegments(frame.segments, spokenText);
      if (!parted.ok) return { ok: false, status: "blocked", kind: "directing-repartition", httpStatus: 409 };
      const segments = parted.segments.map((segment) => ({
        ...segment,
        durationFrames: raisedDuration(segment.durationFrames, segment.quote),
      }));
      next.push(withNotice(frame, spokenText, { segments }));
    }
    return { ok: true, frames: next, affected: true };
  }
  const primary = related.find((frame) => typeof frame.id === "string" && !frame.id.includes("#")) || related[0];
  const structureId = typeof primary.structureFrameId === "string" && primary.structureFrameId
    ? primary.structureFrameId
    : String(primary.id || "").split("#")[0];
  const updated = withNotice(primary, spokenText, {
    id: structureId || primary.id,
    displayBlock: { sourceItemId, start: 0, end: spokenText.length },
  });
  const next = [];
  let placed = false;
  for (const frame of list) {
    if (frame?.sourceItemId !== sourceItemId) {
      next.push(frame);
      continue;
    }
    if (!placed) {
      next.push(updated);
      placed = true;
    }
  }
  return { ok: true, frames: next, affected: true };
}

function subjectOf(panel, cast) {
  const manual = typeof panel?.manualSubject === "string" ? panel.manualSubject.trim() : "";
  if (manual) return manual;
  const explicit = typeof panel?.subject === "string" ? panel.subject.trim() : "";
  if (explicit) return explicit;
  return resolvePanelSubject(panel?.description, cast?.characters || [], cast?.aliases || []);
}

function panelList(frame, panels, excludedName, cast) {
  const list = Array.isArray(panels) ? panels : [];
  const subjects = list.map((panel) => subjectOf(panel, cast));
  const kept = list.filter((_, index) => subjects[index] !== excludedName);
  const removed = list.length - kept.length;
  if (frame?.dialogueMode === "silent" || frame?.dialogueMode === "hidden") {
    return {
      removed,
      panels: kept,
      layout: kept.length >= 2 ? "split2" : "single",
      speakerPanel: null,
    };
  }
  let speakerPanel = frame?.speakerPanel;
  if (Number.isInteger(speakerPanel)) {
    if (subjects[speakerPanel] === excludedName) speakerPanel = 0;
    else speakerPanel -= subjects.slice(0, speakerPanel).filter((subject) => subject === excludedName).length;
  }
  return {
    removed,
    panels: kept,
    layout: kept.length >= 2 ? "split2" : "single",
    speakerPanel: kept.length === 1 ? 0 : speakerPanel,
  };
}

function frameSpeaks(frame) {
  if (frame?.dialogueMode === "silent" || frame?.dialogueMode === "hidden") return false;
  if (frame?.dialogueMode === "spoken") return true;
  return typeof frame?.dialogue === "string" && Boolean(frame.dialogue.trim()) && frame.sourceRole !== "action";
}

function sourceRemark(frame) {
  if (typeof frame?.dialogue === "string" && frame.dialogue.trim() && frame.sourceRole !== "action") return false;
  return frame?.sourceRole === "action" || frame?.origin === "source";
}

export function reconcileExclusion(frames, excludedName, cast) {
  const blocked = [];
  const next = [];
  for (const frame of frames || []) {
    if (frame?.directingBeat === true && Array.isArray(frame.segments)) {
      const segments = [];
      let blockedFrame = false;
      for (const segment of frame.segments) {
        const edited = panelList(segment, segment.panels, excludedName, cast);
        if (edited.removed > 0 && edited.panels.length === 0) {
          blockedFrame = true;
          break;
        }
        segments.push({
          ...segment,
          panels: edited.panels,
          layout: edited.layout,
          speakerPanel: edited.speakerPanel,
        });
      }
      if (blockedFrame) {
        blocked.push(frame.id);
        continue;
      }
      next.push({ ...frame, segments });
      continue;
    }
    const edited = panelList(frame, frame?.panels, excludedName, cast);
    if (edited.removed === 0) {
      next.push(frame);
      continue;
    }
    if (frameSpeaks(frame) || frame?.sourceRole === "utterance") {
      if (edited.panels.length === 0) {
        blocked.push(frame.id);
        continue;
      }
      next.push({
        ...frame,
        panels: edited.panels,
        layout: edited.layout,
        speakerPanel: edited.speakerPanel,
      });
      continue;
    }
    if (sourceRemark(frame)) {
      next.push(frame);
      continue;
    }
    const derived = frame?.origin === "derived" || !frame?.sourceItemId;
    if (derived && edited.panels.length === 0) continue;
    if (derived) {
      next.push({
        ...frame,
        panels: edited.panels,
        layout: edited.layout,
        speakerPanel: edited.speakerPanel,
      });
      continue;
    }
    if (edited.panels.length === 0) {
      blocked.push(frame.id);
      continue;
    }
    next.push({
      ...frame,
      panels: edited.panels,
      layout: edited.layout,
      speakerPanel: edited.speakerPanel,
    });
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      status: "blocked",
      httpStatus: 409,
      kind: "cast-reconciliation",
      frameIds: blocked,
      message: `Нельзя исключить: кадр нельзя согласовать без потери реплики (${blocked.join(", ")}).`,
    };
  }
  return { ok: true, frames: next };
}
