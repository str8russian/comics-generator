# Tasks: Visual Storyboard Repair

**Input**: Design documents from `/specs/004-visual-storyboard-repair/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required by the specification. Write failing tests before the production change they protect.

**Organization**: Foundational error-contract work first, then independently demonstrable slices.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

**Purpose**: Keep the repair on the existing application and feature artifacts.

- [x] T001 Create SpecKit artifacts under `specs/004-visual-storyboard-repair/` and point `.specify/feature.json` at that directory
- [x] T002 Create git branch `codex/visual-workflow-repair` from `codex/visual-workflow-spike`

---

## Phase 2: Foundational

**Purpose**: Shared error kinds, logging, and parser/store field alignment used by both slices.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Add regression coverage in `app/storyboard-web/test/visual-workflow.test.mjs` and `app/storyboard-web/test/storyboard-edit.test.mjs` for public visual failure kinds `structure-rejected`, `unsupported-image-format`, `image-too-large`, and `invalid-image`
- [x] T004 Extend `safeKind` consumers in `app/storyboard-web/server.mjs` so repaired visual endpoints return those kinds, log bounded codes without dialogue or image bytes, and omit source-item ids from JSON bodies
- [x] T005 [P] Change `parseImageDataUrl` in `app/storyboard-web/image-info.mjs` to return `bytes`, detect HEIC/HEIF, treat `image/jpg` as JPEG, and distinguish oversize from unsupported from unreadable
- [x] T006 Make `saveIdentity` / `insertAsset` in `app/storyboard-web/visual-store.mjs` consume `image.bytes` and return specific image failure kinds instead of throwing into `database`

**Checkpoint**: Shared parser, store, and error contract are ready

---

## Phase 3: User Story 1 - Reliable structural storyboard editing (Priority: P1) 🎯 MVP

**Goal**: Visible-number structural edits preserve dialogue, the Putin full-frame instruction succeeds, undo works, and rejected edits are understandable.

**Independent Test**: Apply `в кадре 14 должен быть только Путин на весь кадр` to the stored 18-frame board, then undo.

- [x] T007 [P] [US1] Extend `app/storyboard-web/test/visual-model.test.mjs` so visible numbers map through directing-beat segments, including the stored 18-frame layout where visible 14 is `frame-12`
- [x] T008 [P] [US1] Add `app/storyboard-web/test/storyboard-edit.test.mjs` cases that preserve context review, apply the exact Putin full-frame intent without rewriting dialogue, reject an invalid candidate as `structure-rejected`, and do not flatten a directing beat
- [x] T009 [US1] In `app/storyboard-web/storyboard-edit.mjs`, send canonical context/note review instead of `[]`, restore that review on every candidate, and resolve user numbers through `displayFrames`
- [x] T010 [US1] Add a bounded deterministic handler in `app/storyboard-web/storyboard-edit.mjs` for “visible frame N should contain only this character as a full-frame panel”; run `buildChecked` on the result; do not add a retry loop
- [x] T011 [US1] Map structural 409 responses in `app/storyboard-web/server.mjs` and `app/storyboard-web/public/app.js` to `structure-rejected` and a concise Russian message that does not mention validation codes

**Checkpoint**: Slice A can be demonstrated independently

---

## Phase 4: User Story 2 - Reliable identity-photo intake (Priority: P1)

**Goal**: JPEG/PNG/WebP identity photos save locally, appear on the card, enable base-anchor generation, and fail with specific Russian copy.

**Independent Test**: Save a synthetic JPEG or PNG, confirm the card and enabled generation, confirm no image-provider call, then try an invalid file.

- [x] T012 [P] [US2] Add tests in `app/storyboard-web/test/visual-workflow.test.mjs` that a valid JPEG and a valid PNG are stored, identity save does not call the image provider, oversize and HEIC/HEIF return specific kinds, and raw versus encoded limits are consistent
- [x] T013 [US2] Align `IMAGE_MAX_BODY_BYTES` in `app/storyboard-web/server.mjs` with the 12 MiB raw asset limit plus base64/JSON wrapping, and return `413` only when the encoded body exceeds that transport limit
- [x] T014 [US2] In `app/storyboard-web/public/index.html` and `app/storyboard-web/public/app.js`, show JPEG/PNG/WebP before selection, validate type/size client-side, accept `.jpg`/`.jpeg`/PNG/WebP, and map identity failure kinds to specific Russian messages
- [x] T015 [US2] Confirm `handleVisualIdentity` in `app/storyboard-web/server.mjs` never invokes the image generator

**Checkpoint**: Slice B can be demonstrated independently

---

## Phase 5: Polish and verification

- [x] T016 [P] Keep zoom-without-provider and storyboard-result isolation tests green in `app/storyboard-web/test/visual-workflow.test.mjs` and `app/storyboard-web/test/postgres/visual-isolation.test.mjs`
- [x] T017 Run `node --test app/storyboard-web/test/**/*.test.mjs` from the repository root
- [x] T018 Run `STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test node app/storyboard-web/test/postgres/verify.mjs`
- [x] T019 Browser-verify both vertical paths against the PostgreSQL-backed server at `http://127.0.0.1:4174/` using a synthetic identity image
- [x] T020 Commit the SpecKit artifacts and the two slices in logical commits on `codex/visual-workflow-repair`

## Dependencies

- Phase 2 blocks US1 and US2.
- US1 and US2 can proceed in parallel after T006.
- T017–T019 require both stories.
- T020 is last.

## Parallel opportunities

- T005 with T003/T004 after the kinds are named.
- T007 and T008 together.
- T012 with T007/T008.
- T016 with remaining polish.

## Implementation strategy

1. Finish parser/store/error-contract foundation.
2. Ship Slice A (structural edit + undo + messages).
3. Ship Slice B (identity intake + messages + limits).
4. Run automated then browser verification.
