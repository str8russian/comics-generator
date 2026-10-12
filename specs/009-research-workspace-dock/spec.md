# Feature Specification: Research workspace dock

**Feature Branch**: `codex/009-research-workspace-dock`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Owner-selected DEC-052 slice: one floating Research workspace dock with separate Commands and Notes plus read-only Operations, beside actual product actions during the next complete storyboard attempt. Persist Notes history and one ordered local research trace across page reload and application restart so later analysis can reconstruct intent → command/action → result → reaction with minimal interruption. Reuse existing supported command behavior; do not invent unsupported scopes, AI note replies, polished export, job orchestration, or operation recovery. Nested-panel elimination, regeneration-prompt filtering, performance-reference transfer, pan/new manual panel ops, and feature 006 architecture remain out of scope. DEC-053 is a protected direction, not authorization to implement hierarchical revisions in this feature."

## Clarification of accepted vs observed

- **Accepted requirements** in this specification come from the owner-accepted user-visible contract for this slice (`DEC-052` / coordinator Stage 1 prompt). They are normative.
- **Baseline observations** describe the current local web application at base `7d098bf` and are not themselves product decisions about research storage, dock architecture, or command semantics beyond reuse of already-supported product behavior.
- **Assumptions** are explicitly labeled and may be revised only by a later owner decision or Clarify pass; they are not additional accepted product decisions.

## Baseline observations *(not accepted decisions)*

Observed on the authorized Visual baseline before this feature:

- The page already has product text fields and submit actions for the dialogue draft, Structure storyboard instruction (`#structure-instruction` → storyboard edit), character identity/comment and anchor-generation instruction, panel regeneration instruction inside the frame/panel dialog, and Visual approval.
- Supported Structure command submission today is storyboard-scoped through the existing storyboard-edit path. Panel regeneration instructions are panel-scoped through the existing panel-generate path. A narrow deterministic “full-frame only” Structure parse exists; there is no general AI chat and no separate Commands dock yet.
- Displayed frame numbers in Structure editing are mapped through a numbered/display frame list that can point at underlying structure frames (including segment identity). Displayed frame numbers and structure-frame identity must not be conflated when recording context.
- In-page async work uses a global busy state that currently dims/disables ordinary buttons and shows local notices on affected controls. Generation, approval, and placement already produce terminal success/failure feedback; retained last-good images after a failed attempt are already distinguishable from a successful new image.
- Product persistence already uses PostgreSQL-backed project and visual stores with Docker Compose volume restart continuity for those product artifacts. Sanitized operational logging deliberately excludes credentials, secret-bearing URLs, raw provider responses, protected request/response payloads, and image bytes; redaction tests protect that policy.
- No Research dock, Notes diary, Operations research view, or owner-research evidence path exists yet. Choosing how research evidence is stored is deferred to Plan after storage/logging inspection and is not decided here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture notes and operations beside a live storyboard attempt (Priority: P1)

While creating or continuing a storyboard, the owner keeps one Research workspace dock fixed at the viewport bottom-right. The dock collapses to a handle, does not scroll away with the storyboard, and remains usable while the existing frame/panel dialog is open without blocking critical controls. Notes lets the owner send one timestamped observation at a time with automatically captured available workflow/storyboard/frame/panel/image-version context. Operations shows truthful running and terminal success/failure of existing async product actions. Notes remains usable while an existing async action is running and does not start a product operation.

**Why this priority**: The owner selected this slice specifically to capture thoughts, irritation, missing capabilities, and intentions during the next complete storyboard attempt with minimal interruption.

**Independent Test**: Open the app, start or continue storyboard work, send one note, start one existing async product operation, observe Operations running then terminal state, keep Notes available during the wait, open a frame/panel, and confirm the single dock still reflects available context and remains accessible.

**Acceptance Scenarios**:

1. **Given** the application is open for storyboard creation or continuation, **When** the owner views the page, **Then** exactly one Research workspace dock is fixed at the viewport bottom-right, does not scroll with the storyboard, can collapse to a handle, and avoids covering critical storyboard/dialog controls.
2. **Given** that dock, **When** the owner inspects it, **Then** it contains three separate areas—Commands, Notes, and Operations—and no second dock appears for the frame/panel dialog or other views.
3. **Given** Notes has typed text, **When** the owner sends once, **Then** one separate timestamped note message appears in Notes history, and no AI reply is produced.
4. **Given** an existing storyboard or image async operation is started through existing product controls, **When** the owner watches Operations, **Then** Operations shows a running state and later a truthful terminal success or failure, while local busy/result feedback on the affected control remains.
5. **Given** that async operation is still running, **When** the owner uses Notes, **Then** Notes remains available to record a note without triggering a new product operation.
6. **Given** the existing frame/panel dialog is open, **When** the owner inspects the dock, **Then** the dock remains accessible, reflects available active context honestly, and does not block critical dialog controls.

---

### User Story 2 - Submit a supported command and keep Notes independent (Priority: P1)

Commands reuses existing supported command behavior. It visibly identifies the active storyboard/frame/panel context and the actual command target. The owner submits a supported scoped command through Commands; raw submitted text, semantic submit action, captured target/context, and result enter the ordered research trace. Commands and Notes keep independent inputs, drafts, send actions, histories, and event types. Ambient selection must not silently retarget a storyboard-wide command. Unsupported contexts present an honest limitation rather than inventing new scope semantics.

**Why this priority**: Later analysis must reconstruct intent → command/action → result → reaction without conflating diary notes with product commands or inventing unsupported interpreters.

**Independent Test**: With Notes draft/history populated, submit one existing supported scoped command through Commands, confirm the command outcome and research-trace entries, and verify the Notes draft and history remain unchanged by that send.

**Acceptance Scenarios**:

1. **Given** an active context that has a supported command, **When** the owner views Commands, **Then** Commands visibly identifies the available/active storyboard/frame/panel context and the actual command target for the next send.
2. **Given** that supported context, **When** the owner submits an existing supported scoped command through Commands, **Then** the product performs the existing supported command behavior for that actual target, and the ordered research trace records the raw submitted text, the semantic submit action, the captured target/context at send time, and the terminal result.
3. **Given** independent Notes draft text and Notes history, **When** the owner sends a Commands submission, **Then** the Notes draft and Notes history are neither consumed nor submitted, and Commands/Notes remain separate event types.
4. **Given** ambient frame/panel selection while a storyboard-wide supported command is used, **When** the owner sends that storyboard-wide command, **Then** ambient selection does not silently change the command target away from the storyboard-wide target.
5. **Given** a context with no supported command for the requested action, **When** the owner views or attempts Commands for that context, **Then** the interface presents that limitation honestly and does not invent unsupported scope semantics, a general AI chat, or a new command interpreter.

---

### User Story 3 - Reconstruct intent → action → result → reaction after reload and restart (Priority: P1)

One ordered local research trace records raw user-submitted product text, semantic submit actions, notes, meaningful generation/approval/placement/edit actions from existing product controls as well as the dock, outcomes, timestamps, duration where applicable, and available active context captured at action/note time. After a reaction note, page reload and application restart with the same local installation/storage restore prior Notes in the dock and keep the complete ordered machine-readable trace locally obtainable. The owner can reconstruct intent → command/action → result → reaction without polished export UI.

**Why this priority**: Evidence that dies on reload cannot support the next complete storyboard evaluation or later analysis.

**Independent Test**: Complete the continuous Happy Path below through reaction, reload, restart, obtain the local machine-readable trace, and reconstruct the sequence without inventing missing context.

**Acceptance Scenarios**:

1. **Given** the owner performs product actions through existing controls and through the dock, **When** those actions are committed/submitted, **Then** one ordered research trace records raw submitted product text (not every keystroke), semantic submit actions, notes, meaningful generation/approval/placement/edit actions, outcomes, timestamps, duration where applicable, and available active context.
2. **Given** an earlier note or action with captured context, **When** the owner later navigates to another frame/panel, **Then** earlier evidence is not relabeled by the later navigation; unavailable context remains explicitly absent rather than fabricated.
3. **Given** meaningful placement interaction, **When** research recording occurs, **Then** only meaningful committed placement actions are recorded, not an indiscriminate stream of pointer movement.
4. **Given** prior Notes and an ordered trace from the session, **When** the owner reloads the page and then restarts the application with the same local installation and storage, **Then** prior Notes return in the dock and the complete earlier ordered trace remains intact and locally obtainable as machine-readable evidence.
5. **Given** that restored evidence, **When** the owner obtains the local machine-readable trace, **Then** intent → command/action → result → reaction can be reconstructed with action/result association sufficient for later analysis. No polished export interface is required.
6. **Given** research persistence succeeds, **When** an interrupted product operation is considered, **Then** evidence persistence MUST NOT be treated as recovery, resume, or replay of that product operation.

---

### User Story 4 - Honest failure for operations and research saves (Priority: P1)

Proportionate acceptance covers an existing operation’s terminal failure and a research-save failure. Neither may be shown as success or falsely reported as saved. Unsaved note text remains available for correction or manual resubmission. No automatic retry orchestration is added. Retained last-good images must not be presented as successful new attempts.

**Why this priority**: False success would corrupt the research evidence the slice exists to collect.

**Independent Test**: Trigger one existing operation terminal failure and one research-save failure (or equivalent forced failure path), and verify honest UI plus preserved unsaved note text without automatic retry orchestration.

**Acceptance Scenarios**:

1. **Given** an existing async product operation ends in terminal failure, **When** Operations and local control feedback update, **Then** the failure is shown as failure, not success, and a retained last-good image is not treated as a successful new attempt.
2. **Given** a research-save failure while sending a note or appending research evidence, **When** the owner views the result, **Then** the interface does not claim the note/evidence was saved, and the unsaved note text remains available for correction or manual resubmission.
3. **Given** either failure class above, **When** the system responds, **Then** it does not add automatic retry orchestration, cancellation/resume machinery, or overlapping-operation recovery for this slice.

### Continuous Happy Path *(mandatory browser acceptance)*

One continuous vertical Happy Path must be acceptable end-to-end:

1. Open the application and start or continue storyboard creation.
2. Type a note, send it once, and immediately see its separate timestamped message.
3. Start an existing storyboard or image operation; see running and terminal result in Operations. Notes remains available during the wait.
4. Open a frame/panel and verify the dock reflects available context and remains accessible without blocking critical controls.
5. Submit an existing supported scoped command through Commands. Verify raw text, semantic action, captured target/context, and result enter the trace, while the Notes draft/history stays independent.
6. Add a reaction through Notes.
7. Reload the page, then restart the application with the same local storage. Verify the previous Notes return and earlier ordered evidence remains intact.
8. Obtain the local machine-readable trace and reconstruct intent → command/action → result → reaction.

### Edge Cases

- Context has no supported command for the owner’s intended action: present the limitation honestly; do not invent scopes or a chat interpreter.
- Ambient panel/frame selection exists while sending a storyboard-wide supported command: do not silently retarget that command.
- Async product operation is running: Notes remains usable and must not start a new product operation; Operations shows running then terminal truth.
- Existing operation terminal failure with retained last-good image: show failure; do not present retention as a successful new attempt.
- Research-save failure: do not claim success; keep unsaved note text available; no automatic retry orchestration.
- Later navigation after an earlier note/action: earlier captured context stays as captured; missing fields stay explicitly absent.
- Placement scrubbing/pointer movement without a committed placement action: do not flood the research trace; record meaningful committed placement actions only.
- Keystrokes in Commands, Notes, or product fields before submit: not recorded as research events; only submitted/committed text and actions are.
- Credentials, secret-bearing URLs, raw provider responses, and image bytes: excluded from the owner-research evidence path; existing sanitized operational logs and their tests remain protected and are not relaxed.
- Application restart without the same local installation/storage: out of scope for this slice’s durability claim; the approved scenario is same-local-storage reload/restart only.
- Interrupted product operations: research persistence does not imply cancellation, resume, retry orchestration, or recovery of those operations.

## Requirements *(mandatory)*

### Functional Requirements

#### Dock shell

- **FR-001**: The interface MUST provide exactly one Research workspace dock fixed to the viewport bottom-right that does not scroll with the storyboard content.
- **FR-002**: The dock MUST be collapsible to a handle and MUST remain usable while the existing frame/panel dialog is open without blocking critical storyboard or dialog controls.
- **FR-003**: The dock MUST contain three distinct areas: Commands, Notes, and Operations. The product MUST NOT create duplicate docks for different views.

#### Commands and Notes independence

- **FR-004**: Commands and Notes MUST have independent inputs, drafts, send actions, histories, and event types.
- **FR-005**: Sending Commands MUST NOT consume or submit the Notes draft, and sending Notes MUST NOT consume or submit the Commands draft.
- **FR-006**: Persistence of unsent Commands or Notes drafts is NOT required by this slice.

#### Commands behavior and context

- **FR-007**: Commands MUST reuse existing supported command behavior only. It MUST NOT create unsupported scope semantics, a general AI chat, or a new command interpreter.
- **FR-008**: Commands MUST visibly identify the active/available storyboard, frame, and/or panel context and the actual command target for the next send.
- **FR-009**: If a context lacks a supported command, the interface MUST present that limitation honestly.
- **FR-010**: Ambient selection MUST NOT silently change the target of a storyboard-wide supported command.
- **FR-011**: Captured command context MUST distinguish displayed frame numbers from underlying structure-frame identity when both are available, and MUST NOT conflate them.

#### Notes diary

- **FR-012**: Notes MUST be a single-user observation diary with no AI replies.
- **FR-013**: One Notes send action MUST create exactly one separate timestamped message.
- **FR-014**: Each saved note MUST automatically capture available workflow/storyboard/frame/panel/image-version context at send time; unavailable context MUST remain explicitly absent rather than fabricated.
- **FR-015**: The owner MUST be able to record a note while an existing async product action is running, without triggering a new product operation.

#### Operations view

- **FR-016**: Operations MUST be read-only and MUST truthfully show running and terminal success/failure of existing async product actions.
- **FR-017**: Local feedback on affected product controls MUST remain; Operations MUST NOT replace that local feedback.
- **FR-018**: Operations MUST NOT invent progress percentages, treat retained last-good images as successful new attempts, or introduce a job/orchestration system.

#### Ordered research trace

- **FR-019**: The system MUST maintain one ordered local research trace that records: raw user-submitted product text; the semantic submit action; notes; meaningful generation, approval, placement, and edit actions; outcomes; timestamps; duration where applicable; and available active context.
- **FR-020**: The trace MUST include meaningful actions performed through existing product controls, not only actions initiated from the dock.
- **FR-021**: The trace MUST capture submitted/committed text and actions, not every keystroke, and MUST record meaningful committed placement actions rather than an indiscriminate stream of pointer movement.
- **FR-022**: Ordering and action/result association MUST be sufficient to reconstruct intent → command/action → result → reaction.
- **FR-023**: Context MUST be captured at the action or note time. Later navigation MUST NOT relabel earlier evidence. Unavailable context MUST stay explicitly absent rather than fabricated.

#### Persistence and extraction

- **FR-024**: Notes history and the complete ordered research trace MUST survive page reload and application restart using the same local installation and storage.
- **FR-025**: After reload/restart, prior Notes MUST return in the dock, and the complete ordered trace MUST remain locally obtainable as machine-readable evidence.
- **FR-026**: Memory-only history MUST NOT satisfy FR-024 or FR-025.
- **FR-027**: Research evidence persistence MUST NOT imply recovery, resume, cancellation, or replay of interrupted product operations.
- **FR-028**: No polished export interface is required. The verifiable outcome is that the local machine-readable trace can be obtained and used to reconstruct the Happy Path sequence. This specification MUST NOT prescribe a table, JSONL file, browser storage key, endpoint, or other persistent schema; storage selection belongs to Plan after code/storage/logging inspection.

#### Evidence boundaries and protected logging

- **FR-029**: Raw owner commands and notes are deliberately retained in a separate owner-research evidence path.
- **FR-030**: Credentials, secret-bearing URLs, raw provider responses, and image bytes MUST be excluded from the owner-research evidence path.
- **FR-031**: Existing sanitized operational logs and their tests remain protected. This slice MUST NOT relax that policy or indiscriminately copy request/response payloads into the research trace.

#### Failure honesty

- **FR-032**: An existing operation’s terminal failure MUST be shown as failure in Operations and MUST NOT be shown as success.
- **FR-033**: A research-save failure MUST NOT be shown as success or falsely reported as saved.
- **FR-034**: On research-save failure for a note send, unsaved note text MUST remain available for correction or manual resubmission.
- **FR-035**: This slice MUST NOT add automatic retry orchestration for research-save failures or product-operation failures.

#### Protected product invariants

- **FR-036**: This slice MUST preserve source wording/order/speaker fidelity, existing approval gates, character/style authority, deterministic FrameRenderer geometry, existing provider behavior, and last-good-image retention semantics.
- **FR-037**: DEC-053 remains a protected direction only. This slice MUST NOT implement hierarchical revision schema, invalidation/cascade UI, cumulative revision history, or regeneration-prompt containment/filtering.
- **FR-038**: Nested-panel elimination; performance-reference correction; pan and new manual panel operations; note analysis/summarization, AI replies, task creation, tags, edit/delete; polished export and external analytics; cancellation, resume, retry orchestration, and overlapping-operation recovery; image-generation grammar changes; external-user privacy/retention policy; and feature 006 architecture are out of scope and MUST NOT become requirements of this specification.
- **FR-039**: This slice MUST NOT invent performance quotas or durability guarantees beyond the approved same-local-storage reload/restart scenario.

### Key Entities

- **Research workspace dock**: The single fixed, collapsible owner surface containing Commands, Notes, and Operations.
- **Command submission**: One owner send of an existing supported product command with raw text, semantic action, actual target, captured context, and terminal result.
- **Note message**: One owner observation diary entry with timestamp and automatically captured available context; no AI reply.
- **Operation activity item**: Read-only running or terminal success/failure presentation for an existing async product action.
- **Research trace entry**: One ordered evidence record in the local owner-research path associating submitted text and/or semantic action, available context snapshot, outcome, timestamps, and duration where applicable.
- **Active context snapshot**: Workflow/storyboard/frame/panel/image-version information available at action/note time, with displayed frame numbers distinguished from structure-frame identity when both exist; absent fields remain explicit absences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In one continuous browser session following the mandatory Happy Path steps 1–6, the owner can send at least one note, observe one existing async operation through running and terminal states in Operations while Notes remains usable, open a frame/panel with the dock still accessible, submit one existing supported scoped command through Commands, and add one reaction note—without leaving the page for a second tool.
- **SC-002**: After Happy Path step 5, a reviewer can point to distinct Commands versus Notes artifacts: the command send did not consume the Notes draft/history, and the research trace contains the command’s raw text, semantic action, captured target/context, and result as entries separable from Notes events.
- **SC-003**: After page reload and application restart with the same local storage (Happy Path steps 7–8), prior Notes reappear in the dock and the complete earlier ordered machine-readable trace remains obtainable without memory-only state.
- **SC-004**: Using only the locally obtained machine-readable trace from SC-003, a reviewer can reconstruct the Happy Path sequence as intent → command/action → result → reaction, including at least one note, one product command/action, one terminal result, and one later reaction note, without fabricated context for fields that were unavailable at capture time.
- **SC-005**: For an existing operation terminal failure, Operations and local control feedback both present failure, and a retained last-good image is not counted as a successful new attempt.
- **SC-006**: For a research-save failure on note send, the UI does not claim the note was saved, and the unsaved note text remains available for manual correction/resubmission without automatic retry orchestration.
- **SC-007**: A reviewer inspecting the owner-research evidence path finds deliberate retention of raw owner command/note text required by this slice, and finds no credentials, secret-bearing URLs, raw provider responses, or image bytes there; existing sanitized operational-log redaction protections remain intact.

## Assumptions

- The operator is the single local owner using one local installation; multi-user collaboration, accounts, and external-user retention/consent policy are out of scope.
- “Same local installation and storage” means the approved Docker/local app data boundary already used for product restart continuity; exact research-storage medium is intentionally undecided here and belongs to Plan.
- “Machine-readable trace is locally obtainable” means a verifier can extract the complete ordered evidence without a polished export UI; the extraction mechanism is not prescribed by this specification.
- Commands in this slice expose/reuse already-supported product command paths observed on the baseline (storyboard-scoped Structure edit and panel-scoped regeneration instruction), and may honestly disable or explain unsupported contexts rather than broaden command semantics.
- Existing product controls remain available; the dock complements them and does not require removing Structure tools, panel controls, or approval controls.
- Unsent draft persistence across reload is intentionally not required; only submitted Notes history and the ordered trace must survive.
- No performance/latency quota is imposed beyond ordinary local interactive use of the Happy Path.
- Provider calls are not required to accept this specification stage; browser acceptance of the implemented feature comes in later authorized stages.

## Traceability *(accepted contract → requirements / Happy Path)*

| Accepted contract item | Primary requirements | Happy Path / scenarios |
| --- | --- | --- |
| 1. One fixed collapsible bottom-right dock; usable with frame/panel dialog; no duplicates | FR-001, FR-002, FR-003 | HP1, HP4; US1.1–1.2, 1.6 |
| 2. Commands, Notes, Operations areas | FR-003 | HP2–5; US1.2 |
| 3. Independent Commands/Notes inputs, drafts, sends, histories, event types; unsent-draft persistence not required | FR-004, FR-005, FR-006 | HP5; US2.3 |
| 4. Reuse supported commands; visible context/target; honest unsupported limitation; no silent retarget | FR-007–FR-011 | HP4–5; US2.1–2.5 |
| 5. Notes diary, one send → one timestamped message, auto context, usable during async without product op | FR-012–FR-015 | HP2–3, HP6; US1.3, 1.5 |
| 6. Read-only Operations; truthful running/terminal; keep local feedback; no fake % / job system | FR-016–FR-018 | HP3; US1.4; US4.1 |
| 7. One ordered local research trace across dock and existing controls | FR-019–FR-021 | HP5–8; US3.1, 3.3 |
| 8. Ordering/association + capture-time context; no later relabel; no fabricated absences | FR-022, FR-023 | HP8; US3.2, 3.5 |
| 9. Notes + trace survive reload/restart; machine-readable; not memory-only; not operation recovery | FR-024–FR-027 | HP7–8; US3.4–3.6 |
| 10. Separate owner-research path retains raw owner text; exclude secrets/provider/image bytes; protect sanitized logs | FR-029–FR-031 | SC-007; US edge cases |
| 11. No polished export; specify extraction outcome only; storage choice deferred to Plan | FR-028 | HP8; US3.5 |
| Operation terminal failure honesty | FR-032, FR-018, FR-035 | US4.1 |
| Research-save failure honesty + keep unsaved note text; no auto-retry | FR-033–FR-035 | US4.2–4.3 |
| Out-of-scope / protected invariants | FR-036–FR-039 | Edge cases |

## Out of Scope

- Nested-panel elimination
- Regeneration-prompt filtering/containment
- Performance-reference correction
- Pan and new manual panel operations
- Note analysis/summarization, AI replies, task creation, tags, edit/delete
- Polished export UI and external analytics
- Cancellation, resume, retry orchestration, and overlapping-operation recovery
- Cumulative revision history and DEC-053 hierarchical persistence/cascade implementation
- Image-generation grammar changes
- External-user privacy/retention policy
- Feature 006 architecture and revival of rejected shared-background/cutout direction
- Prescribing research persistent schema, tables, files, browser storage keys, or endpoints in this specification
