# Quickstart / Verification: Constrained panel intent

Focused validation guide for Plan acceptance after implementation. Exact start commands follow the repo README for PostgreSQL and `app/storyboard-web`.

## Prerequisites

- Worktree on `codex/008-constrained-panel-intent`
- PostgreSQL available when using the persistent Happy Path (`comics` for walkthrough; `comics_test` for destructive tests)
- App configured with `DATABASE_URL`
- Live image generation (browser Visual step) also needs configured image provider credentials when performing real generation; offline doubles cover compiler/readiness proofs without calls
- Approved identity anchors and an approved project style for the characters used in the eligible panel step
- Owner-retained Putin/Durov/Peskov reference dialogue available to paste (not committed by this feature)

## Offline / deterministic verification

From `app/storyboard-web` (or project test scripts), after implementation run focused suites:

1. **Panel-intent / Structure readiness**
   - unsupported semantic categories block readiness;
   - zero and multiple character assignments block readiness;
   - more-than-waist-up framing blocks readiness;
   - support-dependent narrative wording is rejected unless already expressed as allowed visible geometry;
   - existing source-fidelity and dialogue regressions remain green.

2. **Visual compiler (canonical closed boundary)**
   - eligible `compilePanelReadyPrompt` output is assembled from bounded, canonical supported-intent values only;
   - except for the cast-resolved canonical character name, arbitrary panel-description substrings are not copied into the provider prompt;
   - unknown, unrecognized, or unsupported wording contributes no provider-facing text;
   - the compiler never falls back to the full description when extraction yields no supported attributes (neutral defaults or reject at an existing boundary);
   - frame side / speaker-listener role do not appear as relational or scenario prose (no “two-character dialogue pair,” “partner,” meeting context, etc.);
   - provider-facing output stays within assigned character, close-up→waist-up framing/crop, visible upper-body geometry and in-crop gesture, head turn/tilt, gaze, facial expression, system solid matte background, and identity/style reference-role instructions without scene content;
   - unique canary text placed in unsupported or unrecognized upstream prose does not occur in the compiled provider prompt, while recognized intent is emitted only as canonical values;
   - nested-panel elimination is not asserted as solved.

3. **Visual workflow (provider doubles)**
   - eligible frame generate with `body: {}` uses the constrained compiler;
   - missing identity/style still blocks with zero provider calls;
   - existing `logVisual` path records compact structured canonical intent evidence (fingerprint alone is insufficient) plus compiler version and identity/style authority ids when present, together with panel address and terminal result/failure reason;
   - logging excludes raw panel descriptions, source/user material, complete prompts, provider payloads, credentials, secret-bearing URLs, and image bytes;
   - secret/prompt/image-byte logging regressions remain green.

4. **Protected invariants**
   - no `frame-renderer.mjs` geometry edits;
   - overflow / placement / speaker-ownership suites stay green.

### Provider policy (DEC-049)

- Plan stage: **0** calls.
- Deterministic automated tests use provider doubles and pure compiler outputs.
- Do not persist or print provider prompts to “test” them.
- Real provider validation occurs only in later authorized implementation/acceptance work, with stated purpose, evidence, safe secret handling, and stop condition.
- A live result that invents environmental content is **not** acceptance evidence; preserve it as a reproducible failure and require the smallest correction.

## Browser Happy Path

In one open browser session, without reload, navigation away, cancellation, manual retry, or overlapping work:

1. Paste the retained Putin/Durov/Peskov reference dialogue and create the complete Structure storyboard.
2. Review every future generated-image panel description in Structure mode (FrameRenderer textual placeholders).
3. Confirm each such panel assigns exactly one character and describes only supported visible character performance (close-up→waist-up, upper-body geometry/gesture/head/gaze/expression, solid matte background). Confirm absence of locations, interiors, furniture, props, additional people, physical interaction, visible text, style instructions, and invisible narrative/temporal prose.
4. Ensure approved identity anchors and project style are available for the chosen character(s).
5. Generate **one eligible panel** through the existing Visual workflow with:
   - no performance reference;
   - no user-authored regeneration prompt (use frame generate / empty instruction path).
6. Review the browser-visible result in existing FrameRenderer geometry.

### Human-reviewed outcomes

- [ ] Structure panels are ready and constrained as above
- [ ] Generated panel shows exactly one assigned character
- [ ] Framing is close-up through waist-up (no greater body coverage)
- [ ] Background is a solid matte / non-scenic system fill
- [ ] No invented environment, furniture, props, extra people, or physical interaction
- [ ] Identity and project style look coherent with approved authorities
- [ ] Artistic acceptance remains a human judgement (no auto-approval)
- [ ] Nested-panel / border / collage / inset traces, if any, are noted as **unsolved for this slice** (not claimed fixed)

### Deterministically verified invariants

- Source wording, source order, and speaker ownership unchanged
- Unsupported categories / bad subject cardinality cannot be ready
- Provider-facing eligible prompt is independently compiled from canonical supported-intent values only (no raw description/source concatenation; canary prose absent)
- Structured canonical intent evidence is logged; fingerprint is not a substitute
- FrameRenderer geometry unchanged
- Existing truthful blocked/failure behavior preserved for missing authorities and provider failures
- Nested-panel elimination remains explicitly out of scope / unsolved for this slice

## Failure checks (same session rules; no deferred recovery)

1. **Unsupported Storyboarder prose** (fixture/mutation or controlled Stage double): candidate is blocked or corrected before ready; not presented as ready Structure.
2. **Zero or multiple character assignment**: not ready.
3. **Upstream unsupported detail into Visual**: compiled eligible prompt still excludes it (workflow double / compiler unit proof).
4. **Live environmental invention** (only if a live call is later authorized): not acceptance evidence; record as reproducible failure needing smallest correction.

## Out of scope during verification

Do not require or test: nested-panel elimination, user regeneration-prompt filtering, performance-reference transfer, patterned/contextual backgrounds, whole-storyboard generation, reload recovery, cancellation, overlapping starts, operation polling, diagnostic ZIP/prompt archives, or automatic artistic approval.
