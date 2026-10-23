// In-memory workspace store with one dispatcher keyed by production operation
// names. Manual controls and the (mock) assistant both go through dispatch();
// nothing is written anywhere and a reload restores the snapshot.

import { displayFrames, findDisplayFrame } from "./model.mjs";
import {
  defaultIdFactory,
  duplicateFrame,
  resolvePlacementUpdate,
  setFrameDialogue,
} from "./operations.mjs";

export const WIRED_OPERATIONS = Object.freeze([
  "duplicateFrame",
  "setFrameDialogue",
  "placement",
  "undoStoryboardEdit",
]);

export const PROTOTYPE_ONLY_OPERATIONS = Object.freeze(["resetToSnapshot"]);

// Production names (dispatcher ops, store actions, or research semantic
// actions) that exist today but are deliberately not wired here, plus the
// labelled future entry points. Each resolves to an explanation, not a change.
export const STUBBED_OPERATIONS = Object.freeze({
  insertFrame: "Inserts a blank image frame or text card after this frame.",
  deleteFrame: "Deletes the whole structural frame.",
  reorderFrames: "Moves the structural frame earlier or later.",
  addPanel: "Adds a second panel and switches the layout from single to split2.",
  deletePanel: "Removes one panel of a split2 frame and switches it back to single.",
  reorderPanels: "Swaps the two panels of a split2 frame; the speaker moves with its panel.",
  setDuration: "Sets the frame duration in frames (30 fps); cannot cut typed dialogue short.",
  setTextCard: "Edits owner-authored text-card text (not source dialogue).",
  setManualSubject: "Chooses the cast character for a manual panel.",
  setOwnerDescription: "Stores an owner note on a panel. Accepted by production but no current UI control calls it.",
  uploadAsset: "Uploads a PNG/JPEG/WebP and assigns it to the panel. No image provider call.",
  assignAsset: "Assigns an image already in this storyboard to the panel. No image provider call.",
  batch: "Applies several assembly operations as one version. W1 has no multi-select or batch.",
  "panel-generation": "Generates or regenerates this panel image. Calls the image provider.",
  frame_generate: "Generates every missing panel image of this frame. Calls the image provider.",
  approveVisual: "Records Visual approval for the current storyboard version (required gate before Video).",
  structure_edit: "Applies a natural-language structure edit to the whole storyboard. Calls the text provider.",
  source_utterance_edit: "Edits the whole source utterance. Today this also rewrites the dialogue draft (known deferred issue).",
  render: "Starts the local Remotion render of the approved storyboard.",
  reading: "Reads the dialogue draft into source items. Calls the text provider.",
  confirm_material: "Confirms the extracted characters and aliases.",
  stage_storyboard: "Stages the complete Structure storyboard. Calls the text provider.",
  cast_edit: "Renames, includes/excludes, or reassigns characters, aliases, and speakers.",
  anchor_generate: "Opens the base-image session (upload a ready anchor or generate from a photo).",
  anchor_approve: "Accepts the selected base-image candidate.",
  anchor_retire: "Deletes the accepted base image (recoverable in this session).",
  anchor_restore: "Restores a deleted base image.",
  "future:refineCurrent": "R2: revise this panel image starting from the current basis.",
  "future:newVariation": "R2: create an independent new variation of this panel.",
  "future:attachPerformanceReference": "R3: attach a performance photo to this panel's visual state.",
  "future:applyPlan": "W3: apply an assistant plan as one undoable operation.",
});

const UNDO_LABELS = {
  duplicateFrame: "duplicate frame",
  setFrameDialogue: "frame dialogue",
  placement: "framing",
};

function fail(kind, extra = {}) {
  return { ok: false, changed: false, kind, ...extra };
}

export function createStore(model, { idFactory = defaultIdFactory } = {}) {
  const initial = Object.freeze({
    frames: structuredClone(model.storyboard.frames),
    panelStates: structuredClone(model.panelStates),
  });
  let current = structuredClone(initial);
  let history = [];
  let selection = { frame: null, panelId: null };
  const trace = [];
  const listeners = new Set();

  function view() {
    return {
      ...model,
      storyboard: { ...model.storyboard, frames: current.frames },
      panelStates: current.panelStates,
    };
  }

  function frames() {
    return displayFrames(view());
  }

  function notify(result) {
    for (const listener of listeners) listener(result);
  }

  function commit(op, next, context = {}) {
    const displayNumber = Number.isInteger(context.displayNumber) ? context.displayNumber : null;
    history.push({
      op,
      label: UNDO_LABELS[op] || op,
      displayNumber,
      before: current,
      context,
    });
    current = next;
  }

  function selectedFrameStillExists() {
    return Boolean(selection.frame && findDisplayFrame(frames(), selection.frame));
  }

  const handlers = {
    duplicateFrame(operation) {
      const before = frames();
      const source = findDisplayFrame(before, operation);
      const result = duplicateFrame(current.frames, operation, idFactory);
      if (!result.ok) return fail(result.kind);
      const panelStates = structuredClone(current.panelStates);
      for (const copy of result.duplicate.panelCopies) {
        const from = current.panelStates[copy.sourcePanelId];
        if (!from) continue;
        panelStates[copy.panelId] = { ...structuredClone(from), generationStatus: null, generationError: null };
      }
      const { source: sourceAddress, created } = result.duplicate;
      commit("duplicateFrame", { frames: result.frames, panelStates }, {
        displayNumber: source?.number ?? null,
        source: sourceAddress,
        created,
      });
      selection = { frame: { ...created }, panelId: null };
      const createdFrame = findDisplayFrame(frames(), created);
      return {
        ok: true,
        changed: true,
        operationResult: {
          op: "duplicateFrame",
          source: sourceAddress,
          created,
          createdDisplayNumber: createdFrame?.number ?? null,
        },
      };
    },

    setFrameDialogue(operation) {
      const target = findDisplayFrame(frames(), operation);
      const result = setFrameDialogue(current.frames, operation);
      if (!result.ok) return fail(result.kind);
      if (JSON.stringify(result.frames) === JSON.stringify(current.frames)) return { ok: true, changed: false };
      commit("setFrameDialogue", { frames: result.frames, panelStates: current.panelStates }, {
        displayNumber: target?.number ?? null,
      });
      return { ok: true, changed: true };
    },

    placement(operation) {
      const list = frames();
      const frame = list.find((entry) => entry.id === operation.frameId);
      const panel = frame?.panels?.[operation.panelIndex];
      if (!frame || !panel || !Number.isInteger(operation.panelIndex)) return fail("not-found");
      const existing = current.panelStates[panel.id] ?? {};
      const resolved = resolvePlacementUpdate(existing, operation);
      if (!resolved) return fail("invalid-request");
      const unchanged = Number(existing.zoom ?? 1) === resolved.zoom
        && Number(existing.positionX ?? 50) === resolved.positionX
        && Number(existing.positionY ?? 30) === resolved.positionY
        && (existing.mirrored === true) === resolved.mirrored;
      if (unchanged) return { ok: true, changed: false, placement: resolved };
      const panelStates = structuredClone(current.panelStates);
      panelStates[panel.id] = { ...existing, ...resolved };
      commit("placement", { frames: current.frames, panelStates }, {
        displayNumber: frame.number,
        panelIndex: operation.panelIndex,
      });
      return { ok: true, changed: true, placement: resolved };
    },

    undoStoryboardEdit() {
      const entry = history.pop();
      if (!entry) return fail("nothing-to-undo");
      current = entry.before;
      const viewingCopy = entry.op === "duplicateFrame"
        && selection.frame?.structureFrameId === entry.context.created?.structureFrameId;
      if (viewingCopy) selection = { frame: { ...entry.context.source }, panelId: null };
      else if (!selectedFrameStillExists()) selection = { frame: null, panelId: null };
      return { ok: true, changed: true, undone: { op: entry.op, label: entry.label, displayNumber: entry.displayNumber } };
    },

    resetToSnapshot() {
      current = structuredClone(initial);
      history = [];
      if (!selectedFrameStillExists()) selection = { frame: null, panelId: null };
      return { ok: true, changed: true };
    },
  };

  function dispatch(operation = {}) {
    const op = operation?.op;
    let result;
    if (typeof op === "string" && Object.hasOwn(handlers, op)) {
      result = handlers[op](operation);
    } else if (typeof op === "string" && Object.hasOwn(STUBBED_OPERATIONS, op)) {
      result = fail("not-wired", { message: STUBBED_OPERATIONS[op] });
    } else {
      result = fail("invalid-operation");
    }
    result = { op, ...result };
    trace.push({ op, ok: result.ok, changed: result.changed, kind: result.kind ?? null });
    notify(result);
    return result;
  }

  return {
    dispatch,
    frames,
    view,
    get trace() {
      return trace.slice();
    },
    get canUndo() {
      return history.length > 0;
    },
    get undoLabel() {
      const last = history.at(-1);
      if (!last) return null;
      return last.displayNumber ? `${last.label} · frame ${last.displayNumber}` : last.label;
    },
    get dirty() {
      return history.length > 0;
    },
    get visualApproved() {
      return model.approval.matchesCurrent && history.length === 0;
    },
    get selection() {
      return { frame: selection.frame ? { ...selection.frame } : null, panelId: selection.panelId };
    },
    select(frameAddress, panelId = null) {
      selection = {
        frame: frameAddress ? {
          structureFrameId: frameAddress.structureFrameId,
          structureSegmentIndex: Number.isInteger(frameAddress.structureSegmentIndex) ? frameAddress.structureSegmentIndex : null,
        } : null,
        panelId: frameAddress ? panelId : null,
      };
      notify({ op: null, selection: true });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
