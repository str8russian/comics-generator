# Frame Editor rework, Stage A

## Status

Production contract for Feature 023, Stage A. It replaces the fragmented Frame Editor presentation with the owner-reviewed information architecture: one editor, a persistent final frame, and the tabs **Кадр**, **Диалог**, and one tab per current visual panel.

This stage does not claim owner acceptance. It does not make Feature 022 the product baseline. `DEC-080` still rejects that approach. `DEC-081` and `DEC-083` stay in force for the work this feature does not touch.

## Outcome

Opening an ordinary image frame opens one Frame Editor:

- The complete final 16:9 frame stays visible on every tab. The same production renderer and output geometry draw it.
- The editing side has **Кадр**, **Диалог**, and one tab per current visual panel.
- Clicking the rendered dialogue region opens **Диалог**. Clicking a rendered visual panel opens that panel's tab. The selected panel is visibly identified. The dialogue region does not show a speaker name.
- The frame number, previous frame, next frame, and close stay in the editor header.
- The existing global **Undo** control is the only undo in that header while the editor is open. It shows the current availability and label, and reload keeps today's persisted behavior.
- No Redo control is added. Candidate arrows inside the temporary panel-image flow are not global Redo.
- The layout remains usable at supported desktop and narrow widths.

Panel zoom and pan transform only the image content clipped inside that panel. They do not enlarge the canvas, overlap the inspector, push controls away, or collapse **Кадрирование** when the pointer is released.

## Кадр

The tab shows duration and explicit panel structure only:

- Duration in integer frames, and the same duration in seconds at 30 fps. Either field edits the stored frame count. One committed change is one global Undo step.
- Reset restores the existing deterministic duration for the current active spoken text, or the existing silent default when no spoken text applies.
- Add a panel, delete either panel, and swap the two panels use the existing validity and speaker-transfer rules.
- A duration that would truncate typed dialogue is still refused. Failure is not reported as success.

There is no dialogue or panel summary on this tab, and no **Одна панель / Две панели** switch. Duration remains stored in frames.

## Диалог

Feature 015 semantics stay exact:

- **Реплика** has non-empty frame-local text and one speaking panel.
- **Молчание** keeps the fixed-height dialogue area and shows it empty: no ellipsis and no placeholder.
- **Без реплики** removes the dialogue area. Visual panels use the full frame height.
- Dormant text and speaker state behave as Feature 015 specifies.
- The source draft is not changed.

### Presentation

The active **Диалог** tab is the section title. The pane starts with one segmented control for **Реплика**, **Молчание**, and **Без реплики**. The selected choice is marked by weight and a ring, not by color alone. Hover and keyboard focus are visible. All three labels stay fully readable at supported desktop and narrow widths: the control wraps or stacks instead of clipping or widening the page.

The pane does not show **Диалог кадра**, **Меняет только показ этого кадра. Черновик диалога не меняется.**, a **Сейчас:** line, a visible **Состояние** legend, or a visible **Текст реплики** label. The mode group keeps an accessible name, and the text field keeps the accessible name **Текст реплики**.

**Реплика** shows the text field immediately after the mode control. Its placeholder may read **Введите реплику** and is absent once text is present. A one-panel frame has no speaker selector. A two-panel frame shows a compact **Говорит** control with the current character names, or **Панель 1** and **Панель 2** when a name is missing. **Молчание** and **Без реплики** hide the text field and the speaker control and add no explanatory copy.

The owner can switch Frame Editor tabs without losing or being blocked by an unsaved dialogue draft. The draft remains while this editor stays open.

There is no persistent per-tab save bar. Close, previous frame, and next frame ask once, in a centered modal, only when that dialogue draft is dirty:

- **Сохранить** runs the existing frame-dialogue save once and continues only after success.
- **Не сохранять** restores the last persisted dialogue state and continues.
- **Остаться** closes the confirmation and keeps the draft.
- A failed save leaves the editor and the draft open and reports the existing safe error.

Committed structure, duration, and placement actions keep their immediate operation semantics. They are not treated as unsaved dialogue. There is no client-only undo stack.

## Panel tabs

Each panel tab keeps pan, zoom, horizontal mirror, reset, image basis, human-readable failure state, and the current production image-revision entry. The final frame stays visible. There is no second panel-only close or navigation shell.

That image-revision entry is temporary continuity. It reuses the current server behavior and provider semantics unchanged. This feature does not polish, expand, or accept it.

## Hidden, retained

These controls leave the reachable Stage A UI. Their stored data, server operations, schemas, and compatibility stay:

- performance or pose-reference input in the Frame Editor
- **Вставить текстовую карточку после** in the Storyboard inspector
- whole-source **Редактирование реплики** in the Frame Editor
- batch **Создать изображения кадра**
- any editable identity-reference control in the Frame Editor

The approved identity anchor may still be shown read-only and is still used automatically by existing generation. Text cards, performance-reference data, source revisions, generation operations, and provenance stay.

## Protected

- Source text, source links, frame and panel identities, semantic panel ownership, speaker transfer, assets, placement, and renderer geometry.
- Feature 022 code stays reachable until a replacement exists. Its product approach stays rejected.
- Provider prompts, payloads, call counts, timeouts, generation attempts, revision data, and last-good-image behavior do not change.
- Deterministic UI and placement actions make no provider call.
- Every committed storyboard-content operation keeps existing persisted global Undo and research capture.
- Failure is never reported as success.

## Out of scope

- The replacement panel-image interaction, and any change to provider requests, prompts, reference authority, timeouts, candidate persistence, or generation endpoints.
- Live-provider testing and AI usability testing.
- Redo.
- The four-stage shell in `DEC-081`.
- Per-frame approval and whole-Storyboard approval changes.
- Overview-card content accepted in Feature 019 and `DEC-083`.
- Layouts other than `single` and `split2`.
- Removing text cards from the product or schema.
- Source-revision contract repair.
- A framework, bundler, dependency, or broad architecture migration.

## Acceptance checkpoint

On a disposable project copy, with the no-call provider and zero live provider calls:

1. A populated split frame keeps the complete final frame visible.
2. Clicking the dialogue area and each visual panel opens the matching tab.
3. A dialogue draft survives tab switches. Close and frame navigation offer **Сохранить / Не сохранять / Остаться** only when that draft is dirty. A successful save survives reload.
4. **Молчание** is empty. **Без реплики** has no dialogue area.
5. Duration edits in seconds and frames stay synchronized, reset, survive reload, and Undo.
6. Add, swap, and delete follow the current panel rules, and Undo.
7. Maximum zoom, pan, and mirror stay clipped to the panel. The frame and controls do not resize, overlap, or collapse **Кадрирование** on pointer release.
8. The temporary legacy image-revision flow opens, and no generation is submitted.
9. The hidden actions are absent. Existing image, text-card, and reference data is not destroyed.
10. A supported narrow width and a desktop width both remain usable.
11. The **Диалог** pane uses the segmented presentation above and does not restore the removed chrome.
