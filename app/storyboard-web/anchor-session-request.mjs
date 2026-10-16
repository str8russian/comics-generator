import { compilePrototypePrompt } from "./anchor-prompt.mjs";

const BASES = new Set(["from-source", "selected", "accepted"]);

function withRole(image, role) {
  if (!image?.bytes) return null;
  return { role, mime: image.mime, bytes: image.bytes };
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
  if (basis === "from-source") {
    const identity = withRole(source, "identity");
    if (!identity) return { ok: false, kind: "invalid-request" };
    references.push(identity);
    const styleRef = withRole(style, "style");
    if (styleRef) references.push(styleRef);
  } else if (basis === "selected") {
    const draft = withRole(previous, "previous");
    if (!draft) return { ok: false, kind: "invalid-request" };
    references.push(draft);
    const identity = withRole(source, "identity");
    if (identity) references.push(identity);
    const accepted = withRole(anchor, "anchor");
    if (accepted && references.length < 3) references.push(accepted);
  } else {
    const accepted = withRole(anchor, "anchor");
    if (!accepted) return { ok: false, kind: "invalid-request" };
    references.push(accepted);
    const identity = withRole(source, "identity");
    if (identity) references.push(identity);
    const styleRef = withRole(style, "style");
    if (styleRef && references.length < 3) references.push(styleRef);
  }
  return {
    ok: true,
    references: references.slice(0, 3),
    prompt: compilePrototypePrompt(references.slice(0, 3), instruction),
    aspectRatio: "4:5",
  };
}
