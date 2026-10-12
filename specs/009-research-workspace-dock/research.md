# Research: Research workspace dock

Decisions for [plan.md](./plan.md). The specification is accepted. This file resolves persistence, capture, UI top-layer, busy isolation, Commands/Operations mapping, and extraction from code evidence on base `7d098bf`. It does not add product scope and does not invent a Product Gate.

Corrective Plan pass (after coordinator review) tightens protected-content validation, cast-edit coverage, action-aware text bounds, correlation/context immutability, history projections, and runnable quickstart commands. Persistence, one dock, modal reparenting, busy isolation, and no-job Operations remain unchanged.

## Decision: Append-only PostgreSQL research events on the existing Compose volume

- **Decision**: Persist Notes and the ordered research trace in one new append-only PostgreSQL table (`research_event`) applied by migration `005_research_workspace_dock.sql` through the existing `db/migrate.mjs` advisory-lock path. Serve append/list through a small DI `researchStore` wired like `projectStore` / `visualStore`. Use the existing named volume `storyboard-pg` as the same-local-storage restart boundary. Notes history is the ordered subset of events with `event_kind = note`; Commands history is derived from `surface = dock_commands` events in the same ordered trace; there is no second Notes/Commands table and no second ordering authority.
- **Rationale**: FR-024/FR-025/FR-026 require Notes + complete ordered trace after page reload **and** ordinary application restart with the same local installation/storage. The approved restart boundary already used by product state is PostgreSQL behind Compose (`docker-compose.yml` volume `storyboard-pg`; app container itself has no durable volume). One append-only table gives authoritative `seq` ordering, reliable start↔terminal correlation, raw owner text confined to the research path, deterministic machine-readable extraction, injectable failure for honest save tests, and structural separation from sanitized operational `logLine` fields.
- **Alternatives considered**:
  - **Memory-only**: fails FR-024/FR-026.
  - **Browser-only (`localStorage` / IndexedDB)**: survives reload and often browser restart, but is not the Compose/product storage boundary; coordinator/owner extraction after app restart becomes DevTools scraping; evidence is tied to a browser profile rather than the installation volume; harder to inject deterministic save failures in server/store tests.
  - **Append-only file inside the app container**: Compose does not mount a durable app-data volume today; `docker compose up --build` / recreate drops container filesystem, failing application-restart durability without new infra.
  - **New file volume + JSONL on disk**: can work, but adds Compose volume/path/permission surface and a second persistence style beside the established migration/store/DI/PostgreSQL test helpers. Larger than one SQL migration reusing `storyboard-pg`.
  - **“No migration” by stuffing research into existing product JSON columns**: would mix owner-research raw text into product artifacts, blur redaction boundaries, and still need schema/read-path changes without a clearer contract.
  - **Dual-write browser + server**: complexity without a Happy Path need.

## Decision: Bounded event taxonomy with unique start/terminal correlation

- **Decision**: Represent the trace as append-only rows with `event_kind ∈ { note, action_start, action_terminal }`, a closed `semantic_action` enum (including one `cast_edit`), optional `correlation_id` shared by a start/terminal pair, server-assigned monotonic `seq`, and server `occurred_at`. Enforce **at most one** `action_start` and **at most one** `action_terminal` per `correlation_id` (partial unique indexes). When a matching start exists, the store derives terminal `semantic_action`, `surface`, `command_target`, `edit_target`, `context`, and `submitted_text` from that start (client must not relabel via later navigation). `duration_ms` uses persisted server timestamps. Notes are single `note` rows. Absent context fields are JSON `null`, never fabricated later.
- **Rationale**: FR-019–FR-023 require reconstructable intent → action → result → reaction and capture-time context immutability. A non-unique `(correlation_id, event_kind)` index would allow mismatched terminals after navigation.
- **Alternatives considered**: One row per finished action only (loses in-flight Operations truth and interrupted-start evidence). Free-form JSON event names (invites scope creep). Treating the trace as product state / revision history (forbidden by FR-027/FR-037). Recapturing terminal context from current UI (violates FR-023).

## Decision: Protected-content validation of `submittedText` (not only JSON keys)

- **Decision**: Before insert, research routes run a bounded server-side protected-content check on `submittedText` (and on any text fields inside allowlisted `edit_target` values). Forbidden **object keys** remain rejected, but key rejection alone does **not** satisfy FR-030. The content check covers at least: Authorization/Bearer credential forms; credential-bearing URLs or DSNs (userinfo password, `postgres://…` with credentials); sensitive URL query parameters (`token`, `access_token`, `api_key`, `apikey`, `password`, `secret`, `signature` and case-insensitive equivalents); and `data:image/…;base64` (or other `data:*;base64`) payloads. On match: reject the write atomically with fixed safe failure `{ "status": "failed", "kind": "protected-content" }` (no matched secret echoed in HTTP bodies or operational logs); do not store a partial row; do not claim general secret/DLP or provider-response classification beyond these bounded patterns. Ordinary owner text that passes is stored byte-for-byte. Failure policy matches research-save failure: rejected Note stays in the Notes draft; product actions may proceed with honest research-save failure and no recorded start.
- **Rationale**: FR-030 excludes credentials, secret-bearing URLs, raw provider responses, and image bytes from the research path; owners can paste those into Notes/Commands/`submittedText`.
- **Alternatives considered**: Key-only `additionalProperties: false` (insufficient). Silent redaction/truncation (corrupts evidence and hides the failure). Full DLP/ML classifiers (ungrounded guarantee; out of scope).

## Decision: Action-aware text size bounds (no universal 8000 cap)

- **Decision**: Do **not** impose a universal 8 000-character SQL/schema cap on `submittedText`. Size protection is the existing server body limit (`DEFAULT_MAX_BODY_BYTES` / `STORYBOARD_MAX_BODY_BYTES`, default 262 144) yielding `413` for oversize JSON envelopes, with no silent truncation of stored raw text. Action-aware acceptance: research must never accept **less** text than the originating product control already accepts. In particular, `reading` may store the full draft submitted at “Разобрать черновик” within that body envelope; `structure_edit` / panel instructions remain bounded by the existing product instruction cap (4000 in `editStoryboard`) when that path is used; Commands/Notes invent no new owner-facing quota in this Plan beyond those existing product/UI bounds and the shared body limit.
- **Rationale**: A universal 8000 cap can reject a draft the product accepts, contradicting FR-019/FR-021 and DEC-052, and was not an authorized new product-text quota.
- **Alternatives considered**: Keep 8000 everywhere (conflicts with full-draft capture). Raise a single huge CHECK without body-limit awareness (still invents a second quota language). Truncate on store (forbidden).

## Decision: One `cast_edit` semantic action with fixed-key `edit_target`

- **Decision**: Cover Material-review cast corrections with one closed `semantic_action = cast_edit` plus fixed-key `edit_target` (not `command_target`). Distinguish `editKind` ∈ `{ character_rename, alias_assignment, speaker_assignment }` and `castPhase` ∈ `{ pending_reading, material_state }` (reading `PUT /api/readings/:id/cast` vs material `POST /api/material-states`). Capture only the submitted/selected owner value in `submittedText` plus the bounded edit-target identifiers (character name, surface form, source-item id as applicable). Emit start/terminal around the existing successful `saveCast()` boundary; terminal success only when that product save succeeds. Do not dump the whole cast request body; do not record keystrokes; do not build cast revision history. Source-**text** corrections are captured as the full submitted draft on the next `reading` action; draft autosave pulses remain non-events.
- **Rationale**: FR-019/FR-020 and current Material-review controls require meaningful edit capture; one action + edit_target is smaller than three nearly identical semantic actions and avoids overloading storyboard/panel `commandTarget`.
- **Alternatives considered**: Three separate semantic actions (more enum churn, same fields). Logging full cast JSON (payload dump). Using `command_target` for cast (ambiguous with Commands scopes).

## Decision: Capture at explicit browser action boundaries; research writes are separate from product routes

- **Decision**: The page records research evidence at the same semantic submit/click boundaries that already call product APIs (`runBusy` callers, draft reading submit, confirm, stage, Structure edit/undo, identity/anchor/panel/frame/placement/approve, Material cast saves via `saveCast()`, plus dock Notes/Commands). The browser POSTs allowlisted research envelopes to research routes. Product handlers continue their current sanitized operational logging and do **not** copy request bodies into research or logs. Research routes validate allowlisted fields, reject forbidden keys **and** protected `submittedText` content, and never call `logLine` with `submitted_text`.
- **Rationale**: Spec forbids intercepting every fetch and indiscriminate request/response copying (FR-031). Existing `createServer` DI and page action sites are already the explicit boundaries.
- **Alternatives considered**: Server middleware wrapping all `/api/*` (over-captures, risks logging protected bodies). Duplicating capture only in server handlers (misses in-page busy/Operations timing and dock-only notes; harder to keep Notes independent of product transactions).

## Decision: Failure policy without distributed transactions or retry orchestration

- **Decision**:
  - **Note save fails** (including protected-content rejection): research POST fails → UI does not claim save; Notes draft text remains; no note row; no auto-retry (FR-033–FR-035).
  - **Pre-action research start cannot be saved** (DB failure or protected-content on start text): show research-save failure; still allow the product action to proceed; do not claim evidence was recorded; retain the intended start snapshot in the initiating client closure for a possible incomplete terminal.
  - **Product succeeds, terminal research write fails**: product local feedback shows product success; research UI shows evidence-save failure; do not invent a terminal research success row.
  - **Product fails**: write `action_terminal` with truthful failure/blocked outcome (context from stored start or client `startSnapshot`); Operations and local control feedback show failure; retained last-good image flagged explicitly, never as a new success (FR-018/FR-032).
  - **Start missing at terminal time**: terminal may still be stored as incomplete evidence **only if** it carries the original action-start snapshot retained by the initiating client closure (`startSnapshot`); `duration_ms` stays null; no recovery/resume is inferred.
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

## Decision: Operations and independent history projections, not a job system

- **Decision**: Operations shows (a) the single in-page live busy action while `runBusy` is active, and (b) recent terminal outcomes from the research store. After reload/restart, unpaired starts are not shown as running. No percentages, polling subsystem, cancellation, retry, or overlap recovery. Independently: **Notes history** = `event_kind = note` (must return after restart); **Commands history** = ordered `surface = dock_commands` events derived from the same trace (in-session projection required for FR-004 independence; durable return of Commands history after restart is not required by the approved scenario, unlike Notes); **Operations history** = terminals as above.
- **Rationale**: FR-004, FR-016–FR-018, FR-027.
- **Alternatives considered**: Persisted job rows with workers/polling (feature 006; rejected). Deriving Operations only from sanitized console logs (not machine-readable owner evidence; lacks raw text; wrong channel). Second Commands table (unnecessary dual ordering).

## Decision: Machine-readable extraction via `GET /api/research/trace`

- **Decision**: Provide a local HTTP read of the complete ordered events as JSON (deterministic, no polished export UI). Quickstart documents obtaining it with a local `fetch`/`curl` against the loopback app after restart. Optional SQL `SELECT` against the Compose DB is a fallback for operators, not a second schema.
- **Rationale**: FR-025/FR-028 require obtainable machine-readable evidence without prescribing a polished exporter; an allowlisted GET matches existing API testing patterns and avoids scraping operational logs.
- **Alternatives considered**: Browser download button (polished export creep). Console-log scraping (fails redaction separation and completeness). Repository JSONL file (rejected with file-persistence alternative above).

## Decision: No Clarify pass required

- **Decision**: Code inspection did not surface a genuine unresolved **product** ambiguity that changes owner-visible scope. Remaining choices are technical and settled above (including this corrective pass).
- **Rationale**: Stage boundary allows Clarify only for true product ambiguity; storage/UI/capture questions are Plan responsibilities per the accepted spec (FR-028).
