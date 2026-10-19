# Plan: Explicit frame dialogue modes

## Path

Keep the current storyboard application. Persist one mode on each renderable unit and edit it through the existing manual assembly operation.

1. `dialogueMode` is `spoken`, `silent`, or `hidden` on an ordinary frame, or on a directing-beat segment. `speakerPanel` is active only for `spoken`. `dormantSpeakerPanelId` remembers the panel for a later **Реплика**. `dialogue` or segment `quote` may keep a dormant line. Text cards have no mode.
2. `ensureVersion` backfills missing modes once and writes them onto every stored version of that storyboard. A non-empty visible line becomes `spoken`. Every other non-text unit becomes `hidden`. The backfill does not assign `silent` and does not move an existing speaker index. Repeating it changes nothing. Stage normalization uses the same assignment for new checked frames.
3. `setFrameDialogue` on `/api/visual/operations` carries the mode, optional owner text, and a panel id. The server resolves the panel id in the transaction. A change forks one `storyboard_version` with undo label `диалог кадра`. A no-op does not fork. The operation does not call `/api/source-utterances` and does not rotate the draft token.
4. **Диалог кадра** in **Редактор кадра** saves that operation. **Редактирование реплики** stays the whole-source editor.
5. `FrameRenderer` reserves the 300 px bar for `spoken` and `silent`, and omits it for `hidden` and text cards. Timing, Video Spec, and the rough Remotion frame read the same mode. Dormant text is absent from the spec line.
6. A real change drops Visual approval by leaving it on the previous version and clears the process-current render for this project. Panel ids, assets, placement, and other projects stay.
7. Research records `frame_dialogue` with `dialogueMode` and `previousDialogueMode` only. The line is not logged.

## Checkpoint

The browser path in `spec.md` on the worktree server at `http://127.0.0.1:4173/projects/{projectId}`, using a persisted image-populated split frame and no live provider.

## Tests

Pure mode, renderer, assembly, overflow, timing, and Video Spec tests first, then the PostgreSQL dialogue-mode lane, then the offline `app/storyboard-web` suite and the affected PostgreSQL lanes with `STORYBOARD_TEST_DATABASE_URL`.

## Out of this path

No change to the Feature 014 source-utterance draft mutation, no prompt or schema edit, and no new dialogue height.
