# Gated single-panel revision — plan

One SpecKit Lite plan. No `tasks.md`, research note, or contract folder. The plan is justified by one additive migration and a change that crosses the Panel Editor, the panel compiler, draft persistence, and the existing provider boundary.

## Boundary

Initial panel creation and frame generation keep `generateOnePanel` and the existing immediate `finishPanelGeneration` promotion. A panel that already has a current image uses a separate revision route. That route still reaches the provider only through `deliverPreparedImage` → `executeImageRequest` → `generateImage`.

Feature 021 stays the only trace recorder. Revision attempts pass the existing opaque context with compiler id `panel-revision-intent` / `v1` and the candidate's `panel_generation` id. No trace column, viewer, or backfill is added.

## Modules

- `panel-revision.mjs` — effective-intent snapshot, supported patch, summary, Refine/New variation reference assembly, and prompt compilation. It does not append raw owner prose.
- `revision-route.mjs` re-exports the exact deterministic-control recognizer from `public/panel-revision-view.mjs`, so the browser and the server share one short phrase list.
- `visual-store.mjs` — open draft, candidate membership, selection, Accept, and Cancel. `beginPanelGeneration` can omit the previous image or use an explicit basis asset. `finishPanelGeneration` can record a candidate without promoting it.
- `server.mjs` — preview, open, candidate, navigate, accept, and cancel routes under the existing panel path.
- `public/app.js` — Russian Panel Editor actions, summary, candidate preview, and dock handoff into the same draft.

`matchSupportedPanelFacts` was added beside the existing constrained matchers. `extractUpperBody` still returns the same default when nothing matches.

## Persistence

Migration `021_panel_revision_session.sql` adds `panel_revision_session` and `panel_revision_candidate`.

The session stores project id, stable panel id, the baseline asset and generation, compiler identity, draft mode and instruction, lifecycle, the selected candidate, and the Accept or Cancel outcome with its timestamp and resulting storyboard version.

Each candidate stores ordinal, mode, visual-basis kind and asset id, the effective-intent snapshot, the `panel_generation` id, the performance asset id when one applies, and reference identities. It does not store image bytes, the provider prompt, or a copy of the trace.

One open session is allowed per project and panel. Accepted and cancelled rows stay in the database and are not shown as a history browser. The reusable-asset query excludes assets whose only ready generation is a revision candidate.

## Reference order

Refine sends identity, then the selected previous image, then performance if it fits, then style if it fits. Style is the role omitted at the three-image limit, with the existing `reference-limit` omission. The generation mode stays `revision`. New variation uses the same order without the previous image. Its mode is `performance` when a performance reference is sent and `initial` otherwise. Budget fitting cannot drop the Refine basis or start a second attempt.

## Verification

Focused domain tests cover inheritance, unsupported text, empty Refine, empty New variation, reference order, candidate selection, and the Russian summary. PostgreSQL tests on `comics_test` cover migration `021` on a fresh schema, the candidate lifecycle, Accept, Cancel, reload, provider failure, storage failure, Accept failure, Cancel failure, foreground failure, and trace failure. The offline suite and the isolated verifier cover the migration boundary. The browser checkpoint uses a synthetic fixture, a loopback fake provider, and a non-production port.

## Explicitly unchanged

Frame generation, initial create for a panel with no image, placement, upload, reuse, Feature 020 foreground fallback, Feature 021 fail-open tracing, and global storyboard Undo stay on their existing paths. No real provider call is added.
