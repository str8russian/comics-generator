function nextSeparator(text, from) {
  let best = null;
  const consider = (index, value, rank) => {
    if (index < 0) return;
    if (!best || index < best.index || (index === best.index && rank < best.rank)) {
      best = { index, text: value, rank };
    }
  };
  consider(text.indexOf("\r\n", from), "\r\n", 0);
  consider(text.indexOf("\n", from), "\n", 1);
  consider(text.indexOf("\r", from), "\r", 2);
  if (!best) return null;
  return { index: best.index, text: best.text };
}

export function segmentDraft(text) {
  const segments = [];
  const separators = [];
  let cursor = 0;
  let index = 0;
  while (true) {
    const found = nextSeparator(text, cursor);
    const end = found ? found.index : text.length;
    segments.push({
      id: `seg-${index}`,
      text: text.slice(cursor, end),
      draftStart: cursor,
      draftEnd: end,
    });
    index += 1;
    if (!found) break;
    separators.push({
      text: found.text,
      draftStart: found.index,
      draftEnd: found.index + found.text.length,
    });
    cursor = found.index + found.text.length;
  }
  return { segments, separators };
}
