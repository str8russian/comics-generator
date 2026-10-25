import { compilePrototypePrompt } from "./anchor-prompt.mjs";

const BASES = new Set(["from-source", "selected", "accepted"]);

function withRole(image, role) {
  if (!image?.bytes) return null;
  const reference = { role, mime: image.mime, bytes: image.bytes };
  if (typeof image.id === "string" && image.id.trim()) reference.assetId = image.id.trim();
  return reference;
}

function pushWithinLimit(references, omissions, image, role) {
  const reference = withRole(image, role);
  if (!reference) return;
  if (references.length < 3) {
    references.push(reference);
    return;
  }
  omissions.push({ role, assetId: reference.assetId ?? null, reason: "reference-limit" });
}

export function assembleAnchorSession({
  basis,
  instruction = "",
  source = null,
  anchor = null,
  previous = null,
  style = null,
}) {
  if (!BASES.has(basis) || String(instruction).length > 2000) {
    return { ok: false, kind: "invalid-request" };
  }
  const references = [];
  const omissions = [];
  if (basis === "from-source") {
    const identity = withRole(source, "identity");
    if (!identity) return { ok: false, kind: "invalid-request" };
    references.push(identity);
  } else if (basis === "selected") {
    const draft = withRole(previous, "previous");
    if (!draft) return { ok: false, kind: "invalid-request" };
    references.push(draft);
    pushWithinLimit(references, omissions, source, "identity");
    pushWithinLimit(references, omissions, anchor, "anchor");
  } else {
    const accepted = withRole(anchor, "anchor");
    if (!accepted) return { ok: false, kind: "invalid-request" };
    references.push(accepted);
    pushWithinLimit(references, omissions, source, "identity");
    pushWithinLimit(references, omissions, style, "style");
  }
  const sent = references.slice(0, 3);
  return {
    ok: true,
    references: sent,
    omissions,
    prompt: compilePrototypePrompt(sent, instruction, { basis }),
    aspectRatio: "4:5",
  };
}
