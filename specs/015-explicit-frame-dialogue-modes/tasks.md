# Tasks: Explicit frame dialogue modes

## Contract

- [x] T001 Add the Feature 015 spec, plan, and data model.

## State

- [x] T002 Reject inconsistent dialogue mode, require text and a live speaker for `spoken`, and keep dormant text invisible for `silent` and `hidden`.
- [x] T003 Backfill legacy spoken units and no-dialogue units without assigning `silent` or moving geometry.

## Assembly

- [x] T004 Save `setFrameDialogue` for frames and directing segments, restore a dormant line, and skip a no-op fork.
- [x] T005 Keep source rows, the working draft, assets, approval, render ownership, and other projects unchanged.

## Picture and time

- [x] T006 Reserve the dialogue region for `spoken` and `silent`, omit it for `hidden`, and keep panel height identical for the first two.
- [x] T007 Time and compile only `spoken` text, and make the rough render follow the mode.

## Workspace

- [x] T008 Add **Диалог кадра** to **Редактор кадра** without sending the line to research or the draft.
- [x] T009 Record `frame_dialogue` with the mode transition only.

## Checkpoint

- [x] T010 Run the focused tests, the offline suite, and the PostgreSQL lanes.
- [x] T011 Walk the browser gate with zero provider calls.
