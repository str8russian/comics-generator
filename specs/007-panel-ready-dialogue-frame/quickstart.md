# Quickstart / Verification: Panel-ready dialogue frame

Focused validation guide for Plan acceptance. Exact commands may follow the repo README for starting PostgreSQL and `app/storyboard-web`.

## Prerequisites

- Worktree on `codex/007-panel-ready-dialogue-frame`
- PostgreSQL available (`comics` for walkthrough; `comics_test` for destructive tests)
- App configured with `DATABASE_URL`; live image checks also need `BASE_URL`, `CONTEST_API_TOKEN`, and `IMAGE_MODEL`
- A project with:
  - ready Structure storyboard containing at least one ordinary two-character `split2` dialogue frame;
  - approved identity anchors for both subjects;
  - approved project style seed (first approved anchor seed is sufficient)

## Offline / deterministic verification

From `app/storyboard-web` (or repo scripts used by the project), run the focused Visual suites after implementation:

- `visual-model` tests: eligibility, intent/prompt rules, reference ordering, prohibitions, gaze fallback vs explicit direction/performance suppression, speaking/listening roles
- `visual-workflow` tests with provider doubles: preflight zero-calls, partial failures, readiness vs attempt
- PostgreSQL visual isolation tests: ready-pointer preservation, style seed presence
- Existing fidelity / overflow / placement regressions must stay green

### Provider policy (DEC-049)

- Deterministic automated tests use provider doubles.
- Real provider validation is performed when it materially advances an approved implementation or acceptance task.
- Each live run states its purpose, required evidence, safe secret handling, and stop condition.
- No default numeric quota applies.
- Calls stop when the question is answered or repeated runs stop adding useful evidence.

## Browser Happy Path

1. Open the Visual workflow in one browser tab (do not reload during the attempt).
2. Confirm both character anchors are approved and a project style seed exists.
3. Select an ordinary `split2` dialogue frame with exactly two character panels.
4. Start **Создать изображения кадра**.
5. Observe a truthful busy state naming the frame/panels.
6. When complete, confirm:
   - both panels show panel-ready images on simple uniform backgrounds;
   - FrameRenderer shows the assembled split frame with existing dialogue geometry;
   - no nested panels, extra people, speech bubbles, or generated text inside panel images;
   - gaze/head direction and speaking vs listening look coherent for left/right roles;
   - artistic acceptance is still a human judgement (no auto-approval).

## Browser failure / partial-success checks

1. **Missing style or anchor**: remove or withhold required authority (test fixture or controlled project state). Start frame generation. Expect actionable block, zero provider work, no claim of success.
2. **Invalid performance**: on panel regenerate, supply an invalid file. Expect `invalid-image` (or equivalent), previous ready image retained.
3. **Provider/timeout/invalid-output** (double or controlled failure): expect honest failure; previous ready image retained when one existed.
4. **Partial two-panel attempt** with previous ready on the failing panel:
   - latest attempt reported as partial / not fully successful;
   - successful panel shows new image;
   - failed panel keeps previous ready image and shows failure;
   - assembled frame may remain `visualReady` / reviewable;
   - UI distinguishes retained previous from a successful replacement.
5. **Partial attempt without previous ready** on the failing panel: frame is not fully ready.
6. **Zoom/placement**: change приближение; confirm update with no provider generation.
7. **Panel-scoped regeneration**: regenerate one panel only; the other ready panel remains.

## Human visual review checklist

Inspect the assembled frame (not only portrait crops):

- [ ] Identity matches approved anchors
- [ ] Project style is coherent across both panels
- [ ] Performance reference (if used) affected only its panel
- [ ] Panel side awareness and gaze/head direction coherent (inward fallback only when no more specific intent applies)
- [ ] Speaking vs listening/reaction readable
- [ ] Shot scale and crop safe for the panel region
- [ ] Uniform non-scenic backgrounds
- [ ] No prohibited content (extra people, nested panels, text, borders, unwanted objects)

## Out of scope during verification

Do not require or test: reload recovery, cancellation, overlapping starts, operation polling, hybrid backgrounds/cutouts, diagnostic ZIP, attempt-history browser, or whole-storyboard generation.
