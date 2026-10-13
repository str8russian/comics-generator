# Quickstart: Research workspace dock

Validation guide for the accepted Happy Path in [spec.md](./spec.md). Implementation details belong in later Tasks/Implement stages. This document distinguishes deterministic offline verification from later owner-operated live evaluation.

## Prerequisites

- Repository on branch `codex/009-research-workspace-dock` after implementation of this plan.
- Docker Compose available for the ordinary local app + PostgreSQL path (`docker-compose.yml`, volume `storyboard-pg`).
- Browser on loopback app port `4173` (Compose mapping).
- Provider credentials are **not** required to prove dock plumbing, Notes persistence, Commands→Structure edit with a provider double, Operations busy isolation, extraction, or redaction. Live image generation remains a later owner evaluation when authorized.
- There is **no** root `npm test` script in this repository. Use `node --test` as below.

## Deterministic offline / provider-double verification

From `app/storyboard-web/` (focused research + redaction + adjacent Visual/Structure seams; no provider network):

```bash
cd app/storyboard-web
node --test \
  test/research-text-policy.test.mjs \
  test/research-store.test.mjs \
  test/research-api.test.mjs \
  test/research-dock.test.mjs \
  test/research-capture.test.mjs \
  test/redaction.test.mjs \
  test/lifecycle.test.mjs \
  test/visual-workflow.test.mjs \
  test/storyboard-edit.test.mjs \
  test/draft-autosave.test.mjs
```

Broader offline regression for this feature’s touch surface (PostgreSQL files skip when the env var is unset):

```bash
cd app/storyboard-web
node --test test/**/*.test.mjs
```

PostgreSQL lane against **`comics_test` only** (verifier fails closed if the URL is unset or the database name is not `comics_test`). Set `STORYBOARD_TEST_DATABASE_URL` to your local Compose-created `comics_test` database using the same local role as the `db` service in `docker-compose.yml` (do not commit or paste production credentials):

```bash
# From repository root, with STORYBOARD_TEST_DATABASE_URL already exported in the shell:
node app/storyboard-web/test/postgres/verify.mjs
```

After implementation also includes `test/postgres/research-persistence.test.mjs`, the verifier above must pick it up via the existing postgres suite discovery. A direct focused run when debugging:

```bash
cd app/storyboard-web
node --test test/postgres/research-persistence.test.mjs
```

Minimum new coverage expected by [plan.md](./plan.md):

1. Research store append/list ordering, **unique** start/terminal per `correlationId`, duration from server timestamps, context nulls, display vs structure frame fields.
2. Navigation during a running action cannot relabel terminal semantic action/target/context (derive-from-start); duplicate/mismatched pairs rejected or non-relabeling proven.
3. Incomplete terminal with `startSnapshot` when start is absent: stores evidence with `evidenceIncomplete`, `durationMs` null, no recovery.
4. Notes + complete ordered trace survive process/app restart against the real DB helper (not memory).
5. Independent Commands/Notes drafts, submits, event types, and **separate Commands-history projection** (`surface=dock_commands`) distinct from Notes and Operations.
6. Notes send allowed under product busy; second product op blocked.
7. Dock remains single-instance and reparented for `#detail.showModal()` accessibility.
8. Supported Commands dispatch + honest unsupported context.
9. Action matrix capture including placement `change` only (not `input`) and **cast_edit** (`character_rename` / `alias_assignment` / `speaker_assignment` × `pending_reading` / `material_state`) without dumping full cast bodies.
10. Valid long draft at `reading` capture within the existing body limit: **no** universal 8000-character failure and **no** silent truncation.
11. Terminal operation failure + `retainedLastGoodImage`; note-save failure keeps draft; terminal evidence-save failure does not claim research success.
12. Unpaired start after restart is not shown/running and not replayed.
13. `GET /api/research/trace` returns complete ordered JSON after restart.
14. Redaction/canary: forbidden object keys **and** protected content **embedded in `submittedText`** (Bearer/credential URL/DSN/sensitive query/`data:image…;base64`) rejected with no persistence and no log/HTTP echo; existing `redaction.test.mjs` still green.
15. Existing fidelity / visual / FrameRenderer / offline regressions remain green.

## Continuous browser acceptance (spec steps 1–8)

Use the ordinary Compose app against the same volume. Prefer provider doubles or already-staged local project state so this proves the dock, not provider quality.

1. **Open / continue** — `docker compose up` (or equivalent documented local start). Open the app. Start or continue storyboard creation until Structure tools and/or Visual frames are available as needed for later steps.
2. **Note** — Open the Research dock (bottom-right). Type a note in Notes (not Commands). Send once. Confirm one separate timestamped Notes message appears with Russian date + 24-hour UTC+3 time (for example `… октября …, HH:MM:SS (UTC+3)`); Commands draft unchanged.
3. **Operation + Notes during wait** — Start an existing storyboard or image operation from product controls (Structure edit with double, frame/panel generate with double, etc.). Confirm Operations shows running then terminal success/failure with the same RU UTC+3 timestamp style, and persisted rows follow `seq` order. While running, send another note successfully. Confirm product controls/Commands cannot start a second overlapping product operation. Optionally navigate frames during the wait and confirm later extraction still shows the original capture-time context for that correlation.
4. **Frame/panel dialog** — Open a frame/panel (`showModal`). Confirm the **same** dock remains accessible, reflects available context (display vs structure identities when present), and does not block Close / Next / panel regenerate / zoom controls. Collapse/expand still works. While expanded, resize horizontally and vertically within safe bounds; collapse to the fixed standard handle; re-expand and confirm the last expanded size returns for this open page. After dialog close/reopen (reparent), expanded size for the open page is preserved. Reload is checked under step 7 for non-persistence of size.
5. **Commands** — Confirm the target selector starts neutral (`Выберите действие` or equally clear). Attempt send while neutral: no product call and no research write; concise local explanation shown. With a Notes draft still typed (unsent) and Notes history populated, explicitly select storyboard-wide Structure edit (owner-facing label). Confirm ambient frame open/refresh does not retarget. Submit a supported instruction. Confirm product edit occurs, research trace records raw text + semantic action + actual storyboard target + result, Notes draft/history stay independent, and Commands history shows the submission (timestamp + text + human target label) **without** a terminal outcome row (Operations owns the terminal). Visible selector labels must not show internal ids / `panelIndex` / 0-based indexes. When a panel is available for the open frame, explicitly select a panel regeneration option labeled for that open frame; confirm it works and that a stale/unavailable panel selection returns to neutral and blocks send.
6. **Reaction note** — Send a Notes reaction about the command result.
7. **Reload + restart** — Reload the page: prior Notes return; dock size returns to CSS default (expanded size was **not** persisted). Commands timestamps still render RU UTC+3. Then restart the application container/process with the same Compose volume (do not delete `storyboard-pg`). Open the app again: Notes and earlier ordered evidence remain. If an unmatched historical `action_start` exists, Operations shows it as interrupted/non-running in `seq` order (not last solely because unmatched).
8. **Extract + reconstruct** — Obtain the machine-readable trace:

   ```bash
   curl -sS http://127.0.0.1:4173/api/research/trace
   ```

   Reconstruct intent → command/action → result → reaction from `events` ordered by `seq` without fabricating null context fields.

### Repeat-T033 checklist after owner-observation corrections (2026-10-13)

Complete corrective task **T035** before retrying T033. On the repeat browser pass, verify all five groups concretely:

1. **Explicit Commands target** — Neutral default; neutral send blocked (0 product/research); sticky explicit storyboard and panel selections; ambient refresh does not retarget; stale panel → neutral + block; owner-facing labels only; panel list explained as open-frame scoped.
2. **RU UTC+3 timestamps** — Notes, Commands, and Operations visible times match `D месяц YYYY, HH:MM:SS (UTC+3)`; no raw ISO; no `Invalid Date`.
3. **Resize / collapse / page-session size** — Expanded resize H+V; fixed collapsed handle; same-page restore; reparent preserves size; reload does **not** restore custom size.
4. **Operations `seq` order** — Hydrated terminals + older unmatched start appear in numeric `seq` ascending; unmatched start is interrupted/non-running.
5. **Commands history = submissions only** — Start+terminal pair yields one Commands row (start) and one Operations terminal row; hydration preserves that split.

## Proportionate failure checks

### Existing operation terminal failure

Force a provider-double/product failure on an existing async action (panel/frame generate or Structure edit). Confirm:

- Operations shows failure (not success).
- Local control feedback shows failure.
- If a prior image remains, UI/trace marks retained last-good semantics and does not treat it as a successful new attempt.

### Research-save failure

Inject store/route failure on Notes append (DI test). Confirm:

- UI does not claim the note was saved.
- Unsaved note text remains for correction/manual resubmit.
- No automatic retry loop.

Also force terminal research-write failure after a successful product action: product success feedback remains; research does not claim terminal evidence saved.

### Protected content in `submittedText`

Attempt Notes (and a text-bearing command/event) containing each canary class: Bearer credential form, credential-bearing URL/DSN, sensitive query parameter, `data:image/…;base64`. Confirm `kind=protected-content` (or equivalent fixed safe failure), no row persisted, no secret in logs/HTTP bodies, Notes draft retained.

### Cast correction

In Material review, perform one character rename, one alias assignment, and one speaker assignment (pending reading and, when available, material-state phase). Confirm successful `saveCast()` produces `cast_edit` evidence with allowlisted `editTarget` fields only (no full cast dump). A failed cast save must not be recorded as success.

### Long draft reading capture

Submit a draft larger than 8000 characters that the product draft path still accepts within the ordinary body limit. Confirm the `reading` research event stores the full submitted draft without truncation and without a research-only 8000 rejection.

### Interrupted start after restart

Write/start an action, kill the app before terminal evidence, restart. Confirm unpaired start remains in extraction if it was persisted, Operations does **not** show a live running job, and nothing auto-resumes.

## Later owner-operated live evaluation (not required to accept dock plumbing)

When separately authorized: run the dock beside a real complete storyboard attempt with live providers. That evaluation consumes the research evidence; it is not a substitute for the deterministic checks above.

## Out of scope for this quickstart

- Polished export UI, deletion, sharing, external analytics
- Cancellation/resume/retry/overlap recovery demos
- Nested-panel, pan, performance-reference, DEC-053 hierarchy work
- Mutating production secrets or committing local generated assets
- Adding a root `npm test` script (not part of this Plan)
