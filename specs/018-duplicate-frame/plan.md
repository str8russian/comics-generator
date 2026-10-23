# Feature 018 plan

## Path

`POST /api/visual/operations` with `{ op: "duplicateFrame", structureFrameId, structureSegmentIndex }` → one transaction → `applyOperation` clones the structural frame after the source → one `storyboard_version` with instruction `duplicateFrame` → panel rows for the new panel ids copy the effective visual state by asset reference, with `current_generation_id` left null → head advances once → the response adds `operationResult.source` and `operationResult.created` → the browser opens that created address.

`displayFrameNumber` stays request context. It is not the address. A compound directing beat is cloned whole. The clicked segment index is context and selects which display card of the clone opens.

## Change surface

Verified before editing:

- `assembly.mjs`: `insertFrame`, `deleteFrame`, `reorderFrames`, panel ids, `visibleFrameSignature`, directing-beat `locate`.
- `visual-store.mjs`: `forkVisibleState`, `copyPanelState` by existing panel id, `ensurePanelRows`, operation context, global Undo.
- `public/app.js`: per-card assembly controls, `runAssembly`, research capture, `applyVisual` retaining the open detail by structure id.
- `server.mjs`: `/api/visual/operations` returns the ready payload and calls `dropCurrent` only when `invalidateRender` is set.
- `research-store.mjs`, `016` was the next migration number, and `specs/009-research-workspace-dock/contracts/research-event.schema.json`: semantic-action allowlist and context shape.
- `visual-model.mjs`: ordinary frames versus `directingBeat` expansion. Expansion was compatible with cloning the whole structural node, so the Feature 011 boundary stays.

No new endpoint. No render registry. No provider adapter.

## Identity and state copy

`duplicateFrame` rejects a missing id with `frame-not-found` and a non-array panel list with `invalid-request` before it clones. A valid source is cloned with `structuredClone`. The clone gets `frame-${id}` and every panel gets a new id. `dormantSpeakerPanelId` is remapped. `speakerPanel` stays the panel index because order is preserved. Unknown stored fields stay. The input array is not mutated.

`copyPanelState` still copies rows for panel ids that already exist, including the source panel's `current_generation_id`. That pointer is the existing version-copy model and inserts no `panel_generation` row. New panel ids match nothing there. `copyDuplicatedPanelState` then inserts one row per cloned panel from the parent version: same subject, performance asset, assigned and current asset ids and origins, zoom, pan, and mirror, and `current_generation_id` null. `ensurePanelRows` only fills a missing row or refreshes subject. The effective image does not depend on the generation pointer because `current_asset_id` is copied, and load already backfills that column before the mutation.

Duplicate sets `invalidateRender`, so the route drops the process-current render. The new version has no `visual_approval` row, so it is not approved.

## Trace

Migration `016_frame_duplicate.sql` adds `frame_duplicate` to the research check. The store allowlist and the research event schema match. The terminal may send `resultContext` with `createdStructureFrameId`, `createdDisplayFrameId`, `createdDisplayFrameNumber`, and `createdStructureSegmentIndex`. Those keys are merged into the terminal context only on success. The start context keeps the source address. Failure ignores a created address. The version `operation_context` stores the same source and created objects for Undo. Operations labels append the source id and the created display number and id.

## Tests

- Unit: split and single insertion, text card, compound beat, stale and invalid source, later edits isolated to the copy, research result context, Operations label.
- HTTP: existing operations route returns `operationResult`, a rejection does not, and the image generator is not called. Success drops the current render.
- UI: **Дублировать кадр**, one request, the copy opens at **Кадр N**, compound segment resolution, failure stays on the source, busy boundary, Undo returns to the source.
- PostgreSQL: one split frame whose panels differ in asset, performance reference, zoom, pan, mirror, dialogue, and duration. One version and one head move. New panel-state identities. Unchanged asset bytes and generation rows. Approval not carried. Reload. One Undo. A later copy edit does not change the source. Project isolation. `frame_duplicate` persists beside older semantic actions.

## Checkpoint

After the focused, offline, and PostgreSQL checks, commit, then start this worktree against the local `comics_test` Postgres with a fake provider. Leave one project URL for the owner. Do not call an image provider.
