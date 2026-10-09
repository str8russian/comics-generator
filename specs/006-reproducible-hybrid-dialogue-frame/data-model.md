# Data Model: Reproducible Hybrid Dialogue Frame

## Goals

- Represent hybrid components distinctly from historical full-scene panel images.
- Keep append-only generation history and finalize-once provenance records.
- Isolate all mutable current pointers by storyboard version.
- Remain additive and backward-compatible with features 003–005 data.

## Scene identity (feature 006)

This prototype has no general multi-scene model. Scene identity is **not** inferred from panel descriptions or prompts.

For every storyboard version, there is exactly one version-scoped primary scene:

```text
scene_key = "primary"
scope     = (storyboard_version_id, "primary")
```

Rules:

- All ordinary dialogue frames in this slice use that primary scene.
- The stable people-free background belongs to `(storyboard_version_id, "primary")`.
- Multi-scene detection and UI remain out of scope.
- A later slice may migrate or expand scene identity without changing the selected-frame user journey.

## Asset kinds

Extend `visual_asset.kind` check to include at least:

| Kind | Meaning |
|------|---------|
| `scene-background` | People-free scene backdrop |
| `character-state-raw` | Provider RGB character image before matting (provenance) |
| `character-state` | Matted RGBA single-character layer used for composition |

Existing kinds remain valid: `identity-reference`, `base-anchor`, `performance-reference`, `panel-image`.

Validation additions:

- `character-state` MUST be PNG with a real alpha channel and non-trivial transparent samples.
- `character-state` MUST pass chromakey acceptance checks (see plan/research); otherwise the generation finalizes as `failed` with `matte-failed`.
- `scene-background` is opaque scene imagery using currently accepted MIME types.

## Persistence choice (final)

### Head / placement owner: extend `panel_visual_state`

Do **not** create a separate `character_visual_state` table.

`panel_visual_state` remains the stable per-result-version, per-frame, per-panel head and the sole owner of local placement state.

Additive columns on `panel_visual_state`:

| Field | Notes |
|-------|-------|
| `current_character_generation_id` | FK nullable → `character_visual_state_generation.id`; selects the current hybrid character-state candidate |
| `fit_mode` | local placement mode, e.g. `manual` \| `fit` (default `manual`) |
| existing `zoom`, `position_x`, `position_y` | remain the character placement fields |

Historical `current_generation_id` → `panel_generation` remains readable for old full-panel assets. It is not the hybrid success pointer.

### Character candidates: `character_visual_state_generation`

Append-only immutable candidates. The head pointer on `panel_visual_state` selects the current one.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `panel_visual_state_id` | FK → `panel_visual_state.id` |
| `parent_generation_id` | nullable FK to prior character-state generation |
| `anchor_version_id` | required identity authority for a panel with an assigned subject |
| `style_asset_id` | required project style authority (distinct role even if same underlying asset as identity) |
| `raw_asset_id` | chromakey RGB asset |
| `output_asset_id` | matted RGBA asset when ready |
| `status` | `pending` \| `ready` \| `failed` |
| `error_kind` | safe kind |
| `generation_record_id` | FK → `generation_record` |
| `operation_id` | FK → `visual_frame_operation` when created by a frame operation |
| `created_at` | timestamptz |
| `finished_at` | nullable |

Candidate rows are not rewritten after terminal finalization. Retries insert new rows and may advance `panel_visual_state.current_character_generation_id` only on non-stale success.

## Background ownership (single source of truth)

### `scene_background_state`

Sole current-background pointer and scene-level write-authority owner for the version-scoped primary scene.

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `storyboard_version_id` | FK, isolation boundary |
| `scene_key` | always `"primary"` in feature 006 |
| `current_generation_id` | **sole** current-background-generation pointer → `scene_background_generation` |
| `active_operation_id` | nullable FK → `visual_frame_operation`; scene write claimant when creating/replacing the background |
| `write_version` | monotonically increasing integer; scene-level stale-write token |
| `updated_at` | timestamptz |

Unique `(storyboard_version_id, scene_key)`.

`active_operation_id` / `write_version` coordinate shared-background writes. They are **not** a second background-generation pointer. `current_generation_id` remains the only current background asset pointer.

Scene-level stale-write rules:

1. When an operation needs to create or replace the primary-scene background, it atomically claims scene write authority (`active_operation_id`, bump/capture `write_version`).
2. A completing background generation may advance `current_generation_id` only when both its `operation_id` and captured scene `write_version` still match the scene state.
3. A stale completion may finalize its own generation and provenance records but must not change `current_generation_id`.
4. A ready background is reused without claiming replacement authority.
5. Concurrent operations must not silently overwrite a newer background selection.
6. Frame-level `frame_hybrid_state.active_operation_id` / operation `write_version` remain for frame/panel character-state and assembly coordination; they do not alone authorize shared background pointer updates.

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
| `style_asset_id` | required project style authority used |
| `captured_scene_write_version` | scene `write_version` claimed when this generation started |
| `generation_record_id` | FK provenance |
| `operation_id` | FK → `visual_frame_operation` when created by a frame operation |
| `created_at` | timestamptz |
| `finished_at` | nullable |

`scene_background_state.current_generation_id` advances on success only when scene write authority still matches (`active_operation_id` + `write_version`).

### Background resolution for a frame

A frame never stores a competing current-background-generation pointer.

Deterministic resolution:

```text
frame_hybrid_state.scene_key
  → scene_background_state(storyboard_version_id, scene_key)
  → scene_background_state.current_generation_id
  → scene_background_generation.output_asset_id
```

In feature 006, `frame_hybrid_state.scene_key` is always `"primary"` for ordinary dialogue frames.

## Frame hybrid composition head

### `frame_hybrid_state`

Owns frame composition metadata, scene association, current operation, and readiness bookkeeping. Does **not** own the current background generation pointer.

| Field | Notes |
|-------|-------|
| `storyboard_version_id` | FK |
| `frame_id` | text |
| `scene_key` | `"primary"` in this slice |
| `composition_mode` | e.g. `near-frontal-pair`, `inward-conversation`, `asymmetric-pair` |
| `active_operation_id` | FK nullable → `visual_frame_operation`; current in-flight or latest tracked operation |
| `assembly_status` | `not-ready` \| `ready` \| `invalid` |
| `updated_at` | timestamptz |

Unique `(storyboard_version_id, frame_id)`.

`visualReady` derivation:

1. resolve background through scene association → current background generation is `ready` with an output asset;
2. every required panel has `current_character_generation_id` pointing at a `ready` character-state generation with a matted output asset;
3. deterministic assembly validation succeeds (`assembly_status = ready`).

## Async operation resource

### `visual_frame_operation`

Persisted selected-frame generation operation. Enables honest phase visibility without a long synchronous HTTP body.

| Field | Notes |
|-------|-------|
| `id` | uuid PK (`operationId`) |
| `storyboard_result_id` | isolation |
| `storyboard_version_id` | isolation |
| `frame_id` | text |
| `scope` | `frame` \| `panel` |
| `panel_index` | nullable; required when `scope = panel` |
| `write_version` | monotonic integer / token for frame-scoped stale-write protection (character states / assembly) |
| `phase` | `queued` \| `preparing-background` \| `generating-background` \| `generating-character-states` \| `assembling` \| `complete` \| `failed` |
| `status` | `running` \| `complete` \| `failed` |
| `error_kind` | safe kind when failed |
| `component_failures_json` | optional `[{ component, panelIndex?, kind }]` |
| `created_at` | timestamptz |
| `updated_at` | timestamptz |
| `finished_at` | nullable |

Rules:

- Required authorities are validated before creating an operation. Missing style → `409 style-required` with no operation and no generation record. Panel regenerate without a ready primary background → `409 frame-generation-required` with no operation and no generation record.
- Starting an accepted generation creates a new operation and sets `frame_hybrid_state.active_operation_id`.
- If the operation must create/replace the shared background, it also claims `scene_background_state` write authority; reuse of a ready background does not claim replacement authority.
- Worker/orchestrator advances `phase` as real work begins/ends.
- Frame/panel head pointer advances require matching frame operation authority; background pointer advances require matching scene write authority.
- Completions that fail those checks may finalize their own records but must not advance current pointers.
- Retries create a new operation (and new generation records), never reuse a terminal operation.
- Cancellation is out of scope; statuses are only `running`, `complete`, `failed`.

## Generation record finalize-once semantics

### `generation_record`

One row per provider request made by this feature.

**Immutable after creation** (request identity / provenance inputs):

- `operation_type`, scope ids (`storyboard_result_id`, `storyboard_version_id`, `frame_id`, `panel_index`, `scene_key`)
- `component_generation_id`, `operation_id`
- `visual_intent_json`, `compiled_prompt`, `prompt_compiler_version`
- `model`, `generation_settings_json`
- `reference_manifest_json`, `omitted_references_json`
- `app_git_commit`, `created_at`

**Lifecycle fields** may be finalized **exactly once** from `pending` to one terminal outcome (`ready` or `failed`):

- `status`, `error_kind`, `provider_status`, `latency_ms`
- `output_asset_id`, `output_sha256`, `output_mime`, `output_width`, `output_height`, `output_byte_length`
- `finished_at`

Rules:

- Terminal records cannot be rewritten or reused for a later attempt.
- Retries create new `generation_record` rows and new component generation rows.
- Routine logs must not dump `compiled_prompt` or image bytes.

Terminology used across artifacts:

- **Finalize-once generation record** — inputs immutable; lifecycle finalized once.
- **Immutable candidate / append-only generation** — component generation rows are not edited after terminal status; new attempts are new rows.
- Do not say “immutable generation record” to mean the whole row never changes status.

## Authority field requirements

For ordinary dialogue hybrid generation in this feature:

- Character-state `anchor_version_id` is required when the panel has an assigned subject; absence fails with `anchor-required` before any operation/provider work.
- Character-state `style_asset_id` is required; absence fails with `style-required` before any operation/provider work.
- Background `style_asset_id` is required; absence fails with `style-required` before any operation/provider work.
- Identity authority and project style authority remain distinct reference roles even when both currently resolve to the same underlying asset.
- Background generation MUST NOT receive character identity references.
- The system MUST NOT silently proceed with text-only style instructions while claiming reproducible project style.

## Hybrid vs historical full-panel read precedence

For a given current storyboard version and frame:

1. If a complete current hybrid assembly is available (`visualReady` via hybrid components), render that hybrid assembly.
2. Historical `panel_generation` / `panel-image` assets remain readable for historical versions or frames that have not begun hybrid generation.
3. After a hybrid generation attempt begins for the current frame/version, the system MUST NOT silently fall back to an old full-scene image while claiming hybrid success.
4. A failed or incomplete new hybrid attempt retains the previously visible valid result (hybrid if previously ready; otherwise prior historical display if still applicable) and surfaces the attempt failure separately.
5. No automatic full-scene provider fallback is added for ordinary dialogue panels.

## State transitions

### Background / character-state generation

```text
(none) → pending → ready
                ↘ failed
```

- Retry creates a new generation row (`pending`) under a new operation’s write authority.
- Character-state head advances only if frame operation/`write_version` is still authoritative.
- Background head advances only if scene `active_operation_id` + captured scene `write_version` still match.
- Failure never clears a previous ready pointer.

### Frame operation

```text
queued → preparing-background → generating-background → generating-character-states → assembling → complete
                                                                                         ↘ failed
```

If a ready background already exists, the operation may skip provider background work after `preparing-background` confirms reuse, then continue to character states. Phases reflect real work, never timers.

### Frame hybrid readiness

```text
not-ready → ready when background + all panel character states are ready and assembly validates
ready → not-ready/invalid if a required current component becomes missing or assembly fails validation
```

## Structural version changes

When a new `storyboard_version` is created by structural edit:

- create fresh hybrid/scene head rows for the new version as needed;
- do not mutate the previous version’s hybrid pointers;
- feature 006 does not define automatic cross-version hybrid reuse policy.

## Isolation rules

- No unique key may allow two storyboard versions to share a mutable current hybrid or background pointer.
- Diagnostic export enumerates assets only for the selected version/frame.
- Semantic sameness of `frame_id` / `panel_index` across results is not a join key for writes.

## Rollback considerations

- Migration is additive; rollback is “stop using new tables/columns,” not destructive delete.
- Historical full-scene assets remain viewable under the precedence rules above.
- Do not DROP old `panel_generation` data as part of 006.
