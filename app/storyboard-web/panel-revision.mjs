import { appendMatteContract } from "./foreground/contract.mjs";
import { unsupportedPanelFragments } from "./panel-intent.mjs";
import { deterministicRevisionControl, deterministicRevisionFragments } from "./revision-route.mjs";
import {
  gazeInstruction,
  matchSupportedPanelFacts,
  unsupportedFramingFragment,
} from "./visual-model.mjs";

export const PANEL_REVISION_COMPILER_ID = "panel-revision-intent";
export const PANEL_REVISION_COMPILER_VERSION = "v1";
export const PANEL_REVISION_COMPILER = `${PANEL_REVISION_COMPILER_ID}/${PANEL_REVISION_COMPILER_VERSION}`;

export const REVISION_MODES = Object.freeze(["refine", "new-variation"]);

const PATCH_KEYS = Object.freeze([
  "framing",
  "upperBody",
  "gesture",
  "headPose",
  "gaze",
  "expression",
  "eyes",
  "eyebrows",
]);

const KNOWN_KEYS = Object.freeze([
  "characterName",
  "framing",
  "upperBody",
  "gesture",
  "headPose",
  "gaze",
  "expression",
  "eyes",
  "eyebrows",
  "background",
]);

const RECONSTRUCTIONS = new Set(["complete", "known-supported", "partial"]);

function clean(value, max = 160) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function textField(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : null;
}

export function normalizeRevisionSnapshot(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const reconstruction = RECONSTRUCTIONS.has(source.reconstruction) ? source.reconstruction : "partial";
  return {
    compilerVersion: PANEL_REVISION_COMPILER,
    characterName: textField(source.characterName),
    framing: textField(source.framing),
    upperBody: textField(source.upperBody),
    gesture: textField(source.gesture),
    headPose: textField(source.headPose),
    gaze: textField(source.gaze),
    expression: textField(source.expression),
    eyes: textField(source.eyes),
    eyebrows: textField(source.eyebrows),
    background: "solid-matte",
    identityAuthorityId: textField(source.identityAuthorityId),
    performanceAssetId: textField(source.performanceAssetId),
    styleAssetId: textField(source.styleAssetId),
    reconstruction,
  };
}

export function isCompleteRevisionSnapshot(value) {
  return value?.compilerVersion === PANEL_REVISION_COMPILER && value?.reconstruction === "complete";
}

export function initializeEffectiveIntent({
  snapshot = null,
  provenanceIntent = null,
  characterName = null,
  identityAuthorityId = null,
  performanceAssetId = null,
  styleAssetId = null,
} = {}) {
  if (snapshot?.compilerVersion === PANEL_REVISION_COMPILER) {
    const stored = normalizeRevisionSnapshot(snapshot);
    if (!stored.characterName) stored.characterName = clean(characterName);
    if (!stored.identityAuthorityId) stored.identityAuthorityId = clean(identityAuthorityId);
    if (!stored.performanceAssetId) stored.performanceAssetId = clean(performanceAssetId);
    if (!stored.styleAssetId) stored.styleAssetId = clean(styleAssetId);
    return stored;
  }
  const next = normalizeRevisionSnapshot({
    characterName,
    identityAuthorityId,
    performanceAssetId,
    styleAssetId,
    reconstruction: "partial",
  });
  const known = provenanceIntent && typeof provenanceIntent === "object" && !Array.isArray(provenanceIntent)
    ? provenanceIntent
    : null;
  const knownKeys = ["framing", "upperBody", "gesture", "headPose", "gaze", "expression", "eyes", "eyebrows", "background"];
  const hasKnown = knownKeys.some((key) => typeof known?.[key] === "string" && known[key].trim());
  if (hasKnown) {
    for (const key of knownKeys) {
      if (key === "background") continue;
      const value = textField(known[key]);
      if (value) next[key] = value;
    }
    next.reconstruction = "known-supported";
  }
  return next;
}

export function applySupportedPatch(baseline, instruction) {
  const current = normalizeRevisionSnapshot(baseline);
  const patch = matchSupportedPanelFacts(instruction);
  const changes = [];
  for (const key of PATCH_KEYS) {
    if (patch[key] == null) continue;
    changes.push({ property: key, value: patch[key], previous: current[key] });
    current[key] = patch[key];
  }
  if (patch.eyes === "closed" && current.gaze) {
    changes.push({ property: "gaze", value: null, previous: current.gaze });
    current.gaze = null;
  }
  return { snapshot: current, patch, changes };
}

function notAppliedEntries(instruction) {
  const entries = [];
  const push = (kind, text) => {
    const value = String(text ?? "").trim();
    if (!value) return;
    if (entries.some((entry) => entry.kind === kind && entry.text === value)) return;
    entries.push({ kind, text: value });
  };
  for (const fragment of unsupportedPanelFragments(instruction)) push("unsupported", fragment);
  const framing = unsupportedFramingFragment(instruction);
  if (framing) push("unsupported", framing);
  for (const fragment of deterministicRevisionFragments(instruction)) push("deterministic", fragment);
  return entries;
}

export function summarizeRevision({
  mode,
  instruction = "",
  baseline,
  basis,
} = {}) {
  if (!REVISION_MODES.includes(mode)) {
    return { ok: false, kind: "invalid-request" };
  }
  const text = String(instruction ?? "");
  const applied = applySupportedPatch(baseline, text);
  const control = deterministicRevisionControl(text);
  const notApplied = notAppliedEntries(text);
  let blockReason = null;
  if (control) blockReason = "deterministic-only";
  else if (mode === "refine" && !text.trim()) blockReason = "empty-refine";
  else if (mode === "refine" && applied.changes.length === 0) {
    blockReason = "no-supported-change";
    if (!notApplied.length && text.trim()) notApplied.push({ kind: "unsupported", text: text.trim() });
  }
  const preserved = [];
  for (const key of KNOWN_KEYS) {
    if (applied.snapshot[key] == null) continue;
    if (applied.changes.some((change) => change.property === key)) continue;
    preserved.push({ property: key, value: applied.snapshot[key] });
  }
  return {
    ok: true,
    mode,
    basis: {
      kind: basis?.kind || (mode === "new-variation" ? "none" : "current-panel"),
      ordinal: Number.isInteger(basis?.ordinal) ? basis.ordinal : null,
    },
    changes: applied.changes,
    preserved,
    notApplied,
    reconstruction: applied.snapshot.reconstruction,
    deterministicControl: control,
    blockReason,
    providerCall: blockReason == null,
    snapshot: applied.snapshot,
  };
}

export function assembleRevisionReferences({
  mode,
  anchor = null,
  previous = null,
  performance = null,
  style = null,
} = {}) {
  if (!REVISION_MODES.includes(mode)) return { ok: false, kind: "invalid-request" };
  if (!anchor) return { ok: false, kind: "anchor-required" };
  if (mode === "refine" && !previous) return { ok: false, kind: "basis-required" };
  const slots = [{ role: "anchor", asset: anchor }];
  if (mode === "refine") slots.push({ role: "previous", asset: previous });
  if (performance && slots.length < 3) slots.push({ role: "performance", asset: performance });
  const styleId = style?.id ?? null;
  const anchorId = anchor?.id ?? null;
  const styleDistinct = Boolean(style) && Boolean(styleId) && styleId !== anchorId;
  const omissions = [];
  if (styleDistinct && slots.length < 3) slots.push({ role: "style", asset: style });
  else if (styleDistinct) omissions.push({ role: "style", assetId: styleId, reason: "reference-limit" });
  const roles = new Set(slots.map((slot) => slot.role));
  if (mode === "refine" && !roles.has("previous")) return { ok: false, kind: "basis-required" };
  if (mode === "new-variation" && roles.has("previous")) return { ok: false, kind: "basis-forbidden" };
  return {
    ok: true,
    slots: slots.map((slot) => ({ role: slot.role, asset: slot.asset })),
    roles,
    omissions,
    previousDropped: false,
    styleDroppedByLimit: omissions.some((entry) => entry.role === "style"),
    hasPrevious: roles.has("previous"),
    hasPerformance: roles.has("performance"),
    hasStyle: roles.has("style") || (Boolean(styleId) && styleId === anchorId),
    identityAlsoStyle: Boolean(styleId) && styleId === anchorId,
    generationMode: mode === "refine" ? "revision" : (roles.has("performance") ? "performance" : "initial"),
  };
}

function roleLines(snapshot, flags) {
  const roles = [];
  let next = 1;
  if (snapshot.characterName) {
    roles.push(flags.identityAlsoStyle
      ? `Image ${next} is both the approved identity anchor for ${snapshot.characterName} and the project style anchor. It controls identity and rendering language only.`
      : `Image ${next} is the approved identity anchor for ${snapshot.characterName}. It controls identity.`);
    next += 1;
  } else {
    roles.push(`Image ${next} is the approved identity anchor. It controls identity.`);
    next += 1;
  }
  if (flags.hasPrevious) {
    roles.push(`Image ${next} is the previous result for this panel. Use it as the staging draft and apply only the supported changes named below.`);
    next += 1;
  }
  if (flags.hasPerformance) {
    roles.push(`Image ${next} is the performance reference. It controls pose, expression, gaze, head angle, composition, and crop, but never identity.`);
    next += 1;
  }
  if (flags.hasStyle && !flags.identityAlsoStyle) {
    roles.push(`Image ${next} is the project style anchor. It controls rendering language only, never identity or staging.`);
  }
  return roles;
}

export function compileRevisionPrompt(snapshot, {
  aspectRatio = "5:4",
  hasPrevious = false,
  hasPerformance = false,
  hasStyle = false,
  identityAlsoStyle = false,
} = {}) {
  const intent = normalizeRevisionSnapshot(snapshot);
  const lines = [
    `Create one independent panel-ready character image${intent.characterName ? ` featuring ${intent.characterName}` : ""}.`,
    "",
  ];
  if (intent.framing) lines.push(`Framing: crop-safe ${intent.framing}.`);
  if (intent.upperBody) lines.push(`Visible upper-body geometry: ${intent.upperBody}.`);
  if (intent.gesture) {
    lines.push(intent.gesture === "hands outside crop"
      ? "Hands: keep hands outside the crop. Do not show resting or idle hands inside the frame."
      : `In-crop gesture: ${intent.gesture}. Keep this meaningful hand gesture visible inside the crop.`);
  }
  if (intent.headPose) lines.push(`Head: ${intent.headPose}.`);
  if (intent.gaze) {
    const gaze = gazeInstruction(intent.gaze);
    if (gaze) lines.push(gaze);
  } else if (hasPerformance) {
    lines.push("Do not add any independent gaze or head-direction instruction; the performance reference owns gaze and head angle.");
  }
  if (intent.eyes === "closed") lines.push("Eyes: closed eyes. Do not add an open-eyed looking direction.");
  else if (intent.eyes === "wide-open") lines.push("Eyes: wide-open eyes.");
  if (intent.eyebrows === "raised") lines.push("Eyebrows: raised eyebrows.");
  if (intent.expression) lines.push(`Facial expression: ${intent.expression}.`);
  lines.push("Background: solid matte fill. Do not invent a location, room, landscape, patterned backdrop, or scenic environment.");
  lines.push("Color: full-color rendering consistent with the approved project style / style-anchor color treatment. Do not render grayscale or monochrome.");
  lines.push("");
  lines.push("Role of the reference images:");
  lines.push(roleLines(intent, { hasPrevious, hasPerformance, hasStyle, identityAlsoStyle }).join("\n"));
  lines.push("");
  lines.push("Hard prohibitions:");
  lines.push("- exactly one person; no additional people");
  lines.push("- no nested panels and no split layout inside the generated image");
  lines.push("- no borders, captions, speech bubbles, dialogue bubbles, logos, watermarks, or generated text");
  lines.push("- no unwanted contradictory scene objects");
  lines.push("- no grayscale or monochrome rendering");
  lines.push("");
  lines.push("Generate only this single character image for later external assembly.");
  lines.push("");
  lines.push(`Target aspect ratio: ${aspectRatio}.`);
  return appendMatteContract(lines.join("\n"));
}

export function moveCandidateSelection(candidates, selectedId, direction) {
  const ordered = [...(candidates || [])].sort((left, right) => left.ordinal - right.ordinal);
  if (!ordered.length) return null;
  const index = Math.max(0, ordered.findIndex((candidate) => candidate.id === selectedId));
  if (direction === "undo") return ordered[Math.max(0, index - 1)].id;
  if (direction === "redo") return ordered[Math.min(ordered.length - 1, index + 1)].id;
  return ordered[index].id;
}

export function revisionBasisFor({ mode, selected = null } = {}) {
  if (mode === "new-variation") return { kind: "none", ordinal: null };
  if (selected?.ordinal) return { kind: "candidate", ordinal: selected.ordinal };
  return { kind: "current-panel", ordinal: null };
}
