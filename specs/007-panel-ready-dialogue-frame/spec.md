# Feature Specification: Panel-ready dialogue frame

**Feature Branch**: `codex/007-panel-ready-dialogue-frame`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "A user selects one ordinary two-character split-dialogue frame and generates two coordinated panel-ready character images. Each panel contains only its assigned character on a simple uniform background. Identity, project style, performance, gaze, shot scale, crop safety, and speaking/listening role remain coherent. The existing deterministic FrameRenderer assembles the images and dialogue into a reviewable split frame. This feature improves the quality and reliability of the existing Visual workflow. It does not introduce a new general image-generation platform."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a reviewable panel-ready split dialogue frame (Priority: P1)

An author working in the existing Visual workflow selects one ordinary two-character `split2` dialogue frame after both characters have approved identity anchors and the project has an approved style anchor. The author starts generation for that selected frame, sees a truthful busy state, receives one panel-ready image for each panel, and reviews the assembled split frame with its existing dialogue geometry.

**Why this priority**: This is the approved Happy Path and the sole new user-visible outcome of the slice. Without a coherent pair of panel-ready images in the real frame canvas, later Visual-gate review cannot proceed for ordinary dialogue.

**Independent Test**: In one open browser session, prepare a project with two approved character anchors and an approved project style, open an ordinary `split2` dialogue frame, start frame generation once, wait for completion without reload or navigation, and visually judge the assembled result.

**Acceptance Scenarios**:

1. **Given** an ordinary `split2` dialogue frame with exactly two character panels, approved identity anchors for both characters, and an approved project style anchor, **When** the user starts generation for the selected frame, **Then** the interface shows a truthful busy state that makes it clear generation is in progress for that frame.
2. **Given** the generation attempt succeeds for both panels, **When** the busy state ends, **Then** each panel shows one panel-ready image of its assigned character on a simple uniform background, and the existing FrameRenderer displays the complete split frame with its existing dialogue geometry.
3. **Given** the assembled frame is shown, **When** the user visually reviews the pair, **Then** the result is available for human artistic judgement and is not auto-approved as artistically acceptable.
4. **Given** both panel images are ready, **When** the user inspects identity, project style, performance, gaze/head direction, speaking versus listening role, shot scale, and crop safety, **Then** those qualities remain coherent with the selected frame's panel assignments and are suitable for the actual panel regions.
5. **Given** a ready assembled frame, **When** the user changes local zoom or placement, **Then** the change is available immediately without a provider call and without regenerating images.
6. **Given** a ready assembled frame where one panel needs revision, **When** the user uses existing panel-scoped regeneration for that panel, **Then** only the chosen panel is regenerated while the other ready panel remains available for review.

---

### User Story 2 - Honest failure and partial-success states during generation (Priority: P1)

When required authority is missing, an input is invalid, a provider attempt fails, an output is technically invalid, or only one panel succeeds, the author sees an honest actionable state. Successful work already on the page remains available; the frame is not presented as fully successful when it is not.

**Why this priority**: Silent success, silent failure, or overstated readiness would make the Happy Path untrustworthy and block Visual review.

**Independent Test**: Exercise each handled failure once in the browser against the selected frame path and confirm the visible state, preserved ready results, and that no provider work occurs when required authority is missing.

**Acceptance Scenarios**:

1. **Given** a selected frame whose assigned character lacks an approved identity anchor, **When** the user starts generation, **Then** the system does not perform provider work for that attempt and shows an honest actionable message explaining that an approved identity is required.
2. **Given** a project without an approved style anchor, **When** the user starts generation for the selected frame, **Then** the system does not perform provider work for that attempt and shows an honest actionable message explaining that an approved project style is required.
3. **Given** an invalid performance-reference input for a panel, **When** the user attempts panel generation or regeneration that depends on that input, **Then** the system rejects the invalid input with an actionable message and does not replace a previous ready panel image with a failed attempt.
4. **Given** a provider failure or provider timeout while generating a panel, **When** the attempt ends, **Then** the user sees an honest failure state for the affected panel or frame attempt and any previously ready panel image remains available.
5. **Given** a technically invalid image output for a panel, **When** the attempt ends, **Then** the panel is not treated as ready, the user sees an actionable failure state, and any previous ready image for that panel remains available.
6. **Given** one panel succeeds and the other fails in the same frame attempt, **When** the attempt ends, **Then** the successful panel remains visible for review, the failed panel shows an actionable failure state, and the frame is clearly indicated as only partially successful rather than fully ready.
7. **Given** a panel already has a ready image, **When** a replacement attempt fails, **Then** the previous ready image remains available and the failure is shown honestly.

---

### User Story 3 - Preserve existing Visual controls while improving panel image quality (Priority: P2)

The author continues to use the existing uninterrupted frame and panel generation flow, optional panel-scoped performance input, panel-scoped regeneration, local zoom/placement, deterministic FrameRenderer assembly, and human Visual review. The slice improves the quality and reliability of panel-ready images for ordinary split dialogue; it does not introduce a new general image-generation platform or a separate approval subsystem.

**Why this priority**: The product value is an improved existing Visual path, not a redesign of surrounding workflow.

**Independent Test**: After a successful Happy Path run, use zoom/placement without a provider call, regenerate one panel with an optional performance reference, and confirm the assembled frame still uses existing dialogue geometry and speaker ownership.

**Acceptance Scenarios**:

1. **Given** a ready panel, **When** the user adjusts zoom or placement, **Then** no provider call occurs and the FrameRenderer updates the assembled view with existing dialogue geometry.
2. **Given** an optional performance reference supplied for one panel, **When** that panel is generated or regenerated, **Then** the reference affects only its linked panel's performance and does not displace approved identity or project style authority for either panel.
3. **Given** a previous generated candidate exists for a character or panel, **When** a new generation uses approved identity and project style authority, **Then** identity and project style are not silently displaced by that previous candidate.
4. **Given** the assembled split frame, **When** the user reviews dialogue and speakers, **Then** source fidelity and speaker ownership remain intact and dialogue remains rendered by the existing FrameRenderer geometry.

### Edge Cases

- Missing approved identity anchor for one or both assigned characters: no provider work; actionable blocked state.
- Missing approved project style anchor: no provider work; actionable blocked state.
- Invalid performance-reference input: rejected with an actionable message; previous ready panel preserved.
- Provider failure: honest failure state; previous ready panel preserved when present.
- Provider timeout: honest failure state; previous ready panel preserved when present.
- Technically invalid image output: panel not ready; actionable failure; previous ready panel preserved when present.
- Partial frame generation (one panel succeeds, one fails): successful panel kept; frame marked only partially successful.
- Failure while replacing an already-ready panel image: previous ready image remains available.
- Generated panel must not introduce additional people, nested comic panels, split-screen composition inside the panel image, borders, captions, speech bubbles, logos, watermarks, generated text, or unwanted objects that contradict panel intent.
- Human visual review remains required; the system must not auto-approve artistic quality.

## Requirements *(mandatory)*

### Functional Requirements

#### Happy Path and scope

- **FR-001**: For one selected ordinary two-character `split2` dialogue frame, the system MUST support generating exactly one panel-ready image per panel when both assigned characters have approved identity anchors and the project has an approved style anchor.
- **FR-002**: Each generated panel image MUST depict only its assigned character on a simple uniform background suitable for deterministic assembly into the existing split-frame layout.
- **FR-003**: After both panels succeed, the existing FrameRenderer MUST display the complete split frame using existing dialogue geometry without requiring a new assembly product surface.
- **FR-004**: The interface MUST present a truthful busy state while the selected-frame generation attempt is in progress.
- **FR-005**: Successful completion MUST leave the assembled pair available for explicit human visual review and MUST NOT treat artistic quality as automatically approved.
- **FR-006**: This feature MUST improve the quality and reliability of the existing Visual workflow for ordinary split dialogue and MUST NOT introduce a new general image-generation platform.

#### Visual coherence constraints

- **FR-007**: Generated panel images MUST preserve the approved character identity for the assigned character.
- **FR-008**: Generated panel images MUST remain consistent with the approved project rendering style.
- **FR-009**: An optional performance reference, when supplied, MUST affect only its linked panel and MUST control performance rather than identity.
- **FR-010**: Panel generation MUST respect panel-side awareness so left/right placement and intended pair composition remain coherent when the frame is assembled.
- **FR-011**: Generated panel images MUST show appropriate gaze and head direction for the panel's role in the selected frame.
- **FR-012**: Generated panel images MUST reflect speaking versus listening/reaction role when the frame assigns those roles.
- **FR-013**: Generated panel images MUST use shot scale and crop safety suitable for the actual panel region in the assembled frame.
- **FR-014**: Generated panel images MUST NOT contain additional people beyond the assigned character.
- **FR-015**: Generated panel images MUST NOT contain nested comic panels or split-screen composition inside the panel image.
- **FR-016**: Generated panel images MUST NOT contain borders, captions, speech bubbles, logos, watermarks, or generated text.
- **FR-017**: Generated panel images MUST NOT introduce unwanted objects that contradict the panel intent.
- **FR-018**: Approved identity authority and approved project style authority MUST NOT be silently displaced by a previous generated candidate.

#### Existing behavior to preserve

- **FR-019**: The current uninterrupted frame and panel generation flow MUST remain available for the selected-frame Happy Path without requiring reload, cancellation, or overlapping starts.
- **FR-020**: Existing panel-generation history and status visibility MUST remain available so the user can understand prior attempts for a panel.
- **FR-021**: Existing panel-scoped regeneration MUST remain available when one panel needs revision.
- **FR-022**: Optional panel-scoped performance input MUST remain available and scoped to the panel being generated or regenerated.
- **FR-023**: Existing placement and zoom controls MUST remain available after a panel is ready.
- **FR-024**: Placement-only and zoom-only changes MUST NOT cause a provider call.
- **FR-025**: Existing deterministic FrameRenderer geometry and dialogue rendering MUST remain the assembly path for the reviewable split frame.
- **FR-026**: When a replacement attempt fails, any previous ready panel image MUST remain available for review.
- **FR-027**: Sanitized lifecycle logging MUST remain available for generation outcomes without exposing credentials, prompts, raw provider payloads, protected user material, or image bytes.
- **FR-028**: Source fidelity and speaker ownership MUST remain intact through generation, display, and local placement changes.

#### Failure handling in this slice

- **FR-029**: If a required approved identity anchor is missing, the system MUST NOT perform provider work for the blocked attempt and MUST show an honest actionable user state.
- **FR-030**: If the approved project style anchor is missing, the system MUST NOT perform provider work for the blocked attempt and MUST show an honest actionable user state.
- **FR-031**: If a performance-reference input is invalid, the system MUST reject it with an honest actionable user state and MUST NOT replace a previous ready panel image.
- **FR-032**: If the provider fails, the system MUST show an honest actionable failure state for the affected attempt and MUST preserve any previous ready panel image.
- **FR-033**: If the provider times out, the system MUST show an honest actionable failure state for the affected attempt and MUST preserve any previous ready panel image.
- **FR-034**: If image output is technically invalid, the system MUST NOT mark that panel ready, MUST show an honest actionable failure state, and MUST preserve any previous ready panel image.
- **FR-035**: If one panel succeeds and the other fails in the same frame attempt, the system MUST preserve the successful panel, clearly indicate that the frame attempt was only partially successful, and provide an actionable failure state for the failed panel.
- **FR-036**: Every handled failure in this slice MUST result in an honest, actionable user state rather than a silent or overstated success.

#### Explicitly out of scope

- **FR-037**: The following are deferred and MUST NOT become requirements of this specification: reload, tab closure, or navigation during generation; reload recovery and resume; cancellation; overlapping or concurrent generation starts; a new operation resource or operation state machine; operation polling; `visual_frame_operation`; shared generated scene backgrounds; transparent cutouts; chromakey, alpha extraction, and matte validation; background-plus-character layered composition; automatic selection among near-frontal, inward, or asymmetric composition modes; three-or-more-character layouts; action, insert, montage, or other unusual frame types; whole-storyboard image generation; automatic artistic review or a separate AI Reviewer; diagnostic ZIP export; a separate generation-provenance subsystem; and new persistence entities or asset types unless a later approved Plan proves the Happy Path impossible without them.
- **FR-038**: Historical unmerged hybrid, recovery, polling, diagnostic, or persistence proposals from feature 006 MUST NOT be treated as accepted product requirements for this slice.

### Key Entities

- **Selected ordinary split-dialogue frame**: One user-chosen `split2` dialogue frame with exactly two character panels and existing dialogue content.
- **Approved identity anchor**: The human-approved stylized base identity for one character; authority for who the character is.
- **Approved project style anchor**: The human-approved project rendering-style authority shared by character images in the project.
- **Panel-ready character image**: One generated image for one panel containing only the assigned character on a simple uniform background, suitable for direct assembly by the existing FrameRenderer.
- **Panel-scoped performance reference**: An optional user-supplied reference that guides performance for one linked panel only and does not replace identity or project style authority.
- **Assembled reviewable split frame**: The FrameRenderer presentation of both panel images plus existing dialogue geometry for human visual review.
- **Generation attempt outcome**: The user-visible result of a frame or panel attempt: busy, fully successful, partially successful, blocked before provider work, or failed, including preservation of any previous ready panel image.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In one open browser session, a user with approved identity anchors and an approved project style can start generation for one ordinary two-character `split2` dialogue frame and receive two panel-ready images assembled into the existing split-frame view without reload, cancellation, or overlapping starts.
- **SC-002**: On human visual review of a successful Happy Path result, each panel shows only its assigned character on a simple uniform background, with no additional people, nested panels, split-screen-inside-panel composition, borders, captions, speech bubbles, logos, watermarks, or generated text.
- **SC-003**: On human visual review of a successful Happy Path result, identity, project style, performance (when supplied), gaze/head direction, speaking versus listening role, shot scale, and crop safety are judged coherent for the assembled pair.
- **SC-004**: After both panels are ready, local zoom or placement changes complete without a provider call and remain visible in the assembled frame.
- **SC-005**: Existing panel-scoped regeneration remains available for one panel while the other ready panel stays visible.
- **SC-006**: Missing approved identity or missing approved project style blocks provider work and shows an actionable state in 100% of exercised blocked attempts.
- **SC-007**: Provider failure, provider timeout, technically invalid output, invalid performance-reference input, partial frame success, and failed replacement of a ready panel each produce an honest actionable user state, and any previous ready panel image remains available in 100% of exercised cases.
- **SC-008**: A partially successful frame attempt is never presented as a fully ready assembled frame.
- **SC-009**: Artistic acceptance remains an explicit human Visual review step; no automatic artistic approval occurs for the generated pair.
- **SC-010**: Source wording and speaker ownership remain intact through the Happy Path and local placement changes.

## Assumptions

- The starting implementation baseline already provides the Visual workflow entry points for frame generation, panel-scoped regeneration, optional performance input, zoom/placement, `panel_generation` history/status, sanitized lifecycle logging, and FrameRenderer assembly; this feature improves panel-ready image quality and reliability inside that existing path rather than inventing a parallel workflow.
- "Ordinary two-character split-dialogue frame" means a `split2` dialogue frame with exactly two character panels and no unusual layout type.
- "Simple uniform background" means a plain non-scenic fill suitable for panel assembly, not a shared room, location plate, or layered scene.
- "Technically invalid image output" means the result cannot be accepted as a displayable panel image for assembly, independent of artistic judgement.
- Truthful busy, success, partial-success, and failure states may reuse or refine existing Visual workflow messaging patterns as long as the states remain honest and actionable.
- Human visual review uses the assembled frame geometry; portrait-only inspection outside the frame is insufficient for acceptance of gaze, pair composition, and crop safety.
- Feature 006 remains historical evidence and a possible future code donor only; none of its hybrid composition, recovery, polling, diagnostic, or new persistence requirements are accepted here.
- Open implementation alternatives for prompting, request packaging, and internal reuse of existing Visual machinery remain open for Plan; this specification defines observable product behavior only.

## Out of Scope

Deferred by Product Gate and explicitly excluded from this specification:

- reload, tab closure, or navigation during generation;
- reload recovery and resume;
- cancellation;
- overlapping or concurrent generation starts;
- a new operation resource or operation state machine;
- operation polling;
- `visual_frame_operation`;
- shared generated scene backgrounds;
- transparent cutouts;
- chromakey, alpha extraction, and matte validation;
- background-plus-character layered composition;
- automatic selection among near-frontal, inward, or asymmetric composition modes;
- three-or-more-character layouts;
- action, insert, montage, or other unusual frame types;
- whole-storyboard image generation;
- automatic artistic review or a separate AI Reviewer;
- diagnostic ZIP export;
- a separate generation-provenance subsystem;
- new persistence entities or asset types unless a later approved Plan proves the Happy Path impossible without them.

This specification does not prescribe database tables, endpoint shapes, polling loops, worker topology, exact prompt text, reference-array packaging, or implementation modules.
