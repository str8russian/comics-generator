# Feature Specification: Visual Generation Reliability

**Feature Branch**: `codex/visual-generation-reliability`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Repair three observed failures in the visual-storyboard workflow: approved character base anchors render in visibly different styles; frame generation appears to finish but never shows the image; and the workflow has no useful observability for silent failures."

## Clarifications

### Session 2026-10-09

- Q: How is the project style seed chosen and changed? → A: The first approved base anchor for a material state becomes the explicit project style seed. It is stored as project-level state and does not rotate when other characters are approved or regenerated. Resetting or replacing the seed is out of scope for this feature; no style-management UI is added.
- Q: What happens when dialogue fitting creates multiple display pieces? → A: Each display piece inherits the same panel assets and placement metadata from the structure frame. Dialogue splitting is placement-only and must not drop visual assignments.
- Q: What happens to already-approved but stylistically inconsistent anchors? → A: Existing approved versions remain recoverable. The user can generate corrected candidates against the stable seed and re-approve. Old versions are not deleted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One stable project style authority (Priority: P1)

The user generates and approves character base anchors that share one coherent rendering language while remaining different people. The first approved anchor becomes the project's style seed. Later characters receive that seed as style-only authority, their own real photo as identity authority, and a previous candidate when revising.

**Why this priority**: Without a stable style authority, each first-wave anchor drifts, and the visual storyboard cannot look like one project.

**Independent Test**: Approve one character's base anchor, generate candidates for two other characters against the same seed, and confirm both requests carry the same style asset with a style-only role while identity stays character-specific. Visually inspect line weight, tonal groups, shading, palette, background, crop, and detail density.

**Acceptance Scenarios**:

1. **Given** no approved anchors, **When** the first character's candidate is approved, **Then** that output becomes the project style seed and later approvals do not replace it.
2. **Given** a stored style seed, **When** another character generates a first candidate, **Then** the provider request includes that character's identity photo and the style seed with separate authority wording.
3. **Given** a revision of a character anchor, **When** a previous candidate exists, **Then** identity, previous candidate, and style seed remain represented without replacing identity authority.
4. **Given** already-approved inconsistent anchors, **When** the user regenerates candidates, **Then** prior approved versions remain recoverable and new candidates use the stable seed.
5. **Given** regenerating the seed character, **When** the seed asset equals the previous candidate, **Then** style authority remains stated and identity is never replaced by another character.

---

### User Story 2 - Generated panel survives the complete display path (Priority: P1)

The user selects “Создать изображения кадра”, sees progress, and the frame opens in Visual mode with the generated images. Closing, reopening, retrying, and reloading keep the images. Split frames become visual only when every required panel has a valid image.

**Why this priority**: Server-side generation can succeed while the page still shows Structure mode, so the workflow appears broken even when assets exist.

**Independent Test**: Generate one single-panel frame and one split frame against the PostgreSQL-backed app, confirm Visual mode and persistence after reload, then force one panel failure and confirm partial state plus retry.

**Acceptance Scenarios**:

1. **Given** all anchors approved, **When** the user generates a single-panel frame successfully, **Then** the card and dialog show the image, the frame is visually ready, and reload preserves it.
2. **Given** a split frame, **When** both panels succeed, **Then** both images render with correct subjects and dialogue placement, and reload preserves both.
3. **Given** a split frame, **When** only one panel succeeds, **Then** the frame is not presented as complete, the successful panel remains available, and the failed panel shows an actionable Russian message with retry.
4. **Given** successful generation, **When** dialogue fitting or overflow runs, **Then** asset ids, asset urls, placement, generation status, and visual-ready state are preserved on every display piece.
5. **Given** a failed panel, **When** the user retries, **Then** a new recoverable generation version is created.

---

### User Story 3 - Visible feedback and safe observability (Priority: P1)

The user always knows whether generation started, succeeded, or failed. Failures appear inside the relevant frame or dialog in Russian. Server and browser diagnostics identify the failed phase without leaking sensitive content.

**Why this priority**: Silent success and silent failure make the previous two paths impossible to diagnose or trust.

**Independent Test**: Run identity save, anchor generation, frame generation, and one forced provider failure; confirm UI messages and safe structured logs for each phase.

**Acceptance Scenarios**:

1. **Given** frame generation, **When** one or two panels are requested, **Then** the UI shows that generation has started and which panels are in progress.
2. **Given** success, **When** the response returns, **Then** the card and dialog switch to Visual mode.
3. **Given** an expected failure, **When** the response returns, **Then** the affected frame or dialog shows a concise actionable Russian message mapped from a stable failure kind.
4. **Given** server processing, **When** operations run, **Then** structured logs include safe operation fields and omit prompts, dialogue, credentials, URLs with secrets, image bytes, and base64.
5. **Given** an unexpected client rendering failure, **When** it occurs, **Then** a safe browser diagnostic may be emitted, but the console is never the only feedback channel.

### Edge Cases

- First character in a project generates without a style image because no seed exists yet; approval creates the seed.
- Provider reference limit of three images prioritizes identity, then previous candidate for revisions, then the stable style seed when it is a distinct asset.
- Dialogue that already fits still must preserve visual panel metadata.
- Zoom remains placement-only and must not call the image provider.
- Saving identity photos remains local and must not call the image provider.
- Storyboard-result isolation remains intact.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST persist one project style seed per material state, set on the first successful base-anchor approval, and MUST NOT silently rotate that seed.
- **FR-002**: Later base-anchor requests MUST send the character's real identity photo as identity authority and the project style seed as style-only authority when the seed exists and is a distinct image.
- **FR-003**: Anchor revisions MUST preserve the stable style seed and MUST NOT substitute another character's identity for the target identity.
- **FR-004**: Existing approved anchor versions MUST remain recoverable after corrected candidates are generated.
- **FR-005**: Successful panel generation MUST persist a ready generation, an output asset, and an assignment on the active storyboard result and version.
- **FR-006**: `/api/visual` MUST return generated assets on the correct panels after successful generation.
- **FR-007**: Client fitting and overflow MUST preserve panel visual metadata, including asset id, asset url, zoom, position, generation status, performance-reference metadata, and derived visual-ready state.
- **FR-008**: A frame MUST enter Visual mode only when every required panel has a valid assigned image.
- **FR-009**: Split-frame generation MUST create panel-specific images and become visually ready only after every required panel succeeds.
- **FR-010**: Partial or failed frame generation MUST preserve successful panels, identify failed panels, provide panel-specific retry, and show concise Russian error copy.
- **FR-011**: The UI MUST show generation progress for the affected frame and must never leave success or failure silent.
- **FR-012**: Server logs MUST emit bounded structured events for identity save, anchor generation, anchor approval, panel generation, frame-generation terminal result, placement update, and visual-state load failures, using only safe fields.
- **FR-013**: Logs and browser diagnostics MUST NOT include credentials, authorization headers, provider URL query strings, raw prompts, dialogue text, panel descriptions, identity-photo bytes, generated image bytes or base64, full provider responses, user free-form comments, or stack traces containing sensitive request data.
- **FR-014**: Zoom MUST NOT call the image provider. Identity save MUST NOT call the image provider.
- **FR-015**: Existing structural-edit, identity-upload, Interpret, Stage, fidelity, isolation, and rendering tests MUST continue to pass.
- **FR-016**: Batch generation, video generation, dialogue editing, direct panel-description editing, and full-frame catalog assignment remain out of scope.

### Key Entities

- **Project style seed**: The single style-authority image for one material state, created from the first approved base anchor and reused for later anchors and panels.
- **Character anchor version**: An append-only candidate or approved base identity illustration for one character.
- **Panel generation**: An append-only attempt to create one panel image for one panel visual state.
- **Display piece**: A fitted or overflow-split presentation of a structure frame. It may share panel visual assignments with sibling pieces from the same structure frame.
- **Safe failure kind**: A stable non-sensitive label mapped to Russian UI copy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the first approval establishes a style seed, two later character candidates generated against that seed share one coherent rendering language on visual inspection while remaining different people.
- **SC-002**: A successful single-panel generation appears in the card and dialog immediately, survives close/reopen, and survives page reload.
- **SC-003**: A successful split-frame generation shows both panels simultaneously with correct subjects and keeps them after reload.
- **SC-004**: A forced panel failure shows an actionable Russian message in the affected frame or dialog and leaves any successful neighboring panel available for retry.
- **SC-005**: Automated tests cover stable seed selection, authority ordering, metadata survival through fitting/overflow, reload persistence, split partial failure, retry, isolation, zoom-without-provider, and safe logging exclusions.
- **SC-006**: Browser verification exercises corrected anchor candidates, single-frame generation, split-frame generation, and one controlled failure path against the PostgreSQL-backed application.

## Assumptions

- Evidence from the current `comics` database shows Putin, Peskov, and Durov first-wave anchors were all generated before any approval, so none received a style image; text-only rendering language was insufficient.
- Evidence from `compileOverflow` shows dialogue fitting rebuilds panels with only `description`, dropping visual assignments even when generation succeeded server-side.
- The first approved base anchor is an acceptable style seed for this slice; choosing a different aesthetic requires a later product decision and UI.
- Test doubles are allowed in automated tests. Browser verification uses the local PostgreSQL-backed server and may make real provider requests for corrected anchors and frames.
- Product memory, the main checkout, and the image-spike worktree remain read-only.
