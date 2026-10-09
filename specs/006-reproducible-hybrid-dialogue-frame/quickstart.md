# Quickstart: Reproducible Hybrid Dialogue Frame

## Prerequisites

- Feature branch `006-reproducible-hybrid-dialogue-frame`
- PostgreSQL with `comics` (walkthrough) and `comics_test` (destructive automated tests)
- Env file with contest image credentials for live checks only
- Approved Structure storyboard, approved character anchors, and project style seed already present from prior slices

Server (implementation phase; not run during planning):

```sh
STORYBOARD_PORT=4174 STORYBOARD_HOST=127.0.0.1 DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics \
  node --env-file=/Users/andrey/Documents/Projects/comics-pipeline/.env.local app/storyboard-web/server.mjs
```

## Offline suite

```sh
node --test app/storyboard-web/test/**/*.test.mjs
```

Required coverage areas for this feature:

- PNG alpha inspection and chromakey/matte helpers
- visual-intent compiler: relational off-screen rules, no split-layout provider wording
- human brief vs compiled prompt separation
- renderer layered composition + character-only zoom/pan
- overflow/fitting preserves hybrid fields
- safe-log exclusions
- diagnostic ZIP contents and credential exclusions
- stale-operation pointer protection

## PostgreSQL suite

```sh
STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
  node app/storyboard-web/test/postgres/verify.mjs
```

Must cover:

- additive migration compatibility with existing visual rows
- result/version isolation for backgrounds, character states, placement, provenance
- reload persistence of hybrid readiness and placement
- previous ready asset retention on failed replacement

Do not point destructive helpers at `comics`.

## Planning-stage research already captured

```sh
# Existing asset alpha audit
cat specs/006-reproducible-hybrid-dialogue-frame/research/existing-png-alpha-audit.json

# Provider probe evidence (2 real requests; already executed during planning)
cat specs/006-reproducible-hybrid-dialogue-frame/research/provider-alpha-probe/evidence.json
```

Do not re-run the probe unless feasibility evidence is invalidated. If re-run is necessary, record exact request count again.

## Live provider + browser acceptance (implementation verification)

1. Open the approved storyboard with approved anchors/style seed.
2. Open the target split dialogue frame (acceptance may use current visible frame 1).
3. Start generation; confirm immediate in-progress feedback and honest phases (no fake percents).
4. Confirm Visual mode only after background + both character states are ready.
5. Visually accept:
   - one shared background;
   - exactly one assigned character per panel;
   - no nested layout/dialogue/text in character layers;
   - near-frontal pair with compatible scale/eye-line and subtle inward direction.
6. Change zoom/pan; confirm immediate crop, unchanged background, zero provider calls, survives reload.
7. Force one component failure; confirm previous valid result remains and retry works.
8. Export diagnostics; confirm local ZIP has prompts/manifests/references/outputs/hashes and no credentials/unrelated data.
9. Confirm dialogue wording/order/speaker ownership unchanged.

## Distinction of proof

| Claim type | Proved by |
|------------|-----------|
| Contract/compiler/renderer/isolation correctness | Offline + PostgreSQL tests |
| Provider returns chromakeyable single-subject image | Live provider checks |
| Assembled frame is artistically acceptable | Human visual acceptance |
