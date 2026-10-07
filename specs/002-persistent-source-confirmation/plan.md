# Implementation Plan: Persistent Source and Cast Confirmation

**Branch**: `002-persistent-source-confirmation` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-persistent-source-confirmation/spec.md`

## Summary

The storyboard page gains one durable local project. The user pastes a Russian dialogue, reviews the reading, confirms an immutable Source Revision and material state, and only then stages. PostgreSQL stores the project outside the Node process. Docker Compose starts the database and the application, applies migrations, and keeps the files in a named volume. The user does not operate the database.

The existing Interpret and Stage engine stays in `app/storyboard-web/`. Interpret’s response contract grows by provisional characters and surface forms. Stage’s artistic prompt stays byte-identical. The persistent path adds the confirmed cast to the Stage user message. Dialogue on screen is still rebuilt from source offsets. `FrameRenderer`, overflow, and the artistic-eval files are unchanged.

## Technical Context

**Language/Version**: Node.js 24, ESM. Image `node:24-bookworm-slim`. `package.json` gains `"engines": { "node": ">=24" }`.

**Primary Dependencies**: Existing `node:http`, `node:test`, and `ajv`. New runtime dependency: `pg`. No ORM.

**Storage**: PostgreSQL 16. One singleton project. SQL migration `app/storyboard-web/db/migrations/001_init.sql` applied at startup. Named volume `storyboard-pg`.

**Testing**: `node:test`. Default command has no network, no `.env.local`, and skips PostgreSQL when `STORYBOARD_TEST_DATABASE_URL` is unset. A separate command runs PostgreSQL tests against `comics_test`.

**Target Platform**: Local Docker Compose web application. A developer may also run the Node process against `DATABASE_URL`, but the documented startup is Compose.

**Project Type**: Extension of the production web application in `app/storyboard-web/`.

**Performance Goals**: One local user. Draft autosave is debounced in the page to one save about 400 ms after typing pauses. No concurrent-user target.

**Constraints**: Server-side model calls only. One Interpret call per reading and one Stage call per staging, neither chunked and neither repaired. No accounts, private links, frame editing, image generation, or Stage prompt optimization. Logs and failure responses omit draft text, provider bodies, credentials, and database secrets. The resume document may return the user’s own draft.

**Scale/Scope**: One project, one page, the P1 confirmation path first, then P2 revision history and activation in the same feature. Two-panel layouts only, as in the tracer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled scaffold from SpecKit initialization. It adopts no project principles. There is no gate to pass and no violation to justify.

Post-design re-check: still no adopted principle. The design stays inside the feature spec. PostgreSQL and Compose are the accepted local-first means from the specification, not an extra product surface. The Stage prompt, `FrameRenderer`, overflow, provider adapter, and artistic baseline files are unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/002-persistent-source-confirmation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── project-api.md
│   ├── interpret-response.schema.json
│   └── stage-input.md
├── spec.md
├── checklists/requirements.md
└── tasks.md                 # not created by this plan
```

### Source Code (repository root)

```text
docker-compose.yml           # postgres:16 and the Node 24 app; named volume
Dockerfile                   # node:24-bookworm-slim; no .env.local copied in
app/storyboard-web/
├── server.mjs               # existing HTTP server plus project routes
├── provider.mjs             # unchanged chat-completions adapter
├── interpret.mjs            # extended response schema for the reading path
├── stage.mjs                # optional cast argument; omitted means today’s user message
├── fidelity.mjs             # unchanged source checks
├── overflow.mjs             # unchanged compiler
├── segment.mjs              # unchanged
├── db/
│   ├── migrations/001_init.sql
│   ├── migrate.mjs          # advisory lock, then each file in a transaction
│   └── pool.mjs
├── project-store.mjs        # draft token, confirm, cast copy, activation, results
├── prompts/interpret.md     # extended to require characters and surfaceForms
├── prompts/stage.md         # byte-identical
└── public/                  # same page, Material review added
prototypes/storyboard-viewer/
└── frame-renderer.mjs       # not modified
```

Historical `prompts/`, `tools/`, `schema/`, `evals/`, and `spikes/` stay outside the application. `eval/stage-artistic/` is not modified and is not run.

**Structure Decision**: Persistence extends `app/storyboard-web/` rather than a second application. Compose files live at the repository root so `docker compose up` is the local entry. The tracer’s one-shot route remains in `server.mjs` for existing tests and is not the page’s path.

## Architecture and data flow

1. Compose starts PostgreSQL, then the application. The application migrates and seeds one project with an empty working draft and a revision token. It listens only after that commit.
2. The page loads `GET /api/project` and fills the textarea with `draft.text`.
3. Edits debounce to `PUT /api/draft` with the last revision token. The save is one conditional update. A lost race returns `409` `stale-draft` and the page reloads the stored draft instead of writing the older text.
4. `POST /api/readings` copies the current draft into a reading row, then calls Interpret. The extended object becomes source items, provisional characters, and surface forms. The server anchors quotes and builds a pending cast. Material review shows that cast and unresolved-speaker findings only.
5. Alias and speaker edits before confirmation call `PUT /api/readings/:id/cast`. They do not insert a material state. `Дмитрий Сергеевич` → `Песков` is one of those edits. The draft text is not changed.
6. The page enables confirmation only when the textarea and the stored draft both equal the reading’s snapshotted text. A newer autosave token with the same characters does not by itself make the reading stale. `POST /api/confirmations` commits one transaction: Source Revision, Interpretation, and the first material state. A different text rolls back.
7. A later cast correction calls `POST /api/material-states` and inserts a new material state for the same revision and interpretation. The previous state remains.
8. `POST /api/storyboard-results` stages the active material state. Unassigned speakers block before Stage. Otherwise the Stage user message includes `cast`, and the response schema is the tracer schema. The result row stores the captured material-state id.
9. The page runs the existing overflow compiler and `FrameRenderer`. It labels the storyboard ready only when the checked result belongs to the active material state and fidelity still passes.
10. Refresh and process restart call `GET /api/project` again. The draft and active material state come from PostgreSQL.

P2 adds viewing `GET /api/source-revisions/:id` and `POST /api/activations`. Activation does not insert a revision. A different unsaved draft requires the warning and `confirmDiscard: true`.

The provider adapter, Stage prompt bytes, frame geometry, and overflow splits are the tracer’s. This plan does not retune them.

## Integrity boundaries

| Boundary | Where it is enforced |
|---|---|
| Draft survives refresh and restart character for character | `working_draft.text` in PostgreSQL; `GET /api/project` returns that string; UTF-16 round-trip tests |
| Autosave does not overwrite a newer draft | `UPDATE ... WHERE revision_token = $expected`; `409` `stale-draft` writes nothing |
| A reading is tied to the exact draft it read | `reading.draft_text` snapshot; confirm compares it to the locked working draft |
| Confirmation creates revision, interpretation, and first material state together | one transaction in `POST /api/confirmations`; rollback inserts none |
| Cast correction creates a new material state, not a new source | `POST /api/material-states` inserts a child state with the same revision and interpretation ids |
| Activation cannot drop an unsaved draft silently | `409` `uncommitted-draft` unless `confirmDiscard` is true; cancel writes nothing |
| Every storyboard result names the material state supplied to Stage | `storyboard_result.material_state_id` captured before the provider call |
| An older storyboard is not ready for the current state | `readyEligible` is true only for the active material state; the page refuses the label otherwise |
| Dialogue comes from source references | read path re-derives dialogue from revision offsets; alias text is not substituted |
| Logs and diagnostic HTTP omit secrets and draft text | allowlisted log fields; failure bodies carry `kind` and codes; the activation conflict adds only the fixed warning sentence; `GET /api/project` is the resume exception |

## Transaction boundaries

| Operation | Transaction | Provider call |
|---|---|---|
| Draft save | single conditional `UPDATE` | no |
| Start reading | short transaction inserts the snapshot, then commits | Interpret runs after commit |
| Store reading result | short transaction writes children only if the draft text is unchanged | no |
| Pending cast edit | one transaction; abort if the draft changed | no |
| Confirmation | one transaction: revision, interpretation, items, material state, cast, pointers | no |
| Cast correction | one transaction: new material state, copied cast, move active pointer | no |
| Activation cancel | no write | no |
| Activation confirm | one transaction replaces draft text, rotates token, moves pointers; no revision insert | no |
| Unresolved speaker | one insert of a blocked result on the captured state | Stage is not called |
| Stage result | snapshot state id, call Stage, then insert the result on that id | one Stage call outside the lock |

A database error maps to `503` `database` or, at startup, to a process exit. Migration failure exits before listen.

## Browser and API flow

The page remains `app/storyboard-web/public/index.html` and its module script. Phase 1 shows the draft, reading status, characters, aliases, speaker findings, confirm, and stage. Phase 2 adds the revision list and the activation warning. Frame grid and detail stay on `FrameRenderer`.

Normative routes are [contracts/project-api.md](./contracts/project-api.md). The page sequence for P1 is: load project → autosave draft → request reading → edit pending cast → confirm → stage or see `unresolved-speaker` → fit → ready or blocked. Restart repeats the load and does not repeat Interpret or Stage when a result is already stored.

## Interpret and Stage contracts

`interpret.mjs` validates the extended schema for every Interpret call, including the existing one-shot route, because both paths read `prompts/interpret.md`. That prompt is updated to require `sourceItems`, `characters`, and `surfaceForms` and to forbid offsets. The schema is [contracts/interpret-response.schema.json](./contracts/interpret-response.schema.json). Speaker status on each utterance stays the tracer’s enum. The server still computes offsets and spoken text. One-shot fixtures gain the two arrays and still do not write the database.

Stage response validation stays on `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json`. The persistent user message adds `cast` as in [contracts/stage-input.md](./contracts/stage-input.md). That addition is input plumbing. `prompts/stage.md` is not edited, and the saved artistic baseline is not re-run. When `cast` is omitted, the user message shape is unchanged so the one-shot tests and the artistic runner keep their current payload.

## Persistence and concurrency

The revision token stops a slower autosave from replacing a newer draft. Confirmation does not trust the browser’s draft body; it locks the stored draft and compares it to the reading snapshot. Identical text with a newer token may still confirm. Different text cannot.

Immutable tables are insert-only, as listed in [data-model.md](./data-model.md). Active revision and active material state are pointers on the singleton project. The current material state of a historical revision is the latest row for that revision. The page does not browse material states.

`GET /api/project` after restart returns the same draft characters. Storyboard dialogue is derived again from the Source Revision, so a stored copy of the words cannot drift.

## Test strategy

Offline tests cover schema, the unchanged Stage prompt bytes, cast omitted versus cast included, log redaction, fidelity, overflow, and the renderer. They skip PostgreSQL when the test URL is absent.

PostgreSQL tests use `comics_test` and the URL exported by the quickstart command. They cover lost autosave, confirmation rollback, cast copy, activation cancel, exact Unicode round trip, and dialogue rebuilt from offsets. They do not open `.env.local` or the live provider.

Details and commands are in [quickstart.md](./quickstart.md). Decisions are in [research.md](./research.md).

## Implementation phases

### Phase 1, the P1 checkpoint

Demonstrable without revision history UI:

- Compose startup, migration, and the singleton project.
- Draft autosave, revision token, refresh, and application restart.
- Material review from one reading, including the Peskov alias edit.
- Atomic confirmation of Source Revision, Interpretation, and first material state.
- Cast or speaker correction as a new material state.
- `unresolved-speaker` blocks Stage.
- Staging from the confirmed cast, with dialogue rebuilt from the source.
- Resume of that material state and its storyboard eligibility.

### Phase 2, still this feature

- Source Revision list and exact view.
- New revision when edited text is confirmed, parent linked, previous text kept.
- Activation warning, cancel, and explicit replacement of the working draft.

The first migration includes parent columns and storyboard association so phase 2 does not alter immutable rows.

## Complexity Tracking

No constitution violations.

## Consistency check

Checked against `spec.md` at `4e01a21b353b301e442b887b9503efcae9059e27` after the design artifacts were written.

- FR-001 through FR-003 and SC-001, SC-006: one project, draft save, no revision before confirm, token prevents a silent overwrite.
- FR-004 through FR-008 and SC-009: extended Interpret contract, Material review, pending cast, only unresolved speaker is a blocking finding.
- FR-009 and the confirmation transaction: revision, interpretation, and first material state commit together or not at all. Stale text cannot confirm.
- FR-010, FR-015, SC-004, and SC-011: cast and speaker changes insert a material state and leave the revision and interpretation counts unchanged.
- FR-011, FR-012, and SC-005, SC-010: phase 2 text confirmation and activation. Cancel writes nothing. The warning string is fixed in the API contract.
- FR-013, FR-014, FR-016, and SC-003, SC-007: Stage receives `cast`; dialogue and fidelity stay on source references; the stage response schema is unchanged.
- FR-017 and SC-008: no artistic gate and no prompt edit. An imperfect checked storyboard can be ready after fit.
- FR-018: `readyEligible` follows the active material state. Older results remain visible.
- FR-019: empty draft and failed readings leave the draft and insert no revision.
- Out of scope: no frame editing, accounts, deployment, material-state browser, non-blocking preflight, or repair loop.

No unresolved `NEEDS CLARIFICATION` remains in this plan.

## Risks and assumptions

- The local Compose password is a development default inside `docker-compose.yml`. It is not a production secret. Tests still must not print `DATABASE_URL`.
- Anyone who can open the published local port can read the one project. Private links are a later feature.
- `docker compose down -v` deletes the volume. Ordinary restart does not.
- Interpret quality for aliases is still a model result. The user can correct a missed or wrong surface before confirmation. This plan does not add a second model call when the first reading is schema-valid.
- Rebuilding dialogue on read assumes stored offsets still match the revision text. Confirmation writes both in one transaction, and those rows are not updated afterward.
- The one-shot `POST /api/storyboard` can still stage without a material state. The product page must not call it. Leaving it avoids rewriting the tracer suite.
- `reasoning_effort` stays configuration, as in the tracer. This feature does not test whether the provider applies it.
- The external product input limit stays open. 262144 bytes remains the local body ceiling.
