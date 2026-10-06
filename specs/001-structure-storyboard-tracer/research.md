# Research: Read-only Structure Storyboard Tracer

Decisions for this feature only. No new dependency is required. Decisions superseded by this correction are listed at the end and are not the plan.

## Decision: Node built-in HTTP and a static page

- Decision: Serve one page and one JSON endpoint with `node:http`. The page is ordinary HTML, CSS, and JavaScript. Schema checks use the `ajv` package already in the repository, compiled in strict mode through `ajv/dist/2020.js`. Tests use `node:test`.
- Rationale: The repository is already a Node ESM project with no web framework. This feature is one paste, one wait, and one read-only storyboard.
- Alternatives considered: Express or Fastify add a dependency for a single route. A React or other UI framework would duplicate the existing renderer page instead of reusing it.

## Decision: Stable application directory `app/storyboard-web`

- Decision: Put this feature in `app/storyboard-web/`. Later features extend that directory. The renderer remains at `prototypes/storyboard-viewer/frame-renderer.mjs` and is imported, not copied.
- Rationale: The repository has no application directory and no prior stable app name. This tracer is the first thin feature of the production web application, so its directory must survive the next feature. Historical `prompts/`, `tools/`, `schema/`, `evals/`, and `spikes/` stay outside it.
- Alternatives considered: `app/tracer/` would name the directory after this first feature and invite a later replacement. Extending `tools/run.mjs` would couple the page to the old role topology. Importing the contest spike as the provider would turn a probe into application code.

## Decision: One canonical renderer module

- Decision: Replace the browser IIFE `frame-renderer.js` with `frame-renderer.mjs`. The module exports geometry, the font ladder, `render`, and `measureDialogue`, and assigns `window.FrameRenderer` in the browser. The prototype loads `viewer.js` as a module whose first statement imports the renderer. `storyboard-data.js` stays a classic script. `frame-renderer.js` is deleted in that change.
- Rationale: Node tests and the application cannot import an IIFE. A second file that repeats the width, bar height, gutter, or padding would be a second geometry implementation. The prototype keeps `window.FrameRenderer.render` and its current `fontSizeFor` fallback.
- Alternatives considered: A build step to bundle the IIFE is a new toolchain. Leaving the IIFE and reimplementing geometry in the app duplicates the measurements. Loading the renderer twice, once as a classic script and once as ESM, would execute two copies.

## Decision: Browser measurement, then a pure compiler

- Decision: `fontSizeFor` remains a length-to-size map for prototype frames that have no `fontSize`. It is not an overflow detector. Fit is `measureDialogue` on a real rendered cell. `overflow.mjs` selects the largest ladder size and splits at grapheme boundaries by calling an injected measurer. The page stays in loading until that compiler finishes. Node tests supply a boolean oracle and do not pretend a DOM stub performs layout.
- Rationale: The fixed dialogue box depends on Arial, weight, letter-spacing, line-height, padding, and `overflow-wrap: anywhere`. Character counts cannot establish that the text fits. A DOM stub's `scrollHeight` is not that layout either. No new layout package is available on the server.
- Alternatives considered: Treating the current font steps as capacity would repeat the present gap. Measuring with a canvas `measureText` port would be a second typography implementation and would still miss CSS wrapping. Running a headless browser in the default test suite would add a package and a live UI dependency.

## Decision: Server-created segments, not model offsets

- Decision: The server splits the draft into segments and separators before Interpret. The model references segment ids and, for an utterance, an exact quote. The server checks that the quote occurs once and equals the segment slice, with one explicit-label prefix exception. Display-block numbers are produced later by the compiler and are UTF-16 indexes into that quote.
- Rationale: A model-calculated offset is not a reliability mechanism. The spike showed a schema-valid storyboard can still differ by about 100 characters. Server-owned segments are lossless because joining them with their separators reproduces the draft.
- Alternatives considered: Trusting model `start` and `end` leaves bounds, surrogate pairs, and CRLF as unexplained model arithmetic. Asking the model for line numbers without a server segment list has the same problem. Trusting a model dialogue string when it happens to match is still model-authored wording.

## Decision: Stage returns one frame; the compiler splits

- Decision: Stage emits one frame whose dialogue reference is the whole utterance. `compileOverflow` creates consecutive frames when the minimum ladder size still overflows. Those frames copy layout, panel descriptions, and `speakerPanel`. A source-authored neighbor stays its own frame. A directing beat may partition the utterance into quotes with different compositions; the compiler still measures each quote.
- Rationale: The model must not decide whether text physically fits. The spec requires exact reconstruction and stable composition unless a source-authored or directing beat justifies a change.
- Alternatives considered: Letting Stage emit fit offsets makes the model the fitter. Splitting only in CSS with `overflow: hidden` hides the tail. Asking for a second completion to repair a long line is a repair loop.

## Decision: Interpret is its own model call

- Decision: Inside one browser request, the server first calls Interpret, then calls Stage. Both use `POST /v1/chat/completions` and `response_format: { "type": "json_object" }`. An explicit output limit uses `max_completion_tokens` on that function only.
- Rationale: The spec allows a preceding interpretation step and does not require the two steps to share a call. Separate calls keep source-item boundaries away from the storyboard completion. The Stage payload is still one completion and is not chunked.
- Alternatives considered: One combined call makes the model the author of both the source reading and the frames. Skipping Interpret and asking Stage to return offsets is weaker at distinguishing source items from derived beats.

## Decision: Schema failure is not a fidelity block

- Decision: Malformed provider JSON, a non-object completion, truncation, a missing or non-`stop` `finish_reason`, and Ajv schema failure are `failed` / `invalid-output` and use the non-200 response in the contract. A schema-valid result that fails source fidelity is HTTP 200 `blocked`. `schema-invalid` is not a code. There is no continuation and no repair loop.
- Rationale: The previous plan listed schema failure both as a block code and as invalid output. Those are different user states. The spike's `finish_reason=length` result is truncation, not a storyboard.
- Alternatives considered: Returning 200 for unusable provider output would look like a reviewed block. Retrying a truncated Stage completion would add the repair loop the spec excludes.

## Decision: Per-function model configuration

- Decision: Interpret uses `INTERPRET_MODEL` and `INTERPRET_REASONING_EFFORT`, initially `gpt-5.5` and `low`. Stage uses `STAGE_MODEL` and `STAGE_REASONING_EFFORT`, initially `gpt-5.5` and `medium`. A blank function model falls back to `CONTEST_MODEL`. Extra body JSON is per function and cannot override model, messages, response format, reasoning, or the output limit. The application does not read `CONTEST_REQUEST_JSON`.
- Rationale: The accepted implementation baseline assigns model and reasoning level by function. One shared extra-body variable cannot express two levels. The spike accepted both reasoning values and did not show that they changed behavior, so the values are configuration, not a correctness assumption.
- Alternatives considered: One `CONTEST_MODEL` plus one `CONTEST_REQUEST_JSON` would force both functions onto the same reasoning level. Omitting `reasoning_effort` would drop the baseline. Treating the level as proof of quality would contradict the spike.

## Decision: Prompts belong to the application

- Decision: Interpret and Stage prompts are `app/storyboard-web/prompts/interpret.md` and `app/storyboard-web/prompts/stage.md`. The server reads those files. It does not reuse the historical Writer, Editor, Director, or Reviewer prompts.
- Rationale: Those historical prompts are a different topology. The spec excludes restoring that role sequence. Prompt text has to be version-controlled with the application that sends it.
- Alternatives considered: Embedding the prompts only in code makes review harder. Pointing the new functions at `prompts/01-writer.md` through `prompts/04-reviewer.md` would revive the excluded topology.

## Decision: Operational HTTP ceiling, not a product input limit

- Decision: The server allowlists files, rejects the wrong method and content type, rejects malformed JSON, and stops at `STORYBOARD_MAX_BODY_BYTES` (default 262144) with HTTP 413. That number is a local process ceiling. The external-user product input limit stays open and is not decided here.
- Rationale: A `node:http` process should not read an unbounded body or map the URL onto the filesystem. Choosing the product's external paste limit would invent a product policy this feature does not have.
- Alternatives considered: No ceiling leaves the process exposed to a huge local post. Treating 262144 as the product rule would close an open question without an owner decision.

## Decision: The browser holds the session

- Decision: The page sends the draft and keeps the result in memory. The server stores nothing after the response. Refreshing the page discards the draft.
- Rationale: The feature forbids persistence, PostgreSQL, accounts, and private links.
- Alternatives considered: An in-memory session id survives only until restart and is still a session store this feature does not need.

## Decision: Default tests do not call the provider

- Decision: The default suite uses a fake chat-completions adapter. A live smoke command may exist later and stays out of the default suite until it is explicitly approved.
- Rationale: The spike already recorded live compatibility. Repeating it in ordinary tests spends the contest quota and needs credentials.
- Alternatives considered: A recorded HTTP fixture of the real provider response would freeze one unfaithful completion and is not a substitute for the deterministic checks.

## Superseded

- `app/tracer/` as the application directory. Replaced by `app/storyboard-web/`.
- `fitDialogue` exported from the IIFE, and any description of `fontSizeFor` as a capacity test. Replaced by browser `measureDialogue` plus `compileOverflow`.
- Model-authored draft offsets as the anchoring mechanism. Replaced by server segments and exact quotes.
- `schema-invalid` as a blocked code, and one `CONTEST_REQUEST_JSON` object for both functions. Replaced by the failure split and per-function configuration in the contract.
