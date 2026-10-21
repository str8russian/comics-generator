# Feature 017 plan

## Path

`POST /api/projects/{sourceProjectId}/duplicate` with `{ title }` → one repeatable-read transaction → a new project whose current draft, active material, latest checked storyboard, current visual rows, and reachable assets are new rows → `201` project presentation → the browser opens that project.

No migration. No generic graph copier. No shared asset rows. No provider call.

## Copy

`project-duplicate.mjs` copies explicit tables and remaps ids inside the transaction. `project-catalog.mjs` validates the title with `normalizeTitle` and returns the existing project presentation. The route ignores every body field except `title`.

The transaction locks the source project and draft, then reads one snapshot. It inserts the destination project and draft first. On any throw it rolls back, so a failure leaves no destination project, draft, or asset.

Copied when present: working draft; one ready carrier reading that is not current; the active source revision with no parent; its interpretation, source items, provisional characters, and surface forms; the active material with no parent; canonical characters, aliases, and speakers; character exclusions; the latest checked storyboard result and only its active version, with a null parent, null instruction, and null operation context; panel rows for that version with `current_generation_id` null; identity rows; approved anchor heads only, with no parent and no provider metadata; the style seed, retargeted at a copied approved anchor; Visual approval only when the source snapshot still matches the current visual state, with asset ids remapped.

Assets are inserted as new `visual_asset` rows owned by the destination. Provenance keeps accepted descriptive fields. `storyboardResultId`, `styleAssetId`, `sourceAssetId`, and `anchorVersionId` are rewritten when the target was copied and dropped when it was not.

Not copied: research events, readings other than the carrier, pending cast, older revisions, older storyboard versions, panel generations, non-head anchors, and render state. Render state is process memory and files, so a new project id has none.

The style seed's foreign key must point at a destination anchor. If the seed's original anchor is still an approved head, the copy points at that anchor's new id. If the original anchor is older than the current head, the seed asset is still copied and the foreign key points at a copied approved head. A non-head anchor row is not created.

## UI

`public/duplicate-project.mjs` builds the default title, the Russian failure text, and the dialog behavior used by the list and the workspace. Both pages post only `{ title }` and navigate only after `201`.

## Tests

- Unit and HTTP: title limit, validation, ignored foreign ids, status codes, Russian dialog behavior, and a provider counter that stays at zero.
- PostgreSQL: one populated fixture duplicated through the store, then mutated through draft, source, cast, dialogue, duration, placement, and asset assignment. Asset ids and foreign keys are disjoint. Rollback removes an induced failure. Purging either fixture graph is done only in the test and leaves the survivor readable.

## Checkpoint

The owner duplicates a disposable project from both pages in the real UI. The run does not call a model or an image provider and does not delete owner projects.
