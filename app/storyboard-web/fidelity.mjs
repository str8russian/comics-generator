import { segmentDraft } from "./segment.mjs";

const CODE_ORDER = [
  "empty-draft",
  "duplicate-id",
  "invalid-coverage",
  "invalid-anchor",
  "ambiguous-anchor",
  "overlapping-anchor",
  "invalid-speaker-label",
  "unresolved-speaker",
  "unknown-source-item",
  "invalid-source-role",
  "unaccounted-source-item",
  "invalid-derived-beat",
  "reordered-review",
  "invalid-directing-beat",
  "lost-dialogue",
  "duplicated-dialogue",
  "reordered-dialogue",
  "changed-wording",
  "invalid-display-block",
];

function settle(failures) {
  const seen = new Set();
  const unique = [];
  for (const failure of failures) {
    if (seen.has(failure.code)) continue;
    seen.add(failure.code);
    unique.push(failure);
  }
  unique.sort((left, right) => CODE_ORDER.indexOf(left.code) - CODE_ORDER.indexOf(right.code));
  if (unique.length === 0) return { ok: true };
  return { ok: false, failures: unique };
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

export function isEmptyDraft(text) {
  if (typeof text !== "string" || text.length === 0) return true;
  const { separators } = segmentDraft(text);
  const separatorRanges = separators.map((separator) => [separator.draftStart, separator.draftEnd]);
  for (let index = 0; index < text.length; index += 1) {
    if (!isServerOwned(text, index, separatorRanges)) return false;
  }
  return true;
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

function countOrderedAssignments(candidates) {
  let count = 0;
  let assignment = null;
  const chosen = [];
  const walk = (index, previousEnd) => {
    if (count >= 2) return;
    if (index === candidates.length) {
      count += 1;
      if (count === 1) assignment = chosen.map((span) => ({ start: span.start, end: span.end }));
      return;
    }
    for (const candidate of candidates[index]) {
      if (count >= 2) return;
      if (candidate.start < previousEnd) continue;
      chosen.push(candidate);
      walk(index + 1, candidate.end);
      chosen.pop();
    }
  };
  walk(0, 0);
  return { count, assignment };
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
    return settle([{ code: "invalid-anchor" }]);
  }
  const failures = [];
  const seenIds = new Set();
  for (const item of sourceItems) {
    if (!item || seenIds.has(item.id)) failures.push({ code: "duplicate-id", sourceItemId: item && item.id });
    else seenIds.add(item.id);
    if (item && item.speakerStatus === "unresolved") {
      failures.push({ code: "unresolved-speaker", sourceItemId: item.id });
    }
  }

  const { segments, separators } = segmentDraft(draftText);
  const separatorRanges = separators.map((separator) => [separator.draftStart, separator.draftEnd]);
  const candidates = [];
  let searchable = true;
  for (const item of sourceItems) {
    if (!item || typeof item.sourceQuote !== "string" || !/\S/u.test(item.sourceQuote)) {
      failures.push({ code: "invalid-anchor", sourceItemId: item && item.id });
      candidates.push([]);
      searchable = false;
      continue;
    }
    const window = windowFor(segments, item.segmentIds);
    if (!window) {
      failures.push({ code: "invalid-coverage", sourceItemId: item.id });
      candidates.push([]);
      searchable = false;
      continue;
    }
    const found = findCandidates(draftText, item.sourceQuote, window);
    if (found.length === 0) {
      failures.push({ code: "invalid-anchor", sourceItemId: item.id });
      searchable = false;
    }
    candidates.push(found);
  }

  if (!searchable) return settle(failures);

  const { count, assignment } = countOrderedAssignments(candidates);
  if (count > 1) return settle([...failures, { code: "ambiguous-anchor" }]);
  if (count === 0) {
    return settle([...failures, { code: canPack(candidates) ? "reordered-dialogue" : "overlapping-anchor" }]);
  }

  const covered = new Array(draftText.length).fill(0);
  for (const span of assignment) {
    for (let index = span.start; index < span.end; index += 1) covered[index] += 1;
  }
  let overlapped = false;
  let uncovered = false;
  for (let index = 0; index < draftText.length; index += 1) {
    if (covered[index] > 1) overlapped = true;
    else if (covered[index] === 0 && !isServerOwned(draftText, index, separatorRanges)) uncovered = true;
  }
  if (overlapped) failures.push({ code: "overlapping-anchor" });
  if (uncovered) failures.push({ code: "invalid-coverage" });

  const anchored = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    const span = assignment[index];
    const slice = draftText.slice(span.start, span.end);
    const spoken = spokenText(item, slice);
    if (!spoken.ok) {
      failures.push({ code: spoken.code, sourceItemId: item.id });
      continue;
    }
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

  const settled = settle(failures);
  if (!settled.ok) return settled;
  return { ok: true, sourceItems: anchored };
}

function sourceIndex(sourceItems, id) {
  return sourceItems.findIndex((item) => item.id === id);
}

function compositionKey(value) {
  return JSON.stringify({
    layout: value.layout,
    speakerPanel: value.speakerPanel,
    panels: (value.panels || []).map((panel) => panel.description),
  });
}

function placementKey(placement, sourceItems) {
  if (!placement) return { key: null, valid: false };
  const afterId = placement.afterSourceItemId;
  const beforeId = placement.beforeSourceItemId;
  const unknown = [];
  if (afterId && sourceIndex(sourceItems, afterId) < 0) unknown.push(afterId);
  if (beforeId && sourceIndex(sourceItems, beforeId) < 0) unknown.push(beforeId);
  if (unknown.length > 0) return { key: null, valid: false, unknown };
  if (afterId && beforeId) {
    const after = sourceIndex(sourceItems, afterId);
    const before = sourceIndex(sourceItems, beforeId);
    if (before !== after + 1) return { key: null, valid: false };
    return { key: before, valid: true };
  }
  if (beforeId) {
    if (sourceIndex(sourceItems, beforeId) !== 0) return { key: null, valid: false };
    return { key: 0, valid: true };
  }
  if (afterId) {
    if (sourceIndex(sourceItems, afterId) !== sourceItems.length - 1) return { key: null, valid: false };
    return { key: sourceItems.length, valid: true };
  }
  return { key: null, valid: false };
}

function checkDirecting(frame, item, failures) {
  const segments = frame.segments;
  if (!Array.isArray(segments) || segments.length < 2) {
    failures.push({ code: "invalid-directing-beat", sourceItemId: item.id });
    return;
  }
  let cursor = 0;
  let partitioned = true;
  for (const segment of segments) {
    if (typeof segment.quote !== "string" || !item.text.startsWith(segment.quote, cursor)) {
      partitioned = false;
      break;
    }
    cursor += segment.quote.length;
  }
  if (!partitioned || cursor !== item.text.length) {
    failures.push({ code: "invalid-directing-beat", sourceItemId: item.id });
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (compositionKey(segments[index - 1]) === compositionKey(segments[index])) {
      failures.push({ code: "invalid-directing-beat", sourceItemId: item.id });
    }
  }
  if (compositionKey(frame) !== compositionKey(segments[0])) {
    failures.push({ code: "invalid-directing-beat", sourceItemId: item.id });
  }
}

export function assessStage(sourceItems, stage) {
  const failures = [];
  const frames = Array.isArray(stage?.frames) ? stage.frames : [];
  const review = Array.isArray(stage?.review) ? stage.review : [];
  const byId = new Map();
  const seenSource = new Set();
  for (const item of sourceItems) {
    if (seenSource.has(item.id)) failures.push({ code: "duplicate-id", sourceItemId: item.id });
    else {
      seenSource.add(item.id);
      byId.set(item.id, item);
    }
  }
  const seenFrames = new Set();
  for (const frame of frames) {
    if (seenFrames.has(frame.id)) failures.push({ code: "duplicate-id", sourceItemId: frame.sourceItemId });
    else seenFrames.add(frame.id);
  }

  const accounts = new Map();
  const keys = [];
  for (const frame of frames) {
    if (frame.origin === "derived") {
      const placed = placementKey(frame.placement, sourceItems);
      if (placed.unknown) {
        for (const id of placed.unknown) failures.push({ code: "unknown-source-item", sourceItemId: id });
      } else if (!placed.valid) {
        failures.push({ code: "invalid-derived-beat" });
      }
      keys.push(placed.valid ? placed.key : null);
      continue;
    }
    const item = byId.get(frame.sourceItemId);
    if (!item) {
      failures.push({ code: "unknown-source-item", sourceItemId: frame.sourceItemId });
      keys.push(null);
      continue;
    }
    if (frame.sourceRole !== item.kind) failures.push({ code: "invalid-source-role", sourceItemId: item.id });
    accounts.set(item.id, (accounts.get(item.id) || 0) + 1);
    if (frame.directingBeat === true) checkDirecting(frame, item, failures);
    keys.push(sourceIndex(sourceItems, item.id) + 0.5);
  }

  for (const item of sourceItems) {
    if (item.kind !== "utterance" && item.kind !== "action") continue;
    if (accounts.get(item.id) !== 1) failures.push({ code: "unaccounted-source-item", sourceItemId: item.id });
  }

  const expectedReview = sourceItems
    .filter((item) => item.kind === "context" || item.kind === "note")
    .map((item) => item.id);
  const actualReview = [];
  for (const id of review) {
    const item = byId.get(id);
    if (!item) {
      failures.push({ code: "unknown-source-item", sourceItemId: id });
      continue;
    }
    if (item.kind === "context" || item.kind === "note") actualReview.push(id);
  }
  for (const id of expectedReview) {
    if (!review.includes(id)) failures.push({ code: "unaccounted-source-item", sourceItemId: id });
  }
  const sameReviewSet = expectedReview.length === actualReview.length
    && expectedReview.every((id) => actualReview.includes(id));
  if (sameReviewSet && expectedReview.some((id, index) => actualReview[index] !== id)) {
    failures.push({ code: "reordered-review" });
  }

  let previous = null;
  const sourceKeys = new Set();
  for (const key of keys) {
    if (key == null) continue;
    const sourceKey = !Number.isInteger(key);
    if (sourceKey && sourceKeys.has(key)) failures.push({ code: "invalid-derived-beat" });
    if (sourceKey) sourceKeys.add(key);
    if (previous != null && key < previous) failures.push({ code: "invalid-derived-beat" });
    if (previous != null && key === previous && sourceKey) failures.push({ code: "invalid-derived-beat" });
    previous = key;
  }

  return settle(failures);
}
