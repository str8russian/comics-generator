---
description: "Implementation tasks for the read-only Structure storyboard tracer"
---

# Tasks: Read-only Structure Storyboard Tracer

**Input**: Design documents from `/specs/001-structure-storyboard-tracer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The offline suite is required. Schema contract tests may pass as soon as they are written, because `specs/001-structure-storyboard-tracer/contracts/` already exists. Application behavior tests still come before the implementation tasks that make them pass. Do not call the live provider.

**Organization**: Setup, shared foundation, User Story 1, User Story 2, then final verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other `[P]` tasks in the same wave. It must not depend on an unfinished `[P]` sibling.
- **[Story]**: `[US1]` or `[US2]` on user-story tasks only
- Setup, foundation, and final verification have no story label
- A phase checkpoint uses only that phase and earlier phases

## Path Conventions

- Application: `app/storyboard-web/`
- Canonical renderer: `prototypes/storyboard-viewer/frame-renderer.mjs`
- Existing prototype: `prototypes/storyboard-viewer/image-storyboard.html`, `viewer.js`, `viewer.css`, `storyboard-data.js`
- Tests: `app/storyboard-web/test/*.test.mjs` via `node --test`
- No new package. `package.json` already has `"type": "module"` and `ajv`.

## Measurement contract

`app/storyboard-web/public/app.js` awaits `document.fonts.ready` once before compilation starts. `measureDialogue(document, frame, fontSize)` then returns a boolean synchronously. `compileOverflow` stays a pure synchronous function. Tests inject `(text, options) => boolean`. Do not make the compiler async.

## Phase 1: Setup

**Purpose**: Add the two version-controlled prompts. Do not add a dependency, a database, or a live script.

- [x] T001 [P] Write `app/storyboard-web/prompts/interpret.md` so Interpret returns ordered source items with `segmentIds` and `sourceQuote` and no numeric offsets. The prompt must not read or copy `prompts/01-writer.md`, `prompts/02-editor.md`, `prompts/03-director.md`, or `prompts/04-reviewer.md`.
- [x] T002 [P] Write `app/storyboard-web/prompts/stage.md` so Stage returns one `json_object` frame list, `placement` for derived beats, and `review` ids for context and notes. Directing `segments[].quote` values are non-authoritative partitions of spoken text. The prompt must not send fit offsets or reuse the historical role prompts.

---

## Phase 2: Foundational

**Purpose**: Shared modules that both stories need. No user story starts until this phase is complete.

**Independent check**: `node --test app/storyboard-web/test/schema.test.mjs app/storyboard-web/test/provider.test.mjs app/storyboard-web/test/http.test.mjs app/storyboard-web/test/segment.test.mjs app/storyboard-web/test/renderer-structure.test.mjs` passes without `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, `app/storyboard-web/public/app.css`, or `app/storyboard-web/overflow.mjs`. `prototypes/storyboard-viewer/image-storyboard.html` still loads the prototype through `window.FrameRenderer`.

### Tests

- [x] T003 [P] Write schema tests in `app/storyboard-web/test/schema.test.mjs` that compile `specs/001-structure-storyboard-tracer/contracts/interpret-response.schema.json` and `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json` with `ajv/dist/2020.js` and `strict: true`. These schemas already exist, so the test does not wait for application code. Cover `explicit`, `inferred`, and `unresolved` utterances; `action`, `context`, and `note` only with `speakerStatus` `none` and no `speakerLabel`; required `sourceQuote`; rejection of a whitespace-only quote, `utteranceQuote`, and numeric offsets; one panel for `single` and two for `split2`; `speakerPanel` only on an utterance; derived `placement` with at least one of `afterSourceItemId` or `beforeSourceItemId`; segments only when `directingBeat` is true.
- [x] T004 [P] Write provider tests in `app/storyboard-web/test/provider.test.mjs` before `app/storyboard-web/provider.mjs` exists. Use a fake `fetch`. Assert request serialization for `POST /v1/chat/completions` and `response_format.type` `json_object`. Assert per-function configuration: Interpret `model` from `INTERPRET_MODEL` or else `CONTEST_MODEL` with `reasoning_effort` `low`, and Stage `model` from `STAGE_MODEL` or else `CONTEST_MODEL` with `reasoning_effort` `medium`. Assert `max_completion_tokens` only when that function's limit is set, never `max_tokens`, and that `CONTEST_REQUEST_JSON` is not read. Classify one completion: timeout `504` `timeout`, thrown `fetch` and non-2xx `502` `provider`, and missing `finish_reason`, `length`, any other non-`stop` reason, non-object JSON, and schema failure `502` `invalid-output`. Assert the provider client does not retry or continue a completion. Do not assert prompt-file contents or that Stage is skipped after Interpret fails.
- [x] T005 [P] Write HTTP tests in `app/storyboard-web/test/http.test.mjs` before `app/storyboard-web/server.mjs` exists. Inspect the route map or inject a file reader. The map must name `GET /`, `/app.js`, `/app.css`, `/overflow.mjs`, `/frame-renderer.mjs`, and `/viewer.css` as in `specs/001-structure-storyboard-tracer/contracts/storyboard-api.md`. Assert unknown paths are 404, the wrong method is 405 with `Allow`, a non-JSON content type is 415, malformed JSON is 400 `invalid-request`, and a body above `STORYBOARD_MAX_BODY_BYTES` 262144 is 413. Assert 405, 413, and 415 have no storyboard JSON body. Do not require the real page, script, stylesheet, or `overflow.mjs` bytes to exist. Do not add placeholder production files.
- [x] T006 [P] Write segment tests in `app/storyboard-web/test/segment.test.mjs` before `app/storyboard-web/segment.mjs` exists. A separator is `\r\n`, otherwise `\n`, otherwise `\r`. Empty runs are kept. Joining segments and separators equals `draft.text`. Include `Аня: да\r\n\n \nБорис: нет`.
- [x] T007 [P] Write renderer-structure tests in `app/storyboard-web/test/renderer-structure.test.mjs` before `prototypes/storyboard-viewer/frame-renderer.mjs` exists. Import that module. A DOM stub may assert two descriptions and dialogue in the speaker cell, and no `.dialogue-bar` when dialogue is empty. The stub must not be asked whether text fits, and the test must not call `measureDialogue`. A source assertion reads `prototypes/storyboard-viewer/viewer.css` for `Arial, Helvetica, sans-serif`, `border-box`, `border-top: 2px solid #536064`, weight 500, `letter-spacing: .1px`, `line-height: 1.18`, and `overflow-wrap: anywhere`.

### Implementation

- [x] T008 Implement `app/storyboard-web/config.mjs` with `BASE_URL`, `CONTEST_API_TOKEN`, `CONTEST_TIMEOUT_MS` default 120000, `INTERPRET_MODEL` falling back to `CONTEST_MODEL`, `INTERPRET_REASONING_EFFORT` default `low`, `STAGE_MODEL` falling back to `CONTEST_MODEL`, `STAGE_REASONING_EFFORT` default `medium`, optional per-function `max_completion_tokens`, and optional `INTERPRET_REQUEST_JSON` and `STAGE_REQUEST_JSON`. Drop `model`, `messages`, `response_format`, `reasoning_effort`, `max_completion_tokens`, and `max_tokens` from those extra objects. Do not read `CONTEST_REQUEST_JSON`. Missing required config is `failed` / `configuration`.
- [x] T009 Implement lossless segmentation in `app/storyboard-web/segment.mjs` using the separator rule and id form `seg-0`, `seg-1` from `specs/001-structure-storyboard-tracer/data-model.md`. `draft.text.slice(draftStart, draftEnd) === text`. The model receives `{ id, text }` including empty text.
- [x] T010 Move the body of `prototypes/storyboard-viewer/frame-renderer.js` into `prototypes/storyboard-viewer/frame-renderer.mjs`. Export one constant block (width 1920, height 1080, dialogue-bar height 300, gutter 48, split padding `34px 44px 24px`, single padding `38px 70px 26px`), `FONT_LADDER` `single: [58, 51, 46, 42]` and `split2: [44, 38, 34, 31]`, `fontSizeFor`, and `render`. `fontSizeFor` remains the length-to-size map and is not a fit test. `render` uses `frame.fontSize` only when it is in the ladder; otherwise it uses `fontSizeFor`. Assign `window.FrameRenderer` in the browser. Do not copy geometry into `app/storyboard-web/`. Leave `measureDialogue` for T013.
- [x] T011 Implement the static allowlist, method check, content-type check, JSON check, and 262144-byte ceiling in `app/storyboard-web/server.mjs`. The route map points `GET /` at `app/storyboard-web/public/index.html`, `/app.js` at `app/storyboard-web/public/app.js`, `/app.css` at `app/storyboard-web/public/app.css`, `/overflow.mjs` at `app/storyboard-web/overflow.mjs`, `/frame-renderer.mjs` at `prototypes/storyboard-viewer/frame-renderer.mjs`, and `/viewer.css` at `prototypes/storyboard-viewer/viewer.css`. Tests must be able to inject file bytes for those keys. Do not create placeholder production files. Do not append the request path to a directory. The process must serve this map without a live provider call.

- [x] T012 Implement `app/storyboard-web/provider.mjs` on top of `app/storyboard-web/config.mjs`. Each function sends one `json_object` completion and classifies `finish_reason` as in `specs/001-structure-storyboard-tracer/contracts/storyboard-api.md`. Do not retry, continue, or repair. This module does not load prompt files and does not decide whether Stage runs.
- [x] T013 Add synchronous `measureDialogue(document, frame, fontSize)` to `prototypes/storyboard-viewer/frame-renderer.mjs`. It returns a boolean. Render at scale 1 off-screen, constrain the speaker-cell text node to the laid-out content box, and treat `scrollHeight > clientHeight` or `scrollWidth > clientWidth` as overflow. Do not await `document.fonts.ready` inside this function. Do not put those pixels in `app/storyboard-web/overflow.mjs`.
- [x] T014 Preserve the prototype: in `prototypes/storyboard-viewer/image-storyboard.html`, remove the classic `frame-renderer.js` script and load `viewer.js` with `type="module"`. Leave `storyboard-data.js` as a classic script. Make the first statement of `prototypes/storyboard-viewer/viewer.js` `import "./frame-renderer.mjs";` and keep the rest on `window.FrameRenderer`. Delete `prototypes/storyboard-viewer/frame-renderer.js` in this same change.

**Checkpoint**: The five foundation test files pass. HTTP coverage uses the route map or injected bytes. The prototype still uses one renderer module.

---

## Phase 3: User Story 1 - See the whole storyboard (Priority: P1) MVP

**Goal**: A paste becomes a read-only storyboard through the last frame, including split panels, a silent source-authored action, a derived beat, and overflow display blocks.

**Independent Test**: Paste one multi-line Russian dialogue that includes a two-person exchange, one source-authored silent action, and one utterance too long for a single dialogue area. Open the first frame and the last frame. The storyboard is readable without editing, saving, or signing in.

### Tests

- [ ] T015 [P] [US1] Write anchor-success tests in `app/storyboard-web/test/anchor.test.mjs` before `app/storyboard-web/fidelity.mjs` exists. Cover `Путин: Привет. (пауза) Дуров: Пока.` as two utterances and one action on one segment; `Аня: Смотри. (машет)` as an utterance and an action; `[утро] Аня: Пора.` as context then dialogue; one utterance whose `sourceQuote` includes the exact separator across `seg-0` and `seg-1`; `Да. Да.` with two `Да.` quotes as one assignment; Cyrillic `Борис: нет`; emoji `Аня: привет 😀`; `е` plus U+0308 covered together; `Аня: да\r\nпродолжение`; and `Аня: да\r\n\n \nБорис: нет` with the gap server-owned. Assert spoken text drops only a leading `speakerLabel + ": "` or else `speakerLabel + ":"`.
- [ ] T016 [P] [US1] Write overflow tests in `app/storyboard-web/test/overflow.test.mjs` before `app/storyboard-web/overflow.mjs` exists. Call synchronous `compileOverflow` with an injected `(text, options) => boolean`. Do not use a DOM stub and do not await the compiler. Assert the largest accepted ladder size, a minimum-size split into `${stageId}#1` onward, exact concatenation of spoken text, copied `layout`, panel descriptions, and `speakerPanel`, and a directing segment that keeps its own composition when split further.
- [ ] T017 [P] [US1] Write the ready-path test in `app/storyboard-web/test/storyboard-ready.test.mjs` before `POST /api/storyboard` exists. A fake provider returns schema-valid Interpret and Stage JSON for a two-speaker paste with one action. The response is 200 `checked`, not `ready`. Dialogue strings are server slices. `fontSize` is absent. Synchronous `compileOverflow`, with a measurer that accepts the largest size, leaves the last frame addressable by index. Do not assert prompt-file loading or the absence of a Stage call in this task.

### Implementation

- [ ] T018 [US1] Implement the passing anchor assignment in `app/storyboard-web/fidelity.mjs`. `sourceQuote` is required for every kind and must contain a non-whitespace character. Resolve it only when exactly one ordered, non-overlapping assignment exists inside the contiguous `segmentIds` window, on scalar boundaries. Record UTF-16 offsets so `draft.text.slice(draftStart, draftEnd) === sourceQuote`. For `explicit`, remove one leading `speakerLabel + ": "` if present, otherwise one leading `speakerLabel + ":"`. For `inferred` and `unresolved`, spoken text equals the accepted slice. Uncovered code units may only be separators or horizontal whitespace, defined as `/\s/u` except U+000A, U+000D, U+2028, and U+2029.
- [ ] T019 [US1] Implement synchronous `compileOverflow` in `app/storyboard-web/overflow.mjs` with no Node builtins. Walk `FONT_LADDER` from largest to smallest by calling the injected boolean measurer. Split at `Intl.Segmenter(undefined, { granularity: "grapheme" })` boundaries, then retreat to the latest whitespace grapheme boundary that leaves a non-empty prefix. Copy `layout`, panel descriptions, and `speakerPanel`. Do not copy `fontSize`. Keep `origin` `source`. A `directingBeat` partition must already be the unique exact partition of the spoken text before measurement. A single grapheme that does not fit is `invalid-display-block`.
- [ ] T020 [US1] Implement `app/storyboard-web/interpret.mjs` as one completion. Load the system text from `app/storyboard-web/prompts/interpret.md`, validate with the Interpret schema, and run the anchor pass. When that completion is `failed` or the anchor pass does not pass, return without requesting Stage.
- [ ] T021 [US1] Implement `app/storyboard-web/stage.mjs` as one completion. Load the system text from `app/storyboard-web/prompts/stage.md`. Accept one frame per utterance. Build `checked` frames whose `dialogue` is spoken text, whose action frames have `dialogue` `""` and `outsideFrameText` equal to the accepted slice, and whose `review` entries are `{ sourceItemId, kind, text }` in source order. Do not set `fontSize`. Do not return `status` `ready`.
- [ ] T022 [US1] Add `POST /api/storyboard` to `app/storyboard-web/server.mjs`. Call Interpret and then Stage only when Interpret can continue. Return 200 `checked` only after schema and source checks pass. Return 200 `blocked` with `frames` omitted when fidelity fails. Map provider results to 502 `provider`, 502 `invalid-output`, 504 `timeout`, and 500 `configuration`. Never label the HTTP body `ready`.
- [ ] T023 [P] [US1] Create the read-only page shell in `app/storyboard-web/public/index.html` with a paste control, a loading region, a frame grid, and a detail view that can open the last frame. Link `viewer.css` before `app.css`. Do not add edit, save, regenerate, or undo controls.
- [ ] T024 [P] [US1] Create `app/storyboard-web/public/app.css` for page chrome only. It may reset page-level `body` presentation and must not override `.frame-canvas`, `.panel-strip`, `.panel`, `.panel-description`, `.dialogue-bar`, `.dialogue-cell`, or `.dialogue-text`.
- [ ] T025 [US1] Implement `app/storyboard-web/public/app.js`. Await `document.fonts.ready` once when compilation starts, then call synchronous `measureDialogue` and synchronous `compileOverflow`. A paste stays in loading through HTTP `checked` and only then shows the ready grid. Detail navigation opens the last frame. Render with `FrameRenderer.render(frame, { mode: "structure" })`. Show `outsideFrameText` outside the canvas. Empty `dialogue` omits the dialogue bar. Refresh discards the draft.
- [ ] T026 [US1] Extend `app/storyboard-web/test/storyboard-ready.test.mjs` after `app/storyboard-web/interpret.mjs`, `app/storyboard-web/stage.mjs`, and `POST /api/storyboard` exist. Assert the Interpret system message equals `app/storyboard-web/prompts/interpret.md` and the Stage system message equals `app/storyboard-web/prompts/stage.md`. Assert no Stage request is sent when the Interpret completion is `invalid-output` or the anchor pass fails.
- [ ] T027 [US1] Add `app/storyboard-web/test/static-assets.test.mjs` after `app/storyboard-web/public/index.html`, `app/storyboard-web/public/app.js`, `app/storyboard-web/public/app.css`, and `app/storyboard-web/overflow.mjs` exist. GET those real files plus `prototypes/storyboard-viewer/frame-renderer.mjs` and `prototypes/storyboard-viewer/viewer.css` through `app/storyboard-web/server.mjs` and compare the response bytes with the files on disk.

**Checkpoint**: User Story 1 is demonstrable on its own. Prompt loading and the no-Stage-after-Interpret-failure path are covered. Real static assets are served. A checked payload is not shown as ready before synchronous fitting finishes.

---

## Phase 4: User Story 2 - Refuse an unfaithful storyboard (Priority: P1)

**Goal**: Each seeded fidelity defect, unresolved speaker, and unusable provider result is visible as blocked or failed, and is not presented as a ready storyboard.

**Independent Test**: Seed one fidelity defect at a time against an otherwise usable dialogue. Each defect produces a blocking failure and does not present a ready storyboard.

### Tests

- [ ] T028 [P] [US2] Write anchor-defect tests in `app/storyboard-web/test/fidelity-anchor.test.mjs` before the matching branches in `app/storyboard-web/fidelity.mjs` exist. Each case blocks only one of `invalid-anchor`, `ambiguous-anchor` for `Да Да Да` with two `Да` quotes, `overlapping-anchor`, `reordered-dialogue`, `invalid-coverage` for a period outside every quote, and `invalid-speaker-label` when an explicit slice does not start with `speakerLabel + ": "` or `speakerLabel + ":"`. Include a surrogate-pair fragment and a combining mark left outside the quote.
- [ ] T029 [P] [US2] Write accounting tests in `app/storyboard-web/test/fidelity-account.test.mjs` before the matching branches exist. Each case blocks only one of `empty-draft`, `duplicate-id`, `unresolved-speaker`, `unknown-source-item`, `invalid-source-role`, `unaccounted-source-item`, and `reordered-review`. `review` must list context and note ids in resolved source order. `unresolved-speaker` must not call Stage. `app/storyboard-web/interpret.mjs` already exists from User Story 1; this assertion waits for T036 to make that skip hold for an unresolved speaker.
- [ ] T030 [P] [US2] Write placement tests in `app/storyboard-web/test/fidelity-derived.test.mjs` before the matching branches exist. A derived beat between a note and the next utterance must name those adjacent source items. Skipping the note to anchor the surrounding rendered frames is `invalid-derived-beat`. Directing quotes that do not uniquely partition the spoken text, or adjacent segments with the same composition, are `invalid-directing-beat`.
- [ ] T031 [P] [US2] Write dialogue-defect tests in `app/storyboard-web/test/fidelity-dialogue.test.mjs` before the matching branches exist. Each case blocks only one of `lost-dialogue`, `duplicated-dialogue`, `changed-wording`, and `invalid-display-block`. Schema-valid model text that does not match the server slice is blocked. There is no `schema-invalid` code.
- [ ] T032 [P] [US2] Write terminal-state tests in `app/storyboard-web/test/storyboard-blocked.test.mjs` before the blocked and failed UI exists. A blocked response is HTTP 200 with `failures` and no `frames`, and the page must not show a ready storyboard. Provider, timeout, and `invalid-output` responses show `failed` rather than `blocked`. A measurement failure is page kind `measurement` and is not ready.

### Implementation

- [ ] T033 [US2] Extend `app/storyboard-web/fidelity.mjs` so a missing quote is `invalid-anchor`, more than one ordered assignment is `ambiguous-anchor`, an unpackable or double-covered span is `overlapping-anchor`, and a packable assignment that is not array order is `reordered-dialogue`. Collect every applicable code. Do not run these codes when Ajv has already failed.
- [ ] T034 [US2] Extend `app/storyboard-web/fidelity.mjs` so accounting matches `specs/001-structure-storyboard-tracer/contracts/storyboard-api.md`: one utterance frame, one action frame, and context or note ids only in `review`, in source order. A wrong `sourceRole` is `invalid-source-role`. `unresolved-speaker` is schema-valid.
- [ ] T035 [US2] Extend `app/storyboard-web/fidelity.mjs` and `app/storyboard-web/stage.mjs` so `placement` uses the full source-item list. Both ids must be adjacent. Only `beforeSourceItemId` is legal for the first item. Only `afterSourceItemId` is legal for the last item. Frame sort keys keep a beat in its gap. Directing `quote` strings are non-authoritative and must form the unique exact partition of the spoken text.
- [ ] T036 [US2] Extend `app/storyboard-web/interpret.mjs` so `unresolved-speaker` and any other Interpret fidelity failure return `blocked` and do not start Stage. A schema failure stays `502` `invalid-output`.
- [ ] T037 [US2] Extend `app/storyboard-web/public/app.js` and `app/storyboard-web/public/index.html` so `blocked` shows the failure codes and does not render frames as ready, and `failed` kinds `provider`, `invalid-output`, `timeout`, `configuration`, `invalid-request`, and `measurement` are distinct from `blocked`.

**Checkpoint**: Each seeded defect is blocked on its own. An unresolved speaker does not start Stage. An unusable provider result is failed. Neither is labeled ready.

---

## Phase 5: Final verification

**Purpose**: Prove the prototype, the historical pipeline checks, and the visual fit rule still hold. This phase does not add product scope.

- [ ] T038 [P] Add `app/storyboard-web/test/prototype-regression.test.mjs` asserting `prototypes/storyboard-viewer/image-storyboard.html` does not reference `frame-renderer.js`, `prototypes/storyboard-viewer/viewer.js` imports `./frame-renderer.mjs`, and `prototypes/storyboard-viewer/storyboard-data.js` remains a classic script. Assert `fontSizeFor` is still the fallback when `fontSize` is absent.
- [ ] T039 Run `node --test app/storyboard-web/test/**/*.test.mjs` from the repository root after T038 is present. Confirm the default suite makes no network call and does not read `.env.local`.
- [ ] T040 [P] Run `npm run check` using the `check` script in `./package.json` and confirm it remains the historical video-pipeline check in `tools/validate.mjs`.
- [ ] T041 [P] Run `npm run mutations` using the `mutations` script in `./package.json` and confirm `tools/mutations.mjs` does not call the storyboard provider.
- [ ] T042 Add `app/storyboard-web/test/offline-provider.mjs`, a loopback fake Chat Completions listener on `127.0.0.1` that returns canned Interpret JSON and then canned Stage JSON for one long utterance. Start `app/storyboard-web/server.mjs` with `BASE_URL` set to that listener and a non-secret `CONTEST_API_TOKEN`. Do not pass `--env-file-if-exists=.env.local` and do not read credentials. Open `app/storyboard-web/public/index.html` in a browser, submit the fixture paste, and confirm the real renderer, synchronous `measureDialogue`, and `compileOverflow` either keep a permitted `FONT_LADDER` size or produce consecutive display blocks, without clipping and without moving the panels. This check is outside `node --test`.
- [ ] T043 Confirm `./package.json` has no live storyboard script on the default test path. A live smoke command remains a separate later action and requires explicit approval. It must stay outside `node --test` and outside `app/storyboard-web/test/`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. Its checkpoint does not need User Story 1 files.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Starts after User Story 1. Its tests are new files and do not edit User Story 1 test files.
- **Final verification (Phase 5)**: Depends on both stories. T039 waits for T038. T042 waits for the real page, renderer, and compiler from earlier phases.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational. This is the MVP.
- **User Story 2 (P1)**: Adds the defect matrix on top of `fidelity.mjs`, `stage.mjs`, `interpret.mjs`, `app.js`, and `index.html`.

### Within Each Phase

- T003 may pass before any application module exists.
- T004 through T007, T015 through T017, and T028 through T032 are written before the modules that satisfy them.
- T012 follows T008. T013 and T014 follow T010. Those three may run together once T008 and T010 are done. They are not `[P]` because T008 and T010 are earlier tasks in the same phase.
- T020 and T021 follow T018. T022 follows T020 and T021. T026 follows T022. T027 follows T019, T023, T024, and T025.
- T025 follows T013, T019, T023, and T024.
- T033 through T036 follow the User Story 2 tests and edit existing modules in order. T037 follows T032.
- T039 follows T038. T040 and T041 do not depend on T038 or T039. T042 follows the implemented application and does not read `.env.local`.

### Parallel Opportunities

- T001 and T002 can run together.
- T003 through T007 can run together.
- After T003 through T007 are written, T008 through T011 can run together. They are not marked `[P]` because they follow those test tasks in the same phase.
- T015, T016, and T017 can run together.
- T023 and T024 can run together, and neither waits for T018.
- T028 through T032 can run together.
- T038, T040, and T041 can run together. T039 cannot start until T038 is written. T042 is not parallel with the suite run.

---

## Parallel Example: User Story 1

```bash
# Tests written before fidelity, overflow, and POST exist:
node --test app/storyboard-web/test/anchor.test.mjs
node --test app/storyboard-web/test/overflow.test.mjs
node --test app/storyboard-web/test/storyboard-ready.test.mjs

# Page shell files that do not depend on those tests:
# app/storyboard-web/public/index.html
# app/storyboard-web/public/app.css
```

---

## Parallel Example: User Story 2

```bash
# Defect tests written before the new fidelity branches exist:
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
2. Complete Phase 3, including T026 and T027.
3. Stop and run the User Story 1 independent test.
4. Do not treat that stop as feature completion. User Story 2 is also P1.

### Incremental Delivery

1. Setup and foundation produce prompts, config, segmentation, the renderer, the provider client, and an allowlist server that tests can exercise without page files.
2. User Story 1 shows a faithful read-only storyboard and serves the real assets.
3. User Story 2 makes each fidelity defect and provider failure visible.
4. Final verification runs the new suite, `npm run check`, `npm run mutations`, the prototype regression, and the offline manual fit check.

### Out of scope

Do not add PostgreSQL, Docker, accounts, persistence, cast confirmation, editing, regeneration, a repair loop, export, images, audio, or video. Do not restore the Writer, Editor, Director, and Reviewer sequence.

---

## Notes

- `[P]` tasks in one wave do not depend on each other.
- Both user stories are P1. The MVP boundary is User Story 1 because that is the first demonstrable storyboard.
- `schema-invalid` is not a code. Schema failure is `502` `invalid-output`. Source-fidelity failure is HTTP 200 `blocked`.
- The 262144-byte ceiling is operational. It is not the open product paste limit.
- A new fact inside a derived panel description is not a string check. Dialogue on a derived frame is rejected by the schema.
- `measureDialogue` returns a boolean. `compileOverflow` is synchronous. `document.fonts.ready` is awaited once in `app/storyboard-web/public/app.js`.
