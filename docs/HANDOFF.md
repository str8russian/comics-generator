# Handoff — read completely before acting

Written 2026-09-18. Supersedes any plan described elsewhere in the repo.

Open this project as the workspace root. The iOS app at `../xcode/ContestProject` is a
**separate** project; its `AGENTS.md` and Spec Kit workflow do not govern this one.

Do not stage or commit. The product owner owns git.

---

## 1. What this project is

`comics-pipeline` is the server-side half of an AI video-comic generator. A brief (cast, tone,
target duration, optional premise) goes in; a JSON storyboard comes out; a Remotion renderer turns
that into a video of still cel-shaded portraits with typed dialogue underneath.

No animation, no lip sync, no voice, no audio — audio is out of product scope entirely. Stillness is
the format, not a limitation: the text and the cut carry the performance.

Read `README.md`, then `docs/CORRECTION_PROCESS.md`.

## 2. What exists

Schema for storyboards and briefs; Writer / Editor / Director / Reviewer prompts; an 18-entry device
catalog; a validator with 25 named rules; an eval harness with 4 case briefs; a golden storyboard
converted from a previously hand-authored 158-second video; and a data-driven Remotion renderer with
an intro-template registry.

## 3. Verified facts — state these precisely, do not inflate them

- `npm run check` prints `4748 frames` then `0 error(s), 0 warning(s)`. 4748 matches the shipped
  video's frame count from `ffprobe` exactly.
- The JSON-driven renderer is pixel-identical to the original hand-written composition at
  **15 sampled frames** (`mse_avg 0.00`). This is **not** full-frame parity. Do not claim it is.
- `evals/fixtures/broken-storyboard.json` yields 4 errors and 2 warnings, proving that rules
  INV-005, INV-007, INV-012 and INV-017 fire.
- Golden metrics baseline: 9.1 lines/min, close-up scene ratio 0.158, expression reuse factor 2.54.
- All four case briefs validate against `schema/brief.schema.json`.

**Known non-fact:** zero findings on the golden does *not* constitute positive coverage for all 25
rules. It shows the rule set as a whole accepts one artifact. It says nothing about each rule's
false-positive behaviour near its threshold.

**The main open question:** the role prompts have never been executed end to end. Nothing yet
demonstrates the pipeline can produce a good *new* video.

## 4. Task 1 — evidence-preservation repairs

Scope is fixed; **no time estimate is committed.** Actual effort depends on coupling in the renderer,
schema, and run scaffolding. Inspect first, then report scope before starting.

Fix only what would otherwise make the first experiment measure infrastructure bugs instead of AI
quality:

1. **Versioned, never-overwritten stage outputs** in run folders (`03-storyboard.v1.json`, `.v2.json`,
   …). Repair loops currently overwrite, destroying the pre-repair state the experiment needs.
2. **Copy exact prompt and catalog files** into each run folder, not just their hashes.
3. **Collision-proof run IDs.** Currently minute-resolution timestamp plus label.
4. **Record model and generation settings.** Fail loudly when `PIPELINE_MODEL` is unset.
5. **Fix the wrong path** in the `validate.mjs` / `metrics.mjs` commands generated into each run's
   `NOTES.md`, then confirm a freshly scaffolded run can execute them exactly as written.
6. **Duplicate expression-id check** in the validator. A Director will emit one, and it renders the
   wrong asset silently.
7. **Negative mutation coverage for every validator rule.** Prove each rule fires at least once:
   break one thing at a time, assert the expected finding id appears. Prefer a flat table of
   `rule id -> mutation -> expected finding id` over a generic mutation framework — some rules are
   trivial to break (swap an `expressionId`), others need adjacent-scene surgery (crossfade legality),
   and this is the item most likely to sprawl.
8. **Reclassify house-style rules with provenance labels.** They must stop contributing to a generic
   defect count, but stay visible as diagnostics. Label every rule as exactly one of:
   - `brief-derived` — computable from the brief. May become a hard check.
   - `style-preset preference` — a property of a visual language. **Move the threshold into
     `catalog/style-presets.json`, keyed by preset.** Leaving it global means a second preset
     (Marvel, DC, another GTA) silently breaks the rule set. Expect the close-up budget and the
     monotony tolerance to land here.
   - `single-sample prior` — derived from one video. Frozen until 5+ videos are accepted.
   - `arbitrary initial threshold` — nobody validated this. Record that fact.
9. **Correct two overclaims.** `README.md`'s "The format loses nothing" becomes pixel-identical at 15
   sampled frames. The "60-line prompt budget" is unenforced and already violated by the existing
   prompts — demote it to a guideline; do not build enforcement.

### Deferred — do not do now

Grapheme-cluster normalisation (briefs are Russian; code points equal graphemes, so it changes no
measurement here). Bundled fonts and the cross-renderer typography contract (both arms render in the
same Chrome). Resolution-pair validation (everything is 1920×1080). Token-budget enforcement for
prompts. Positive boundary tests — these come later and are needed for only the six threshold rules:
the reveal-frame ±1 tolerance, close-up ratio, the crossfade 4–8 window, the ±20% duration band, the
4-scene monotony limit, and the 8-expression cap.

### Out of scope entirely

Image generation, audio, Swift rendering, deployment, new product features, any agent framework.

## 5. Task 2 — one run, not a comparison

Before running: **draft and seal the single-shot baseline prompt now** (see §7). Written after
Variant B's failures are visible, it would silently encode fixes for them and advantage the baseline
in a way no blinding detects.

Then run the pipeline once on `evals/cases/zayavka-60s/brief.json` using **four separate clean
chats**: Writer → Editor → Director → validator repair → Reviewer → repair. Each role receives only
its declared inputs. Save every stage artifact.

Four chats is the *instrument*, not a preference: clean per-stage attribution is what identifies which
prompt is weak. This is an existence proof and a diagnostic, **not** an A/B.

Then render it, watch it, and triage every correction per `docs/CORRECTION_PROCESS.md` into exactly
one of: invariant (code) / heuristic (prompt + rubric) / device (catalog) / schema gap / taste (human
gate).

**Stop and report before doing anything else.**

## 6. Task 3 — variance, then role value

Only if Task 2 produced something usable:

- **Two more runs of the same arm**, same brief, same prompts, no tuning. This measures the
  run-to-run noise floor, which gates whether any between-arm comparison is interpretable at all.
  It also measures consistency, which is a product property: a user gets one shot, so a pipeline that
  is excellent one time in three is a bad product regardless of its mean.
- **Establish the human reference** by applying your corrections to the best generated storyboard.
  Do not author one from scratch. The paired generated-versus-corrected diff is the signal for prompt
  work. Recorded limitation: this reference inherits the generated structure, so it can reveal wrong
  choices but not "this should have been structured completely differently." A from-scratch reference
  is the tool for that and waits until there is reason to think structure is the problem.
- **Answer the Editor and Reviewer questions from these artifacts. No new runs needed.**

  The **Editor** is falsified if its changelog contains no cuts (only rewordings), or blind preference
  between raw and edited script sits near 50%, or your manual corrections routinely revert it.

  The **Reviewer** is falsified if ≥80% of its findings duplicate validator findings by rule id and
  location, or the findings you agree with number ≤1 per run, or you catch defects it missed at a
  higher rate than it catches defects you would have missed. Compare its findings against **yours**,
  never against the rubric — the rubric and its prompt list the same things, so that comparison is
  circular.

- **Optional mechanical floor**, built only under a specific trigger: the Director's output looks
  plausible but you cannot tell whether it beats naive alternation (alternate split2/single, cycle
  expressions, uniform holds).

## 7. Task 4 — the single-shot baseline

This is the arm that could actually change the architecture. The open question is **single-shot versus
staged**, *not* one chat versus four.

Define the baseline by **what it receives**, not by effort — "comparable design effort" is
unfalsifiable in both directions. It gets the same brief, the same shared context, the same schema,
the same device catalog, and the same style preset. Identical inputs. The only difference is the
absence of stage decomposition and intermediate artifacts. Internal reasoning is permitted; emitting
one artifact is the constraint.

Two failure modes to avoid: a single-shot prompt that concatenates all four role prompts is the staged
pipeline with the stages hidden; a deliberately thin one loses by construction.

Then blind-compare against the three Variant B storyboards.

## 8. Experimental controls

- Equal **total** repair turns across arms (not per stage — that has no meaning for an unstaged arm).
- No prompt tuning between arms.
- Blind comparison shows only the final storyboard, with `notes`, `proposedDevices`, and stage
  metadata stripped. Otherwise the arms are trivially distinguishable.
- Randomise presentation order. Review one dimension across all outputs rather than one video at a
  time — evaluator learning and fatigue across six videos are severe.
- Prefer **forced pairwise preference** ("which is better, and name the one thing that decides it")
  over absolute 0–2 scoring. Humans rank pairs far more reliably than they score singletons.
- Recorded limitation: runs 1–3 use a single brief. That is a larger threat to generalisation than
  the small n, and it is accepted at this budget because variance gates interpretability. A second
  brief must precede any conclusion about generality.

## 9. Metrics: signal versus noise

Trustworthy: hard validation errors; repair turns to reach zero errors; **expression-sheet economy**
(promote this to a primary metric — it determines images per video, which is the unit economics, and
it is the interface to the deferred image pipeline); required-fact fidelity; run-to-run variation;
whether the Editor's changelog contains real cuts; Reviewer/validator finding overlap by rule id.

Weak or gameable: style-labelled warnings (report, never optimise — a model that satisfies them is
overfitting to n=1); absolute rubric scores; manual correction count as a headline (confounded by your
own learning across the session); operational effort (already known — four chats is more work; a cost
to weigh, not an outcome to measure).

Only partially measurable with placeholder assets: **correspondence between dialogue and expression.**
There is no face. You can judge whether the descriptor is plausible for the line; you cannot judge
whether the image works. Acknowledge this rather than scoring it.

## 10. Decision discipline

- **Burden of proof is on complexity.** Ambiguous evidence resolves to the simpler option
  provisionally, with a named trigger to revisit. "Do not conclude" is not a resolution — in practice
  it means keeping whatever was already built.
- Pre-register thresholds for "meaningful" and "consistent" **before** looking at results. Post-hoc
  thresholds are how one talks oneself into the more sophisticated option.
- **Stopping criterion for the whole activity**, defined now while nobody is invested: if all three
  runs require restructuring more than half the scenes, the response is prompt work or a different
  decomposition — not more experiments.
- The staged-single-chat arm runs only if a meaningful unresolved question remains after §7.

## 11. Standing context worth not rediscovering

- The highest-risk part of the product — identity-preserving stylised portraits with consistent
  expression sets — is deferred pending compute. The **only** coupling to it is the expression
  descriptor in the schema, which is why everything else can be built and tuned now.
- Expression `suitableFor` is driven by **gesture, not emotional intensity**. An active gesture is
  speaking-only; a high-intensity face with no gesture is legitimately usable while listening, and
  that hold is often the joke.
- Crossfade legality is mechanical, not directorial: same layout, same cast in the same slots, same
  shot and flip, differing only in expression, 4–8 frames. The Director emits cuts and may opt a
  scene out with a reason.
- Style presets are described by visual attributes and **never** by franchise name. Hosted image APIs
  degrade on named-IP prompts, and a preset named after someone else's property is a liability.
- Assets should be generated at ≥2048px. The existing ~1250px assets already upscale 1.15×–1.47× on
  close-ups, which is visible as softness.
