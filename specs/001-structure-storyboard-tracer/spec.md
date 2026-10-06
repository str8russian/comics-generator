# Feature Specification: Read-only Structure Storyboard Tracer

**Feature Branch**: `001-structure-storyboard-tracer`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "A user pastes a ready, loosely structured Russian dialogue and receives a complete, read-only, panel-aware Structure storyboard through the final frame, or a clear blocking source-fidelity failure."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the whole storyboard (Priority: P1)

A person who already has a nearly finished Russian dialogue pastes it once and receives a complete read-only storyboard. Every planned frame is present, from the opening through the final frame, and the last frame can be opened in the review view. Each frame shows its intended single-panel or split-panel layout. Every panel contains its own textual visual description. Spoken dialogue appears in full under the speaking panel. A derived silent or action frame has no dialogue, no invented on-screen caption, and no dialogue bar, so its panels use the full frame height.

**Why this priority**: The tracer is the first demonstrable product outcome. Without a complete reviewable storyboard, later editing and persistence have nothing to attach to.

**Independent Test**: Paste one multi-line Russian dialogue that includes a two-person exchange and one silent action, then open the first frame and the last frame. The storyboard is readable without editing, saving, or signing in.

**Acceptance Scenarios**:

1. **Given** a ready multi-line Russian dialogue, **When** the user pastes it and asks for a storyboard, **Then** a read-only storyboard is shown and the user can reach the last frame.
2. **Given** a two-person exchange staged as a split frame, **When** the user inspects that frame, **Then** each panel has its own textual visual description and the complete dialogue sits under the speaking panel.
3. **Given** a derived silent or action beat, **When** the user inspects that frame, **Then** it introduces no dialogue and no visible action caption, omits the dialogue bar, and lets the panels fill the frame height.

---

### User Story 2 - Refuse an unfaithful storyboard (Priority: P1)

If the generated storyboard cannot be shown as a faithful reading of the paste, the user sees a clear blocking failure instead of a storyboard presented as ready. Missing, duplicated, reordered, or changed source dialogue is blocked. Unresolved speaker ownership is blocked. A response that is structurally valid but does not preserve the source dialogue is blocked. Dialogue shown to the user is reconstructed from the submitted draft, or from references back to that draft, and is not trusted merely because the model emitted schema-valid text.

**Why this priority**: A complete-looking storyboard that changes the user's words is a failed tracer, not a successful one. The failure must be visible and must not be labeled ready.

**Independent Test**: Seed one fidelity defect at a time against an otherwise usable dialogue. Each defect produces a blocking failure and does not present a ready storyboard.

**Acceptance Scenarios**:

1. **Given** a generated storyboard that drops a source line, duplicates a source line, reorders source lines, or changes source wording, **When** the result is checked, **Then** each of those four defects is blocked on its own and no ready storyboard is shown.
2. **Given** a paste whose speaker ownership cannot be resolved, **When** the user submits it, **Then** staging is blocked and no ready storyboard is shown.
3. **Given** a model response that passes schema validation but does not preserve the source dialogue, **When** the result is checked, **Then** the storyboard is blocked and is not presented as ready.

---

### Edge Cases

- An empty paste, or a paste with no dialogue, ends in a blocking failure rather than an empty storyboard marked ready.
- A single-speaker dialogue can still produce a complete storyboard when speaker ownership is clear.
- A long spoken line is shown in full. The review view does not truncate, scroll, or hide the remainder.
- Notes, stage directions, and aliases may sit beside dialogue. They do not become spoken lines unless the source presents them as dialogue.
- A silent frame may describe an action for review outside the frame. That description is not drawn as a caption inside the frame.
- If generation fails, times out, or returns unreadable output, the user sees a failure and does not see a partial storyboard marked ready.
- The draft exists only for the current session. Leaving or refreshing the session discards it. That is expected for this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to paste one uncommitted dialogue draft and request a storyboard from that paste alone.
- **FR-002**: The draft MUST accept loosely structured Russian dialogue, including optional context, directions, actions, aliases, and informal notes.
- **FR-003**: The system MUST produce a storyboard that covers the whole draft, from the first planned frame through the final planned frame.
- **FR-004**: The user MUST be able to open the final frame from the review view.
- **FR-005**: Each frame MUST show its intended layout as either one panel or a split of two panels, with a separate textual visual description inside every panel.
- **FR-006**: For a frame that contains dialogue, the complete dialogue block MUST appear under the speaking panel, and the other panel of a split MUST remain visible.
- **FR-007**: A derived silent or action frame MUST NOT add dialogue, MUST NOT show an invented visible caption, MUST omit the dialogue bar, and MUST let the panels occupy the full frame height.
- **FR-008**: Frame geometry for panels and dialogue MUST be rendered by the existing `FrameRenderer`. This feature MUST NOT introduce a second implementation of that geometry.
- **FR-009**: The storyboard MUST be read-only. The user cannot edit frames, change wording, regenerate a frame, or undo from this feature.
- **FR-010**: Before a storyboard is presented as ready, deterministic checks MUST block missing, duplicated, reordered, or changed source dialogue.
- **FR-011**: Speaker ownership that cannot be resolved MUST block presentation of a ready storyboard. This feature does not ask the user to confirm a cast or resolve an alias.
- **FR-012**: Dialogue displayed in the storyboard MUST be reconstructed from the submitted draft or from references to that draft. A model-emitted copy MUST NOT become the authoritative wording because it is schema-valid.
- **FR-013**: The storyboard model response MUST be one `json_object` completion through `POST /v1/chat/completions`, using `max_completion_tokens` when an explicit output limit is sent. The response MUST pass deterministic local schema validation before it can be shown as ready.
- **FR-014**: A blocking failure MUST be visible and MUST NOT present the invalid artifact as a ready storyboard.
- **FR-015**: The draft MUST remain uncommitted and in-session. This feature does not create a stored source revision.

### Key Entities

- **Dialogue draft**: The single pasted text for this session. It is the only authority for spoken wording and speaker ownership.
- **Structure frame**: One reviewable storyboard frame with a single or split layout, panel descriptions, and either source-owned dialogue or a derived silent action.
- **Source-fidelity result**: The pass or blocking failure produced by comparing the storyboard's reconstructed dialogue and order with the draft.
- **Ready storyboard**: The read-only sequence shown only after schema validation and source-fidelity checks both pass, including a reachable final frame.

### Out of Scope

- Persistent source revisions, project storage, and private links.
- Cast or alias confirmation, and any ambiguity-resolution screen beyond a blocking failure.
- Manual frame editing, regeneration, history, and undo.
- Splitting, merging, adding, or deleting frames.
- Export, Docker, and external access.
- Images, a Visual storyboard, audio, and video.
- Accounts, a Critic or Reviewer, candidate ranking, retrieval over a document collection, and fine-tuning.
- Restoring a Writer, Editor, Director, and Reviewer role sequence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the six acceptance scenarios above, each scenario produces the specified ready storyboard or the specified blocking failure, with no scenario presenting an invalid artifact as ready.
- **SC-002**: For a passing multi-line dialogue, the user can open both the first frame and the last frame without editing or saving.
- **SC-003**: Every seeded loss, duplication, reordering, and wording change is blocked individually, so four distinct fidelity defects do not collapse into one generic failure.
- **SC-004**: In a passing storyboard, a reviewer can reconstruct the spoken wording from the draft alone and find no added, dropped, reordered, or rewritten source line.

## Assumptions

- The user already has a nearly finished dialogue. This feature does not invent a story from a blank prompt.
- A recommended `Character: line` form may be used, but it is not required. When that form is absent and speaker ownership is still clear, the storyboard may proceed. When it is not clear, the result is a blocking failure.
- Split layout in this feature means two panels. Layouts with more than two panels are not part of the tracer.
- Silent and action frames are derived. They may have review text outside the frame. They do not add facts or spoken lines.
- One generation is shown. This feature does not run an automatic repair loop after a blocking failure.
- Session loss of the uncommitted draft is acceptable. Persistence belongs to a later feature.
- The contest compatibility spike is accepted input for FR-013 only: one `json_object` response, local validation, and no chunking assumption. Effective reasoning level remains unresolved and is not a requirement of this feature.
- The existing `FrameRenderer` already implements conditional full-height panels when a frame has no dialogue. This feature reuses that behavior.
- The unfilled SpecKit constitution scaffold does not add product principles for this feature.
