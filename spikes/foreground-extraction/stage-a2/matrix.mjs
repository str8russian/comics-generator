import { readFileSync } from "node:fs";
import { assembleAnchorSession } from "../../../app/storyboard-web/anchor-session-request.mjs";
import { compilePrototypePrompt } from "../../../app/storyboard-web/anchor-prompt.mjs";
import {
  PANEL_READY_COMPILER_VERSION,
  assemblePanelReferences,
  compilePanelReadyIntent,
  compilePanelReadyPrompt,
} from "../../../app/storyboard-web/visual-model.mjs";
import {
  MATTE_CONTRACT_SHA256,
  MATTE_CONTRACT_TEXT,
  MATTE_CONTRACT_VERSION,
  appendMatteContract,
  sha256Buffer,
  sha256Text,
} from "./contract.mjs";

export const ANCHOR_COMPILER_ID = "compilePrototypePrompt/from-source";

export const STAGE_A2_IDENTITIES = Object.freeze([
  {
    id: "identity-1",
    characterName: "Identity 1",
    path: "/Users/andrey/Documents/Projects/comics-pipeline-local-archive/2026-10-23-branch-cleanup/style-determinism-generation/results/sdg-20261022T162253Z/inputs/source-a.jpeg",
    sha256: "b4e3eec69f14c21e910ba45f6cf80d23098026a70f5258cf5c8c509f5c364827",
    mime: "image/jpeg",
    extension: "jpeg",
  },
  {
    id: "identity-2",
    characterName: "Identity 2",
    path: "/Users/andrey/Documents/Projects/comics-pipeline-local-archive/2026-10-23-branch-cleanup/style-determinism-cross-identity/results/sdc-20261022T233452Z/inputs/source-a.jpeg",
    sha256: "a0b84af7f7330d3c713a1fb5ff5d79a4b51cd29093897d5103fa53fb9b6b5ba4",
    mime: "image/jpeg",
    extension: "jpeg",
  },
  {
    id: "identity-3",
    characterName: "Identity 3",
    path: "/Users/andrey/Documents/Projects/comics-pipeline-local-archive/2026-10-23-branch-cleanup/style-determinism-cross-identity/results/sdc-20261022T233452Z/inputs/source-b.png",
    sha256: "1931b220eeeacfa82c24aa88f370b05a2fbc47e56173f3b3c00a4ed4e33e4c3e",
    mime: "image/png",
    extension: "png",
  },
]);

const PANEL_SPECS = Object.freeze({
  "panel-close": Object.freeze({
    description: "calm close-up listening rendition, hands outside the crop",
    panelIndex: 1,
    speakerPanel: 0,
    aspectRatio: "5:4",
  }),
  "panel-gesture": Object.freeze({
    description: "self-confident waist-up speaking rendition with one open-palm hand raised in crop",
    panelIndex: 0,
    speakerPanel: 0,
    aspectRatio: "5:4",
  }),
});

export function buildMatrix(identities = STAGE_A2_IDENTITIES) {
  const cells = [];
  for (const identity of identities) {
    cells.push({
      id: `${identity.id}-anchor`,
      identityId: identity.id,
      characterName: identity.characterName,
      cell: "anchor",
      aspectRatio: "4:5",
      upstreamCellId: null,
    });
    for (const cell of ["panel-close", "panel-gesture"]) {
      cells.push({
        id: `${identity.id}-${cell}`,
        identityId: identity.id,
        characterName: identity.characterName,
        cell,
        aspectRatio: "5:4",
        upstreamCellId: `${identity.id}-anchor`,
      });
    }
  }
  return cells;
}

export function panelPromptFlags(references, assembled = {}) {
  const roles = new Set((references || []).map((reference) => reference.role));
  const omittedStyle = Boolean(assembled.roles?.has?.("style")) && !roles.has("style");
  const hasCurrent = roles.has("previous") || roles.has("current");
  return {
    hasPrevious: hasCurrent,
    hasPerformance: roles.has("performance"),
    hasStyle: omittedStyle ? false : Boolean(assembled.hasStyle),
    identityAlsoStyle: omittedStyle ? false : assembled.identityAlsoStyle === true,
    previousDropped: assembled.previousDropped === true && !hasCurrent,
  };
}

function promptRecord(basePrompt) {
  const suffixed = appendMatteContract(basePrompt);
  return {
    basePrompt,
    prompt: suffixed,
    baseSha256: sha256Text(basePrompt),
    suffixedSha256: sha256Text(suffixed),
    contractVersion: MATTE_CONTRACT_VERSION,
    contractSha256: MATTE_CONTRACT_SHA256,
    suffixAppended: suffixed.endsWith(MATTE_CONTRACT_TEXT) && suffixed.includes(basePrompt),
  };
}

export function compileAnchorContract(source) {
  const assembled = assembleAnchorSession({
    basis: "from-source",
    instruction: "",
    source: source ? { bytes: source.bytes, mime: source.mime } : null,
  });
  const problems = [];
  if (!assembled.ok) {
    return { ok: false, problems: [assembled.kind || "invalid-request"], compilerId: ANCHOR_COMPILER_ID };
  }
  const roles = assembled.references.map((reference) => reference.role);
  if (roles.length !== 1 || roles[0] !== "identity") problems.push("anchor-reference-count");
  for (const role of roles) {
    if (role !== "identity") problems.push(`forbidden-role:${role}`);
  }
  if (assembled.aspectRatio !== "4:5") problems.push("aspect-ratio");
  const prompts = promptRecord(assembled.prompt);
  if (!prompts.suffixAppended) problems.push("missing-matte-contract");
  const recompiled = compilePrototypePrompt(assembled.references, "", { basis: "from-source" });
  if (recompiled !== assembled.prompt) problems.push("prompt-drift");
  return {
    ok: problems.length === 0,
    problems,
    compilerId: ANCHOR_COMPILER_ID,
    compilerVersion: ANCHOR_COMPILER_ID,
    assembled,
    roles,
    aspectRatio: assembled.aspectRatio,
    referenceCount: assembled.references.length,
    ...prompts,
  };
}

export function compilePanelContract({ identity, cell, anchor }) {
  const spec = PANEL_SPECS[cell];
  const problems = [];
  if (!spec) return { ok: false, problems: ["unknown-panel-cell"] };
  if (!anchor?.id) problems.push("missing-anchor-asset");
  const intent = compilePanelReadyIntent({
    frame: {
      speakerPanel: spec.speakerPanel,
      panels: [
        { subject: identity.characterName },
        { subject: identity.characterName },
      ],
    },
    panelIndex: spec.panelIndex,
    characterName: identity.characterName,
    description: spec.description,
    instruction: "",
    hasPerformance: false,
    partnerName: "",
  });
  const assembled = anchor?.id
    ? assemblePanelReferences({ anchor, style: anchor, panelReady: true })
    : null;
  if (!assembled) {
    return { ok: false, problems, compilerId: PANEL_READY_COMPILER_VERSION };
  }
  if (assembled.slots.length !== 1) problems.push("panel-reference-count");
  if (assembled.identityAlsoStyle !== true) problems.push("identity-also-style");
  if (assembled.hasPrevious || assembled.hasPerformance) problems.push("extra-reference");
  const roleNames = [...assembled.roles];
  if (roleNames.length !== 1 || roleNames[0] !== "anchor") problems.push("panel-role");
  for (const forbidden of ["style", "previous", "performance", "identity"]) {
    if (assembled.roles.has(forbidden)) problems.push(`forbidden-role:${forbidden}`);
  }
  if (anchor?.id && assembled.slots.some((slot) => slot.asset?.id !== anchor.id)) problems.push("anchor-identity");
  if (cell === "panel-close") {
    if (intent.framing !== "close-up") problems.push("framing");
    if (intent.gesture !== "hands outside crop") problems.push("gesture");
    if (intent.expression !== "calm") problems.push("expression");
    if (intent.speakingRole !== "listening") problems.push("speaking-role");
  }
  if (cell === "panel-gesture") {
    if (intent.framing !== "waist-up") problems.push("framing");
    if (intent.gesture !== "open-palm hand raised in crop") problems.push("gesture");
    if (intent.expression !== "self-confident") problems.push("expression");
    if (intent.speakingRole !== "speaking") problems.push("speaking-role");
  }
  const flags = panelPromptFlags(assembled.slots.map((slot) => ({ role: slot.role })), assembled);
  const basePrompt = compilePanelReadyPrompt(intent, flags);
  const prompts = promptRecord(basePrompt);
  if (!prompts.suffixAppended) problems.push("missing-matte-contract");
  if (!basePrompt.includes("Target aspect ratio: 5:4.")) problems.push("aspect-ratio");
  return {
    ok: problems.length === 0,
    problems,
    compilerId: PANEL_READY_COMPILER_VERSION,
    compilerVersion: PANEL_READY_COMPILER_VERSION,
    intent,
    assembled,
    flags,
    roles: roleNames,
    aspectRatio: "5:4",
    referenceCount: assembled.slots.length,
    identityAlsoStyle: assembled.identityAlsoStyle === true,
    description: spec.description,
    ...prompts,
  };
}

export function anchorCompilePrompt(references) {
  return appendMatteContract(compilePrototypePrompt(references, "", { basis: "from-source" }));
}

export function panelCompilePrompt(intent, assembled, references) {
  return appendMatteContract(compilePanelReadyPrompt(intent, panelPromptFlags(references, assembled)));
}

export function loadIdentitySources(identities = STAGE_A2_IDENTITIES) {
  const loaded = [];
  const mismatches = [];
  for (const identity of identities) {
    let bytes;
    try {
      bytes = readFileSync(identity.path);
    } catch (error) {
      mismatches.push({ id: identity.id, reason: "absent", message: error.code || "unreadable" });
      continue;
    }
    const sha256 = sha256Buffer(bytes);
    if (sha256 !== identity.sha256) {
      mismatches.push({ id: identity.id, reason: "hash-mismatch", expected: identity.sha256, actual: sha256 });
      continue;
    }
    loaded.push({ ...identity, bytes, sha256 });
  }
  if (mismatches.length > 0) {
    const error = new Error("stage A2 identity source mismatch");
    error.code = "source-mismatch";
    error.mismatches = mismatches;
    throw error;
  }
  return loaded;
}

export function extensionForMime(mime) {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return null;
}
