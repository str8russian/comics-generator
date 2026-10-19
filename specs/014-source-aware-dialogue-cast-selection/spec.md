# Source-aware dialogue and cast selection

## Status

Production semantics for Feature 014. One owner-operated browser checkpoint. This does not amend earlier feature specs. Parenthetical source remarks and project duplication stay as they are.

The detailed frame modal is the **Frame Editor** / **Редактор кадра**. That name is the product term. Existing element ids stay.

## Product gate

No language-model or image-provider call:

1. Open a project whose source has Vladimir as the only speaker and `Андрей Сергеич` as an extracted non-speaking candidate, with a checked storyboard, an approved Vladimir anchor, and current images.
2. In **Редактор кадра**, open `Редактирование реплики`, replace one whole Vladimir utterance, and save.
3. The new wording is active, images and unrelated frames stay, and the affected frame shows `Текст изменён — изображение сохранено для проверки`.
4. Reload, leave, open another project, and return. The edit exists only in the original project.
5. Uncheck `Андрей Сергеич`. His words stay in Vladimir's line and under `Обращения`. He has no active anchor card. Vladimir's source-remark silent frames stay. An Andrey-only derived silent frame or listener panel is removed locally.
6. Reload. Andrey stays excluded. A recheck of the unchanged source does not check him again.
7. Unchecking Vladimir is blocked with the six-utterance impact. Nothing is written.
8. Checking Andrey again restores his still-valid anchor without a new asset row. Uncheck him again for the review state.
9. The current Video Spec uses the edited text. The previous process-current render is not presented as current.

## Utterance edit

From a dialogue frame, `Редактирование реплики` shows the confirmed speaker, the whole source utterance, the count of source-linked display blocks when that count is greater than one, the replacement spoken wording, and Save / Cancel.

Saving, inside one transaction:

- inserts a new Source Revision, Interpretation, and Material State;
- replaces only that utterance's spoken span, keeps its source item id, speaker, and order, and shifts later offsets;
- copies every other source item;
- sets the working draft to the new exact text and rotates its token;
- carries the current storyboard as a new root version, reflows ordinary overflow, and keeps panel ids and current asset ids;
- recomputes minimum timing, raises a too-short duration, and keeps a longer manual duration;
- marks affected frames with the retained-image notice and does not claim a new generation;
- leaves the previous revision, interpretation, material state, storyboard, approval, and asset bytes unchanged;
- drops Visual approval and the process-current render for this project.

A model-authored directing beat is repartitioned only when the edit stays inside one existing segment and every segment stays non-empty. Otherwise Save is blocked and the active state is unchanged. No Stage call and no collapsed compositions.

## Cast inclusion

Every extracted person in `Персонажи` has a pressed/checked control, checked when that person is in the confirmed visual cast.

Unchecked means the person stays visible as an excluded candidate, is omitted from Stage and from anchor cards, and cannot be a panel subject. The source string and the address surface stay.

A character who owns utterances cannot be unchecked. The refusal names the utterance count and writes nothing.

Before confirmation, the control updates the pending cast. Confirmation stores it. After confirmation, a change inserts a new Material State for the same Source Revision and Interpretation. The previous state stays immutable.

Exclusion is stored on the cast row as `included = false` together with the extracted name, and indexed per project so a later reading of the same extracted name stays unchecked. Re-checking removes that exclusion and copies a still-valid accepted anchor and current identity onto the new state without copying image bytes.

When a storyboard already exists, exclusion rebinds a checked storyboard locally. It removes an excluded-only listener panel or an excluded-only derived silent frame. It does not remove source-owned silent remarks. If a dialogue frame cannot keep its line and a retained panel, the change is blocked.

Visual approval and the process-current render are dropped only when the active frames or the cast those frames use actually change.

## Protected

Exact wording outside the replacement, source order, speaker ownership, project URLs and isolation, Feature 011 assembly and undo from the new storyboard root, Feature 012 anchor actions for retained and restored characters, and sanitized logs. The draft textarea remains the intake path, not this editor.

## Deferred

Project duplication. Changes to Interpret or Stage prompts, schemas, or parenthetical-remark classification. Revision-history UI, undo across a source revision, and cloning the old undo chain. Provider regeneration, speaking and listening renditions, and broad intent synchronization.
