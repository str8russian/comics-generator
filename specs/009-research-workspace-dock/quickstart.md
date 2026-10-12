# Quickstart: Research workspace dock

Validation guide for the accepted Happy Path in [spec.md](./spec.md). Implementation details belong in later Tasks/Implement stages. This document distinguishes deterministic offline verification from later owner-operated live evaluation.

## Prerequisites

- Repository on branch `codex/009-research-workspace-dock` after implementation of this plan.
- Docker Compose available for the ordinary local app + PostgreSQL path (`docker-compose.yml`, volume `storyboard-pg`).
- Browser on loopback app port `4173` (Compose mapping).
- Provider credentials are **not** required to prove dock plumbing, Notes persistence, Commands→Structure edit with a provider double, Operations busy isolation, extraction, or redaction. Live image generation remains a later owner evaluation when authorized.

## Deterministic offline / provider-double verification

Run from repo root (commands illustrative; Tasks will pin exact scripts):

```bash
# Focused offline suite (no network, no provider). Skips PostgreSQL files when
# STORYBOARD_TEST_DATABASE_URL is unset — those must still be run in the PG lane below.
npm test -- --test-path-pattern=storyboard-web/test

# PostgreSQL lane against comics_test only (fails closed if URL unset):
# STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
#   node app/storyboard-web/test/postgres/verify.mjs
```

Minimum new coverage expected by [plan.md](./plan.md):

1. Research store append/list ordering, correlation, duration, context nulls, display vs structure frame fields.
2. Notes + trace survive process restart against the real DB helper (not memory).
3. Independent Commands/Notes drafts/histories/event types.
4. Notes send allowed under product busy; second product op blocked.
5. Dock remains single-instance and reparented for `#detail.showModal()` accessibility (page/jsdom or browser harness already used by the app).
6. Supported Commands dispatch + honest unsupported context.
7. Action matrix capture including placement `change` only (not `input`).
8. Terminal operation failure + `retainedLastGoodImage`; note-save failure keeps draft; terminal evidence-save failure does not claim research success.
9. Unpaired start after restart is not shown/running and not replayed.
10. `GET /api/research/trace` returns complete ordered JSON after restart.
11. Redaction/canary: secrets, URLs, provider payloads, image/data URLs absent from research rows where forbidden and from operational logs; existing `redaction.test.mjs` still green.
12. Existing fidelity / visual / FrameRenderer / offline regressions remain green.

## Continuous browser acceptance (spec steps 1–8)

Use the ordinary Compose app against the same volume. Prefer provider doubles or already-staged local project state so this proves the dock, not provider quality.

1. **Open / continue** — `docker compose up` (or equivalent documented local start). Open the app. Start or continue storyboard creation until Structure tools and/or Visual frames are available as needed for later steps.
2. **Note** — Open the Research dock (bottom-right). Type a note in Notes (not Commands). Send once. Confirm one separate timestamped Notes message appears; Commands draft unchanged.
3. **Operation + Notes during wait** — Start an existing storyboard or image operation from product controls (Structure edit with double, frame/panel generate with double, etc.). Confirm Operations shows running then terminal success/failure. While running, send another note successfully. Confirm product controls/Commands cannot start a second overlapping product operation.
4. **Frame/panel dialog** — Open a frame/panel (`showModal`). Confirm the **same** dock remains accessible, reflects available context (display vs structure identities when present), and does not block Close / Next / panel regenerate / zoom controls. Collapse/expand still works.
5. **Commands** — With a Notes draft still typed (unsent) and Notes history populated, set Commands target explicitly (storyboard-wide Structure edit for this step). Submit a supported instruction. Confirm product edit occurs, research trace records raw text + semantic action + actual storyboard target + result, and Notes draft/history stay independent. Ambient open panel must not silently retarget a storyboard-wide command.
6. **Reaction note** — Send a Notes reaction about the command result.
7. **Reload + restart** — Reload the page: prior Notes return. Then restart the application container/process with the same Compose volume (do not delete `storyboard-pg`). Open the app again: Notes and earlier ordered evidence remain.
8. **Extract + reconstruct** — Obtain the machine-readable trace:

   ```bash
   curl -sS http://127.0.0.1:4173/api/research/trace | jq .
   ```

   Reconstruct intent → command/action → result → reaction from `events` ordered by `seq` without fabricating null context fields.

## Proportionate failure checks

### Existing operation terminal failure

Force a provider-double/product failure on an existing async action (panel/frame generate or Structure edit). Confirm:

- Operations shows failure (not success).
- Local control feedback shows failure.
- If a prior image remains, UI/trace marks retained last-good semantics and does not treat it as a successful new attempt.

### Research-save failure

Inject store/route failure on Notes append (DI test and one manual fault path if exposed for demos). Confirm:

- UI does not claim the note was saved.
- Unsaved note text remains for correction/manual resubmit.
- No automatic retry loop.

Also force terminal research-write failure after a successful product action: product success feedback remains; research does not claim terminal evidence saved.

### Interrupted start after restart

Write/start an action, kill the app before terminal evidence, restart. Confirm unpaired start remains in extraction if it was persisted, Operations does **not** show a live running job, and nothing auto-resumes.

## Later owner-operated live evaluation (not required to accept dock plumbing)

When separately authorized: run the dock beside a real complete storyboard attempt with live providers. That evaluation consumes the research evidence; it is not a substitute for the deterministic checks above.

## Out of scope for this quickstart

- Polished export UI, deletion, sharing, external analytics
- Cancellation/resume/retry/overlap recovery demos
- Nested-panel, pan, performance-reference, DEC-053 hierarchy work
- Mutating production secrets or committing local generated assets
