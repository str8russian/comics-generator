# Research: Research workspace dock

Decisions for [plan.md](./plan.md). The specification is accepted. This file resolves persistence, capture, UI top-layer, busy isolation, Commands/Operations mapping, and extraction from code evidence on base `7d098bf`. It does not add product scope and does not invent a Product Gate.

## Decision: Append-only PostgreSQL research events on the existing Compose volume

- **Decision**: Persist Notes and the ordered research trace in one new append-only PostgreSQL table (`research_event`) applied by migration `005_research_workspace_dock.sql` through the existing `db/migrate.mjs` advisory-lock path. Serve append/list through a small DI `researchStore` wired like `projectStore` / `visualStore`. Use the existing named volume `storyboard-pg` as the same-local-storage restart boundary. Notes history is the ordered subset of events with `event_kind = note`; there is no second Notes table and no second ordering authority.
- **Rationale**: FR-024/FR-025/FR-026 require Notes + complete ordered trace after page reload **and** ordinary application restart with the same local installation/storage. The approved restart boundary already used by product state is PostgreSQL behind Compose (`docker-compose.yml` volume `storyboard-pg`; app container itself has no durable volume). One append-only table gives authoritative `seq` ordering, reliable start↔terminal correlation, raw owner text confined to the research path, deterministic machine-readable extraction, injectable failure for honest save tests, and structural separation from sanitized operational `logLine` fields.
- **Alternatives considered**:
  - **Memory-only**: fails FR-024/FR-026.
  - **Browser-only (`localStorage` / IndexedDB)**: survives reload and often browser restart, but is not the Compose/product storage boundary; coordinator/owner extraction after app restart becomes DevTools scraping; evidence is tied to a browser profile rather than the installation volume; harder to inject deterministic save failures in server/store tests.
  - **Append-only file inside the app container**: Compose does not mount a durable app-data volume today; `docker compose up --build` / recreate drops container filesystem, failing application-restart durability without new infra.
  - **New file volume + JSONL on disk**: can work, but adds Compose volume/path/permission surface and a second persistence style beside the established migration/store/DI/PostgreSQL test helpers. Larger than one SQL migration reusing `storyboard-pg`.
  - **“No migration” by stuffing research into existing product JSON columns**: would mix owner-research raw text into product artifacts, blur redaction boundaries, and still need schema/read-path changes without a clearer contract.
  - **Dual-write browser + server**: complexity without a Happy Path need.

## Decision: Bounded event taxonomy with start/terminal correlation

- **Decision**: Represent the trace as append-only rows with `event_kind ∈ { note, action_start, action_terminal }`, a closed `semantic_action` enum, optional `correlation_id` shared by a start/terminal pair, server-assigned monotonic `seq`, and `occurred_at`. Terminal rows may store `duration_ms` computed from the matching start’s `occurred_at`. Notes are single `note` rows (no terminal pair, no AI reply). Context is a fixed-key JSON object captured at write time; absent fields are JSON `null`, never fabricated later.
- **Rationale**: FR-019–FR-023 require reconstructable intent → action → result → reaction, capture-time context, and duration where applicable, without a generic analytics bus or arbitrary payload dump.
- **Alternatives considered**: One row per finished action only (loses in-flight Operations truth and interrupted-start evidence). Free-form JSON event names (invites scope creep). Treating the trace as product state / revision history (forbidden by FR-027/FR-037).

## Decision: Capture at explicit browser action boundaries; research writes are separate from product routes

- **Decision**: The page records research evidence at the same semantic submit/click boundaries that already call product APIs (`runBusy` callers, draft reading submit, confirm, stage, Structure edit/undo, identity/anchor/panel/frame/placement/approve, plus dock Notes/Commands). The browser POSTs allowlisted research envelopes to research routes. Product handlers continue their current sanitized operational logging and do **not** copy request bodies into research or logs. Research routes validate allowlisted fields, reject/drop forbidden keys (credentials patterns are not stored as fields; image/data-URL/provider payload fields are not in the contract), and never call `logLine` with `submitted_text`.
- **Rationale**: Spec forbids intercepting every fetch and indiscriminate request/response copying (FR-031). Existing `createServer` DI and page action sites are already the explicit boundaries.
- **Alternatives considered**: Server middleware wrapping all `/api/*` (over-captures, risks logging protected bodies). Duplicating capture only in server handlers (misses in-page busy/Operations timing and dock-only notes; harder to keep Notes independent of product transactions).

## Decision: Failure policy without distributed transactions or retry orchestration

- **Decision**:
  - **Note save fails**: research POST fails → UI does not claim save; Notes draft text remains; no note row; no auto-retry (FR-033–FR-035).
  - **Pre-action research start cannot be saved**: show research-save failure; still allow the product action to proceed; do not claim evidence was recorded.
  - **Product succeeds, terminal research write fails**: product local feedback shows product success; research UI shows evidence-save failure; do not invent a terminal research success row.
  - **Product fails**: write `action_terminal` with truthful failure/blocked outcome; Operations and local control feedback show failure; retained last-good image flagged explicitly, never as a new success (FR-018/FR-032).
  - **Page/process ends between start and terminal**: unpaired `action_start` remains historical evidence of interruption. After reload/restart, Operations MUST NOT present it as currently running and MUST NOT resume/replay it (FR-027).
- **Rationale**: Spec requires honesty without retry/recovery architecture.
- **Alternatives considered**: Blocking all product actions on research durability (over-couples research to product). Auto-retry queues (out of scope). Promoting unpaired starts to live jobs (feature 006 territory; forbidden).

## Decision: One dock state owner; reparent into the native modal top layer

- **Decision**: Own Commands/Notes/Operations drafts, histories, collapse state (open-page only; not required durable), and active context in one client module/state owner bound to a single `#research-dock` element. Because `#detail` uses `showModal()` (top layer), a fixed sibling outside the dialog is not reliably interactive. On open, reparent the same dock node into `#detail`; on close, reparent it back under `body`/`main`’s designated host. No second dock instance and no duplicated state. Keep critical dialog actions (`#close-detail`, `#next-frame`, panel regenerate/zoom) clear via bottom-right placement, max-height, and safe offset from `.dialog-actions`.
- **Rationale**: FR-001–FR-003 and HP4 require one accessible dock with the frame/panel dialog open without blocking critical controls.
- **Alternatives considered**: Duplicate dock inside the dialog (state drift; violates “no duplicate docks”). Switching to non-modal `dialog.show()` (changes focus/backdrop semantics beyond this slice). Popover API top-layer dock (viable, but a second top-layer mechanism; reparenting reuses the existing dialog top layer with less API surface).

## Decision: Narrow busy CSS/JS exemption for Notes only

- **Decision**: Keep the global product busy latch (`busy` + `body.dataset.busy`) so a second product operation cannot start. Narrow `body[data-busy="true"] button { pointer-events: none }` to exclude the Notes send control (explicit `data-research-allow="notes-send"`). Notes send MUST NOT enter `runBusy`. Commands send and product controls continue to respect busy and remain blocked while a product action runs.
- **Rationale**: FR-015 requires Notes during async; FR-018/FR-035 forbid inventing general concurrency/cancellation/resume.
- **Alternatives considered**: Removing global busy (allows overlapping product ops). Per-control busy only (larger redesign than needed). Making all dock buttons exempt (would allow overlapping Commands/product work).

## Decision: Commands map only to existing Structure-edit and panel-generate paths

- **Decision**: Dock Commands reuses exactly:
  1. **Storyboard-wide Structure edit** → existing `POST /api/visual/storyboard/edit` with `{ instruction }` (same as `#structure-edit-form`).
  2. **Panel-scoped regeneration instruction** → existing `POST /api/visual/frames/:frameId/panels/:panelIndex/generate` with `{ instruction }` (same as panel control), only when a concrete panel target is explicitly selected.
  Target mode is explicit and sticky: opening/ambient frame/panel selection updates displayed **context** but does not silently change a storyboard-wide target to a panel target (FR-010). When no supported target exists (e.g. no storyboard yet / no panel selected for panel mode), Commands states the limitation and does not invent scopes, chat, or interpreters (FR-007–FR-009). Actual target labeling always shows storyboard-wide vs `displayFrameNumber` + `structureFrameId` + `panelIndex` distinctly (FR-011).
- **Rationale**: Confirmed in `public/app.js`, `server.mjs`, and `storyboard-edit.mjs`. Happy Path step 5 needs one supported scoped command through Commands without new semantics.
- **Alternatives considered**: General AI chat / new interpreter (forbidden). Auto-retargeting Commands to the open panel (violates FR-010). Frame-generate-without-instruction as a Commands text target (not a text-command path; covered as product-control capture in Operations/trace instead).

## Decision: Operations is a read-only live + historical projection, not a job system

- **Decision**: Operations shows (a) the single in-page live busy action while `runBusy` is active, and (b) recent terminal outcomes from the research store. After reload/restart, unpaired starts are not shown as running. No percentages, polling subsystem, cancellation, retry, or overlap recovery.
- **Rationale**: FR-016–FR-018, FR-027.
- **Alternatives considered**: Persisted job rows with workers/polling (feature 006; rejected). Deriving Operations only from sanitized console logs (not machine-readable owner evidence; lacks raw text; wrong channel).

## Decision: Machine-readable extraction via `GET /api/research/trace`

- **Decision**: Provide a local HTTP read of the complete ordered events as JSON (deterministic, no polished export UI). Quickstart documents obtaining it with a local `fetch`/`curl` against the loopback app after restart. Optional SQL `SELECT` against the Compose DB is a fallback for operators, not a second schema.
- **Rationale**: FR-025/FR-028 require obtainable machine-readable evidence without prescribing a polished exporter; an allowlisted GET matches existing API testing patterns and avoids scraping operational logs.
- **Alternatives considered**: Browser download button (polished export creep). Console-log scraping (fails redaction separation and completeness). Repository JSONL file (rejected with file-persistence alternative above).

## Decision: No Clarify pass required

- **Decision**: Code inspection did not surface a genuine unresolved **product** ambiguity that changes owner-visible scope. Remaining choices are technical and settled above.
- **Rationale**: Stage boundary allows Clarify only for true product ambiguity; storage/UI/capture questions are Plan responsibilities per the accepted spec (FR-028).
