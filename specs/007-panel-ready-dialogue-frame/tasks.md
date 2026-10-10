# Tasks: Panel-ready dialogue frame

**Input**: Design documents from `/specs/007-panel-ready-dialogue-frame/`

**Prerequisites**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/panel-ready-frame-api.md](./contracts/panel-ready-frame-api.md), [quickstart.md](./quickstart.md)

**Tests**: Required — test-first for each new behavior (Plan verification strategy). Provider doubles for deterministic suites; live provider only in Phase 5 under DEC-049.

**Organization**: Bounded vertical phases matching Spec user stories US1–US3. No schema/migration tasks. Do not execute these tasks in the Tasks stage.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable only when different files and no unfinished dependency
- **[Story]**: `[US1]` / `[US2]` / `[US3]` on user-story phase tasks
- Each task names exact paths, FR/SC IDs, completion condition, and proof

## Path Conventions

- Implementation: `app/storyboard-web/`
- Protected renderer dependency: `prototypes/storyboard-viewer/frame-renderer.mjs` (no geometry edits)
- Tests: `app/storyboard-web/test/` and `app/storyboard-web/test/postgres/`

---

## Phase 1: Baseline and minimum preparation

**Purpose**: Confirm the existing Visual baseline before changing eligible-frame behavior. No infrastructure or unrelated refactors.

- [ ] T001 Record baseline of existing Visual focused suites by running `node --test test/visual-model.test.mjs test/visual-workflow.test.mjs test/image-provider.test.mjs test/overflow.test.mjs` from `app/storyboard-web/` (and postgres visual isolation only if `STORYBOARD_TEST_DATABASE_URL` is already configured). **FR-019–FR-028**. **Done when**: command results are recorded (pass/fail + suite names); no source edits. **Proof**: terminal summary of baseline run.

- [ ] T002 Inventory exact extension points in `app/storyboard-web/visual-model.mjs`, `app/storyboard-web/visual-store.mjs`, `app/storyboard-web/server.mjs`, `app/storyboard-web/public/app.js`, and test files `app/storyboard-web/test/visual-model.test.mjs`, `app/storyboard-web/test/visual-workflow.test.mjs`, `app/storyboard-web/test/postgres/visual-isolation.test.mjs` for eligibility, `panelPrompt`, `assemblePanelReferences`, frame generate loop, and UI failure copy. **FR-001, FR-037**. **Done when**: a short note in the implementation report (not a new product doc) lists functions/handlers to touch and confirms no migration file is planned. **Proof**: note cites current symbols (`panelPrompt`, `assemblePanelReferences`, `handleVisualGeneration`, `generationFailures`).

- [ ] T003 Confirm `prototypes/storyboard-viewer/frame-renderer.mjs` geometry constants remain the protected assembly dependency and that `image-provider.mjs` / `image-info.mjs` are reuse-only unless a later failing requirement proves otherwise. **FR-003, FR-025, FR-024**. **Done when**: note records FrameRenderer path outside `app/storyboard-web/` and states no planned edits to provider/image-info. **Proof**: path check + Plan surface match.

**Checkpoint**: Baseline known; US1 work can begin without setup sprawl.

---

## Phase 2: User Story 1 — Panel-ready Happy Path (Priority: P1) 🎯 MVP

**Goal**: One eligible ordinary `split2` frame yields two independent panel-ready images on uniform backgrounds, assembled by existing FrameRenderer, with correct authorities and compiler rules.

**Independent Test**: Provider-double frame generate for one eligible split2 shows two panel-ready prompts/requests and assembled `visualReady` frame; browser shows FrameRenderer pair without split-layout language in prompts.

### Tests (must fail before implementation)

- [ ] T004 [US1] Add failing eligibility tests for `isEligiblePanelReadyDialogueFrame` in `app/storyboard-web/test/visual-model.test.mjs`: true for ordinary dialogue `split2` with two panels, dialogue, `speakerPanel` 0|1; false for single, action/silent, wrong panel count, missing dialogue. **FR-001, FR-037**. **Done when**: tests fail because helper is missing or incorrect. **Proof**: `node --test test/visual-model.test.mjs` shows new failures.

- [ ] T005 [US1] Add failing compiler tests in `app/storyboard-web/test/visual-model.test.mjs` for panel-ready intent/prompt: panel side from index; speaking vs listening/reaction from `speakerPanel`; uniform non-scenic background; crop-safe/chest-up language; prohibitions (extra people, nested panels, split-inside-image, borders, captions, bubbles, logos, watermarks, generated text, unwanted objects); must not contain “one side of a two-panel split screen” or finished-comic assembly language. **FR-002, FR-010–FR-017, SC-002**. **Done when**: tests fail against current `panelPrompt`. **Proof**: failing assertions quote forbidden/required phrases.

- [ ] T006 [US1] Add failing gaze-fallback tests in `app/storyboard-web/test/visual-model.test.mjs`: inward fallback (panel0 screen-right, panel1 screen-left) only when no explicit description direction, no explicit revision direction, and no performance staging; each suppressor prevents fallback; prompt never emits contradictory gaze lines. Do not invent tie-break policy for two conflicting explicit authorities. **FR-011, FR-009**. **Done when**: tests fail on current compiler. **Proof**: focused failing cases listed in test names.

- [ ] T007 [US1] Add failing reference-assembly tests in `app/storyboard-web/test/visual-model.test.mjs` for order identity → distinct style → performance → previous; same-asset identity/style dedupe; previous dropped first under three-image limit with `previousDropped` (or equivalent) metadata; prompt must not label/claim continuity from an omitted previous image. **FR-007–FR-009, FR-018**. **Done when**: tests fail on current `assemblePanelReferences` (style currently dropped). **Proof**: assertion that style remains when previous would overflow.

### Implementation

- [ ] T008 [US1] Implement `isEligiblePanelReadyDialogueFrame` (adapt narrowly from 006 eligibility shape only; no hybrid routing) in `app/storyboard-web/visual-model.mjs` so T004 passes. **FR-001, FR-037**. **Done when**: T004 green. **Proof**: `node --test test/visual-model.test.mjs` eligibility cases pass.

- [ ] T009 [US1] Implement ephemeral panel-ready intent + prompt compiler helpers in `app/storyboard-web/visual-model.mjs` (adapt narrowly 006 prohibition phrases / speaking-listening mapping / screen-direction fallback only; reject chromakey, scene backgrounds, composition modes) so T005–T006 pass without contradictory gaze lines. Exact wording may vary; rules must hold. **FR-002, FR-009–FR-017**. **Done when**: T005–T006 green. **Proof**: `node --test test/visual-model.test.mjs` compiler/gaze cases pass.

- [ ] T010 [US1] Update `assemblePanelReferences` in `app/storyboard-web/visual-model.mjs` to the accepted authority order and omission rules so T007 passes; keep max three images. **FR-007–FR-009, FR-018**. **Done when**: T007 green. **Proof**: reference-assembly tests pass.

- [ ] T011 [US1] Add failing workflow test in `app/storyboard-web/test/visual-workflow.test.mjs` that an eligible `split2` frame generate uses the panel-ready compiler for both panels (spy/double captures prompts), remains synchronous, and returns two ready panels with provider double. **FR-001–FR-004, FR-019, SC-001**. **Done when**: test fails before wiring. **Proof**: failure shows still using old `panelPrompt` split language or missing compiler.

- [ ] T012 [US1] Wire eligible-frame panel generation in `app/storyboard-web/server.mjs` (and only necessary `visual-store.mjs` read helpers) to use the panel-ready compiler + updated references on the existing synchronous `generateOnePanel` path; leave out-of-scope layouts on the historical path. Do not change `image-provider.mjs`. **FR-001, FR-003, FR-019, FR-037**. **Done when**: T011 green and historical single/action path still covered by existing or new assertion. **Proof**: `node --test test/visual-workflow.test.mjs` eligible Happy Path passes; out-of-scope assertion passes.

- [ ] T013 [US1] Verify FrameRenderer assembly unchanged: no edits to `prototypes/storyboard-viewer/frame-renderer.mjs`; extend or reuse `app/storyboard-web/test/overflow.test.mjs` / workflow display path so eligible ready panels still mount with existing dialogue geometry. **FR-003, FR-025, SC-001**. **Done when**: renderer file untouched in diff; display/overflow checks green. **Proof**: `git diff -- prototypes/storyboard-viewer/frame-renderer.mjs` empty; overflow/workflow tests pass.

**Checkpoint**: Demonstrable US1 Happy Path with provider doubles + real assembly path. Stop for vertical validation before US2.

---

## Phase 3: User Story 2 — Preflight and honest failure behavior (Priority: P1)

**Goal**: Eligible-frame attempts block cleanly when authority is missing; provider/timeout/invalid/partial failures stay honest; latest attempt ≠ assembled readiness; retained previous remains visible.

**Independent Test**: Controlled doubles show zero provider calls on preflight blocks; partial replacement keeps previous ready `assetId` while `generationFailures` / latest status show failure; UI never claims full attempt success.

### Tests (must fail before implementation)

- [ ] T014 [US2] Add failing preflight tests in `app/storyboard-web/test/visual-workflow.test.mjs` (and store helpers if needed): before first provider call, eligible frame blocks on unresolved subject, missing approved identity for either panel, or missing project style; assert call count `0` and kinds `subject-required` / `anchor-required` / `style-required` per [contracts/panel-ready-frame-api.md](./contracts/panel-ready-frame-api.md). **FR-029, FR-030, SC-006**. **Done when**: tests fail (style currently not blocked). **Proof**: failing style-required case.

- [ ] T015 [US2] Add failing tests for invalid performance input on panel generate in `app/storyboard-web/test/visual-workflow.test.mjs`: `invalid-image` (or existing parse kind), zero provider calls, previous ready pointer unchanged. **FR-031, SC-007**. **Done when**: documented initial failure or new assertion fails if behavior drifts. **Proof**: test file case present.

- [ ] T016 [US2] Add failing/extend tests in `app/storyboard-web/test/visual-workflow.test.mjs` for provider failure, timeout, and invalid-output on a panel: honest kind; previous ready preserved when present; failed panel without previous ⇒ not ready. **FR-032–FR-034, SC-007**. **Done when**: cases assert preservation + readiness rules (extend existing partial coverage as needed). **Proof**: tests fail until behavior/assertions complete.

- [ ] T017 [US2] Add failing tests distinguishing latest attempt vs readiness: partial two-panel attempt; partial with retained previous on failed panel (`visualReady` may stay true); response must include `generationFailures`; must not imply latest attempt fully succeeded. **FR-035, FR-036, SC-008**. **Done when**: tests encode SC-008. **Proof**: failing or newly red assertions before UI/server honesty fix.

### Implementation

- [ ] T018 [US2] Implement eligible-frame preflight in `app/storyboard-web/server.mjs` and minimal helpers in `app/storyboard-web/visual-store.mjs` / `app/storyboard-web/visual-model.mjs` (adapt narrowly 006 `validateStyleRequired` / `validateAnchorRequired` only) so T014 passes with zero provider calls and no ready-pointer movement. **FR-029, FR-030**. **Done when**: T014 green. **Proof**: workflow preflight tests pass; provider spy count 0.

- [ ] T019 [US2] Ensure invalid performance and provider/timeout/invalid-output paths in `app/storyboard-web/server.mjs` + `app/storyboard-web/visual-store.mjs` satisfy T015–T016 without new persistence; reuse existing `finishPanelGeneration` non-advance on failure. Do not add `normalizeProviderOutcome` from 006. **FR-031–FR-034, FR-026**. **Done when**: T015–T016 green. **Proof**: workflow failure tests pass.

- [ ] T020 [US2] Implement attempt-vs-readiness honesty in `app/storyboard-web/public/app.js` and any minimal server response clarification needed: when `generationFailures.length > 0`, never show full-success attempt copy even if `visualReady`; surface retained previous vs failed replacement using existing `generationStatus`/`assetId`; add Russian copy for `style-required` and `subject-required`. No history browser or readiness state machine. **FR-004, FR-020, FR-035, FR-036, SC-008**. **Done when**: T017 green and UI message map covers new kinds. **Proof**: workflow/UI-focused tests or documented double-driven browser check in Phase 5 prep notes.

**Checkpoint**: Browser-observable failure/partial behavior with controlled doubles is ready for Phase 5 verification.

---

## Phase 4: User Story 3 — Preserve existing Visual controls (Priority: P2)

**Goal**: Regression-protect existing regeneration, performance isolation, placement, fidelity, FrameRenderer, attempt records, out-of-scope frames, and sanitized logs. Prefer tests-only when already green.

**Independent Test**: Existing suites prove no provider on zoom; panel regenerate isolates performance; source/speaker/renderer unchanged; out-of-scope path unchanged.

- [ ] T021 [P] [US3] Add or extend regression in `app/storyboard-web/test/visual-workflow.test.mjs` that panel-scoped regeneration remains available and only the targeted panel is requested. **FR-021, SC-005**. **Done when**: test green (implement only if red). **Proof**: test output.

- [ ] T022 [P] [US3] Add or extend regression in `app/storyboard-web/test/visual-model.test.mjs` / workflow tests that optional performance reference stays panel-scoped and does not displace identity/style authority. **FR-009, FR-022, SC-003**. **Done when**: test green (implement only if red). **Proof**: test output.

- [ ] T023 [P] [US3] Confirm zoom/placement PATCH in `app/storyboard-web/test/visual-workflow.test.mjs` never calls the image provider; no implementation unless red. **FR-023, FR-024, SC-004**. **Done when**: existing or extended test green. **Proof**: provider spy unused on placement.

- [ ] T024 [P] [US3] Confirm source wording and speaker ownership regressions remain green via existing fidelity/stage suites used by the app (run the project’s established fidelity-related `node --test` targets from `app/storyboard-web/`); no implementation unless red. **FR-028, SC-010**. **Done when**: suite green. **Proof**: terminal summary.

- [ ] T025 [US3] Confirm `prototypes/storyboard-viewer/frame-renderer.mjs` still has no feature diff and overflow visual metadata tests in `app/storyboard-web/test/overflow.test.mjs` remain green. **FR-025**. **Done when**: no renderer diff; overflow green. **Proof**: `git diff -- prototypes/storyboard-viewer/frame-renderer.mjs` empty.

- [ ] T026 [US3] Add/extend assertion that recorded `panel_generation` attempts are not deleted and latest/current status remains exposed on `/api/visual` load path (`app/storyboard-web/visual-store.mjs` + tests); no attempt-history UI. **FR-020**. **Done when**: test green proving append-only + latest status fields. **Proof**: test output.

- [ ] T027 [US3] Add/extend regression that out-of-scope layouts keep the historical generation path (not forced through panel-ready preflight/compiler contract) in `app/storyboard-web/test/visual-workflow.test.mjs` or `visual-model.test.mjs`. **FR-037**. **Done when**: test green. **Proof**: test output.

- [ ] T028 [US3] Confirm sanitized lifecycle logging exclusions still hold for visual generation events (extend `app/storyboard-web/test/lifecycle.test.mjs` or visual workflow log assertions if needed); no new diagnostic subsystem. **FR-027**. **Done when**: sensitive-field exclusions green. **Proof**: test output.

**Checkpoint**: US3 protections verified; only fix if a regression is red—no speculative rewrites.

---

## Phase 5: Integration and real-provider validation

**Purpose**: After deterministic doubles and US1–US3 checks pass, run broader regression and browser evidence. Owner acceptance is not claimed by the agent.

- [ ] T029 Run focused application Visual + overflow + image-provider suites from `app/storyboard-web/` and fix only regressions caused by this feature. **FR-015 (suite continuity), SC-001–SC-008**. **Done when**: focused suites green. **Proof**: terminal summary.

- [ ] T030 Run PostgreSQL visual isolation tests in `app/storyboard-web/test/postgres/visual-isolation.test.mjs` when `STORYBOARD_TEST_DATABASE_URL` points at `comics_test`; confirm style seed + ready-pointer preservation still hold. **FR-026, FR-008**. **Done when**: postgres suite green or blocked with explicit environment reason (not skipped silently). **Proof**: terminal summary or recorded blocker.

- [ ] T031 Perform browser Happy Path on an assembled eligible `split2` frame per [quickstart.md](./quickstart.md) using provider doubles or local app configuration as available; record observations for busy state, two panel-ready images, FrameRenderer dialogue geometry. **US1, SC-001–SC-003**. **Done when**: written browser notes with pass/fail per quickstart Happy Path steps. **Proof**: notes path in implementation report (no image bytes committed).

- [ ] T032 Perform browser failure/partial checks per quickstart (missing style/anchor, partial with retained previous, zoom without provider) using controlled doubles. **US2, SC-006–SC-008**. **Done when**: notes show honest attempt outcome vs readiness. **Proof**: browser notes.

- [ ] T033 Live-provider panel-ready quality validation when `BASE_URL` and `CONTEST_API_TOKEN` are available. **Purpose**: validate actual panel-ready output quality and pair coherence on one ordinary eligible split2. **Evidence**: assembled-frame observations for identity, style, uniform background, gaze, speaking/listening role, crop safety, and prohibited content (human review of the pair, not isolated portraits). **Stop**: stop when the user-visible quality question is answered or repeated calls cease adding decision-relevant evidence. **Policy**: DEC-049 — no default numeric quota; never log/commit credentials, provider host, raw protected responses, protected user material, or image bytes; leave local generated outputs uncommitted unless explicitly approved. If credentials are absent, record “blocked: no credentials” and skip without inventing success. **FR-007–FR-017, SC-002–SC-003, DEC-049**. **Done when**: sanitized evidence note exists or explicit credential blocker recorded. **Proof**: sanitized note in report.

- [ ] T034 Prepare the owner browser-acceptance scenario (short steps from quickstart Happy Path + one partial-failure check) in the implementation report without asserting owner acceptance. **SC-009**. **Done when**: scenario text ready for coordinator/owner. **Proof**: report section present.

**Checkpoint**: Evidence prepared for coordinator/owner review; agent does not declare product acceptance.

---

## Phase 6: Final implementation verification

**Purpose**: Close the implementation pass with repo hygiene and scope guards. No product-memory edits, merge, cherry-pick, worktree deletion, or deployment.

- [ ] T035 Run the agreed complete regression set for this feature (focused Visual suites + any broader `app/storyboard-web` offline suite the project uses for Visual changes). **Done when**: green or failures fixed within scope. **Proof**: terminal summary.

- [ ] T036 Run `git diff --check` on the implementation branch worktree. **Done when**: clean. **Proof**: command exit 0.

- [ ] T037 Verify the implementation diff contains no new migration/table/column/asset kind, no operation resource/poller/recovery, no hybrid renderer/compositor, no history UI, no diagnostics ZIP/provenance subsystem; verify no FrameRenderer geometry or source-fidelity weakening. Inspect with `git diff --stat` and targeted path review of `app/storyboard-web/db/migrations/`, `prototypes/storyboard-viewer/frame-renderer.mjs`, and fidelity tests. **FR-037, FR-038, FR-025, FR-028**. **Done when**: scope audit recorded pass. **Proof**: audit notes in report.

- [ ] T038 Prepare the structured implementation report (completed task IDs, files changed, initial failures, final checks, browser observations, provider-call count/purpose/evidence/stop, commit hashes, residual risks including any explicit-authority conflict deferral) and stop for coordinator/owner review. **Done when**: report delivered; no further phase started. **Proof**: report artifact/message.

**Checkpoint**: Implementation pass complete pending owner acceptance.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2 (US1)** → **Phase 3 (US2)** → **Phase 4 (US3)** → **Phase 5** → **Phase 6**
- US2 builds on US1 compiler/wiring; do not start Phase 5 until Phases 2–4 deterministic checks pass
- US3 is mostly regression; may begin after US1 wiring if needed, but listed after US2 to keep failure honesty stable first

### User Story Dependencies

- **US1**: After Phase 1; MVP vertical slice
- **US2**: After US1 compiler + sync wiring (T012)
- **US3**: After US1 (and preferably US2 UI honesty) so regressions reflect final path

### Within Each Story

- Tests T004–T007 before T008–T010; T011 before T012; T014–T017 before T018–T020
- Do not invent conflict resolution for two explicit gaze authorities
- Do not schedule `image-provider.mjs` / `image-info.mjs` / FrameRenderer geometry edits unless a task’s failing proof requires it (unexpected)

### Parallel Opportunities

- T021, T022, T023, T024 may run in parallel after US1/US2 core path exists (different primary concerns; avoid concurrent edits to the same test file—split cases or serialize if conflict)
- No other `[P]` tasks: compiler/reference/server/UI tasks share files and must stay sequential

### Suggested bounded implementation ranges

| Range | Outcome |
|-------|---------|
| T001–T003 | Baseline only |
| T004–T013 | US1 Happy Path MVP |
| T014–T020 | US2 preflight/failures |
| T021–T028 | US3 regressions |
| T029–T034 | Integration + live validation evidence |
| T035–T038 | Final verification + stop |

---

## Parallel Example: US3 regressions

```bash
# After US1/US2 path exists, these may proceed without overlapping the same unfinished impl file:
Task: "T021 panel-scoped regeneration regression in visual-workflow.test.mjs"
Task: "T023 placement-without-provider regression in visual-workflow.test.mjs"
# Serialize if both need conflicting edits to the same test file.
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 baseline
2. Phase 2 T004–T013 until eligible split2 Happy Path works with doubles + FrameRenderer
3. **STOP** for vertical demo before preflight expansion

### Incremental Delivery

1. US1 Happy Path → demo
2. US2 preflight/partial honesty → demo
3. US3 regression lock
4. Phase 5 evidence (doubles + optional live under DEC-049)
5. Phase 6 audit → coordinator/owner acceptance (not agent-claimed)

---

## Notes

- Forbidden task scope: wholesale 006 cherry-picks; hybrid orchestration; scene backgrounds; cutouts/chromakey/matte; layered compositing; `visual_frame_operation`; polling; reload recovery; diagnostics ZIP; migration 005; automatic composition-mode selection; `normalizeProviderOutcome`; attempt-history browser; new schema
- Deferred: reload/cancel/overlap/concurrency; unusual layouts; whole-storyboard generation; AI Reviewer; provenance
- Green tests ≠ owner acceptance (SC-009)
- Tasks stage provider-call count: 0
