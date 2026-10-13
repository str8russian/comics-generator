# Implementation plan: Visual placement controls

## Approach

Extend the existing per-panel placement path. Do not add a rendition entity, history log, or command parser.

- Remove the dialogue-bar top border in the live storyboard stylesheet. Leave the 300 px bar, 1920×1080 frame, and 48 px `panelGutter` inline dividers in place.
- Add `mirrored boolean NOT NULL DEFAULT false` to `panel_visual_state` in one additive migration. Copy that column when an unchanged panel is copied forward.
- Keep `PATCH /api/visual/frames/:frameId/panels/:panelIndex/placement` as the only mutation. Omitted zoom, position, or mirror fields keep the stored values. `reset: true` writes zoom `1`, position `50/30`, mirror off. Reject non-finite or out-of-range values before writing.
- Render mirror as `scaleX(-1)` composed with the existing `scale(zoom)`, object-position, and transform-origin. Drag converts pointer deltas through the detail frame scale into focal percents and commits once on pointerup.
- Record `mirrored` on the existing `placement_commit` command target. Do not record pointer moves.

## Files

- Renderer/CSS: `prototypes/storyboard-viewer/frame-renderer.mjs`, `prototypes/storyboard-viewer/viewer.css`, `app/storyboard-web/public/app.css`
- State/API: `app/storyboard-web/visual-model.mjs`, `app/storyboard-web/visual-store.mjs`, `app/storyboard-web/server.mjs`
- UI: `app/storyboard-web/public/app.js`
- Trace: `app/storyboard-web/research-store.mjs`, `app/storyboard-web/public/research-dock.mjs`, `specs/009-research-workspace-dock/contracts/research-event.schema.json` (optional nullable `mirrored` only)
- Migration: `app/storyboard-web/db/migrations/006_panel_rendition_mirror.sql`
- Tests: renderer, visual model, visual workflow, research capture, research dock key list, postgres visual isolation

## Risks

- Approval snapshots gain `mirrored`. Comparison treats a missing value as false so an already approved board does not become unapproved merely because the column defaulted to off.
- Dialogue measurement keeps the same font ladder. The removed border no longer consumes 2 px inside the 300 px bar.

## Clarify / Analyze

Not used. The owner-visible defaults, mirror semantics, and persistence shape are fixed by the Block A prompt. The migration is one nullable-default boolean column.
