# Contract: project HTTP API

One local project. Routes do not take a project id. The browser never receives the provider token, base URL, model name, reasoning level, prompt text, database URL, or raw provider response.

`GET /api/project` returns the user’s draft and confirmed material because that is the resume document. Failure bodies, conflict bodies, and server logs do not include draft text, provider bodies, credentials, or database secrets.

Lifecycle logs stay on the tracer allowlist and add only: `request`, `event`, `status`, `kind`, `http`, `codes`, `during`, `providerStatus`, `finishReason`, `schema`, and `migration`. New events are `draft-save`, `reading-start`, `reading-outcome`, `confirm`, `cast-edit`, `material-state`, `activate`, and `storyboard-persist`. A log line does not include the draft, a source quote, a character name, a revision token, or a connection string.

The existing `POST /api/storyboard` route remains the session tracer. It does not read or write these tables. The product page does not call it.

## Shared failures

| HTTP | Body | When |
|---|---|---|
| 400 | `{ "status": "failed", "kind": "invalid-request" }` | Malformed JSON, wrong types, U+0000, or an unpaired surrogate. |
| 404 | `{ "status": "failed", "kind": "not-found" }` | Unknown reading, revision, or material state. |
| 409 | `{ "status": "failed", "kind": "stale-draft" }` | Draft token does not match. No text is written or returned. |
| 409 | `{ "status": "failed", "kind": "stale-reading" }` | Reading is not current, or its stored text differs from the working draft. No revision is inserted. |
| 409 | `{ "status": "failed", "kind": "uncommitted-draft", "warning": "Несохранённый черновик будет заменён и не является сохраняемой редакцией." }` | Activation would replace a different working draft and `confirmDiscard` is not `true`. Nothing is written. |
| 413 | empty | Body larger than `STORYBOARD_MAX_BODY_BYTES` (default 262144). |
| 415 | empty | JSON content type required on requests with a body. |
| 503 | `{ "status": "failed", "kind": "database" }` | Query failed after startup. The driver message is not copied. |
| 500 | `{ "status": "failed", "kind": "configuration" }` | Provider configuration missing when a model call is required. The provider is not called. |

Provider `502` and `504` kinds stay `provider`, `invalid-output`, and `timeout`, as in the tracer contract. Those bodies still have no draft and no upstream payload.

## `GET /api/project`

Returns 200:

```json
{
  "draft": { "text": "exact text", "revisionToken": "uuid" },
  "activeSourceRevisionId": null,
  "activeMaterialStateId": null,
  "reading": null,
  "sourceRevisions": [],
  "storyboards": []
}
```

`draft.text` is the working draft. `reading` is the current reading or `null`. When present it includes `id`, `status`, ordered source items, provisional characters, surface forms, the pending cast, and blocking findings. A blocking finding is only `{ "code": "unresolved-speaker", "sourceItemId", "sourceQuote" }` for an utterance with no pending or confirmed speaker. `sourceQuote` is shown on Material review; it is not written to the log.

`sourceRevisions` lists id, parent id, and `createdAt` for the P2 history view. It does not include every material state.

`storyboards` lists each material state’s latest result: `materialStateId`, `sourceRevisionId`, `status` of `checked`, `blocked`, or `failed`, and `readyEligible`. `readyEligible` is true only when `status` is `checked` and `materialStateId` is the active material state. Dialogue strings in a `checked` result are rebuilt from the Source Revision on this read.

Before phase 2, the page may ignore `sourceRevisions`. The field is still present so resume does not change shape later.

## `PUT /api/draft`

Request: `{ "text": "string", "revisionToken": "uuid" }`

Success 200: `{ "revisionToken": "new uuid" }`

The update is one statement conditioned on the current token. Autosave sends the token from the last `GET` or the last successful `PUT`. On `409` `stale-draft`, the client loads `GET /api/project` and does not send the rejected text again.

This route never inserts a Source Revision.

## `POST /api/readings`

Request body is empty. The server snapshots the current working draft, stores a `pending` reading, then calls Interpret outside that transaction.

- Empty or whitespace-only draft: `200` `{ "status": "blocked", "failures": [{ "code": "empty-draft" }] }`. No provider call and no Source Revision. The draft remains.
- Snapshot saved, then the draft changes before Interpret returns: the reading is `stale`. Response is `409` `stale-reading`.
- Interpret schema or provider failure: `failed` with the tracer kind. The draft remains. No Source Revision.
- Success: `200` with `status: "ready"`, the reading id, source items, characters, surface forms, the initial pending cast, and blocking speaker findings.

A surface-form `quote` that does not occur in the snapshot, or a `characterId` that is not in `characters`, is `invalid-output`. Offsets are not accepted from the model.

The initial pending cast copies provisional characters, aliases from located surface forms, and speaker assignments for `explicit` and `inferred` utterances whose label matches a character or surface. `unresolved` utterances have no assignment.

## `PUT /api/readings/:id/cast`

Request:

```json
{
  "characters": [{ "name": "Песков" }],
  "aliases": [{ "surface": "Дмитрий Сергеевич", "characterName": "Песков" }],
  "speakers": [{ "sourceItemId": "u1", "characterName": "Путин" }]
}
```

The server replaces the pending cast of that reading. It does not insert a material state or a Source Revision. Each alias `surface` must occur exactly in the reading’s draft text. Character names are the user’s canonical names and need not be substrings.

If the reading is not current, or the working draft text differs from the reading text, the response is `409` `stale-reading` and the pending cast is unchanged.

Mapping `Дмитрий Сергеевич` to `Песков` is this request. The draft text is unchanged.

## `POST /api/confirmations`

Request: `{ "readingId": "uuid" }`

One transaction:

1. Lock the project and working draft.
2. Require the reading to be current, `ready`, and character-for-character equal to the working draft.
3. Insert one Source Revision. Parent is the current active revision, or null.
4. Insert one Interpretation and its source items, provisional characters, and surface forms from the reading snapshot.
5. Insert the first material state for that pair and copy the pending cast into it.
6. Point the project at that revision and material state.

Success 200 returns the new ids. On any failure the transaction rolls back, including a text mismatch (`409` `stale-reading`). Showing a stale reading or cancelling the user’s confirm action is not a request and writes nothing.

Confirmation is allowed while a speaker is still unassigned. The finding remains. Staging then blocks.

## `POST /api/material-states`

Request body matches the cast object above. One transaction copies the active material state, applies the change, and points the project at the new row. `source_revision_id` and `interpretation_id` stay the same. No Source Revision or Interpretation row is inserted. The previous material state and its storyboard results stay.

The alias or speaker change does not alter `source_revision.text`.

## `POST /api/storyboard-results`

Request body is empty. The server captures `active_material_state_id` and then:

- inserts `blocked` / `unresolved-speaker` and skips Stage when any utterance is unassigned;
- otherwise sends the [Stage input](./stage-input.md) and inserts `checked`, `blocked`, or `failed` on the captured id.

Success for a fidelity-valid Stage is `200` `{ "status": "checked", ... }` with dialogue rebuilt from the source. The page stays in loading until the existing overflow compiler finishes, then shows `ready` only if that material state is still active. The server never sends `status: "ready"`.

A cast correction after a `checked` result leaves that result visible with `readyEligible: false`.

## `GET /api/source-revisions/:id`

P2. Returns that revision’s exact text, interpretation order, current material state, and storyboard results for material states of that revision. It does not change the active revision, the active material state, or the working draft.

## `POST /api/activations`

P2. Request: `{ "sourceRevisionId": "uuid", "confirmDiscard": false }`

If the working draft equals the active revision text, or there is no active revision yet and the draft equals the selected revision text, the server activates the selected revision and its current material state without the warning. The draft token changes only when the draft text is replaced.

If the working draft differs and `confirmDiscard` is not `true`, the response is the `409` warning above and the database is unchanged. No Source Revision is created.

If `confirmDiscard` is `true`, one transaction sets the working draft to the selected revision’s text, rotates the token, and moves the active pointers to that revision and its current material state. It still inserts no Source Revision. The other revisions remain.

## Startup

Migration failure and connection failure exit before the process listens. They are not HTTP responses. The log event is `migration-failed` or `database-unavailable`, with the migration id when one applies, and without the database URL.
