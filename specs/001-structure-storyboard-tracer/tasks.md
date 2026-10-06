---
description: "Implementation tasks for the read-only Structure storyboard tracer"
---

# Tasks: Read-only Structure Storyboard Tracer

**Input**: Design documents from `/specs/001-structure-storyboard-tracer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The feature plan and this task request require the offline suite. Write each test task so it fails before its implementation task. Do not call the live provider.

**Organization**: Setup, shared foundation, User Story 1, User Story 2, then final verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]` or `[US2]` on user-story tasks only
- Setup, foundation, and final verification have no story label

## Path Conventions

- Application: `app/storyboard-web/`
- Canonical renderer: `prototypes/storyboard-viewer/frame-renderer.mjs`
- Existing prototype: `prototypes/storyboard-viewer/image-storyboard.html`, `viewer.js`, `viewer.css`, `storyboard-data.js`
- Tests: `app/storyboard-web/test/*.test.mjs` via `node --test`
- No new package. `package.json` already has `"type": "module"` and `ajv`.

## Phase 1: Setup

**Purpose**: Add the stable application directories and the two version-controlled prompts. Do not add a dependency, a database, or a live script.

- [ ] T001 [P] Write `app/storyboard-web/prompts/interpret.md` so Interpret returns ordered source items with `segmentIds` and `sourceQuote` and no numeric offsets. The prompt must not read or copy `prompts/01-writer.md`, `prompts/02-editor.md`, `prompts/03-director.md`, or `prompts/04-reviewer.md`.
- [ ] T002 [P] Write `app/storyboard-web/prompts/stage.md` so Stage returns one `json_object` frame list, `placement` for derived beats, and `review` ids for context and notes. Directing `segments[].quote` values are non-authoritative partitions of spoken text. The prompt must not send fit offsets or reuse the historical role prompts.

---

## Phase 2: Foundational

**Purpose**: Shared modules that both stories need. No user story starts until this phase is complete.

**Independent check**: `node --test app/storyboard-web/test/schema.test.mjs app/storyboard-web/test/provider.test.mjs app/storyboard-web/test/http.test.mjs app/storyboard-web/test/segment.test.mjs app/storyboard-web/test/renderer-structure.test.mjs` passes, and `prototypes/storyboard-viewer/image-storyboard.html` still loads the prototype through `window.FrameRenderer`.

### Tests

- [ ] T003 [P] Write failing schema tests in `app/storyboard-web/test/schema.test.mjs` that compile `specs/001-structure-storyboard-tracer/contracts/interpret-response.schema.json` and `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json` with `ajv/dist/2020.js` and `strict: true`. Cover `explicit`, `inferred`, and `unresolved` utterances; `action`, `context`, and `note` only with `speakerStatus` `none` and no `speakerLabel`; required `sourceQuote`; rejection of a whitespace-only quote, `utteranceQuote`, and numeric offsets; one panel for `single` and two for `split2`; `speakerPanel` only on an utterance; derived `placement` with at least one of `afterSourceItemId` or `beforeSourceItemId`; segments only when `directingBeat` is true.
- [ ] T004 [P] Write failing provider tests in `app/storyboard-web/test/provider.test.mjs` using a fake `fetch`. Assert `POST /v1/chat/completions`, `response_format.type` `json_object`, Interpret `model` from `INTERPRET_MODEL` or else `CONTEST_MODEL` with `reasoning_effort` `low`, and Stage `model` from `STAGE_MODEL` or else `CONTEST_MODEL` with `reasoning_effort` `medium`. Assert `max_completion_tokens` only when that function's limit is set, never `max_tokens`, and that `CONTEST_REQUEST_JSON` is not read. Map timeout to `504` `timeout`, thrown `fetch` and non-2xx to `502` `provider`, and missing `finish_reason`, `length`, any other non-`stop` reason, non-object JSON, and Ajv failure to `502` `invalid-output`. Assert no continuation and no Stage call after an Interpret failure. Assert the system text is the contents of `app/storyboard-web/prompts/interpret.md` and `app/storyboard-web/prompts/stage.md`.
- [ ] T005 [P] Write failing HTTP tests in `app/storyboard-web/test/http.test.mjs` for the allowlist in `specs/001-structure-storyboard-tracer/contracts/storyboard-api.md`: `GET /`, `/app.js`, `/app.css`, `/overflow.mjs`, `/frame-renderer.mjs`, and `/viewer.css`. Assert every other path is 404, the wrong method is 405 with `Allow`, a non-JSON content type is 415, malformed JSON is 400 `invalid-request`, and a body above `STORYBOARD_MAX_BODY_BYTES` 262144 is 413. Assert 405, 413, and 415 have no storyboard JSON body.
- [ ] T006 [P] Write failing segment tests in `app/storyboard-web/test/segment.test.mjs`. A separator is `\r\n`, otherwise `\n`, otherwise `\r`. Empty runs are kept. Joining segments and separators equals `draft.text`. Include `Аня: да\r\n\n \nБорис: нет`.
- [ ] T007 [P] Write failing renderer-structure tests in `app/storyboard-web/test/renderer-structure.test.mjs`. Import `prototypes/storyboard-viewer/frame-renderer.mjs`. A DOM stub may assert two descriptions and dialogue in the speaker cell, and no `.dialogue-bar` when dialogue is empty. The stub must not be asked whether text fits, and the test must not call `measureDialogue`. A source assertion reads `prototypes/storyboard-viewer/viewer.css` for `Arial, Helvetica, sans-serif`, `border-box`, `border-top: 2px solid #536064`, weight 500, `letter-spacing: .1px`, `line-height: 1.18`, and `overflow-wrap: anywhere`.

### Implementation

- [ ] T008 [P] Implement `app/storyboard-web/config.mjs` with `BASE_URL`, `CONTEST_API_TOKEN`, `CONTEST_TIMEOUT_MS` default 120000, `INTERPRET_MODEL` falling back to `CONTEST_MODEL`, `INTERPRET_REASONING_EFFORT` default `low`, `STAGE_MODEL` falling back to `CONTEST_MODEL`, `STAGE_REASONING_EFFORT` default `medium`, optional per-function `max_completion_tokens`, and optional `INTERPRET_REQUEST_JSON` and `STAGE_REQUEST_JSON`. Drop `model`, `messages`, `response_format`, `reasoning_effort`, `max_completion_tokens`, and `max_tokens` from those extra objects. Do not read `CONTEST_REQUEST_JSON`. Missing required config is `failed` / `configuration`.
- [ ] T009 [P] Implement lossless segmentation in `app/storyboard-web/segment.mjs` using the separator rule and id form `seg-0`, `seg-1` from `specs/001-structure-storyboard-tracer/data-model.md`. `draft.text.slice(draftStart, draftEnd) === text`. The model receives `{ id, text }` including empty text.
- [ ] T010 [P] Move the body of `prototypes/storyboard-viewer/frame-renderer.js` into `prototypes/storyboard-viewer/frame-renderer.mjs`. Export one constant block (width 1920, height 1080, dialogue-bar height 300, gutter 48, split padding `34px 44px 24px`, single padding `38px 70px 26px`), `FONT_LADDER` `single: [58, 51, 46, 42]` and `split2: [44, 38, 34, 31]`, `fontSizeFor`, and `render`. `fontSizeFor` remains the length-to-size map and is not a fit test. `render` uses `frame.fontSize` only when it is in the ladder; otherwise it uses `fontSizeFor`. Assign `window.FrameRenderer` in the browser. Do not copy geometry into `app/storyboard-web/`.
- [ ] T011 Implement `app/storyboard-web/provider.mjs` so each function sends one `json_object` completion through `config.mjs`, classifies `finish_reason` as in `specs/001-structure-storyboard-tracer/contracts/storyboard-api.md`, and does not retry, continue, or repair.
- [ ] T012 Add `measureDialogue(document, frame, fontSize)` to `prototypes/storyboard-viewer/frame-renderer.mjs`. Await `document.fonts.ready` when present, render at scale 1 off-screen, constrain the speaker-cell text node to the laid-out content box, and treat `scrollHeight > clientHeight` or `scrollWidth > clientWidth` as overflow. Do not put those pixels in `app/storyboard-web/overflow.mjs`.
- [ ] T013 Preserve the prototype: in `prototypes/storyboard-viewer/image-storyboard.html`, remove the classic `frame-renderer.js` script and load `viewer.js` with `type="module"`. Leave `storyboard-data.js` as a classic script. Make the first statement of `prototypes/storyboard-viewer/viewer.js` `import "./frame-renderer.mjs";` and keep the rest on `window.FrameRenderer`. Delete `prototypes/storyboard-viewer/frame-renderer.js` in this same change.
- [ ] T014 Implement the static allowlist, method check, content-type check, JSON check, and 262144-byte ceiling in `app/storyboard-web/server.mjs`. Map the contract paths to `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, `app/storyboard-web/public/app.css`, `app/storyboard-web/overflow.mjs`, `prototypes/storyboard-viewer/frame-renderer.mjs`, and `prototypes/storyboard-viewer/viewer.css`. Do not append the request path to a directory.

**Checkpoint**: Schema, provider, HTTP, segment, and renderer-structure tests pass. The prototype still uses one renderer module.

---

## Phase 3: User Story 1 - See the whole storyboard (Priority: P1) MVP

**Goal**: A paste becomes a read-only storyboard through the last frame, including split panels, a silent source-authored action, a derived beat, and overflow display blocks.

**Independent Test**: Paste one multi-line Russian dialogue that includes a two-person exchange, one source-authored silent action, and one utterance too long for a single dialogue area. Open the first frame and the last frame. The storyboard is readable without editing, saving, or signing in.

### Tests

- [ ] T015 [P] [US1] Write failing anchor-success tests in `app/storyboard-web/test/anchor.test.mjs` for `Путин: Привет. (пауза) Дуров: Пока.` as two utterances and one action on one segment; `Аня: Смотри. (машет)` as an utterance and an action; `[утро] Аня: Пора.` as context then dialogue; one utterance whose `sourceQuote` includes the exact separator across `seg-0` and `seg-1`; `Да. Да.` with two `Да.` quotes as one assignment; Cyrillic `Борис: нет`; emoji `Аня: привет 😀`; `е` plus U+0308 covered together; `Аня: да\r\nпродолжение`; and `Аня: да\r\n\n \nБорис: нет` with the gap server-owned. Assert spoken text drops only a leading `speakerLabel + ": "` or else `speakerLabel + ":"`.
- [ ] T016 [P] [US1] Write failing overflow tests in `app/storyboard-web/test/overflow.test.mjs` that call `compileOverflow` with an injected `(text, options) => boolean`. Do not use a DOM stub. Assert the largest accepted ladder size, a minimum-size split into `${stageId}#1` onward, exact concatenation of spoken text, copied `layout`, panel descriptions, and `speakerPanel`, and a directing segment that keeps its own composition when split further.
- [ ] T017 [P] [US1] Write a failing ready-path test in `app/storyboard-web/test/storyboard-ready.test.mjs`. A fake provider returns schema-valid Interpret and Stage JSON for a two-speaker paste with one action. `POST /api/storyboard` returns 200 `checked`, not `ready`. Dialogue strings are server slices. `fontSize` is absent. After `compileOverflow` with a measurer that accepts the largest size, the page model can open the last frame.

### Implementation

- [ ] T018 [US1] Implement the passing anchor assignment in `app/storyboard-web/fidelity.mjs`. `sourceQuote` is required for every kind and must contain a non-whitespace character. Resolve it only when exactly one ordered, non-overlapping assignment exists inside the contiguous `segmentIds` window, on scalar boundaries. Record UTF-16 offsets so `draft.text.slice(draftStart, draftEnd) === sourceQuote`. For `explicit`, remove one leading `speakerLabel + ": "` if present, otherwise one leading `speakerLabel + ":"`. For `inferred` and `unresolved`, spoken text equals the accepted slice. Uncovered code units may only be separators or horizontal whitespace, defined as `/\s/u` except U+000A, U+000D, U+2028, and U+2029.
- [ ] T019 [P] [US1] Implement `app/storyboard-web/overflow.mjs` with no Node builtins. Walk `FONT_LADDER` from largest to smallest. Split at `Intl.Segmenter(undefined, { granularity: "grapheme" })` boundaries, then retreat to the latest whitespace grapheme boundary that leaves a non-empty prefix. Copy `layout`, panel descriptions, and `speakerPanel`. Do not copy `fontSize`. Keep `origin` `source`. A `directingBeat` partition must already be the unique exact partition of the spoken text before measurement. A single grapheme that does not fit is `invalid-display-block`.
- [ ] T020 [US1] Implement `app/storyboard-web/interpret.mjs` as one completion. Load `app/storyboard-web/prompts/interpret.md`, validate with the Interpret schema, run the anchor pass, and do not call Stage when that pass fails.
- [ ] T021 [US1] Implement `app/storyboard-web/stage.mjs` as one completion. Load `app/storyboard-web/prompts/stage.md`. Accept one frame per utterance. Build `checked` frames whose `dialogue` is spoken text, whose action frames have `dialogue` `""` and `outsideFrameText` equal to the accepted slice, and whose `review` entries are `{ sourceItemId, kind, text }` in source order. Do not set `fontSize`. Do not return `status` `ready`.
- [ ] T022 [US1] Add `POST /api/storyboard` to `app/storyboard-web/server.mjs`. Return 200 `checked` only after schema and source checks pass. Return 200 `blocked` with `frames` omitted when fidelity fails. Map provider results to 502 `provider`, 502 `invalid-output`, 504 `timeout`, and 500 `configuration`. Never label the HTTP body `ready`.
- [ ] T023 [P] [US1] Create the read-only page shell in `app/storyboard-web/public/index.html` with a paste control, a loading region, a frame grid, and a detail view that can open the last frame. Link `viewer.css` before `app.css`. Do not add edit, save, regenerate, or undo controls.
- [ ] T024 [P] [US1] Create `app/storyboard-web/public/app.css` for page chrome only. It may reset page-level `body` presentation and must not override `.frame-canvas`, `.panel-strip`, `.panel`, `.panel-description`, `.dialogue-bar`, `.dialogue-cell`, or `.dialogue-text`.
- [ ] T025 [US1] Implement `app/storyboard-web/public/app.js` so a paste stays in loading through HTTP `checked`, calls `measureDialogue` and `compileOverflow`, and only then shows the ready grid. Detail navigation opens the last frame. Render with `FrameRenderer.render(frame, { mode: "structure" })`. Show `outsideFrameText` outside the canvas. Empty `dialogue` omits the dialogue bar. Refresh discards the draft.

**Checkpoint**: User Story 1 is demonstrable on its own. A checked payload is not shown as ready before fitting finishes.

---

## Phase 4: User Story 2 - Refuse an unfaithful storyboard (Priority: P1)

**Goal**: Each seeded fidelity defect, unresolved speaker, and unusable provider result is visible as blocked or failed, and is not presented as a ready storyboard.

**Independent Test**: Seed one fidelity defect at a time against an otherwise usable dialogue. Each defect produces a blocking failure and does not present a ready storyboard.

### Tests

- [ ] T026 [P] [US2] Write failing anchor-defect tests in `app/storyboard-web/test/fidelity-anchor.test.mjs` that each block only one of `invalid-anchor`, `ambiguous-anchor` for `Да Да Да` with two `Да` quotes, `overlapping-anchor`, `reordered-dialogue`, `invalid-coverage` for a period outside every quote, and `invalid-speaker-label` when an explicit slice does not start with `speakerLabel + ": "` or `speakerLabel + ":"`. Include a surrogate-pair fragment and a combining mark left outside the quote.
- [ ] T027 [P] [US2] Write failing accounting tests in `app/storyboard-web/test/fidelity-account.test.mjs` that each block only one of `empty-draft`, `duplicate-id`, `unresolved-speaker`, `unknown-source-item`, `invalid-source-role`, `unaccounted-source-item`, and `reordered-review`. `review` must list context and note ids in resolved source order. `unresolved-speaker` must not call Stage.
- [ ] T028 [P] [US2] Write failing placement tests in `app/storyboard-web/test/fidelity-derived.test.mjs`. A derived beat between a note and the next utterance must name those adjacent source items. Skipping the note to anchor the surrounding rendered frames is `invalid-derived-beat`. Directing quotes that do not uniquely partition the spoken text, or adjacent segments with the same composition, are `invalid-directing-beat`.
- [ ] T029 [P] [US2] Write failing dialogue-defect tests in `app/storyboard-web/test/fidelity-dialogue.test.mjs` that each block only one of `lost-dialogue`, `duplicated-dialogue`, `changed-wording`, and `invalid-display-block`. Schema-valid model text that does not match the server slice is blocked. There is no `schema-invalid` code.
- [ ] T030 [P] [US2] Write failing terminal-state tests in `app/storyboard-web/test/storyboard-blocked.test.mjs`. A blocked response is HTTP 200 with `failures` and no `frames`, and the page must not show a ready storyboard. Provider, timeout, and `invalid-output` responses show `failed` rather than `blocked`. A measurement failure is page kind `measurement` and is not ready.

### Implementation

- [ ] T031 [US2] Extend `app/storyboard-web/fidelity.mjs` so a missing quote is `invalid-anchor`, more than one ordered assignment is `ambiguous-anchor`, an unpackable or double-covered span is `overlapping-anchor`, and a packable assignment that is not array order is `reordered-dialogue`. Collect every applicable code. Do not run these codes when Ajv has already failed.
- [ ] T032 [US2] Extend `app/storyboard-web/fidelity.mjs` so accounting matches `specs/001-structure-storyboard-tracer/contracts/storyboard-api.md`: one utterance frame, one action frame, and context or note ids only in `review`, in source order. `unresolved-speaker` is schema-valid and blocks before Stage. A wrong `sourceRole` is `invalid-source-role`.
- [ ] T033 [US2] Extend `app/storyboard-web/fidelity.mjs` and `app/storyboard-web/stage.mjs` so `placement` uses the full source-item list. Both ids must be adjacent. Only `beforeSourceItemId` is legal for the first item. Only `afterSourceItemId` is legal for the last item. Frame sort keys keep a beat in its gap. Directing `quote` strings are non-authoritative and must form the unique exact partition of the spoken text.
- [ ] T034 [US2] Extend `app/storyboard-web/interpret.mjs` so `unresolved-speaker` and any other Interpret fidelity failure return `blocked` and do not start Stage. A schema failure stays `502` `invalid-output`.
- [ ] T035 [US2] Extend `app/storyboard-web/public/app.js` and `app/storyboard-web/public/index.html` so `blocked` shows the failure codes and does not render frames as ready, and `failed` kinds `provider`, `invalid-output`, `timeout`, `configuration`, `invalid-request`, and `measurement` are distinct from `blocked`.

**Checkpoint**: Each seeded defect is blocked on its own. An unusable provider result is failed. Neither is labeled ready.

---

## Phase 5: Final verification

**Purpose**: Prove the prototype, the historical pipeline checks, and the visual fit rule still hold. This phase does not add product scope.

- [ ] T036 [P] Add `app/storyboard-web/test/prototype-regression.test.mjs` asserting `prototypes/storyboard-viewer/image-storyboard.html` does not reference `frame-renderer.js`, `prototypes/storyboard-viewer/viewer.js` imports `./frame-renderer.mjs`, and `prototypes/storyboard-viewer/storyboard-data.js` remains a classic script. Assert `fontSizeFor` is still the fallback when `fontSize` is absent.
- [ ] T037 Run `node --test app/storyboard-web/test/**/*.test.mjs` from the repository root and confirm the default suite makes no network call and does not read `.env.local`.
- [ ] T038 Run `npm run check` using the `check` script in `./package.json` and confirm it remains the historical video-pipeline check in `tools/validate.mjs`.
- [ ] T039 Run `npm run mutations` using the `mutations` script in `./package.json` and confirm `tools/mutations.mjs` does not call the storyboard provider.
- [ ] T040 Manually open `app/storyboard-web/public/index.html` through `node --env-file-if-exists=.env.local app/storyboard-web/server.mjs` and confirm a long utterance either uses a permitted `FONT_LADDER` size or becomes consecutive display blocks, without clipping and without moving the panels. This is outside `node --test`.
- [ ] T041 Confirm `./package.json` has no live storyboard script on the default test path. A live smoke command may be added later only after a separate approval, and it must stay outside `node --test` and outside `app/storyboard-web/test/`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. Blocks both user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Test files may be written after Foundational. Implementation edits `fidelity.mjs`, `stage.mjs`, `interpret.mjs`, `app.js`, and `index.html` after User Story 1 creates them.
- **Final verification (Phase 5)**: Depends on the stories being implemented.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational. This is the MVP.
- **User Story 2 (P1)**: Uses the same pipeline and adds the defect matrix. Its independent test seeds one defect at a time and does not require a new paste flow.

### Within Each User Story

- Tests fail before implementation.
- Anchor and provider behavior land before the HTTP handler returns `checked`.
- `measureDialogue` and `compileOverflow` stay in different files.
- The page shows `ready` only after compilation. The server never returns `ready`.

### Parallel Opportunities

- T001 and T002 can run together.
- T003 through T007 can run together.
- T008, T009, and T010 can run together.
- T012 and T013 can run together after T010.
- T015, T016, and T017 can run together.
- T019 can run beside T018 because `overflow.mjs` does not import `fidelity.mjs`.
- T023 and T024 can run together.
- T026 through T030 can run together.
- T036 can be written beside the other final checks once the prototype switch in T013 exists.
- User Story 2 tests can be authored while User Story 1 implementation proceeds, in different files.

---

## Parallel Example: User Story 1

```bash
# Failing tests together:
node --test app/storyboard-web/test/anchor.test.mjs
node --test app/storyboard-web/test/overflow.test.mjs
node --test app/storyboard-web/test/storyboard-ready.test.mjs

# Separate implementation files after the tests exist:
# app/storyboard-web/fidelity.mjs
# app/storyboard-web/overflow.mjs
# app/storyboard-web/public/index.html
# app/storyboard-web/public/app.css
```

---

## Parallel Example: User Story 2

```bash
# Failing defect tests together:
node --test app/storyboard-web/test/fidelity-anchor.test.mjs
node --test app/storyboard-web/test/fidelity-account.test.mjs
node --test app/storyboard-web/test/fidelity-derived.test.mjs
node --test app/storyboard-web/test/fidelity-dialogue.test.mjs
node --test app/storyboard-web/test/storyboard-blocked.test.mjs
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3.
3. Stop and run the User Story 1 independent test.
4. Do not treat that stop as feature completion. User Story 2 is also P1.

### Incremental Delivery

1. Setup and foundation produce the shared server, renderer, and prompts.
2. User Story 1 shows a faithful read-only storyboard.
3. User Story 2 makes each fidelity defect and provider failure visible.
4. Final verification runs the new suite, `npm run check`, `npm run mutations`, the prototype regression, and the manual fit check.

### Out of scope

Do not add PostgreSQL, Docker, accounts, persistence, cast confirmation, editing, regeneration, a repair loop, export, images, audio, or video. Do not restore the Writer, Editor, Director, and Reviewer sequence.

---

## Notes

- [P] tasks use different files and do not wait on an incomplete sibling.
- Both user stories are P1. The MVP boundary is User Story 1 because that is the first demonstrable storyboard.
- `schema-invalid` is not a code. Schema failure is `502` `invalid-output`. Source-fidelity failure is HTTP 200 `blocked`.
- The 262144-byte ceiling is operational. It is not the open product paste limit.
- A new fact inside a derived panel description is not a string check. Dialogue on a derived frame is rejected by the schema.
