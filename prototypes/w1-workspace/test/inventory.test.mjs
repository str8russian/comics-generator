import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { STUBBED_OPERATIONS, WIRED_OPERATIONS } from "../public/store.mjs";
import { prototypeRoot, repoRoot } from "./helpers.mjs";

const web = join(repoRoot, "app/storyboard-web");
const read = (path) => readFileSync(join(web, path), "utf8");
const PLACEMENTS = ["Always visible", "Contextual", "Inspector", "Frame Editor", "Panel Editor", "More", "Stage view", "Not shown"];

function functionBody(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end);
}

function blockAfter(text, opener, closer) {
  const start = text.indexOf(opener);
  assert.ok(start >= 0, `missing ${opener}`);
  return text.slice(start + opener.length, text.indexOf(closer, start));
}

// Authoritative: POST /api/visual/operations -> visualStore.applyOperation ->
// applyProductOperation (visual-store.mjs), which handles uploadAsset and
// assignAsset itself and delegates every other op to applyOperation (assembly.mjs).
export function productionDispatcherOps() {
  const assembly = functionBody(read("assembly.mjs"), "export function applyOperation(");
  const store = functionBody(read("visual-store.mjs"), "export async function applyProductOperation(");
  const names = new Set();
  for (const match of assembly.matchAll(/op === "([\w-]+)"/g)) names.add(match[1]);
  for (const match of store.matchAll(/op(?:eration)?\??\.op === "([\w-]+)"/g)) names.add(match[1]);
  return names;
}

export function versionInstructionNames() {
  const labels = blockAfter(read("visual-store.mjs"), "const UNDO_LABELS = {", "};");
  return new Set([...labels.matchAll(/^\s*"?([\w-]+)"?\s*:/gm)].map((match) => match[1]));
}

export function storeActions() {
  return new Set([...read("server.mjs").matchAll(/handleVisualSimple\([^)]*action: "(\w+)"/g)].map((match) => match[1]));
}

export function uiSemanticActions() {
  const names = new Set();
  const map = blockAfter(read("public/app.js"), "const semanticAction = {", "}[operation?.op]");
  for (const match of map.matchAll(/(\w+): "(\w+)"/g)) {
    names.add(match[1]);
    names.add(match[2]);
  }
  names.add("storyboard_edit");
  for (const file of ["public/app.js", "public/anchor-session-ui.mjs", "public/research-dock.mjs", "server.mjs"]) {
    for (const match of read(file).matchAll(/semanticAction: "([a-z_]+)"/g)) names.add(match[1]);
  }
  return names;
}

function inventory() {
  return readFileSync(join(prototypeRoot, "OPERATIONS_INVENTORY.md"), "utf8");
}

function listed(text) {
  return new Set([...text.matchAll(/`([\w:.-]+)`/g)].map((match) => match[1]));
}

test("the production dispatcher list is derived from code and is non-trivial", () => {
  const ops = productionDispatcherOps();
  for (const op of ["duplicateFrame", "setFrameDialogue", "insertFrame", "uploadAsset", "assignAsset", "batch"]) {
    assert.ok(ops.has(op), op);
  }
  assert.ok(ops.size >= 14, [...ops].join(", "));
});

test("every production dispatcher operation appears in OPERATIONS_INVENTORY.md", () => {
  const names = listed(inventory());
  const missing = [...productionDispatcherOps()].filter((op) => !names.has(op));
  assert.deepEqual(missing, []);
});

test("every version instruction, store action, and UI semantic action appears too", () => {
  const names = listed(inventory());
  const all = [...versionInstructionNames(), ...storeActions(), ...uiSemanticActions()];
  assert.deepEqual(all.filter((name) => !names.has(name)), []);
});

test("every inventory row records a known placement", () => {
  const rows = inventory().split("\n").filter((line) => /^\|\s*`/.test(line));
  assert.ok(rows.length >= 30, `${rows.length} rows`);
  for (const row of rows) {
    const cells = row.split("|").map((cell) => cell.trim());
    const placement = cells[6];
    assert.ok(PLACEMENTS.some((label) => placement.startsWith(label)), `bad placement in: ${row}`);
  }
});

test("the prototype dispatcher is keyed by real production names", () => {
  const production = new Set([...productionDispatcherOps(), ...versionInstructionNames(), ...storeActions(), ...uiSemanticActions()]);
  for (const op of WIRED_OPERATIONS) assert.ok(production.has(op), op);
  for (const op of Object.keys(STUBBED_OPERATIONS)) {
    assert.ok(production.has(op) || op.startsWith("future:"), op);
  }
});
