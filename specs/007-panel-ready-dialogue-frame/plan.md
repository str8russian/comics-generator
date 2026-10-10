# Implementation Plan: Panel-ready dialogue frame

**Branch**: `codex/007-panel-ready-dialogue-frame` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-panel-ready-dialogue-frame/spec.md`

**Note**: Plan-stage only. Tasks and implementation are out of scope for this commit.

## Summary

Improve the existing Visual workflow so one ordinary two-character `split2` dialogue frame generates two coordinated **panel-ready** character images on simple uniform backgrounds, then assembles them with the existing FrameRenderer for human review.

Technical approach (see [research.md](./research.md)):

1. Add a deterministic panel-ready intent/prompt compiler for eligible frames.
2. Fix reference assembly so identity and project style stay protected under the three-image provider limit; drop previous candidate first when slots are scarce.
3. Add frame-level preflight so missing subject/anchor/style blocks all provider work for the attempt.
4. Keep the current synchronous request path, `panel_generation` records, readiness-vs-attempt separation, placement/zoom, and FrameRenderer geometry.
5. Make no new persistence entities, workers, polling, hybrid compositing, or history UI.

## Technical Context

**Language/Version**: Node.js ESM (`.mjs`), browser JS module `public/app.js`

**Primary Dependencies**: existing `pg`, Node `http` server, contest chat-completions image adapter (`image-provider.mjs`), shared FrameRenderer

**Storage**: existing PostgreSQL schema from migrations `003_visual_storyboard_workflow.sql` and `004_project_style_seed.sql` — **no new migration**

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL tests require `STORYBOARD_TEST_DATABASE_URL` naming `comics_test`; provider doubles for deterministic offline tests

**Target Platform**: local `app/storyboard-web` + Docker Compose PostgreSQL; browser acceptance on the assembled frame

**Project Type**: web application (extend existing `app/storyboard-web/`)

**Performance Goals**: one selected frame per synchronous request; no batch/whole-storyboard generation

**Constraints**: DEC-032/036/044/047/048/049; preserve source fidelity and speaker ownership; no product-memory edits; no 006 hybrid architecture; exact prompt wording left to implementation within compiler rules

**Scale/Scope**: vertical improvement to one ordinary split-dialogue frame path inside the existing Visual workflow

## Constitution Check

The repository constitution template remains unfilled. This plan is gated by product-memory `GATEKEEPER.md` and `DEVELOPMENT_PROCESS.md`:

| Gate | Result |
|------|--------|
| User-visible outcome traces to browser acceptance | Pass — selected split2 frame → two panel-ready images → FrameRenderer review |
| Vertical Happy Path, not layer-only | Pass — compiler + preflight + reference order + UI honesty on existing sync path |
| Persistence/diagnostics/concurrency/recovery do not dominate | Pass — no new tables, operations, polling, or recovery |
| Deferred edge cases stay deferred | Pass — reload, cancel, overlap, hybrid, provenance, ZIP excluded |
| No open hypothesis promoted to architecture | Pass — panel-ready on uniform backgrounds is accepted DEC-048 |
| New mechanisms justify why smaller reuse is insufficient | Pass — only compiler/preflight/reference-order/UI honesty; everything else reused |
| Provider calls governed by purpose/evidence | Pass — Plan made 0 calls (no credentials); implementation verification may use live calls under DEC-049 |

**Post-design re-check**: Still pass. No complexity-tracking violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-panel-ready-dialogue-frame/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── panel-ready-frame-api.md
└── checklists/
    └── requirements.md
```

### Source Code (planned touch surface)

```text
app/storyboard-web/
├── visual-model.mjs          # eligibility, intent/prompt compiler, reference assembly
├── visual-store.mjs          # preflight helpers / style-required; keep generation records
├── server.mjs                # frame-level preflight before panel loop; sync handlers kept
├── image-provider.mjs        # reuse as-is (3-image limit, timeout/invalid-output kinds)
├── image-info.mjs            # reuse performance/image parse validation
├── public/app.js             # busy/attempt honesty; style-required + retained-previous copy
├── prototypes/storyboard-viewer/frame-renderer.mjs  # reuse only; no geometry change
└── test/
    ├── visual-model.test.mjs
    ├── visual-workflow.test.mjs
    ├── image-provider.test.mjs
    └── postgres/visual-isolation.test.mjs
```

**Structure Decision**: Extend the existing `app/storyboard-web/` Visual path only. No new app package, worker, or renderer.

## Complexity Tracking

No constitution/gate violations requiring justification.

## Implementation Approach

### 1. Panel-ready intent and prompt compilation

Introduce pure helpers in `visual-model.mjs` (names illustrative):

- `isEligiblePanelReadyDialogueFrame(frame)`
- `compilePanelReadyIntent({ frame, panelIndex, subject, ... })` → structured intent fields
- `compilePanelReadyPrompt(intent, referenceRoleFlags)` → provider prompt string

**Compiler inputs (deterministic)**:

| Input | Source |
|-------|--------|
| characterName / subject | `panel_visual_state.subject` / `resolvePanelSubject` |
| panelIndex / panel side | panel index 0 = left, 1 = right |
| speakerPanel | frame `speakerPanel` |
| description | panel description (kept for human context; compiler must not ask for scene layout) |
| instruction | optional revision text |
| performance present? | optional panel performance asset |
| reference role flags | from `assemblePanelReferences` |

**Compiler outputs**:

- prompt text communicating panel-ready constraints (exact wording is implementation detail);
- aspect ratio via existing `aspectRatioForFrame` (`5:4` for split2);
- reference image list from updated assembly.

**Deterministic rules to test**:

- eligible split2 → two independent panel requests, never one combined split image;
- speaking panel vs listening/reaction derived from `speakerPanel`;
- default inward gaze: left panel subtle screen-right, right panel subtle screen-left;
- when performance reference is included, prompt states it owns pose/expression/gaze/head/crop, not identity;
- prompt forbids extra people, nested/split-inside-panel, borders/text/bubbles/logos/watermarks, unwanted contradictory objects;
- prompt requires simple uniform non-scenic background;
- prompt must **not** contain “one side of a two-panel split screen” or finished comic-page assembly language.

Out-of-scope frames continue using the historical panel generation path so behavior does not silently change under the new contract.

### 2. Reference authority and ordering

Update `assemblePanelReferences`:

1. identity/anchor (required)
2. style when distinct (required for eligible path)
3. performance when supplied and slot remains
4. previous only if a slot remains

Expose omission metadata (e.g. `previousDropped`) for tests and safe logs. Prompt must still declare identity and style authority when previous is omitted.

### 3. Eligibility and preflight

Before the frame panel loop (eligible frames only):

1. eligibility check;
2. both subjects resolved;
3. both approved anchors present;
4. project style seed present;
5. stop with actionable kind and **zero** provider calls if any check fails.

Invalid performance on panel regenerate: reject via existing `parseImageDataUrl` → `invalid-image` before provider; do not replace ready pointer.

### 4. Existing synchronous flow

Keep:

- `POST .../frames/:id/generate` synchronous loop;
- `POST .../panels/:index/generate`;
- `PATCH .../placement`;
- client `runBusy` busy state;
- sanitized lifecycle logs.

Do not add operation resources, `202`, workers, polling, cancel, or concurrency control.

### 5. Partial attempt versus frame readiness

Preserve store semantics:

- success advances `current_generation_id`;
- failure leaves previous ready asset displayed;
- latest generation status can be `failed` while `assetId` remains.

Refine response/UI honesty:

- `generationFailures` non-empty ⇒ attempt not fully successful;
- if `visualReady` still true, say the frame remains reviewable with retained previous panel image(s) where latest status is failed;
- if failed panel has no `assetId`, frame not fully ready.

### 6. Failure handling map

| Failure | Already exists? | Minimum change |
|---------|-----------------|----------------|
| Missing approved identity/anchor | `anchor-required` per panel | Frame-level preflight; zero provider calls |
| Missing project style | Missing | Add `style-required` preflight + UI copy |
| Unresolved subject | Weak (skips anchor) | `subject-required` (or treat as preflight block) for eligible frames |
| Invalid performance image | `invalid-image` | Keep; ensure no ready-pointer move |
| Provider error | `provider` + preserve ready | Keep |
| Timeout | `timeout` | Keep |
| Invalid image output | `invalid-output` | Keep |
| Partial two-panel attempt | `generationFailures` + preserve ready | Honest attempt copy vs `visualReady` |
| Failed replacement with previous ready | `current_generation_id` unchanged | Distinguish retained previous in UI |

### 7. Placement and rendering

No changes to FrameRenderer geometry, dialogue fitting ownership, source wording, or speaker ownership. Zoom/placement remain provider-free.

## Verification Strategy

### Deterministic offline tests (provider doubles)

- intent/prompt compilation rules (side, gaze defaults, speaking/listening, prohibitions, uniform background, no split-screen-layout request);
- reference assembly priority and previous-dropped behavior;
- eligibility true/false matrix;
- frame preflight blocks with zero `generateImage` calls for missing anchor/style/subject;
- invalid performance rejected;
- provider/timeout/invalid-output preserve previous ready pointer;
- partial success with and without previous ready image;
- `visualReady` independent of latest failed attempt when previous ready retained;
- panel-scoped regeneration;
- placement does not call provider;
- regressions: source fidelity, speaker ownership, overflow visual metadata, out-of-scope frame path unchanged.

### Browser acceptance (real assembled frame)

See [quickstart.md](./quickstart.md):

1. Happy Path on one ordinary split2 with approved anchors + style.
2. Missing style / missing anchor → actionable block, no provider work.
3. Partial failure with previous ready retained → attempt partial, frame still reviewable, failure visible.
4. Zoom/placement without provider.
5. Panel-scoped regeneration with optional performance reference.
6. Human visual review of identity, style, gaze, role, crop, prohibitions — no automatic artistic approval.

Live provider calls during implementation verification are authorized by task purpose under DEC-049; Plan stage used none.

## Gatekeeper Confirmation

- Every implementation area traces to the browser acceptance scenario.
- Work remains a vertical improvement to one selected ordinary split frame.
- Persistence, diagnostics, concurrency, and recovery do not dominate.
- No deferred edge case entered the architecture.
- No open hypothesis became architecture.
- No major subsystem serves future reuse rather than this Happy Path.
- Every proposed change explains why smaller reuse of the base is insufficient (compiler wording, reference order bug, missing style preflight, attempt/readiness copy).
- Provider calls governed by purpose and evidence, not a quota; Plan count = 0.
