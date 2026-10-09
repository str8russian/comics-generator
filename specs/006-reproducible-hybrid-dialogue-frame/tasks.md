# Tasks: Reproducible Hybrid Dialogue Frame

**Input**: Design documents from `/specs/006-reproducible-hybrid-dialogue-frame/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/hybrid-dialogue-frame-api.md, quickstart.md

**Tests**: Required. Write failing tests before or alongside the production change they protect. Distinguish deterministic automated claims, provider-adherence observations, and human visual acceptance.

**Organization**: Foundational persistence/matting/intent first, then user stories in priority order. Vertical checkpoints mark reviewable increments.

**Starting commit**: `2715e2468d6b57e32a882efdd1c39024468d96c6`

**Current baseline facts (do not invent alternate architecture)**:
- Next migration slot is `app/storyboard-web/db/migrations/005_hybrid_dialogue_frame.sql` (`004_project_style_seed.sql` already exists).
- Ordinary dialogue generation today is synchronous full-panel work in `app/storyboard-web/server.mjs` (`handleVisualGeneration` → `generateOnePanel` → `panelPrompt`) returning `200`.
- Cyclic head FK pattern already used by `panel_visual_state.current_generation_id` ↔ `panel_generation` in `003_visual_storyboard_workflow.sql`.
- Shared renderer is `prototypes/storyboard-viewer/frame-renderer.mjs` (single opaque image per panel).
- No ZIP dependency exists; diagnostic archive must be built in-process (pure Node zlib/ZIP) in `visual-diagnostics.mjs`.
- Planning chromakey probe under `specs/006-reproducible-hybrid-dialogue-frame/research/provider-alpha-probe/` is technical planning evidence only and must never be presented as implementation acceptance.
- Evidence directories: automated matte tests use test-local/temporary output only; intentional synthetic evidence goes under `specs/006-reproducible-hybrid-dialogue-frame/verification/synthetic/`; live evidence under `specs/006-reproducible-hybrid-dialogue-frame/verification/live/`; narrative separation in `verification/NOTES.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unmet dependencies, no same-file contention)
- **[Story]**: User-story label for story phases only (`[US1]`…`[US5]`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Lock the pre-feature baseline before additive work.

- [x] T001 Confirm the offline suite is green from the starting commit with `node --test app/storyboard-web/test/**/*.test.mjs` and record any pre-existing failures in `specs/006-reproducible-hybrid-dialogue-frame/verification/NOTES.md` (create the notes file only if needed)
- [x] T002 Confirm PostgreSQL verification against `comics_test` only via `STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test node app/storyboard-web/test/postgres/verify.mjs` (never point destructive helpers at `comics`)
- [x] T003 Confirm feature artifacts under `specs/006-reproducible-hybrid-dialogue-frame/` match the approved Plan set (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/hybrid-dialogue-frame-api.md`, `quickstart.md`, `checklists/requirements.md`) and that work stays on branch `006-reproducible-hybrid-dialogue-frame`

**Checkpoint**: Baseline known; additive implementation may begin

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Additive persistence, deterministic matting, and layered intent/prompt compilers required by every user story.

**⚠️ CRITICAL**: No user-story implementation may begin until this phase is complete.

### Persistence foundations

- [x] T004 Add failing PostgreSQL coverage in `app/storyboard-web/test/postgres/visual-isolation.test.mjs` (and extend TRUNCATE lists for new hybrid tables) for: additive migration compatibility with existing feature-003–005 rows; result A/result B isolation with identical semantic `frame_id` / panel indices; sole `scene_background_state.current_generation_id` ownership; finalize-once `generation_record` transitions; retention of previous ready pointers on failed replacement; no destructive replacement of historical `panel_generation` data; **and explicit shared-background concurrency** for two frame operations from different frames sharing the same version-scoped `"primary"` scene covering atomic scene write claims, monotonically increasing scene `write_version`, `captured_scene_write_version` stored on the background attempt, stale operation completion unable to advance `current_generation_id`, frame-level operation authority alone being insufficient to update the shared background pointer, ready-background reuse without a new scene replacement claim, and stale attempts still finalizing their own generation and provenance evidence
- [x] T005 Create additive migration `app/storyboard-web/db/migrations/005_hybrid_dialogue_frame.sql` that: extends `visual_asset.kind` with `scene-background`, `character-state-raw`, `character-state`; extends `panel_visual_state` with nullable `current_character_generation_id` and `fit_mode` defaulting to `manual`; adds `scene_background_state`, `scene_background_generation`, `frame_hybrid_state`, `visual_frame_operation`, `character_visual_state_generation`, and `generation_record` per `data-model.md` (including `captured_scene_write_version` on background attempts); creates cyclic FKs safely (create nullable columns, then `ALTER TABLE ... ADD CONSTRAINT` after both tables exist, matching the `003` pattern); does not DROP or rewrite historical `panel_generation` rows
- [x] T006 Implement persistence primitives in `app/storyboard-web/visual-store.mjs` for the new tables/columns: create/load hybrid heads; create `visual_frame_operation`; atomic scene write-authority claim (`active_operation_id` + bump/capture `write_version`) vs ready-background reuse without claim; append-only background/character generations; finalize-once `generation_record` (immutable inputs; lifecycle `pending` → `ready|failed` exactly once); advance current pointers only when the matching frame or scene authority still matches; leave previous ready pointers unchanged on failure/stale completion — enough for the non-orchestration portions of T004 to pass once background lifecycle (T017) lands for concurrency cases that require the full claim path

### Deterministic image inspection and matting

- [x] T007 [P] Extend `app/storyboard-web/test/image-info.test.mjs` with failing cases for PNG color type, alpha channel presence, transparent-sample detection, and opaque RGB PNGs (fixtures from `specs/006-reproducible-hybrid-dialogue-frame/research/asset-alpha-samples/` may be read as inputs). Completion: tests exist and fail until T008 lands. Safe to author in parallel with T004–T006 (different files)
- [x] T008 Extend `app/storyboard-web/image-info.mjs` with real PNG IHDR color-type / alpha / transparent-sample inspection helpers used by matting acceptance (do not treat MIME/`image/png` alone as transparency). Depends on T007. Completion: T007 passes
- [x] T009 [P] Create `app/storyboard-web/test/image-matte.test.mjs` covering transparent samples after keying; subject preservation; green-spill rejection on kept opaque pixels; edge-band fringe threshold after cleanup; invalid provider output (checkerboard/fake alpha, non-green backing, fully opaque cutout); and `matte-failed`. Create and clean temporary composite output only through test-local temporary facilities (for example `os.tmpdir()` / `fs.mkdtempSync`, cleaned in `after`/`afterEach`); do **not** write tracked acceptance artifacts into `specs/006-reproducible-hybrid-dialogue-frame/verification/`. Do not treat `research/provider-alpha-probe/` as acceptance. Depends on T008. Safe to author in parallel with T011/T013 after T008
- [x] T010 Implement `app/storyboard-web/image-matte.mjs` with deterministic `#00FF00` chromakey extraction, bounded spill/edge cleanup, RGBA PNG encode, measurable acceptance checks from the Plan, and fail-closed `matte-failed` when thresholds are not met; retain raw RGB and derived RGBA bytes for callers. Depends on T009. Completion: T009 passes

### Layered visual intent and prompt compilation

- [x] T011 [P] Create `app/storyboard-web/test/visual-intent.test.mjs` asserting structured project/scene/frame/panel intent fields, concise grid description vs expanded human-readable detail brief separation, and that ordinary UI-facing briefs never embed the full compiled provider prompt. Safe to author in parallel with T007 and with T009/T013 after their prerequisites
- [x] T012 Implement `app/storyboard-web/visual-intent.mjs` producing layered visual intent plus concise grid description and human-readable detailed brief for split dialogue frames (composition modes include `near-frontal-pair`, `inward-conversation`, `asymmetric-pair`). Depends on T011. Completion: T011 passes
- [x] T013 [P] Extend `app/storyboard-web/test/visual-model.test.mjs` for hybrid compilers: exact self-contained background prompt (style-only, people-free, no identity); exact self-contained single-character prompt (`#00FF00` backing, exactly one assigned visible character, off-screen relational gaze only); ordered identity/style reference roles (distinct roles even when same asset); required `style-required` / `anchor-required` validation helpers; prohibitions against nested layout, second person, dialogue/text/gutters/borders/logos/watermarks; no “one side of a two-panel split screen” / ordinary-dialogue full-scene fallback wording. These tests validate compiled requests and manifests only — they must not claim provider adherence. Safe to author in parallel with T011/T009
- [x] T014 Update `app/storyboard-web/visual-model.mjs` to add hybrid background and character-state compilers + reference-manifest builders, and retire split-layout / full-scene provider wording for ordinary dialogue panels (keep historical helpers only where still needed for non-hybrid paths explicitly outside ordinary-dialogue success). Depends on T013. Completion: T013 passes

**Checkpoint — Vertical #1**: Migration, persistence primitives, image inspection, matting, and prompt compiler are ready. User stories may begin.

---

## Phase 3: User Story 1 - Generate one hybrid split dialogue frame (Priority: P1) 🎯 MVP

**Goal**: Selected split dialogue frame becomes a true hybrid Visual assembly: one primary-scene background + one RGBA character state per panel + shared renderer composition, with no ordinary-dialogue full-scene success path.

**Independent Test**: With approved anchors and project style seed, start generation for one selected split frame using provider doubles; observe `202` + real phases; frame becomes `visualReady` only when background + both character states are ready and assembly validates; dialogue wording/order/`speakerPanel` unchanged; result is not two independent full-scene panel images.

### Tests for User Story 1

- [x] T015 [P] [US1] Extend `app/storyboard-web/test/visual-workflow.test.mjs` with **API/contract** tests (provider doubles) for: pre-accept `409 style-required` / `409 anchor-required` creating no operation/generation/provider call; eligible selected split-dialogue `POST /api/visual/frames/:frameId/generate` → `202` + `operationId`; canonical `GET .../operations/:operationId` phase progression without fabricated percentages; `visualReady` false until all hybrid components ready; previous ready retention on component failure; historical full-panel read precedence (hybrid wins when ready; after hybrid attempt begins, no silent full-scene success fallback); dialogue/`speakerPanel` preservation through overflow fitting; non-eligible/non-ordinary frames do not silently succeed via the hybrid path. Do **not** own reload-polling UX or Russian copy assertions (those belong to T029). Safe to author in parallel with T016 only
- [x] T016 [P] [US1] Extend `app/storyboard-web/test/renderer-structure.test.mjs` (and/or a focused hybrid renderer test colocated there) so deterministic tests prove only: layer ordering (background under panel strip); per-panel clipping; divider/gutter/dialogue geometry; dialogue wording/ordering/`speakerPanel` preservation; character-only placement transform wiring (zoom/pan/object-position); and use of declared composition-mode inputs. These tests must **not** claim that deterministic renderer tests prove provider-created eye-line, facial direction, compatible head scale, or artistic pair quality. Safe to author in parallel with T015 only

### Store implementation for User Story 1 (split; no read-model ownership)

- [x] T017 [US1] Implement **primary-scene background lifecycle** in `app/storyboard-web/visual-store.mjs` as the **sole owner** of background component begin/finalize: create/load `(storyboard_version_id, scene_key="primary")` state; ready-background reuse without claiming replacement authority; atomic scene authority claim (`active_operation_id` + monotonically increasing `write_version`); create the append-only `scene_background_generation` row and its finalize-once `generation_record` **before** background provider I/O, persisting immutable request inputs (intent, compiled prompt, reference manifest, model/settings, scope ids) on that record; persist `captured_scene_write_version` on the background attempt; after provider success/failure (I/O performed outside this short begin transaction — see T023), finalize lifecycle fields exactly once to `ready` or `failed` and link the resulting `scene-background` asset or safe failure metadata; stale attempts may finalize their own generation/provenance records but must not advance `scene_background_state.current_generation_id`; frame-level operation authority alone must be insufficient to update the shared background pointer. Completion: T004 shared-background concurrency/stale/reuse cases pass under doubles, including an assertion that the background `generation_record` exists with immutable inputs before any provider call and finalizes once afterward
- [x] T018 [US1] Implement **character-state lifecycle** in `app/storyboard-web/visual-store.mjs` (+ `app/storyboard-web/image-matte.mjs` integration) as the **sole owner** of character-state begin/finalize: append-only `character_visual_state_generation` with required `anchor_version_id` / `style_asset_id` linkage; create its finalize-once `generation_record` **before** character provider I/O with immutable request inputs; after provider success/failure (I/O outside the short begin transaction — see T023), store raw chromakey `character-state-raw`, run deterministic matting, store derived RGBA `character-state` (or finalize `matte-failed` / provider failure); finalize lifecycle fields exactly once to `ready` or `failed`; keep previous ready `panel_visual_state.current_character_generation_id` while a replacement is pending or failed; advance the head only on non-stale authoritative success. Completion: character-state unit/store tests (extend `app/storyboard-web/test/postgres/visual-isolation.test.mjs` and/or `app/storyboard-web/test/visual-workflow.test.mjs` as needed) prove provenance-before-I/O, retention, matte-failed, and non-stale head advance under doubles
- [x] T019 [US1] Implement **frame operation orchestration** in `app/storyboard-web/visual-store.mjs` **without creating component generations or `generation_record` rows**: wire the already-defined background lifecycle operations (T017) and required panel character-state lifecycle operations (T018) for a selected split frame; advance persisted real phases only as corresponding work runs; maintain `component_failures_json`; route frame-scoped authority to character/assembly heads and scene-scoped authority to the shared background pointer (never use frame authority as sufficient for background pointer updates); proceed to assembly readiness (T020). Completion: orchestration under doubles drives preparing/generating/assembling phases without inventing percentages and without inserting provenance rows itself
- [x] T020 [US1] Implement **assembly readiness** in `app/storyboard-web/visual-store.mjs`: deterministic assembly validation; set `frame_hybrid_state.assembly_status`; derive `visualReady` only when the resolved primary background and every required panel character state are ready and assembly validates; retain the previous valid assembly when a replacement attempt fails. Completion: T015 readiness/retention contract cases that depend on assembly pass. Do **not** shape the full `GET /api/visual` read model here (owned by T027)

**Checkpoint — Vertical #2**: Background lifecycle independently testable under doubles, including provenance-before-I/O (after T017).

**Checkpoint — Vertical #3**: Character-state lifecycle independently testable under doubles, including provenance-before-I/O (after T018).

### Server implementation for User Story 1 (split; no logging ownership)

- [x] T021 [US1] Implement **HTTP validation and acceptance** in `app/storyboard-web/server.mjs`: route only eligible selected split-dialogue frames into the hybrid accept path; validate required style/identity **before** creating an operation (`409 style-required` / `409 anchor-required` with no operation/generation/provider work); create persisted `visual_frame_operation` + set `frame_hybrid_state.active_operation_id`; return prompt `202` with `operationId` / phase / writeVersion per contract; preserve existing behavior for out-of-scope or non-ordinary frames rather than silently routing them through the hybrid success path. Completion: T015 accept/`409`/`202` cases pass. Do **not** own polling, deferred worker, failure-kind mapping tables, or allowlisted logging
- [x] T022 [US1] Implement the **canonical poll endpoint** `GET /api/visual/frames/:frameId/operations/:operationId` in `app/storyboard-web/server.mjs`: exact operation lookup scoped to current result/version/frame; return persisted phase/status/`visualReady`/hybrid component summary per contract; terminal `complete`/`failed` response behavior without fabricated percentages. Completion: T015 poll-progression cases pass
- [x] T023 [US1] Implement the **contained deferred worker** in `app/storyboard-web/server.mjs` (no new worker service): start only after accepted operation persistence and only after the `202` response is written (for example `setImmediate` / deferred promise that does not block the response). Boundary rules: `visual-intent.mjs` and `visual-model.mjs` compile the request and reference manifest; store lifecycle begin/finalize functions (T017/T018) perform short DB transactions only; this worker/server boundary invokes the injected provider through `image-provider.mjs`; **provider I/O always occurs outside database transactions** — no DB transaction remains open while awaiting the provider; after provider success or failure, call the appropriate store finalizer (T017/T018); invoke store orchestration (T019) to sequence components/phases; explicitly catch every rejected promise from deferred work and every provider rejection, converting them into persisted terminal `failed` operation/component outcomes where possible; never leave an operation silently hanging because of an unhandled rejection; do **not** claim or implement server-process restart recovery (browser reload recovery remains via `GET /api/visual` later). Completion: forced throw/rejection and provider-rejection doubles finalize `failed` with no unhandledRejection and with no open transaction spanning provider await
- [x] T024 [US1] Implement **failure mapping** in `app/storyboard-web/server.mjs` (and store error surfaces as needed): map contract kinds (`matte-failed`, `invalid-output`, `assembly-failed`, `provider`, `conflict`, `style-required`, `anchor-required`, `frame-generation-required`, `not-found`, etc.); populate operation `componentFailures`; distinguish HTTP pre-accept failures from polled terminal failures. Completion: T015 failure-kind contract cases pass. Do **not** own allowlisted logging (T031)

**Checkpoint — Vertical #4**: Persisted orchestration plus contained async HTTP path reviewable (after T019–T024).

### Renderer, overflow, read model, and UI for User Story 1

- [x] T025 [US1] Extend `prototypes/storyboard-viewer/frame-renderer.mjs` for hybrid Visual mode: draw one shared scene background under the visual panel strip; draw per-panel clipped RGBA character layers with existing zoom/pan/object-position transforms; preserve deterministic divider/gutter/dialogue geometry and dialogue wording/ordering/`speakerPanel`; do not create a second renderer. Completion: T016 passes
- [x] T026 [US1] Extend `app/storyboard-web/overflow.mjs` so fitting/overflow preserves hybrid assignment fields (`hybrid` metadata, character placement, `fitMode`, readiness) and recomputes `visualReady` from hybrid readiness rules rather than opaque full-panel `assetId` alone. Completion: overflow-related cases in T015 pass; further regression in T044
- [x] T027 [US1] Wire the **sole** `GET /api/visual` hybrid read-model shaping in `app/storyboard-web/visual-store.mjs` + `app/storyboard-web/server.mjs`: concise grid descriptions; human-readable detailed briefs (never compiled prompts as primary UI copy); `hybrid.activeOperationId` / operation summary for browser reload restore; background resolved only through `scene_key="primary"` → `scene_background_state.current_generation_id`; historical full-panel precedence exactly as specified. Completion: load payload matches contract for hybrid and historical frames. No other task owns this shaping
- [ ] T028 [US1] Update `app/storyboard-web/public/app.js` / `app/storyboard-web/public/index.html` / `app/storyboard-web/public/app.css` so selected-frame generate uses the `202` + canonical poll path, enters Visual mode only on hybrid `visualReady`, keeps visible frame number / controls / status outside the 1920×1080 canvas, shows concise grid description + human-readable brief (never the full technical prompt in ordinary UI), and does not present incomplete hybrid state as completed Visual mode. Completion: doubles-backed selected split frame can enter Visual mode end-to-end

**Checkpoint — Vertical #5**: One end-to-end selected split frame can enter Visual mode through the hybrid path (MVP demoable).

---

## Phase 4: User Story 2 - Honest progress, partial readiness, and safe failure (Priority: P1)

**Goal**: Immediate honest async feedback; no fabricated percentages; previous valid results remain visible; specific retryable failures.

**Independent Test**: Start generation; see running phase immediately; force only one character ready → not Visual-ready; force a failure after a valid result → previous result remains with a specific retryable failure; reload mid-run resumes canonical polling via `activeOperationId` from `GET /api/visual`.

### Tests for User Story 2

- [ ] T029 [US2] Extend `app/storyboard-web/test/visual-workflow.test.mjs` with **honesty/reload/UI-mapping** coverage (not duplicating T015 API contracts): no timer-driven phase transitions; partial readiness never presented as Visual-ready; failed replacement retains previous ready background/character pointers in the load model; reload restore of `hybrid.activeOperationId` then resume of canonical operation polling; Russian actionable mapping for hybrid failure kinds including `matte-failed`, `style-required`, `anchor-required`, `frame-generation-required`, `assembly-failed`. Not marked `[P]` (same file as T015)

### Implementation for User Story 2

- [ ] T030 [US2] Complete frame-level running / completion / failure UI in `app/storyboard-web/public/app.js` and `app/storyboard-web/public/index.html`: poll only `GET /api/visual/frames/:frameId/operations/:operationId` while running; on reload call `GET /api/visual` then resume that poll; never invent percentage progress or client-side phase overrides; keep previous valid assembly visible during pending/failed replacements; show specific concise Russian retryable failures outside the canvas. Completion: T029 passes for UI/reload behaviors
- [ ] T031 [US2] Own **all** hybrid allowlisted logging in `app/storyboard-web/server.mjs` for events (`visual-hybrid-frame-start`, `visual-hybrid-operation-phase`, background/character provider/matte/storage, `visual-hybrid-frame-outcome`, and related safe fields) excluding prompts, dialogue, image bytes/base64, credentials, Authorization headers, secret-bearing URLs, and full provider bodies; cover exclusions in `app/storyboard-web/test/visual-workflow.test.mjs`. No other task owns hybrid logging. Completion: exclusion assertions pass

**Checkpoint**: Honest async feedback and safe failure behavior are independently demonstrable on top of US1

---

## Phase 5: User Story 3 - Deterministic placement without regeneration (Priority: P1)

**Goal**: Zoom/pan/fit/reset are local, provider-free, background-stable, and reload-persistent; controls stay outside the canvas.

**Independent Test**: Assemble a hybrid frame; change zoom/pan; confirm immediate crop, zero provider calls, stable background, fit/reset, and reload persistence of placement.

### Tests for User Story 3

- [ ] T032 [US3] Extend `app/storyboard-web/test/visual-workflow.test.mjs` so `PATCH /api/visual/frames/:frameId/panels/:panelIndex/placement` updates `panel_visual_state` zoom/pan/`fit_mode` only, makes zero image-provider calls, does not mutate scene background pointers/assets, and survives reload for the same storyboard version. Not marked `[P]` (same file as T015/T029)

### Implementation for User Story 3

- [ ] T033 [US3] Extend placement persistence in `app/storyboard-web/visual-store.mjs` and `PATCH` handling in `app/storyboard-web/server.mjs` for `fitMode` (`manual` \| `fit`) alongside zoom/pan; character-only transforms; no background mutation; no provider calls. Completion: T032 passes
- [ ] T034 [US3] Update detail-view controls in `app/storyboard-web/public/app.js` / `app/storyboard-web/public/app.css` / `app/storyboard-web/public/index.html` for zoom, pan, fit, and reset outside the 1920×1080 canvas; apply character-layer transforms immediately; keep the shared background spatially stable; persist placement locally through the placement endpoint. Completion: placement UX works with zero provider calls

---

## Phase 6: Panel regeneration (supports US1 / US2)

**Goal**: Regenerating one panel revises only that character state against a ready primary background; no implicit background workflow; no performance-reference or cumulative text-revision behavior in this slice.

**Independent Test**: Without ready background → `409 frame-generation-required` and no operation/provider work; with ready background → only selected character state regenerates; previous ready character remains visible until replacement succeeds; stale replacements cannot advance the head.

### Tests for Panel Regeneration

- [ ] T035 [US1] Extend `app/storyboard-web/test/visual-workflow.test.mjs` for `POST /api/visual/frames/:frameId/panels/:panelIndex/generate`: ready-background precondition → else `409 frame-generation-required` with no operation/generation/provider call; accepted path returns `202` with `scope=panel`; reuses background without scene write claim; generates only the selected character state; previous ready character state remains current until non-stale success; stale completion cannot advance `current_character_generation_id`; no performance-reference / cumulative free-text revision behavior in this slice. Not marked `[P]` (same file as T015/T029/T032)

### Implementation for Panel Regeneration

- [ ] T036 [US1] Implement panel regenerate accept/orchestrate path in `app/storyboard-web/server.mjs` + `app/storyboard-web/visual-store.mjs` per contract (`scope=panel`, background reuse without scene replacement claim, frame-scoped write authority, finalize-once provenance), reusing T021–T024 patterns for accept/poll/worker/failure mapping without re-owning logging. Completion: T035 passes
- [ ] T037 [US1] Update panel regenerate UI in `app/storyboard-web/public/app.js` to use `202` + canonical poll, keep previous ready character visible during replacement, and surface `frame-generation-required` by directing the user to generate the complete selected frame first. Completion: panel regen UX matches contract

**Checkpoint — Vertical #6**: Local placement and panel regeneration are reviewable together

---

## Phase 7: User Story 4 - Reproducible local generation evidence (Priority: P2)

**Goal**: Finalize-once provenance for every provider request; explicit local diagnostic ZIP; safe ordinary logs; no auto-upload; no generalized learning-platform UI.

**Independent Test**: Complete a frame generation under doubles; `GET /api/visual/frames/:frameId/diagnostics` returns `application/zip` with required contents and exclusions; ordinary logs remain allowlisted.

### Tests for User Story 4

- [ ] T038 [US4] Create `app/storyboard-web/test/visual-diagnostics.test.mjs` that builds/exports a diagnostics ZIP and asserts archive contents include prompts, briefs, intent, manifests, reference roles/hashes, provider settings (non-secret), operations, outputs, raw chromakey assets, RGBA cutouts, composites when available, placement, and assembly manifest; asserts exclusion of credentials, `.env`, Authorization material, secret-bearing URLs, unrelated frames/results; asserts `404 not-found` when no generation evidence exists. Depends on provenance from T017/T018 and read-model/version scoping from T027; **not** marked `[P]` until those prerequisites exist (do not author as parallel with foundational work)

### Implementation for User Story 4

- [ ] T039 [US4] Implement `app/storyboard-web/visual-diagnostics.mjs` as an in-process ZIP builder (pure Node zlib/ZIP; no remote upload) scoped to the current result/version/frame. Completion: T038 content/exclusion cases that exercise the builder pass
- [ ] T040 [US4] Add `GET /api/visual/frames/:frameId/diagnostics` in `app/storyboard-web/server.mjs` returning `application/zip` with `Content-Disposition: attachment; filename="frame-<frameId>-diagnostics.zip"`, never auto-upload. Emit diagnostics export through the logging ownership in T031 only (this task does not redefine the allowlist). Completion: HTTP contract + T038 pass
- [ ] T041 [US4] Add an explicit diagnostics download control in `app/storyboard-web/public/app.js` / `app/storyboard-web/public/index.html` / `app/storyboard-web/public/app.css` outside the 1920×1080 canvas. Completion: user can download the ZIP on demand

**Checkpoint**: Local provenance + diagnostic export are independently demonstrable

---

## Phase 8: User Story 5 - Result and version isolation (Priority: P2)

**Goal**: Matching semantic frame IDs / panel indices across storyboard results never share mutable hybrid state, placement, or diagnostic evidence.

**Independent Test**: Generate or reposition in result A while result B shares the same frame/panel ids; result B unchanged; diagnostics for A are not presented as B’s.

### Tests / hardening for User Story 5

- [ ] T042 [US5] Extend `app/storyboard-web/test/postgres/visual-isolation.test.mjs` to cover hybrid backgrounds, character states, placement, operations, provenance, and diagnostics scoping across result A vs result B with identical semantic frame/panel keys (building on T004). Not marked `[P]` (same file as T004; sequential after hybrid write paths exist)
- [ ] T043 [US5] Audit version-scoped keys and load/export paths in `app/storyboard-web/visual-store.mjs` and `app/storyboard-web/visual-diagnostics.mjs` so no mutable current hybrid/background pointer or diagnostic enumeration can cross `storyboard_version_id` / result boundaries. Completion: T042 passes

---

## Phase 9: Polish & Cross-Cutting Verification

**Purpose**: Author remaining regressions, run final green suites that include them, then browser → doubles-only forced failures → synthetic → counted live → live composites/human review.

- [ ] T044 Extend overflow/hybrid regression coverage in `app/storyboard-web/test/overflow.test.mjs` so fitted pieces preserve hybrid fields and readiness semantics introduced in T026. Depends on T026; not marked `[P]`
- [ ] T045 Add focused compatibility regression coverage in `app/storyboard-web/test/visual-workflow.test.mjs` and/or existing suites proving feature 006 does not break: identity-photo storage; base-anchor generation and approval; first approved project style seed behavior; structural storyboard editing and undo; existing Structure rendering; dialogue fitting and overflow; historical full-panel rows and their defined read precedence; existing behavior for single/action or otherwise non-eligible frames (hybrid route remains gated to eligible selected split dialogue frames; do not implement a new special/action generation path). Depends on T021 gating and T027 precedence; not marked `[P]` (same-file contention with other `visual-workflow.test.mjs` tasks). Must be authored **before** the final offline suite (T046)
- [ ] T046 Run the complete offline suite `node --test app/storyboard-web/test/**/*.test.mjs` **after T044 and T045** so the run includes overflow and compatibility regressions; fix only regressions caused by this feature
- [ ] T047 Run PostgreSQL verification against `comics_test` only (`STORYBOARD_TEST_DATABASE_URL=.../comics_test node app/storyboard-web/test/postgres/verify.mjs`) **after T046** and after all PostgreSQL tests/migrations for this feature are final; never run destructive tests against `comics`
- [ ] T048 Browser acceptance on `http://127.0.0.1:4174/` for the selected split dialogue frame: honest phases; Visual mode only when complete; reload persistence; zoom/pan with zero provider calls; incomplete hybrid not shown as Visual; dialogue unchanged; controls/frame number outside canvas. Depends on green **T046 and T047**. When recording browser notes/screenshots under `specs/006-reproducible-hybrid-dialogue-frame/verification/`, create that directory and `verification/NOTES.md` if absent (not as live cutout proof)
- [ ] T049 Force provider/storage/matte failure paths using **provider/storage/matte doubles only** — this task **must not** make live provider calls. Confirm previous valid result retention and specific retryable failures; append under `specs/006-reproducible-hybrid-dialogue-frame/verification/NOTES.md` in the deterministic/failure section (create `NOTES.md` if absent and not already created by T048). If a failure path genuinely cannot be evaluated with doubles: record that limitation in NOTES during this task; **defer** any live failure experiment into the counted live-provider window (T051); do not call the live provider here
- [ ] T050 Write intentional **deterministic/synthetic** cutout and light/dark/contrast composite evidence under `specs/006-reproducible-hybrid-dialogue-frame/verification/synthetic/` (create `verification/synthetic/` if absent) using doubles or local synthetic chromakey fixtures (not live provider output, not `research/provider-alpha-probe/`). Record measurable spill/fringe results for those synthetics in `verification/NOTES.md` under a **synthetic composite inspection** section (create `NOTES.md` if absent). This task does **not** prove live edge quality
- [ ] T051 Real-provider verification **only after** green T046–T047 and after T050: run the selected-frame hybrid path against the contest image provider. The implementation-verification total recorded in `specs/006-reproducible-hybrid-dialogue-frame/verification/NOTES.md` under **live provider-adherence observations** must include **every** live provider request made during this feature’s implementation verification, broken down into successful requests, retries, and deliberate failure requests (with justification for every deliberate live failure deferred from T049). Expected first successful split frame ≈ 1 background + 2 character requests = **3**, plus any recorded retries/deliberate failures. Confirm ordinary dialogue acceptance is a true hybrid assembly (shared background + two cutouts), not two full-scene images. Do not claim planning-probe or synthetic fixtures prove live quality; the earlier planning probe remains excluded and separately identified as planning research only
- [ ] T052 After T051, composite each **live** derived cutout over light, dark, and strongly contrasting backgrounds; create `specs/006-reproducible-hybrid-dialogue-frame/verification/live/` if absent and save those live composites and related assets there; record measurable spill/fringe results and a separate **human visual edge acceptance** subsection in `verification/NOTES.md`. Keep deterministic automated results, synthetic inspection, live provider-adherence, and human visual acceptance as distinct sections
- [ ] T053 Confirm scope guards held: no batch/all-frame generation; no multi-scene manager; no background-approval UI; no performance-reference reapply; no cumulative free-text panel revision; no special/action full-panel path required for ordinary dialogue; no second renderer; no remote matting service; no product-memory / main `comics-pipeline` / `comics-pipeline-image-spike` modifications; in-process async does not claim server-process restart recovery

**Checkpoint — Vertical #7**: Diagnostics, isolation, synthetic evidence, and live verification are reviewable

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Setup; **blocks all user stories**
- **Phase 3 (US1)**: Depends on Phase 2; delivers MVP hybrid Visual frame via split store/server increments
- **Phase 4 (US2)**: Depends on US1 accept/poll/load/UI surface; refines honesty + owns logging
- **Phase 5 (US3)**: Depends on hybrid assembly existing (US1)
- **Phase 6 (Panel regen)**: Depends on US1 background readiness + US2 polling UX patterns
- **Phase 7 (US4)**: Depends on finalize-once records (T017/T018) and read-model scoping (T027)
- **Phase 8 (US5)**: Builds on T004/T006/T017; finalize after hybrid write paths exist
- **Phase 9 (Polish)**: Depends on desired stories; order is overflow → compatibility → offline suite → postgres → browser → doubles-only forced failures → synthetic → counted live → live composites → scope

### User Story Dependencies

- **US1 (P1)**: After Foundational — MVP
- **US2 (P1)**: After US1 accept/poll/load surface exists
- **US3 (P1)**: After US1 hybrid renderer/store placement fields exist
- **US4 (P2)**: After US1 provenance + T027
- **US5 (P2)**: Isolation tests start in Foundational (T004); final audit after hybrid paths land

### Critical dependency path

```text
T001–T003 (baseline)
  → T004 (failing postgres contracts, incl. multi-frame primary concurrency)
  → T005 (migration 005) → T006 (store primitives)
  → T007 (image-info tests) → T008 (image-info impl)
  → T009 (matte tests) → T010 (matte impl)
  → T011 → T012 and T013 → T014 (intent + compilers; T011/T013 || after their prereqs)
  → T015 || T016 (US1 failing tests)
  → T017 (background lifecycle + provenance-before-I/O)   ← Vertical #2
  → T018 (character-state lifecycle + provenance-before-I/O) ← Vertical #3
  → T019 (orchestration only) → T020 (assembly readiness)
  → T021 (HTTP accept/202) → T022 (poll) → T023 (deferred worker; provider I/O outside TX) → T024 (failure mapping)
                                              ← Vertical #4
  → T025 (renderer) → T026 (overflow) → T027 (GET /api/visual read model) → T028 (UI)
                                              ← Vertical #5
  → T029–T031 (honest progress + logging ownership)
  → T032–T034 (placement) → T035–T037 (panel regen)
                                              ← Vertical #6
  → T038–T041 (diagnostics ZIP)
  → T042–T043 (isolation audit)
  → T044 (overflow regression)
  → T045 (compatibility regression)
  → T046 (complete offline suite, includes T044/T045)
  → T047 (complete PostgreSQL verification)
  → T048 (browser acceptance; depends on T046+T047)
  → T049 (doubles-only forced failures; no live calls)
  → T050 (synthetic evidence)
  → T051 (counted live provider run; depends on T046+T047+T050)
  → T052 (live composites + human edge acceptance)
  → T053 (scope confirmation)
                                              ← Vertical #7
```

### Parallel Opportunities

- After T003: `T007 [P]` with `T004`–`T006` (different files). `T008` follows `T007` (not parallel with it).
- After T008: `T009 [P]` with `T011 [P]` / `T013 [P]` (different files). `T010` follows `T009`; `T012` follows `T011`; `T014` follows `T013`.
- `T015 [P]` with `T016 [P]` only (different test files). Neither is parallel with store/server implementation tasks.
- No `[P]` on later `visual-workflow.test.mjs` tasks (`T029`, `T032`, `T035`, `T045`) — same-file contention with `T015`.
- No `[P]` on `T042` (same file as `T004`) or `T044` (depends on `T026`).
- No `[P]` on `T038` until `T017`/`T018`/`T027` exist; then it is still sequential relative to those prerequisites.

### Within Each User Story

- Tests first (or alongside) and failing before production changes land
- Background lifecycle before character-state before orchestration before assembly
- `T017`/`T018` are the only owners of component generation + provenance begin/finalize
- `T019` orchestrates only; does not create provenance rows
- HTTP accept before poll before deferred worker before failure mapping
- `T023` owns contained provider invocation outside DB transactions
- Read-model (`T027`) is the sole owner of `GET /api/visual` shaping
- Logging (`T031`) is the sole owner of hybrid allowlisted logs
- Story checkpoint before moving priority

---

## Parallel Example: Foundational inspection + intent

```bash
# After T003, in parallel with persistence T004–T006:
Task: "T007 image-info failing tests in app/storyboard-web/test/image-info.test.mjs"

# After T007 completes:
Task: "T008 image-info helpers in app/storyboard-web/image-info.mjs"

# After T008, in parallel:
Task: "T009 matte failing tests in app/storyboard-web/test/image-matte.test.mjs"
Task: "T011 intent failing tests in app/storyboard-web/test/visual-intent.test.mjs"
Task: "T013 hybrid compiler failing tests in app/storyboard-web/test/visual-model.test.mjs"
```

## Parallel Example: User Story 1 tests

```bash
# Only these two US1 test tasks are mutually [P]:
Task: "T015 API/contract tests in app/storyboard-web/test/visual-workflow.test.mjs"
Task: "T016 deterministic renderer geometry/wiring tests in app/storyboard-web/test/renderer-structure.test.mjs"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1 Setup
2. Complete Phase 2 Foundational — **Vertical checkpoint #1**
3. Land T017 then T018 — **Vertical checkpoints #2 and #3**
4. Land T019–T024 — **Vertical checkpoint #4**
5. Land T025–T028 — **Vertical checkpoint #5**; **STOP and VALIDATE** one selected split frame entering Visual mode under doubles
6. Continue US2–US5 and polish through synthetic then live verification

### Incremental Delivery

1. Setup + Foundational → persistence/matting/compilers reviewable
2. Background lifecycle (incl. provenance-before-I/O) → independently testable
3. Character-state lifecycle (incl. provenance-before-I/O) → independently testable
4. Orchestration + contained async HTTP (provider I/O outside TX) → reviewable operation path
5. Renderer/read-model/UI → hybrid Visual mode MVP
6. US2 honesty + logging ownership
7. Placement + panel regen
8. Diagnostics + isolation
9. Overflow + compatibility → final offline + postgres suites → browser → doubles-only failures → synthetic → counted live → live composites/human acceptance

### Vertical Checkpoints (reviewable increments)

1. **Migration, persistence primitives, image inspection, matting, and prompt compiler** — after Phase 2 (`T014`)
2. **Background lifecycle independently testable under doubles, including provenance-before-I/O** — after `T017`
3. **Character-state lifecycle independently testable under doubles, including provenance-before-I/O** — after `T018`
4. **Persisted orchestration plus contained async HTTP path** — after `T019`–`T024`
5. **One selected split frame entering Visual mode** — after `T028`
6. **Placement and panel regeneration** — after `T037`
7. **Diagnostics, isolation, synthetic evidence, and live verification** — after `T052`/`T053`

---

## Notes

- Ordinary dialogue success MUST be hybrid assembly; automatic full-panel fallback is prohibited
- Historical `panel_generation` / `panel-image` rows remain readable under the specified precedence; migration is additive only
- Async model is in-process on the existing `server.mjs` Node process (no worker microservice): accept → persist → `202` → deferred real work → canonical poll. Browser reload recovery uses `GET /api/visual` then canonical poll. Server-process restart recovery is out of scope and must not be claimed
- Expected real-provider verification for first successful split frame ≈ **3** requests (1 background + 2 characters); record the exact implementation-verification total during T051 as successful / retries / deliberate failures; live composites/human edge notes during T052. T049 makes no live calls. Planning probe requests are excluded and labeled as planning research only
- `verification/NOTES.md` sections must remain distinct: deterministic automated results; synthetic composite inspection; live provider-adherence observations; human visual acceptance. Create `verification/` + `NOTES.md` on first intentional evidence write (T048/T049/T050); create `verification/synthetic/` in T050 and `verification/live/` in T052 if absent
- Provider I/O is always outside DB transactions: compilers in `visual-intent.mjs`/`visual-model.mjs`; short begin/finalize in store lifecycle; inject/call provider from the T023 worker/server boundary via `image-provider.mjs`
- Do not modify product memory, the main `comics-pipeline` checkout, or `comics-pipeline-image-spike`
- Out of scope for tasks: batch generation, multi-scene UI, background approval/editing UI, performance-reference reapply, cumulative free-text revision, special/action full-panel generation, Interpret/Stage/dialogue/source/structural-edit product changes, timing/audio/video/deployment/final-approval, second renderer, remote matting, generalized learning-platform UI
