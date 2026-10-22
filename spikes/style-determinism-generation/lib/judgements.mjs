import { ANATOMY_NOTE_MAX, JUDGEMENT_FIELDS } from "./constants.mjs";
import { CROSS_IDENTITY_JUDGEMENT_FIELDS } from "./cross-identity.mjs";

export function judgementFieldsFor(manifest) {
  return manifest?.profile === "cross-identity" ? CROSS_IDENTITY_JUDGEMENT_FIELDS : JUDGEMENT_FIELDS;
}

export function emptyJudgements() {
  return { version: 1, updatedAt: null, cells: {} };
}

export function normalizeJudgement(fields, fieldList = JUDGEMENT_FIELDS) {
  const fieldOptions = new Map(fieldList.map(([key, , options]) => [key, new Set(options)]));
  const judgement = {};
  for (const [key, options] of fieldOptions) {
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

export function applyJudgement(current, publicId, fields, knownPublicIds, fieldList = JUDGEMENT_FIELDS) {
  if (!knownPublicIds.has(publicId)) return { ok: false, reason: "unknown-cell" };
  const normalized = normalizeJudgement(fields, fieldList);
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

export function isCompleteJudgement(judgement, fieldList = JUDGEMENT_FIELDS) {
  return fieldList.every(([key]) => Boolean(judgement?.[key]));
}

export function judgementPassComplete(manifest, judgements) {
  const fieldList = judgementFieldsFor(manifest);
  const required = (manifest?.cells || []).filter((cell) => cell.status === "succeeded");
  const judged = required.filter((cell) => isCompleteJudgement(judgements?.cells?.[cell.publicId], fieldList)).length;
  return {
    complete: judged === required.length,
    judged,
    required: required.length,
  };
}

export function categoricalCounts(manifest, judgements) {
  const fieldList = judgementFieldsFor(manifest);
  const counts = {};
  for (const cell of manifest?.cells || []) {
    if (cell.status !== "succeeded") continue;
    const judgement = judgements?.cells?.[cell.publicId];
    if (!counts[cell.condition]) {
      counts[cell.condition] = {};
      for (const [key, , options] of fieldList) {
        counts[cell.condition][key] = Object.fromEntries(options.map((option) => [option, 0]));
      }
    }
    if (!judgement) continue;
    for (const [key] of fieldList) {
      const value = judgement[key];
      if (counts[cell.condition][key][value] != null) counts[cell.condition][key][value] += 1;
    }
  }
  return counts;
}
