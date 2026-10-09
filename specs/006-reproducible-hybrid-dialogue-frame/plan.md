# Implementation Plan: Reproducible Hybrid Dialogue Frame

**Branch**: `006-reproducible-hybrid-dialogue-frame` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-reproducible-hybrid-dialogue-frame/spec.md`

## Summary

Replace ordinary split-dialogue full-scene panel generation with a hybrid selected-frame path:

1. create or reuse one people-free scene background for the version-scoped `"primary"` scene;
2. create or reuse one single-character RGBA visual state per panel (provider chromakey + local matting with acceptance checks);
3. assemble both through the existing shared frame renderer with deterministic clipping, gutter, dialogue, zoom, and pan;
4. persist finalize-once generation provenance and support explicit local diagnostic ZIP download.

Acceptance may use the current visible frame 1, but no design hardcodes frame 1, character names, dialogue, or database ids.

## Technical Context

**Language/Version**: Node.js 24 ESM (`.mjs`), browser JavaScript modules

**Primary Dependencies**: existing `pg`, Node `http` server, contest image provider adapter (`image-provider.mjs`), shared `frame-renderer.mjs`; new in-process PNG chroma-key helper (pure Node zlib, no remote service)

**Storage**: local PostgreSQL (`comics` walkthrough, `comics_test` destructive tests); additive migration(s) under `app/storyboard-web/db/migrations/`

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL isolation tests; browser acceptance later during implementation verification

**Target Platform**: local Docker Compose database + `app/storyboard-web/server.mjs` on `127.0.0.1:4174`

**Project Type**: web application (`app/storyboard-web/` + shared renderer in `prototypes/storyboard-viewer/`)

**Performance Goals**: sequential selected-frame generation only; typically 1 background + N character provider requests per first successful frame; placement/zoom with zero provider calls; diagnostic export local and on-demand

**Constraints**: no silent full-scene fallback for ordinary dialogue; no batch generation; no second renderer/pipeline; no product-memory / main-checkout / image-spike edits; safe logs; result/version isolation; no mandatory background-approval gate; honest async phases via persisted operations (no timer-simulated progress)

**Scale/Scope**: one vertical hybrid-frame slice; additive schema; compiler + store + server + renderer + UI + provenance/export + tests

## Constitution Check

The repository constitution template remains unfilled. This plan follows the approved 006 spec and product principles from specs 003–005 / product memory: progressive fidelity, deterministic assembly, authority separation, honest async feedback, recoverable versions, and tests that distinguish contract correctness from probabilistic provider adherence.

Post-design re-check: one app, additive tables, one renderer extension, no remote matting service, no full-scene fallback escape hatch for ordinary dialogue panels, single background pointer ownership, persisted async operations.

## Project Structure

### Documentation (this feature)

```text
specs/006-reproducible-hybrid-dialogue-frame/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── hybrid-dialogue-frame-api.md
├── checklists/
│   └── requirements.md
├── research/
│   ├── existing-png-alpha-audit.json
│   └── provider-alpha-probe/
└── tasks.md                    # created later by /speckit-tasks, not this plan
```

### Source Code (implementation targets)

```text
app/storyboard-web/
├── db/migrations/005_hybrid_dialogue_frame.sql
├── image-info.mjs                 # extend: PNG color-type / alpha inspection
├── image-matte.mjs                # new: chromakey + edge cleanup + acceptance checks + RGBA encode
├── visual-intent.mjs              # new: layered intent + human briefs
├── visual-model.mjs               # hybrid prompt compilers; retire split-layout wording for ordinary dialogue
├── visual-store.mjs               # background/character-state lifecycle, operations, provenance
├── visual-diagnostics.mjs         # new: local ZIP diagnostic bundle builder
├── image-provider.mjs             # reuse as-is for provider transport
├── server.mjs                     # 202 operation accept, poll routes, diagnostics GET, safe logs
├── overflow.mjs                   # preserve hybrid fields through fitting
├── public/app.js                  # poll operation phases, hybrid readiness, diagnostics download, pan/fit
├── public/app.css                 # controls remain outside canvas
└── test/
    ├── image-info.test.mjs
    ├── image-matte.test.mjs
    ├── visual-intent.test.mjs
    ├── visual-model.test.mjs
    ├── visual-workflow.test.mjs
    ├── visual-diagnostics.test.mjs
    └── postgres/visual-isolation.test.mjs

prototypes/storyboard-viewer/
└── frame-renderer.mjs             # layered hybrid visual composition
```

**Structure Decision**: Extend the existing storyboard-web app and shared renderer. Do not create a second visual pipeline or microservice.

## Architecture Summary

```text
POST generate → 202 + operationId
  → persisted operation phases (real work only)
  → ensure primary-scene background (sole pointer on scene_background_state)
  → ensure character states on panel_visual_state heads
  → finalize-once generation records per provider request
  → assemble via shared renderer
  → Visual-ready only after background + all panel states ready + assembly validates
GET diagnostics → application/zip download for current version/frame
```

Mapping of approved functional areas:

| Area | Implementation location |
|------|-------------------------|
| Foreground layer feasibility | `image-matte.mjs` + `image-info.mjs` alpha/acceptance checks |
| Scene background lifecycle | `visual-store.mjs` + `scene_background_state.current_generation_id` |
| Character-state lifecycle / refs | `panel_visual_state` + `character_visual_state_generation` |
| Layered intent + prompts | `visual-intent.mjs`, `visual-model.mjs` |
| Deterministic composition | `frame-renderer.mjs`, placement on `panel_visual_state` |
| Async / stale ops | `visual_frame_operation` + server accept/poll |
| Provenance | finalize-once `generation_record` |
| Diagnostic export | `GET .../diagnostics` → ZIP |
| Isolation / migration | additive SQL + version-scoped keys |
| UI honesty / export | `public/app.js` polling + download |
| Verification | unit/contract/postgres/browser suites |

## Final persistence decisions

1. **Panel head**: extend existing `panel_visual_state` with `current_character_generation_id` and `fit_mode`; keep zoom/pan there. No `character_visual_state` table.
2. **Character candidates**: append-only `character_visual_state_generation` referencing `panel_visual_state.id`.
3. **Background pointer**: only `scene_background_state.current_generation_id`.
4. **Scene write authority**: `scene_background_state.active_operation_id` + monotonically increasing `write_version` protect shared background pointer updates; not a second generation pointer.
5. **Frame head**: `frame_hybrid_state` owns composition mode, `scene_key="primary"`, `active_operation_id`, assembly status—not a background pointer.
6. **Scene identity**: version-scoped `"primary"` for all ordinary dialogue frames in this slice.
7. **Async**: persisted `visual_frame_operation` (`running`\|`complete`\|`failed`); `POST` returns `202`; live phases from canonical poll endpoint only.
8. **Validation before accept**: missing style/anchor → `409` with no operation/provider work; panel regenerate without ready background → `409 frame-generation-required`.
9. **Provenance**: finalize-once records (immutable inputs; one terminal lifecycle transition).
10. **Diagnostics**: `GET /api/visual/frames/:frameId/diagnostics` → `application/zip`.

Details: [data-model.md](./data-model.md), [contracts/hybrid-dialogue-frame-api.md](./contracts/hybrid-dialogue-frame-api.md).

## Implementation Phases (inside feature 006 only)

### Phase A — Storage, operations, and provenance foundations

- Additive migration for scene background state/generations, character-state generations, frame hybrid state, visual frame operations, generation records, and expanded `visual_asset.kind` values.
- Extend `panel_visual_state` with `current_character_generation_id` and `fit_mode`.
- Keep historical `panel_generation` readable under precedence rules.
- Extend `image-info` with real alpha/color-type inspection helpers.

### Phase B — Matting, acceptance, and provider compile path

- Implement deterministic chromakey + edge cleanup + measurable acceptance checks.
- Retain raw chromakey and derived RGBA assets for diagnosis.
- Background and character-state compilers with required project style authority.
- Human-readable briefs vs compiled prompts; no split-layout provider wording.

### Phase C — Store lifecycle and async server orchestration

- Validate required style/identity (and panel-regenerate background readiness) before creating an operation.
- `POST .../generate` → create operation → `202`.
- Orchestrate real phases; canonical poll endpoint exposes them.
- Reuse ready primary-scene background without claiming scene replacement authority; create/replace background only after claiming scene `active_operation_id` / `write_version`.
- Retry failed background inside a new frame operation without a background-approval UI.
- Frame-scoped stale-write protection for character/assembly heads; scene-scoped stale-write protection for `current_generation_id`.
- Placement remains provider-free and character-only.

### Phase D — Renderer and UI

- Extend shared renderer for hybrid layers.
- Poll operation phases; no fake percents.
- Incomplete readiness never presented as full Visual.
- Diagnostics download control outside the 1920×1080 canvas.
- Visible frame number remains outside the canvas.

### Phase E — Verification

- Offline contract tests with doubles.
- PostgreSQL isolation/persistence/stale-operation tests.
- Chromakey acceptance tests with contrasting composites and saved visual evidence.
- Live provider + browser acceptance for the current frame 1 case during implementation verification.

## Detailed Design Resolutions

### 1. Foreground character layer

Chosen: controlled `#00FF00` provider backing + local deterministic matting → stored RGBA character asset.  
Planning probe proved technical alpha creation but did **not** fully accept visual edge quality (possible thin green fringe). Implementation must enforce acceptance checks and may fail with `matte-failed`. See [research.md](./research.md).

### 2. Stable scene background

- Scope: `(storyboard_version_id, scene_key="primary")`.
- Sole current pointer: `scene_background_state.current_generation_id`.
- Scene write authority: `scene_background_state.active_operation_id` + `write_version`.
- Frame resolves background only through `frame_hybrid_state.scene_key` → scene background state.
- Prompt uses required project style authority only; never character identity.
- Reuse ready background while retrying character states (no replacement claim); retry failed background via a new frame operation that claims scene write authority; no dedicated background-edit/approval UI.

### 3. Character visual states

- Head: `panel_visual_state`.
- Candidates: `character_visual_state_generation`.
- Authorities: required identity anchor for assigned subjects + required project style authority as distinct roles (even if same underlying asset).
- Missing style/identity → `409` before operation creation (no text-only silent fallback).
- Panel regenerate requires a ready primary background; otherwise `409 frame-generation-required`.
- Off-screen relational names may influence gaze only.
- Previous ready candidate remains visible while a replacement is pending/failed.

### 4. Layered visual-intent compiler

Structured intent → concise grid description, detailed human brief, compiled provider prompt + reference manifest.  
Normal UI shows briefs; diagnostics expose compiled prompts and negative constraints.

### 5. Deterministic hybrid renderer

Extend existing renderer only. Zoom/pan/fit apply to character layers owned by `panel_visual_state`. Background is frame-stable via scene association. Controls/frame number stay outside canvas.

### 6. Honest asynchronous state

Persisted operation resource with real phases and statuses `running` \| `complete` \| `failed` only. Validate authorities before accept; `POST` returns `202`. Canonical live polling is `GET .../operations/:operationId`. `GET /api/visual` restores `activeOperationId` after reload, then the client resumes canonical polling while running. No timer-simulated phases and no client-invented phase override. Frame write versions protect character/assembly heads; scene write versions protect the shared background pointer. Visual mode only after complete hybrid readiness + assembly validation.

### 7. Finalize-once generation provenance

Inputs immutable after create; lifecycle finalized exactly once to `ready` or `failed`; retries create new records/operations.

### 8. Diagnostic export

`GET /api/visual/frames/:frameId/diagnostics` returns `application/zip` for the current result/version/frame with the concrete contents listed in the contract.

### 9. Isolation and versioning

All hybrid/scene/operation rows key by storyboard version. Matching semantic frame ids across results/versions do not share mutable state.

### 10. Migration and historical coexistence

Additive migration only. Read precedence:

1. complete current hybrid assembly when available;
2. historical full-panel assets readable for non-migrated/historical frames;
3. after hybrid attempt begins, no silent full-scene success fallback;
4. failed/incomplete attempts retain previous valid visible result and show failure separately;
5. no automatic full-scene provider fallback.

### 11. Verification strategy

See Quickstart. Distinguish deterministic contracts, provider adherence, and human visual acceptance. Offline prompt tests never claim a provider image contains exactly one person.

## Chromakey acceptance (implementation-stage, not yet visually accepted)

Planning probe is technical evidence only. Implementation verification MUST:

1. Composite each derived cutout over light, dark, and strongly contrasting backgrounds.
2. Inspect hair, face, clothing, and antialiased outline edges.
3. Detect remaining green spill / unacceptable halos.
4. Preserve facial and clothing colors (no gross hue shift from cleanup).
5. Reject or mark the character-state generation `failed` (`matte-failed`) when deterministic cleanup cannot meet thresholds.
6. Retain raw chromakey asset and derived RGBA asset for diagnosis.
7. Save visual evidence artifacts for the acceptance case.

Measurable checks (baseline; tune only with recorded evidence):

- PNG color type is alpha-capable (`4` or `6`) with non-zero transparent samples.
- Opaque subject pixels with keyed-green dominance above threshold ≈ 0 (no remaining green spill on kept pixels).
- Edge-band green-fringe ratio below an explicit threshold after cleanup (record threshold in tests).
- Cutout must not be fully opaque and must not erase the majority of the expected subject bounding region.

## Transaction and failure boundaries

- Validate required authorities (and panel-regenerate background readiness) before creating an operation.
- Create operation + pending component generation + pending generation record before provider I/O.
- Provider I/O outside DB transactions.
- On success: store raw/matted assets, finalize generation record once; advance character/assembly heads only with frame write authority; advance background pointer only with matching scene write authority.
- On failure or stale authority: finalize own records as needed; leave previous ready pointers unchanged.
- Client observes live phases through the canonical operation poll endpoint; uses `GET /api/visual` for reload restore.

## Privacy / logging boundaries

Forbidden in routine logs: prompts, dialogue, image bytes/base64, credentials, Authorization headers, secret-bearing URLs, full provider bodies.  
Allowed: request serial, operation/event, result/version/frame/panel/component/operation ids, write version, status, safe failure kind, latency, model name, mime/width/height/byte_length/sha256, matte acceptance flags, git commit when available.

## Performance and storage implications

- First successful split frame ≈ 3 provider images (1 background + 2 characters) plus local matting CPU.
- Raw + RGBA assets increase storage versus one opaque panel image; acceptable for local prototype scale.
- Diagnostic ZIP generated on demand for browser download.

## Technical risks and mitigations

| Risk | Mitigation |
|------|------------|
| Provider paints checkerboard or non-green backing | Reject after alpha/key validation; retry |
| Green fringe / hair holes | Edge cleanup + measurable acceptance thresholds + saved composites; fail closed with `matte-failed` |
| Relational prose pulls second person | Compiler prohibitions for visible interlocutors |
| Nested layout regression | Remove split-layout provider wording |
| Long sync request hides phases | Persisted operation + `202` + canonical poll |
| Dual background pointers drift | Sole pointer on `scene_background_state.current_generation_id` |
| Shared background races across frames | Scene `active_operation_id` + `write_version` |
| Stale frame/panel races | Frame operation id / `write_version` |
| Missing style/identity silently weakens authority | Validate before accept → `style-required` / `anchor-required` |
| Panel regenerate invents background workflow | Require ready background → else `frame-generation-required` |
| Overflow drops hybrid fields | Preserve hybrid + placement metadata |
| Historical full-panel confusion | Explicit read precedence; no hybrid-success fallback |

## Complexity Tracking

No constitution violations requiring special justification. Local matting and persisted operations are required for honest hybrid assembly and async feedback; both are smaller than adding a remote segmentation service or a second rendering pipeline.
