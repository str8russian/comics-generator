# Base-anchor session

## Status

Accepted from the standalone prototype at `0373e5cc31bea5403ef221e728a7fec698966184` and authorized for one production integration on `storyboard-web`.

## Stable card

A character card is either `NO_BASE_ANCHOR` or `ANCHOR_AVAILABLE`.

- Empty: one action, **Создать изображение**.
- Available: the accepted image plus **Уточнить образ**, **Создать замену**, and tertiary **Удалить**.
- No generic Edit menu. File choice, instruction, candidates, and acceptance stay in one modal. Only one character session is open.

Creation and replacement both offer **Загрузить готовый anchor** and **Создать из реального фото**. A ready upload is the candidate and makes no provider call. A generated anchor keeps its real source photo as secondary context. An uploaded ready anchor has no invented source photo.

The accepted anchor stays visible until **Принять**. Cancel leaves it unchanged. Draft candidates and instructions die when the modal closes or the page reloads. Undo and Redo move through candidates and never call the provider. Escape on a dirty draft opens one confirmation centered over the dimmed, inert draft; Escape again dismisses only that confirmation. A pending request cannot be closed away. On the initial Refine screen, **Создать вариант с уточнением** requires an instruction and uses the accepted anchor. After a candidate exists, **Создать вариант на основе выбранного** may use an empty instruction and follows the candidate selected by Undo.

## Generation

**Создать вариант с уточнением** is the initial Refine action. It revises the accepted anchor, keeps a retained source photo as identity authority, and requires a non-empty instruction. After a candidate exists, that primary action becomes **Создать вариант на основе выбранного**: it revises the selected candidate, including the candidate chosen by Undo, and keeps the source photo and accepted anchor as identity and continuity authorities. An empty instruction is then allowed.

**Создать вариант от исходного фото** is shown immediately on the initial Refine screen when a real source photo is retained, and it stays available after candidates exist. It does not appear for a ready anchor without a real source photo, and the first photo-generation screen does not add a second copy of it. It sends that photograph, not the selected candidate and not the accepted stylized anchor. An instruction is optional and is sent when present. A project style image may be included only as style, never as identity or the revision draft. Each explicit click makes one provider call and appends the result. Basis copy names the action it belongs to.

The next-action basis and the displayed candidate's origin are separate. Origin is stored on the candidate.

## Prompt

Production anchor generation uses the accepted system prompt: thick near-black character contours, few hard-edged tones, a full-bleed muted slate-blue matte, one chest-up person, no canvas frame, props, microphone, or logo, and identity-only use of a real photograph. Output is 4:5. The existing reference-budget transport stays in front of the provider.

## Persistence

Selecting a draft photo or generating candidates does not change `character_identity.current_asset_id` and does not replace the accepted anchor. `loadVisual` shows the head approved anchor only.

- Accepting a source-based candidate atomically stores that photo as the current identity and that image as the approved anchor (`generated_from_source`).
- Accepting a refinement keeps the current identity and promotes only the selected candidate.
- Accepting a ready upload approves it with `uploaded_as_ready_anchor` and no real-photo identity. This needs a nullable `identity_asset_id` and a provenance column.
- Delete confirms, retires the current head without deleting asset bytes, and returns the card to empty. **Вернуть образ** restores that anchor in the page session with no provider call. Reload shows the persisted head. A new accept after deletion does not revive the retired anchor.

Unaccepted provider results are not the stable card. A failed request leaves the accepted anchor and the open draft intact.

## Page corrections in this slice

Four character cards wrap as whole cards. At about 1360px CSS width, three standard storyboard frames fit on one row. The owner-facing dock says **Команды**, **Заметки**, and **История операций**. The resize grip remains usable after collapse, expand, and detail open/close.

## Out of scope

Speaking and listening renditions, performance-reference transfer, and dialogue editing.
