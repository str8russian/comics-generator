# W1 operations inventory

Baseline: `master` at `6f0865c679311046c371088bdd1b736e3747de10`. Every user-reachable operation or control in the production storyboard page (`app/storyboard-web/public/index.html`, `app.js`, and its `public/*.mjs` modules), the projects page, and every name accepted by the production operations dispatcher.

## Sources of names

- **Authoritative dispatcher:** `POST /api/visual/operations` → `visualStore.applyOperation` → `applyProductOperation` in `app/storyboard-web/visual-store.mjs`. It handles `uploadAsset` and `assignAsset` itself, rejects `batch` containing `duplicateFrame`, and delegates every other op to `applyOperation` in `app/storyboard-web/assembly.mjs`.
- **Version instructions:** `UNDO_LABELS` in `visual-store.mjs` (around line 213). It adds `placement` (`updatePlacement`, `PATCH …/panels/:i/placement`) and `panel-generation` (`finishPanelGeneration`), which use their own endpoints but create storyboard versions the same way.
- **Store actions:** `undoStoryboardEdit` and `approveVisual`, dispatched by `handleVisualSimple` in `server.mjs`.
- **UI → research mapping:** the `semanticAction` map in `runAssembly` in `public/app.js` (around line 772) plus every `semanticAction: "…"` literal in `app.js`, `anchor-session-ui.mjs`, `research-dock.mjs`, and `server.mjs`. This is a research-trace vocabulary, not a dispatcher.

`test/inventory.test.mjs` derives all four lists from code and fails if any name is missing below.

## Column meanings

- **Provider:** `image`, `text`, or `none`.
- **Version / Undo:** whether a successful change forks a `storyboard_version` that the single global Undo reverts. `applyProductOperation` forks a version for every changed op; `persistenceMode()` in `assembly.mjs` is exported but unused.
- **Placement in the prototype:** `Always visible` (no selection needed), `Inspector` (contextual panel after selecting a frame card), `Frame Editor`, `Panel Editor`, `More …` (collapsed disclosure inside the named surface), `Stage view` (inside one stage page), `Not shown`. "Wired" means the prototype dispatcher implements it in memory; "stub" means the control exists, goes through the same dispatcher, and explains itself inline without changing anything.

## Frame and panel assembly (production dispatcher)

| Operation | Current stage · UI location | Scope | Provider | Version / Undo | Placement in prototype | Reason / notes |
| --- | --- | --- | --- | --- | --- | --- |
| `duplicateFrame` (`frame_duplicate`) | Storyboard/Visual grid · per-card assembly row «Дублировать кадр» | frame (whole structural frame) | none | yes / one Undo | Inspector + Frame Editor header · wired | Copy goes right after the source, gets new frame and panel ids, is selected, renumbers, and one Undo removes it (`DEC-069`). Single op only; no batch. |
| `setFrameDialogue` (`frame_dialogue`) | Frame detail · «Диалог кадра»: mode radios, «Добавить реплику», «Удалить реплику», text, speaker radios | frame or beat segment | none | yes / one Undo | Inspector + Frame Editor · Dialogue section · wired for mode and speaker | Spoken/Silent/No line and the speaker radio are wired. Typing a new owner line is shown read-only: not wired, to keep scope to mode and speaker. |
| `insertFrame` (`frame_insert`) | Grid card · «Кадр с изображением после», «Текстовая карточка после» | storyboard position | none | yes / one Undo | Inspector + Frame Editor · Frame section · stub | Only "after" exists in the UI. The op also accepts `index`, which could express "insert before", but no control uses it. |
| `deleteFrame` (`frame_delete`) | Grid card · «Удалить кадр» | frame (whole structural frame) | none | yes / one Undo | Inspector + Frame Editor · Frame section · stub | Destructive; kept with the frame vocabulary, styled as danger. |
| `reorderFrames` (`frame_reorder`) | Grid card · «Переместить кадр раньше/позже» | storyboard order | none | yes / one Undo | Inspector + Frame Editor · Frame section · stub | Shown as Move earlier / Move later. |
| `setDuration` (`frame_duration`) | Grid card · number input + seconds readout | frame or beat segment | none | yes / one Undo | Inspector + Frame Editor · Timing · stub | The duration is always visible on the card; editing is a stub. |
| `setTextCard` (`text_card`) | Grid card · textarea on text cards | text frame | none | yes / one Undo | More (frame actions) · stub | Only offered for text cards. |
| `addPanel` (`panel_add`) | Grid card · «Добавить панель» (single → split2) | frame | none | yes / one Undo | More (frame actions) · stub | Layout change lives under More; layout is visible on every card. |
| `reorderPanels` (`panel_reorder`) | Grid card · «Поменять панели» | frame | none | yes / one Undo | More (frame actions) · stub | Speaker follows its panel in production. |
| `deletePanel` (`panel_delete`) | Grid card · «Удалить панель» per panel, with speaker-transfer confirm | panel | none | yes / one Undo | More (frame actions) · stub | One button per panel ("Remove panel N.k"). |
| `setManualSubject` (`panel_subject`) | Grid card · «Персонаж панели» select (manual panels only) | panel | none | yes / one Undo | More (frame actions / panel actions) · stub | Only offered when a panel has no character. |
| `assignAsset` (`asset_assign`) | Grid card · «Выбрать изображение…» anchored picker, plus the carry-metadata select | panel | none | yes / one Undo | More (panel actions) + More (frame actions) · stub | No provider call. The metadata-carry choice belongs inside this flow. |
| `uploadAsset` (`asset_assign`) | Picker · «Загрузить с диска…» | panel | none | yes / one Undo | More (panel actions) · stub | No provider call. |
| `setOwnerDescription` | No current UI control (removed from the primary assembly UI by Feature 011 Correction 3) | panel | none | yes / one Undo | Not shown | Accepted by the dispatcher but unreachable from today's UI; stored notes remain. |
| `batch` | No current UI control; API only | several ops | none | yes / one Undo | Not shown | W1 has no multi-select or batch. Batches containing `duplicateFrame` are rejected in production. |
| `storyboard_edit` | Research fallback name in `runAssembly` for an unknown op | storyboard | none | n/a | Not shown | Not a user control; listed so the mapping is complete. |

## Panel framing, generation, and frame detail

| Operation | Current stage · UI location | Scope | Provider | Version / Undo | Placement in prototype | Reason / notes |
| --- | --- | --- | --- | --- | --- | --- |
| `placement` (`placement_commit`) zoom | Frame detail · panel section · zoom slider 1–3 | panel | none | yes / one Undo | Panel Editor · Framing · wired | Preview while dragging the slider, one committed step on release (Feature 010). |
| `placement` pan | Frame detail · drag the image | panel | none | yes / one Undo | Panel Editor · Framing (arrow buttons + readout) and drag in the Frame Editor canvas · wired | Drag direction from `panByPointer`; arrows are labelled so pan is findable without knowing about drag. |
| `placement` mirror | Frame detail · «Отразить по горизонтали» | panel | none | yes / one Undo | Panel Editor · Framing · wired | Keeps zoom and pan. |
| `placement` reset | Frame detail · «Сбросить кадрирование» | panel | none | yes / one Undo | Panel Editor · Framing · wired | Zoom 1, 50/30, mirror off, this panel only. |
| `panel-generation` (`panel_generate`) | Frame detail · instruction textarea + «Переделать эту панель» / «Создать эту панель», optional performance photo; dock Commands with a panel target | panel | image | yes on success / one Undo | Panel Editor · Image revision («Refine current» / «New variation», future R2) + More (panel actions) · stub | Today's regenerate is the closest thing to "Refine current". The current-basis indicator is visible. |
| Performance photo on regenerate | Frame detail · «Добавить/Заменить фото позы или выражения» file input (part of `panel-generation`) | panel's visual state | image (with generation) | with generation | Panel Editor · References · Performance reference (future R3) · stub | Labelled separately from the identity reference (`DEC-032`). |
| `frame_generate` | Grid card · «Создать изображения кадра» / «Создать кадр»; detail · «Создать следующий кадр» | frame | image | yes on success / one Undo | Stage view (Visual next action) + More (frame actions) · stub | Expensive provider action stays out of the always-visible surface. |
| Open frame detail | Grid card preview click, «Открыть и изменить», «Открыть последний кадр», «Продолжить к следующему кадру» | frame | none | no | Always visible · card **Open** button; Frame Editor Previous/Next | The single primary affordance per card. Selecting a card opens the Inspector. |
| `source_utterance_edit` | Frame detail · «Редактирование реплики» (changes the dialogue draft — known deferred issue) | source utterance | none | new source state | More (frame actions) · stub | Labelled as changing the draft, so it is not confused with frame-local dialogue. |
| `undoStoryboardEdit` (`storyboard_undo`) | Floating global Undo «Отменить: …» | storyboard | none | moves head back | Always visible · top bar Undo · wired | One global Undo labelled with the operation and frame. No redo. |
| Reset to snapshot | — (prototype only) | prototype state | none | clears prototype history | Always visible · top bar · wired | Prototype-only control; reload does the same. |

## Workflow gates, characters, and story

| Operation | Current stage · UI location | Scope | Provider | Version / Undo | Placement in prototype | Reason / notes |
| --- | --- | --- | --- | --- | --- | --- |
| `approveVisual` (`visual_approve`) | Below the grid · «Утвердить визуальную раскадровку» | storyboard version | none | records approval | Stage view (Visual gate) · stub | Shown as a required gate before Video (`DEC-044`); disabled until every panel has an image. |
| `render` (Start render, transitions, intro) | Render panel · «Переходы», «Интро», «Собрать видео» | storyboard | none (Remotion) | no | Stage view (Video) · stub, locked until Visual approval | Selects are visible but disabled; no render runs. |
| Render preview / download | Render panel · `<video>` + «Скачать видео» | render output | none | no | Not shown | Render state lives in server memory and is not in the snapshot. |
| `anchor_generate` | Characters · «Создать изображение», «Уточнить образ», «Создать замену» → base-anchor session (upload ready anchor, generate from photo, refine, previous/next variant) | character | image (generate) / none (upload) | anchor versions, not storyboard | Stage view (Characters card) · stub | The whole session (`DEC-056`) stays out of W1. |
| `anchor_approve` | Base-anchor session · «Принять» | character | none | anchor head | Stage view (inside the stubbed session) · stub | Reached only through the session. |
| `anchor_retire` | Characters card · «Удалить» | character | none | anchor head | Stage view (Characters card) · stub | Destructive styling kept. |
| `anchor_restore` | Characters card · «Вернуть образ» after delete | character | none | anchor head | Not shown | Only appears after a delete, which is stubbed. |
| `reading` | Workspace · «Черновик диалога» + «Разобрать черновик», draft autosave and conflict buttons | project source | text | new reading | More (Story actions) · stub | Story is read-only in W1. |
| `cast_edit` | Material review · rename, include/exclude, alias and speaker selects | material | none | new material state | More (Story actions) · stub | Read-only cast list shown instead. |
| `confirm_material` | Material review · «Подтвердить» | material | none | material state | More (Story actions) · stub | |
| `stage_storyboard` | Material review · «Собрать раскадровку» | storyboard | text | new storyboard result | More (Story actions) · stub; Storyboard next action when empty | |
| `structure_edit` | «Что изменить в кадрах?» form; dock Commands with the storyboard target | storyboard | text | yes / one Undo | More (Story actions) · stub; its role moves to the AI command field (mock) | Natural-language edits become previewed plans in W3. |

## Shell, dock, and projects

| Operation | Current stage · UI location | Scope | Provider | Version / Undo | Placement in prototype | Reason / notes |
| --- | --- | --- | --- | --- | --- | --- |
| `dock_commands` target + send | Research dock · «Команды»: action select + textarea + «Отправить команду» | storyboard or open panel | text or image | per routed op | Always visible · AI command field (mock) with a scope chip replacing the target select | Mock only: static plan preview, Apply explains W3. |
| `dock_notes` | Research dock · «Заметки» | owner diary | none | no | Not shown | Stays a separate dock part (`DEC-052`); not merged into the AI field. |
| `dock_operations` | Research dock · «История операций» | read-only trace | none | no | Not shown | Same reason. |
| `dock_layout` collapse / resize | Research dock toggle and grip | UI | none | no | Not shown | Dock is outside W1. |
| `project_rename` | Workspace header and projects list · «Сохранить название» | project | none | no | Not shown | Title is shown read-only in the top bar. |
| `project_duplicate` | Workspace header · «Дублировать проект» | project | none | new project | Not shown | Project management is outside W1. |
| `project_create` / open | Projects page · «Новый проект», «Продолжить» | projects | none | new project | Not shown | Outside W1. |
| `build_marker` | Workspace · «Сборка …» | diagnostics | none | no | Not shown | Diagnostic only. |

## Ported code

The prototype ports, without editing the originals:

- `prototypes/storyboard-viewer/frame-renderer.mjs` (served as `/frame-renderer.mjs` to the production page): `FRAME_GEOMETRY`, `render`, `dialogueRegionVisible`, `visibleDialogueText`, `fontSizeFor`, `renditionTransform`, `panelContentSize`, `panByPointer`. Not ported: `measureDialogue` and the `compileOverflow` split in `overflow.mjs`.
- `app/storyboard-web/public/app.js`: `mountFrame` (scaled stage), `placementOf`/`commitPlacement` semantics, the dialogue-mode labels.
- `app/storyboard-web/assembly.mjs`: `duplicateFrame`, `setFrameDialogue`, `ensurePanelIds`, `remapPanels`, `locate`.
- `app/storyboard-web/visual-store.mjs`: `copyDuplicatedPanelState` (copy keeps asset, origin, placement, and performance reference; no generation pointer).
- `app/storyboard-web/visual-model.mjs`: `expandStoryboardFrames`, `resolvePlacementUpdate`.
- `app/storyboard-web/dialogue-mode.mjs`: `readDialogueMode`, `backfillDialogueModes`; `app/storyboard-web/timing.mjs`: duration and reveal helpers.

## Summary

- 47 rows: 16 assembly, 11 framing/generation/detail, 12 gates/characters/story, 8 shell/dock/projects.
- By placement: 4 always visible (card Open, Undo, Reset, AI command field for dock Commands); 6 Inspector + Frame Editor (2 wired: Duplicate, dialogue mode/speaker); 6 Panel Editor (4 wired framing rows, 2 future entry points); 13 under More; 6 in stage views (Visual next action and gate, Video render, Characters cards); 12 not shown.
- Wired in memory: `duplicateFrame`, `setFrameDialogue` (mode, speaker), `placement` (zoom, pan, mirror, reset), `undoStoryboardEdit`, and the prototype-only Reset.
- Not shown, with reasons: `setOwnerDescription`, `batch`, `storyboard_edit`, `anchor_restore`, render preview/download, Notes, Operations, dock layout, project rename/duplicate/create, build marker.
- Reachable in production code but not in today's UI: `setOwnerDescription`, `batch`, and index-based `insertFrame` ("insert before").
