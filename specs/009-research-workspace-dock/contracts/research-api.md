# Contract: research HTTP API

Local owner-research evidence only. Routes do not take a project id. Responses and operational logs never include credentials, secret-bearing URLs, raw provider responses, image bytes, or data URLs — including when those appear inside rejected `submittedText`.

Existing sanitized lifecycle/`logVisual` allowlists remain unchanged. Research routes must not write `submitted_text`, draft text, instructions, notes, or rejected secret material into `logLine`.

Normative event fields: [research-event.schema.json](./research-event.schema.json). Persistence rules: [../data-model.md](../data-model.md).

## Shared failures

| HTTP | Body | When |
| --- | --- | --- |
| 400 | `{ "status": "failed", "kind": "invalid-request" }` | Malformed JSON, unknown enums, forbidden object keys, bad correlation rules, duplicate start/terminal for a `correlationId`, incomplete `startSnapshot` when required |
| 400 | `{ "status": "failed", "kind": "protected-content" }` | `submittedText` or text-bearing `editTarget` values match the bounded protected-content policy; **no** matched text is echoed |
| 413 | empty | Body larger than server `maxBodyBytes` (default `DEFAULT_MAX_BODY_BYTES` = 262144); no silent truncation |
| 415 | empty | JSON content type required |
| 503 | `{ "status": "failed", "kind": "database" }` | Insert/select failed after startup; driver message not copied |
| 500 | `{ "status": "failed", "kind": "configuration" }` | Research store unavailable because database was not configured (same class as other stores) |

No automatic retry. Clients keep unsaved Notes draft text on note-save failure (including `protected-content`).

## Forbidden request fields (structural exclusion)

Requests that include any of the following keys (any nesting) are `400 invalid-request` and must not be partially stored:

- `image`, `bytes`, `imageBytes`, `performanceImageDataUrl`, `dataUrl`, `dataURL`
- `authorization`, `token`, `apiKey`, `DATABASE_URL`
- `providerResponse`, `rawResponse`, `messages`, `prompt`, `headers`
- generic `requestBody` / `responseBody` dumps

Image/data-URL material for identity/panel performance continues to travel only on existing product routes and is never copied into research events.

**FR-030 is not satisfied by key rejection alone.** Free-form `submittedText` is also validated (next section).

## Protected-content validation for free-form text

Before insert, the server validates `submittedText` and any string values inside `editTarget` with a **bounded** pattern policy (not general DLP):

| Class | Examples of rejected content (illustrative) |
| --- | --- |
| Authorization / Bearer credential forms | `Authorization: Bearer …`, `Bearer eyJ…`, `bearer <token>` |
| Credential-bearing URLs or DSNs | `postgres://user:password@host/db`, `https://user:pass@host/…` |
| Sensitive URL query parameters | `?token=`, `access_token=`, `api_key=`, `apikey=`, `password=`, `secret=`, `signature=` (case-insensitive) |
| Image / data-URL payloads | `data:image/png;base64,…`, other `data:*;base64,…` |

On match: atomic reject with `kind: "protected-content"`; no row; no log/HTTP echo of the matched secret; ordinary text that passes is stored unchanged. This does **not** claim detection of every possible secret or classification of pasted provider JSON beyond these patterns.

Failure policy: same as other research-save failures (Notes draft retained; product action may proceed without a recorded start).

## Action-aware text size

There is **no** universal 8000-character research quota. Oversize JSON requests hit the existing body limit (`413`). Research must accept at least as much text as the originating product control:

- `reading`: full draft at submit, within the shared body envelope (account for JSON overhead of the research request).
- `structure_edit` / panel instructions: at least the existing product instruction bound (4000 on Structure edit).
- Notes/Commands: no new owner-facing limit invented here beyond the shared body limit and any bound already enforced by the product path used.

Never silently truncate stored raw text.

## `POST /api/research/notes`

Creates exactly one `note` event after protected-content validation.

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

### Action start

```json
{
  "id": "uuid-optional",
  "eventKind": "action_start",
  "semanticAction": "structure_edit",
  "correlationId": "uuid-required",
  "surface": "dock_commands",
  "submittedText": "optional instruction or null",
  "commandTarget": { "kind": "storyboard", "displayFrameNumber": null, "displayFrameId": null, "structureFrameId": null, "structureSegmentIndex": null, "panelIndex": null, "zoom": null, "positionX": null, "positionY": null, "characterName": null, "anchorVersionId": null },
  "editTarget": null,
  "context": { "...fixed keys...": null }
}
```

For `semanticAction: "cast_edit"`, `editTarget` is required and `commandTarget` is null:

```json
{
  "eventKind": "action_start",
  "semanticAction": "cast_edit",
  "correlationId": "uuid",
  "surface": "product_control",
  "submittedText": "Песков",
  "commandTarget": null,
  "editTarget": {
    "editKind": "speaker_assignment",
    "castPhase": "pending_reading",
    "characterName": "Песков",
    "previousCharacterName": null,
    "surfaceForm": null,
    "sourceItemId": "utterance-3"
  },
  "context": { "...fixed keys...": null }
}
```

A second start for the same `correlationId` is `400 invalid-request`.

### Action terminal

When a start exists for `correlationId`, the client sends outcome fields; the server **derives** `semanticAction`, `surface`, `commandTarget`, `editTarget`, `context`, and `submittedText` from the stored start (navigation-stable). `durationMs` is computed from server timestamps.

```json
{
  "eventKind": "action_terminal",
  "correlationId": "uuid-required",
  "outcome": "success",
  "outcomeKind": null,
  "outcomeFlags": {}
}
```

When the start write failed or is genuinely absent, the client may send a terminal **only** with the original start snapshot retained by the initiating closure:

```json
{
  "eventKind": "action_terminal",
  "correlationId": "uuid-required",
  "outcome": "success",
  "outcomeKind": null,
  "outcomeFlags": { "evidenceIncomplete": true },
  "startSnapshot": {
    "semanticAction": "structure_edit",
    "surface": "dock_commands",
    "submittedText": "…",
    "commandTarget": { "kind": "storyboard" },
    "editTarget": null,
    "context": { "...fixed keys...": null }
  }
}
```

In that incomplete case `durationMs` is null and no recovery/resume is inferred. A terminal without a matching start and without a valid `startSnapshot` is `400 invalid-request`. A second terminal for the same `correlationId` is `400 invalid-request`.

Success 201: `{ "event": { ... } }`

## `GET /api/research/trace`

Returns the complete ordered trace for local machine-readable extraction (no polished export UI).

Success 200:

```json
{
  "events": [ { "...event...": "ordered by seq ascending" } ]
}
```

Optional query `?kind=note` may filter Notes for dock hydration; `?surface=dock_commands` may filter Commands history. Full extraction uses the unfiltered list.

This read may return raw owner `submittedText` by design (FR-029). It is not an operational log channel.

## `GET /api/research/notes`

Convenience equivalent to notes filter for dock reload. Success 200: `{ "notes": [ ... note events by seq ... ] }`. Not a polished export surface.

## Client capture matrix (normative coverage)

| UI action | Product API (unchanged) | Research writes | submittedText / edit evidence |
| --- | --- | --- | --- |
| Notes send | none | `POST /notes` | note body |
| Commands → Structure edit | `POST /api/visual/storyboard/edit` | start + terminal around call | instruction; `commandTarget.kind=storyboard` |
| Commands → panel regenerate | `POST /api/visual/frames/.../panels/.../generate` | start + terminal | instruction; panel target |
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
| Character rename blur → `saveCast()` | `PUT …/cast` or `POST /api/material-states` | start + terminal (`cast_edit`) on **successful** save | new name + `editTarget.editKind=character_rename` + `castPhase` |
| Alias select change → `saveCast()` | same | start + terminal (`cast_edit`) on success | selected character + `alias_assignment` |
| Speaker select change → `saveCast()` | same | start + terminal (`cast_edit`) on success | selected character + `speaker_assignment` |
| Failed `saveCast()` | same | terminal failure if start was recorded; else honest research/product failure without success claim | — |
| Draft autosave | `PUT /api/draft` | **no event** | — |
| Draft keystrokes / source-text edits before reading | none / autosave | **no event** until next reading submit | — |
| Read draft submit | `POST /api/readings` | start + terminal (`reading`) | **full draft** at submit |
| Confirm material | `POST /api/confirmations` | start + terminal | null |
| Stage storyboard | `POST /api/storyboard-results` | start + terminal | null |

## Dock Commands target rules

- Supported targets only: `storyboard` Structure edit; `panel` regeneration when explicitly selected.
- Ambient open frame/panel updates live UI context only; capture-time context on a start is frozen for that correlation.
- Sticky explicit target mode prevents silent retarget (FR-010).
- Unsupported context: client shows limitation; no research/product command send.
- Cast edits never use `commandTarget`; they use `editTarget`.

## History and Operations projection rules

- **Notes history**: `event_kind = note` (survives reload/restart).
- **Commands history**: `surface = dock_commands` ordered by `seq` (independent of Notes; same trace; in-session projection required).
- **Operations running**: only while the page’s product busy latch is held for that action.
- **Operations terminal**: from stored `action_terminal` outcomes; local control notices remain.
- **After reload/restart**: no running state from unpaired `action_start` rows; those rows remain extractable evidence of interruption only.
