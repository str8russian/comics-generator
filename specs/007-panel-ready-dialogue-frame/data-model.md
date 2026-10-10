# Data Model: Panel-ready dialogue frame

**Conclusion**: **No schema changes are necessary.** The Happy Path works with existing entities from migrations `003_visual_storyboard_workflow.sql` and `004_project_style_seed.sql`.

## Reused entities

### `visual_asset`

Opaque stored image bytes (identity references, performance references, panel images, style-bearing outputs). Existing kinds and MIME/size checks remain.

### `character_anchor_version`

Approved stylized identity anchor per character. Eligible panel-ready generation requires an approved anchor for each resolved panel subject. Identity authority for provider requests uses the approved anchor output asset.

### `project_style_seed`

One style-authority asset per material state. Eligible panel-ready generation requires this seed. Style controls rendering language only.

### `panel_visual_state`

Per-frame, per-panel current pointer:

- `subject`
- `performance_asset_id` (optional, panel-scoped)
- `current_generation_id` (advances only on successful ready generation)
- `zoom`, `position_x`, `position_y` (placement; never implies provider work)

### `panel_generation`

Append-only generation attempts:

- `status`: `pending` | `ready` | `failed`
- `output_asset_id` set only when ready
- `error_kind` on failure
- `parent_generation_id` for revision lineage
- `performance_asset_id`, `anchor_version_id`, instruction/description snapshot fields as today

**Readiness rule (unchanged, required by spec)**:

- Displayed panel image follows `current_generation_id` when that generation is `ready`.
- A failed attempt does not move `current_generation_id`, so a previous ready image remains.
- Latest attempt status is the newest `panel_generation` row for the panel state and may be `failed` while the displayed asset remains the previous ready output.

### `visual_approval`

Unchanged. Human Visual approval remains a separate later gate; this feature does not auto-approve artistic quality.

## Derived / non-persistent concepts

These are compiler or response concepts, **not** new tables:

| Concept | Representation |
|---------|----------------|
| Eligible ordinary split-dialogue frame | Deterministic predicate over existing frame JSON |
| Panel-ready intent | Ephemeral compiler structure (side, role, gaze default, prohibitions) |
| Latest generation-attempt outcome | `generationFailures` on frame response + latest `generationStatus`/`generationError` |
| Current assembled-frame readiness | Every panel `assetId` present → `visualReady` |

## Explicitly rejected persistence

Do **not** add:

- `visual_frame_operation` or any operation/run table;
- intent/prompt persistence tables;
- new asset kinds for cutouts, mattes, or scene plates;
- migration 005-style hybrid columns;
- provenance or diagnostic archive tables;
- candidate-gallery or attempt-history UI backing tables.

If implementation discovers a Happy Path blocker that appears to need new persistence, stop and obtain owner approval; do not add it silently.

## Validation rules (application-level)

- Eligible frame generation requires resolved subjects, approved anchors for both, and project style seed before any provider call.
- Performance upload must parse as supported image bytes or fail with `invalid-image` without provider work.
- Provider success is the only path that inserts a new ready panel asset and advances `current_generation_id`.
- Placement updates touch only zoom/position fields.
