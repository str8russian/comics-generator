import { segmentDraft } from "./segment.mjs";

function failure(code, sourceItemId) {
  const entry = { code };
  if (sourceItemId) entry.sourceItemId = sourceItemId;
  return { ok: false, failures: [entry] };
}

function isScalarBoundary(text, index) {
  if (index <= 0 || index >= text.length) return true;
  const previous = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return !(previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF);
}

function isHorizontalWhitespace(unit) {
  if (unit === "\n" || unit === "\r" || unit === "\u2028" || unit === "\u2029") return false;
  return /^\s$/u.test(unit);
}

function isServerOwned(text, index, separatorRanges) {
  for (const [start, end] of separatorRanges) {
    if (index >= start && index < end) return true;
  }
  return isHorizontalWhitespace(text[index]);
}

function hasSourceCharacter(text) {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text[index];
    if (unit === "\n" || unit === "\r") continue;
    if (!isHorizontalWhitespace(unit)) return true;
  }
  return false;
}

function windowFor(segments, segmentIds) {
  if (!Array.isArray(segmentIds) || segmentIds.length === 0) return null;
  const byId = new Map(segments.map((segment, index) => [segment.id, index]));
  const indexes = [];
  for (const id of segmentIds) {
    const index = byId.get(id);
    if (index == null) return null;
    indexes.push(index);
  }
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] !== indexes[index - 1] + 1) return null;
  }
  return {
    start: segments[indexes[0]].draftStart,
    end: segments[indexes[indexes.length - 1]].draftEnd,
  };
}

function findCandidates(draft, quote, window) {
  const found = [];
  let from = window.start;
  while (from <= window.end - quote.length) {
    const index = draft.indexOf(quote, from);
    if (index < 0 || index + quote.length > window.end) break;
    const end = index + quote.length;
    if (isScalarBoundary(draft, index) && isScalarBoundary(draft, end)) {
      found.push({ start: index, end });
    }
    from = index + 1;
  }
  return found;
}

function canPack(candidates) {
  const picked = [];
  const walk = (index) => {
    if (index === candidates.length) {
      const sorted = picked.slice().sort((left, right) => left.start - right.start || left.end - right.end);
      for (let cursor = 1; cursor < sorted.length; cursor += 1) {
        if (sorted[cursor].start < sorted[cursor - 1].end) return false;
      }
      return true;
    }
    for (const candidate of candidates[index]) {
      picked.push(candidate);
      if (walk(index + 1)) return true;
      picked.pop();
    }
    return false;
  };
  return walk(0);
}

function orderedAssignments(candidates) {
  const results = [];
  const chosen = [];
  const walk = (index, previousEnd) => {
    if (index === candidates.length) {
      results.push(chosen.map((span) => ({ ...span })));
      return;
    }
    for (const candidate of candidates[index]) {
      if (candidate.start < previousEnd) continue;
      chosen.push(candidate);
      walk(index + 1, candidate.end);
      chosen.pop();
    }
  };
  walk(0, 0);
  return results;
}

function spokenText(item, slice) {
  if (item.speakerStatus !== "explicit") {
    return { ok: true, text: slice, prefixLength: 0 };
  }
  const label = item.speakerLabel;
  if (typeof label !== "string" || label.length === 0) {
    return { ok: false, code: "invalid-speaker-label" };
  }
  const withSpace = `${label}: `;
  const bare = `${label}:`;
  let prefixLength = -1;
  if (slice.startsWith(withSpace)) prefixLength = withSpace.length;
  else if (slice.startsWith(bare)) prefixLength = bare.length;
  if (prefixLength < 0) return { ok: false, code: "invalid-speaker-label" };
  const text = slice.slice(prefixLength);
  if (!hasSourceCharacter(text)) return { ok: false, code: "invalid-speaker-label" };
  return { ok: true, text, prefixLength };
}

export function anchorDraft(draftText, sourceItems) {
  if (typeof draftText !== "string" || !Array.isArray(sourceItems)) {
    return failure("invalid-anchor");
  }
  const { segments, separators } = segmentDraft(draftText);
  const separatorRanges = separators.map((separator) => [separator.draftStart, separator.draftEnd]);
  const windows = [];
  for (const item of sourceItems) {
    if (!item || typeof item.sourceQuote !== "string" || !/\S/u.test(item.sourceQuote)) {
      return failure("invalid-anchor", item && item.id);
    }
    const window = windowFor(segments, item.segmentIds);
    if (!window) return failure("invalid-coverage", item.id);
    windows.push(window);
  }

  const candidates = sourceItems.map((item, index) => findCandidates(draftText, item.sourceQuote, windows[index]));
  const missing = candidates.findIndex((list) => list.length === 0);
  if (missing >= 0) return failure("invalid-anchor", sourceItems[missing].id);

  const assignments = orderedAssignments(candidates);
  if (assignments.length !== 1) {
    if (assignments.length > 1) return failure("ambiguous-anchor");
    return failure(canPack(candidates) ? "reordered-dialogue" : "overlapping-anchor");
  }

  const chosen = assignments[0];
  const covered = new Array(draftText.length).fill(0);
  for (const span of chosen) {
    for (let index = span.start; index < span.end; index += 1) covered[index] += 1;
  }
  for (let index = 0; index < draftText.length; index += 1) {
    if (covered[index] > 1) return failure("overlapping-anchor");
    if (covered[index] === 0 && !isServerOwned(draftText, index, separatorRanges)) {
      return failure("invalid-coverage");
    }
  }

  const anchored = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    const span = chosen[index];
    const slice = draftText.slice(span.start, span.end);
    const spoken = spokenText(item, slice);
    if (!spoken.ok) return failure(spoken.code, item.id);
    const next = {
      id: item.id,
      kind: item.kind,
      segmentIds: item.segmentIds.slice(),
      speakerStatus: item.speakerStatus,
      sourceQuote: item.sourceQuote,
      draftStart: span.start,
      draftEnd: span.end,
      text: spoken.text,
      prefixLength: spoken.prefixLength,
    };
    if (item.speakerLabel) next.speakerLabel = item.speakerLabel;
    anchored.push(next);
  }
  return { ok: true, sourceItems: anchored };
}
