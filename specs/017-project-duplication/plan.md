# Feature 017 plan

## Path

`POST /api/projects/{sourceProjectId}/duplicate` with `{ title }` → one repeatable-read transaction → a new project whose current draft, active material, latest checked storyboard, current visual rows, and reachable assets are new rows → `201` project presentation → the browser opens that project.

No migration. No generic graph copier. No shared asset rows. No provider call.

## Copy

`project-duplicate.mjs` copies explicit tables and remaps ids inside the transaction. `project-catalog.mjs` validates the title with `normalizeTitle` and returns the existing project presentation. The route ignores every body field except `title`.

The transaction locks the source project and draft, then reads one snapshot. It inserts the destination project and draft first. On any throw it rolls back, so a failure leaves no destination project, draft, or asset.

Copied when present: working draft; one ready carrier reading that is not current; the active source revision with no parent; its interpretation, source items, provisional characters, and surface forms; the active material with no parent; canonical characters, aliases, and speakers; character exclusions; the latest checked storyboard result and only its active version, with a null parent, null instruction, and null operation context; panel rows for that version with `current_generation_id` null; identity rows; the current approved anchor for each anchor head, with no parent and no provider metadata; the current style seed and the exact approved anchor it names; Visual approval only when the source snapshot still matches the current visual state, with asset ids remapped.

Assets are inserted as new `visual_asset` rows owned by the destination. Provenance keeps accepted descriptive fields. `storyboardResultId`, `styleAssetId`, `sourceAssetId`, and `anchorVersionId` are rewritten when the target was copied and dropped when it was not.

Not copied: research events, readings other than the carrier, pending cast, older revisions, older storyboard versions, panel generations, anchor candidates that are not a current approved head, and render state. Render state is process memory and files, so a new project id has none.

The current style seed names one exact approved anchor. That anchor is valid when its material and source revision belong to the same source project, even if the material is older than the active one. The destination seed points at the copy of that anchor. A current head reuses its existing destination id. An anchor that is not a current head is inserted once under the destination material, with a null parent, preserved provenance and instruction, remapped assets, and no head. A missing, unapproved, or other-project anchor, or a seed asset that cannot be copied, rolls the transaction back.

The image picker and duplication share `listReusableAssetRows`. That set is every project-owned `uploaded-image` or `panel-image` referenced by a current or assigned panel, a ready generation output, or an explicit reusable membership on the latest checked storyboard. Duplication copies that set and the active graph. Assets in the picker set are recorded on `storyboard_reusable_asset` for the destination result, so an image that was only reachable through history stays selectable without copying generations or older versions. Existing projects keep an empty membership table and the same derived picker. A project-owned image outside both the picker set and the active graph is not copied.

## UI

`public/duplicate-project.mjs` builds the default title, the Russian failure text, and the dialog behavior used by the list and the workspace. Both pages post only `{ title }` and navigate only after `201`.

## Tests

- Unit and HTTP: title limit, validation, ignored foreign ids, status codes, Russian dialog behavior, and a provider counter that stays at zero.
- PostgreSQL: one populated fixture duplicated through the store, then mutated through draft, source, cast, dialogue, duration, placement, and asset assignment. Asset ids and foreign keys are disjoint. Rollback removes an induced failure. Purging either fixture graph is done only in the test and leaves the survivor readable.

## Checkpoint

The owner duplicates a disposable project from both pages in the real UI. The run does not call a model or an image provider and does not delete owner projects.
