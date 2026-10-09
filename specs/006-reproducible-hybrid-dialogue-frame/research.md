# Research: Reproducible Hybrid Dialogue Frame

**Date**: 2026-10-09  
**Feature**: `006-reproducible-hybrid-dialogue-frame`

## Evidence summary

### Current full-panel path failures

Observed stored panel images and UI evidence show the current path asks the provider for a complete scene panel. Typical failures:

- nested comic/subpanel layouts inside an already split frame;
- interlocutor shoulders, silhouettes, or reflections inside a single-subject panel;
- independently invented rooms/lighting/props across panels of one conversation;
- individually plausible portraits that fail as a paired composition;
- insufficient immutable prompt/reference provenance for later reproduction.

Existing `panelPrompt()` still contains wording such as `Layout: one side of a two-panel split screen`, which encourages nested layout. Relational storyboard prose such as “addressing …” can pull the interlocutor into the image.

### Existing PNG alpha audit

Sampled 12 recent `visual_asset` PNG rows from the local `comics` database:

| Metric | Result |
|--------|--------|
| Assets with PNG alpha channel | 0 / 12 |
| Assets with `tRNS` | 0 / 12 |
| Color type | all `2` (RGB) |

Conclusion: current production assets are opaque RGB PNGs. A PNG extension or MIME of `image/png` does **not** imply usable transparency.

Evidence file: `research/existing-png-alpha-audit.json`

### Bounded provider foreground probe

Temporary research script: `research/provider-alpha-probe.mjs`  
Evidence directory: `research/provider-alpha-probe/`  
Exact provider request count: **2**  
Model: `gemini-3-pro-image-preview` via existing `image-provider.mjs`  
No production code, migrations, or database writes.

#### R1 — ask for native transparent PNG

- Outcome: success response, PNG `928×1152`, color type `2` (RGB), no alpha, no `tRNS`
- Visual: painted checkerboard “fake transparency”
- Conclusion: provider-native usable alpha is **not** available through the current adapter/model path

#### R2 — character on controlled `#00FF00` backing + local chroma key

- References: 1 identity/base-anchor image (style seed was the same asset, so not duplicated)
- Raw outcome: RGB PNG with flat green backing, sharp black comic outline
- Local key removed `394081 / 1069056` pixels (`36.86%`)
- Cutout: true RGBA PNG color type `6`, `minAlpha=0`, `maxAlpha=255`, `remainingGreenOpaquePixels=0`
- Visual: composable character layer is technically feasible, but a possible thin green fringe remains along some edges
- Conclusion: technical alpha creation is demonstrated; **visual edge quality is not fully accepted yet** and requires implementation-stage acceptance checks, contrasting composites, and fail-closed `matte-failed` behavior when cleanup cannot meet thresholds

Evidence file: `research/provider-alpha-probe/evidence.json`

## Decisions

### D1: Foreground-layer method

**Decision**: Use provider-produced single-character states against a controlled removable backing (`#00FF00`), then apply deterministic local chroma-key / edge cleanup in-process to store an RGBA character layer. Do not rely on provider-native alpha. Do not add a remote matting service.

**Rationale**: R1 proved native alpha is unavailable; R2 proved chromakey + local matting produces real alpha with no remaining keyed green pixels and preserves identity/style under the existing provider adapter. Cel-shaded hard outlines favor this method. Pure Node zlib PNG decode/encode keeps runtime/dependency cost low and remains deployable inside the current app.

**Alternatives considered**:

| Alternative | Result | Why rejected / deferred |
|-------------|--------|-------------------------|
| Provider-native RGBA alpha | Failed in R1; checkerboard RGB | Not available on current model/adapter |
| Infer transparency from `.png` / MIME | Invalid | Existing assets are RGB PNGs with no alpha |
| White/black difference matting (2 renders) | Plausible for softer edges | Doubles provider cost per state; not needed for first hard-outline comic cutouts |
| Remote remove-bg / segmentation service | Not evaluated in depth | Violates “no additional remote service” |
| Continue independent full-scene panels | Explicitly prohibited by approved spec | Would not satisfy hybrid boundary |
| Add heavy native deps (`sharp`, OpenCV) for v1 | Unnecessary for first slice | Extra licensing/deploy cost; pure Node codec + chroma key is sufficient for planning baseline |

**Implementation notes for later tasks**:

- Validate actual alpha after matting (`colorType` 4/6 and non-trivial transparent samples).
- Composite cutouts over light, dark, and strongly contrasting backgrounds; inspect hair/face/clothing/outline edges.
- Reject character states that remain fully opaque, retain green spill, or exceed fringe thresholds (`matte-failed`).
- Apply bounded edge cleanup after keying; preserve facial/clothing colors.
- Keep raw provider RGB bytes and derived RGBA cutout for diagnosis.

### D2: Stable scene background lifecycle

**Decision**: Use version-scoped scene identity `"primary"` for all ordinary dialogue frames in this slice. Sole current-background pointer is `scene_background_state.current_generation_id`. Scene-level write authority lives on the same row as `active_operation_id` + monotonically increasing `write_version`; those fields coordinate create/replace claims and are not a second generation pointer. Frames resolve the background through `frame_hybrid_state.scene_key` → scene background state. During selected-frame hybrid generation, create the people-free background if none is ready (after claiming scene write authority); otherwise reuse it without claiming replacement authority while generating/retrying character states. Retries may regenerate a failed background via a new frame operation that reclaims scene write authority. No mandatory background-approval gate and no dedicated user-facing background-edit workflow in feature 006.

**Rationale**: Matches the approved editorial clarification, avoids dual mutable background pointers, protects the shared primary-scene background against concurrent frame operations, and keeps continuity without inventing multi-scene UI.

**Alternatives rejected**: Independent background per panel; mandatory background approval step; silent full-scene fallback when background fails; inferring scene identity from mutable descriptions/prompts; dual current-background fields on frame and scene heads; relying only on frame-level operation tokens to guard the shared background pointer.

### D3: Character visual-state authority for first generation

**Decision**: Persist panel heads on existing `panel_visual_state` (`current_character_generation_id` + placement). Store append-only candidates in `character_visual_state_generation` referencing `panel_visual_state.id`. Do not create a separate `character_visual_state` table.

First-generation hybrid character states use ordered references:

1. approved identity anchor (required when subject exists);
2. approved project style authority as a distinct required role (even if the same underlying asset as identity).

Background generation receives required project style authority and no character identity. Missing required style or identity is validated before creating an operation and returns `409` (`style-required` / `anchor-required`) with no operation, no generation record, and no provider request. Text-only style continuation while claiming reproducible project style is prohibited. Panel regenerate additionally requires a ready primary-scene background; otherwise `409 frame-generation-required` with no operation/provider work.

Performance references and previous-result revision precedence remain outside this feature’s first-generation path. Later revision features may add them without changing the hybrid assembly contract.

### D4: Layered visual-intent compiler

**Decision**: Introduce structured visual intent separate from UI copy and from the compiled provider prompt. Compile:

- concise grid description;
- expanded human-readable detailed brief;
- exact self-contained provider prompt + ordered reference manifest.

Provider prompts for ordinary dialogue character states MUST:

- name only the assigned visible subject;
- treat other named people as off-screen relational context for gaze/reaction only;
- forbid rendering interlocutors, partial people, nested panels, gutters, dialogue, text, logos, watermarks;
- never ask for “one side of a split screen” or final comic layout;
- for character states, require controlled `#00FF00` backing and single-person cutout constraints;
- for backgrounds, require people-free scene continuity and project style language without identity transfer.

### D5: Deterministic hybrid renderer extension

**Decision**: Extend the existing shared `prototypes/storyboard-viewer/frame-renderer.mjs` rather than creating a second renderer. Visual hybrid mode draws:

1. one shared scene background under the panel strip (stable, not transformed by character zoom/pan);
2. per-panel clipped character layers with existing zoom/pan/object-position transforms;
3. existing gutter/divider and dialogue geometry.

`visualReady` becomes true only when the frame’s required background and all required character states are ready.

### D6: Async and stale-operation model

**Decision**: Use a persisted `visual_frame_operation` resource with statuses `running` \| `complete` \| `failed` only (no cancellation). Validate required authorities before creating an operation; on validation failure return `409` and create nothing. Accepted `POST /api/visual/frames/:frameId/generate` returns `202` with `operationId`. Canonical live phase polling is `GET /api/visual/frames/:frameId/operations/:operationId` for real phases (`preparing-background`, `generating-background`, `generating-character-states`, `assembling`, `complete`, `failed`). `GET /api/visual` may expose the latest operation summary only to restore `activeOperationId` after reload; the client then resumes canonical polling while running. No fabricated percentages, no timer-simulated phases, and no client-invented phase override. Frame operation `write_version` protects character/assembly heads; scene `active_operation_id` + `write_version` protect the shared background pointer. Previous ready assets remain visible during pending/failed replacements.

### D7: Finalize-once generation provenance + diagnostic export

**Decision**: Every provider request writes a finalize-once local generation record. Provenance inputs (intent, compiled prompt, references, model/settings, scope ids, etc.) are immutable after creation. Lifecycle fields finalize exactly once from `pending` to `ready` or `failed`. Terminal records are never rewritten or reused; retries create new generation and operation records. Exact prompts/images live in persisted provenance and explicit ZIP download, never routine logs.

Diagnostic export is concrete: `GET /api/visual/frames/:frameId/diagnostics` returns `application/zip` for the current result/version/frame, including operation/generation ids, briefs, prompts, negative constraints, reference roles/hashes, non-secret provider params, lifecycle/safe errors, background/raw/cutout/composite assets where available, placement, and assembly manifest. Excludes credentials, secret-bearing URLs, raw secret provider bodies, unrelated frames/results, and auto-upload.

### D8: Isolation and additive migration

**Decision**: Scope all hybrid component pointers and generation rows by `storyboard_version_id` (and thus indirectly by storyboard result). Matching semantic `frame_id` / panel index across versions must not share mutable current pointers. Structural edits continue to create new storyboard versions; feature 006 does not invent cross-version reuse policy. Migrations are additive; existing anchors, style seed, panel generations, and Structure behavior remain readable under explicit hybrid-vs-historical precedence.

## Confirmed findings vs assumptions

### Confirmed

- Current provider path does not return usable native alpha for transparent cutout requests.
- Controlled green backing + local keying can produce true RGBA character layers with the current adapter.
- Current renderer is a single-image-per-panel compositor; hybrid needs a layered extension of the same renderer.
- Current prompts and relational panel prose are concrete contributors to nested-layout and interlocutor leakage.
- Style seed and identity-anchor machinery from feature 005 can be reused as reference authorities.

### Assumptions carried into plan

- Version-scoped `"primary"` scene identity is sufficient for this prototype slice (no multi-scene manager).
- Persisted operations + canonical polling fit the existing local Node server better than streaming for honest phase visibility.
- Browser ZIP download is the diagnostic export format.
- Chromakey + cleanup can meet measurable acceptance thresholds for hard-outline comic cutouts after implementation tuning; this remains an implementation verification burden, not a planning claim of full visual acceptance.
- Ordinary dialogue success path uses hybrid components; historical full-panel assets remain readable under precedence rules without silent hybrid-success fallback.

## Out-of-scope research deliberately not pursued

- Batch/all-frame generation
- Performance-reference precedence
- White/black dual-render matting optimization
- Special/action full-panel generation
- Storyboard-wide state deduplication
