# Feature Specification: Reproducible Hybrid Dialogue Frame

**Feature Branch**: `006-reproducible-hybrid-dialogue-frame`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Specify the first vertical slice of the approved hybrid visual-storyboard direction. From an existing approved Structure storyboard, approved character identity anchors, an approved project style authority, and a selected split dialogue frame, the user can generate one coherent visual frame assembled from one stable scene background, one reusable single-character visual state for each panel, and deterministic final layout, clipping, divider, dialogue geometry, zoom, and pan. The acceptance target is the current visible frame 1, but the specification describes generic product behavior. The feature remains sequential and does not add batch generation."

## Clarifications

No unresolved product questions remain that would change this feature contract. Owner decisions in the feature request are treated as accepted requirements. Remaining open product questions that do not change this slice are listed under Assumptions and Out of Scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate one hybrid split dialogue frame (Priority: P1)

As a user reviewing an approved textual storyboard, I select one split dialogue frame and start image generation. The system creates or reuses one stable scene background and one single-character visual state for each panel, then the deterministic renderer assembles the frame. The result shows a coherent conversation: shared background, exactly one assigned character per panel, compatible paired composition, unchanged dialogue, and no nested comic layout.

**Why this priority**: The current path generates a complete scene per panel and produces nested layouts, duplicate people, mismatched rooms, and incoherent pairs. Structural hybrid assembly is the core value of this slice.

**Independent Test**: With approved identity anchors and a project style authority, generate one selected split dialogue frame. Confirm Visual mode only after background and both character states are ready; confirm one shared background, one assigned character per panel, preserved dialogue, and persistence after reload.

**Acceptance Scenarios**:

1. **Given** approved identity anchors, a project style authority, and a textual split dialogue frame, **When** the user generates that frame, **Then** the displayed result uses one stable background and exactly one assigned character in each panel.
2. **Given** a panel description that names both the assigned subject and an interlocutor, **When** the character state is generated, **Then** only the assigned subject is visible and the interlocutor affects only relational direction such as gaze.
3. **Given** a split storyboard frame, **When** either character state is generated, **Then** the generated state contains no panel borders, gutters, comic layout, dialogue, or additional subpanels.
4. **Given** a near-frontal pair composition mode, **When** the split frame is assembled, **Then** the two characters have compatible visual scale and eye-line and use subtle inward screen direction.
5. **Given** two panels belonging to the same frame and scene, **When** the frame is assembled, **Then** both use the same background component and placement changes do not regenerate or independently alter it.
6. **Given** an existing dialogue block and speaker-panel assignment, **When** the visual frame is generated and assembled, **Then** the wording, order, and speaker ownership remain unchanged.

---

### User Story 2 - Honest progress, partial readiness, and safe failure (Priority: P1)

The user starts generation for a selected frame and immediately sees that an asynchronous operation has started. The interface shows the current honest phase, completion, or a specific retryable failure. The frame enters Visual mode only when all required hybrid components are ready. Already-valid assets remain visible when another operation is pending or fails. No fabricated percentage is shown when real progress is unavailable. No additional mandatory background-approval gate is introduced.

**Why this priority**: Silent or misleading progress made earlier visual work untrustworthy; partial hybrid readiness must not be presented as a finished Visual frame.

**Independent Test**: Start generation and confirm immediate in-progress feedback; force readiness of only one character state and confirm the frame is not fully Visual-ready; force a background or character-state failure after a previously valid result and confirm the previous result remains visible with a specific retryable failure.

**Acceptance Scenarios**:

1. **Given** a selected split dialogue frame, **When** the user starts image generation, **Then** the interface immediately shows that an asynchronous operation has started and which honest phase is current.
2. **Given** that only one required character state is ready, **When** the frame is rendered, **Then** the frame is not presented as fully Visual-ready and the incomplete state is honestly visible.
3. **Given** a previously visible valid result, **When** a new background or character-state operation fails, **Then** the previous valid result remains visible and the user receives a specific retryable failure.
4. **Given** provider progress is not available, **When** generation is running, **Then** the interface does not invent percentage progress.
5. **Given** successful completion of all required hybrid components, **When** the frame is shown, **Then** it enters Visual mode and reload preserves the result.

---

### User Story 3 - Deterministic placement without regeneration (Priority: P1)

After a hybrid frame is assembled, the user adjusts character zoom and pan to control crop. Placement changes apply immediately, do not call the image provider, do not unpredictably move the stable background, and survive reload. Frame numbers, controls, diagnostic information, and status remain outside the final output canvas.

**Why this priority**: Placement must remain a local directing tool; regenerating images for crop changes is expensive and breaks continuity.

**Independent Test**: Assemble a hybrid frame, change zoom and pan, confirm immediate crop change with no provider request, reset or fit placement, reload, and confirm placement is preserved while the background remains stable.

**Acceptance Scenarios**:

1. **Given** an assembled hybrid frame, **When** the user changes zoom or pan, **Then** crop changes immediately, no provider request occurs, and placement survives reload.
2. **Given** an assembled hybrid frame, **When** the user resets or fits placement, **Then** the character crop updates locally without regenerating background or character states.
3. **Given** a detailed frame review, **When** the user inspects the output canvas, **Then** frame numbers, controls, diagnostic information, and status remain outside the final 1920×1080 output canvas, while the visible frame number is clearly identified outside that canvas.

---

### User Story 4 - Reproducible local generation evidence (Priority: P2)

Every image-provider request made by this feature leaves an immutable local generation record. The user can explicitly export a local diagnostic bundle for the selected frame containing prompts, manifests, actually used reference images, generated outputs, and hashes needed for later evaluation. Normal terminal and browser-console logs remain safe. Confirmed systemic generation failures are preservable as future regression cases. The export never uploads itself automatically and excludes credentials and unrelated project data.

**Why this priority**: Without exact provider provenance, hybrid failures cannot be reproduced, compared, or turned into regression cases.

**Independent Test**: Complete a frame generation, export diagnostics, and verify the bundle contains exact generation evidence without credentials or unrelated storyboard data; confirm ordinary logs omit prompts, dialogue, image bytes, credentials, authorization headers, and full provider bodies.

**Acceptance Scenarios**:

1. **Given** a completed frame generation, **When** the user exports diagnostics, **Then** the local bundle contains the exact generation evidence and no credentials or unrelated storyboard data.
2. **Given** any image-provider request made by this feature, **When** the operation finishes successfully or fails, **Then** an immutable local generation record exists that identifies the request, structured visual intent, compiled prompt, ordered reference assets and roles, model and relevant settings, output asset if any, outcome, and safe timing or output metadata.
3. **Given** ordinary terminal or browser-console logging, **When** generation runs, **Then** logs do not print prompts, dialogue, image bytes, credentials, authorization headers, or full provider bodies.
4. **Given** a confirmed systemic generation failure, **When** the user or maintainer preserves it for later evaluation, **Then** the retained evidence is sufficient to reconstruct the failed request as a future regression case.

---

### User Story 5 - Result and version isolation (Priority: P2)

Generation state, background assignment, character states, placement, and diagnostic evidence stay isolated between storyboard results and versions. Matching semantic frame IDs and panel indices in different storyboard results do not cause accidental sharing.

**Why this priority**: Accidental cross-result reuse would silently corrupt review and make diagnostics misleading.

**Independent Test**: Generate or reposition a frame in result A while result B shares the same frame IDs and panel indices; confirm result B remains unchanged.

**Acceptance Scenarios**:

1. **Given** storyboard result A and result B with identical frame IDs and panel indices, **When** result A is generated or repositioned, **Then** result B remains unchanged.
2. **Given** diagnostic evidence for a generated frame in one storyboard result, **When** another result is inspected, **Then** that evidence is not presented as belonging to the other result.

### Edge Cases

- A panel description mentions an interlocutor, off-screen character, or relational target: that mention may shape gaze or reaction, but must not cause an extra visible person.
- Only the background is ready, or only one character state is ready: the frame must not be presented as fully Visual-ready.
- Regeneration of one character state after a valid assembled frame: the previous valid assembly remains visible until the replacement succeeds or the failure is reported; success replaces only the affected component without silently inventing a second independent full-scene panel image.
- Reuse of an already suitable scene background when regenerating character states for the same selected frame and scene: the background remains the shared component. Retries during selected-frame generation may retry a failed background operation, but a dedicated user-facing background editing or regeneration workflow is not required in this feature; later features may add explicit background revision.
- Provider returns an image that violates single-character or no-nested-layout rules: the product treats that as a failed or rejectable generation for that component rather than accepting it as a valid hybrid character state.
- Zoom or pan to extreme values: the system keeps placement local and does not call the provider; reset/fit remains available.
- Export requested before any generation exists for the selected frame: the user receives a clear explanation that there is no diagnostic bundle to export.
- Multi-scene stories exist in the source material, but this slice treats the selected frame’s meeting or setting as one scene and does not add multi-scene management UI.

## Requirements *(mandatory)*

### Functional Requirements

#### Selected-frame hybrid flow

- **FR-001**: The user MUST be able to open a selected split dialogue frame from an approved Structure storyboard and start image generation for that one frame.
- **FR-002**: The detailed review MUST clearly identify the visible frame number outside the final-output canvas.
- **FR-003**: Starting generation MUST immediately show that an asynchronous operation has started.
- **FR-004**: For ordinary dialogue panels in this feature, the system MUST use the hybrid model: one stable scene background plus one reusable single-character visual state per panel, assembled by the deterministic renderer.
- **FR-005**: The system MUST create or reuse one stable background for the selected frame’s scene as part of generation. No additional mandatory background-approval gate may be required before the frame can complete.
- **FR-006**: The system MUST create or reuse one single-character visual state for each panel of the selected split frame.
- **FR-007**: The deterministic renderer MUST assemble the background, character states, panel geometry, divider/gutter, clipping, and unchanged dialogue into the final frame.
- **FR-008**: The frame MUST enter Visual mode only when all required visual components for that hybrid frame are ready.
- **FR-009**: Reload MUST preserve a completed hybrid result for the same storyboard result and version.
- **FR-010**: The feature MUST remain sequential: one selected frame at a time. Batch generation of all storyboard frames is out of scope.
- **FR-011**: The system MUST NOT silently fall back to independently generated complete scene images for ordinary dialogue panels while claiming to use the approved hybrid model.

#### Stable scene background

- **FR-012**: The scene background MUST be a separately identifiable reusable visual component shared across the split frame.
- **FR-013**: A valid scene background MUST contain no people, portraits, reflected people, text, speech bubbles, logos, watermarks, comic borders, or gutters.
- **FR-014**: A valid scene background MUST avoid salient random props that were not requested by the storyboard and MUST follow the approved project rendering language.
- **FR-015**: The shared background MUST remain spatially stable while the user changes character zoom or pan.
- **FR-016**: Multi-scene management UI is out of scope; the selected frame’s setting is treated as one scene for this slice.

#### Single-character visual states

- **FR-017**: Each panel’s generated character state MUST contain exactly one assigned visible character.
- **FR-018**: Each character state MUST preserve identity from the approved character anchor and rendering language from the approved project style authority.
- **FR-019**: Each character state MUST use the panel’s speaking, listening, or reaction role and follow the frame-level gaze and composition relationship.
- **FR-020**: Each character state MUST use safe margins that allow later placement adjustment.
- **FR-021**: Each character state MUST exclude every other person, including partial people, silhouettes, reflections, shoulders, backs of heads, or portraits.
- **FR-022**: Each character state MUST exclude scene layout, comic frames, gutters, dialogue, text, logos, and watermarks.
- **FR-023**: Other characters mentioned in a panel description are off-screen relational context. They MAY determine gaze direction or reaction, but MUST NOT automatically become visible in the generated state.
- **FR-024**: Supported conceptual frame-level gaze/composition patterns MUST include inward conversation, near-frontal pair, and intentionally asymmetric pair. Gaze is a frame-level composition choice, not an isolated per-panel accident.
- **FR-025**: For ordinary near-frontal pair composition, the assembled pair MUST use compatible eye-line and visible head scale, with subtle inward screen direction appropriate to left and right panel placement.

#### Layered visual intent and human-readable descriptions

- **FR-026**: Internal visual intent for generation MUST be layered at product level into at least: project visual direction; scene identity and continuity; frame composition mode; panel subject; visible characters; speaking/listening role; shot scale; gaze or screen direction; expression and pose; crop and safe margins; and prohibited content.
- **FR-027**: The image provider MUST receive a complete self-contained compiled prompt for each provider request.
- **FR-028**: Exact schema and compiler architecture are deferred to planning; this feature requires the layered meaning and observable behavior, not a specific storage shape.
- **FR-029**: The normal storyboard MUST show concise human-readable visual descriptions rather than the full technical provider prompt as its main description.
- **FR-030**: The product MUST distinguish: a concise panel description suitable for the storyboard grid; a fuller but still human-readable visual brief in detailed review; and the exact compiled provider prompt available only through diagnostics.
- **FR-031**: This feature MUST NOT change source dialogue, speaker ownership, source fidelity, Interpret, Stage, or structural storyboard editing.

#### Deterministic composition and placement

- **FR-032**: The deterministic renderer owns final split layout, panel divider and gutter, clipping, background placement, character placement, zoom, pan, and dialogue-region geometry.
- **FR-033**: The image provider MUST NOT own the final comic layout for ordinary hybrid dialogue frames.
- **FR-034**: The user MUST be able to zoom a character state, pan it to control the crop, and reset or fit placement.
- **FR-035**: Placement operations MUST NOT call the image provider.
- **FR-036**: Placement operations MUST NOT move the stable background unpredictably.
- **FR-037**: Placement MUST survive reload for the same storyboard result and version.
- **FR-038**: Frame numbers, controls, diagnostic information, and status MUST remain outside the final 1920×1080 output canvas.

#### Honest asynchronous behavior

- **FR-039**: The interface MUST provide visible operation feedback for generation start, current honest phase, completion, specific failure, and retry.
- **FR-040**: The interface MUST NOT require fabricated percentages when the provider exposes no real progress.
- **FR-041**: Already ready visual assets MUST remain visible when another operation is pending or fails.
- **FR-042**: A full application-wide activity center is deferred; this slice requires clear frame-level asynchronous feedback only.

#### Reproducible generation evidence

- **FR-043**: Every image-provider request made by this feature MUST create an immutable local generation record sufficient to determine what was requested, which structured visual intent was used, the exact compiled prompt, the exact ordered reference assets and their semantic roles, the model and relevant generation settings, which output asset was produced if any, whether the operation succeeded or failed, and relevant safe timing and output metadata.
- **FR-044**: Normal terminal and browser-console logs MUST remain safe and MUST NOT print prompts, dialogue, image bytes, credentials, authorization headers, or full provider bodies.
- **FR-045**: The user MUST be able to explicitly export a local diagnostic bundle for the selected frame.
- **FR-046**: The diagnostic bundle MUST include the prompts, manifests, actually used reference images, generated outputs, and hashes needed for later evaluation.
- **FR-047**: The diagnostic bundle MUST exclude credentials and unrelated project data and MUST NEVER upload itself automatically.
- **FR-048**: Every confirmed systemic generation failure SHOULD be preservable as a future regression case from retained local evidence.

#### Result isolation

- **FR-049**: Generation state, background assignment, character states, placement, and diagnostic evidence MUST remain isolated between storyboard results and versions.
- **FR-050**: Matching semantic frame IDs and panel indices in different storyboard results MUST NOT cause accidental sharing of hybrid assets, placement, or diagnostic evidence.

#### Compatibility and non-regression

- **FR-051**: Existing approved Structure storyboard review, identity-anchor approval, project style authority, dialogue fitting, structural editing, Interpret, and Stage behavior MUST remain available; this feature must not remove them merely because they are outside its hybrid generation changes.
- **FR-052**: Full-panel generation for later special or action shots remains outside this feature and MUST NOT be required to satisfy ordinary dialogue-panel hybrid generation.
- **FR-053**: Automatic full-panel fallback for ordinary dialogue panels is prohibited in this slice.

### Key Entities

- **Selected split dialogue frame**: One user-visible storyboard frame with a split conversational layout and assigned panel subjects.
- **Scene background**: A reusable people-free visual component that establishes the shared setting for the selected frame’s scene.
- **Character visual state**: A reusable single-character image for one panel role, constrained by identity, style, expression/pose, gaze, and prohibited content.
- **Frame composition mode**: A frame-level relationship among panels, including gaze/screen-direction pattern such as inward conversation, near-frontal pair, or intentionally asymmetric pair.
- **Layered visual intent**: The structured meaning used to compile a provider request, spanning project direction through panel prohibitions.
- **Human-readable visual brief**: The non-technical description shown in normal review; distinct from the compiled provider prompt.
- **Compiled provider prompt**: The exact self-contained prompt sent to the image provider; available through diagnostics.
- **Placement**: Local zoom, pan, fit, and reset values that control character crop without regenerating images.
- **Generation record**: An immutable local record of one provider request and its outcome.
- **Diagnostic bundle**: An explicitly exported local package of generation evidence for one selected frame.
- **Storyboard result / version isolation boundary**: The scope that prevents hybrid assets and evidence from leaking across results or versions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a successful hybrid split-frame generation, visual inspection finds exactly one assigned character in each panel, one shared background component across the frame, and no nested panel borders, gutters, dialogue text, or extra people in the generated character states.
- **SC-002**: For a near-frontal pair composition, visual inspection finds compatible head scale and eye-line plus subtle inward screen direction appropriate to left/right placement.
- **SC-003**: After successful generation, reload restores the same assembled Visual frame, including character placement, without another provider request.
- **SC-004**: Zoom and pan change the visible crop immediately, produce zero provider requests, leave the shared background spatially stable, and survive reload.
- **SC-005**: If only a subset of required hybrid components is ready, the frame is not marked fully Visual-ready in 100% of such cases, and the incomplete state remains visible.
- **SC-006**: When a new background or character-state operation fails after a previously valid result, the previous valid result remains visible and the user sees a specific retryable failure message in the frame-level UI.
- **SC-007**: Every provider request made during the feature leaves a local generation record from which a reviewer can recover the compiled prompt, ordered reference roles, model/settings, output identity or failure, without using ordinary console logs as the source of truth.
- **SC-008**: An exported diagnostic bundle for a completed frame contains prompts, manifests, used reference images, generated outputs, and hashes, and contains neither credentials nor unrelated storyboard results.
- **SC-009**: Generating or repositioning a frame in storyboard result A never changes the corresponding frame in storyboard result B when both share the same semantic frame IDs and panel indices.
- **SC-010**: Dialogue wording, dialogue order, and speaker-panel ownership remain unchanged after hybrid generation and assembly.
- **SC-011**: Normal product UI never requires the user to read or copy the full technical provider prompt to complete the primary generation journey; diagnostics remain available on explicit export or local diagnostic access.
- **SC-012**: The hybrid boundary is enforceable in review: a result that is merely two independently generated full-scene panel images does not satisfy this feature’s acceptance criteria for ordinary dialogue panels.

## Assumptions

- Approved Structure storyboard, approved character identity anchors, and an approved project style authority already exist from prior slices before this feature is exercised.
- The current visible frame 1 of the reference dialogue is the acceptance target for demonstration, but product requirements are generic and do not hardcode that frame, specific characters, dialogue text, storyboard IDs, or database records.
- For the reference acceptance case, the intended composition pattern is a restrained near-frontal pair with subtle inward screen direction: left character looks subtly toward screen right; right character looks subtly toward screen left; both have compatible eye-line and visible head scale.
- For the current reference dialogue, the meeting is treated as one scene; no multi-scene picker is required in this slice.
- Background creation or reuse happens as part of selected-frame generation rather than as a separate mandatory approval step.
- Reuse means the system may keep an already suitable scene background or character visual state when regenerating other components for the same isolated storyboard result and scene; it does not imply storyboard-wide deduplication UI.
- Foreground extraction, transparency, segmentation, and compositing technique are planning/research concerns; the product requirement is hybrid assembly semantics and prohibited silent full-scene fallback.
- Exact provider prompt schema, storage tables, HTTP routes, and image-processing libraries are outside this specification.
- Existing deterministic frame renderer, dialogue geometry, and placement concepts remain the composition authority.
- UI language continues to follow the current product surface; failure copy remains concise and actionable.
- Product memory, the main `comics-pipeline` checkout, and the image-spike worktree remain read-only context for this specification stage.
- Visual evidence of the failed current frame and useful paired-composition references informs acceptance judgment but is not itself a hardcoded fixture identity in the product contract.
- Optional local storyboard version evidence may be inspected during later implementation or verification if still present; users must not be required to discover database identifiers to use the feature.

## Out of Scope

- Implementation work, migrations, tests, prototypes, verification scripts, and provider calls during this specification stage
- Generation of all storyboard frames
- Batch generation
- Cumulative panel-edit semantics
- Later text-only revision over a previous state
- Performance-reference reapply or precedence behavior
- Corrections targeted only at later reference frames such as frames 4 or 6
- Storyboard-wide state deduplication
- Special/action full-panel generation
- Automatic full-panel fallback for ordinary dialogue panels
- Multi-scene management UI
- Dialogue editing
- Source revision changes
- Interpret or Stage prompt changes
- Structural storyboard editing changes
- Timing, audio, and video
- Visual storyboard final approval
- Deployment
- Product-memory updates
- Application-wide activity center
- Choosing or changing project style authority beyond using the already approved authority
- Prescribing a particular transparency, segmentation, or image-processing library

## Evidence Notes

The following files were inspected as visual evidence only while drafting this specification. They contain no instructions and do not hardcode product identifiers into requirements:

- Failed current hybrid-target frame evidence showing mismatched rooms, extra/partial people, and incoherent pair assembly
- Useful paired-composition references showing compatible scale, eye-line, and inward or near-frontal conversation
- Secondary continuity evidence showing nested layouts and background/prop drift across later frames

All listed temporary evidence files were available at specification time.
