# Data Model: Reproducible Hybrid Dialogue Frame

## Goals

- Represent hybrid components distinctly from historical full-scene panel images.
- Keep append-only generation history and immutable provenance.
- Isolate all mutable current pointers by storyboard version.
- Remain additive and backward-compatible with features 003–005 data.

## Asset kinds

Extend `visual_asset.kind` check to include at least:

| Kind | Meaning |
|------|---------|
| `scene-background` | People-free scene backdrop |
| `character-state-raw` | Provider RGB character image before matting (provenance) |
| `character-state` | Matted RGBA single-character layer used for composition |

Existing kinds remain valid: `identity-reference`, `base-anchor`, `performance-reference`, `panel-image`.

Validation additions:

- `character-state` MUST be PNG with real alpha channel and at least some transparent samples.
- `scene-background` SHOULD be opaque scene imagery (RGB/opaque PNG/JPEG/WebP as currently accepted).

## New / extended entities

### `scene_background_state`

Current background pointer for one scene inside one storyboard version.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `storyboard_version_id` | FK, isolation boundary |
| `scene_key` | stable scene identity string for the version (generic; not fixture-hardcoded) |
| `current_generation_id` | FK nullable → `scene_background_generation` |
| `updated_at` | timestamptz |

Unique `(storyboard_version_id, scene_key)`.

### `scene_background_generation`

Append-only background attempts.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `scene_background_state_id` | FK |
| `parent_generation_id` | nullable FK |
| `status` | `pending` \| `ready` \| `failed` |
| `error_kind` | safe kind |
| `output_asset_id` | FK `visual_asset` nullable |
| `style_asset_id` | style authority used, if any |
| `generation_record_id` | FK provenance |
| `created_at` | timestamptz |

Current pointer advances on success only when this generation is still the active operation.

### `character_visual_state`

Reusable single-character component for one panel slot in one storyboard version.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `storyboard_version_id` | FK |
| `frame_id` | semantic/visible frame id string |
| `panel_index` | int >= 0 |
| `subject` | assigned character name/id surface |
| `current_generation_id` | FK nullable → `character_visual_state_generation` |
| `zoom`, `position_x`, `position_y` | character placement only |
| `updated_at` | timestamptz |

Unique `(storyboard_version_id, frame_id, panel_index)`.

Placement fields may live here directly or remain on `panel_visual_state` with a join; plan preference is to keep placement on the character-state row (or keep `panel_visual_state` as the placement/head table pointing at current character-state generation) to minimize UI churn. Compatibility approach:

- Prefer extending `panel_visual_state` with `current_character_generation_id` and optional `composition_mode` while introducing generation tables for hybrid outputs;
- Or introduce `character_visual_state` and migrate placement reads through a compatibility view in store code.

Either way, historical `current_generation_id` → `panel_generation` remains readable.

### `character_visual_state_generation`

Append-only character-state attempts.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `character_visual_state_id` or `panel_visual_state_id` | FK |
| `parent_generation_id` | nullable |
| `anchor_version_id` | identity authority |
| `style_asset_id` | style authority if used |
| `raw_asset_id` | chromakey RGB asset |
| `output_asset_id` | matted RGBA asset |
| `status` | `pending` \| `ready` \| `failed` |
| `error_kind` | safe kind |
| `generation_record_id` | FK provenance |
| `created_at` | timestamptz |

### `frame_hybrid_state`

Frame-level hybrid readiness head.

| Field | Notes |
|-------|-------|
| `storyboard_version_id` | FK |
| `frame_id` | text |
| `scene_key` | scene association |
| `composition_mode` | e.g. `near-frontal-pair`, `inward-conversation`, `asymmetric-pair` |
| `current_background_generation_id` | nullable |
| `active_operation_id` | stale-operation token |
| `updated_at` | timestamptz |

Unique `(storyboard_version_id, frame_id)`.

`visualReady` derivation:

- required background generation ready;
- every required panel character-state generation ready;
- no required component missing.

### `generation_record` (immutable provenance)

One row per provider request made by this feature.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `operation_type` | `scene-background` \| `character-state` (extensible) |
| `storyboard_result_id` | isolation |
| `storyboard_version_id` | isolation |
| `frame_id` | nullable/text |
| `panel_index` | nullable |
| `scene_key` | nullable |
| `component_generation_id` | id of background/character generation row |
| `visual_intent_json` | structured intent snapshot |
| `compiled_prompt` | exact prompt text |
| `prompt_compiler_version` | string |
| `model` | model id |
| `generation_settings_json` | aspect ratio and other non-secret settings |
| `reference_manifest_json` | ordered `{role, assetId, sha256}[]` |
| `omitted_references_json` | `{role, reason}[]` |
| `status` | `pending` \| `ready` \| `failed` |
| `error_kind` | safe |
| `provider_status` | nullable int |
| `latency_ms` | nullable int |
| `output_asset_id` | nullable |
| `output_sha256` | nullable |
| `output_mime` | nullable |
| `output_width` / `output_height` / `output_byte_length` | nullable |
| `app_git_commit` | nullable |
| `created_at` | timestamptz |
| `finished_at` | nullable |

Routine logs must not dump `compiled_prompt` or image bytes.

## Unchanged / preserved entities

- `project_style_seed`
- `character_identity`, `character_anchor_version`
- `storyboard_version`, `storyboard_head`
- Historical `panel_generation` / `panel_visual_state` rows
- Structure storyboard frames JSON and dialogue fields

## State transitions

### Background / character-state generation

```text
(none) → pending → ready
                ↘ failed
```

- Retry creates a new generation row (`pending`) and may set `active_operation_id`.
- Success advances current pointer only if operation is still active.
- Failure never clears a previous ready pointer.

### Frame hybrid readiness

```text
incomplete → visual-ready when background + all panel character states are ready
visual-ready → incomplete if a required current component becomes missing after structural versioning
```

## Structural version changes

When a new `storyboard_version` is created by structural edit:

- create fresh hybrid head rows for the new version;
- do not mutate the previous version’s hybrid pointers;
- feature 006 does not define automatic cross-version hybrid reuse policy.

## Isolation rules

- No unique key may allow two storyboard versions to share a mutable current hybrid pointer.
- Diagnostic export enumerates assets only for the selected version/frame.
- Semantic sameness of `frame_id` / `panel_index` across results is not a join key for writes.

## Rollback considerations

- Migration is additive; rollback is “stop using new tables/columns,” not destructive delete.
- If hybrid generation is disabled, historical full-scene assets remain viewable where present.
- Do not DROP old `panel_generation` data as part of 006.
