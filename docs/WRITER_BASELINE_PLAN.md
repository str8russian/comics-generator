# Writer-only baseline experiment

Pre-registered before inspecting any output. This experiment follows the failed first staged run on
`telegram-unblock-60s`. Its purpose is limited: determine whether the existing Writer prompt helps or
hurts a plain request on the same model. It does not test the Director, the renderer, factual input,
or the complete product architecture.

## Fixed controls

- Model: `gpt-5.6-sol`.
- Reasoning effort: `high`.
- Six independent clean contexts per arm, twelve samples total, launched in interleaved order.
- Identical `telegram-unblock-60s/brief.json` in both arms.
- No web search, retrieval, fact packet, human reference, Editor, Director, Reviewer, validator
  repair, or rendering.
- No retries and no prompt edits after the first output is inspected.

## Arms

### A — plain

`prompts/06-plain-writer-baseline.md` plus the brief. No shared context, line-budget formula, beat
types, `intent`, or production schema.

### B — current Writer

The frozen `prompts/00-shared-context.md` and `prompts/01-writer.md` plus the same brief, unchanged.

## Blind comparison

Before human evaluation, remove `intent`, notes, changelogs, JSON structure, arm identity, and sample
order. Present six randomly sided A/B pairs as speaker-attributed dialogue only.

For each candidate record:

1. Conversational coherence: every line is a possible response to, or visible refusal/subversion of,
   the preceding line.
2. Character differentiation: at least two lines would sound wrong if reassigned to another cast
   member.
3. Development: the exchange develops or escalates rather than merely stopping after a premise.
4. Ending: the final spoken beat feels prepared and stronger than the preceding material.
5. Forced pairwise preference and the single reason that decides it.

These are evaluation criteria, not instructions supplied to either arm.

## Interpretation

- Plain clearly preferred and more coherent: suspend the current Writer prompt and rebuild upward
  from the plain baseline.
- Rough parity: the current Writer prompt has not earned its complexity.
- Current Writer clearly preferred: identify the smallest helpful subset before restoring any other
  role.
- Both coherent but generic: a later, separate experiment may add a concise fact packet.
- Both frequently incoherent: test the plain arm on a different named model or second brief; do not
  add roles.

This experiment selects a direction. It does not establish production reliability.
