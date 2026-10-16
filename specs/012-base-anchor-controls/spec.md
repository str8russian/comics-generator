# Base-anchor session

## Status

Accepted from the standalone prototype at `0373e5cc31bea5403ef221e728a7fec698966184` and authorized for one production integration on `storyboard-web`.

## Stable card

A character card is either `NO_BASE_ANCHOR` or `ANCHOR_AVAILABLE`.

- Empty: one action, **Создать изображение**.
- Available: the accepted image plus **Уточнить образ**, **Создать замену**, and tertiary **Удалить**.
- No generic Edit menu. File choice, instruction, candidates, and acceptance stay in one modal. Only one character session is open.

Creation and replacement both offer **Загрузить готовый anchor** and **Создать из реального фото**. A ready upload is the candidate and makes no provider call. A generated anchor keeps its real source photo as secondary context. An uploaded ready anchor has no invented source photo.

The accepted anchor stays visible until **Принять**. Cancel leaves it unchanged. Draft candidates and instructions die when the modal closes or the page reloads. Undo and Redo move through candidates and never call the provider. Escape does not discard a dirty draft. A pending request cannot be closed away. The first refinement requires an instruction; later empty instructions still create the next candidate.

## Generation

**Создать вариант на основе выбранного** revises the selected candidate, including the candidate chosen by Undo, and keeps the source photo and accepted anchor as identity and continuity authorities.

**Создать вариант от исходного фото** appears only after a candidate exists and a real source photo is retained. It sends that photograph, not the selected candidate and not the accepted stylized anchor. A project style image may be included only as style, never as identity or the revision draft. Each explicit click makes one provider call and appends the result.

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
