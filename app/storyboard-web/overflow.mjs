const rendererHref = typeof globalThis.window === "undefined"
  ? new URL("../../prototypes/storyboard-viewer/frame-renderer.mjs", import.meta.url).href
  : new URL("/frame-renderer.mjs", import.meta.url).href;

const { FONT_LADDER } = await import(rendererHref);

function ladderFor(layout) {
  return layout === "split2" ? FONT_LADDER.split2 : FONT_LADDER.single;
}

function measureOptions(composition, fontSize) {
  return {
    layout: composition.layout,
    speakerPanel: composition.speakerPanel,
    fontSize,
    panels: composition.panels,
  };
}

function graphemeEnds(text) {
  const ends = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const part of segmenter.segment(text)) ends.push(part.index + part.segment.length);
  return ends;
}

function largestFit(text, composition, measure) {
  for (const fontSize of ladderFor(composition.layout)) {
    if (measure(text, measureOptions(composition, fontSize)) === true) return fontSize;
  }
  return null;
}

function retreat(text, cut) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let retreated = null;
  for (const part of segmenter.segment(text.slice(0, cut))) {
    if (part.index === 0 || !/^\s+$/u.test(part.segment)) continue;
    retreated = part.index + part.segment.length;
  }
  return retreated ?? cut;
}

function splitIndex(text, composition, measure) {
  const ends = graphemeEnds(text);
  const minimum = ladderFor(composition.layout).at(-1);
  let low = 0;
  let high = ends.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (measure(text.slice(0, ends[mid]), measureOptions(composition, minimum)) === true) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best < 0) return null;
  const cut = retreat(text, ends[best]);
  if (cut <= 0 || cut >= text.length) return null;
  return cut;
}

function copyPanel(panel) {
  return { ...panel };
}

function frameVisualReady(panels) {
  return Array.isArray(panels) && panels.length > 0 && panels.every((panel) => Boolean(panel?.assetId));
}

function piece(frame, text, composition, offset, fontSize) {
  const panels = (composition.panels || []).map(copyPanel);
  return {
    layout: composition.layout,
    origin: "source",
    panels,
    sourceItemId: frame.sourceItemId,
    sourceRole: "utterance",
    speakerPanel: composition.speakerPanel,
    dialogue: text,
    displayBlock: {
      sourceItemId: frame.sourceItemId,
      start: offset,
      end: offset + text.length,
    },
    fontSize,
    visualReady: frameVisualReady(panels),
  };
}

function compileQuote(frame, text, composition, offset, measure) {
  const fitted = largestFit(text, composition, measure);
  if (fitted != null) return { ok: true, frames: [piece(frame, text, composition, offset, fitted)] };
  const cut = splitIndex(text, composition, measure);
  if (cut == null) {
    return { ok: false, failures: [{ code: "invalid-display-block", sourceItemId: frame.sourceItemId }] };
  }
  const left = compileQuote(frame, text.slice(0, cut), composition, offset, measure);
  if (!left.ok) return left;
  const right = compileQuote(frame, text.slice(cut), composition, offset + cut, measure);
  if (!right.ok) return right;
  return { ok: true, frames: [...left.frames, ...right.frames] };
}

function partition(dialogue, segments) {
  if (typeof dialogue !== "string" || !Array.isArray(segments) || segments.length < 2) return null;
  let cursor = 0;
  const ranges = [];
  for (const segment of segments) {
    if (typeof segment.quote !== "string" || segment.quote.length === 0) return null;
    if (!dialogue.startsWith(segment.quote, cursor)) return null;
    ranges.push({ start: cursor, end: cursor + segment.quote.length });
    cursor += segment.quote.length;
  }
  if (cursor !== dialogue.length) return null;
  return ranges;
}

function withIds(frame, frames) {
  if (frames.length === 1) return [{ ...frames[0], id: frame.id }];
  return frames.map((pieceFrame, index) => ({ ...pieceFrame, id: `${frame.id}#${index + 1}` }));
}

function compileDirecting(frame, measure) {
  const ranges = partition(frame.dialogue, frame.segments);
  if (!ranges) {
    return { ok: false, failures: [{ code: "invalid-directing-beat", sourceItemId: frame.sourceItemId }] };
  }
  const frames = [];
  for (let index = 0; index < frame.segments.length; index += 1) {
    const segment = frame.segments[index];
    const built = compileQuote(frame, segment.quote, {
      layout: segment.layout,
      speakerPanel: segment.speakerPanel,
      panels: segment.panels,
    }, ranges[index].start, measure);
    if (!built.ok) return built;
    frames.push(...built.frames);
  }
  return { ok: true, frames: withIds(frame, frames) };
}

function copySilent(frame) {
  const panels = Array.isArray(frame.panels) ? frame.panels.map(copyPanel) : [];
  const copy = {
    ...frame,
    panels,
    visualReady: frameVisualReady(panels),
  };
  delete copy.fontSize;
  return copy;
}

export function compileOverflow(frames, measure) {
  const next = [];
  for (const frame of frames) {
    if (!frame || typeof frame.dialogue !== "string" || frame.dialogue.length === 0) {
      next.push(copySilent(frame));
      continue;
    }
    if (frame.directingBeat === true && Array.isArray(frame.segments)) {
      const directed = compileDirecting(frame, measure);
      if (!directed.ok) return directed;
      next.push(...directed.frames);
      continue;
    }
    const built = compileQuote(frame, frame.dialogue, {
      layout: frame.layout,
      speakerPanel: frame.speakerPanel,
      panels: frame.panels,
    }, frame.displayBlock && Number.isInteger(frame.displayBlock.start) ? frame.displayBlock.start : 0, measure);
    if (!built.ok) return built;
    next.push(...withIds(frame, built.frames));
  }
  return { ok: true, frames: next };
}

function graphemeBoundary(text, index) {
  if (!Number.isInteger(index) || index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const part of segmenter.segment(text)) {
    if (part.index === index) return true;
    if (part.index > index) return false;
  }
  return false;
}

function diagnoseDialogue(text, blocks) {
  if (blocks.length === 0) return text.length === 0 ? null : "lost-dialogue";
  for (const block of blocks) {
    if (!Number.isInteger(block.start) || !Number.isInteger(block.end)) return "invalid-display-block";
    if (block.start < 0 || block.end > text.length || block.start >= block.end) return "invalid-display-block";
    if (!graphemeBoundary(text, block.start) || !graphemeBoundary(text, block.end)) return "invalid-display-block";
  }
  const ordered = blocks.every((block, index) => index === 0 || blocks[index - 1].end <= block.start);
  const ranges = blocks.map((block) => ({ start: block.start, end: block.end }));
  const sorted = ranges.slice().sort((left, right) => left.start - right.start || left.end - right.end);
  let overlap = false;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) overlap = true;
  }
  if (overlap) return "duplicated-dialogue";
  if (!ordered) return "reordered-dialogue";
  let cursor = 0;
  for (const block of sorted) {
    if (block.start !== cursor) return "lost-dialogue";
    cursor = block.end;
  }
  if (cursor !== text.length) return "lost-dialogue";
  const joined = blocks.map((block) => block.dialogue ?? "").join("");
  if (joined !== text || blocks.some((block) => block.dialogue !== text.slice(block.start, block.end))) {
    return "changed-wording";
  }
  return null;
}

export function assessDialogue(sourceItems, frames) {
  const failures = [];
  const spoken = new Map(sourceItems.filter((item) => item.kind === "utterance").map((item) => [item.id, item.text]));
  const groups = new Map();
  for (const frame of frames) {
    if (frame?.displayBlock && frame.sourceRole !== "action") {
      const frameId = frame.sourceItemId;
      const blockId = frame.displayBlock.sourceItemId;
      const sameUtterance = typeof frameId === "string"
        && frameId === blockId
        && spoken.has(frameId);
      if (!sameUtterance) {
        failures.push({ code: "invalid-display-block", sourceItemId: frameId || blockId });
      }
    }
    const blockId = frame?.displayBlock?.sourceItemId;
    const sourceItemId = spoken.has(frame?.sourceItemId) ? frame.sourceItemId : (spoken.has(blockId) ? blockId : null);
    if (!sourceItemId) continue;
    if (frame.sourceRole && frame.sourceRole !== "utterance") continue;
    if (!groups.has(sourceItemId)) groups.set(sourceItemId, []);
    if (frame.directingBeat === true && Array.isArray(frame.segments) && frame.segments.every((segment) => Number.isInteger(segment.start))) {
      for (const segment of frame.segments) {
        groups.get(sourceItemId).push({
          start: segment.start,
          end: segment.end,
          dialogue: segment.quote ?? "",
        });
      }
    } else if (frame.displayBlock) {
      groups.get(sourceItemId).push({
        start: frame.displayBlock.start,
        end: frame.displayBlock.end,
        dialogue: frame.dialogue ?? "",
      });
    }
  }
  for (const [sourceItemId, text] of spoken) {
    const code = diagnoseDialogue(text, groups.get(sourceItemId) || []);
    if (code) failures.push({ code, sourceItemId });
  }
  if (failures.length === 0) return { ok: true };
  const seen = new Set();
  const unique = [];
  for (const failure of failures) {
    const key = `${failure.code}\0${failure.sourceItemId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(failure);
  }
  return { ok: false, failures: unique };
}

const FAILED_KINDS = new Set([
  "provider",
  "invalid-output",
  "timeout",
  "configuration",
  "invalid-request",
  "measurement",
]);

export function pageState({ http, fitted, dialogue, measurementError } = {}) {
  if (measurementError) return { state: "failed", kind: "measurement", ready: false };
  if (http && http.status === "blocked") {
    return {
      state: "blocked",
      codes: (http.failures || []).map((failure) => failure.code),
      ready: false,
    };
  }
  if (http && http.status === "failed") {
    const kind = FAILED_KINDS.has(http.kind) ? http.kind : "invalid-request";
    return { state: "failed", kind, ready: false };
  }
  if (fitted && fitted.ok === false) {
    return {
      state: "blocked",
      codes: (fitted.failures || []).map((failure) => failure.code),
      ready: false,
    };
  }
  if (dialogue && dialogue.ok === false) {
    return {
      state: "blocked",
      codes: (dialogue.failures || []).map((failure) => failure.code),
      ready: false,
    };
  }
  if (http && http.status === "checked" && fitted && fitted.ok !== false && (!dialogue || dialogue.ok !== false)) {
    return { state: "ready", ready: true };
  }
  return { state: "failed", kind: "invalid-request", ready: false };
}
