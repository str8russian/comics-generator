# Plan: Source-aware dialogue and cast selection

## Path

Keep the current storyboard application. Add one local mutation for a source utterance and extend cast save with an explicit included flag.

1. Migration `012_source_edit_cast_inclusion.sql` adds `included` and `extracted_name` to pending and canonical characters, and a project-scoped `character_exclusion` row for each extracted name the user has unchecked.
2. `source-edit.mjs` replaces one spoken span, shifts later offsets, repartitions a directing beat or refuses, reflows a structure frame's dialogue and duration, and removes only excluded-only derived visuals.
3. `reviseSourceUtterance` writes the new revision, interpretation, material state, draft token, carried storyboard root, and carried anchors in one transaction. It does not call Interpret or Stage.
4. Cast save writes `included`. A speaking character is refused. After confirmation, an inclusion change inserts a material state, carries anchors for people who remain included, and rebinds the current storyboard when one exists.
5. Recheck applies `character_exclusion` while building the pending cast, so the same extracted name stays unchecked.
6. **Редактор кадра** opens `Редактирование реплики`. `Персонажи` shows the checkmark control. A changed source drops the process-current render.

## Checkpoint

The browser path in `spec.md` on the worktree server at `http://127.0.0.1:4173/projects/{projectId}`, using a persisted fixture and no live provider.

## Tests

Pure transformation tests first, then the PostgreSQL source and cast lane, then the offline `app/storyboard-web` suite and the affected PostgreSQL lanes with `STORYBOARD_TEST_DATABASE_URL`.

## Out of this path

No duplicate-project action, no prompt or schema edit, and no automatic deletion of source-owned silent remarks.
