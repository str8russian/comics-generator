---
description: "Implementation tasks for persistent source and cast confirmation"
---

# Tasks: Persistent Source and Cast Confirmation

**Input**: Design documents from `/specs/002-persistent-source-confirmation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Write each behavior test so it fails before the implementation task that makes it pass. Do not read the repository `.env.local`. Do not call the live provider. Do not modify `prototypes/storyboard-viewer/frame-renderer.mjs`, `app/storyboard-web/overflow.mjs`, `app/storyboard-web/fidelity.mjs`, `app/storyboard-web/prompts/stage.md`, or `app/storyboard-web/eval/stage-artistic/`.

**Organization**: Setup, shared persistence, User Story 1, User Story 2, User Story 3, the P1 checkpoint, User Story 4, then final verification. Stop at the P1 checkpoint for the MVP. Do not mark User Story 4 or final verification complete at that stop.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other `[P]` tasks in the same wave. It must not depend on an unfinished `[P]` sibling.
- **[Story]**: `[US1]`, `[US2]`, `[US3]`, or `[US4]` on user-story tasks only
- Setup, foundation, the P1 checkpoint, and final verification have no story label
- A phase checkpoint uses only that phase and earlier phases

## Path Conventions

- Application: `app/storyboard-web/`
- Page: `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, `app/storyboard-web/public/app.css`
- Offline tests: `app/storyboard-web/test/*.test.mjs`
- PostgreSQL tests: `app/storyboard-web/test/postgres/*.test.mjs`
- Authoritative database command: `node app/storyboard-web/test/postgres/verify.mjs`
- Contracts: `specs/002-persistent-source-confirmation/contracts/`
- Renderer stays `prototypes/storyboard-viewer/frame-renderer.mjs`

## Phase 1: Setup and container/database configuration

**Purpose**: Declare Node 24, PostgreSQL 16, and Compose without putting `.env.local` in an image.

### Tests

- [ ] T001 Write `app/storyboard-web/test/compose-config.test.mjs` before the Compose files exist. Assert `.gitignore` contains `.env.local`. Assert `.dockerignore` contains `.env.local`. Assert `Dockerfile` uses `node:24` and does not `COPY` `.env.local`. Assert `docker-compose.yml` uses `postgres:16`, gives `env_file` `path: .env.local` and `required: false` only to the app service, sets app `DATABASE_URL` to `postgres://comics:comics@db:5432/comics`, gives the database service no `env_file`, and creates database `comics_test` through `docker/postgres/init-test-db.sql`. Assert `package.json` has `"engines": { "node": ">=24" }` and dependency `pg`. The test reads those files only. It does not run Compose or read `.env.local`.

### Implementation

- [ ] T002 [P] Add `pg` and `"engines": { "node": ">=24" }` to `package.json`.
- [ ] T003 [P] Create `.dockerignore` containing `.env.local`.
- [ ] T004 [P] Create `Dockerfile` from `node:24-bookworm-slim` that does not copy `.env.local`.
- [ ] T005 [P] Create `docker-compose.yml` with `postgres:16`, a named volume, an app service whose optional `env_file` is `.env.local`, and `DATABASE_URL` set in the app `environment` block. Do not give the database service an `env_file`.
- [ ] T006 [P] Create `docker/postgres/init-test-db.sql` so the database cluster also has `comics_test`.

**Checkpoint**: `node --test app/storyboard-web/test/compose-config.test.mjs` passes. Compose has not been required to boot yet.

## Phase 2: Shared persistence and migration foundation

**Purpose**: One singleton project, insert-only artifact tables, a fail-closed PostgreSQL verifier, and a product server that does not expose `POST /api/storyboard`.

**Independent check**: `node --test app/storyboard-web/test/postgres-verify.test.mjs app/storyboard-web/test/product-server.test.mjs` passes with no database URL. Existing tracer tests still pass only because they set `enableLegacyStoryboardRoute: true`.

### Tests

- [ ] T007 [P] Write `app/storyboard-web/test/postgres-verify.test.mjs` before `app/storyboard-web/test/postgres/verify.mjs` exists. Spawn that script. Assert exit 1 when `STORYBOARD_TEST_DATABASE_URL` is absent. Assert exit 1 when the database name is `comics` or any name other than `comics_test`. Assert exit 1 when the child reports zero tests or a skipped test. Assert the URL is not printed. Do not read `.env.local`.
- [ ] T008 [P] Write `app/storyboard-web/test/product-server.test.mjs` before the legacy flag exists. With default `createServer` from `app/storyboard-web/server.mjs`, assert `POST /api/storyboard` is `404` and the response has no `Allow` header for that route. With `enableLegacyStoryboardRoute: true`, assert that path is no longer `404`. Do not call a provider.
- [ ] T009 [P] Write `app/storyboard-web/test/postgres/migration.test.mjs` before `app/storyboard-web/db/migrations/001_init.sql` exists. Skip only when `STORYBOARD_TEST_DATABASE_URL` is unset; `verify.mjs` will forbid that skip. When the URL names `comics_test`, assert one `project` row with `singleton` true, one `working_draft` row, and no second project row. Assert a failed migration logs `migration-failed` and does not leave a listening server. Do not open database `comics`.

### Implementation

- [ ] T010 [P] Implement `app/storyboard-web/test/postgres/verify.mjs` so a missing URL or a database name other than `comics_test` exits 1 immediately without printing the URL. Run `app/storyboard-web/test/postgres/*.test.mjs` with skipping disabled. Exit 1 when the run fails, when zero tests ran, or when any test was skipped.
- [ ] T011 [P] Add `app/storyboard-web/db/migrations/001_init.sql` for the singleton `project`, `working_draft` (`text` and UUID `revision_token`), `reading`, interpretation children, `source_revision` with nullable `parent_source_revision_id`, `material_state` with nullable `parent_material_state_id`, canonical cast tables, and `storyboard_result`. Seed one project and one empty draft. Do not add an update or delete for source revisions, interpretations, material states, or storyboard results.
- [ ] T012 [P] Implement `app/storyboard-web/db/pool.mjs` with the `pg` package. Do not read `.env.local` inside the module.
- [ ] T013 Implement `app/storyboard-web/db/migrate.mjs` to take a PostgreSQL advisory lock, apply each file in `app/storyboard-web/db/migrations/` in a transaction, and record it. On connection failure log `database-unavailable` and exit before listen. On migration failure log `migration-failed` plus the migration id only. Do not log `DATABASE_URL`, SQL text, or draft text.
- [ ] T014 Call `app/storyboard-web/db/migrate.mjs` from `app/storyboard-web/server.mjs` before `listen`. Add `enableLegacyStoryboardRoute` to `createServer` and `startServer`, default `false`. Register `POST /api/storyboard` only when that option is true. The module entrypoint must not set it.
- [ ] T015 Pass `enableLegacyStoryboardRoute: true` in `app/storyboard-web/test/http.test.mjs`, `app/storyboard-web/test/lifecycle.test.mjs`, `app/storyboard-web/test/storyboard-ready.test.mjs`, `app/storyboard-web/test/storyboard-blocked.test.mjs`, `app/storyboard-web/test/fidelity-account.test.mjs`, and `app/storyboard-web/test/static-assets.test.mjs`. Do not change those tests into the persistent flow.

**Checkpoint**: Foundation tests pass. User story work can begin. `POST /api/storyboard` is absent unless a test injects it.

## Phase 3: User Story 1 - Resume the saved draft (Priority: P1)

**Goal**: The working draft survives refresh and restart, autosave never has two requests in flight, and a stale token does not replace newer local text.

**Independent Test**: Paste a multi-line Russian dialogue, change one character, refresh, then stop and start the application. The edited draft is restored and no Source Revision exists. Typing during an in-flight save keeps the newest textarea text. A `409 stale-draft` leaves that text visible until the user explicitly reloads or replaces.

### Tests

- [ ] T016 [P] [US1] Write `app/storyboard-web/test/draft-autosave.test.mjs` before `app/storyboard-web/public/draft-autosave.mjs` exists. Drive the page textarea. While one save is in flight, type two further values and assert only the newest is sent after `200`, with the new token, and that no request sends an intermediate body. On `409` `{ "status": "failed", "kind": "stale-draft" }`, assert the textarea still shows the local text, no automatic `PUT` follows, and a conflict state is visible. Assert explicit reload replaces the textarea from `GET /api/project`, and explicit keep-local sends one `PUT` of the visible text with the token from that `GET` without copying the response draft into the textarea. Assert neither the `409` body nor logs contain either draft.
- [ ] T017 [P] [US1] Write `app/storyboard-web/test/postgres/draft.test.mjs` before draft methods exist in `app/storyboard-web/project-store.mjs`. Against `comics_test` only, assert a stale `revision_token` does not replace newer text. Assert Cyrillic, an emoji, and `е` plus U+0308 round-trip equal to the JavaScript string. Assert U+0000 and an unpaired surrogate return `400` `invalid-request` and are not stored. Assert saves insert no `source_revision`.
- [ ] T018 [P] [US1] Write `app/storyboard-web/test/redaction.test.mjs` using sentinel `УНИКАЛЬНАЯ-РЕПЛИКА-7781`. Assert `draft-save` logs and the `409` body omit that sentinel, `Bearer`, and `DATABASE_URL`. Do not read `.env.local`.

### Implementation

- [ ] T019 [P] [US1] Implement draft load and conditional save in `app/storyboard-web/project-store.mjs`. `UPDATE` `working_draft` only `WHERE revision_token` equals the supplied UUID, and replace `text` and `revision_token` together. Return `409` `stale-draft` with no draft text when zero rows change.
- [ ] T020 [P] [US1] Implement the one-in-flight autosave controller in `app/storyboard-web/public/draft-autosave.mjs` for the states in `specs/002-persistent-source-confirmation/plan.md`: dirty coalescing, no queued older body, conflict without textarea replacement, and the two explicit actions.
- [ ] T021 [US1] Add `GET /api/project` and `PUT /api/draft` to `app/storyboard-web/server.mjs` as specified in `specs/002-persistent-source-confirmation/contracts/project-api.md`. Log `draft-save` with the allowlisted fields only.
- [ ] T022 [US1] Wire the textarea in `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, and `app/storyboard-web/public/app.css` to `app/storyboard-web/public/draft-autosave.mjs`. Load the saved draft on open. Do not create a Source Revision from typing.

**Checkpoint**: User Story 1 is testable alone. Refresh and restart restore the draft. No Material review or staging is required yet.

## Phase 4: User Story 2 - Confirm characters, aliases, and speaker ownership (Priority: P1)

**Goal**: A reading of the exact draft produces Material review, the user can map `Дмитрий Сергеевич` to `Песков`, and confirmation atomically stores a Source Revision, Interpretation, and first material state.

**Independent Test**: Use a draft with an explicit speaker, the address `Дмитрий Сергеевич`, the name `Песков`, and one spoken line with no resolvable speaker. Map the address, leave the unresolved line, and confirm. The committed text matches the draft. The unresolved line remains a blocking finding. No storyboard is required.

### Tests

- [ ] T023 [P] [US2] Write `app/storyboard-web/test/interpret-material-schema.test.mjs` compiling `specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json` with `ajv/dist/2020.js` and `strict: true`. Require `sourceItems`, `characters`, and `surfaceForms`. Reject a missing array, a surface form without `quote`, an unknown property, and a numeric offset.
- [ ] T024 [P] [US2] Write `app/storyboard-web/test/interpret-prompt.test.mjs` for `app/storyboard-web/prompts/interpret.md`. The prompt must require `characters` and `surfaceForms`, keep utterance `speakerStatus` as `explicit`, `inferred`, or `unresolved`, and forbid numeric offsets.
- [ ] T025 [P] [US2] Write `app/storyboard-web/test/postgres/confirm.test.mjs` before confirmation exists in `app/storyboard-web/project-store.mjs`. Assert a text mismatch rolls back with no `source_revision`, `interpretation`, or `material_state`. Assert one success inserts exactly one of each and copies the pending cast. Assert mapping `Дмитрий Сергеевич` to `Песков` does not change revision text, and that every alias `surface_text` occurs in that text. Assert a later mapping-only correction inserts a new `material_state` with the same `source_revision_id` and `interpretation_id`, leaves the previous state unchanged, and inserts no new revision or interpretation. Assert an empty draft is `blocked` `empty-draft` and inserts nothing. Assert `speaker_status` `unresolved` can be confirmed and stays unassigned.
- [ ] T026 [P] [US2] Write `app/storyboard-web/test/configuration-resume.test.mjs` before the reading routes exist. With provider variables unset, assert `GET /api/project` and `PUT /api/draft` do not return `configuration`. Assert `POST /api/readings` returns `500` `{ "status": "failed", "kind": "configuration" }` and does not call `fetch`.

### Implementation

- [ ] T027 [P] [US2] Update `app/storyboard-web/prompts/interpret.md` so the model returns `sourceItems`, `characters`, and `surfaceForms` and no offsets. Do not change `app/storyboard-web/prompts/stage.md`.
- [ ] T028 [P] [US2] Add reading snapshot, pending cast, and confirmation transactions to `app/storyboard-web/project-store.mjs`. Confirmation locks the draft and inserts the revision, interpretation, and first material state in one transaction. `parent_source_revision_id` is null on the first revision. Pending cast edits before confirmation must not insert a `material_state`.
- [ ] T029 [US2] Point `app/storyboard-web/interpret.mjs` at `specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json`. Reject a `surfaceForms` `quote` that does not occur in the snapshot and a `characterId` that is not in `characters` as `invalid-output`. Update interpret fixtures in `app/storyboard-web/test/storyboard-ready.test.mjs` and `app/storyboard-web/test/storyboard-blocked.test.mjs` to include `characters` and `surfaceForms`. Keep `enableLegacyStoryboardRoute: true` in those files.
- [ ] T030 [US2] Add `POST /api/readings`, `PUT /api/readings/:id/cast`, and `POST /api/confirmations` to `app/storyboard-web/server.mjs`. Call Interpret only after the reading snapshot commits. Return `409` `stale-reading` when the draft text differs. Log `reading-start`, `reading-outcome`, and `confirm` without quotes or names.
- [ ] T031 [US2] Add Material review to `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, and `app/storyboard-web/public/app.css`. Show source items, characters, aliases, and only `unresolved-speaker` findings. Enable confirmation only when the textarea and stored draft equal the reading text. Do not ask a follow-up content question.

**Checkpoint**: User Stories 1 and 2 work. Confirmation does not stage a storyboard.

## Phase 5: User Story 3 - Stage only from confirmed material (Priority: P1)

**Goal**: Staging receives the active material state’s cast, blocks unresolved speakers before Stage, rebuilds dialogue from source offsets, and ties the result to the captured material state.

**Independent Test**: Start from a confirmed material state that maps `Дмитрий Сергеевич` to `Песков` and has one unresolved speaker. Staging is blocked and does not call Stage. Assign the speaker, stage again, and see the new result tied to the new material state, the same source text, and the spoken words still containing `Дмитрий Сергеевич`.

### Tests

- [ ] T032 [P] [US3] Write `app/storyboard-web/test/stage-cast.test.mjs` before `app/storyboard-web/stage.mjs` accepts `cast`. Assert a persistent call sends `cast.characters`, `cast.aliases`, and `cast.speakers`, including surface `Дмитрий Сергеевич` and character name `Песков`. Assert a call without `cast` still sends only `{ "sourceItems": [...] }`. Assert `app/storyboard-web/prompts/stage.md` is byte-identical to its current contents. Do not run `app/storyboard-web/eval/stage-artistic/`.
- [ ] T033 [P] [US3] Write `app/storyboard-web/test/postgres/storyboard-result.test.mjs` before result inserts exist. Assert an unassigned utterance inserts `blocked` `unresolved-speaker` on that `material_state_id` and does not call Stage. Assert a Stage result stores the id captured before the call, not a newer active id. Assert `GET` rebuilds `dialogue` from revision offsets and ignores a tampered stored dialogue string. Assert `readyEligible` is true only for a `checked` result of the active material state. Assert an imperfect panel description can still be `checked`. Assert seeded `lost-dialogue`, `duplicated-dialogue`, `reordered-dialogue`, and `changed-wording` still block through the existing checker.
- [ ] T034 [P] [US3] Extend `app/storyboard-web/test/redaction.test.mjs` so `storyboard-persist` logs and `502` or `504` bodies omit sentinel `УНИКАЛЬНАЯ-РЕПЛИКА-7781`, provider response text, and credentials.

### Implementation

- [ ] T035 [P] [US3] Add an optional `cast` argument to `requestStageCandidate` in `app/storyboard-web/stage.mjs`. Omit `cast` when the caller does not pass it. Do not edit `app/storyboard-web/prompts/stage.md` or the stage response schema.
- [ ] T036 [P] [US3] Insert `storyboard_result` rows from `app/storyboard-web/project-store.mjs` with `status` `checked`, `blocked`, or `failed` only. Never store `ready`. Do not update a previous material state’s rows.
- [ ] T037 [US3] Add `POST /api/storyboard-results` to `app/storyboard-web/server.mjs`. Capture `active_material_state_id` before Stage. Skip Stage when any utterance has no speaker assignment. Rebuild dialogue from the Source Revision on read. This is the only staging route when `enableLegacyStoryboardRoute` is false.
- [ ] T038 [US3] Show the storyboard from `app/storyboard-web/public/app.js` with the existing `app/storyboard-web/overflow.mjs` and `prototypes/storyboard-viewer/frame-renderer.mjs`. Label ready only after fit when `readyEligible` is true. Do not modify those two modules, `app/storyboard-web/fidelity.mjs`, or the artistic baseline.

**Checkpoint**: User Stories 1 through 3 work. An older storyboard stays visible and is not ready for a newer material state.

## Phase 6: P1 integration checkpoint

**Purpose**: Prove the MVP. Do not start Phase 7 or Phase 8 while stopping here.

**Independent check**: The behaviors listed in `specs/002-persistent-source-confirmation/quickstart.md` under “Manual P1 checkpoint” pass with a synthetic dialogue. User Story 4 remains unchecked.

- [ ] T039 [P] Run `node --test app/storyboard-web/test/**/*.test.mjs` from the repository root. PostgreSQL files may skip only because `STORYBOARD_TEST_DATABASE_URL` is unset. Do not pass `--env-file` and do not call the provider.
- [ ] T040 [P] Run `STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test node app/storyboard-web/test/postgres/verify.mjs` after `docker compose up -d db`. The command must fail if it skips tests. It must not open database `comics`.
- [ ] T041 Perform the Manual P1 checkpoint in `specs/002-persistent-source-confirmation/quickstart.md` with a synthetic dialogue: `docker compose up`, one project, draft resume across refresh and app restart, coalesced autosave, visible `stale-draft` conflict, Material review, `Дмитрий Сергеевич` → `Песков`, atomic confirmation, a mapping-only new material state, `unresolved-speaker` without Stage, Stage receiving `cast`, dialogue rebuilt from offsets, the result tied to the captured material state, and resume of the eligible storyboard. Do not check Phase 7 or Phase 8.

**Checkpoint**: MVP is ready to demonstrate. Source Revision history and activation are not implemented yet.

## Phase 7: User Story 4 - Keep the previous source recoverable (Priority: P2)

**Goal**: A confirmed text edit creates a new Source Revision. Viewing an older revision does not change the working draft. Replacing an uncommitted draft requires the warning and explicit confirmation, and still inserts no Source Revision.

**Independent Test**: Confirm a draft, change one punctuation mark, confirm the new reading, and view the previous text unchanged. With a different unsaved edit, cancel activation and see the edit unchanged. Confirm the warning and see the selected revision’s text loaded without a new Source Revision.

### Tests

- [ ] T042 [P] [US4] Write `app/storyboard-web/test/postgres/activation.test.mjs` before activation writes exist. Assert a punctuation-only confirmation inserts one new `source_revision` whose `parent_source_revision_id` is the previous id, and the previous `text` is unchanged. Assert `GET` of the earlier revision does not change the active revision or working draft. Assert `confirmDiscard` false writes nothing and does not insert a revision. Assert `confirmDiscard` true sets the draft to the selected revision text, moves the active pointers to that revision’s current material state, and inserts no `source_revision`. Assert a draft that already matches the active revision activates without the warning.
- [ ] T043 [P] [US4] Write `app/storyboard-web/test/activation-ui.test.mjs` before the history UI exists. Assert the warning string is `Несохранённый черновик будет заменён и не является сохраняемой редакцией.` Assert cancel leaves the textarea unchanged. Assert the warning body does not contain the draft.

### Implementation

- [ ] T044 [US4] Add revision listing, revision read, and activation to `app/storyboard-web/project-store.mjs`. Activation must not insert a `source_revision`. The current material state of a revision is the latest row by `created_at`, then `id`.
- [ ] T045 [US4] Add `GET /api/source-revisions/:id` and `POST /api/activations` to `app/storyboard-web/server.mjs`. Return `409` `uncommitted-draft` with only the fixed warning when the draft differs and `confirmDiscard` is not true.
- [ ] T046 [US4] Add revision viewing and the activation warning to `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, and `app/storyboard-web/public/app.css`. Do not add a material-state browser.

**Checkpoint**: User Story 4 is complete. Earlier stories still pass.

## Phase 8: Final verification and documentation

**Purpose**: Run the full verification set after every story. These tasks stay unchecked at the P1 stop.

- [ ] T047 [P] Run `node --test app/storyboard-web/test/**/*.test.mjs` from the repository root with no `--env-file` and no live provider.
- [ ] T048 [P] Run `npm run check` from `package.json`.
- [ ] T049 [P] Run `npm run mutations` from `package.json`.
- [ ] T050 Run `STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test node app/storyboard-web/test/postgres/verify.mjs` against `comics_test` only.
- [ ] T051 Restart with `docker compose up` as written in `specs/002-persistent-source-confirmation/quickstart.md`, including a restart that keeps the named volume and a boot when `.env.local` is absent. Do not use `docker compose down -v`.
- [ ] T052 Repeat the Manual P1 checkpoint in `specs/002-persistent-source-confirmation/quickstart.md` with a synthetic dialogue after User Story 4.
- [ ] T053 Perform the P2 revision and activation check in `specs/002-persistent-source-confirmation/quickstart.md`: punctuation confirmation, previous-text view, cancel, and confirmed activation.
- [ ] T054 Confirm no live provider request by inspecting `package.json` and `app/storyboard-web/test/`. The default test command and `verify.mjs` must not reference `.env.local` or a live smoke script.
- [ ] T055 Align commands in `specs/002-persistent-source-confirmation/quickstart.md` with the commands that actually ran. Do not add a live smoke.
- [ ] T056 Confirm `git status` shows no staged `.env.local`, database volume data, credentials, or `app/storyboard-web/eval/stage-artistic/results/`.

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundation (Phase 2)**: Depends on Phase 1. Blocks every user story.
- **User Story 1 (Phase 3)**: Depends on Phase 2. No dependency on Stories 2, 3, or 4.
- **User Story 2 (Phase 4)**: Depends on Phase 2 and User Story 1’s saved draft.
- **User Story 3 (Phase 5)**: Depends on User Story 2’s confirmed material state.
- **P1 checkpoint (Phase 6)**: Depends on Stories 1 through 3. **MVP stop.** Phase 7 and Phase 8 stay unchecked.
- **User Story 4 (Phase 7)**: Depends on the P1 checkpoint. It is not required to demonstrate the MVP.
- **Final verification (Phase 8)**: Depends on User Story 4. It is not complete at the MVP stop.

### Within each story

- Tests in a story are one parallel wave and come before that story’s implementation.
- Store methods come before the routes that call them.
- Routes come before the page that calls them.
- A task marked `[P]` in a wave does not edit a file edited by another `[P]` task in that same wave.

### Parallel waves

1. T001, then T002–T006 together.
2. T007–T009 together, then T010–T012 together, then T013, then T014, then T015.
3. T016–T018 together, then T019–T020 together, then T021, then T022.
4. T023–T026 together, then T027 and T028 together, then T029, then T030, then T031.
5. T032–T034 together, then T035 and T036 together, then T037, then T038.
6. T039 and T040 together, then T041. Stop for the MVP.
7. T042 and T043 together, then T044, then T045, then T046.
8. T047–T049 together, then T050, then T051, then T052, then T053, then T054, then T055, then T056.

### Parallel example: User Story 1

```bash
# Tests together, before implementation:
# T016 app/storyboard-web/test/draft-autosave.test.mjs
# T017 app/storyboard-web/test/postgres/draft.test.mjs
# T018 app/storyboard-web/test/redaction.test.mjs

# Then different files together:
# T019 app/storyboard-web/project-store.mjs
# T020 app/storyboard-web/public/draft-autosave.mjs
```

## Implementation strategy

### MVP first

1. Complete Phase 1 and Phase 2.
2. Complete User Story 1, User Story 2, and User Story 3.
3. Complete Phase 6 and stop.
4. Demonstrate the P1 checkpoint. Leave T042–T056 unchecked.

### After the MVP

1. Complete User Story 4.
2. Complete Phase 8.
3. Do not treat the Phase 6 stop as final verification.

## Acceptance coverage

- US1 scenarios 1–4: T016, T017, T021, T022, T041.
- US2 scenarios 1–5: T023, T025, T030, T031.
- US3 scenarios 1–5: T032, T033, T035, T037, T038.
- US4 scenarios 1–5 and 8: T042, T043, T044, T045, T046.
- US4 scenarios 6–7 are the mapping correction and restage already required by US2 and US3: T025, T033.
- Empty draft, stale reading, and failed reading: T025, T030.
- Activation cancel and confirmed replacement: T042, T043.
- Unicode and rejected NUL: T017.
- Legacy route hidden by default: T008, T014, T015.
- Compose env and image exclusion: T001, T003, T004, T005, T051.
- Fail-closed PostgreSQL command: T007, T010, T040, T050.

## Notes

- `[P]` tasks in one wave touch different files.
- Story labels appear only on T016–T038 and T042–T046.
- PostgreSQL tests stay under `app/storyboard-web/test/postgres/` and are not a substitute for `verify.mjs`.
- Commit after each task or logical group.
- Stop after T041 to validate the MVP without User Story 4.
