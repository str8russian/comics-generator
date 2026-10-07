import { readFileSync } from "node:fs";
import { anchorDraft, isEmptyDraft } from "./fidelity.mjs";
import { completeInterpret } from "./provider.mjs";
import { segmentDraft } from "./segment.mjs";

const interpretSchema = JSON.parse(readFileSync(new URL("../../specs/001-structure-storyboard-tracer/contracts/interpret-response.schema.json", import.meta.url), "utf8"));
const systemPrompt = readFileSync(new URL("./prompts/interpret.md", import.meta.url), "utf8");

export async function interpretDraft({ draft, env, fetchImpl }) {
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
  const anchored = anchorDraft(draft, result.value.sourceItems);
  if (!anchored.ok) {
    return {
      ok: false,
      httpStatus: 200,
      status: "blocked",
      failures: anchored.failures,
      diagnostics: result.diagnostics,
    };
  }
  return { ok: true, sourceItems: anchored.sourceItems, diagnostics: result.diagnostics };
}
