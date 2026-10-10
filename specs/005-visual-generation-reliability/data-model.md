# Data Model: Visual Generation Reliability

## New entity: `project_style_seed`

| Field | Type | Notes |
|-------|------|-------|
| `material_state_id` | uuid PK FK → `material_state` | One seed per material state |
| `style_asset_id` | uuid FK → `visual_asset` | Approved base-anchor image used as style-only authority |
| `source_anchor_version_id` | uuid FK → `character_anchor_version` | Anchor approval that created the seed |
| `created_at` | timestamptz | Immutable creation time |

Rules:

- Insert only when no seed exists for the material state.
- Never update `style_asset_id` in this feature.
- Backfill for existing projects: earliest approved anchor by `approved_at`, then `created_at`, then `id`.

## Extended lineage on `character_anchor_version`

| Field | Type | Notes |
|-------|------|-------|
| `style_asset_id` | uuid NULL FK → `visual_asset` | Style asset actually selected for the request, if any |

Existing approved rows remain valid with `NULL` style lineage.

## Unchanged entities

- `visual_asset`, `character_identity`, `panel_visual_state`, `panel_generation`, `storyboard_version`, `visual_approval` keep current meaning.
- Panel generation remains append-only; retry creates a new `panel_generation` and may advance `panel_visual_state.current_generation_id` on success.

## Client display model

Fitted display pieces may multiply one structure frame for dialogue overflow. Each piece must carry the same panel visual fields:

- `assetId`, `asset`, `zoom`, `position`, `align`
- `subject`, `generationStatus`, `generationError`
- `performanceAssetId`, `performanceAssetUrl`
- derived `visualReady`
