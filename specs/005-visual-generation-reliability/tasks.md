# Tasks: Visual Generation Reliability

**Input**: Design documents from `/specs/005-visual-generation-reliability/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required. Write failing tests before the production change they protect.

## Phase 1: Setup

- [x] T001 Create SpecKit artifacts under `specs/005-visual-generation-reliability/` and point `.specify/feature.json` at that directory
- [x] T002 Create git branch `codex/visual-generation-reliability` from `codex/visual-workflow-repair` HEAD `17d991bc8b026fc4f4a3a14ba1d419e868dd3cac`

---

## Phase 2: Foundational

- [x] T003 Add migration `app/storyboard-web/db/migrations/004_project_style_seed.sql` for `project_style_seed` and nullable `character_anchor_version.style_asset_id`
- [x] T004 [P] Add overflow regression coverage in `app/storyboard-web/test/overflow.test.mjs` proving panel visual metadata survives fitting when dialogue fits and when it splits
- [x] T005 [P] Add style-seed and authority tests in `app/storyboard-web/test/visual-model.test.mjs` and `app/storyboard-web/test/visual-workflow.test.mjs` for stable seed, non-rotation, revision, and reference prioritization
- [x] T006 Extend shared safe visual logging helpers in `app/storyboard-web/server.mjs` for the visual events listed in `contracts/visual-reliability-api.md`

**Checkpoint**: Migration, failing tests, and logging helpers are ready

---

## Phase 3: User Story 1 - Stable project style authority (Priority: P1)

**Goal**: One persisted style seed; later anchors receive identity + style authority separately.

**Independent Test**: Approve first anchor, generate two later candidates, assert same style asset and distinct identities.

- [x] T007 [US1] Implement seed persistence, backfill, and lookup in `app/storyboard-web/visual-store.mjs`; record `style_asset_id` on new anchor versions
- [x] T008 [US1] Update anchor reference assembly in `app/storyboard-web/server.mjs` so identity/previous/style prioritization never replaces identity and keeps the seed when distinct
- [x] T009 [US1] Expose `styleSeedAssetId` from `loadVisual` in `app/storyboard-web/visual-store.mjs` and cover isolation in `app/storyboard-web/test/postgres/visual-isolation.test.mjs`

**Checkpoint**: Slice A demonstrable

---

## Phase 4: User Story 2 - Generated panel survives display path (Priority: P1)

**Goal**: Successful generation renders and survives reload; split partial failure is honest.

**Independent Test**: Generate single and split frames; reload; force one panel failure and retry.

- [x] T010 [US2] Preserve full panel objects and recompute `visualReady` in `app/storyboard-web/overflow.mjs`
- [x] T011 [US2] Update `fitFrames` / `applyVisual` / frame-generation feedback in `app/storyboard-web/public/app.js` so Visual mode uses preserved assets and partial failures stay visible
- [x] T012 [US2] Add workflow tests in `app/storyboard-web/test/visual-workflow.test.mjs` for asset survival through load+fit, split partial failure, retry, and reload persistence semantics

**Checkpoint**: Slice B demonstrable

---

## Phase 5: User Story 3 - Feedback and observability (Priority: P1)

**Goal**: Progress and Russian failures in-workflow; safe server/browser diagnostics.

- [x] T013 [US3] Emit visual-phase structured logs around identity, anchor, panel, frame, placement, and load failures in `app/storyboard-web/server.mjs`
- [x] T014 [US3] Map failure kinds to Russian copy and show panel/frame progress in `app/storyboard-web/public/app.js` / `public/index.html`
- [x] T015 [US3] Add logging exclusion tests in `app/storyboard-web/test/visual-workflow.test.mjs` asserting safe fields and absence of prompts, dialogue, tokens, URLs, bytes, and base64

**Checkpoint**: Slice C demonstrable with A/B

---

## Phase 6: Polish and verification

- [x] T016 [P] Confirm zoom-without-provider, identity-without-provider, structural-edit, fidelity, and rendering tests remain green
- [x] T017 Run `node --test app/storyboard-web/test/**/*.test.mjs`
- [x] T018 Run PostgreSQL verification against `comics_test` only
- [x] T019 Browser-verify style-corrected anchors, single frame, split frame, and controlled failure on `http://127.0.0.1:4174/`
- [x] T020 Commit SpecKit artifacts and implementation slices in logical commits on `codex/visual-generation-reliability`

## Dependencies

- Phase 2 blocks US1–US3.
- US1 and US2 can proceed in parallel after T006.
- US3 logging hooks land with US1/US2 server/client changes; T013–T015 finalize coverage.
- T017–T019 require all stories.
- T020 is last.

## Parallel opportunities

- T004/T005 together
- T007/T010 after foundational tests exist
- T016 with remaining polish

## Implementation strategy

1. Lock the proven overflow metadata-loss and style-seed failures with tests.
2. Ship Slice A (style seed).
3. Ship Slice B (display-path survival).
4. Complete Slice C feedback/logging assertions.
5. Run automated then browser verification.
