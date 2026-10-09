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
- Visual: composable character layer; thin green fringe risk noted → edge cleanup required in implementation

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
- Reject character states that remain fully opaque or still contain large keyed-green regions.
- Apply bounded edge cleanup after keying to reduce fringe.
- Keep raw provider RGB bytes in provenance; store matted RGBA as the composited character asset.

### D2: Stable scene background lifecycle

**Decision**: During selected-frame hybrid generation, create one people-free scene background for the frame’s scene key if none is ready; otherwise reuse the current ready background while generating/retrying character states. Retries may regenerate a failed background operation. No mandatory background-approval gate and no dedicated user-facing background-edit workflow in feature 006.

**Rationale**: Matches the approved editorial clarification and keeps continuity without expanding into multi-scene UI.

**Alternatives rejected**: Independent background per panel; mandatory background approval step; silent full-scene fallback when background fails.

### D3: Character visual-state authority for first generation

**Decision**: First-generation hybrid character states use ordered references:

1. approved identity anchor (mandatory when subject exists);
2. approved project style authority when distinct.

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

**Decision**: Keep frame-level async feedback only. A selected-frame generation run has explicit phases: `background`, `character-states`, `assembly`, `complete` / `failed`. No fabricated percentages. Each mutating completion carries an operation token / generation id; older completions must not advance current pointers after a newer operation supersedes them. Previous ready assets remain visible during pending/failed replacements.

### D7: Immutable generation provenance + diagnostic export

**Decision**: Every provider request writes an append-only local generation record containing structured intent snapshot, exact compiled prompt, compiler/prompt version, model/settings, ordered reference manifest (roles, asset ids, hashes), omitted-reference reasons, status, safe failure metadata, latency, output asset id/hash/mime/dimensions/bytes, and application git commit when available. Exact prompts/images live in persisted provenance and explicit ZIP export, never routine logs. Export is local-only, frame-scoped, and excludes credentials and unrelated results.

### D8: Isolation and additive migration

**Decision**: Scope all hybrid component pointers and generation rows by `storyboard_version_id` (and thus indirectly by storyboard result). Matching semantic `frame_id` / panel index across versions must not share mutable current pointers. Structural edits continue to create new storyboard versions; feature 006 copies or re-resolves hybrid pointers conservatively without inventing cross-version reuse policy. Migrations are additive; existing anchors, style seed, panel generations, and Structure behavior remain readable.

## Confirmed findings vs assumptions

### Confirmed

- Current provider path does not return usable native alpha for transparent cutout requests.
- Controlled green backing + local keying can produce true RGBA character layers with the current adapter.
- Current renderer is a single-image-per-panel compositor; hybrid needs a layered extension of the same renderer.
- Current prompts and relational panel prose are concrete contributors to nested-layout and interlocutor leakage.
- Style seed and identity-anchor machinery from feature 005 can be reused as reference authorities.

### Assumptions carried into plan

- Simple chroma key plus bounded edge cleanup will be visually acceptable for the hard-outline comic style at panel size; human acceptance remains required.
- One scene key per selected ordinary dialogue frame is enough for this slice (no multi-scene manager).
- ZIP is an acceptable local diagnostic archive format for explicit export.
- Existing `POST /api/visual/frames/:frameId/generate` can be evolved into hybrid orchestration without preserving independent full-scene generation as the ordinary-dialogue success path.

## Out-of-scope research deliberately not pursued

- Batch/all-frame generation
- Performance-reference precedence
- White/black dual-render matting optimization
- Special/action full-panel generation
- Storyboard-wide state deduplication
)
