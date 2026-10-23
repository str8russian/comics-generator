# Plan: Production workspace shell (W2a)

## Base and change surface

Base: `master` at `6f0865c679311046c371088bdd1b736e3747de10`. Branch `codex/019-workspace-shell`.

| File | Change |
| --- | --- |
| `app/storyboard-web/public/index.html` | Sticky header with Undo, build marker, and stage bar; alerts outside stages; five stage views and one shared frames area with the inspector; titled Panel Editor wrapping `#detail-panel-controls`; dock scope line. All existing ids kept. |
| `app/storyboard-web/public/app.js` | Wiring and relocation: content-first `frameCard`; selection; inspector model and action closures built from the former `appendAssemblyControls`/`appendPanelAssembly` payloads; shared `submitFrameDialogue`; Panel Editor tabs and subsections inside `renderPanelControls`; stage facts and refresh points. |
| `app/storyboard-web/public/workspace-stages.mjs` (new) | Pure stage status, next action, default stage, hash; small nav/view/header controller. |
| `app/storyboard-web/public/frame-inspector.mjs` (new) | Inspector layout only; every control calls an action supplied by `app.js`. |
| `app/storyboard-web/public/panel-basis.mjs` (new) | Basis label derivation and chip. |
| `app/storyboard-web/public/research-dock.mjs` | `formatCommandScope` and the scope line update inside `renderTargetControls`. Target resolution and `sendCommand` untouched. |
| `app/storyboard-web/public/app.css` | Shell, cards, inspector, Panel Editor, scope line. |
| `app/storyboard-web/server.mjs` | Three static routes. |

No store, schema, migration, endpoint, or provider code changes.

## Control relocation map

Every row of `prototypes/w1-workspace/OPERATIONS_INVENTORY.md` at `08b36b6`. "Unchanged handler" means the control calls the same function with the same payload as before; rows marked with a parity scenario are proven against the recorded baseline (see Test strategy).

| # | Operation | Before | Now | Handler / proof |
| --- | --- | --- | --- | --- |
| 1 | `duplicateFrame` | card assembly row | Inspector header | unchanged · `duplicateFrame` |
| 2 | `setFrameDialogue` | Frame Editor «Диалог кадра» | Frame Editor (unchanged) + Inspector «Диалог» mode and speaker | same `submitFrameDialogue` → `runAssembly` · `setFrameDialogue.*` from both |
| 3 | `insertFrame` | card | Inspector «Кадр» | unchanged · `insertFrame.image`, `.text` |
| 4 | `deleteFrame` | card | Inspector «Кадр» | unchanged · `deleteFrame` |
| 5 | `reorderFrames` | card | Inspector «Кадр», disabled at ends | unchanged · `reorderFrames.earlier`, `.later` |
| 6 | `setDuration` | card number input | Inspector «Время» | unchanged · `setDuration` |
| 7 | `setTextCard` | card textarea | Inspector «Ещё» | unchanged · `setTextCard` |
| 8 | `addPanel` | card | Inspector «Ещё» | unchanged · `addPanel` |
| 9 | `reorderPanels` | card | Inspector «Ещё» | unchanged · `reorderPanels` |
| 10 | `deletePanel` | card, speaker-transfer confirm | Inspector «Ещё» «Удалить панель N.k», same confirm | unchanged · `deletePanel.listener`, `.speaker` |
| 11 | `setManualSubject` | card select | Inspector «Ещё» select | unchanged · `setManualSubject` |
| 12 | `assignAsset` | card picker + carry select | Inspector «Ещё», same picker and carry select | unchanged · `assignAsset.imageOnly`, `.carryMetadata` |
| 13 | `uploadAsset` | picker upload | same, from the inspector | unchanged · `uploadAsset` |
| 14 | `setOwnerDescription` | no UI | not shown, as today | — |
| 15 | `batch` | API only | not shown, as today | — |
| 16 | `storyboard_edit` fallback | research name only | not a control, as today | — |
| 17 | `placement` zoom | Frame Editor panel section | Panel Editor «Кадрирование» | unchanged · `placement.zoom` |
| 18 | `placement` pan | drag in canvas | same drag, plus a visible hint | unchanged · `placement.pan` |
| 19 | `placement` mirror | Frame Editor panel section | Panel Editor «Кадрирование» | unchanged · `placement.mirror` |
| 20 | `placement` reset | Frame Editor panel section | Panel Editor «Кадрирование» | unchanged · `placement.reset` |
| 21 | `panel-generation` | Frame Editor panel section; dock panel target | Panel Editor «Изображение» (same wording); Inspector «Изображение панели N.k…» opens it; dock unchanged | unchanged · `panelGenerate` from Frame Editor and inspector shortcut |
| 22 | performance photo | Frame Editor panel section | Panel Editor «Референсы» (same input read by regenerate) | unchanged |
| 23 | `frame_generate` | card button; «Создать следующий кадр» | Inspector «Изображения» (same condition); Визуал next action; next-frame button unchanged | unchanged · `frameGenerate` from inspector and Визуал next action |
| 24 | open frame detail | card preview, «Открыть и изменить», «Открыть последний кадр», next frame | card «Открыть», inspector «Открыть редактор кадра», card double-click, «Открыть последний кадр» in Визуал, next frame unchanged | `openDetail`, no request |
| 25 | `source_utterance_edit` | Frame Editor | Frame Editor | unchanged |
| 26 | `undoStoryboardEdit` | floating button | sticky header | unchanged |
| 27 | Reset to snapshot | prototype only | not applicable | — |
| 28 | `approveVisual` | below the grid | top of Визуал as the required gate; next action focuses it | unchanged |
| 29 | render start, transitions, intro | render panel | Видео stage | unchanged |
| 30 | render preview, download | render panel | Видео stage | unchanged |
| 31 | `anchor_generate` | characters workspace | Персонажи stage | unchanged |
| 32 | `anchor_approve` | anchor session | Персонажи stage | unchanged |
| 33 | `anchor_retire` | character card | Персонажи stage | unchanged |
| 34 | `anchor_restore` | character card | Персонажи stage | unchanged |
| 35 | `reading` | draft form | История | unchanged |
| 36 | `cast_edit` | material review | История | unchanged |
| 37 | `confirm_material` | material review | История; next action focuses it | unchanged |
| 38 | `stage_storyboard` | material review | История; next action focuses it | unchanged |
| 39 | `structure_edit` | structure form; dock storyboard target | Раскадровка; dock unchanged | unchanged |
| 40 | dock Commands | dock | dock, plus scope line and explicit-panel pre-selection | `sendCommand` unchanged · dock scope test |
| 41 | dock Notes | dock | dock | unchanged |
| 42 | dock Operations | dock | dock | unchanged |
| 43 | dock collapse, resize | dock | dock | unchanged |
| 44 | `project_rename` | header | header | unchanged |
| 45 | `project_duplicate` | header | header | unchanged |
| 46 | project create, open | projects page | projects page | unchanged |
| 47 | build marker | under the title | header | unchanged |

Totals: 23 rows relocated to a new surface (1, 3–13, 17–24, 26, 28, 47), 20 rows unchanged in place or only grouped into a stage view (2, 25, 29–46), 4 rows not shown as today or not applicable (14, 15, 16, 27). No operation became unreachable.

## Stage and status derivation

`workspaceFacts()` in `app.js` passes only loaded state to `deriveStages`: the draft textarea value, `review.mode`, `body.dataset.state` (`blocked`/`failed`), the displayed frames, the `/api/visual` payload, and the last loaded render status (`GET /api/visual/render`, or the running/failure outcome of the start request). Refresh points: `showReady`, `applyVisual`, `clearBoard`, `showTerminal`, `refreshConfirmation`, render status changes. `settleDefault()` runs once after the boot chain (in a `finally`), before which statuses show `…`.

## Dock scope

`renderTargetControls` writes `formatCommandScope(stickyTarget)` into `#research-commands-scope`. `selectDetailPanel(i, { explicit: true })` looks up the matching descriptor in `collectResearchCommandTargets().panels` and calls the dock's existing `selectCommandTarget`, which resolves it against the same available list the select uses.

## Test strategy

1. **Recorded baseline.** Before any production edit, a temporary script drove the pre-feature card, Frame Editor, and Panel controls on the base code through `test/workspace-harness.mjs` and wrote `test/workspace-operation-baseline.json`: method, path, JSON body, and the research start event (`semanticAction`, surface, submitted text, command target, context) for 26 scenarios. The script was not committed.
2. **Parity** (`test/workspace-shell.test.mjs`): each relocated control is driven in its new place and compared with the baseline entry by deep equality: 21 inspector cases, 9 Frame Editor cases, the inspector panel shortcut, and the Визуал next action (32 in total).
3. **Shell tests:** cards, keyboard selection, inspector sections and conditions, duplicate and Undo selection, delete neighbour, Panel Editor parts and tabs, basis label, dock scope and Notes/Operations separation, stage navigation and alerts, no side effects.
4. **Pure tests:** `test/workspace-stages.test.mjs`, `test/panel-basis.test.mjs`.
5. **Boot tests:** `test/workspace-boot.test.mjs` for the default stage without a hash, the hash on reload, and the Video default.
6. **Existing tests** changed only where they located controls on cards or pinned the route table.

All tests are offline and use fakes. No PostgreSQL lane is needed because no server or store behaviour changed.

## Browser checkpoint

Server: this worktree, `startServer({ migrate: false, env: {}, fetchImpl: refusing, imageGenerator: refusing, stores injected })` on `127.0.0.1:4191`, against the local database after a read-only check that no migration is pending. Data: a disposable copy of a real project made with **Дублировать проект**, titled `W2a checkpoint — <source title>`. A locked stage is shown on one empty fixture project in `comics_test`.

## Known gaps and conflicts

- Раскадровка and Визуал show the same frame presentation; see the spec.
- W1 locked Video until Visual approval; production renders without approval, so Video stays available with a truthful note.
- W1 put the assistant field under the header; `DEC-052` keeps Commands in the dock, which this plan follows.
- The dock's accepted collapsed size cannot fit the scope line; it is shown whenever the dock is expanded.
