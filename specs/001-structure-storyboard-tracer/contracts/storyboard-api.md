# Contract: storyboard HTTP API

One browser request. The server performs Interpret and then Stage. The browser does not receive the provider token, base URL, model name, reasoning level, or prompt text.

Model payloads are validated with Ajv strict mode against:

- [interpret-response.schema.json](./interpret-response.schema.json)
- [stage-response.schema.json](./stage-response.schema.json)

Those schemas contain no numeric offsets and no dialogue strings. A schema failure is `failed` / `invalid-output`. It is not a blocked code. There is no `schema-invalid` code.

## `POST /api/storyboard`

Request:

```json
{ "draft": "string, the pasted text" }
```

The page treats only `status: "checked"` as input to fitting. It shows `ready` only after the overflow compiler succeeds. `checked` is not a ready storyboard.

Responses:

- `200` and `{ "status": "checked", "draft": "...", "sourceItems": [], "frames": [], "review": [] }` when schema validation and source fidelity both pass. `frames` follows Stage array order. Each `dialogue` string is a server slice of `draft`. Display-block ranges are utterance-relative UTF-16 indexes. `fontSize` is omitted. The page is still loading.
- `200` and `{ "status": "blocked", "failures": [{ "code": "string", "sourceItemId": "optional" }] }` when a deterministic source check fails. `frames` is omitted. The checker returns every applicable code for that result.
- `400` and `{ "status": "failed", "kind": "invalid-request" }` when the JSON is malformed or `draft` is not a string.
- `413` when the body exceeds `STORYBOARD_MAX_BODY_BYTES` (default 262144). This is the operational ceiling, not the open product input limit.
- `415` when `Content-Type` is not `application/json` or `application/json; charset=utf-8`.
- `405` when the method is not `POST`. The response includes `Allow: POST`. `405`, `413`, and `415` have no storyboard JSON body. The page shows a failure and no frames.
- `500` and `{ "status": "failed", "kind": "configuration" }` when required server configuration is missing. The provider is not called.
- `502` and `{ "status": "failed", "kind": "provider" }` when the provider connection fails or the HTTP status is not 2xx.
- `502` and `{ "status": "failed", "kind": "invalid-output" }` when a 2xx completion is unusable, truncated, or fails the local schema.
- `504` and `{ "status": "failed", "kind": "timeout" }` when `CONTEST_TIMEOUT_MS` elapses.

The page uses one additional failure that has no HTTP response: `{ "status": "failed", "kind": "measurement" }` when the browser cannot lay out the measurement host. That state is not shown as ready.

### Blocked codes

| Code | When it is used |
|---|---|
| `empty-draft` | No non-empty server segment. The provider is not called. |
| `duplicate-id` | Two source items or two Stage frames share an id. |
| `invalid-coverage` | Segment ids are unknown, non-contiguous, overlapping, out of order, or leave a non-empty segment uncovered. |
| `invalid-anchor` | An utterance quote is missing from its slice, or it is not the whole slice and not the one allowed explicit-label prefix. |
| `ambiguous-anchor` | An utterance quote occurs more than once in its slice. |
| `invalid-speaker-label` | An explicit label is not an exact substring of the item slice. |
| `unresolved-speaker` | An utterance has speaker status `unresolved`. Stage is not called. |
| `unknown-source-item` | A frame, anchor, or review id does not match a source item. |
| `invalid-source-role` | A frame's `sourceRole` does not match that source item's kind. |
| `unaccounted-source-item` | An utterance or action has no frame, or a context or note is missing from `review`. |
| `invalid-derived-beat` | A derived frame's anchors are not exactly the nearest surrounding source items. |
| `invalid-directing-beat` | Directing quotes do not partition the utterance, adjacent segments share a composition, or the frame composition differs from the first segment. |
| `lost-dialogue` | Part of an accepted utterance quote is absent from the display blocks. |
| `duplicated-dialogue` | The same utterance span is shown twice. |
| `reordered-dialogue` | Display blocks or source items are out of draft order. |
| `changed-wording` | Concatenated display blocks differ from the accepted quote. |
| `invalid-display-block` | Ranges overlap, leave a gap, leave the quote, split a grapheme, or a single grapheme does not fit at the minimum size. |

Speaker combinations, panel counts, `speakerPanel`, and the absence of dialogue on a derived or action frame are schema constraints. When they fail, the response is `502` `invalid-output`, not one of the codes above.

### Accounting

Checked on the Stage payload, before overflow compilation:

- An utterance is accounted for by exactly one frame with `sourceRole: "utterance"`.
- An action is accounted for by exactly one frame with `sourceRole: "action"`. The HTTP frame carries `outsideFrameText` from that action's server slice. The renderer does not paint it.
- A context or note is accounted for by exactly one id in Stage `review`. The HTTP `review` array is `{ sourceItemId, kind, text }` with `text` sliced by the server.
- Utterance and action ids do not appear in `review`. Context and note ids do not appear as frame source ids.

After compilation, that one utterance frame may be several consecutive frames. They share its `sourceItemId`, and their display blocks partition the quote. That is still one account. It is `duplicated-dialogue` only when a span is repeated. The page runs `lost-dialogue`, `duplicated-dialogue`, `reordered-dialogue`, `changed-wording`, and `invalid-display-block` on the compiler output and can show `blocked` without another HTTP request. The server also runs those codes on the pre-fit frames.

### Derived anchors

For a derived frame, walk the Stage array. The predecessor is the nearest `origin: "source"` frame before it. The successor is the nearest one after it. Derived frames are skipped. The anchor list is exactly those neighbors' `sourceItemId` values. At least one neighbor must exist. If both exist, both ids are required.

### Checked frame shape

Dialogue frame, before overflow compilation:

- `dialogue` is the accepted quote.
- `displayBlock` is `{ sourceItemId, start: 0, end: quote.length }` in UTF-16 units, unless directing segments already carry server-computed ranges that partition that quote.
- `speakerPanel` is present.
- `fontSize` is absent.

Action frame: `dialogue` is `""`, `outsideFrameText` is the action slice, and `speakerPanel` is absent.

Derived frame: `dialogue` is `""`, anchors are present, and `speakerPanel` is absent.

After compilation, split pieces use `${id}#1` … `${id}#N`, relative display-block ranges, and a `fontSize` from the ladder in the plan. Concatenation of the pieces equals the quote.

## Provider request

Server only. One `POST {BASE_URL}/v1/chat/completions` for Interpret, then one for Stage. No retry, no continuation, and no repair request.

### Per-function configuration

| Variable | Use |
|---|---|
| `BASE_URL` | Required shared host. |
| `CONTEST_API_TOKEN` | Required. Sent only as `Authorization: Bearer`. |
| `CONTEST_TIMEOUT_MS` | Optional positive integer. Default 120000. |
| `CONTEST_MODEL` | Fallback model name when a function model is blank. |
| `INTERPRET_MODEL` | Interpret model. Blank falls back to `CONTEST_MODEL`. Initial baseline `gpt-5.5`. |
| `INTERPRET_REASONING_EFFORT` | Default `low`. |
| `STAGE_MODEL` | Stage model. Blank falls back to `CONTEST_MODEL`. Initial baseline `gpt-5.5`. |
| `STAGE_REASONING_EFFORT` | Default `medium`. |
| `INTERPRET_MAX_COMPLETION_TOKENS` | Optional. Sends `max_completion_tokens` on Interpret only. |
| `STAGE_MAX_COMPLETION_TOKENS` | Optional. Sends `max_completion_tokens` on Stage only. |
| `INTERPRET_REQUEST_JSON` | Optional JSON object merged into the Interpret body. |
| `STAGE_REQUEST_JSON` | Optional JSON object merged into the Stage body. |

The application does not read `CONTEST_REQUEST_JSON` and does not send `max_tokens`. Keys `model`, `messages`, `response_format`, `reasoning_effort`, `max_completion_tokens`, and `max_tokens` inside a function extra object are dropped. `response_format.type` is `json_object` for both functions.

`reasoning_effort` is configuration. The compatibility spike accepted `low` and `medium` and did not show a behavioral difference. Tests check that the configured value was sent. Correctness does not depend on the provider applying it.

Environment comes from the process, including `node --env-file-if-exists=.env.local`. The page never loads `.env.local`.

### Completion classification

Apply this to each function independently. Stage is not started when Interpret is `failed` or `blocked`.

| Observation | Kind | HTTP |
|---|---|---|
| Abort from the timeout | `timeout` | 504 |
| `fetch` throws | `provider` | 502 |
| HTTP status outside 200–299 | `provider` | 502 |
| 2xx body is not JSON | `invalid-output` | 502 |
| `choices[0]` is missing | `invalid-output` | 502 |
| `finish_reason` is missing | `invalid-output` | 502 |
| `finish_reason` is `length` | `invalid-output` | 502 |
| `finish_reason` is present and is not `stop` | `invalid-output` | 502 |
| `finish_reason` is `stop` but `message.content` is not a JSON object | `invalid-output` | 502 |
| `finish_reason` is `stop`, JSON parses, Ajv rejects it | `invalid-output` | 502 |
| Schema accepts it and fidelity fails | blocked code | 200 |
| Schema accepts it and fidelity passes | `checked` | 200 |

A `length` finish does not start another request. Markdown wrapped around JSON is `invalid-output`. Only `choices[0]` is read.

## Source coordinates

Interpret and Stage model JSON do not carry offsets. Server and compiler offsets use JavaScript UTF-16 code units.

- Absolute offsets index `draft.text`.
- Display-block offsets index the accepted utterance quote.
- `quote.draftStart + relative` is valid because the quote is a contiguous draft slice.
- Compiler cuts are grapheme boundaries from `Intl.Segmenter(undefined, { granularity: "grapheme" })`. Those boundaries are also scalar boundaries, so a cut never falls inside a surrogate pair. The stored index is still UTF-16.
- Tests include Cyrillic, an emoji surrogate pair, a combining character, and CRLF.

## HTTP file safety

`GET` serves only:

| Path | File |
|---|---|
| `/` | `app/storyboard-web/public/index.html` |
| `/app.js` | `app/storyboard-web/public/app.js` |
| `/app.css` | `app/storyboard-web/public/app.css` |
| `/overflow.mjs` | `app/storyboard-web/overflow.mjs` |
| `/frame-renderer.mjs` | `prototypes/storyboard-viewer/frame-renderer.mjs` |
| `/viewer.css` | `prototypes/storyboard-viewer/viewer.css` |

Every other path is 404. The pathname is an exact map key, not a filesystem suffix. Wrong method on a file path is 405 with `Allow: GET`.

## Prompts

The server loads `app/storyboard-web/prompts/interpret.md` and `app/storyboard-web/prompts/stage.md` itself. Those paths are not HTTP routes. The historical files under `prompts/` are not read.
