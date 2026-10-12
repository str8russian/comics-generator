# Tasks: Research workspace dock

**Input**: Design documents from `/specs/009-research-workspace-dock/`

**Prerequisites**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md), [contracts/research-api.md](./contracts/research-api.md), [contracts/research-event.schema.json](./contracts/research-event.schema.json), [checklists/requirements.md](./checklists/requirements.md)

**Tests**: Required — test-first for each new behavior (accepted Plan). Provider doubles only for deterministic plumbing. No live providers. Do not execute these tasks in the Tasks stage.

**Organization**: Setup → Foundational (shared research seam) → US1–US4 (all P1; dependency order below) → Polish. Preserve append-only PostgreSQL `research_event` on `storyboard-pg`, migration `005`, DI `researchStore`, one `#research-dock` reparented into `#detail`, Notes-only busy exemption, no-job Operations.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable only when different files and no unfinished dependency
- **[Story]**: `[US1]`–`[US4]` on user-story phase tasks only
- Exact repository-relative paths; FR/SC/contract citations where material
- All tasks start unchecked; this stage does not mark them complete

## Path Conventions

- App: `app/storyboard-web/`
- Planned modules: `research-store.mjs`, `research-text-policy.mjs`, `public/research-dock.mjs`
- Migration: `db/migrations/005_research_workspace_dock.sql`
- Tests: `test/*.test.mjs`, `test/postgres/research-persistence.test.mjs`
- PG verifier (auto-globs `test/postgres/*.test.mjs`): `test/postgres/verify.mjs`
- Protected no-edits: `prototypes/storyboard-viewer/frame-renderer.mjs`, product tables beyond research migration, generation grammar

**Routes (mandatory)**: `POST /api/research/notes`, `POST /api/research/events`, `GET /api/research/trace` (use `?kind=note` / `?surface=dock_commands` filters).

---

## Phase 1: Setup (baseline inventory)

**Purpose**: Record baseline and exact seams before any production edits.

- [X] T001 Record baseline of focused offline suites from `app/storyboard-web/`: `node --test test/redaction.test.mjs test/lifecycle.test.mjs test/visual-workflow.test.mjs test/storyboard-edit.test.mjs test/draft-autosave.test.mjs test/visual-page.test.mjs` (and `test/postgres/storyboard-result.test.mjs` / `test/postgres/visual-isolation.test.mjs` only if `STORYBOARD_TEST_DATABASE_URL` already points at `comics_test`). **FR-036**. **Done when**: pass/fail + suite names recorded; no source edits. **Proof**: terminal summary.

- [X] T002 Inventory exact extension points: `app/storyboard-web/server.mjs` (`createServer`, `attachStore`, `handle`, `DEFAULT_MAX_BODY_BYTES`, `logLine`/`logVisual`), `project-store.mjs` / `visual-store.mjs` DI patterns, `db/migrate.mjs` + `db/migrations/00*.sql`, `public/index.html` (`#detail` dialog), `public/app.css` (`body[data-busy="true"] button`), `public/app.js` (`runBusy`, `showModal`/`openDetail`, `saveCast`, Structure/panel/placement/approve submit sites), planned `research-store.mjs`, `research-text-policy.mjs`, `public/research-dock.mjs`. Confirm `test/postgres/verify.mjs` already globs `*.test.mjs` (no manifest registration). **FR-020, FR-028**. **Done when**: short inventory note for the implementer lists symbols/paths. **Proof**: note cites those symbols.

- [X] T003 [P] Confirm protected no-edit surfaces for this feature: `prototypes/storyboard-viewer/frame-renderer.mjs`, existing product migrations `001`–`004`, `docker-compose.yml` volume name `storyboard-pg` (reuse, do not add a volume). **FR-036–FR-038**. **Done when**: note records “no geometry / no Fast product-schema rewrite / no new Compose volume”. **Proof**: path check + Plan match.

**Checkpoint**: Baseline known. Suggested Cursor range: **T001–T003**.

---

## Phase 2: Foundational (research persistence + API seam)

**Purpose**: Shared schema, migration, text policy, store, and HTTP routes required before any dock story. Keep this the minimum seam for Notes + ordered events — not a horizontal platform.

**⚠️ CRITICAL**: No US work until this phase completes.

### Tests (must fail before matching implementation)

- [X] T004 [P] Create `app/storyboard-web/test/research-text-policy.test.mjs` with failing canaries for `assertResearchSubmittedTextSafe` (or exported equivalent) covering Authorization/Bearer forms, credential-bearing URL/DSN, sensitive query parameters (`token`/`access_token`/`api_key`/`password`/`secret`/`signature`), and `data:*;base64` / `data:image/…;base64`. Ordinary Russian owner prose must pass unchanged. **FR-030, SC-007**; [research-api.md](./contracts/research-api.md) Protected-content. **Done when**: file exists and fails because module/policy is missing. **Proof**: `node --test test/research-text-policy.test.mjs`.

- [X] T005 [P] Create `app/storyboard-web/test/research-store.test.mjs` with failing offline DI cases: append `note`; monotonic `seq`; at most one `action_start` and one `action_terminal` per `correlation_id`; terminal derives `semanticAction`/`surface`/`commandTarget`/`editTarget`/`context`/`submittedText` from stored start; `durationMs` from server timestamps; terminal without start requires `startSnapshot` and sets `outcomeFlags.evidenceIncomplete` with `durationMs: null`; duplicate start/terminal rejected; display vs structure frame fields remain distinct in frozen context. **FR-011, FR-019, FR-022, FR-023**. **Done when**: tests fail before store exists. **Proof**: `node --test test/research-store.test.mjs`.

- [X] T006 Create `app/storyboard-web/test/research-api.test.mjs` that (a) compiles `specs/009-research-workspace-dock/contracts/research-event.schema.json` with Ajv Draft 2020-12 + `ajv-formats` (`strict: true`) as a **baseline contract assertion** that may be green immediately (the accepted schema already exists and compiles); (b) adds HTTP cases via `createServer({ researchStore })` for `POST /api/research/notes`, `POST /api/research/events`, `GET /api/research/trace` (+ `?kind=note`, `?surface=dock_commands`); `kind=protected-content` with **no** secret echo in body/logs; forbidden object keys → `invalid-request`; oversize body → `413` empty; `reading` `submittedText` longer than 8000 chars accepted within `DEFAULT_MAX_BODY_BYTES` (account for JSON envelope); no universal 8000 rejection; operational `logLine` never includes `submittedText` — these route/store cases are expected to fail before implementation. **FR-019, FR-021, FR-025, FR-028–FR-031, FR-033**; [research-api.md](./contracts/research-api.md). **Done when**: suite exists; schema compile is baseline-green; new route/store cases are red for missing routes/policy/wiring. **Proof**: `node --test test/research-api.test.mjs`.

- [X] T007 Create `app/storyboard-web/test/postgres/research-persistence.test.mjs` (skip unless `STORYBOARD_TEST_DATABASE_URL` → `comics_test`) with failing cases: migration `005_research_workspace_dock` applies; Notes + full ordered trace survive pool reconnect / simulated app restart; partial unique indexes enforce one start/terminal per correlation; long draft `reading` row stores full text without truncation. **FR-024–FR-026, SC-003**. **Done when**: file exists and fails before migration/store wiring against real PG. **Proof**: focused PG test output when URL set; skip recorded when unset.

### Implementation

- [X] T008 Implement bounded policy in `app/storyboard-web/research-text-policy.mjs` so T004 passes. Reject atomically; do not claim general DLP; do not log/return matched secrets. **FR-030**. **Done when**: T004 green. **Proof**: `node --test test/research-text-policy.test.mjs`.

- [X] T009 Add `app/storyboard-web/db/migrations/005_research_workspace_dock.sql` creating append-only `research_event` per [data-model.md](./data-model.md): closed CHECKs for `event_kind`/`semantic_action`/`surface`/`outcome`; `edit_target` required iff `cast_edit`; **no** `char_length <= 8000`; **no** `research_error` column; partial unique indexes on `(correlation_id) WHERE event_kind = 'action_start'` and `… action_terminal`; indexes `(event_kind, seq)` and `(surface, seq)`. **FR-022, FR-024**. **Done when**: migration file present and matches data-model constraints verbatim. **Proof**: file review + later T007/T011 PG apply.

- [X] T010 Implement `createResearchStore(pool)` in `app/storyboard-web/research-store.mjs` (`appendNote`, `appendEvent`, `listTrace`) enforcing T005 correlation/derivation rules and calling text policy before insert. **FR-019–FR-023, FR-029**. **Done when**: T005 green. **Proof**: `node --test test/research-store.test.mjs`.

- [X] T011 Wire `researchStore` into `createServer` / `attachStore` in `app/storyboard-web/server.mjs` and register `POST /api/research/notes`, `POST /api/research/events`, `GET /api/research/trace` per [research-api.md](./contracts/research-api.md); apply text policy + forbidden-key rejection; never `logLine` research text; keep existing sanitized allowlists unchanged. **FR-028–FR-031, FR-033**. **Done when**: T006 green. **Proof**: `node --test test/research-api.test.mjs`.

- [X] T012 Make `app/storyboard-web/test/postgres/research-persistence.test.mjs` green against real `comics_test` (migration apply + restart durability + unique indexes + long draft). **FR-024–FR-026**. **Done when**: T007 green with URL set. **Proof**: `cd app/storyboard-web && node --test test/postgres/research-persistence.test.mjs` (URL required).

**Checkpoint**: Research API + store + migration usable without UI. Suggested Cursor range: **T004–T012**.

---

## Phase 3: User Story 1 — Capture notes and operations beside a live attempt (Priority: P1) 🎯 MVP

**Goal**: One fixed collapsible bottom-right dock with Notes + read-only Operations; durable Notes; Notes usable during product busy; same dock reparented into native `#detail` on `showModal()` without blocking critical controls.

**Independent Test**: Open app → send a note → see timestamped Notes history → start one existing product async action → Operations shows running then terminal while Notes remains sendable → open `#detail` and confirm the same `#research-dock` node remains accessible and does not cover Close/Next/panel controls → reload restores Notes via `GET /api/research/trace?kind=note`.

### Tests (must fail before UI wiring)

- [X] T013 [US1] Create `app/storyboard-web/test/research-dock.test.mjs` with failing seams for: single `#research-dock` host expectations; independent Notes draft/send; Notes history rendering from note events; `data-research-allow="notes-send"` exemption while `document.body.dataset.busy === "true"`; Commands/product buttons remain non-concurrent; Operations shows live busy then terminal failure/success without percentages; after reload, hydrated trace data containing an unmatched/unpaired `action_start` is treated by Operations as non-running historical interruption evidence (no replay/resume); reparent helper moves the **same** node into `#detail` on open and back on close (no second dock instance). Prefer extending patterns from `test/visual-page.test.mjs` / `draft-page-loader.mjs` where useful. **FR-001–FR-005, FR-012–FR-018, FR-032**. **Done when**: suite exists and fails before dock module/CSS/HTML wiring. **Proof**: `node --test test/research-dock.test.mjs`.

### Implementation

- [X] T014 [US1] Add single `#research-dock` markup (Commands/Notes/Operations regions + collapse handle) to `app/storyboard-web/public/index.html` as a sibling host outside `#detail` initially. **FR-001–FR-003**. **Done when**: ids/regions exist for the dock module. **Proof**: HTML contains one `#research-dock`.

- [X] T015 [US1] Style fixed bottom-right collapsible dock and narrow busy rule in `app/storyboard-web/public/app.css`: replace blanket `body[data-busy="true"] button { pointer-events: none; }` with an exemption for `[data-research-allow="notes-send"]`; keep critical `.dialog-actions` clear via max-height/offset. **FR-001, FR-002, FR-015**. **Done when**: CSS matches Plan busy/dock rules. **Proof**: stylesheet review + T013 busy cases later green.

- [X] T016 [US1] Implement `app/storyboard-web/public/research-dock.mjs` as the single state owner for Notes draft/history, Operations live+terminal projection, collapse (open-page only), and context snapshot helpers with fixed-key nulls; Notes send → `POST /api/research/notes`; hydrate Notes from `GET /api/research/trace?kind=note`; Operations projection combines the single current in-page live busy action with persisted terminal outcomes and never derives live running state from hydrated unmatched starts; no AI replies; research-save failure keeps draft text. **FR-004–FR-006, FR-012–FR-014, FR-016–FR-018, FR-033–FR-035**. **Done when**: module exports bind/render APIs used by `app.js`. **Proof**: unit seams in T013 progressing.

- [X] T017 [US1] Integrate dock in `app/storyboard-web/public/app.js`: mount `research-dock.mjs`; on `detail.showModal()` / `openDetail` reparent `#research-dock` into `#detail`; on close restore host; Notes send bypasses `runBusy`; emit minimal research `action_start`/`action_terminal` around at least one existing product busy path used for Operations demo (prefer Structure edit or frame/panel generate already behind `runBusy`); preserve local control notices. **FR-002, FR-015–FR-018, FR-020, FR-027**. **Done when**: T013 green for US1 behaviors. **Proof**: `node --test test/research-dock.test.mjs`.

- [X] T018 [US1] MVP checkpoint: with provider doubles / DI stores, prove Notes persist across reload (API+page) and Operations never treats unmatched starts as running after hydrate. Assertions live in `app/storyboard-web/test/research-dock.test.mjs`, `app/storyboard-web/test/research-api.test.mjs`, and `app/storyboard-web/test/postgres/research-persistence.test.mjs` (no new test file). **FR-024–FR-027, SC-001 (partial), SC-003 (Notes)**. **Done when**: those three files contain passing assertions covering note round-trip + non-running unmatched start. **Proof**: `cd app/storyboard-web && node --test test/research-dock.test.mjs test/research-api.test.mjs test/postgres/research-persistence.test.mjs` (PG file requires `STORYBOARD_TEST_DATABASE_URL` → `comics_test`).

**Checkpoint**: Visible dock + durable Notes + honest Operations busy/terminal. Suggested Cursor range: **T013–T018**.

---

## Phase 4: User Story 2 — Submit a supported command and keep Notes independent (Priority: P1)

**Goal**: Commands reuses only Structure edit and explicitly selected panel generation; sticky explicit target; independent drafts/sends/histories/event kinds from Notes.

**Independent Test**: Populate Notes draft+history → submit storyboard-wide Structure instruction via Commands → product edit occurs → trace has dock_commands start/terminal with `commandTarget.kind=storyboard` → Notes draft/history unchanged → ambient open panel does not silently retarget → unsupported empty context explains limitation without inventing scopes.

### Tests

- [ ] T019 [US2] Extend `app/storyboard-web/test/research-dock.test.mjs` with failing cases: Commands vs Notes independence; sticky storyboard target not silently changed by opening `#detail`; panel target only when explicitly selected; unsupported context messaging; Commands history projection from `surface=dock_commands` distinct from Notes. **FR-004–FR-011, SC-002**. **Done when**: new cases fail before Commands wiring. **Proof**: focused failing names. Not `[P]` with T013 (same file).

### Implementation

- [ ] T020 [US2] Implement Commands UI + sticky target mode in `app/storyboard-web/public/research-dock.mjs` and dispatch through existing `POST /api/visual/storyboard/edit` and `POST /api/visual/frames/:frameId/panels/:panelIndex/generate` from `app/storyboard-web/public/app.js` with research start/terminal (`surface=dock_commands`); label actual target including display vs structure ids; block Commands while product busy. **FR-007–FR-011, FR-015**. **Done when**: T019 green. **Proof**: `node --test test/research-dock.test.mjs`.

- [ ] T021 [US2] Confirm product Structure form (`#structure-edit-form`) in `app/storyboard-web/public/app.js` and dock Commands both record separable surfaces/event kinds without consuming each other’s drafts. Prove independence in `app/storyboard-web/test/research-dock.test.mjs` (full product-control capture matrix, including `structure_edit`, remains T022/T024). **FR-004, FR-005, FR-020**. **Done when**: `research-dock.test.mjs` asserts Structure-form vs Commands independence. **Proof**: `cd app/storyboard-web && node --test test/research-dock.test.mjs`.

**Checkpoint**: Supported Commands usable beside Notes. Suggested Cursor range: **T019–T021**.

---

## Phase 5: User Story 3 — Reconstruct the trace after reload/restart (Priority: P1)

**Goal**: Complete ordered capture matrix through existing controls + dock; navigation-stable correlation; machine-readable extraction after reload and application/DB restart.

**Independent Test**: Perform note → product/dock actions including placement `change` and a `cast_edit` → navigate during a long action → reload + restart Compose/app with same volume → `curl`/`fetch` `GET /api/research/trace` reconstructs intent → action → result → reaction with frozen contexts and durations.

### Tests

- [ ] T022 [US3] Create `app/storyboard-web/test/research-capture.test.mjs` with failing matrix coverage for instrumentation hooks: `reading` (full draft), `confirm_material`, `stage_storyboard`, `structure_edit`/`structure_undo`, `panel_generate`/`frame_generate`, `placement_commit` on zoom `change` only (not `input`), `identity_save` (comment only), `anchor_generate`/`anchor_approve`, `visual_approve`, `cast_edit` for `character_rename`/`alias_assignment`/`speaker_assignment` × `pending_reading`/`material_state` on successful `saveCast()` with value-only `editTarget` (no whole-cast dump); autosave/keystrokes/placement scrubbing produce **no** events. **FR-019–FR-021, FR-023**. **Done when**: suite fails before full `app.js` instrumentation. **Proof**: `node --test test/research-capture.test.mjs`.

- [ ] T023 [P] [US3] Extend `app/storyboard-web/test/research-api.test.mjs` and `app/storyboard-web/test/research-store.test.mjs` with end-to-end assertions for navigation between start and terminal (terminal cannot rewrite start context), duplicate correlation rejection, and unmatched start after restart remaining non-running evidence only. Record as baseline-green when Foundational store/API rules already satisfy a case; expect failure only for genuinely missing end-to-end behavior. **FR-022, FR-023, FR-027**. **Done when**: those assertions exist and either pass as baseline or fail only where behavior is still missing. **Proof**: `cd app/storyboard-web && node --test test/research-api.test.mjs test/research-store.test.mjs`.

### Implementation

- [ ] T024 [US3] Instrument capture boundaries in `app/storyboard-web/public/app.js` (and minimal helpers in `research-dock.mjs` if needed) for the T022 matrix, retaining start snapshots in the initiating closure for incomplete terminals; never record draft autosave pulses from `public/draft-autosave.mjs`. **FR-019–FR-021, FR-023**. **Done when**: T022 green. **Proof**: `node --test test/research-capture.test.mjs`.

- [ ] T025 [US3] Ensure `cast_edit` emits only after successful `saveCast()` in `app/storyboard-web/public/app.js` with `editTarget.castPhase` reflecting reading vs material routes (`PUT /api/readings/:id/cast` vs `POST /api/material-states`). **FR-019, FR-020**. **Done when**: cast cases in T022 green. **Proof**: capture test names for cast edits.

- [ ] T026 [US3] Harden postgres + API extraction path so `GET /api/research/trace` after simulated restart returns complete ordered events including raw permitted owner text, contexts, results, timestamps, durations, and no forbidden payloads; make T007/T012/T023 green in `app/storyboard-web/test/postgres/research-persistence.test.mjs`, `app/storyboard-web/test/research-api.test.mjs`, and `app/storyboard-web/test/research-store.test.mjs`. **FR-024–FR-026, SC-003, SC-004, SC-007**. **Done when**: persistence + correlation tests green. **Proof**: `cd app/storyboard-web && node --test test/postgres/research-persistence.test.mjs test/research-api.test.mjs test/research-store.test.mjs` (PG URL for postgres file).

**Checkpoint**: Full reconstructible local trace. Suggested Cursor range: **T022–T026**.

---

## Phase 6: User Story 4 — Honest failures without losing work (Priority: P1)

**Goal**: Protected-content rejection, research-save failures, incomplete evidence, and operation terminal failure / last-good semantics are honest and non-orchestrating.

**Independent Test**: Force provider-double operation failure (retained last-good not success); force note `protected-content` and store failure (draft retained, no row, no echo); force terminal evidence-write failure after product success; force incomplete terminal via `startSnapshot`.

### Tests

- [ ] T027 [US4] Extend `app/storyboard-web/test/redaction.test.mjs` and/or `research-api.test.mjs` with canaries proving research routes never persist/log/echo secrets from embedded `submittedText` or forbidden keys, and existing draft/visual redaction cases remain green. **FR-030, FR-031, SC-007**. **Done when**: new canaries fail until wiring complete, then pass; legacy redaction still passes. **Proof**: `node --test test/redaction.test.mjs test/research-api.test.mjs`.

- [ ] T028 [US4] Extend `app/storyboard-web/test/research-dock.test.mjs` / `research-api.test.mjs` / visual workflow doubles for: Notes research-save failure keeps textarea; product success + failed terminal research write does not claim research success; Operations/local UI show operation `failure` with `retainedLastGoodImage` when applicable; incomplete terminal (`evidenceIncomplete`, `durationMs: null`) does not resume/replay. **FR-018, FR-032–FR-035, SC-005, SC-006**. **Done when**: failing cases exist before final UI polish. **Proof**: focused test output.

### Implementation

- [ ] T029 [US4] Implement remaining honest failure UX and flags in `app/storyboard-web/public/research-dock.mjs`, `public/app.js`, and server/store paths so T027–T028 pass; no automatic retry/cancellation/resume. **FR-032–FR-035, SC-005, SC-006**. **Done when**: T027–T028 green. **Proof**: listed test commands.

**Checkpoint**: Failure honesty complete. Suggested Cursor range: **T027–T029**.

---

## Phase 7: Polish & cross-cutting verification

**Purpose**: Exact quickstart commands, real-browser top-layer check, regressions, clean tree.

- [ ] T030 Run focused offline research suites from `app/storyboard-web/`:

  ```bash
  node --test \
    test/research-text-policy.test.mjs \
    test/research-store.test.mjs \
    test/research-api.test.mjs \
    test/research-dock.test.mjs \
    test/research-capture.test.mjs \
    test/redaction.test.mjs \
    test/lifecycle.test.mjs \
    test/visual-workflow.test.mjs \
    test/storyboard-edit.test.mjs \
    test/draft-autosave.test.mjs
  ```

  Fix only in-scope regressions. **SC-001–SC-007, FR-036**. **Done when**: all green. **Proof**: terminal summary.

- [ ] T031 Run broader offline suite from `app/storyboard-web/`: `node --test test/**/*.test.mjs` (PG files skip if URL unset). **FR-036**. **Done when**: green or only expected PG skips. **Proof**: terminal summary.

- [ ] T032 With `STORYBOARD_TEST_DATABASE_URL` pointing at local Compose `comics_test` (same local role as `docker-compose.yml` `db` service; do not commit secrets), run from repo root: `node app/storyboard-web/test/postgres/verify.mjs` (fail-closed). **FR-024–FR-026**. **Done when**: exit 0. **Proof**: verifier exit code.

- [ ] T033 Real-browser acceptance against Compose loopback `:4173` using provider doubles / staged local state: continuous Happy Path steps 1–8 from `specs/009-research-workspace-dock/quickstart.md`; verify native `#detail.showModal()` top-layer accessibility of the **same** reparented `#research-dock` in `app/storyboard-web/public/index.html` / `app/storyboard-web/public/app.js` (DOM-only tests are insufficient alone); forced operation-failure and research-save-failure / protected-content checks; extract via `curl -sS http://127.0.0.1:4173/api/research/trace`. **SC-001–SC-007, FR-001–FR-002**. **Done when**: checklist observations recorded for HP1–8 + failures + extraction. **Proof**: browser notes + trace excerpt (no secrets).

- [ ] T034 Confirm protected diffs empty / in-scope only: `git diff -- prototypes/storyboard-viewer/frame-renderer.mjs docker-compose.yml` empty of feature creep; no new Compose volume; no live provider calls in deterministic suites; worktree clean after final commit. **FR-036–FR-038**. **Done when**: checks recorded. **Proof**: `git status --porcelain=v1` empty; diff commands.

**Checkpoint**: Feature ready for coordinator Analyze authorization. Suggested Cursor range: **T030–T034**.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: none
- **Phase 2 Foundational**: after Setup — **blocks** all user stories
- **US1 → US2 → US3 → US4**: technical dependency order (dock before Commands before full matrix before failure polish) even though all are P1
- **Polish**: after US1–US4 desired scope

### User Story Dependencies

- **US1**: after Foundational — MVP dock + Notes + Operations
- **US2**: after US1 dock shell/state owner exists (same `research-dock.mjs` / `app.js`)
- **US3**: after US1/US2 capture hooks exist; completes matrix + restart extraction
- **US4**: after research API/UI paths exist; hardens failure/redaction honesty

### Within Each Story

- Tests before matching implementation
- No story marks checkboxes during Tasks stage

### Parallel Opportunities

- T003 with T001/T002 after inventory starts
- T004 and T005 in parallel (different new test files) before their implementations
- T023 can proceed beside T022 (different primary files) once Foundational API/store exist
- Polish T030–T032 are sequential verification gates; T033 browser after green automated suites

### Practical implementation checkpoints (bounded Cursor ranges)

| Range | Outcome |
| --- | --- |
| T001–T003 | Baseline |
| T004–T012 | Research API/store/migration seam |
| T013–T018 | **MVP**: visible dock + durable Notes + Operations |
| T019–T021 | Supported Commands independence |
| T022–T026 | Full capture + restart extraction |
| T027–T029 | Failure honesty |
| T030–T034 | Quickstart verification |

---

## Parallel Example: Foundational tests

```bash
# Different files — after T001–T003:
Task: "T004 Create app/storyboard-web/test/research-text-policy.test.mjs …"
Task: "T005 Create app/storyboard-web/test/research-store.test.mjs …"
# Then implement T008/T010 only after their tests exist and fail.
```

## Parallel Example: User Story 3

```bash
Task: "T022 Create app/storyboard-web/test/research-capture.test.mjs …"
Task: "T023 Extend research-api/store correlation/navigation cases …"
```

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1 Setup
2. Phase 2 Foundational
3. Phase 3 US1 (T013–T018)
4. **STOP and VALIDATE** independent US1 test
5. Demo dock + Notes + Operations before Commands/matrix hardening

### Incremental Delivery

1. Setup + Foundational → research seam ready
2. US1 → MVP dock
3. US2 → Commands
4. US3 → reconstructible trace
5. US4 → failure honesty
6. Polish → quickstart/browser/PG gates


---

## Independent Test Criteria (summary)

| Story | Independent test |
| --- | --- |
| US1 | Note send + Operations running/terminal during busy + Notes still sendable + same dock accessible in `#detail.showModal()` + Notes restore after reload |
| US2 | Commands Structure edit with sticky storyboard target; Notes draft/history untouched; unsupported context honest; Commands history distinct |
| US3 | Full matrix including placement `change` + `cast_edit`; navigation-stable correlation; restart + `GET /api/research/trace` reconstructs sequence |
| US4 | Operation failure ≠ last-good success; note protected-content/store failure keeps draft; incomplete evidence; no auto-retry |

---

## Requirements ↔ Tasks Traceability

| Requirement / criterion | Tasks |
| --- | --- |
| FR-001 one fixed bottom-right dock | T013–T017, T033 |
| FR-002 collapsible; usable with `#detail`; no critical-control block | T013–T017, T015, T033 |
| FR-003 three areas; no duplicate docks | T013–T014, T017 |
| FR-004 independent Commands/Notes inputs/drafts/sends/histories/types | T013, T016, T019–T021 |
| FR-005 send one does not consume the other | T019–T021 |
| FR-006 unsent draft persistence not required | T016 |
| FR-007 reuse supported commands only | T019–T020 |
| FR-008 visibly identify context and actual command target | T019–T020 |
| FR-009 honest unsupported context | T019–T020 |
| FR-010 ambient selection does not silently retarget storyboard-wide commands | T019–T020 |
| FR-011 display vs structure frame identity | T005, T010, T019–T020 |
| FR-012 Notes diary; no AI replies | T013, T016 |
| FR-013 one send → one timestamped note | T013, T016 |
| FR-014 auto capture-time context; explicit nulls | T005, T016 |
| FR-015 Notes usable during async; no new product op | T013, T015–T017 |
| FR-016 read-only Operations running/terminal | T013, T016–T018 |
| FR-017 keep local control feedback | T017 |
| FR-018 no fake % / last-good≠success / no job system | T013, T018, T028–T029 |
| FR-019 ordered research trace contents | T005–T006, T010–T011, T022–T025 |
| FR-020 include existing product controls | T017, T021–T025 |
| FR-021 submitted text not keystrokes; placement change not input | T006, T022, T024 |
| FR-022 ordering + action/result association | T005, T009–T011, T023–T026 |
| FR-023 capture-time context; no later relabel | T005, T023–T024 |
| FR-024 survive reload/restart | T007, T012, T018, T026, T032–T033 |
| FR-025 Notes return; machine-readable trace | T012, T016, T026, T033 |
| FR-026 not memory-only | T007, T012, T032 |
| FR-027 evidence ≠ operation recovery | T018, T023, T028–T029 |
| FR-028 extraction without polished export / prescribed schema in spec | T006, T011, T026, T033 |
| FR-029 raw owner text on separate research path | T008, T010–T011 |
| FR-030 exclude credentials/URLs/provider/image bytes (keys + submittedText policy) | T004, T006, T008, T027 |
| FR-031 protect sanitized operational logs | T006, T011, T027 |
| FR-032 operation terminal failure honesty | T028–T029, T033 |
| FR-033 research-save failure not shown as saved | T016, T028–T029, T033 |
| FR-034 unsaved note text retained | T016, T028–T029 |
| FR-035 no automatic retry orchestration | T016, T028–T029 |
| FR-036 preserve fidelity/approvals/authority/geometry/providers/last-good | T001, T030–T034 |
| FR-037 DEC-053 protected direction only | T002–T003, T034 |
| FR-038 out-of-scope exclusions | T002–T003, T034 |
| FR-039 no invented quotas beyond approved reload/restart | T006, T009, T012 |
| SC-001 Happy Path 1–6 | T018, T020, T033 |
| SC-002 Commands vs Notes separability | T019–T021, T033 |
| SC-003 reload/restart Notes + trace | T012, T018, T026, T032–T033 |
| SC-004 reconstruct from trace | T026, T033 |
| SC-005 operation terminal failure + last-good | T028–T029, T033 |
| SC-006 research-save failure keeps note text | T016, T028–T029, T033 |
| SC-007 no secrets in research/logs | T004, T006, T008, T027, T033 |
| Forced operation-failure acceptance | T028–T029, T033 |
| Forced research-save-failure acceptance | T016, T028–T029, T033 |

---

## Notes

- All checkboxes remain `[ ]` until authorized Implement passes mark them.
- Provider calls for Tasks: **0**. Deterministic suites use doubles only.
- Do not add jobs, polling, percentages, dual-write, browser-only authority, new volumes, or product-JSON research storage.
- Coordinator Analyze requires separate owner authorization after this commit.
