# Research: Panel-ready dialogue frame

**Date**: 2026-10-10  
**Branch**: `codex/007-panel-ready-dialogue-frame`  
**Base**: `2715e2468d6b57e32a882efdd1c39024468d96c6`

## Evidence summary (starting base)

### Synchronous Visual path already exists

- Frame generate (`POST /api/visual/frames/:id/generate`) loops panels and awaits each `generateOnePanel` inside one HTTP request (`server.mjs`).
- Panel generate and placement use the same request-response path; placement is PATCH-only and does not call the image provider.
- Client `runBusy` shows truthful in-session busy copy; frame outcome returns `generationFailures` while still sending the refreshed visual state (HTTP 200).

### Readiness vs latest attempt already partially separated

On load (`visual-store.mjs`):

- `assetId` comes from `panel_visual_state.current_generation_id` only when that generation is `ready`.
- Failed `finishPanelGeneration` marks the new `panel_generation` failed and does **not** advance `current_generation_id`, so a previous ready image remains displayed.
- `generationStatus` / `generationError` come from the **latest** `panel_generation` by `created_at`, which can be `failed` while `assetId` still points at the previous ready output.
- Client `visualReady` is derived from every panel having an `assetId`.

This already supports SC-008’s distinction. Gaps are mainly honesty of attempt messaging when the frame remains reviewable, plus preflight completeness.

### Current panel prompt contradicts DEC-048

`panelPrompt` currently says Layout: `one side of a two-panel split screen` and does not require a simple uniform non-scenic background, panel-side awareness, deterministic inward gaze defaults, or full prohibitions against nested panels / extra people / scene objects.

### Reference limit is three images

`generateImage` rejects `images.length > 3`. Current `assemblePanelReferences` order is anchor → previous → performance → style. When all four are present, **style is dropped**. That violates FR-018 (identity and project style must not be silently displaced by a previous candidate).

### Style is not a hard preflight for panel generation

`beginPanelGeneration` requires an approved anchor when a subject exists, but allows a null style seed and still proceeds to the provider. Spec FR-029/FR-030 require zero provider work when required identity/style authority is missing for the attempted frame generation.

### Unresolved subject can skip anchor checks

If `resolvePanelSubject` returns null, `beginPanelGeneration` skips `anchor-required`. Spec requires both panel subjects resolved before provider work for the eligible Happy Path.

### Persistence already sufficient

Migrations `003` and `004` already provide `visual_asset`, `character_anchor_version`, `project_style_seed`, `panel_visual_state`, `panel_generation`, and `visual_approval`. Failed replacements, append-only generations, performance assets, and style seed already exist. No Happy Path gap requires a new table.

### Feature 006

Inspected only as a donor source in `/Users/andrey/Documents/Projects/comics-pipeline-visual-workflow-spike`. Hybrid orchestration, scene backgrounds, cutouts/chromakey, operation resources, polling, recovery, migration 005, diagnostics ZIP, and composition-mode selection remain rejected.

### Live provider research

No local `BASE_URL` / `CONTEST_API_TOKEN` credentials are present in this worktree. Plan decisions below are resolved from code evidence, accepted decisions, and donor inspection.

| Planned question | Call policy | Stop condition |
|------------------|-------------|----------------|
| Provider max reference images | Not needed — enforced in `image-provider.mjs` (`images.length > 3`) | Answered by code |
| Whether panel-ready uniform-background prompts can produce reviewable pairs | Deferred to implementation verification with real provider under DEC-049 (purpose: validate user-visible quality; evidence: assembled-frame review; stop when Happy Path accepted or repeated runs stop adding information) | Not a Plan blocker |

**Provider-call count this Plan stage**: `0`

## Decisions

### D1: Panel-ready intent compiler for eligible ordinary split2 frames

**Decision**: Add a deterministic panel-ready intent + prompt compiler in `visual-model.mjs` (new helpers; replace eligible-path use of the current `panelPrompt` split-screen wording). Each eligible panel compiles to one independent image request that states:

- exactly one assigned character;
- simple uniform non-scenic background;
- panel side (left/right index);
- gaze/head direction (deterministic inward defaults for split2: panel 0 subtle screen-right, panel 1 subtle screen-left, unless a performance reference owns staging);
- speaking vs listening/reaction from `speakerPanel`;
- shot scale chest-up with crop-safe margins for the actual panel aspect (`5:4` for split panels via existing `aspectRatioForFrame`);
- prohibitions: no additional people; no nested panels / split-screen-inside-image; no borders, captions, speech bubbles, logos, watermarks, generated text; no unwanted contradictory scene objects.

FrameRenderer remains the only assembler. Never ask the provider for “one side of a finished split comic.”

**Rationale**: Matches DEC-048 and FR-001–FR-017 with the smallest change surface: compile better panel requests on the existing sync path.

**Alternatives rejected**: Hybrid background+cutout path (DEC-048 / FR-037); automatic composition-mode selection (deferred); whole-storyboard generation.

### D2: Eligibility gate; preserve historical behavior for other frames

**Decision**: Define `isEligiblePanelReadyDialogueFrame(frame)`:

- `layout === "split2"`;
- exactly two panels;
- non-empty dialogue;
- integer `speakerPanel` in `{0,1}`;
- not `sourceRole === "action"` / silent action frames.

Eligible frames use the panel-ready compiler + frame-level preflight. Single, action, insert, montage, and other layouts keep the existing generation path and must not be forced through the new contract.

**Rationale**: Spec Happy Path is ordinary two-character split dialogue; gatekeeper forbids expanding to unusual types.

**Alternatives rejected**: Apply new contract to all layouts; invent automatic routing among composition modes.

### D3: Reference authority order under the three-image limit

**Decision**: Change `assemblePanelReferences` priority to:

1. **Identity anchor** (required when subject exists) — never dropped.
2. **Project style** (required for eligible panel-ready generation; included when distinct from identity) — never dropped in favor of previous.
3. **Performance** (optional, panel-scoped) — included when supplied and a free slot remains after identity+style.
4. **Previous candidate** — revision aid only; included only when a free slot remains after the above. When omitted under the limit, prompt text may mention continuity without sending the previous image; identity and style remain authoritative.

When identity asset id equals style asset id, send one image and state both roles in prompt text (same pattern as anchor assembly).

**Rationale**: Protects FR-009/FR-018 under the hard provider constraint already enforced in code.

**Alternatives rejected**: Keep dropping style for previous (current bug); raise provider limit (not available); omit performance when present (breaks panel-scoped performance); omit style when performance present (rejects accepted authority).

### D4: Frame-level preflight before any provider call

**Decision**: For eligible frame generation, run one preflight before the panel loop / before any `beginPanelGeneration` that will lead to a provider call:

- frame eligible;
- both subjects resolved;
- both approved identity anchors exist;
- project style seed exists;
- any supplied performance bytes parse as a valid image (panel path).

On failure: return actionable failure (`anchor-required`, `style-required`, `subject-required`, or `invalid-image`) with **zero** provider calls and without advancing ready pointers. Prefer a terminal failed response for the whole frame attempt rather than starting panel 0 after panel 1 is known-blocked.

Panel-scoped regeneration uses the same authority checks for that panel (and style), preserving invalid-performance rejection before provider work.

**Rationale**: Spec FR-029/FR-030 and gatekeeper admission test (missing authority occurs on the Happy Path without reload).

**Alternatives rejected**: Discover missing style only after panel 0 already called the provider; new operation table for blocked attempts.

### D5: Keep synchronous request flow

**Decision**: Preserve the current uninterrupted synchronous frame/panel HTTP handlers. Busy UI remains client `runBusy`. No `202`, workers, polling, cancellation, concurrency machinery, or `visual_frame_operation`.

**Rationale**: Happy Path already works synchronously; DEC-047 / FR-037 defer interruption hardening.

### D6: Partial attempt vs assembled-frame readiness

**Decision**: Keep using existing records:

- latest attempt outcome: `generationFailures` on frame response + latest `generationStatus`/`generationError` per panel;
- current readiness: `assetId` / frame `visualReady` from current ready generation pointer.

UI/copy refinements only: when `generationFailures.length > 0`, never claim the latest attempt fully succeeded, even if `visualReady` remains true because previous ready images were retained; surface that the retained image is previous when latest status is failed and `assetId` is still present. No history browser, candidate gallery, or readiness state machine.

**Rationale**: Matches corrected spec SC-008 with minimal change; evidence shows the data already supports it.

### D7: No new persistence or asset types

**Decision**: No new migration, table, column, asset kind, or operation entity. Reuse `visual_asset`, `character_anchor_version`, `project_style_seed`, `panel_visual_state`, `panel_generation`, `visual_approval`.

**Rationale**: Happy Path is possible with existing entities; gatekeeper rejects persistence-for-future-reuse.

### D8: Feature 006 donor classification

| Candidate | Classification | Rationale |
|-----------|----------------|-----------|
| `screenDirectionForCharacterPrompt` | **Adapt narrowly** | Useful inward left/right defaults; strip hybrid composition-mode vocabulary |
| Default prohibitions list (nested panels, text, borders, second person) | **Adapt narrowly** | Aligns with FR-014–FR-017; rewrite for uniform-background panel-ready, not chromakey |
| `validateStyleRequired` / `validateAnchorRequired` | **Adapt narrowly** | Small pure helpers for preflight kinds |
| Eligibility predicate shape (`isEligibleHybridDialogueFrame`) | **Adapt narrowly** | Rename/repurpose to panel-ready eligibility; keep out-of-scope frames off the new contract |
| `performanceRoleLabel` / speaking vs listening mapping | **Adapt narrowly** | Maps `speakerPanel` to speaking/listening without new persistence |
| `normalizeProviderOutcome` | **Reject** | Base `generateImage` already returns stable `ok`/`kind`/`timeout`/`invalid-output`; no Plan need |
| `compileSceneBackgroundPrompt`, shared backgrounds | **Reject** | DEC-048 / FR-037 |
| `compileCharacterStatePrompt` chromakey / #00FF00 / cutout path | **Reject** | Transparent/cutout/matte path rejected |
| `buildHybridVisualIntent`, composition-mode selection | **Reject** | Hybrid architecture and automatic mode selection deferred |
| `visual_frame_operation`, polling, recovery, diagnostics ZIP, migration 005, matte helpers | **Reject** | Explicit Product Gate exclusions |

## Alternatives considered and rejected

- Recreate Visual workflow or FrameRenderer — unnecessary; reuse base.
- Persist compiled prompts or intent rows — not required for Happy Path.
- Operation resource for partial attempts — deferred; sync response + existing generation rows suffice.
- Live provider prompt bake-off during Plan — blocked by missing local credentials; deferred to implementation verification under DEC-049.
