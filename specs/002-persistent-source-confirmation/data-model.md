# Data model: Persistent Source and Cast Confirmation

PostgreSQL is the durable store. Offsets are JavaScript UTF-16 indexes into the exact stored text. The application inserts immutable artifact rows and updates only pointers, the working draft, and the pending cast of the current unconfirmed reading.

Normative HTTP shapes are in [contracts/project-api.md](./contracts/project-api.md). Interpret JSON is in [contracts/interpret-response.schema.json](./contracts/interpret-response.schema.json).

## Write rules

| Table | Insert | Update | Delete |
|---|---|---|---|
| `project` | migration seed only | active revision, active material state, current reading | no |
| `working_draft` | migration seed only | text and `revision_token` together | no |
| `reading`, pending cast rows | yes | pending cast only while that reading is current and unconfirmed | no |
| `source_revision`, `interpretation`, `source_item`, `provisional_character`, `surface_form` | yes | no | no |
| `material_state`, `canonical_character`, `alias`, `speaker_assignment` | yes | no | no |
| `storyboard_result` | yes | no | no |

`source_revision.text` and `interpretation` rows are never rewritten. A cast correction inserts a new `material_state`. Restaging inserts a new `storyboard_result`.

## Project

One row, seeded by `001_init.sql`.

- `id`: UUID.
- `singleton`: `true`. Unique. A second row cannot be inserted.
- `active_source_revision_id`: nullable UUID. Null before the first confirmation.
- `active_material_state_id`: nullable UUID. Null before the first confirmation. After that, it points at the material state staging uses.
- `current_reading_id`: nullable UUID. The reading Material review shows. Viewing an old Source Revision does not change it.

There is no project name, owner, or share token.

## Working draft

One row for the singleton project.

- `text`: exact draft, including empty. PostgreSQL `text`. No Unicode normalization.
- `revision_token`: UUID. Changes on every successful save and when activation replaces the text.
- `updated_at`: timestamp.

Save succeeds only when the supplied token equals the stored token. The new token is generated in that same update. A mismatch writes nothing.

The draft is not a Source Revision. Edits before and after the first confirmation both land here. They create a revision only when confirmation commits.

Rejected on save, with no write: U+0000, and any unpaired UTF-16 surrogate. The stored text then round-trips through UTF-8 to the same JavaScript string.

## Reading

The Interpret snapshot for one draft version.

- `id`: UUID.
- `draft_text`: exact copy of `working_draft.text` at snapshot time.
- `draft_revision_token`: token observed at snapshot time.
- `status`: `pending`, `ready`, `blocked`, `failed`, or `stale`.
- `failure_kind`: set when status is `failed`. No provider body.
- `blocked_codes`: set when status is `blocked`, including `empty-draft`.

`pending` is stored before the provider call. When the call returns, the row becomes `ready`, `blocked`, or `failed` only if `working_draft.text` is still equal to `draft_text`. If the draft changed, status becomes `stale`. A stale or failed reading creates no Source Revision.

The current ready reading is confirmable only while its `draft_text` equals the working draft. The confirm request does not supply a replacement draft.

## Interpretation

One row per Source Revision, inserted in the confirmation transaction from the reading snapshot.

- `id`: UUID.
- `source_revision_id`: unique.
- `reading_id`: the reading that was confirmed.

Child rows, ordered and immutable:

### Source item

- `ordinal`: 0-based reading order.
- `model_id`: the Interpret id, unique inside the interpretation.
- `kind`: `utterance`, `action`, `context`, or `note`.
- `speaker_status`: `explicit`, `inferred`, or `unresolved` for an utterance; `none` otherwise.
- `speaker_label`: required for `explicit` and `inferred`; absent otherwise.
- `draft_start`, `draft_end`: UTF-16 offsets into the Source Revision text. `text.slice(draft_start, draft_end)` equals `source_quote`.
- `source_quote`: the accepted slice, including an explicit speaker label when that label is inside the slice.
- `spoken_text`: the utterance remainder after the existing explicit-prefix rule, or the slice for every other kind.

Anchoring rules stay those of the tracer. The model still does not send offsets.

### Provisional character

- `model_id`.
- `name`: the proposed display name. It does not have to be a substring of the draft.

### Surface form

- `model_id`.
- `quote`: an exact substring of the Source Revision. The server records one scalar-boundary occurrence. A quote that does not occur is rejected as unusable Interpret output before confirmation.
- `role`: `speaker-label`, `address`, or `mention`.
- `proposed_character_model_id`: nullable. An address can be unlinked until the user maps it.

A surface form is not a speaker assignment. `Дмитрий Сергеевич` can be an `address` while the utterance speaker is someone else.

## Source Revision

- `id`: UUID.
- `parent_source_revision_id`: null for the first confirmation. Later text confirmation sets it to the active Source Revision at commit time.
- `text`: exact committed draft. Equal to the reading’s `draft_text` at commit.
- `created_at`.

No update statement exists for this table. Punctuation and whitespace differences are different rows.

## Material state

The immutable Project Document version used for the confirmed cast.

- `id`: UUID.
- `source_revision_id`.
- `interpretation_id`: the interpretation of that same revision. The confirmation transaction checks the pair.
- `parent_material_state_id`: null for the first state of a revision. A cast, alias, or speaker correction sets it to the state that was copied.
- `created_at`.

The current material state of a revision is the latest row for that `source_revision_id` by `created_at`, then `id`. The active material state is `project.active_material_state_id`. Those can differ while the user is viewing history; staging uses only the active one.

### Canonical character

- `id`: UUID, new in every material state. Copies do not reuse ids across states.
- `ordinal`.
- `name`: the accepted name, for example `Песков`.

### Alias

- `id`: UUID.
- `surface_text`: exact characters, for example `Дмитрий Сергеевич`.
- `character_id`: a character in the same material state.

On confirm and on later correction, every `surface_text` must occur in that Source Revision’s text. The mapping does not remove or replace those characters in the revision. The user may add a surface the reading did not propose, if the exact string occurs.

### Speaker assignment

- `source_item_model_id`: an utterance in the linked interpretation.
- `character_id`: a character in the same material state.

An utterance with no row here has no confirmed speaker. That is the only blocking finding. `explicit` and `inferred` utterances start assigned when the pending cast can match the label to a character. `unresolved` utterances start unassigned. The user can change any of these before confirmation without creating a material state, and after confirmation only by inserting a new material state.

## Pending cast

Rows attached to a `reading`, not to a Source Revision. They hold the characters, aliases, and speaker assignments Material review is editing before confirmation.

- Replaced in full by the cast-edit request while the reading is current and its text still equals the working draft.
- Copied into the first material state by confirmation.
- Not updated after confirmation. Later corrections copy the active material state instead.

Cast edits before the first confirmation do not insert a material state.

## Storyboard result

- `id`: UUID.
- `material_state_id`: the state whose cast was supplied to Stage, or the state that was blocked before Stage.
- `status`: `checked`, `blocked`, or `failed`. Never `ready`. Ready is the page after overflow fitting.
- `failures`: blocked codes, or a failure kind. No provider body and no draft.
- `stage_payload`: Stage frames, review ids, and display-block offsets for `checked`. Omitted for `blocked` and `failed`.
- `created_at`.

The result shown for a material state is the latest row for that id. Older rows for the same state stay stored and are not a user-facing history. Results for an earlier material state stay stored.

On read, dialogue and action text are derived again from the Source Revision. The page may label a result ready only when all of these hold:

- the result status is `checked`;
- its material state is the active material state;
- overflow compilation succeeds;
- source-fidelity checks still pass.

A `checked` result for any other material state is visible as a previous result and is not labeled ready.

## State transitions

### Draft token

`empty seeded text, token T0` → save text with `T0` → new token `T1`. A second save that still sends `T0` leaves `T1` and the newer text unchanged.

### Reading

`no current reading` → snapshot → `pending` → provider result → `ready`, `blocked`, `failed`, or `stale`.

A new reading moves `current_reading_id`. The previous reading row remains and cannot be confirmed.

### Confirmation

Allowed when the current reading is `ready` and the texts are equal. One commit inserts the Source Revision, Interpretation, child rows, first material state, and cast rows, then points the project at them. Any failure rolls the whole commit back.

`empty-draft`, a failed reading, a stale reading, and a text mismatch insert none of those rows.

### Cast correction

Active material state `M` on revision `R` → new state `M2` with parent `M`, same `R`, same interpretation, new cast rows, project pointer moved to `M2`. Revision count and interpretation count stay the same. `M` and any storyboard result on `M` stay.

### Activation

Does not insert a Source Revision. When the working draft differs from the active revision text, the server writes nothing unless the request confirms the replacement. With that confirmation, the draft becomes the selected revision’s text, the token changes, and the active pointers become that revision and its current material state.

### Storyboard

Active state with an unassigned utterance → insert `blocked` / `unresolved-speaker` on that state. Stage is not called.

Active state fully assigned → Stage receives that cast → insert `checked`, `blocked`, or `failed` on the captured state id. A later cast correction does not relabel that row as ready for the new state.

## Resume

`GET /api/project` reads the working draft, token, active revision, active material state, current reading, and storyboard results. Restarting the Node process uses the same database volume. The returned draft must compare equal to the draft saved before the restart, including emoji and combining marks.
