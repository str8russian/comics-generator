# Data model: Frame dialogue mode

## Renderable unit

An ordinary frame is one unit. A directing beat keeps one unit per segment. Text cards are not dialogue units.

| Field | Rule |
| --- | --- |
| `dialogueMode` | `spoken`, `silent`, or `hidden`. Absent on a text card. Authoritative after backfill. |
| `dialogue` or segment `quote` | Visible line when `spoken`. Dormant recoverable text is allowed when `silent` or `hidden`. |
| `speakerPanel` | Integer panel index only while `spoken`. `null` when `silent` or `hidden`. |
| `dormantSpeakerPanelId` | Panel id to restore. Cleared when that panel is gone. Not a second speaker. |

`spoken` requires a non-empty visible line and a panel that still exists. A single panel is the speaker. A split frame stores the selected panel's index after the server resolves its id. `silent` and `hidden` have no active speaker. `silent` still occupies the dialogue region. `hidden` does not.

## Backfill

On read of a storyboard result, each version whose unit lacks `dialogueMode` is updated in place. No new version is created. A unit with non-empty visible text becomes `spoken` and keeps its speaker index. A unit with no visible text becomes `hidden`. Text cards lose a stray mode if one was stored. Directing-beat modes are written on the segments. A second read does not write again.

New checked storyboards receive the same assignment before they are saved. Source utterances start `spoken`. Action, derived, and other empty units start `hidden`.

## Operation

`setFrameDialogue` addresses `structureFrameId` and, for a directing beat, `structureSegmentIndex`. Owner text replaces the unit line only for `spoken`. `silent` and `hidden` leave the stored line in place. The selected speaker is the panel id, not a client index. The operation context stores the mode and the frame address, not the line.

A changed unit forks `storyboard_version`. Undo points the head at the parent version, which still has the previous mode, text, speaker, panels, assets, placement, and duration. Visual approval stays on the previous version. The process-current render for the project is dropped. No `visual_asset`, generation, identity, or anchor row is inserted. `working_draft`, `source_revision`, `interpretation`, `material_state`, and `source_item` are not updated.

## Video

The compiled frame carries `dialogueMode`. Its `dialogue` string is the visible line, so `silent` and `hidden` compile to an empty line and still differ by mode. Only `spoken` has pre-roll and reveal frames.
