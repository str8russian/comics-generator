# Implementation Plan: Research workspace dock

**Branch**: `codex/009-research-workspace-dock` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-research-workspace-dock/spec.md`

**Note**: Plan-stage only. Tasks and implementation are out of scope for this commit. `GATEKEEPER.md` was not invoked; gates below follow `DEVELOPMENT_PROCESS.md` plan-stage checks.

## Summary

Deliver the smallest vertical DEC-052 Research workspace dock: one fixed collapsible bottom-right dock with independent Commands and Notes plus read-only Operations; capture owner notes and meaningful product/dock actions into one ordered local research trace; survive page reload and ordinary Compose/PostgreSQL application restart; expose deterministic machine-readable extraction without a polished export UI.

Technical approach (see [research.md](./research.md)):

1. Persist research evidence in one append-only PostgreSQL table on the existing `storyboard-pg` volume via migration `005_research_workspace_dock.sql` and a DI `researchStore`.
2. Capture at explicit browser action boundaries with allowlisted `note` / `action_start` / `action_terminal` events; keep sanitized operational logs untouched.
3. Mount one dock state owner; reparent the same DOM node into `#detail` when `showModal()` opens so the dock stays in the native top layer.
4. Narrow busy CSS/JS so only Notes send remains usable during product busy; Commands and product ops stay single-flight.
5. Map Commands only to existing Structure edit and panel-generate paths with sticky explicit targets.
6. Prove with offline + PostgreSQL tests and the continuous browser Happy Path in [quickstart.md](./quickstart.md) using provider doubles for plumbing.

## Technical Context

**Language/Version**: Node.js ESM (`.mjs`), browser JS modules under `app/storyboard-web/public/`

**Primary Dependencies**: existing `pg`, Node `http` server, existing Visual/Structure routes; no new runtime dependencies

**Storage**: PostgreSQL 16 via existing Compose volume `storyboard-pg`; new migration `005_research_workspace_dock.sql` (append-only `research_event`); see [data-model.md](./data-model.md)

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL lane via `STORYBOARD_TEST_DATABASE_URL` + `test/postgres/verify.mjs`; provider doubles for command/operation plumbing; redaction canaries extend `redaction.test.mjs` patterns

**Target Platform**: local `app/storyboard-web` + Docker Compose; browser acceptance on loopback `:4173`

**Project Type**: web application (extend existing `app/storyboard-web/`)

**Performance Goals**: ordinary single-owner interactive use of the Happy Path; no throughput quotas (FR-039)

**Constraints**: FR-001–FR-039; DEC-052 accepted direction; DEC-053 protected but not implemented; no feature 006 job/operation architecture; zero provider calls in Plan; raw owner text only in research path; operational log redaction preserved

**Scale/Scope**: one local owner, one dock, one ordered research trace; no multi-user, sync, or remote deployment

## Constitution Check

The repository constitution template remains unfilled. Plan gates use `DEVELOPMENT_PROCESS.md` Stage 3 checks:

| Gate | Result (pre-design) |
| --- | --- |
| Smallest browser-visible vertical path to owner acceptance | Pass — dock + Notes + Operations + Commands + durable extractable trace on HP 1–8 |
| Persistence minimum required by approved scenario | Pass — reload/restart is in the accepted scenario; PG on existing volume chosen after rejecting weaker alternatives |
| No architecture for deferred recovery/hardening | Pass — unpaired starts are historical only; no resume/retry/poll/queue |
| Direct traceability to accepted FR/SC | Pass — see Traceability below |
| New mechanisms justify why smaller reuse fails | Pass — documented in research.md / data-model.md |
| Provider calls governed | Pass — Plan made 0 calls; live provider not required for dock plumbing |

**Post-design re-check**: Still pass. One new append-only table + thin store/routes/UI module. No worker, event bus, job system, generic analytics framework, or DEC-053 hierarchy. No polished export UI. Operational logs not repurposed.

## Project Structure

### Documentation (this feature)

```text
specs/009-research-workspace-dock/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── research-api.md
│   └── research-event.schema.json
├── checklists/
│   └── requirements.md
└── spec.md
```

`tasks.md` is not created by this stage.

### Source Code (planned touch surface)

```text
app/storyboard-web/
├── db/migrations/005_research_workspace_dock.sql  # NEW append-only research_event
├── research-store.mjs                             # NEW DI store: appendNote/appendEvent/listTrace/listNotes
├── server.mjs                                     # wire research routes + researchStore; no log text leakage
├── public/
│   ├── index.html                                 # research dock markup host
│   ├── app.css                                    # dock layout; narrow busy exemption
│   ├── app.js                                     # integrate capture boundaries, busy, dialog reparent hooks
│   └── research-dock.mjs                          # NEW: one state owner for Commands/Notes/Operations/context
└── test/
    ├── research-store.test.mjs                    # NEW offline/DI
    ├── research-api.test.mjs                      # NEW HTTP contract + failure honesty
    ├── research-dock.test.mjs                     # NEW page seams: independence, busy, target labeling
    ├── research-capture.test.mjs                  # NEW action matrix / placement change-only
    ├── redaction.test.mjs                         # extend canaries for research path + logs
    └── postgres/research-persistence.test.mjs     # NEW restart/order/extract against comics_test

docker-compose.yml   # unchanged volume boundary (storyboard-pg)
Dockerfile           # unchanged
```

**Structure Decision**: Extend `app/storyboard-web/` with one store + one client module. Do not add a second app, worker, or shared analytics package. Do not modify FrameRenderer, generation grammar, or product tables.

## Complexity Tracking

No gate violations. The migration is required because browser-only and ephemeral app-disk alternatives fail the approved restart/extraction requirements (see [research.md](./research.md)).

## Implementation Approach

### 1. Persistence and extraction

- Add `research_event` per [data-model.md](./data-model.md).
- Implement `createResearchStore(pool)` with append + ordered list; inject via `createServer({ researchStore })` mirroring project/visual stores.
- Routes per [contracts/research-api.md](./contracts/research-api.md): `POST /api/research/notes`, `POST /api/research/events`, `GET /api/research/trace`, optional `GET /api/research/notes`.
- Extraction for acceptance: `GET /api/research/trace` after restart (documented in quickstart). Optional SQL fallback for operators; not a second schema.

### 2. Event/context/correlation contract

- Closed taxonomy: `note` | `action_start` | `action_terminal` + `semantic_action` enum.
- Correlate with `correlation_id`; compute `duration_ms` on terminal when start exists.
- Fixed-key `context` with explicit nulls; distinguish `displayFrameNumber` / `displayFrameId` from `structureFrameId` / `structureSegmentIndex`.
- `command_target` records actual target; ambient selection alone does not rewrite it.
- Structurally reject image/data-URL/provider/secret dump fields.
- Never pass `submitted_text` into `logLine` / `logVisual` / `logAllowlisted`.

### 3. Capture, write, and failure boundaries

- Instrument explicit page actions listed in the contracts capture matrix (existing controls + dock).
- Sequencing policy from [research.md](./research.md): note-save failure keeps draft; research start failure does not claim evidence but does not hard-block product; product success + terminal research failure keeps product success UI and surfaces evidence-save failure; unpaired starts after restart are non-running historical evidence only.
- No distributed transaction across product + research; no auto-retry.

### 4. UI ownership, native dialog, busy isolation

- One `#research-dock` with Commands / Notes / Operations regions; collapse handle; `position: fixed; right/bottom`; max-height and offsets so storyboard controls and `.dialog-actions` stay usable on narrow viewports.
- Single state owner in `research-dock.mjs` (drafts, histories, collapse for open page, context snapshot helpers). Unsent draft persistence not required.
- On `detail.showModal()`, reparent dock into `#detail`; on close, reparent back. No duplicate dock.
- Busy: exempt only Notes send from `pointer-events: none`; Notes send bypasses `runBusy`; Commands uses product busy latch.

### 5. Commands and Operations

- **Commands supported targets**: storyboard-wide `POST /api/visual/storyboard/edit`; panel `.../panels/:i/generate` when explicitly selected. Sticky target mode; honest unsupported empty states.
- **Operations**: live busy projection + terminal history from research store; no percentages/jobs/polling/cancellation. After reload, never show unpaired starts as running.

### 6. Validation strategy

Tests-before-implementation intent (Tasks will sequence IDs):

| Area | Proof |
| --- | --- |
| Persistence across reload + app/DB restart | postgres research persistence test + quickstart restart |
| Ordering / correlation / duration / context / frame distinction | store + API tests against schema |
| Commands/Notes independence | dock unit + browser step 5 |
| Notes during busy; second product op blocked | dock/page test with busy latch |
| Dock + `showModal` accessibility | page test / browser HP4 |
| Supported dispatch + unsupported honesty | dock + API integration |
| Action matrix incl. placement commit only | capture tests |
| Failure honesty + retained last-good | API + visual workflow doubles |
| Unpaired start ≠ live job | persistence + Operations projection test |
| Extraction after restart | GET trace |
| Redaction canaries | extend redaction tests; research forbidden-field rejection |
| Regressions | existing offline + PG verify helpers |

## Action-to-event matrix (compact)

| Action | semantic_action | start/terminal | Text | Actual target |
| --- | --- | --- | --- | --- |
| Notes send | `note` | note row | yes | n/a |
| Dock/product Structure edit | `structure_edit` | yes | instruction | `storyboard` |
| Dock/product panel generate | `panel_generate` | yes | instruction | `panel` + ids |
| Frame generate | `frame_generate` | yes | no | frame ids in context/target |
| Placement `change` | `placement_commit` | yes | no | panel + zoom/position |
| Placement `input` | — | **none** | — | — |
| Identity save | `identity_save` | yes | comment only | character |
| Anchor generate/approve | `anchor_generate` / `anchor_approve` | yes | instruction / none | character/anchor ids |
| Visual approve | `visual_approve` | yes | no | storyboard |
| Structure undo | `structure_undo` | yes | no | storyboard |
| Read draft submit | `reading` | yes | draft at submit | n/a |
| Confirm / stage | `confirm_material` / `stage_storyboard` | yes | no | n/a |
| Draft autosave | — | **none** | — | — |

## Traceability (spec → plan)

| Spec | Plan settlement |
| --- | --- |
| FR-001–003 dock shell | UI approach §4; quickstart HP1/HP4 |
| FR-004–006 independence / no unsent draft persistence | dock state owner; capture matrix |
| FR-007–011 Commands | Commands mapping §5; command_target + sticky mode |
| FR-012–015 Notes | notes route + busy exemption |
| FR-016–018 Operations | Operations projection §5 |
| FR-019–023 trace | event contract + matrix |
| FR-024–028 persistence/extraction | PG `research_event` + GET trace |
| FR-029–031 evidence boundaries | separate store; forbidden fields; log allowlist untouched |
| FR-032–035 failure honesty | failure policy §3 |
| FR-036–039 protected / out of scope | exclusions below; no grammar/006/DEC-053 impl |
| SC-001–007 | quickstart + test strategy |

## Integrity boundaries

| Boundary | Enforcement |
| --- | --- |
| Notes + trace survive reload/restart | PostgreSQL `research_event` on `storyboard-pg` |
| One ordering authority | `seq` bigserial |
| Action/result association | `correlation_id` + kinds |
| Capture-time context immutable | append-only rows; fixed null keys |
| Display vs structure frame | separate context/target fields |
| Raw owner text only in research path | research routes/store; never `logLine` text |
| No secrets/provider/image bytes in research | schema additionalProperties false + forbidden key rejection |
| Operational log policy unchanged | no research text fields added to allowlists; redaction tests remain |
| Notes during busy | CSS/JS exemption; bypass `runBusy` |
| No overlapping product ops | existing busy latch retained for Commands/product |
| Dock with modal | single node reparent into `#detail` |
| Unpaired start ≠ recovery | Operations live state is in-page only |
| Research ≠ product transaction | independent appends; honest partial evidence |

## Out of scope / protected (must not enter Tasks as work)

- Nested-panel elimination; regeneration-prompt filtering/containment; performance-reference correction; pan / new manual panel ops
- Note AI replies, edit/delete/tags/tasks/analysis; polished export; external analytics; external-user privacy policy
- Cancellation, resume, retry orchestration, polling, overlapping-operation recovery, workers/queues
- DEC-053 hierarchical revision schema/cascade UI; cumulative revision history; image-generation grammar changes
- Feature 006 architecture; FrameRenderer geometry changes; weakening source fidelity or approval gates
- Multi-user, remote deploy, cross-device sync, volume-deletion recovery
- Editing `spec.md` / product memory / constitution placeholder

## Assumptions

- Same-local-storage means the existing Compose PostgreSQL volume used by product resume.
- Provider doubles suffice to accept dock plumbing; live provider evaluation is separately authorized.
- Collapse state and unsent drafts need not survive reload.
- `GET /api/research/trace` is an extraction mechanism, not a polished export product surface.

## Unresolved questions

None that block Plan. No Clarify pass required (see [research.md](./research.md)).

## Residual risks

- Native top-layer reparenting must be verified in a real browser; jsdom may not fully model `showModal()` top-layer — quickstart HP4 is mandatory before owner acceptance.
- Global busy exemption must stay Notes-only; accidental broad exemption would reintroduce overlapping Commands/product starts.
- Reading submit stores full draft text in the research path by design (FR-029/DEC-052); operators must treat the DB volume as owner-research-sensitive (already true for draft/product text).
- If Tasks attempt to “simplify” by dropping the migration for browser-only storage, restart/extraction acceptance will regress — treat that as a plan violation.
