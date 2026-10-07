import { readFileSync } from "node:fs";
import { anchorDraft, isEmptyDraft } from "./fidelity.mjs";
import { completeInterpret } from "./provider.mjs";
import { segmentDraft } from "./segment.mjs";

const interpretSchema = JSON.parse(readFileSync(new URL("../../specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json", import.meta.url), "utf8"));
const systemPrompt = readFileSync(new URL("./prompts/interpret.md", import.meta.url), "utf8");

function isScalarBoundary(text, index) {
  if (index <= 0 || index >= text.length) return true;
  const previous = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return !(previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF);
}

function quoteOccurs(text, quote) {
  if (typeof quote !== "string" || quote.length === 0 || quote.length > text.length) return false;
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) return false;
    const end = index + quote.length;
    if (isScalarBoundary(text, index) && isScalarBoundary(text, end)) return true;
    from = index + 1;
  }
  return false;
}

function surfaceFormsRejected(draft, value) {
  const ids = new Set(value.characters.map((character) => character.id));
  for (const form of value.surfaceForms) {
    if (typeof form.characterId === "string" && !ids.has(form.characterId)) return true;
    if (!quoteOccurs(draft, form.quote)) return true;
  }
  return false;
}

function anchorAcceptingUnresolved(draft, sourceItems) {
  const adjusted = sourceItems.map((item) => {
    if (!item || item.speakerStatus !== "unresolved") return item;
    return { ...item, speakerStatus: "inferred", speakerLabel: item.speakerLabel || "speaker" };
  });
  const anchored = anchorDraft(draft, adjusted);
  if (!anchored.ok) return anchored;
  return {
    ok: true,
    sourceItems: anchored.sourceItems.map((item, index) => {
      const original = sourceItems[index];
      if (!original || original.speakerStatus !== "unresolved") return item;
      return {
        id: item.id,
        kind: item.kind,
        segmentIds: item.segmentIds,
        speakerStatus: "unresolved",
        sourceQuote: item.sourceQuote,
        draftStart: item.draftStart,
        draftEnd: item.draftEnd,
        text: item.text,
        prefixLength: 0,
      };
    }),
  };
}

export async function interpretDraft({ draft, env, fetchImpl, acceptUnresolved = false }) {
  if (isEmptyDraft(draft)) {
    return { ok: false, httpStatus: 200, status: "blocked", failures: [{ code: "empty-draft" }] };
  }
  const { segments } = segmentDraft(draft);
  const result = await completeInterpret({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          segments: segments.map(({ id, text }) => ({ id, text })),
        }),
      },
    ],
    schema: interpretSchema,
    env,
    fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, httpStatus: result.httpStatus, status: "failed", kind: result.kind, diagnostics: result.diagnostics };
  }
  if (surfaceFormsRejected(draft, result.value)) {
    return {
      ok: false,
      httpStatus: 502,
      status: "failed",
      kind: "invalid-output",
      diagnostics: result.diagnostics,
    };
  }
  const anchored = acceptUnresolved
    ? anchorAcceptingUnresolved(draft, result.value.sourceItems)
    : anchorDraft(draft, result.value.sourceItems);
  if (!anchored.ok) {
    return {
      ok: false,
      httpStatus: 200,
      status: "blocked",
      failures: anchored.failures,
      diagnostics: result.diagnostics,
    };
  }
  return {
    ok: true,
    sourceItems: anchored.sourceItems,
    characters: result.value.characters,
    surfaceForms: result.value.surfaceForms,
    diagnostics: result.diagnostics,
  };
}
