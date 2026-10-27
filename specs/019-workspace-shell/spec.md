# Production workspace shell (W2a)

## Status

Production contract for Feature 019. It brings the owner-accepted W1 information architecture (`DEC-070`) into the production storyboard page. One owner-operated browser checkpoint. This does not claim owner acceptance.

The feature reorganizes the page. It adds no product capability. Every operation that was reachable before stays reachable, sends the same request to the same endpoint with the same JSON body, keeps its availability condition, research trace, provider behaviour, and Undo semantics. What changes is where controls live and how the page is navigated. Story reading and staging later gained a truthful pending boundary, described under **Story reading and staging**; that boundary does not change the request.

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

Each stage view has one next action, except a Story step whose real control is already visible on the stage. A next action navigates to another stage, moves focus to an existing control that is not already the visible Story action (for example **Утвердить визуальную раскадровку**, **Собрать видео**, or a character card), or, in Визуал only, runs the relocated per-frame action for the first frame that still needs images: **Создать изображения кадра N** (the former card button, same handler and payload) or **Открыть кадр N** for a manual image frame. Focusing a control never triggers it.

On История, **Разобрать черновик**, **Подтвердить**, and **Собрать раскадровку** stay in the draft form and the material review. Those steps do not also render an upper **Дальше** button whose only behavior is to focus the same control. An empty draft may still focus the draft field. After the storyboard exists, История shows the cross-stage action **Перейти к раскадровке** and does not leave **Собрать раскадровку** as a second primary action. This remains the five-stage shell. The four-stage order in `DEC-081` is not implemented here.

The selected stage is client-side state, reflected in the URL hash as `#stage=<id>` so reload keeps it. On first load without a hash the page opens the stage of the current workflow position: Видео when the Visual storyboard is ready for video; Визуал when every panel has an image or every base anchor is approved; Персонажи when a storyboard with characters exists; Раскадровка when frames exist; otherwise История.

A locked stage can be opened. It shows **Заблокировано**, the reason, and a next action that navigates to the stage that unlocks it. It never enables an action that is unavailable today. Визуал without approved base anchors reads **Нужны базовые образы** and says that assigning a ready image still works. Видео is not locked by Visual approval, because rendering is available today without it; it shows **Визуал не утверждён** and a note that the required check lives in Визуал.

## Stage contents

- **История:** the draft form with autosave and conflict handling; material review with cast editing, **Подтвердить**, and **Собрать раскадровку**. Reading and staging follow **Story reading and staging** below.
- **Раскадровка:** the shared frame grid and inspector. There is no free-text structure-instruction block.
- **Персонажи:** the character cards and the base-anchor session (`DEC-056`), unchanged.
- **Визуал:** the visual heading and progress, the Visual approval gate as the first block (labelled as the required check before video, `DEC-044`), **Открыть последний кадр**, then the same frame grid and inspector.
- **Видео:** the ready-for-video notice and the render panel with transitions, intro, start, status, preview, download, and errors.

Раскадровка and Визуал share one grid and the existing `FrameRenderer` (`DEC-039`). The existing presentation rule (`presentFrameForMount`) always shows images for frames that have them, so both stages currently show the same frame presentation. A text-description presentation of frames that already have images needs a renderer mode this feature does not build.

Loading, notice, failure codes, failure kind, and the floating action status sit outside every stage view and stay visible on every stage while active.

## Story reading and staging

**Разобрать черновик** (`POST /api/projects/:id/readings` after the existing draft flush) and **Собрать раскадровку** (`POST /api/projects/:id/storyboard-results`) are the two long Story actions. One accepted activation starts one request and one research lifecycle (`reading` or `stage_storyboard`). The lock begins before the flush or the request, so a second click, submit, or keyboard activation cannot start another one. The Story work area is `aria-busy` and its controls are disabled for the duration. Notes stay on the existing global busy policy. There is no cancel, percentage, timer, provider name, or invented server phase.

While reading is pending the button reads **Разбираю черновик…**. While staging is pending it reads **Собираю раскадровку…**. The shared status shows that label, an indeterminate spinner, and **Это может занять некоторое время.** Success clears the lock. Reading success says **Черновик разобран. Проверьте разбор и подтвердите.** and shows the review, with **Подтвердить** under the existing validity rules. Staging success says **Раскадровка собрана.** and leaves **Перейти к раскадровке** as the next action. Failure clears the lock, keeps the draft or the confirmed review, keeps the existing failure kind and codes, and adds a plain retry sentence. One later activation may send one new request. A refresh during a request keeps today's semantics: the client does not resume a job the server does not expose.

## Content-first frame cards

An ordinary image or storyboard card shows **Кадр N**, the complete frame preview, and **Открыть**. It also shows the retained-image notice and outside-frame text when those values are present. Clicking the card body, or pressing Enter or Space on the focused card, selects the frame; the selected card is outlined and has `aria-current="true"`. Double-click also opens the Frame Editor.

The card does not show a layout name, an ordinary **Реплика** badge or speaker, the ordinary **Текст** status, a panel-basis chip, a duration summary, or the spoken line repeated under the preview. A text card still shows **Текстовая карточка** and its own text.

A card status appears only for an exceptional current fact:

- **Молчание** when `dialogueMode` is explicitly `silent`
- **Без реплики** when `dialogueMode` is explicitly `hidden`
- **Ошибка генерации** when any current panel has persisted `generationStatus: "failed"`, including when a previous image is retained

An ordinary spoken frame has no dialogue-mode status. A missing image without a failed generation is not labeled as an error. When both an exceptional dialogue mode and a generation failure apply, both stay visible, and the error is visually distinct from the neutral status. The timing editor stays in the inspector. Panel basis stays in the inspector and the Panel Editor.

The preview is the complete 16:9 frame, including both split panels and the dialogue region. Its width is the card content box and its height keeps 16:9, on the desktop card and in the narrow layout. The preview stays inside the card border without a horizontal card scrollbar, and without cropping, clipping, or masking the frame. Resize follows the current content width. `FrameRenderer` geometry is unchanged; only the card's mounting scale follows that content box.

Cards contain no assembly, generation, or asset controls.

## Selection-driven inspector

Selecting a card shows an inspector for that frame. With nothing selected it shows a short hint; with no frames it is hidden. Selection is in memory only.

- **Header:** frame number, layout, **Открыть редактор кадра**, **Дублировать кадр**, and a clear-selection button. The inspector has no dialogue section.
- **Время:** the existing duration input.
- **Кадр:** insert image frame after, insert text card after, move earlier, move later (disabled at the ends), delete frame, and the existing note for directing-beat segments.
- **Ещё** (collapsed): add panel, swap panels, delete panel N.k with the existing speaker-transfer confirmation, the manual panel subject, the text-card text, and **Выбрать изображение…** with upload and the carry-metadata choice.
- **Изображения:** **Создать изображения кадра** only under the former card condition (`allAnchorsApproved`, frame not ready, not a text or manual image frame), with the same busy text; plus one **Изображение панели N.k…** per panel, which opens the Frame Editor on that panel. No confirmation is added or removed.

After an operation, selection follows the stable structure address. After `duplicateFrame` the copy is selected and opened, as Feature 018 requires. If the selected frame disappears (delete, Undo of an insert or duplicate), the previous neighbour is selected, or nothing when the board is empty.

## Frame Editor and Panel Editor

The detail dialog remains the Frame Editor with its canvas, frame dialogue section, the utterance editor (still changing the draft, a known deferred issue), next-frame navigation, and generation status. **Реплика**, **Молчание**, **Без реплики**, speaker selection, frame-local dialogue text, validation, Add/Remove, save, Undo, and source-draft separation stay in this editor. The grid card and the inspector are not that editor.

Its per-panel controls are grouped under **Редактор панели** with one tab per panel (**Панель 2.1 · Путин**). Opening a frame shows its first panel; selecting a tab or clicking a panel in the canvas switches the visible panel. Each panel has:

- **Изображение:** the basis label, its lineage and failure text, the instruction field, and either **Создать эту панель** when the panel has no image or Feature 022's **Уточнить текущее** / **Новая вариация** draft when it already has one. The immediate **Переделать эту панель** action is no longer the owner path for a panel that already has an image.
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

It appears in the inspector panel blocks and in the Panel Editor. It does not appear on overview cards. No speaking/listening state mapping is implemented. Feature 020 adds a separate neutral extraction label beside this basis label in the Panel Editor (`Фон отделён` or `Фон не отделён`); the basis label itself is unchanged.

## Notes dock

The dock is one collapsible, resizable panel titled **Заметки**. It contains **Заметки** and read-only **История операций**. It does not contain a Commands target, draft, send control, command history, or scope line. Notes and Operations stay available, including their persistence and failure behavior. Product actions performed through normal controls are still captured. Historical command events remain in the persisted research trace and can still appear in Operations; removing the command box does not delete or rewrite them.

## Protected

- Operation names, endpoints, request bodies, persistence, schema, migrations, store code, provider prompts, generation behaviour, and timeouts.
- Availability conditions, research `semanticAction` values and context fields, and Undo behaviour of every moved control. Story reading and staging use the pending boundary above; their endpoints, JSON bodies, and research values stay the same. Other operations keep their existing busy boundaries.
- Stage navigation, selection, the inspector, and opening editors make no API mutation and no provider call.
- No product state moves to chat or local storage; the stage hash is the only new client state.
- The only server change is three static routes: `/workspace-stages.mjs`, `/frame-inspector.mjs`, `/panel-basis.mjs`.

## Out of scope

R1 speaking/listening states; R2 panel revision; R3 performance-reference behaviour; W3 AI plans, push-in, silent bridge, plan preview; stale-dependency graphs or new invalidation; transparency, foreground compositing, background or matte controls; insert-before, redo, multi-select, batch UI, history browser; `setOwnerDescription` UI; the Feature 014 draft-mutation mismatch (`Q-037`); the projects page; render, Remotion, intro templates; a framework, bundler, TypeScript, or new dependency; a broad split of `app.js` or `server.mjs`; a text-description renderer mode for frames that already have images.

## Owner checkpoint

On a disposable copy of a real project, served from the Feature 019 worktree with a no-call provider:

1. See the five stages with truthful statuses and open each one.
2. Find a frame in Раскадровка or Визуал. An ordinary card shows the frame number, the full preview, and **Открыть**. Exceptional statuses appear only for silence, hidden dialogue, or a persisted generation failure. Select the card and see its actions in the inspector, with no dialogue block and no button rows on cards.
3. Duplicate it from the inspector and see the copy selected and opened.
4. Open the Frame Editor and change dialogue mode, speaker, and frame-local text there. The preview stays inside the card at a desktop width and at the narrow layout.
5. In the Frame Editor, pick a panel and find zoom, drag-to-pan, mirror, and reset, the basis label, and the pose photo input. A panel that already has an image offers **Уточнить текущее** and **Новая вариация** instead of an immediate regenerate.
6. Reach Notes and История операций in the dock. There is no Commands box and no Storyboard structure-instruction block.
7. Undo the last change with the global Undo.
8. Reach the Visual approval gate and the Video stage with render controls.
9. Reach project rename, **Дублировать проект**, and the base-anchor session in Персонажи.
