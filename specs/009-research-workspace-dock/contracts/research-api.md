# Contract: research HTTP API

Local owner-research evidence only. Routes do not take a project id. Responses and operational logs never include credentials, secret-bearing URLs, raw provider responses, image bytes, or data URLs.

Existing sanitized lifecycle/`logVisual` allowlists remain unchanged. Research routes must not write `submitted_text`, draft text, instructions, or notes into `logLine`.

Normative event fields: [research-event.schema.json](./research-event.schema.json). Persistence rules: [../data-model.md](../data-model.md).

## Shared failures

| HTTP | Body | When |
| --- | --- | --- |
| 400 | `{ "status": "failed", "kind": "invalid-request" }` | Malformed JSON, unknown `event_kind` / `semantic_action`, forbidden fields present, oversize text, bad correlation rules |
| 413 | empty | Body larger than server max |
| 415 | empty | JSON content type required |
| 503 | `{ "status": "failed", "kind": "database" }` | Insert/select failed after startup; driver message not copied |
| 500 | `{ "status": "failed", "kind": "configuration" }` | Research store unavailable because database was not configured (same class as other stores) |

No automatic retry. Clients keep unsaved Notes draft text on note-save failure.

## Forbidden request fields (structural exclusion)

Requests that include any of the following keys (any nesting) are `400 invalid-request` and must not be partially stored:

- `image`, `bytes`, `imageBytes`, `performanceImageDataUrl`, `dataUrl`, `dataURL`
- `authorization`, `token`, `apiKey`, `DATABASE_URL`
- `providerResponse`, `rawResponse`, `messages`, `prompt`, `headers`
- generic `requestBody` / `responseBody` dumps

Image/data-URL material for identity/panel performance continues to travel only on existing product routes and is never copied into research events.

## `POST /api/research/notes`

Creates exactly one `note` event.

Request:

```json
{
  "id": "uuid-optional",
  "submittedText": "owner observation",
  "context": { "...fixed keys...": null }
}
```

Success 201:

```json
{
  "event": { "...stored note event including seq, occurredAt..." }
}
```

Failure: shared table; Notes draft remains in the browser.

Operational log for this route (if any) may include only allowlisted metadata such as `event=research-note`, `status`, `http`, `kind` — never note text.

## `POST /api/research/events`

Appends one `action_start` or `action_terminal` event.

Request:

```json
{
  "id": "uuid-optional",
  "eventKind": "action_start",
  "semanticAction": "structure_edit",
  "correlationId": "uuid-required",
  "surface": "dock_commands",
  "submittedText": "optional instruction or null",
  "commandTarget": { "kind": "storyboard", "displayFrameNumber": null, "displayFrameId": null, "structureFrameId": null, "structureSegmentIndex": null, "panelIndex": null },
  "context": { "...fixed keys...": null },
  "outcome": null,
  "outcomeKind": null,
  "outcomeFlags": {}
}
```

Terminal request sets `eventKind: "action_terminal"`, requires `outcome`, and may omit `submittedText` (text belongs on the start row when present). Server computes `durationMs` when the matching start exists; if start is missing, `durationMs` is null and the terminal still stores (interrupted/out-of-order evidence without recovery).

Success 201: `{ "event": { ... } }`

## `GET /api/research/trace`

Returns the complete ordered trace for local machine-readable extraction (no polished export UI).

Success 200:

```json
{
  "events": [ { "...event...": "ordered by seq ascending" } ]
}
```

Optional query `?kind=note` may filter Notes for dock hydration; full extraction uses the unfiltered list.

This read may return raw owner `submittedText` by design (FR-029). It is not an operational log channel.

## `GET /api/research/notes`

Convenience equivalent to notes filter for dock reload. Success 200: `{ "notes": [ ... note events by seq ... ] }`. Not a polished export surface.

## Client capture matrix (normative coverage)

| UI action | Product API (unchanged) | Research writes | submittedText |
| --- | --- | --- | --- |
| Notes send | none | `POST /notes` | note body |
| Commands → Structure edit | `POST /api/visual/storyboard/edit` | start + terminal around call | instruction |
| Commands → panel regenerate | `POST /api/visual/frames/.../panels/.../generate` | start + terminal | instruction |
| Structure form submit | same edit API | start + terminal (`surface=product_control`) | instruction |
| Structure undo | `POST /api/visual/storyboard/undo` | start + terminal | null |
| Panel regenerate button | panel generate API | start + terminal | instruction |
| Frame generate button | frame generate API | start + terminal | null |
| Placement zoom `change` | placement PATCH | start + terminal (`placement_commit`) | null |
| Placement zoom `input` | none | **no event** | — |
| Identity save | identity POST | start + terminal | comment only |
| Anchor generate | anchor POST | start + terminal | instruction |
| Anchor approve | approve POST | start + terminal | null |
| Visual approve | `/api/visual/approve` | start + terminal | null |
| Draft autosave | `PUT /api/draft` | **no event** | — |
| Read draft submit | `POST /api/readings` | start + terminal (`reading`) | draft text at submit |
| Confirm material | `POST /api/confirmations` | start + terminal | null |
| Stage storyboard | `POST /api/storyboard-results` | start + terminal | null |

## Dock Commands target rules

- Supported targets only: `storyboard` Structure edit; `panel` regeneration when explicitly selected.
- Ambient open frame/panel updates `context` only.
- Sticky explicit target mode prevents silent retarget (FR-010).
- Unsupported context: client shows limitation; no research/product command send.

## Operations projection rules

- **Running**: only while the page’s product busy latch is held for that action.
- **Terminal**: from stored `action_terminal` outcomes; local control notices remain.
- **After reload/restart**: no running state from unpaired `action_start` rows; those rows remain extractable evidence of interruption only.
