# Implementation Plan: Read-only Structure Storyboard Tracer

**Branch**: `001-structure-storyboard-tracer` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-structure-storyboard-tracer/spec.md`

## Summary

A person pastes one Russian dialogue and sees a complete read-only Structure storyboard through the last frame, or a visible blocking or failure state. This tracer is the first thin feature of the production web application in `app/storyboard-web/`. Later features extend that application. The server interprets the draft by reference to server-created segments, then requests one Stage storyboard as `json_object`. Deterministic checks reconstruct dialogue from the draft. The page stays in loading until browser text measurement and a pure overflow compiler finish. Frames are drawn by one canonical renderer module.

## Technical Context

**Language/Version**: Node.js 24, ESM, as in the repository `package.json`

**Primary Dependencies**: `node:http`, `node:test`, and `ajv` already declared. Ajv compiles the local schemas in strict mode, as the contest spike does (`ajv/dist/2020.js`). No new package.

**Storage**: None. The browser holds the draft and the result until refresh.

**Testing**: `node:test` with a fake chat-completions adapter. Default suite has no network and no credentials. Overflow tests inject a boolean measurer. They do not treat a DOM stub as text layout.

**Target Platform**: Local web page opened against a local Node process.

**Project Type**: Production web application inside the existing repository. This feature is its first page.

**Performance Goals**: One user waits for one storyboard. No concurrency target.

**Constraints**: Server-side model calls only. One Interpret completion and one Stage completion, neither chunked and neither repaired. Session data only. No PostgreSQL, Docker, accounts, editing, regeneration, undo, export, images, or video.

**Scale/Scope**: One page, one `POST /api/storyboard`, two provider calls inside it, two-panel layouts only.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled scaffold from SpecKit initialization. It adopts no project principles. There is no gate to pass and no violation to justify.

Post-design re-check: still no adopted principle. The design stays inside the feature spec: one application, no persistence, no second frame geometry, no repair loop, no historical role prompts.

## Project Structure

### Documentation (this feature)

```text
specs/001-structure-storyboard-tracer/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── storyboard-api.md
│   ├── interpret-response.schema.json
│   └── stage-response.schema.json
└── tasks.md              # not created by this plan
```

### Source Code (repository root)

```text
app/storyboard-web/          # stable application; later features extend this directory
├── server.mjs               # node:http, allowlisted files, POST /api/storyboard
├── config.mjs               # per-function model, reasoning, timeout, body ceiling
├── provider.mjs             # server-only chat completions client
├── segment.mjs              # lossless server segments and separators
├── interpret.mjs            # one json_object interpretation
├── stage.mjs                # one json_object storyboard completion
├── fidelity.mjs             # anchors, coverage, wording, order, speakers, derived beats
├── overflow.mjs             # pure compiler; measurer injected; no node builtins
├── prompts/
│   ├── interpret.md         # version-controlled Interpret prompt
│   └── stage.md             # version-controlled Stage prompt
├── public/
│   ├── index.html
│   ├── app.js               # loading until fit completes; grid and detail
│   └── app.css              # page chrome only
└── test/                    # node:test, fake provider, no live network

prototypes/storyboard-viewer/
├── frame-renderer.mjs       # canonical renderer, geometry, and browser measurer
├── viewer.js                # gains one import; still uses window.FrameRenderer
├── viewer.css               # frame rules served, not copied
└── image-storyboard.html    # loads viewer.js as a module
```

Historical `prompts/`, `tools/`, `schema/`, `evals/`, and `spikes/` stay outside this application. The application does not import them.

**Structure Decision**: The repository has no existing application directory and no established app name that this feature should inherit. `app/storyboard-web/` is the stable production boundary. `app/tracer/` is not used. Later features add pages and modules under `app/storyboard-web/` rather than replacing this directory. The renderer stays in the prototype path so the prototype and the application share one implementation.

## Architecture and data flow

1. The page posts `{ "draft": "<pasted text>" }` to `POST /api/storyboard` and shows loading.
2. The server reads configuration from the environment. See [Provider configuration](#provider-configuration). Those values are never sent to the browser.
3. The server splits the draft into lossless segments and separators before any model call. Interpret may reference segment ids and an exact quote. It cannot submit numeric offsets. The server slices `draft.text`.
4. An utterance whose speaker status is `unresolved` blocks readiness. Stage is not called.
5. Stage sends one `json_object` completion. The payload is the complete frame list in array order. It is not continued if truncated. The model does not send fit offsets. A directing `quote` is a non-authoritative copy and must resolve to the spoken text.
6. Schema failure stops the request as `failed`. A schema-valid result that fails source fidelity is `blocked`. A schema-valid, fidelity-valid result is HTTP `checked`, which is not a ready storyboard.
7. On `checked`, the page stays in loading. It measures dialogue in the browser, runs `overflow.mjs`, and only then shows `ready`. On `blocked` or `failed`, the page shows that state and does not present frames as ready.

Interpret and Stage stay separate calls so source boundaries are fixed before framing. The browser still makes one request. There is no repair loop and no continuation request.

## Renderer reuse and dialogue fitting

`prototypes/storyboard-viewer/frame-renderer.js` is a classic IIFE that assigns `window.FrameRenderer`. It is not an importable ESM module. `fontSizeFor` maps `text.length` to 31, 34, 38, or 44 for a split frame and to 42, 46, 51, or 58 for a single frame. That map does not establish that rendered text fits. The tracer does not use it as a fit test.

Bounded refactor, in one implementation change:

1. Move the renderer body into `prototypes/storyboard-viewer/frame-renderer.mjs`.
2. Export one constant block, `FONT_LADDER`, `fontSizeFor`, `render`, and `measureDialogue`. The constant block holds the values `render` already writes: width 1920, height 1080, dialogue-bar height 300, panel gutter 48, split padding `34px 44px 24px`, and single padding `38px 70px 26px`.
3. `FONT_LADDER` is the only size list: `single: [58, 51, 46, 42]` and `split2: [44, 38, 34, 31]`, largest first. `fontSizeFor` keeps today's character-count thresholds and may return only a ladder entry. The fitter walks the ladder and does not read those thresholds.
4. `render` uses `frame.fontSize` when that number is in the ladder for the frame's panel count. Otherwise it uses `fontSizeFor`, which preserves the prototype's current visual sizes. A tracer dialogue frame is not shown as ready without a measured `fontSize`.
5. On load in a browser, the module assigns `window.FrameRenderer` with `width`, `height`, `dialogueBarHeight`, `panelGutter`, `render`, `measureDialogue`, and `fontSizeFor`.
6. In `image-storyboard.html`, remove the classic `frame-renderer.js` script. Load `viewer.js` with `type="module"`. Leave `storyboard-data.js` as a classic script in the head so `window.STORYBOARD_DATA` exists before the deferred module runs.
7. The first statement of `viewer.js` is `import "./frame-renderer.mjs";`. The rest of the viewer continues to call `window.FrameRenderer`.
8. Delete `frame-renderer.js` in that same change. No other file references it.
9. Do not copy geometry into `app/storyboard-web/` or into a second stylesheet.

`render` still treats a frame as split when `panels.length > 1`. The Stage schema makes that count match `layout` before a tracer frame is rendered.

### Where fitting occurs

Fitting occurs in the browser, after HTTP `checked`, while the page is still loading. `app/storyboard-web/public/app.js` imports `measureDialogue` from the canonical renderer and `compileOverflow` from `overflow.mjs`. The server does not measure text and does not choose a font size.

### How readiness waits

The server never returns `status: "ready"`. The page leaves loading for `ready` only after `compileOverflow` returns a storyboard whose every dialogue block has a selected `fontSize` and whose slices reconstruct each utterance. A compiler block stays `blocked`. If the measurement host cannot be laid out, the page shows `failed` with kind `measurement` and does not show a storyboard. `document.fonts.ready` is awaited before the first measurement when that promise exists.

### How the largest size is selected

For one piece of dialogue, `compileOverflow` calls the measurer from the largest ladder size to the smallest. The first size that fits is the size used. The minimum size is the last ladder entry: 42 for `single`, 31 for `split2`.

### How overflow is detected

`measureDialogue(document, frame, fontSize)` renders that frame at scale 1 in an off-screen host using `render` and the loaded `viewer.css`. It reads the speaker cell's `clientWidth` and `clientHeight`, subtracts that cell's computed padding, and sets the dialogue text node's `width` and `max-height` to the resulting content box. The piece overflows when `scrollHeight > clientHeight` or `scrollWidth > clientWidth`, using the integers those DOM properties return. `.dialogue-cell { overflow: hidden }` remains a clip for bugs. It is not the fitting strategy.

The CSS declarations that measurement depends on stay in `viewer.css` and are not restated as a second geometry implementation: `.frame-canvas` uses `Arial, Helvetica, sans-serif`; `.frame-canvas *` uses `border-box`; `.dialogue-bar` has `border-top: 2px solid #536064`; `.dialogue-text` uses weight 500, `letter-spacing: .1px`, `line-height: 1.18`, and `overflow-wrap: anywhere`. A source test asserts those declarations are still present. `overflow.mjs` does not contain pixel values, font sizes, or CSS text.

### How tests verify the splitter

Node tests call `compileOverflow` with an injected `(text, { layout, speakerPanel, fontSize }) => boolean`. A length cap in that function is an explicit oracle for the compiler's branches. It is not a claim about CSS layout. Assertions cover the chosen size, split indexes, exact concatenation, copied composition, and the directing-beat exception. Renderer tests may use a small DOM stub only to inspect the element tree: panel count, dialogue under `speakerPanel`, and no `.dialogue-bar` when dialogue is empty. Those tests do not read `scrollHeight` and do not call `measureDialogue`.

## Source anchoring

The model does not calculate numeric offsets. A physical line is not a source item. One item may cover several lines, and several ordered items may share one line. `Путин: Привет. (пауза) Дуров: Пока.` is one line and three source items: two utterances and one action.

Before Interpret, `segment.mjs` scans `draft.text` as a JavaScript string:

- A separator is the first match of `\r\n`, otherwise `\n`, otherwise `\r`.
- A segment is the run between separators, including an empty run. Ids are `seg-0`, `seg-1`, in order.
- Each segment stores `draftStart` and `draftEnd` such that `draft.text.slice(draftStart, draftEnd) === text`.
- Concatenating segments and separators in order reproduces `draft.text` exactly.

The model receives `{ id, text }` for every segment, including empty text. Every source item returns `segmentIds` and `sourceQuote`. `segmentIds` is the search window: one contiguous increasing range, which may be one line or several. `sourceQuote` is a non-authoritative exact copy of that item's whole source slice, including an explicit speaker label when the label is part of the slice. The schema has no `start` or `end`. A model offset is `additionalProperties` and is `failed` / `invalid-output`, not a fidelity block.

The server resolves each quote inside its window:

1. The window `H` is the contiguous draft span from the first segment's `draftStart` through the last segment's `draftEnd`, including separators that fall between those segments.
2. A candidate is a half-open range `[start, end)` inside `H` such that `draft.text.slice(start, end) === sourceQuote`, and both edges are scalar boundaries. A scalar boundary is `0`, `draft.text.length`, or an index that does not fall between a high surrogate and a low surrogate.
3. Items are considered in array order. An assignment picks one candidate per item so that each item ends at or before the next item starts.
4. No candidate for an item is `invalid-anchor`. More than one assignment is `ambiguous-anchor`. No ordered assignment, while some selection of candidates is non-overlapping once sorted by start, is `reordered-dialogue`. Otherwise the empty result is `overlapping-anchor`.
5. Exactly one assignment is accepted. The server records those UTF-16 offsets. The recorded slice is authoritative. The model string is kept only because it compared equal to that slice.

Coverage then walks every code unit:

- A unit in two accepted spans is `overlapping-anchor`.
- A unit in no span is allowed only when it is server-owned. Server-owned units are segmenter separators, and horizontal whitespace: a code point for which `/\s/u` matches, excluding U+000A, U+000D, U+2028, and U+2029.
- Any other uncovered unit is `invalid-coverage`. This includes letters, punctuation, emoji, combining marks, and speaker labels that were left outside every quote.
- Whitespace inside an accepted quote is part of that item. It is not structural.

`empty-draft` means the draft has no code unit outside that server-owned set. The provider is not called.

Spoken dialogue is derived from the accepted slice `Q`. It is not a second model field.

- `explicit`: if `Q` starts with `speakerLabel + ": "`, the spoken text is the remainder after that prefix. Otherwise, if `Q` starts with `speakerLabel + ":"`, the spoken text is the remainder after that shorter prefix. The longer prefix is tested first. The label, the ASCII colon, and that one space stay inside `Q`, so coverage still includes them. They are not part of the spoken text. Any other shape is `invalid-speaker-label`. The remainder must contain a non-server-owned code unit.
- `inferred` and `unresolved`: the spoken text is `Q`. No prefix is removed. An inferred label is metadata and is not required to occur in `Q`.

Display-block offsets index the spoken text. The absolute draft position of a relative offset `r` is `Q.draftStart + prefixLength + r`.

Coordinate unit, wherever a number remains:

- The unit is the JavaScript UTF-16 code unit, the same index used by `String.prototype.slice` and `indexOf`. It is not a Unicode code point and not a grapheme.
- An absolute offset indexes `draft.text`. A display-block offset indexes the spoken text.
- A compiler cut is a grapheme boundary from `Intl.Segmenter(undefined, { granularity: "grapheme" })`, which is also a scalar boundary. The stored number is still a UTF-16 index.
- Planned tests cover two utterances on one line, an utterance and an action on one line, a context note and dialogue on one line, one utterance spanning lines, Cyrillic, an emoji surrogate pair, `е` plus U+0308, CRLF, and a whitespace-only gap. Exactly two occurrences of one quote, each owned by one item in draft order, is one assignment. `Да Да Да` with two items quoting `Да` is `ambiguous-anchor`. A period left outside every quote is `invalid-coverage`. Joining segments and separators must equal the draft.

## Overflow transformation

Stage returns one frame per utterance. That frame's dialogue reference is the whole spoken text derived from the accepted slice. The model does not say whether the text fits and does not emit fit offsets.

`compileOverflow` creates any additional consecutive frames:

- If the whole quote fits, the Stage id is kept and `fontSize` is the largest fitting ladder size.
- If it does not fit at the minimum size, the compiler binary-searches the longest grapheme prefix that fits at that minimum. A shorter grapheme prefix is assumed to fit when a longer one fits. It then retreats to the latest whitespace grapheme boundary inside that prefix when the prefix before that boundary is non-empty. The whitespace stays at the end of the earlier block. Nothing is inserted or dropped.
- Pieces replace the Stage frame in place. Ids are `${stageId}#1` through `${stageId}#N` when `N > 1`. Stage ids cannot contain `#`.
- Array order after that replacement is the only order. There is no `order` field.
- Each piece stores a half-open UTF-16 range `[start, end)` relative to the spoken text. Concatenation equals that spoken text.
- Composition copied onto every ordinary overflow piece is `layout`, panel descriptions, and `speakerPanel`. `fontSize` is chosen again for each piece, so a short tail may use a larger size. `origin` stays `source`.

Two exceptions are not fit decisions:

- A source-authored action, context, or note is its own source item. The compiler does not split across source items and does not copy an utterance composition onto an action or derived frame.
- `directingBeat: true` supplies two or more `segments`. Each `quote` is a non-authoritative copy. The quotes must be the unique exact partition of the spoken text: ordered, non-overlapping, no gap, and concatenation equal to that spoken text. The server records the relative ranges. Adjacent segments must differ in layout, `speakerPanel`, or panel description. The frame's own layout, panels, and `speakerPanel` must equal the first segment. A quote that does not resolve, or a partition with more than one assignment, is `invalid-directing-beat`. The compiler measures each segment and, if a segment still overflows, splits that segment while copying that segment's composition.

A single grapheme that does not fit at the minimum size is `invalid-display-block`. The page does not show a ready storyboard.

## Validation

Schema validation runs before fidelity. A schema failure is only `failed` / `invalid-output`. It is not also a block code. `schema-invalid` is not a failure code.

The blocked codes and the provider failure kinds are normative in [contracts/storyboard-api.md](./contracts/storyboard-api.md). Fidelity checks collect every applicable code for that response. They do not run when the schema has already failed.

`unresolved` is schema-valid and blocks with `unresolved-speaker` before Stage. An utterance with speaker status `none`, or a non-utterance that carries a label, fails the schema and is `invalid-output`.

A derived frame cannot carry a dialogue reference. Its placement is a gap in the ordered source-item list, including context and notes, as defined in the contract. A new factual claim inside a panel description is not something this checker can prove. Spoken text on a derived frame is rejected by the schema.

## Provider configuration

Configuration is server-side and per function. The initial baseline is replaceable and is not a correctness assumption.

| Function | Model variable | Reasoning variable | Initial value |
|---|---|---|---|
| Interpret | `INTERPRET_MODEL` | `INTERPRET_REASONING_EFFORT` | `gpt-5.5`, `low` |
| Stage | `STAGE_MODEL` | `STAGE_REASONING_EFFORT` | `gpt-5.5`, `medium` |

If a function model variable is unset or blank, that function uses `CONTEST_MODEL`. If both are blank, the request is `failed` / `configuration` and the provider is not called. The tracked `.env.example` value of `CONTEST_MODEL` is `gpt-5.5`, so the initial baseline does not need extra variables.

Each call sends that function's `model` and `reasoning_effort`. The spike accepted both levels and could not show that they changed behavior. Tests assert the configured values were sent. They do not assert a behavioral difference.

Optional `INTERPRET_MAX_COMPLETION_TOKENS` and `STAGE_MAX_COMPLETION_TOKENS` add `max_completion_tokens` to that function only. The application does not send `max_tokens`. Optional `INTERPRET_REQUEST_JSON` and `STAGE_REQUEST_JSON` may add other fields to that function. If those objects contain `model`, `messages`, `response_format`, `reasoning_effort`, `max_completion_tokens`, or `max_tokens`, those keys are dropped. The application does not read `CONTEST_REQUEST_JSON`.

Shared environment: `BASE_URL`, `CONTEST_API_TOKEN`, and optional `CONTEST_TIMEOUT_MS` (default 120000). The same `node --env-file-if-exists=.env.local` mechanism as the spike may supply them. Both functions use `response_format: { "type": "json_object" }`.

Completion classification, including a missing or non-`stop` `finish_reason`, truncation, timeout, non-2xx responses, and invalid JSON, is defined in the contract. Stage is not called after an Interpret failure or block. A truncated completion is not continued.

## Prompt ownership

Version-controlled prompts live at:

- `app/storyboard-web/prompts/interpret.md`
- `app/storyboard-web/prompts/stage.md`

`interpret.mjs` and `stage.mjs` read those files into the system message. They do not read `prompts/01-writer.md`, `prompts/02-editor.md`, `prompts/03-director.md`, `prompts/04-reviewer.md`, or any other historical role prompt. The browser never receives the prompt files.

## HTTP safety

`server.mjs` serves only this exact pathname map:

| Method and path | File |
|---|---|
| `GET /` | `app/storyboard-web/public/index.html` |
| `GET /app.js` | `app/storyboard-web/public/app.js` |
| `GET /app.css` | `app/storyboard-web/public/app.css` |
| `GET /overflow.mjs` | `app/storyboard-web/overflow.mjs` |
| `GET /frame-renderer.mjs` | `prototypes/storyboard-viewer/frame-renderer.mjs` |
| `GET /viewer.css` | `prototypes/storyboard-viewer/viewer.css` |
| `GET /visual-anchors.mjs` | `app/storyboard-web/public/visual-anchors.mjs` |
| `GET /character-anchors/putin.png` | `app/storyboard-web/public/character-anchors/putin.png` |
| `GET /character-anchors/durov.png` | `app/storyboard-web/public/character-anchors/durov.png` |
| `GET /character-anchors/peskov.png` | `app/storyboard-web/public/character-anchors/peskov.png` |
| `POST /api/storyboard` | the storyboard handler |

Any other pathname is 404, including encoded `..` and backslashes. The request path is not appended to a directory. `app.css` loads after `viewer.css` and may reset page-level `body` presentation. It must not override `.frame-canvas`, `.panel-strip`, `.panel`, `.panel-description`, `.dialogue-bar`, `.dialogue-cell`, or `.dialogue-text`.

Wrong method is 405 with an `Allow` header. `POST /api/storyboard` requires `Content-Type` `application/json` or `application/json; charset=utf-8`; otherwise 415. Malformed JSON, or a body that is not an object with a string `draft`, is 400 `{ "status": "failed", "kind": "invalid-request" }`.

The operational body ceiling is `STORYBOARD_MAX_BODY_BYTES`, default 262144. The server stops reading past that size, and a larger `Content-Length` is rejected before the rest of the body is read. The response is 413. This ceiling protects the local process. It is not the still-open external-user product input limit, and this feature does not choose that limit.

## Testing

See [quickstart.md](./quickstart.md).

- Offline provider tests record `/v1/chat/completions`, `json_object`, per-function `model`, per-function `reasoning_effort`, and `max_completion_tokens` when a limit is configured. They cover `finish_reason` missing, `length`, and a value other than `stop`, plus timeout, non-2xx, invalid JSON, and schema failure. They assert no second Stage request after truncation or after an Interpret failure.
- Schema tests compile both contracts with Ajv strict mode and cover the speaker, panel-count, derived-frame, and directing-segment combinations.
- Anchor tests cover several items on one line, an item that spans lines, ambiguous repeated text, Cyrillic, emoji, combining characters, CRLF, and whitespace-only gaps.
- Fidelity tests seed one defect at a time for the blocked codes in the contract.
- Overflow tests use the injected measurer, not a DOM layout stub.
- Renderer structure tests use a DOM stub and do not assert fit. A CSS source test locks the measurement declarations.
- HTTP tests cover the allowlist, wrong method, wrong content type, malformed JSON, and the body ceiling.
- The local demo pastes a synthetic fixture and opens the last frame only after the loading state ends. The owner's reference dialogue is a manual paste and is not committed.
- No live provider call is in the default test command.

## Complexity Tracking

No constitution violations.

## Risks and assumptions

- Real fit is a browser layout result. Node tests prove the compiler's decisions against an injected oracle, not Arial line wrapping. A visual check of the local demo is still required to see that a long line does not clip.
- `fontSizeFor` remains only so the existing prototype keeps its current size heuristic when `fontSize` is absent.
- `reasoning_effort` is sent and is not treated as proof of reasoning behavior. The spike left that effect unresolved. The spec does not make the effect a requirement.
- The derived-beat checker can reject dialogue, a missing anchor, and a bad origin. It cannot certify that a panel description adds no new fact.
- The external-user product input limit remains open. 262144 bytes is only the local operational ceiling.
- Large strict `json_schema` is not used. Stage is `json_object` plus local schemas.
- Two-panel layouts only. A wrong panel count fails the schema.
- The historical validator remains the video-pipeline check. It is not this feature's fidelity suite.
