# Implementation Plan: Constrained panel intent

**Branch**: `codex/008-constrained-panel-intent` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-constrained-panel-intent/spec.md`

**Note**: Plan-stage only. Tasks and implementation are out of scope for this commit.

## Summary

Deliver the first DEC-050 vertical slice: a complete Structure storyboard whose future generated-image panels present only supported one-character visual intent, plus one browser-visible eligible panel generated through the existing Visual workflow without a performance reference or user-authored regeneration prompt, on a system-defined solid matte background.

Technical approach (see [research.md](./research.md)):

1. Constrain Storyboarder (and Structure-edit) prompts to supported character-performance vocabulary.
2. Add deterministic `assessPanelIntent` inside `buildChecked` so unsupported or zero/multi-character panels cannot become ready (prefer rejection; no new repair subsystem).
3. Rewrite the eligible panel-ready compiler so provider prompts are compiled only from ephemeral supported intent + identity/style authorities + system matte rule — never by concatenating raw source or full panel-description prose.
4. Extend existing sanitized `logVisual` with the minimum missing fields (compiler version, compact intent tokens/fingerprint, authority ids).
5. Prove both boundaries with offline mutations and provider doubles; finish in a short browser Happy Path.
6. Make no new persistence entities, operations, polling, recovery, hybrid composition, or automatic reviewer.

## Technical Context

**Language/Version**: Node.js ESM (`.mjs`), browser JS module `public/app.js`

**Primary Dependencies**: existing `pg`, Node `http` server, contest chat-completions text/image adapters, shared FrameRenderer

**Storage**: existing PostgreSQL / jsonb `storyboard_result.stage_payload` and Visual tables — **no new migration**

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL tests only if existing visual/structure isolation suites already require `STORYBOARD_TEST_DATABASE_URL`; provider doubles for image generation; pure compiler/validator tests for prompt and intent proofs

**Target Platform**: local `app/storyboard-web` + Docker Compose PostgreSQL; browser acceptance on Structure review + assembled FrameRenderer panel

**Project Type**: web application (extend existing `app/storyboard-web/`)

**Performance Goals**: one complete Structure create + review; one selected eligible panel/frame generation on the existing synchronous path; no whole-storyboard image generation

**Constraints**: DEC-032/036/044/047/048/049/050; preserve source fidelity, speaker ownership, FrameRenderer geometry; no product-memory edits; no 006 hybrid/operation architecture; no typed persistent panel-intent schema without new owner approval; nested-panel elimination deferred

**Scale/Scope**: first of four DEC-050 slices; Structure ready-gate + independent Visual compilation only

## Constitution Check

The repository constitution template remains unfilled. This plan is gated by product-memory `GATEKEEPER.md` and `DEVELOPMENT_PROCESS.md`:

| Gate | Result (pre-design) |
|------|---------------------|
| User-visible outcome traces to browser acceptance | Pass — Structure review of constrained panels → one eligible panel → FrameRenderer review |
| Vertical Happy Path, not layer-only | Pass — Storyboarder prompt + ready validator + Visual compiler on the same user journey |
| Persistence/diagnostics/concurrency/recovery do not dominate | Pass — no new tables/operations/polling/recovery; only minimal log fields |
| Deferred edge cases stay deferred | Pass — reload/cancel/overlap, nested-panel elimination, user-regen filter, performance-reference transfer excluded |
| No open hypothesis promoted to architecture | Pass — character-only matte grammar is accepted DEC-050 |
| New mechanisms justify why smaller reuse is insufficient | Pass — current ready path has no visual-grammar gate; current compiler concatenates description prose |
| Provider calls governed by purpose/evidence | Pass — Plan made 0 calls; implementation live checks under DEC-049 if authorized later |

**Post-design re-check**: Still pass. No complexity-tracking violations. No new persistent entity, asset type, workflow stage, permanent AI role, operation resource, state machine, recovery subsystem, or automatic reviewer.

## Project Structure

### Documentation (this feature)

```text
specs/008-constrained-panel-intent/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── spec.md
```

No new `contracts/` file: Stage response schema remains `{ description }` only; HTTP Visual endpoints keep existing shapes. Failure codes and compiler rules are documented here and in [data-model.md](./data-model.md).

### Source Code (planned touch surface)

```text
app/storyboard-web/
├── prompts/stage.md                 # constrain panel descriptions to supported intent
├── prompts/edit-storyboard.md       # keep Structure edits aligned with same grammar
├── stage.mjs                        # thread cast into buildChecked; call assessPanelIntent
├── panel-intent.mjs                 # NEW pure helper: assessPanelIntent + subject cardinality + category checks
├── visual-model.mjs                 # rewrite eligible compilePanelReadyIntent/Prompt; compilerVersion
├── server.mjs                       # wire constrained compiler; minimal logVisual field additions
├── public/app.js                    # only if blocked failure copy must map new safe kinds (keep minimal)
└── test/
    ├── panel-intent.test.mjs        # NEW: unsupported categories, subject cardinality, framing
    ├── fidelity-*.test.mjs / storyboard-blocked.test.mjs  # ready/blocked regressions
    ├── visual-model.test.mjs        # compiler non-concatenation + matte + waist-up ceiling
    ├── visual-workflow.test.mjs     # eligible frame generate spy; no description prose in prompt
    └── stage-cast.test.mjs          # cast still passed; optional prompt-constraint smoke

prototypes/storyboard-viewer/
└── frame-renderer.mjs               # reuse only; protected; no geometry change

app/storyboard-web/eval/stage-artistic/  # optional structural fixture reuse; do not copy protected dialogue
```

**Structure Decision**: Extend Structure readiness and the existing eligible Visual compiler inside `app/storyboard-web/`. Reuse FrameRenderer without moving it. No new app package, worker, or renderer.

## Complexity Tracking

No constitution/gate violations requiring justification.

## Implementation Approach

### 1. Storyboarder / Structure-edit prompt constraint

Update `prompts/stage.md` (and align `prompts/edit-storyboard.md`) so each future generated-image panel description:

- assigns exactly one character by name/alias consistent with cast;
- describes only supported visible performance (close-up→waist-up framing, shot/crop, upper-body geometry, in-crop gesture, head turn/tilt, gaze, expression, solid matte background);
- converts sitting/standing/lying/sleeping/waking/meeting/etc. into visible upper-body geometry/expression or omits them;
- omits locations, interiors, furniture, props, additional people, physical interaction, visible text, rendering-style instructions, and invisible narrative/temporal prose.

This reduces block rate but is **not** sufficient alone (FR-009).

### 2. Deterministic ready gate (`assessPanelIntent`)

Add a pure module (name illustrative: `panel-intent.mjs`) used by `buildChecked`:

- Inputs: frames (including directing-beat segment panels), cast characters/aliases.
- Checks: exactly one distinct subject; no unsupported semantic categories; no more-than-waist-up framing language; support-dependent narrative cues absent unless already expressed as allowed visible geometry terms.
- Output: `{ ok: true }` or `{ ok: false, failures: [{ code, frameId?, panelIndex? }] }` using the existing blocked channel.
- Thread `cast` from `stageStoryboard` and `editStoryboard` into `buildChecked`.

Prefer rejection. No automatic rewrite/retry. Feature 004 remains user-edit machinery, not the primary correction path for first Stage output.

### 3. Independent eligible Visual compilation

In `visual-model.mjs` for the panel-ready eligible path:

- Build ephemeral supported intent from subject, frame geometry/role, and only allowlisted performance tokens extracted or defaulted for compilation — **do not** embed `Panel description:` or arbitrary full description prose.
- Emit system-defined solid matte background rule; waist-up ceiling; keep one-character and existing hard prohibitions.
- Preserve gaze/role/reference-role behavior already accepted in feature 007, without reopening performance-reference transfer design.
- Leave user-authored regeneration-prompt filtering for a later slice; Happy Path uses frame generate with empty instruction and no performance.
- Historical `panelPrompt` for ineligible layouts is outside this acceptance path; do not expand scope to redesign all layouts unless a tiny shared helper reuse is clearly cheaper than duplication (must not become a general sanitization framework).

Wire through existing `generateOnePanel` in `server.mjs`.

### 4. Minimum diagnostics

Extend existing `logVisual` panel start/provider/outcome events with `compilerVersion`, compact intent tokens or fingerprint (no prose), and identity/style authority asset ids when present. Keep >120-char string dropping. No ZIP, prompt archive, or payload storage.

### 5. Tests before behavior (implementation discipline)

For each new behavior, add failing deterministic tests first (Tasks will sequence this). Coverage targets are listed in research D5 and [quickstart.md](./quickstart.md).

## Implementation groups → browser acceptance

| Group | Browser / acceptance link | Why necessary now | Why smaller reuse is insufficient |
|-------|---------------------------|-------------------|-----------------------------------|
| A. Stage/edit prompt constraints | Structure panel descriptions match supported grammar on Happy Path | Prevents Storyboarder from emitting known unsupported scenario prose | Prompt already exists but currently invites free-form scene prose |
| B. `assessPanelIntent` in `buildChecked` | Unsupported / 0–N-character panels never shown as ready | Non-user-dependent Stage failures already observed | Fidelity checks ignore visual grammar; subject heuristic is post-hoc |
| C. Eligible compiler rewrite | Generated panel prompt cannot carry unsupported upstream prose; matte + waist-up | Independent downstream boundary (FR-009–FR-013) | Current compiler concatenates full description |
| D. Minimal `logVisual` fields | Agent can reproduce failed panel with safe evidence | FR-020 gaps vs existing logs | Address/result exist; intent/version/authority ids do not |
| E. Offline mutations + workflow doubles | Prove both boundaries without live prompts/archives | Spec SC-002–SC-008 | Existing tests do not cover constrained intent |
| F. Browser Happy Path | Owner-visible Structure + one panel result | Spec US1–US2 / SC-001–SC-005 | Automated doubles cannot replace human visual acceptance |

## Verification strategy

### Deterministic

- Panel-intent / blocked readiness tests for each unsupported category and subject cardinality.
- Compiler unit tests: no raw description/source concatenation; matte rule present; waist-up ceiling; identity/style role labels preserved.
- Eligible frame-generate workflow test with imageGenerator spy.
- Existing fidelity, overflow, placement, and Visual honesty regressions stay green.
- No edits to `prototypes/storyboard-viewer/frame-renderer.mjs`.

### Browser (implementation / owner acceptance; not Plan)

See [quickstart.md](./quickstart.md). Human review for identity, style, framing, matte background, and absence of invented environment. Live environmental invention is not acceptance evidence (FR-019).

### Provider policy

Plan-stage calls: **0**. Implementation live calls only under later authorized tasks and DEC-049.

## Gatekeeper Confirmation

- Every implementation group traces to the browser acceptance scenario.
- Work remains vertical across Structure ownership and Visual compilation, not prompt-only or validator-only.
- Persistence, diagnostics, concurrency, and recovery do not dominate.
- Deferred DEC-050 slices and interruption cases did not enter the architecture.
- No open question (Q-020/Q-033/Q-035/Q-036) became new architecture.
- No new entity, state machine, or cross-cutting sanitization platform is required.
- Feature 006 hybrid/operation/diagnostics-export architecture remains rejected.
- Nested-panel artifacts remain explicitly unsolved for this slice.

## Out of Scope (Plan)

- Nested-panel / border / collage / inset elimination
- User-authored regeneration-prompt filtering
- Performance-reference transfer validation
- Patterned/contextual backgrounds; interiors/furniture/props/extra people/interaction as capabilities
- Wider-than-waist-up / full-body; whole-storyboard generation
- Dialogue, layout selection, timing, audio, FrameRenderer geometry changes
- Reload recovery, resume, cancellation, overlapping starts, polling, concurrency, stale operations
- Automatic visual-content detection or artistic approval
- New operation resources, persistence subsystems, diagnostic ZIPs/prompt archives
- Tasks or implementation code
