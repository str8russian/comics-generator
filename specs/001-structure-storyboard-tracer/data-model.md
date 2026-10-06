# Data model: Read-only Structure Storyboard Tracer

Session-only values. Nothing here is written to a database. Exact wording lives only on the dialogue draft. Other objects point at it. Field names used in model JSON match [interpret-response.schema.json](./contracts/interpret-response.schema.json) and [stage-response.schema.json](./contracts/stage-response.schema.json). Failure codes match [storyboard-api.md](./contracts/storyboard-api.md).

## Dialogue draft

- `text`: the pasted string, unchanged.
- Authority: exact source wording and source order.
- Lifetime: the browser page. The server does not keep it after the response.
- Offsets into `text` are JavaScript UTF-16 code units.

## Server segment

Created before Interpret. The model does not invent segments or offsets.

- `id`: `seg-0`, `seg-1`, in scan order.
- `text`: the run between separators. Empty runs are included.
- `draftStart`, `draftEnd`: absolute UTF-16 offsets with `text === draft.text.slice(draftStart, draftEnd)`.
- A separator is `\r\n`, otherwise `\n`, otherwise `\r`. Separators are server-owned and are not source items.
- Joining segments and separators in order equals `draft.text`.

The model sees `{ id, text }` for each segment, including empty text.

## Source item

Ordered reading of the draft. Items are not lines. One item may list several segments. Several items may list the same segment.

- `id`: unique within the response. Pattern `^[A-Za-z0-9][A-Za-z0-9_-]*$`.
- `kind`: `utterance`, `action`, `context`, or `note`.
- `segmentIds`: one contiguous increasing range of known segment ids. This is the search window.
- `sourceQuote`: required for every kind. Non-authoritative exact copy of the item's source slice. It must contain a non-whitespace character. The server accepts it only through the assignment in [plan.md](./plan.md).
- `speakerStatus`:
  - `utterance`: `explicit`, `inferred`, or `unresolved`.
  - `action`, `context`, and `note`: `none`.
- `speakerLabel`: required and non-empty for `explicit` and `inferred`. Absent for `unresolved` and `none`.
- `draftStart`, `draftEnd`: absolute UTF-16 offsets of the accepted slice, recorded by the server. `draft.text.slice(draftStart, draftEnd) === sourceQuote`.
- `text`: for an utterance, the spoken text derived from that slice. For any other kind, the accepted slice. This is not a model field.

Spoken text:

- `explicit`: remove one leading `speakerLabel + ": "` if present, otherwise one leading `speakerLabel + ":"`. The removed label and delimiter remain inside the accepted slice. A slice that does not start with either prefix, or a remainder with only server-owned characters, is `invalid-speaker-label`.
- `inferred` and `unresolved`: spoken text equals the accepted slice. Nothing is removed.

An `unresolved` utterance is schema-valid and blocks before Stage. A speaker combination the schema rejects is unusable provider output, not a fidelity block.

Resolved spans are ordered and non-overlapping. Every code unit that is not a separator or horizontal whitespace is in exactly one span. The server-owned set is defined in [plan.md](./plan.md).

Source-authored actions stay `kind: "action"` when their frame is silent.

## Derived beat

Not a source item. One Stage frame:

- `origin: "derived"`.
- `placement`: `{ afterSourceItemId, beforeSourceItemId }`, with at least one id. The ids are source items of any kind, including `context` and `note`.
- The two ids, when both are present, are adjacent in the resolved source order: the before-item's index is the after-item's index plus one. The gap is immediately before the before-item.
- Only `beforeSourceItemId` means the beat is before the first source item, and that id must be the first item.
- Only `afterSourceItemId` means the beat is after the last source item, and that id must be the last item.
- No `sourceItemId`, `sourceRole`, `speakerPanel`, `segments`, or dialogue.
- In the frame array, a derived frame in the gap before source index `g` sorts before the source frame for an item at index `g` or later, and after every source frame for an earlier item. Several derived frames may share one gap; their array order is their order inside that gap. Skipping a context or note to anchor the rendered frames on either side is `invalid-derived-beat`.
- Panel descriptions are visual stand-ins. The checker does not prove that a description adds no new fact. It does reject a dialogue reference.

## Directing segment

Allowed only on one source utterance frame with `directingBeat: true`.

- `quote`: a non-authoritative exact slice of the spoken text. Together the quotes are the unique ordered partition of that spoken text.
- `layout`, `panels`, `speakerPanel`: that segment's composition.
- Adjacent segments differ in layout, speaker panel, or panel description.
- The frame's own composition equals the first segment.
- The server, not the model, records the quote's relative `[start, end)`.

A directing segment is a composition change. It is not a fit decision. The overflow compiler still measures it.

## Display block

A visible piece of one utterance quote. The compiler creates it. The model does not.

- `sourceItemId`: an utterance id.
- `start`, `end`: half-open UTF-16 indexes into that utterance's spoken text, not into the draft and not into a model copy. Both ends are grapheme boundaries.
- The wire object is `{ sourceItemId, start, end }`. The frame that shows it is the containing frame's `id`, not a second field.
- Blocks that share an utterance are ordered. Concatenating their slices equals that spoken text.
- Absolute draft position is `sourceItem.draftStart + prefixLength + start`. `prefixLength` is the excluded explicit label prefix, or `0` when nothing was excluded.

## Structure frame

What the review page can render. Stage array order is the story order. The compiler may replace one utterance frame with consecutive frames in that same position. Final array order is authoritative. There is no `order` field.

Stage model fields:

- `id`. Unsplit frames keep it. Split frames become `${id}#1` … `${id}#N`.
- `layout`: `single` or `split2`.
- `panels`: exactly one description for `single`, exactly two for `split2`.
- `origin`: `source` or `derived`.
- `sourceItemId` and `sourceRole` on a source frame only. `sourceRole` is `utterance` or `action` and must match that source item's kind.
- `speakerPanel`: required for an utterance frame. It is `0` for `single` and `0` or `1` for `split2`. Absent for an action frame and for a derived frame.
- `placement` on a derived frame only.
- `directingBeat` and `segments` on a directing utterance frame only.
- `review`: the Stage array of context and note ids that are not frames. It does not contain utterance or action ids.

Server fields added on the HTTP `checked` payload, then updated by the compiler:

- `dialogue`: the reconstructed quote piece, or `""` when the frame is silent.
- `displayBlock`: present on dialogue frames.
- `fontSize`: absent until the compiler selects a ladder size.
- `outsideFrameText`: the reconstructed action slice, shown by the page outside the canvas. The renderer does not draw it. The frame reference is the account; this string is not a second account.

The object passed to `FrameRenderer.render` is the frame plus `mode: "structure"`. Image fields are absent. Empty `dialogue` omits the dialogue bar and lets the panel strip fill the frame.

Composition copied across ordinary overflow pieces is `layout`, panel descriptions, and `speakerPanel`. `fontSize` is per piece.

## Review metadata

Context and notes are not frames. Stage `review` lists their source-item ids in resolved source order. Any other order is `reordered-review`. The HTTP payload expands each id to `{ sourceItemId, kind, text }` using the accepted slice, in that same order.

Every source item is accounted for exactly once on the Stage payload:

- an utterance by one dialogue frame, which the compiler may expand into consecutive frames that partition that quote;
- an action by one silent source frame, whose text is also shown outside the frame;
- a context or note by one `review` entry.

A missing account is `unaccounted-source-item`. An id that does not exist is `unknown-source-item`.

## Result

- `checked`: HTTP 200. Schema valid and source fidelity passed. Every dialogue frame still refers to a whole utterance or to directing segments of that utterance. The page must not show this as ready.
- `ready`: page state only, after overflow compilation. The last frame is reachable. The server does not return this status.
- `blocked`: HTTP 200 and a failure list. The page must not render those frames as a ready storyboard.
- `failed`: unusable request, configuration, provider, timeout, measurement, or provider output. Distinct from a fidelity block.

Page sequence: `draft pasted → loading → ready | blocked | failed`. A `checked` response stays in loading until fitting finishes. Refresh returns to an empty draft. There is no undo and no saved revision.
