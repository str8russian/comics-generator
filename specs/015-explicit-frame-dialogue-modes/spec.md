# Explicit frame dialogue modes

## Status

Production semantics for Feature 015. One owner-operated browser checkpoint. This does not amend Feature 014. The existing whole-source utterance editor still updates **Черновик диалога**. That defect stays deferred.

The detailed frame modal is the **Frame Editor** / **Редактор кадра**.

## Product gate

No language-model or image-provider call. Use one existing image-populated split frame:

1. Open it in **Редактор кадра**. Choose **Реплика**, select the first panel, and save non-empty text. The first panel speaks and the second is silent.
2. Choose **Молчание** and save. Both characters are silent. The dialogue panel stays visible and empty. Image geometry does not jump. Any stored line stays dormant.
3. Choose **Реплика**, select the second panel, and save. The first panel is silent and the second speaks.
4. Choose **Без реплики** or use **Удалить реплику**. Both visual panels remain, the dialogue panel disappears, and the images use the full frame height.
5. Undo restores the preceding mode, speaker, text, images, and geometry.
6. Reload and reopen the project. The selected mode remains.
7. Another project is unchanged.
8. **Черновик диалога** and its revision token do not change.
9. The compiled video keeps an empty fixed-height dialogue region for **Молчание** and no dialogue region for **Без реплики**.

## Modes

The mode belongs to the whole rendered frame, including a directing-beat display segment. It is not a character field and not a source utterance.

| Mode | Who speaks | Character panels | Dialogue panel | Visible text |
| --- | --- | --- | --- | --- |
| **Реплика** | Exactly one selected panel | Shown | Fixed height | Non-empty text under the selected panel |
| **Молчание** | Nobody | Shown, same size as **Реплика** | Same fixed height, empty | None |
| **Без реплики** | Nobody | Shown at the full frame height | Omitted | None |

“Первый говорит, второй молчит” is **Реплика** with the first panel selected. “Первый молчит, второй молчит” is **Молчание**. “Первый молчит, второй говорит” is **Реплика** with the second panel selected.

The saved mode is authoritative. After legacy rows have been made explicit, emptiness of stored text must not decide the mode, the dialogue panel, the timing, or the video line.

A silenced or hidden frame may keep its previous line and speaker panel as dormant state. That line is not visible, does not extend the frame, and does not enter the video. Returning to **Реплика** restores them when the panel still exists. If that panel was removed, the owner must choose a panel that is still there.

Text cards stay text cards and never gain a dialogue panel.

## Frame Editor

**Диалог кадра** sits in the detailed Frame Editor for image and storyboard frames. The grid card is not the editor. **Редактирование реплики** stays the whole-source editor and is visually separate. This feature does not call that editor and does not change the draft.

The owner picks **Реплика**, **Молчание**, or **Без реплики**. Typing or clearing text does not switch the mode. **Реплика** requires non-empty text and, on a split frame, one panel. A single frame uses its only panel. **Добавить реплику** moves **Молчание** or **Без реплики** to **Реплика** and asks for text when nothing dormant remains. **Удалить реплику** moves **Реплика** or **Молчание** to **Без реплики** without deleting the frame, panels, images, source text, or characters. Validation is Russian.

## Persistence

One manual assembly save records the mode, any new owner line, and the speaking panel. It forks one storyboard version when something changed and does not fork a no-op. Undo restores the previous mode, text, speaker, geometry, panel identities, assets, placement, and duration. The change drops Visual approval and the process-current render for this project only. It does not create or discard image assets. Source revisions, the working draft, interpretation, material state, and source items stay unchanged. A new owner line is storyboard presentation state. Silencing a source-backed frame keeps the source link; it is an owner override, not a source rewrite.

Existing saved rows gain an explicit mode once: a visible line becomes **Реплика**, a frame with no visible line becomes **Без реплики**, and nothing becomes **Молчание** by itself. The visible picture does not change. Directing-beat segments are included. The migration can be repeated.

Newly staged source lines start as **Реплика**. Staged action and other no-dialogue frames start as **Без реплики**. Only this owner operation may later choose **Молчание** or **Без реплики**, or may add owner text where no line was stored.

## Picture, time, and video

**Реплика** and **Молчание** reserve the existing dialogue height. **Без реплики** and text cards do not. **Молчание** shows the dialogue cells with no dialogue text, including when a dormant line is stored. **Реплика** puts the text only in the selected cell. Structure and Visual use the same geometry. Panel drag uses that same visibility.

Only **Реплика** uses typed-dialogue timing. **Молчание** and **Без реплики** use the ordinary silent duration unless a valid explicit duration is already stored. The video spec names the mode so the rough render can show an empty dialogue region for **Молчание** and omit it for **Без реплики**.

## Protected

Feature 011 assembly and undo, Feature 013 project isolation and render ownership, Feature 014 cast inclusion and retained assets, source text, anchors, upload and generation provenance, panel gutter and placement, and text cards.

**Реплика** is the only mode with a speaking panel. Reordering panels keeps that speaker on the same panel. Deleting the speaking panel keeps the existing confirmation. **Молчание** does not count as a speaking character for cast exclusion. Switching modes makes no text-model call and no image-provider call, and it does not make silent or hidden frames newly eligible for automatic image generation.

## Out of scope

Correcting Feature 014 so source-utterance edits stop changing **Черновик диалога**. AI rewriting, Stage regeneration, automatic silent reactions, parenthetical classification, redo, revision-history UI, project duplication, audio, multiple speakers in one frame, and the dialogue height or visual design.
