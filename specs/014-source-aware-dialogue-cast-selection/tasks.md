# Tasks: Source-aware dialogue and cast selection

## Contract

- [x] T001 Add the Feature 014 spec, plan, and data model.

## Transformations

- [x] T002 Replace one spoken span, shift later offsets, and refuse an unsafe directing repartition before any write.
- [x] T003 Reflow the structure frame, raise a short duration, keep a longer one, and remove only excluded-only derived visuals.

## Persistence

- [x] T004 Migrate `included`, `extracted_name`, and `character_exclusion` without rewriting existing cast rows into excluded.
- [x] T005 Commit a source utterance as a new revision, interpretation, material state, draft token, storyboard root, and carried anchors, or roll back.
- [x] T006 Save inclusion on the pending cast and on a new material state, keep a speaking character, and reapply exclusion on recheck.

## Workspace

- [x] T007 Open `Редактирование реплики` from **Редактор кадра** and show the cast checkmark with a spoken-character refusal.
- [x] T008 Record the utterance edit and the inclusion change on the existing research path without logging the replacement text.

## Checkpoint

- [x] T009 Run the focused tests, the offline suite, and the PostgreSQL lanes.
- [x] T010 Walk the browser gate with zero provider calls.
