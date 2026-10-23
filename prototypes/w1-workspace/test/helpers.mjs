import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../public/model.mjs";
import { createStore } from "../public/store.mjs";

export const prototypeRoot = fileURLToPath(new URL("..", import.meta.url));
export const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
export const BASE_COMMIT = "6f0865c679311046c371088bdd1b736e3747de10";

export function fixtureRaw() {
  return JSON.parse(readFileSync(new URL("../fixture/snapshot.json", import.meta.url), "utf8"));
}

export function counterIds(prefix = "id") {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

export function fixtureStore() {
  const { model, warnings } = loadSnapshot(fixtureRaw());
  return { model, warnings, store: createStore(model, { idFactory: counterIds("new") }) };
}
