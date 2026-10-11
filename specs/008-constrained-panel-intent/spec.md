# Feature Specification: Constrained panel intent

**Feature Branch**: `codex/008-constrained-panel-intent`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "First vertical slice of DEC-050. The user creates and reviews a complete Structure storyboard whose future generated-image panels contain only supported one-character visual intent, generates at least one eligible panel through the existing Visual workflow without a performance reference and without a user-authored regeneration prompt, and reviews a browser-visible panel that shows one assigned character framed from close-up through waist-up on a system-defined solid matte background. Unsupported scenario prose cannot reach the provider-facing generation prompt even if unexpected unsupported detail remains upstream. Storyboarder restriction and independent downstream compilation are separate requirements. Nested-panel elimination, user-authored regeneration-prompt filtering, and performance-reference transfer remain later separately accepted slices."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review a Structure storyboard with supported panel intent only (Priority: P1)

An author pastes the retained Putin/Durov/Peskov reference dialogue, creates the complete Structure storyboard in one open browser session, and reviews every future generated-image panel description. Each such panel assigns exactly one character and describes only supported visible character performance. Unsupported scenario prose—locations, interiors, furniture, props, additional people, physical interaction, visible text, rendering-style instructions, or invisible narrative causes—is not presented as ready panel description content.

**Why this priority**: Without a Structure storyboard that honestly represents the supported Visual grammar, the user cannot review what the image path will actually generate, and later generation inherits invented environments and objects.

**Independent Test**: In one open browser session, create the complete Structure storyboard from the retained reference dialogue, open every future generated-image panel, and confirm one-character assignment plus supported-intent-only descriptions before any image generation.

**Acceptance Scenarios**:

1. **Given** the retained Putin/Durov/Peskov reference dialogue, **When** the user creates the Structure storyboard once without reload, navigation away, cancellation, manual retry, or overlapping work, **Then** a complete Structure storyboard is available for review through its final frame.
2. **Given** that complete storyboard, **When** the user reviews every future generated-image panel description, **Then** each such panel assigns exactly one character.
3. **Given** those panel descriptions, **When** the user inspects their content, **Then** each description contains only supported visible character-performance intent: framing from close-up through waist-up; shot scale and crop; visible geometry of torso, shoulders, head, arms, and hands; an in-crop gesture; head turn and tilt; gaze direction; facial expression; and a system-defined solid matte background.
4. **Given** those panel descriptions, **When** the user inspects them for unsupported categories, **Then** they do not contain locations or contextual scenery, interiors, furniture, props or other objects, additional people, physical interaction between characters, visible text, user or Storyboarder rendering-style instructions, or invisible narrative causes or temporal prose presented as image content.
5. **Given** source or staging language that would otherwise imply sitting, standing, lying down, sleeping, waking up, continuing to speak, or being in a meeting, **When** a future image panel description is presented as ready, **Then** any visually relevant content appears only as visible upper-body geometry and expression, and support-dependent wording that would invite furniture or scenery (for example “sits upright” inviting a chair) is not presented as ready description content.
6. **Given** source fidelity and speaker ownership on the retained reference dialogue, **When** the Structure storyboard is presented as ready, **Then** source dialogue wording, source order, and speaker ownership remain intact.

---

### User Story 2 - Generate one eligible panel from independently compiled supported intent (Priority: P1)

After reviewing the constrained Structure storyboard, the author generates one eligible panel through the existing Visual workflow without attaching a performance reference and without authoring a regeneration prompt. The browser-visible result shows one assigned character, framed from close-up through waist-up, on a system-defined solid matte background, assembled with existing FrameRenderer geometry. The provider-facing generation request is compiled independently from supported panel intent, approved character identity authority, approved project-style authority, and the system-owned matte-background rule—not from raw source text, raw Storyboarder prose, or arbitrary full panel-description prose.

**Why this priority**: This is the first browser-visible Visual outcome of DEC-050. Structure constraint alone is insufficient if unsupported detail can still reach the image provider.

**Independent Test**: From the ready constrained storyboard, generate one eligible panel once in the same open session without a performance reference and without a user-authored regeneration prompt, then review the assembled panel in existing FrameRenderer geometry.

**Acceptance Scenarios**:

1. **Given** a ready Structure storyboard whose future image panels satisfy User Story 1, with approved identity and project-style authority available for the chosen panel’s character, **When** the user generates one eligible panel without a performance reference and without a user-authored regeneration prompt, **Then** the interface shows a truthful busy state for that attempt and, on success, presents one browser-visible panel image for review.
2. **Given** that successful generation, **When** the user reviews the panel in the existing FrameRenderer geometry, **Then** the visible panel shows exactly one assigned character framed from close-up through waist-up on a system-defined solid matte background, and never shows more body coverage than a waist-up shot.
3. **Given** the generation attempt, **When** the provider-facing generation request is formed, **Then** it is compiled independently from supported panel intent, existing approved character identity authority, existing approved project-style authority, and the system-owned matte-background rule.
4. **Given** raw source text, raw Storyboarder prose, or arbitrary full panel-description prose, **When** the provider-facing generation request is formed, **Then** those materials are not concatenated into that request.
5. **Given** unexpected unsupported detail that nevertheless remains upstream of generation, **When** the provider-facing generation request is formed, **Then** that unsupported detail does not affect the compiled request.
6. **Given** a successful panel result, **When** the user reviews identity and project style, **Then** approved identity authority and approved project-style authority remain the authorities used for the attempt, and existing separation of identity, project style, and performance authority is preserved.
7. **Given** a multi-panel frame that later uses independently generated panels, **When** those panels are assembled, **Then** assembly continues to use independent one-character panel images and existing deterministic FrameRenderer geometry.

---

### User Story 3 - Immediate non-user-dependent failures stay honest during the Happy Path (Priority: P1)

While the author performs the Happy Path once in one open page, the system handles the immediate failures that do not require extra user interruption. Unsupported Storyboarder scenario prose is corrected or rejected before a candidate is presented as ready. A future image panel with zero or multiple assigned characters is not ready. Unsupported text that survives upstream is excluded by independent downstream compilation. A live provider result that still invents environmental content cannot serve as acceptance evidence; it is preserved as a reproducible failure and requires the smallest correction before owner acceptance.

**Why this priority**: Observed Structure and Visual failures already occur during an uninterrupted Happy Path. Omitting them would make the slice appear ready while misrepresenting the product grammar.

**Independent Test**: Exercise each immediate failure with the retained reference dialogue evidence and/or synthetic mutations that isolate one unsupported semantic category, without requiring reload, cancellation, overlapping starts, or other deferred recovery behavior.

**Acceptance Scenarios**:

1. **Given** Storyboarder output that contains unsupported scenario prose of the kinds observed in retained evidence frames 1, 3, 4, 5, 6, and 7, **When** the Structure storyboard would otherwise be presented as ready, **Then** the candidate is corrected into supported intent or rejected before presentation as ready, so the Structure storyboard does not misrepresent what the image path supports.
2. **Given** a future image panel that assigns zero characters or more than one character, **When** readiness is evaluated, **Then** that candidate is not ready because it violates the one-character generation grammar.
3. **Given** unsupported text that survives upstream of image generation, **When** the provider-facing generation request is compiled, **Then** independent downstream compilation excludes that unsupported content so it cannot invent environments, furniture, objects, or interactions through prompt forwarding.
4. **Given** a live provider result that still invents environmental content despite constrained compilation, **When** acceptance evidence is judged for this slice, **Then** that result cannot serve as acceptance evidence; it is preserved as a reproducible failure and the smallest correction is required before owner acceptance.
5. **Given** any handled rejection or failure in this slice, **When** an implementation agent or coordinator inspects safe diagnostics, **Then** enough evidence remains to identify panel address, supported intent used for compilation, generation-brief/compiler version, identity and style authority identifiers, terminal result, and rejection or failure reason—without logging raw protected material, credentials, secret-bearing URLs, provider payloads, or image bytes.

### Edge Cases

- Storyboarder emits unsupported scenario prose (locations, interiors, furniture, props, additional people, physical interaction, visible text, style instructions, invisible narrative/temporal prose): correct or reject before presenting as ready; do not present a misrepresentative ready Structure storyboard.
- Future image panel assigns zero characters: candidate is not ready.
- Future image panel assigns multiple characters: candidate is not ready.
- Upstream unsupported detail remains after Structure review or in legacy/unexpected data: independent downstream compilation still excludes it from the provider-facing request.
- Narrative or support-dependent wording (sitting, standing, lying down, sleeping, waking up, continuing to speak, being in a meeting): convert to visible upper-body geometry and expression when visually relevant, otherwise omit; never invite chairs, beds, tables, rooms, or similar objects.
- Live provider invents environmental content despite constrained compilation: not acceptance evidence; preserve as reproducible failure; require smallest correction before owner acceptance.
- Nested-panel, border, collage, or inset composition artifacts may still appear in generated images during this first slice; they are disclosed as unsolved and belong to a later separately accepted slice.
- Missing approved identity or project-style authority continues to block provider work with an honest actionable state under existing Visual behavior; this slice does not redesign those gates.
- Provider failure, timeout, or technically invalid image output continue to produce honest attempt outcomes under existing Visual behavior; this slice does not add recovery, resume, or overlapping-start machinery.
- Human visual review remains required; the system must not auto-approve artistic quality or automatically detect visual-content defects as an acceptance substitute.

## Requirements *(mandatory)*

### Functional Requirements

#### Happy Path and supported grammar

- **FR-001**: The user MUST be able to create a complete Structure storyboard from the retained Putin/Durov/Peskov reference dialogue in one open browser session without reload, navigation away, cancellation, manual retry, or overlapping work, and then review every future generated-image panel description.
- **FR-002**: Every future generated-image panel presented as ready MUST assign exactly one character.
- **FR-003**: System-created textual descriptions for future generated-image panels presented as ready MUST contain only supported visual intent: exactly one assigned character; framing from close-up through waist-up; shot scale and crop; visible geometry of torso, shoulders, head, arms, and hands; an in-crop gesture; head turn and tilt; gaze direction; facial expression; and a system-defined solid matte background.
- **FR-004**: A character shown through this Visual path MUST NEVER be described or generated with more body coverage than a waist-up shot.
- **FR-005**: System-created image-panel descriptions presented as ready MUST NOT contain locations or contextual scenery, interiors, furniture, props or other objects, additional people, physical interaction between characters, visible text, user or Storyboarder rendering-style instructions, or invisible narrative causes or temporal prose as image content.
- **FR-006**: Words and concepts such as sitting, standing, lying down, sleeping, waking up, continuing to speak, or being in a meeting MUST be converted into visible upper-body geometry and expression when visually relevant, or omitted; they MUST NOT invite support objects or scenery (for example, “sits upright” MUST NOT invite a chair and MUST become visible geometry such as an upright torso and tense shoulders when relevant).
- **FR-007**: Source dialogue wording, source order, and speaker ownership MUST remain intact through Structure creation and Visual generation in this slice.
- **FR-008**: Existing deterministic FrameRenderer geometry MUST remain the assembly and review path for the browser-visible panel result.

#### Independent Storyboarder and downstream boundaries

- **FR-009**: Storyboarder restriction and downstream image-generation compilation MUST be independent requirements: satisfying one MUST NOT be treated as satisfying the other.
- **FR-010**: A textual panel description MUST be treated as review content, not as an image-generation prompt.
- **FR-011**: The downstream image-generation request MUST be compiled independently from supported panel intent, existing approved character identity authority, existing approved project-style authority, and the system-owned matte-background rule.
- **FR-012**: Raw source text, raw Storyboarder prose, and arbitrary full panel-description prose MUST NOT be concatenated into the provider-facing generation prompt.
- **FR-013**: Unexpected unsupported upstream detail MUST NOT affect the provider-facing generation prompt.
- **FR-014**: Existing separation of identity authority, project-style authority, and performance authority MUST be preserved. This slice’s acceptance path MUST NOT use a performance reference. `DEC-032` remains unchanged for a later performance-reference slice: when a performance reference is used later, it controls composition, crop, head angle, gaze, expression, pose, and stillness.
- **FR-015**: Multi-panel frames MUST continue to be assembled from independent one-character panel images.

#### Immediate failures and diagnostics

- **FR-016**: If Storyboarder emits unsupported scenario prose, the system MUST correct or reject the candidate before presenting it as ready so the Structure storyboard does not misrepresent what the image path supports. Observed evidence for this failure class includes retained frames 1, 3, 4, 5, 6, and 7.
- **FR-017**: If a future image panel assigns zero or multiple characters, the candidate MUST NOT be ready.
- **FR-018**: If unsupported text survives upstream, independent downstream compilation MUST exclude it from the provider-facing generation prompt. Observed evidence for the harm of forwarding such content includes the bedroom-like result associated with retained frame 6.
- **FR-019**: If the live provider still produces invented environmental content, that result MUST NOT serve as acceptance evidence for this slice; it MUST be preservable as a reproducible failure and MUST require the smallest correction before owner acceptance.
- **FR-020**: The system MUST retain only the minimum safe diagnostic evidence needed for an implementation agent or coordinator to reproduce and correct a failed panel: panel address; supported intent used for compilation; generation-brief/compiler version; identity and style authority identifiers; terminal result; and rejection or failure reason. Diagnostics MUST NOT log raw protected material, credentials, secret-bearing URLs, provider payloads, or image bytes. This slice MUST NOT add a diagnostic subsystem.
- **FR-021**: Artistic acceptance MUST remain an explicit human Visual review step. This slice MUST NOT introduce automatic visual-content detection or automatic artistic approval as an acceptance substitute.

#### Architecture boundary and deferred work

- **FR-022**: This slice MUST NOT require a new persistent entity, asset type, workflow stage, permanent AI role, operation resource, state machine, recovery subsystem, or automatic reviewer. If later planning claims any such mechanism is required, that claim is a blocker for owner approval rather than an accepted requirement of this specification.
- **FR-023**: Nested-panel artifacts, borders, collages, and inset composition MAY still occur during this first slice and are explicitly NOT claimed as solved here; eliminating them belongs to a later separately accepted slice.
- **FR-024**: The following MUST NOT become requirements of this specification: filtering a user-authored panel-regeneration prompt; validating or correcting performance-reference transfer; patterned or contextual backgrounds; interiors, furniture, props, additional people, and physical interaction as product capabilities; wider-than-waist-up or full-body images; whole-storyboard image generation; changes to dialogue, layout selection, timing, audio, or renderer geometry; reload recovery, resume, cancellation, overlapping starts, polling, concurrency, and stale-operation handling; promotion of historical feature 006 mechanisms into requirements; and description of unsupported visual capabilities as planned deferred features.
- **FR-025**: Historical unmerged feature 006 mechanisms MUST NOT be treated as accepted product requirements for this slice.
- **FR-026**: Acceptance evidence for Structure constraint MUST include the retained Putin/Durov/Peskov reference dialogue as observed acceptance evidence, and MUST use synthetic mutations to isolate unsupported semantic categories without turning one dialogue’s artistic direction into a universal rule.

### Key Entities

- **Supported panel intent**: The bounded visible character-performance content allowed for a future generated-image panel: one assigned character; framing from close-up through waist-up; shot scale and crop; visible upper-body geometry and in-crop gesture; head turn and tilt; gaze direction; facial expression; and a system-defined solid matte background. This specification does not prescribe whether that intent is carried by existing fields, bounded text, or a small typed representation.
- **System-created panel description**: The Structure-review textual placeholder for a future generated-image panel. It is review content, not a provider-facing generation prompt.
- **Independently compiled generation request**: The provider-facing image-generation input compiled only from supported panel intent, approved identity authority, approved project-style authority, and the system-owned matte-background rule.
- **Eligible panel**: A future generated-image panel that assigns exactly one character, presents only supported intent as ready, and has the approved authorities required by the existing Visual workflow for generation without a performance reference and without a user-authored regeneration prompt.
- **System-defined solid matte background**: The non-scenic, non-patterned, non-contextual background required by the current Visual grammar.
- **Retained reference dialogue**: The owner-retained Putin/Durov/Peskov dialogue used as observed acceptance evidence. It is pasted for acceptance and is not copied into repository fixtures by this specification.
- **Safe failure evidence**: The minimum diagnostic fields listed in FR-020, usable to reproduce and correct a failed panel without exposing protected material.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In one open browser session, a user can create the complete Structure storyboard from the retained Putin/Durov/Peskov reference dialogue and review every future generated-image panel without reload, navigation away, cancellation, manual retry, or overlapping work.
- **SC-002**: On review of that ready Structure storyboard, 100% of future generated-image panels assign exactly one character and contain only supported visible character-performance intent.
- **SC-003**: On review of that ready Structure storyboard, 0% of future generated-image panels presented as ready contain unsupported scenario categories listed in FR-005.
- **SC-004**: In the same uninterrupted session, the user can generate at least one eligible panel without a performance reference and without a user-authored regeneration prompt and review the result in existing FrameRenderer geometry.
- **SC-005**: On human visual review of a successful Happy Path panel, the visible result shows exactly one assigned character, framed from close-up through waist-up, on a system-defined solid matte background, with no greater body coverage than waist-up.
- **SC-006**: For every exercised generation attempt in this slice, the provider-facing request is compilable from supported intent plus identity, style, and matte-background authorities without concatenating raw source text, raw Storyboarder prose, or arbitrary full panel-description prose.
- **SC-007**: For every exercised case where unsupported detail remains upstream, that detail does not appear in or affect the compiled provider-facing request.
- **SC-008**: Storyboarder unsupported-prose cases and zero/multiple-character assignment cases are never presented as ready in 100% of exercised instances; each is corrected or rejected before readiness.
- **SC-009**: A live provider result that invents environmental content is never counted as acceptance evidence for this slice; such a result remains identifiable as a reproducible failure requiring the smallest correction before owner acceptance.
- **SC-010**: Source wording and speaker ownership remain intact through the Happy Path.
- **SC-011**: Nested-panel, border, collage, or inset artifacts are explicitly disclosed as unsolved for this slice and are not counted against or claimed as solved by SC-005.
- **SC-012**: Safe diagnostic fields sufficient to reproduce and correct a failed panel remain available to the implementation agent and coordinator without exposing protected material, credentials, secret-bearing URLs, provider payloads, or image bytes.

## Assumptions

- The starting implementation baseline already provides Structure storyboard creation, Visual panel generation for eligible panels, approved identity and project-style authorities, truthful busy/failure states for ordinary Visual attempts, and FrameRenderer assembly; this feature constrains panel intent and independent compilation inside that existing path rather than inventing a parallel workflow.
- “Future generated-image panel” means a panel intended to receive a character image in the Visual path, not a non-image review-only metadata surface.
- “System-defined solid matte background” means a plain non-scenic fill owned by the system, not a location plate, patterned backdrop, or contextual interior.
- “Eligible panel” for the acceptance path means a panel that meets the one-character supported-intent grammar and existing Visual authority requirements, generated without a performance reference and without a user-authored regeneration prompt.
- The retained Putin/Durov/Peskov reference dialogue remains owner-pasted acceptance evidence and is not committed into fixtures by this specification.
- Synthetic mutations isolate unsupported semantic categories for testing; they do not redefine the product’s artistic direction from one dialogue’s preferred layouts or performances.
- Observed evidence frames 1, 3, 4, 5, 6, and 7 and the bedroom-like frame 6 result are retained owner-review evidence motivating the immediate failures; exact internal field names and storage for that evidence remain a Plan-time concern.
- Whether supported intent is represented with existing fields, bounded text, or a small typed structure is intentionally left open for Plan; this specification defines observable product behavior only.
- Nested-panel elimination, user-authored regeneration-prompt filtering, and performance-reference transfer are later separately accepted slices under DEC-050 and are not partial requirements here.
- Feature 006 remains historical evidence and a possible future code donor only; none of its hybrid composition, recovery, polling, diagnostic, or new persistence requirements are accepted here.
- Open implementation alternatives for exact compiler wording, internal intent representation, and reuse of existing Visual machinery remain open for Plan.

## Out of Scope

Deferred by Product Gate and explicitly excluded from this specification:

- eliminating nested panels, borders, collages, and inset composition from generated images (later DEC-050 slice; may still occur here);
- filtering a user-authored panel-regeneration prompt (later DEC-050 slice);
- validating or correcting performance-reference transfer (later DEC-050 slice);
- patterned or contextual backgrounds;
- interiors, furniture, props, additional people, and physical interaction as product capabilities;
- wider-than-waist-up or full-body images;
- whole-storyboard image generation;
- changes to dialogue, layout selection, timing, audio, or renderer geometry;
- reload recovery, resume, cancellation, overlapping starts, polling, concurrency, and stale-operation handling;
- automatic visual-content detection or automatic artistic approval;
- a new persistent entity, asset type, workflow stage, permanent AI role, operation resource, state machine, recovery subsystem, or automatic reviewer;
- a diagnostic subsystem beyond the minimum safe fields in FR-020;
- promotion of historical feature 006 mechanisms into requirements;
- describing unsupported visual capabilities as planned deferred features;
- implementation code, planning artifacts, tasks, research artifacts, contracts, or data models.

This specification does not prescribe database tables, endpoint shapes, polling loops, worker topology, exact prompt text, internal intent schemas, or implementation modules.
