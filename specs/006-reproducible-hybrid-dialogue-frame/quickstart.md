# Quickstart: Reproducible Hybrid Dialogue Frame

## Architecture under test

- Version-scoped scene identity: `(storyboard_version_id, "primary")`
- Sole background pointer: `scene_background_state.current_generation_id`
- Scene write authority: `scene_background_state.active_operation_id` + `write_version` (not a second generation pointer)
- Panel head/placement: `panel_visual_state` (+ `current_character_generation_id`, zoom/pan/`fit_mode`)
- Character candidates: append-only `character_visual_state_generation`
- Async: validate authorities → `POST .../generate` → `202` + `operationId`
- Canonical live phases: `GET /api/visual/frames/:frameId/operations/:operationId`
- Reload restore: `GET /api/visual` exposes `activeOperationId`; client resumes canonical polling while running
- Operation statuses: `running` \| `complete` \| `failed` only
- Diagnostics: `GET /api/visual/frames/:frameId/diagnostics` → `application/zip`
- Required style authority for background and character states; required identity for assigned subjects
- Missing style/identity → `409` before operation creation; panel regenerate without ready background → `409 frame-generation-required`

See [plan.md](./plan.md), [data-model.md](./data-model.md), and [contracts/hybrid-dialogue-frame-api.md](./contracts/hybrid-dialogue-frame-api.md).

## Prerequisites

- Feature branch `006-reproducible-hybrid-dialogue-frame`
- PostgreSQL with `comics` (walkthrough) and `comics_test` (destructive automated tests)
- Env file with contest image credentials for live checks only
- Approved Structure storyboard, approved character anchors, and project style seed already present from prior slices

Server (implementation phase; not run during this plan-correction pass):

```sh
STORYBOARD_PORT=4174 STORYBOARD_HOST=127.0.0.1 DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics \
  node --env-file=/Users/andrey/Documents/Projects/comics-pipeline/.env.local app/storyboard-web/server.mjs
```

## Offline suite

```sh
node --test app/storyboard-web/test/**/*.test.mjs
```

Required coverage areas:

- PNG alpha inspection and chromakey/matte helpers + acceptance thresholds
- contrasting-background composite checks for cutouts
- visual-intent compiler: relational off-screen rules, no split-layout provider wording
- human brief vs compiled prompt separation
- required style/identity wiring and pre-operation `style-required` / `anchor-required`
- panel regenerate precondition `frame-generation-required`
- renderer layered composition + character-only zoom/pan/fit
- overflow/fitting preserves hybrid fields
- finalize-once generation-record semantics
- operation accept (`202`), canonical phase polling, reload restore via `GET /api/visual`
- frame-scoped and scene-scoped stale-write protection
- diagnostic ZIP contents and credential exclusions
- hybrid vs historical full-panel read precedence

## PostgreSQL suite

```sh
STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
  node app/storyboard-web/test/postgres/verify.mjs
```

Must cover:

- additive migration compatibility with existing visual rows
- sole background pointer ownership and primary-scene resolution
- scene write authority claim/reuse/stale-completion behavior for shared background
- `panel_visual_state` head + character-generation candidates
- result/version isolation for backgrounds, character states, placement, operations, provenance
- reload recovery of active operation and hybrid readiness/placement
- previous ready asset retention on failed replacement
- no silent full-scene fallback after hybrid attempt begins

Do not point destructive helpers at `comics`.

## Planning-stage research already captured

```sh
# Existing asset alpha audit
cat specs/006-reproducible-hybrid-dialogue-frame/research/existing-png-alpha-audit.json

# Provider probe evidence (2 real requests during original planning; do not re-run for this correction)
cat specs/006-reproducible-hybrid-dialogue-frame/research/provider-alpha-probe/evidence.json
```

The probe proves technical RGBA creation. Visual fringe quality is **not** fully accepted yet; implementation must enforce chromakey acceptance checks and save composite evidence.

## Live provider + browser acceptance (implementation verification)

1. Open the approved storyboard with approved anchors/style seed.
2. Open the target split dialogue frame (acceptance may use current visible frame 1).
3. Start generation; confirm pre-accept validation, then `202` + `operationId`, and phases from the canonical operation poll endpoint (no fake percents).
4. Reload mid-run; confirm `GET /api/visual` restores `activeOperationId` and polling resumes on the canonical endpoint.
5. Confirm Visual mode only after background + both character states are ready and assembly validates.
6. Visually accept:
   - one shared primary-scene background;
   - exactly one assigned character per panel;
   - no nested layout/dialogue/text in character layers;
   - near-frontal pair with compatible scale/eye-line and subtle inward direction;
   - cutouts composited over light/dark/contrast backgrounds without unacceptable green fringe.
7. Change zoom/pan/fit; confirm immediate crop, unchanged background, zero provider calls, survives reload.
8. Force one component failure; confirm previous valid result remains and retry creates a new operation.
9. Attempt panel regenerate before any ready background; confirm `409 frame-generation-required` and no provider call.
10. `GET /api/visual/frames/:frameId/diagnostics`; confirm ZIP download contents and exclusions.
11. Confirm dialogue wording/order/speaker ownership unchanged.
12. Confirm missing style authority fails with `409 style-required` before operation creation rather than text-only silent continuation.

## Distinction of proof

| Claim type | Proved by |
|------------|-----------|
| Contract/compiler/renderer/isolation/async correctness | Offline + PostgreSQL tests |
| Provider returns chromakeyable single-subject image | Live provider checks |
| Cutout edge quality after cleanup | Measurable matte checks + saved composites + human review |
| Assembled frame is artistically acceptable | Human visual acceptance |
