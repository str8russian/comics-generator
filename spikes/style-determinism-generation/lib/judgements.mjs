import { ANATOMY_NOTE_MAX, JUDGEMENT_FIELDS } from "./constants.mjs";

const FIELD_OPTIONS = new Map(JUDGEMENT_FIELDS.map(([key, , options]) => [key, new Set(options)]));

export function emptyJudgements() {
  return { version: 1, updatedAt: null, cells: {} };
}

export function normalizeJudgement(fields) {
  const judgement = {};
  for (const [key, options] of FIELD_OPTIONS) {
    const value = fields?.[key];
    if (value == null || value === "") continue;
    if (!options.has(value)) return { ok: false, reason: `invalid-${key}` };
    judgement[key] = value;
  }
  if (fields?.anatomyNote != null && fields.anatomyNote !== "") {
    const note = String(fields.anatomyNote).replace(/\s+/g, " ").trim();
    if (note.length > ANATOMY_NOTE_MAX) return { ok: false, reason: "anatomy-note-too-long" };
    if (/data:image\/|\/downloads\/|bearer\s+|https?:\/\/|\/Users\/|\/home\//i.test(note)) return { ok: false, reason: "anatomy-note-unsafe" };
    if (note) judgement.anatomyNote = note;
  }
  return { ok: true, judgement };
}

export function applyJudgement(current, publicId, fields, knownPublicIds) {
  if (!knownPublicIds.has(publicId)) return { ok: false, reason: "unknown-cell" };
  const normalized = normalizeJudgement(fields);
  if (!normalized.ok) return normalized;
  const cells = { ...(current?.cells || {}) };
  if (Object.keys(normalized.judgement).length === 0) {
    delete cells[publicId];
  } else {
    cells[publicId] = normalized.judgement;
  }
  return {
    ok: true,
    judgements: {
      version: 1,
      updatedAt: new Date().toISOString(),
      cells,
    },
  };
}

export function isCompleteJudgement(judgement) {
  return JUDGEMENT_FIELDS.every(([key]) => Boolean(judgement?.[key]));
}

export function judgementPassComplete(manifest, judgements) {
  const required = (manifest?.cells || []).filter((cell) => cell.status === "succeeded");
  const judged = required.filter((cell) => isCompleteJudgement(judgements?.cells?.[cell.publicId])).length;
  return {
    complete: judged === required.length,
    judged,
    required: required.length,
  };
}

export function categoricalCounts(manifest, judgements) {
  const counts = {};
  for (const cell of manifest?.cells || []) {
    if (cell.status !== "succeeded") continue;
    const judgement = judgements?.cells?.[cell.publicId];
    if (!counts[cell.condition]) {
      counts[cell.condition] = {};
      for (const [key, , options] of JUDGEMENT_FIELDS) {
        counts[cell.condition][key] = Object.fromEntries(options.map((option) => [option, 0]));
      }
    }
    if (!judgement) continue;
    for (const [key] of JUDGEMENT_FIELDS) {
      const value = judgement[key];
      if (counts[cell.condition][key][value] != null) counts[cell.condition][key][value] += 1;
    }
  }
  return counts;
}
