# Production workspace shell (W2a)

## Status

Production contract for Feature 019. It brings the owner-accepted W1 information architecture (`DEC-070`) into the production storyboard page. One owner-operated browser checkpoint. This does not claim owner acceptance.

The feature reorganizes the page. It adds no product capability. Every operation that was reachable before stays reachable, sends the same request to the same endpoint with the same JSON body, keeps its availability condition, busy boundary, research trace, provider behaviour, and Undo semantics. What changes is where controls live and how the page is navigated.

## Global header

The sticky header always shows **Проекты**, project rename, **Дублировать проект**, the global Undo with its current operation label, and the build marker.

Below it, a stage bar shows **История → Раскадровка → Персонажи → Визуал → Видео**. Each stage shows a short status derived only from state the page already loads. While the first load is still running, statuses show `…` instead of a guess.

| Stage | Status | Source |
| --- | --- | --- |
| История | Нет черновика · Черновик · Нужно подтвердить · Подтверждено | draft text, reading or material review, visual state present |
| Раскадровка | `N кадров` · Ошибка сборки · Заблокировано | displayed frames, blocked or failed staging |
| Персонажи | `a/b утверждены` · Нет персонажей · Заблокировано | `visual.characters[].approvedAnchorId` |
| Визуал | Утверждено · Нужно утвердить · `a/b готовы` · Нужны базовые образы · Заблокировано | `readyForVideo`, `complete`, `allAnchorsApproved`, `visual.frames[].visualReady` |
| Видео | Сборка идёт · Видео готово · Сборка не удалась · Готово к сборке · Визуал не утверждён · Заблокировано | loaded render status, `readyForVideo` |

Each stage view has one next action. It either navigates to another stage, moves focus to the existing control inside the stage (for example **Подтвердить**, **Собрать раскадровку**, **Утвердить визуальную раскадровку**, **Собрать видео**), or, in Визуал only, runs the relocated per-frame action for the first frame that still needs images: **Создать изображения кадра N** (the former card button, same handler and payload) or **Открыть кадр N** for a manual image frame. Focusing a control never triggers it.

The selected stage is client-side state, reflected in the URL hash as `#stage=<id>` so reload keeps it. On first load without a hash the page opens the stage of the current workflow position: Видео when the Visual storyboard is ready for video; Визуал when every panel has an image or every base anchor is approved; Персонажи when a storyboard with characters exists; Раскадровка when frames exist; otherwise История.

A locked stage can be opened. It shows **Заблокировано**, the reason, and a next action that navigates to the stage that unlocks it. It never enables an action that is unavailable today. Визуал without approved base anchors reads **Нужны базовые образы** and says that assigning a ready image still works. Видео is not locked by Visual approval, because rendering is available today without it; it shows **Визуал не утверждён** and a note that the required check lives in Визуал.

## Stage contents

- **История:** the draft form with autosave and conflict handling; material review with cast editing, **Подтвердить**, and **Собрать раскадровку**.
- **Раскадровка:** the structure instruction form, then the frame grid and inspector.
- **Персонажи:** the character cards and the base-anchor session (`DEC-056`), unchanged.
- **Визуал:** the visual heading and progress, the Visual approval gate as the first block (labelled as the required check before video, `DEC-044`), **Открыть последний кадр**, then the same frame grid and inspector.
- **Видео:** the ready-for-video notice and the render panel with transitions, intro, start, status, preview, download, and errors.

Раскадровка and Визуал share one grid and the existing `FrameRenderer` (`DEC-039`). The existing presentation rule (`presentFrameForMount`) always shows images for frames that have them, so both stages currently show the same frame presentation. A text-description presentation of frames that already have images needs a renderer mode this feature does not build.

Loading, notice, failure codes, failure kind, and the floating action status sit outside every stage view and stay visible on every stage while active.

## Content-first frame cards

A card shows **Кадр N**, the existing status text, the layout (or **Текстовая карточка**), the dialogue mode and speaker, the frame preview with the retained-image notice and outside-frame text, the dialogue or text-card text, one small basis label per panel, and the duration. Its only control is **Открыть**, which opens the Frame Editor. Clicking the card body, or pressing Enter or Space on the focused card, selects the frame; the selected card is outlined and has `aria-current="true"`. Double-click also opens the Frame Editor.

Cards contain no assembly, generation, or asset controls.

## Selection-driven inspector

Selecting a card shows an inspector for that frame. With nothing selected it shows a short hint; with no frames it is hidden. Selection is in memory only.

- **Header:** frame number, layout, **Открыть редактор кадра**, **Дублировать кадр**, and a clear-selection button.
- **Диалог:** **Реплика / Молчание / Без реплики** and, for two-panel frames, **Кто говорит**. These call the same `setFrameDialogue` save path as the Frame Editor with the stored line as text and the currently pressed or dormant speaker. A spoken mode without a stored line shows **Введите текст реплики.** and sends nothing. Text editing stays in the Frame Editor.
- **Время:** the existing duration input.
- **Кадр:** insert image frame after, insert text card after, move earlier, move later (disabled at the ends), delete frame, and the existing note for directing-beat segments.
- **Ещё** (collapsed): add panel, swap panels, delete panel N.k with the existing speaker-transfer confirmation, the manual panel subject, the text-card text, and **Выбрать изображение…** with upload and the carry-metadata choice.
- **Изображения:** **Создать изображения кадра** only under the former card condition (`allAnchorsApproved`, frame not ready, not a text or manual image frame), with the same busy text; plus one **Изображение панели N.k…** per panel, which opens the Frame Editor on that panel. No confirmation is added or removed.

After an operation, selection follows the stable structure address. After `duplicateFrame` the copy is selected and opened, as Feature 018 requires. If the selected frame disappears (delete, Undo of an insert or duplicate), the previous neighbour is selected, or nothing when the board is empty.

## Frame Editor and Panel Editor

The detail dialog remains the Frame Editor with its canvas, frame dialogue section, the utterance editor (still changing the draft, a known deferred issue), next-frame navigation, and generation status.

Its per-panel controls are grouped under **Редактор панели** with one tab per panel (**Панель 2.1 · Путин**). Opening a frame shows its first panel; selecting a tab or clicking a panel in the canvas switches the visible panel. Each panel has:

- **Изображение:** the basis label, its lineage and failure text, the instruction field, and the existing **Переделать эту панель / Создать эту панель** action.
- **Кадрирование:** zoom, a visible drag-to-pan hint, mirror, and reset with Feature 010 semantics.
- **Референсы:** the approved base anchor shown read-only as the identity reference, and the existing pose or expression photo input, labelled as affecting only this panel's pose, expression, and gaze (`DEC-032`). The photo is sent with the next generation of that panel, as before.

No **Refine current**, **New variation**, or equivalent wording is introduced.

## Panel basis label

The label is derived only from persisted data:

| Condition | Label |
| --- | --- |
| image with `assignmentOrigin` `generation` | Генерация |
| image with `assignmentOrigin` `upload` | Загружено |
| image with `assignmentOrigin` `reuse` | Выбрано из библиотеки |
| image with any other or missing origin | Изображение |
| no image, frame shown with base character portraits by `presentFrameForMount` | Базовый образ персонажа, with a hint that this is not a failed generation |
| otherwise | Нет изображения |

It appears in small form on cards, in the inspector panel blocks, and in the Panel Editor. No speaking/listening state mapping is implemented.

## Commands dock

The dock keeps Commands, Notes, and История операций, collapse, and resize (`DEC-052`). A scope line **Область: …** sits between the toggle and the dock body and shows the actual command target: **не выбрана**, **вся раскадровка**, or **панель N.k · Имя**. It is hidden only while the dock is collapsed to its accepted 148×40 handle, when no command can be typed.

Explicitly selecting a panel in the Panel Editor (tab, canvas click, or the inspector's **Изображение панели N.k…**) pre-selects the matching existing dock target. Opening the Frame Editor does not auto-select a panel, and frame selection in the grid changes nothing because the dock has no frame target. A pre-selected panel target executes exactly what choosing the same entry in the dock list executes.

## Protected

- Operation names, endpoints, request bodies, persistence, schema, migrations, store code, provider prompts, generation behaviour, and timeouts.
- Availability conditions, busy boundaries, research `semanticAction` values and context fields, and Undo behaviour of every moved control.
- Stage navigation, selection, the inspector, and opening editors make no API mutation and no provider call.
- No product state moves to chat or local storage; the stage hash is the only new client state.
- The only server change is three static routes: `/workspace-stages.mjs`, `/frame-inspector.mjs`, `/panel-basis.mjs`.

## Out of scope

R1 speaking/listening states; R2 panel revision; R3 performance-reference behaviour; W3 AI plans, push-in, silent bridge, plan preview; stale-dependency graphs or new invalidation; transparency, foreground compositing, background or matte controls; insert-before, redo, multi-select, batch UI, history browser; `setOwnerDescription` UI; the Feature 014 draft-mutation mismatch (`Q-037`); the projects page; render, Remotion, intro templates; a framework, bundler, TypeScript, or new dependency; a broad split of `app.js` or `server.mjs`; a text-description renderer mode for frames that already have images.

## Owner checkpoint

On a disposable copy of a real project, served from the Feature 019 worktree with a no-call provider:

1. See the five stages with truthful statuses and open each one.
2. Find a frame in Раскадровка or Визуал; select it and see its actions in the inspector, with no button rows on cards.
3. Duplicate it from the inspector and see the copy selected and opened.
4. Change dialogue mode and speaker from the inspector.
5. In the Frame Editor, pick a panel and find zoom, drag-to-pan, mirror, and reset, the basis label, **Переделать эту панель**, and the pose photo input.
6. See the dock scope follow the panel selection; reach Notes and История операций.
7. Undo the last change with the global Undo.
8. Reach the Visual approval gate and the Video stage with render controls.
9. Reach project rename, **Дублировать проект**, and the base-anchor session in Персонажи.
