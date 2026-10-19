# Data model: Utterance revision and cast inclusion

## Utterance edit

One transaction inserts and then points the project at the new rows. A failure rolls back the draft token and the active pointers.

| Row | Rule |
| --- | --- |
| `source_revision` | New id. Parent is the active revision. `text` is the previous text with one spoken span replaced. The speaker prefix in that span stays byte-for-byte. |
| `reading` | New ready row so `interpretation.reading_id` stays non-null. It is not `project.current_reading_id`. |
| `interpretation`, `source_item` | New interpretation. Same `model_id` and order. The edited item keeps its id and speaker. Later `draft_start` / `draft_end` shift by the length delta. |
| `material_state` | New id for the new revision. Cast, `included`, and `extracted_name` are copied. Character ids are new. |
| `working_draft` | `text` becomes the new revision text. `revision_token` rotates in the same update. |
| `storyboard_result` / `storyboard_version` | New result on the new material state and one root version. Parent version is null. Frames are the current visible frames with the edited utterance applied. Panel rows are copied by `panel_id` and reuse asset ids. |
| `visual_approval` | Not copied. The new version is unapproved because the text changed. |
| Anchors and identity | Current identity and accepted head for each still-included character are inserted on the new material state. Asset ids are reused. |

Previous revision, interpretation, material state, storyboard, approval, and asset rows are not updated.

## Inclusion

`canonical_character.included` and `pending_character.included` are part of that immutable cast snapshot. `extracted_name` is the Interpret-proposed name and stays put when the canonical name is edited. An empty `extracted_name` means "same as `name`" for rows created before this column was filled.

`character_exclusion (project_id, extracted_name)` is the current index. A row means that extracted person is excluded. Deleting the row is re-inclusion. Material review still lists the person, so exclusion is not the same as "Interpret did not extract them" or a deleted row.

Recheck reads the index and sets `included = false` on a new pending character with the same extracted name. Stage and anchor cards read `included = true` only.

Changing inclusion after confirmation inserts a new `material_state` on the same revision and interpretation. The storyboard is rebound only for that change. If the visible frame signature is unchanged, the current visual approval can be copied onto the new root version and the process-current render stays. If a panel or frame is removed, approval is not copied and the process-current render is cleared.

An excluded character's anchor rows stay on the older material state. Re-inclusion copies the nearest still-valid accepted head and identity forward without a new `visual_asset` row.

## Preconditions

The utterance request names the active material state and, when a storyboard head exists, the active storyboard version. A mismatch writes nothing.
