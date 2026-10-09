# Implementation Plan: Reproducible Hybrid Dialogue Frame

**Branch**: `006-reproducible-hybrid-dialogue-frame` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-reproducible-hybrid-dialogue-frame/spec.md`

## Summary

Replace ordinary split-dialogue full-scene panel generation with a hybrid selected-frame path:

1. create or reuse one people-free scene background;
2. create or reuse one single-character RGBA visual state per panel (provider chromakey + local matting);
3. assemble both through the existing shared frame renderer with deterministic clipping, gutter, dialogue, zoom, and pan;
4. persist immutable generation provenance and support explicit local diagnostic export.

Acceptance may use the current visible frame 1, but no design hardcodes frame 1, character names, dialogue, or database ids.

## Technical Context

**Language/Version**: Node.js 24 ESM (`.mjs`), browser JavaScript modules

**Primary Dependencies**: existing `pg`, Node `http` server, contest image provider adapter (`image-provider.mjs`), shared `frame-renderer.mjs`; new in-process PNG chroma-key helper (pure Node zlib, no remote service)

**Storage**: local PostgreSQL (`comics` walkthrough, `comics_test` destructive tests); additive migration(s) under `app/storyboard-web/db/migrations/`

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL isolation tests; browser acceptance later during implementation verification

**Target Platform**: local Docker Compose database + `app/storyboard-web/server.mjs` on `127.0.0.1:4174`

**Project Type**: web application (`app/storyboard-web/` + shared renderer in `prototypes/storyboard-viewer/`)

**Performance Goals**: sequential selected-frame generation only; typically 1 background + N character provider requests per first successful frame; placement/zoom with zero provider calls; diagnostic export local and on-demand

**Constraints**: no silent full-scene fallback for ordinary dialogue; no batch generation; no second renderer/pipeline; no product-memory / main-checkout / image-spike edits; safe logs; result/version isolation; no mandatory background-approval gate

**Scale/Scope**: one vertical hybrid-frame slice; additive schema; compiler + store + server + renderer + UI + provenance/export + tests

## Constitution Check

The repository constitution template remains unfilled. This plan follows the approved 006 spec and product principles from specs 003–005 / product memory: progressive fidelity, deterministic assembly, authority separation, honest async feedback, recoverable versions, and tests that distinguish contract correctness from probabilistic provider adherence.

Post-design re-check: one app, additive tables, one renderer extension, no remote matting service, no full-scene fallback escape hatch for ordinary dialogue panels.

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
└── tasks.md                    # NOT created by /speckit-plan
```

### Source Code (implementation targets)

```text
app/storyboard-web/
├── db/migrations/005_hybrid_dialogue_frame.sql
├── image-info.mjs                 # extend: PNG color-type / alpha inspection
├── image-matte.mjs                # new: chromakey + edge cleanup + RGBA encode
├── visual-intent.mjs              # new: layered intent + human briefs
├── visual-model.mjs               # hybrid prompt compilers; retire split-layout wording for ordinary dialogue
├── visual-store.mjs               # background/character-state lifecycle, provenance, export assembly
├── visual-diagnostics.mjs         # new: local ZIP diagnostic bundle builder
├── image-provider.mjs             # reuse as-is for provider transport
├── server.mjs                     # hybrid frame orchestration, diagnostics export route, safe logs
├── overflow.mjs                   # preserve hybrid fields through fitting
├── public/app.js                  # frame-level async phases, hybrid readiness, export action, pan/fit
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
Selected split frame
  → build layered visual intent (scene + frame composition + per-panel)
  → ensure scene background (reuse ready / create / retry failed)
  → ensure character states (identity + distinct style refs; chromakey prompt; local matte)
  → write immutable generation records for every provider call
  → assemble via shared renderer (stable background + per-panel character placement)
  → Visual-ready only when all required hybrid components are ready
  → optional explicit local diagnostic ZIP export
```

Mapping of approved functional areas:

| Area | Implementation location |
|------|-------------------------|
| Foreground layer feasibility | `image-matte.mjs` + `image-info.mjs` alpha checks |
| Scene background lifecycle | `visual-store.mjs` + migration |
| Character-state lifecycle / refs | `visual-store.mjs`, `visual-model.mjs` |
| Layered intent + prompts | `visual-intent.mjs`, `visual-model.mjs` |
| Deterministic composition | `frame-renderer.mjs`, placement in `panel_visual_state` |
| Async / stale ops | `server.mjs` orchestration + generation ids/tokens |
| Provenance | `generation_record` (+ component generation rows) |
| Diagnostic export | `visual-diagnostics.mjs` + export endpoint |
| Isolation / migration | additive SQL + version-scoped keys |
| UI honesty / export | `public/app.js` |
| Verification | unit/contract/postgres/browser suites |

## Implementation Phases (inside feature 006 only)

### Phase A — Storage and provenance foundations

- Additive migration for scene backgrounds, character visual states, generation records, hybrid frame readiness pointers, and expanded `visual_asset.kind` values.
- Keep existing tables readable; do not delete historical `panel_generation` rows.
- Extend `image-info` with real alpha/color-type inspection helpers used by storage validation.

### Phase B — Matting and provider compile path

- Implement deterministic chromakey + edge cleanup.
- Replace ordinary-dialogue panel compile path with:
  - background prompt/compiler;
  - character-state prompt/compiler (no split-layout wording; relational off-screen rules);
  - human-readable briefs for grid/detail.
- First-generation references: identity anchor + distinct style seed only.

### Phase C — Store lifecycle and server orchestration

- Selected-frame generate becomes hybrid orchestration: background → character states → readiness.
- Reuse ready background on character retries; retry failed background without a separate background UI.
- Stale-operation protection on current-pointer updates.
- Preserve previous ready assets during pending/failed replacements.
- Placement endpoints remain provider-free and affect character layers only.

### Phase D — Renderer and UI

- Extend shared renderer for hybrid visual layers.
- Frame-level phase copy (no fake percents).
- Incomplete readiness never presented as full Visual.
- Explicit diagnostic export control outside the 1920×1080 canvas.
- Visible frame number remains outside the canvas.

### Phase E — Verification

- Offline contract tests with doubles.
- PostgreSQL isolation/persistence tests.
- Live provider + browser acceptance for the current frame 1 case during implementation verification (not during this planning stage).

## Detailed Design Resolutions

### 1. Foreground character layer

Chosen: controlled `#00FF00` provider backing + local deterministic matting → stored RGBA character asset.  
See [research.md](./research.md) D1 and probe evidence. Fail closed if matting cannot demonstrate real transparency or still contains keyed green.

### 2. Stable scene background

- Entity scoped to `storyboard_version_id` + scene key derived from the selected frame’s scene identity (generic; not fixture-specific).
- Prompt uses project style authority as style-only reference when distinct; never transfers character identity.
- People/text/borders/unrequested salient props prohibited in prompt and treated as rejectable failures when obviously violated by storage-time heuristics/review.
- Shared by both split panels through frame hybrid pointers.
- Spatially stable under character zoom/pan because renderer applies transforms only to character layers.
- Failed background retries allowed inside selected-frame generation; no dedicated background-edit UI in 006.

### 3. Character visual states

- One state per panel role for the selected frame/version.
- Authorities: approved identity anchor; project style seed when distinct.
- Intent carries speaking/listening/reaction role, frame composition mode, gaze/screen direction, shot scale, safe margins, prohibited content.
- Off-screen relational names may influence gaze only.
- Lifecycle: `pending` → `ready` / `failed`; current pointer advances only on newer successful completion; previous ready remains visible while replacement pending/failed.
- Stale-anchor: if required approved anchor is missing, fail with existing `anchor-required` class of error rather than generating without identity.

### 4. Layered visual-intent compiler

Structured intent object (planning shape, not UI) includes project direction, scene continuity, frame composition mode, panel subject, visible characters, role, shot scale, gaze, expression/pose, crop/safe margins, prohibitions.  
Outputs:

1. concise grid description;
2. detailed human brief;
3. compiled provider prompt + reference manifest.

Normal UI shows (1)/(2). Diagnostics expose (3).

### 5. Deterministic hybrid renderer

Extend existing renderer only. Zoom/pan/fit/reset apply to character layers. Background placement is frame-stable. Controls/frame number stay outside canvas. Incomplete hybrid components ⇒ Structure or partial visual presentation, never `visualReady=true`.

### 6. Honest asynchronous state

Frame operation phases: start → background → character-states → assembly/storage → complete/failed.  
Per-component status remains visible. No provider percentages. Stale completions ignored when operation token / generation id is not current.

### 7–8. Provenance and diagnostic export

Append-only generation records for every provider request. Explicit `GET`/`POST` export builds a local ZIP with manifest, intents, prompts, references, outputs, background, hashes, versions. No auto-upload. Safe logs retain allowlisted fields only.

### 9. Isolation and versioning

All hybrid current pointers and component rows key by `storyboard_version_id`. Structural edits create new versions; 006 does not invent cross-version reuse. Matching semantic frame ids across results/versions do not share mutable state.

### 10. Migration and compatibility

Additive migration only. Existing identity/anchor/style-seed/panel rows remain. Ordinary dialogue success path for newly generated frames uses hybrid components; historical full-scene panel images remain readable for old data. No destructive reset.

### 11. Verification strategy

See Quickstart and contracts. Distinguish:

- deterministic contract tests (compiler, matte, renderer, isolation, logs, export);
- provider adherence (live checks);
- human visual acceptance (paired composition / single-subject / shared background).

Offline prompt tests never claim the provider image contains exactly one person.

## Transaction and failure boundaries

- Begin component generation row + provenance pending record before provider call.
- Provider I/O outside DB transactions.
- On success: store raw + matted assets as needed, finalize generation record, advance current pointer only if still the active operation.
- On failure: mark generation failed with safe kind; leave previous ready pointer unchanged.
- Frame response can be partial; UI must show specific retryable failures.

## Privacy / logging boundaries

Forbidden in routine logs: prompts, dialogue, image bytes/base64, credentials, Authorization headers, secret-bearing URLs, full provider bodies.  
Allowed: request serial, operation/event, result/version/frame/panel/component ids, status, safe failure kind, latency, model name, mime/width/height/byte_length/sha256, git commit when available.

## Performance and storage implications

- First successful split frame ≈ 3 provider images (1 background + 2 characters) plus local matting CPU.
- RGBA character assets and raw chromakey inputs increase storage versus one opaque panel image; acceptable for local prototype scale.
- Diagnostic ZIP can be large; generate on demand and do not retain export archives unless the user saves them.

## Technical risks and mitigations

| Risk | Mitigation |
|------|------------|
| Provider paints checkerboard or non-green backing | Reject after alpha/key validation; retry with explicit backing constraints |
| Green fringe / hair holes | Bounded edge cleanup; human acceptance gate for frame 1 |
| Relational prose pulls second person | Compiler strips/rewrites visible-character constraints; prohibit interlocutor visibility |
| Nested layout regression | Remove split-layout provider wording; reject obvious border/gutter cues in review heuristics where practical |
| Stale async races | Operation tokens / generation ids on pointer updates |
| Overflow drops hybrid fields | Extend metadata-preserving overflow path from feature 005 |
| Scope creep into revision/performance/full-panel | Explicitly deferred; do not implement fallback that reintroduces full-scene ordinary dialogue |

## Complexity Tracking

No constitution violations requiring special justification. Local matting is required because native provider alpha is unavailable; it is smaller than adding a remote segmentation service or a second rendering pipeline.
