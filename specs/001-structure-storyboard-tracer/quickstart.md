# Quickstart: Read-only Structure Storyboard Tracer

Validation guide for after implementation. This plan does not add those commands yet.

## Preconditions

- Repository root, Node 24, dependencies already installed (`ajv` is present).
- Do not create a database or a container.
- Default checks do not read `.env.local` and do not call the provider.
- The application directory is `app/storyboard-web/`. Do not look for `app/tracer/`.

## Default checks

From the repository root, once the application exists:

```sh
node --test app/storyboard-web/test/**/*.test.mjs
```

Expected:

- Fake provider tests cover HTTP `checked`, `blocked`, timeout, non-2xx `provider`, and `invalid-output`.
- Provider tests record `/v1/chat/completions` and `response_format.type === "json_object"`.
- Interpret requests use `INTERPRET_MODEL` or, when that variable is blank, `CONTEST_MODEL`, and `reasoning_effort: "low"` unless `INTERPRET_REASONING_EFFORT` is set.
- Stage requests use `STAGE_MODEL` or the same `CONTEST_MODEL` fallback, and `reasoning_effort: "medium"` unless `STAGE_REASONING_EFFORT` is set.
- When a function max-token variable is set, that request includes `max_completion_tokens` and omits `max_tokens`. When it is unset, the field is omitted.
- `CONTEST_REQUEST_JSON` is not read. `INTERPRET_REQUEST_JSON` and `STAGE_REQUEST_JSON` cannot replace `model`, `messages`, `response_format`, `reasoning_effort`, or the output-limit field.
- A missing `finish_reason`, `finish_reason: "length"`, any other non-`stop` reason, a non-object body, and an Ajv failure are `502` `invalid-output`. Truncation does not send a continuation. Interpret failure does not send Stage.
- Schema tests compile both files in `contracts/` with `ajv/dist/2020.js` and `strict: true`.
- Interpret fixtures accept `explicit`, `inferred`, and `unresolved` utterances, and accept `action`, `context`, and `note` only with speaker status `none` and no label. `explicit` and `inferred` without a non-empty label fail. Numeric offsets fail.
- Stage fixtures accept one panel for `single`, two panels for `split2`, a `speakerPanel` only on an utterance frame, no dialogue fields on an action or derived frame, and segments only when `directingBeat` is true.
- Those schema failures are `invalid-output`, not blocked codes. The suite has no `schema-invalid` code.
- Anchor tests use Cyrillic text, an emoji surrogate pair, `е` plus U+0308, and a draft containing `\r\n\n`. Joining server segments and separators equals the draft. A quote inside a surrogate pair or a repeated quote is blocked. A model `start` or `end` never becomes an offset.
- Fidelity tests each block one of: `empty-draft`, `duplicate-id`, `invalid-coverage`, `invalid-anchor`, `ambiguous-anchor`, `invalid-speaker-label`, `unresolved-speaker`, `unknown-source-item`, `invalid-source-role`, `unaccounted-source-item`, `invalid-derived-beat`, `invalid-directing-beat`, `lost-dialogue`, `duplicated-dialogue`, `reordered-dialogue`, `changed-wording`, and `invalid-display-block`.
- `unresolved-speaker` does not call Stage. Context and note ids are accounted for in `review`. Action text is reconstructed outside the frame. Derived anchors are the nearest source neighbors.
- Overflow tests import `compileOverflow` and pass a function `(text, options) => boolean`. They do not import a DOM stub for this check. A short utterance stays one block at the largest ladder size that the oracle accepts. An utterance the oracle rejects at the minimum size becomes consecutive blocks. Concatenation equals the quote. Ordinary blocks copy layout, panel descriptions, and `speakerPanel`. A directing segment that differs in composition keeps its own composition when it is split further. Ids are `${stageId}#1` onward, in array order.
- Renderer tests import `prototypes/storyboard-viewer/frame-renderer.mjs`. A DOM stub may assert that a split frame has two descriptions and dialogue in the speaker cell, and that an empty dialogue omits `.dialogue-bar`. The stub is not asked whether text fits. `measureDialogue` is not called in `node:test`.
- A CSS source test reads `viewer.css` and expects the dialogue font, line-height, letter-spacing, `overflow-wrap`, border-box, and dialogue-bar border declarations named in the plan.
- HTTP tests reject a path outside the allowlist, a wrong method, a non-JSON content type, malformed JSON, and a body larger than 262144 bytes. The oversized response is 413. The test does not describe that number as the product input limit.
- Prompt tests resolve the system-message files to `app/storyboard-web/prompts/interpret.md` and `app/storyboard-web/prompts/stage.md` and do not resolve them under the historical `prompts/` directory.

`npm run check` and `npm run mutations` stay the historical video-pipeline checks. They do not call the storyboard provider.

## Local demo

```sh
node --env-file-if-exists=.env.local app/storyboard-web/server.mjs
```

Open the printed local URL. Paste a synthetic Russian dialogue. The page stays in loading through HTTP `checked` until fitting finishes. A ready result shows a grid and a detail view, and the detail control can open the last frame. A blocked result shows the failure codes and does not label the frames ready. A provider or schema failure shows `failed` and no ready storyboard. The provider token never appears in the page or the response JSON.

Use a non-sensitive synthetic dialogue for the scripted demo. The owner's reference dialogue may be pasted by hand afterward; it is not copied into the repository fixtures.

Confirm by eye that a long utterance either uses a smaller ladder size or becomes consecutive frames, and that the panels do not move to make room for the text. The default `node:test` run does not perform that visual check.

## Live smoke

Not part of the default suite. Do not add or run it unless a later review approves one explicit command. That command would be separate from `node --test` and would use `.env.local`.
