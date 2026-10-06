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

function piece(frame, text, composition, offset, fontSize) {
  return {
    layout: composition.layout,
    origin: "source",
    panels: composition.panels.map((panel) => ({ description: panel.description })),
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
  const copy = {
    ...frame,
    panels: Array.isArray(frame.panels) ? frame.panels.map((panel) => ({ ...panel })) : [],
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
