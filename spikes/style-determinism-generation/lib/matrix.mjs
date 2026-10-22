import {
  ATTEMPT_ORDER,
  BLIND_CODES,
  CONDITIONS,
  DISPLAY_CODE_ORDER,
  REPETITIONS,
  SOURCES,
  cellId,
  publicIdFor,
} from "./constants.mjs";
import { referencePlan } from "./prompts.mjs";

export function buildMatrix() {
  const byId = new Map();
  for (const sourceId of SOURCES) {
    for (const condition of CONDITIONS) {
      for (const repetition of REPETITIONS) {
        const id = cellId(sourceId, condition, repetition);
        byId.set(id, {
          id,
          sourceId,
          condition,
          repetition,
          blindCode: BLIND_CODES[condition],
          publicId: publicIdFor(sourceId, condition, repetition),
          roles: referencePlan(condition),
        });
      }
    }
  }
  if (byId.size !== ATTEMPT_ORDER.length || byId.size !== 12) {
    throw new Error("matrix must contain 12 cells");
  }
  return ATTEMPT_ORDER.map((id) => {
    const cell = byId.get(id);
    if (!cell) throw new Error(`missing planned cell ${id}`);
    return cell;
  });
}

export function displayGroups(cells) {
  const groups = [];
  for (const sourceId of SOURCES) {
    for (const repetition of REPETITIONS) {
      const grouped = DISPLAY_CODE_ORDER.map((blindCode) => {
        const cell = cells.find((item) => item.sourceId === sourceId && item.repetition === repetition && item.blindCode === blindCode);
        if (!cell) throw new Error(`missing display cell ${sourceId} ${blindCode} ${repetition}`);
        return cell;
      });
      groups.push({ sourceId, repetition, cells: grouped });
    }
  }
  return groups;
}
