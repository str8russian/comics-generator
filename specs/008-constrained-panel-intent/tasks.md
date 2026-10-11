# Tasks: Constrained panel intent

**Input**: Design documents from `/specs/008-constrained-panel-intent/`

**Prerequisites**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md), [checklists/requirements.md](./checklists/requirements.md)

**Tests**: Required — test-first for each new behavior (Plan verification strategy). Provider doubles and pure compiler/validator tests for deterministic suites; live provider only in a later explicitly authorized Phase 5 task under DEC-049. Do not execute these tasks in the Tasks stage.

**Organization**: Bounded vertical phases matching Spec user stories US1–US3 plus integration and final verification. No schema/migration tasks. No nested-panel, user-regen-filter, or performance-reference-transfer work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable only when different files and no unfinished dependency
- **[Story]**: `[US1]` / `[US2]` / `[US3]` on user-story phase tasks
- Each task names exact paths, FR/SC IDs, completion condition, and proof
- All tasks start unchecked; do not mark complete during `/speckit.tasks`

## Path Conventions

- Implementation: `app/storyboard-web/`
- New pure helper (planned): `app/storyboard-web/panel-intent.mjs`
- Protected renderer dependency: `prototypes/storyboard-viewer/frame-renderer.mjs` (no geometry edits)
- Stage schema (unchanged): `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json`
- Tests: `app/storyboard-web/test/` and `app/storyboard-web/test/postgres/`

---

## Phase 1: Baseline and minimum preparation

**Purpose**: Confirm the current Structure and Visual baseline before changing readiness or compiler behavior. No infrastructure, refactors, or speculative abstractions.

- [ ] T001 Record baseline of focused Structure/fidelity/Visual suites by running from `app/storyboard-web/`: `node --test test/storyboard-ready.test.mjs test/storyboard-blocked.test.mjs test/stage-cast.test.mjs test/storyboard-edit.test.mjs test/fidelity-account.test.mjs test/fidelity-dialogue.test.mjs test/visual-model.test.mjs test/visual-workflow.test.mjs test/lifecycle.test.mjs` (and `test/postgres/storyboard-result.test.mjs` / `test/postgres/visual-isolation.test.mjs` only if `STORYBOARD_TEST_DATABASE_URL` already points at `comics_test`). **FR-007, FR-008, FR-022**. **Done when**: pass/fail + suite names recorded; no source edits. **Proof**: terminal summary of baseline run.

- [ ] T002 Inventory exact extension points in `app/storyboard-web/prompts/stage.md`, `app/storyboard-web/prompts/edit-storyboard.md`, `app/storyboard-web/stage.mjs` (`buildChecked`, `stageStoryboard`), `app/storyboard-web/storyboard-edit.mjs` (`editStoryboard`), `app/storyboard-web/visual-model.mjs` (`compilePanelReadyIntent`, `compilePanelReadyPrompt`, `resolvePanelSubject`), `app/storyboard-web/server.mjs` (`generateOnePanel`, `handleVisualGeneration`, `logVisual`), `app/storyboard-web/public/app.js`, and planned new `app/storyboard-web/panel-intent.mjs`. **FR-009, FR-022**. **Done when**: short note in the later implementation report lists symbols to touch and confirms no migration/table/column/asset kind is planned. **Proof**: note cites those symbols and states Stage schema remains `{ description }` only.

- [ ] T003 Confirm `prototypes/storyboard-viewer/frame-renderer.mjs` remains a protected no-edit dependency and that `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json` is not changed by this feature. **FR-008, FR-022, SC-010**. **Done when**: note records both paths and “no geometry / no schema change”. **Proof**: path check + Plan surface match.

**Checkpoint**: Baseline known; US1 work can begin without setup sprawl. Suggested Cursor range: **T001–T003**.

---

## Phase 2: User Story 1 — Constrained Structure storyboard (Priority: P1) 🎯 MVP Structure

**Goal**: Create and review a complete ready Structure storyboard whose future generated-image panels assign exactly one character and contain only supported one-character visual intent. Unsupported prose and zero/multiple-character assignment cannot become ready. Stage and Structure-edit share the same ready gate.

**Independent Test**: With cast available, `buildChecked` / Stage-edit paths accept only supported descriptions; synthetic mutations for unsupported categories and 0/N subjects return `status: "blocked"`; source fidelity suites remain green; Structure review can show a complete board with constrained panel descriptions.

### Tests (must fail before implementation unless already correct — do not manufacture red)

- [ ] T004 [US1] Create `app/storyboard-web/test/panel-intent.test.mjs` with failing subject-cardinality cases for future image panels: exactly one cast-resolved character passes; zero matches → blocked (`panel-subject-required` or equivalent); multiple distinct cast/alias matches → blocked (`panel-subject-ambiguous` or equivalent); cover ordinary frames and directing-beat segment panels. **FR-002, FR-017, SC-002, SC-008**. **Done when**: tests exist and fail because `assessPanelIntent` / cast-aware cardinality is missing or incorrect. **Proof**: `node --test test/panel-intent.test.mjs` shows new failures.

- [ ] T005 [US1] Extend `app/storyboard-web/test/panel-intent.test.mjs` with failing unsupported-category and support-dependent-narrative mutations (synthetic RU/EN): locations/scenery, interiors, furniture, props/objects, additional people, physical interaction, visible text, rendering-style instructions, invisible narrative/temporal prose; support-dependent cues such as sitting/lying/sleeping/waking/continuing to speak/meeting context rejected unless already expressed as allowed visible upper-body geometry/expression. **FR-005, FR-006, FR-016, SC-003, SC-008**. **Done when**: cases fail before production validator exists. **Proof**: focused failing case names in test output. Not `[P]` with T004 (same file).

- [ ] T006 [US1] Extend `app/storyboard-web/test/panel-intent.test.mjs` with failing framing/background readiness cases: more-than-waist-up / full-body language blocked (`panel-framing-unsupported` or equivalent); ready-passing descriptions include only supported grammar including system solid-matte background as review content (not provider prompt). **FR-003, FR-004, SC-002**. **Done when**: cases fail before production framing/matte checks exist. **Proof**: test failures. Not `[P]` with T004/T005 (same file).

- [ ] T007 [US1] Add failing ready-gate integration coverage proving Stage and Structure-edit share the same panel-intent boundary: (a) `buildChecked` path in `app/storyboard-web/test/storyboard-blocked.test.mjs` or `test/panel-intent.test.mjs` blocks unsupported Stage candidates; (b) `app/storyboard-web/test/storyboard-edit.test.mjs` shows an unsupported edit candidate is `structure-rejected` / blocked via the same assessment (no automatic repair/retry). **FR-009, FR-016, FR-017, SC-008**. **Done when**: both Stage and edit gate assertions exist and fail while the shared cast-threaded gate is missing. **Proof**: failing assertions before T011–T012.

- [ ] T008 [P] [US1] Run existing source-fidelity / dialogue ownership suites without production edits: from `app/storyboard-web/`, `node --test test/fidelity-account.test.mjs test/fidelity-dialogue.test.mjs test/fidelity-derived.test.mjs test/storyboard-ready.test.mjs`. **FR-007, SC-010**. **Done when**: suites green (or pre-existing failures recorded as out-of-scope baseline, not “fixed” by weakening fidelity). **Proof**: terminal summary. Do not edit those test files in this task unless a later US1 task proves a collision.

### Implementation

- [ ] T009 [US1] Implement pure `assessPanelIntent` (and cast-aware subject cardinality helper) in new `app/storyboard-web/panel-intent.mjs` so T004–T006 pass. Prefer rejection; no rewrite/retry loop; no new persistent fields. Reuse/extend subject matching ideas from `resolvePanelSubject` in `app/storyboard-web/visual-model.mjs` only as needed without changing Visual compiler behavior yet. **FR-002–FR-006, FR-016, FR-017, FR-022**. **Done when**: T004–T006 green. **Proof**: `node --test test/panel-intent.test.mjs`.

- [ ] T010 [P] [US1] Constrain Storyboarder panel-description vocabulary in `app/storyboard-web/prompts/stage.md` and align `app/storyboard-web/prompts/edit-storyboard.md` to the same supported one-character grammar (exactly one character; close-up→waist-up; upper-body geometry/gesture/head/gaze/expression; system solid matte; convert or omit support-dependent narrative; omit unsupported categories). Do not change `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json`. **FR-001, FR-003–FR-006, FR-009**. **Done when**: both prompts encode the grammar; schema untouched. **Proof**: prompt diff review + `git diff -- specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json` empty.

- [ ] T011 [US1] Thread cast into `buildChecked` in `app/storyboard-web/stage.mjs` and call `assessPanelIntent` after existing fidelity/dialogue checks; update `stageStoryboard` and `editStoryboard` in `app/storyboard-web/storyboard-edit.mjs` to pass cast. On failure return existing `status: "blocked"` / structure-rejected channel with safe codes. No automatic repair subsystem. **FR-009, FR-016–FR-017, SC-008**. **Done when**: T007 green. **Proof**: `node --test test/panel-intent.test.mjs test/storyboard-blocked.test.mjs test/storyboard-edit.test.mjs`.

- [ ] T012 [US1] Wire minimal honest blocked presentation for new panel-intent failure kinds in `app/storyboard-web/public/app.js` only if existing blocked UI cannot surface them; keep messages safe (no prompts/source dump). If existing blocked presentation already suffices, record no-op. **FR-016, FR-017, FR-020**. **Done when**: blocked Structure candidates are not labeled ready; actionable safe copy exists or reuse confirmed. **Proof**: existing page/blocked test extension if needed, or recorded reuse note.

- [ ] T013 [US1] Structure checkpoint: with synthetic cast+frames (no owner dialogue copied into fixtures), prove a complete ready board can pass when all future image panels are supported, and that unsupported mutations cannot be ready. Prefer offline `buildChecked` / ready tests in `app/storyboard-web/test/panel-intent.test.mjs` and `test/storyboard-ready.test.mjs`. **FR-001–FR-007, SC-001–SC-003, SC-008, SC-010**. **Done when**: passing supported board + blocked mutations demonstrated. **Proof**: test output summarizing both outcomes.

**Checkpoint**: Complete ready Structure storyboard path with constrained descriptions and shared Stage/edit gate. Prompt-only or validator-only is insufficient — T009–T013 must all be done. Suggested Cursor range: **T004–T013**.

---

## Phase 3: User Story 2 — Independently compiled eligible panel (Priority: P1)

**Goal**: Eligible system-created Visual generation compiles provider input from bounded canonical supported-intent values only. Raw source and arbitrary description prose never reach the provider prompt. One eligible panel request can complete via the existing synchronous path and assemble through FrameRenderer.

**Independent Test**: Provider-double eligible frame generate (`body: {}`) spies a prompt containing only canonical supported values + matte + non-scenic identity/style roles; unique canary prose from upstream description is absent; historical ineligible layouts remain on `panelPrompt`.

### Tests (must fail before implementation)

- [ ] T014 [US2] Add failing canonical-compiler tests in `app/storyboard-web/test/visual-model.test.mjs` for eligible `compilePanelReadyIntent` / `compilePanelReadyPrompt`: no raw source input; no concatenated full panel description; no arbitrary description substrings except cast-resolved canonical character name; unknown/unsupported wording contributes no provider-facing text; never fall back to full description when no supported attribute is recognized (neutral defaults or reject at existing boundary); unique canary text in unsupported/unrecognized prose absent; recognized intent emitted only as canonical values. **FR-010–FR-013, SC-006, SC-007**. **Done when**: tests fail against current description-concatenating compiler. **Proof**: failing assertions quote forbidden `Panel description:` / canary leakage.

- [ ] T015 [US2] Extend `app/storyboard-web/test/visual-model.test.mjs` with failing provider-output grammar tests: no relational/scenario prose such as “two-character dialogue pair,” “partner,” or meeting context; provider-facing output limited to assigned character, close-up→waist-up framing/crop, visible upper-body geometry and in-crop gesture, head turn/tilt, gaze, facial expression, system solid-matte background, and non-scenic identity/style reference-role instructions; waist-up ceiling present. **FR-003, FR-004, FR-011, SC-005**. **Done when**: tests fail on current relational/chest-up/uniform wording where it violates the closed boundary. **Proof**: focused failing cases. Not `[P]` with T014 (same file).

- [ ] T016 [US2] Add failing workflow test in `app/storyboard-web/test/visual-workflow.test.mjs`: eligible frame generate with empty body uses constrained compiler for the panel(s); acceptance path supplies no performance reference and no user-authored regeneration instruction; identity/style authority separation remains; historical ineligible layout still uses existing `panelPrompt` path (not forced through constrained compiler contract). **FR-011, FR-014, FR-015, FR-024, SC-004, SC-006**. **Done when**: test fails before wiring/compiler rewrite. **Proof**: spy still sees description concatenation or relational prose on eligible path.

### Implementation

- [ ] T017 [US2] Rewrite eligible `compilePanelReadyIntent` / `compilePanelReadyPrompt` in `app/storyboard-web/visual-model.mjs` into the canonical closed boundary (compilerVersion constant e.g. `constrained-panel-intent/v1`) so T014–T015 pass. Do not create a general sanitization framework. Do not filter user-authored regeneration prompts in this slice beyond stopping description concatenation on the eligible path. Nested-panel elimination remains unsolved. **FR-010–FR-015, FR-023, FR-024, SC-005–SC-007**. **Done when**: T014–T015 green. **Proof**: `node --test test/visual-model.test.mjs`.

- [ ] T018 [US2] Wire constrained eligible compilation through existing `generateOnePanel` / `handleVisualGeneration` in `app/storyboard-web/server.mjs` on the synchronous path; leave ineligible layouts on historical `panelPrompt`. No `image-provider.mjs` redesign. **FR-011, FR-015, SC-004**. **Done when**: T016 green. **Proof**: `node --test test/visual-workflow.test.mjs` eligible + ineligible assertions pass.

- [ ] T019 [US2] Confirm FrameRenderer assembly path unchanged: no edits to `prototypes/storyboard-viewer/frame-renderer.mjs`; reuse `app/storyboard-web/test/overflow.test.mjs` and/or workflow display assertions so an eligible ready panel still mounts with existing dialogue geometry. **FR-008, SC-004, SC-010**. **Done when**: renderer diff empty; overflow/workflow geometry checks green. **Proof**: `git diff -- prototypes/storyboard-viewer/frame-renderer.mjs` empty; test output.

**Checkpoint**: Provider-double eligible panel request uses only canonical supported intent and returns to existing FrameRenderer assembly. Suggested Cursor range: **T014–T019**.

---

## Phase 4: User Story 3 — Immediate failures and minimum diagnostics (Priority: P1)

**Goal**: Immediate non-user-dependent failures stay honest during the Happy Path, and minimum safe diagnostics identify a failed panel without a diagnostic subsystem.

**Independent Test**: Unsupported Structure prose / 0–N subjects never ready; canary unsupported upstream text absent from compiled provider prompt; missing identity/style still zero provider calls; `logVisual` records structured canonical intent evidence + compiler version + authority ids + address + terminal result, without raw prose/prompts/bytes.

### Tests (record initial result; fail before change only when missing)

- [ ] T020 [US3] Add/extend coverage that unsupported Storyboarder prose and zero/multiple subject failures remain truthful and addressable via existing blocked channel (extend `app/storyboard-web/test/panel-intent.test.mjs` and/or `test/storyboard-blocked.test.mjs`). **FR-016, FR-017, SC-008**. **Initial result rule**: may already be green after US1; do not damage correct behavior. **Done when**: coverage exists and initial red/green recorded. **Proof**: test output + recorded initial result.

- [ ] T021 [US3] Add/extend canary proof that unsupported upstream description text remains absent from the provider-facing eligible request even if injected upstream (`app/storyboard-web/test/visual-model.test.mjs` and workflow spy in `test/visual-workflow.test.mjs`). **FR-013, FR-018, SC-007**. **Done when**: canary absent assertion exists; fails before T017 if not already green after US2. **Proof**: assertion + recorded initial result.

- [ ] T022 [US3] Confirm missing approved identity/style authorities still cause zero provider calls on eligible generate via existing preflight in `app/storyboard-web/test/visual-workflow.test.mjs` (extend only if coverage missing). **FR-014, SC-004**. **Initial result rule**: green regression acceptable if already correct. **Done when**: zero-call preflight coverage green. **Proof**: provider spy count 0.

- [ ] T023 [US3] Add failing logging assertions in `app/storyboard-web/test/visual-workflow.test.mjs` and/or `test/lifecycle.test.mjs`: existing `logVisual` path records structured canonical intent evidence (fingerprint alone insufficient), `compilerVersion`, identity/style authority identifiers when present, panel address, terminal result and failure/rejection reason when applicable; excludes raw descriptions, source/user material, complete prompts, credentials, secret-bearing URLs, provider payloads, and image bytes. **FR-020, SC-012**. **Done when**: assertions fail while structured intent/version/authority ids are not logged. **Proof**: red logging cases before T024.

### Implementation

- [ ] T024 [US3] Extend existing `logVisual` usage in `app/storyboard-web/server.mjs` (eligible panel start/provider/outcome) to emit structured canonical intent evidence, `compilerVersion`, and identity/style authority ids when available. Fingerprint only as optional supplement. No prompt archive, ZIP, table, migration, or new observability service. Keep >120-char sanitization. **FR-020, SC-012, FR-022**. **Done when**: T023 green. **Proof**: `node --test test/visual-workflow.test.mjs test/lifecycle.test.mjs`.

- [ ] T025 [US3] Change production code only for genuinely red T020–T022 gaps; otherwise document no-op. Do not add automatic visual-content detection or artistic approval. **FR-016–FR-019, FR-021**. **Done when**: T020–T022 green with red-only edits or recorded reuse. **Proof**: test output + note.

**Checkpoint**: Immediate failures honest; minimum diagnostics present; diagnostics do not dominate. Suggested Cursor range: **T020–T025**.

---

## Phase 5: Vertical integration and browser evidence

**Purpose**: Prove the complete Structure → one eligible panel path with regressions, mechanical browser walkthrough, and optional later live validation. Do not claim owner acceptance.

- [ ] T026 Run focused Structure + fidelity + Visual compiler/workflow/logging suites from `app/storyboard-web/`: `node --test test/panel-intent.test.mjs test/storyboard-ready.test.mjs test/storyboard-blocked.test.mjs test/storyboard-edit.test.mjs test/stage-cast.test.mjs test/fidelity-account.test.mjs test/fidelity-dialogue.test.mjs test/visual-model.test.mjs test/visual-workflow.test.mjs test/lifecycle.test.mjs test/overflow.test.mjs`. Fix only regressions caused by this feature. **SC-001–SC-012**. **Done when**: focused suites green. **Proof**: terminal summary.

- [ ] T027 Run PostgreSQL isolation only where already required and configured: `test/postgres/storyboard-result.test.mjs` and/or `test/postgres/visual-isolation.test.mjs` when `STORYBOARD_TEST_DATABASE_URL` points at `comics_test`. **FR-022**. **Done when**: suite green or explicit environment blocker recorded (not skipped silently). **Proof**: terminal summary or blocker note.

- [ ] T028 Prove `prototypes/storyboard-viewer/frame-renderer.mjs` geometry unchanged across the feature branch diff from `d6a93e0fd8b76ec4a7ea9a86fb1d71c4a199197a` (or implementation base) and overflow checks remain green. **FR-008, SC-010**. **Done when**: renderer diff empty; overflow green. **Proof**: `git diff d6a93e0fd8b76ec4a7ea9a86fb1d71c4a199197a -- prototypes/storyboard-viewer/frame-renderer.mjs` empty.

- [ ] T029 Perform mechanical browser walkthrough of complete Structure → review constrained panel descriptions → generate one eligible panel with provider doubles / controlled local path per [quickstart.md](./quickstart.md): no performance reference; no user-authored regeneration prompt; FrameRenderer assembly. Doubles prove flow/assembly only — not artistic quality. **US1–US2, SC-001, SC-004**. **Done when**: written browser notes for mechanical steps. **Proof**: notes in implementation report (no image bytes / protected dialogue committed).

- [ ] T030 Prepare the short owner browser-acceptance scenario from [quickstart.md](./quickstart.md) (retained Putin/Durov/Peskov dialogue is owner-pasted; do not copy into fixtures) without asserting owner acceptance. Disclose nested-panel artifacts remain unsolved. **SC-001–SC-005, SC-011**. **Done when**: scenario text ready for coordinator/owner. **Proof**: report section present.

- [ ] T031 Live text/image provider validation only in a later explicitly authorized implementation pass when credentials are available and the call materially answers Storyboarder readiness or visible-image quality. **Purpose**: validate constrained Structure/provider-facing compilation and/or one eligible panel’s character-only matte waist-up result. **Evidence**: sanitized observations only (ready/blocked outcomes; human review notes for identity/style/framing/matte/absence of invented environment). **Stop**: stop when the quality question is answered or repeated calls cease adding decision-relevant evidence. **Policy**: DEC-049 — no default numeric quota; never print/commit credentials, provider hosts, raw protected material, full prompts, raw responses, or image bytes; a live image with invented environment cannot count as acceptance evidence (FR-019); artistic acceptance belongs to the owner. If credentials unavailable, record blocker and make no call. **FR-019, SC-005, SC-009, DEC-049**. **Done when**: sanitized evidence note or explicit unverified/blocker note. **Proof**: report section. **Constraint**: this Tasks stage performs zero provider calls; T031 is scheduled for implementation, not executed now.

**Checkpoint**: Integration evidence prepared; owner scenario ready; live validation governed. Suggested Cursor range: **T026–T031** (T031 only when later authorized).

---

## Phase 6: Final implementation verification and report

**Purpose**: Close implementation with hygiene and scope guards. No product-memory edits, merge, cherry-pick, worktree deletion, or deployment. Do not claim owner acceptance.

- [ ] T032 Run the agreed complete regression set for this feature (focused suites from T026 + any broader `app/storyboard-web` offline `test/**/*.test.mjs` the project uses for Structure/Visual changes). **Done when**: green or failures fixed within scope. **Proof**: terminal summary. **Constraint**: no additional live provider calls in this final pass unless a separate owner authorization revises T031.

- [ ] T033 Run `git diff --check` on the implementation branch worktree. **Done when**: clean. **Proof**: command exit 0.

- [ ] T034 Scope and protected-file audit: verify diff contains no new migration/table/column/asset kind; no operation resource/poller/recovery; no hybrid/006 architecture; no diagnostic ZIP/prompt archive; no typed persistent intent schema; no FrameRenderer geometry change; no product-memory edits; no committed protected dialogue or generated images; nested-panel elimination / user-regen filter / performance-reference transfer not implemented. Inspect `app/storyboard-web/db/migrations/`, `prototypes/storyboard-viewer/frame-renderer.mjs`, and feature paths. **FR-022–FR-025**. **Done when**: audit recorded pass. **Proof**: audit notes in report.

- [ ] T035 Prepare structured implementation report (completed task IDs, files changed, initial red/green results, final checks, browser observations, provider-call accounting, commit hashes, residual risks including nested panels unsolved and live environmental invention) and stop for coordinator review. Do not claim owner acceptance. **Done when**: report delivered; no further phase started. **Proof**: report artifact/message.

**Checkpoint**: Implementation/code verification complete; stop for coordinator/owner. Suggested Cursor range: **T032–T035**.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2 (US1)** → **Phase 3 (US2)** → **Phase 4 (US3)** → **Phase 5** → **Phase 6**
- US2 may begin after US1 ready-gate exists (T011+) so compiler tests can assume Structure can produce supported boards; do not skip US1
- US3 logging builds on US2 compilerVersion / intent object (after T017)
- Do not start Phase 5 until Phases 2–4 deterministic checks pass

### User Story Dependencies

- **US1**: After Phase 1 — constrained Structure ready board
- **US2**: After US1 shared ready gate — independent eligible compilation
- **US3**: After US2 compiler object exists — failures + minimum diagnostics (US1 failure coverage may already be green)

### Within Each Story

- Tests before corresponding implementation (T004–T007 before T009–T012; T014–T016 before T017–T018; T023 before T024)
- Do not artificially break already-correct behavior to force red tests; record initial green and avoid unnecessary production edits (T020–T022, T025)

### Suggested bounded Cursor implementation ranges

| Range | Reviewable outcome |
|-------|--------------------|
| **T001–T003** | Baseline only |
| **T004–T013** | Complete ready Structure storyboard with constrained descriptions |
| **T014–T019** | Canonical eligible compiler + provider-double panel generation |
| **T020–T025** | Immediate failures + minimum diagnostics |
| **T026–T031** | Integration / browser / governed live evidence |
| **T032–T035** | Final verification and report |

### Parallel Opportunities

- T008 `[P]` with T004–T007 only while it does not edit the same test files
- T010 `[P]` with T009 (prompts vs `panel-intent.mjs`) after tests T004–T007 exist
- No `[P]` across tasks that both edit `visual-model.test.mjs`, `visual-workflow.test.mjs`, `panel-intent.test.mjs`, `stage.mjs`, or `server.mjs`

---

## Protected invariants (must hold after all tasks)

- Exact source dialogue wording and source order; speaker ownership
- Existing deterministic FrameRenderer geometry
- Identity / project-style / performance authority separation; DEC-032 unchanged
- Exactly one assigned character per generated panel; close-up→waist-up maximum; system solid matte
- Descriptions are review content, not provider prompts; no raw source or arbitrary full-description forwarding
- No new migration, table, column, asset kind, or persistent entity
- No new workflow stage, AI role, operation resource, state machine, polling, recovery, concurrency, or automatic reviewer
- No product-memory edits; no protected dialogue or generated-image fixtures committed
- If a typed persistent intent field becomes necessary, **stop for owner approval** — do not schedule it as approved work

## Explicitly out of scope (do not schedule)

- Nested-panel / border / collage / inset elimination (remain unsolved)
- User-authored regeneration-prompt filtering (forwarding may remain unchanged)
- Performance-reference transfer validation/correction
- Patterned/contextual backgrounds; interiors/furniture/props/extra people/interaction as capabilities
- Wider-than-waist-up / full-body; whole-storyboard image generation
- Dialogue, layout-selection, timing, audio, or FrameRenderer geometry changes
- Reload recovery, resume, cancellation, overlapping starts, polling, concurrency, stale operations
- Automatic visual-content detection or artistic approval
- Diagnostic subsystem; feature 006 hybrid/operation architecture
- Redesign of historical ineligible-layout generation beyond leaving it on its existing path
- Analyze or implementation during the Tasks stage

## Notes

- Owner-retained Putin/Durov/Peskov dialogue is paste-only acceptance evidence; use synthetic mutations for automated coverage
- Green tests do not replace browser or owner acceptance
- Provider-call count for this Tasks stage: **0**
- Nested-panel artifacts must not be presented as fixed by this feature
