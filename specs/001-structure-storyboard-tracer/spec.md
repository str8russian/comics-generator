# Feature Specification: Read-only Structure Storyboard Tracer

**Feature Branch**: `001-structure-storyboard-tracer`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "A user pastes a ready, loosely structured Russian dialogue and receives a complete, read-only, panel-aware Structure storyboard through the final frame, or a clear blocking source-fidelity failure."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the whole storyboard (Priority: P1)

A person who already has a nearly finished Russian dialogue pastes it once and receives a complete read-only storyboard. The paste is interpreted, for this session only, as one ordered sequence of source-authored utterances, actions, context, and notes. Staging may then insert a derived pause, reaction, or continuity beat. Every planned frame is present, from the opening through the final frame, and the last frame can be opened in the review view. Each frame shows its intended single-panel or split-panel layout. Every panel contains its own textual visual description. Spoken dialogue appears in full under the speaking panel. A silent frame, whether it comes from a source-authored action or from a derived beat, has no invented on-screen caption and no dialogue bar, so its panels use the full frame height.

When a spoken utterance is too long for the fixed dialogue area, the storyboard first fits it by reducing the font inside that fixed area. It does not truncate, scroll, or hide the text, and it does not move the visual panels. If the whole utterance still cannot fit at the minimum readable size, it is divided into consecutive display blocks. Reading those blocks in order reproduces the exact source utterance.

**Why this priority**: The tracer is the first demonstrable product outcome. Without a complete reviewable storyboard, later editing and persistence have nothing to attach to.

**Independent Test**: Paste one multi-line Russian dialogue that includes a two-person exchange, one source-authored silent action, and one utterance too long for a single dialogue area. Open the first frame and the last frame. The storyboard is readable without editing, saving, or signing in.

**Acceptance Scenarios**:

1. **Given** a ready multi-line Russian dialogue, **When** the user pastes it and asks for a storyboard, **Then** a read-only storyboard is shown and the user can reach the last frame.
2. **Given** a two-person exchange staged as a split frame, **When** the user inspects that frame, **Then** each panel has its own textual visual description and the complete dialogue sits under the speaking panel.
3. **Given** a derived pause, reaction, or continuity beat, **When** the user inspects that frame, **Then** it is marked as derived, introduces no new fact or dialogue and no visible action caption, omits the dialogue bar, and lets the panels fill the frame height.
4. **Given** a source-authored action with no spoken line, **When** the user inspects its frame, **Then** the frame is silent, the action remains source-authored rather than derived, and the action is still visible as review information outside the frame.
5. **Given** one source utterance that cannot fit in the fixed dialogue area at the minimum readable size, **When** the storyboard is shown, **Then** the utterance appears as consecutive display blocks, concatenating those blocks reproduces the exact source wording in the original order, and the blocks keep the same composition and visual states unless a source-authored or directing beat justifies a change.

---

### User Story 2 - Refuse an unfaithful storyboard (Priority: P1)

If the storyboard cannot be shown as a faithful reading of the paste, the user sees a clear blocking failure instead of a storyboard presented as ready. Missing, duplicated, reordered, or changed source dialogue is blocked. A source-authored utterance, action, context note, or other source item that is not accounted for by a frame reference or review metadata is blocked. Unresolved speaker ownership is blocked. A response that is structurally valid but does not preserve the source is blocked. Exact source text is reconstructed through references to source items and display blocks. It is not trusted merely because the model emitted schema-valid text.

**Why this priority**: A complete-looking storyboard that changes the user's words, drops a source action, or presents an inferred speaker as settled is a failed tracer, not a successful one. The failure must be visible and must not be labeled ready.

**Independent Test**: Seed one fidelity defect at a time against an otherwise usable dialogue. Each defect produces a blocking failure and does not present a ready storyboard.

**Acceptance Scenarios**:

1. **Given** a generated storyboard that drops a source line, duplicates a source line, reorders source lines, or changes source wording, **When** the result is checked, **Then** each of those four defects is blocked on its own and no ready storyboard is shown.
2. **Given** a paste that contains a source-authored action, context item, or note, **When** that item has neither a frame reference nor review metadata, **Then** readiness is blocked and no ready storyboard is shown.
3. **Given** a paste whose speaker ownership cannot be resolved, **When** the user submits it, **Then** staging is blocked and no ready storyboard is shown.
4. **Given** a model response that passes schema validation but does not preserve the source through source-item and display-block references, **When** the result is checked, **Then** the storyboard is blocked and is not presented as ready.

---

### Edge Cases

- An empty paste, or a paste with no source-authored material, ends in a blocking failure rather than an empty storyboard marked ready.
- A single-speaker dialogue can still produce a complete storyboard when speaker ownership is explicit or can be provisionally inferred without ambiguity.
- An utterance that fits after font reduction stays in one display block. The visual panels do not move.
- An utterance that does not fit at the minimum readable size becomes consecutive display blocks. The review view does not truncate, scroll, or hide the remainder.
- Notes, stage directions, and aliases may sit beside dialogue. They remain source items. They do not become spoken lines unless the source presents them as dialogue.
- A silent frame may describe an action for review outside the frame. That description is not drawn as a caption inside the frame. A source-authored action stays source-authored; only a staging insertion is marked derived.
- A derived beat that adds a fact or a spoken line is blocked.
- If generation fails, times out, or returns unreadable output, the user sees a failure and does not see a partial storyboard marked ready.
- The draft and its interpretation exist only for the current session. Leaving or refreshing the session discards them. That is expected for this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to paste one uncommitted dialogue draft and request a storyboard from that paste alone.
- **FR-002**: The draft MUST accept loosely structured Russian dialogue, including optional context, directions, actions, aliases, and informal notes.
- **FR-003**: The system MUST build an in-session ordered interpretation that distinguishes source-authored utterances, actions, context, and notes from any later derived beats. This interpretation MUST NOT be stored as a Source Revision.
- **FR-004**: The system MUST produce a storyboard that covers the whole interpreted sequence, from the first planned frame through the final planned frame.
- **FR-005**: The user MUST be able to open the final frame from the review view.
- **FR-006**: Each frame MUST show its intended layout as either one panel or a split of two panels, with a separate textual visual description inside every panel.
- **FR-007**: For a frame that contains dialogue, the complete display block MUST appear under the speaking panel, and the other panel of a split MUST remain visible.
- **FR-008**: Dialogue geometry MUST stay fixed. A longer block MUST be fit by deterministic font reduction inside that area. The storyboard MUST NOT truncate, scroll, or hide dialogue, and MUST NOT move the visual panels to make room for it.
- **FR-009**: If a complete source utterance cannot fit at the minimum readable size, the storyboard MUST divide it into consecutive display blocks during initial staging. Concatenating those blocks MUST reproduce the exact source utterance without rewriting or reordering. Those blocks MUST keep the same composition and visual states unless a source-authored or directing beat justifies a change. This automatic overflow handling is in scope. A later user-directed split or merge is not.
- **FR-010**: A silent frame, whether source-authored or derived, MUST NOT show an invented visible caption, MUST omit the dialogue bar, and MUST let the panels occupy the full frame height.
- **FR-011**: A source-authored action MUST remain source-authored when it is rendered as a silent frame. A derived pause, reaction, or continuity beat MUST be marked as derived, MUST link to the surrounding source items, MUST add no new fact or dialogue, and MUST remain reviewable in the storyboard.
- **FR-012**: Every source-authored item MUST be accounted for by a frame reference or by review metadata. An unaccounted source item MUST block readiness.
- **FR-013**: Frame geometry for panels and dialogue MUST be rendered by the existing `FrameRenderer`. This feature MUST NOT introduce a second implementation of that geometry.
- **FR-014**: The storyboard MUST be read-only. The user cannot edit frames, change wording, regenerate a frame, undo, or perform a structural split, merge, add, or delete after generation.
- **FR-015**: Before a storyboard is presented as ready, deterministic checks MUST block missing, duplicated, reordered, or changed source dialogue, and MUST block any source-authored item that is not accounted for.
- **FR-016**: The draft is authoritative for exact source wording and source order. Speaker ownership MAY be explicit in the paste or provisionally inferred during interpretation. Ownership that cannot be resolved MUST block readiness. This feature does not ask the user to confirm a cast or resolve an alias.
- **FR-017**: Exact source text MUST stay outside authoritative model output. Displayed dialogue MUST be reconstructed through source-item and display-block references. A model-emitted copy MUST NOT become the authoritative wording because it is schema-valid.
- **FR-018**: The feature MAY use a preceding in-session interpretation step. It does not require interpretation and staging to be collapsed into one model call. The complete staging payload MUST be returned in one `json_object` completion through `POST /v1/chat/completions`, not chunked, using `max_completion_tokens` when an explicit output limit is sent. That response MUST pass deterministic local schema validation before it can be shown as ready. This feature does not add a repair loop.
- **FR-019**: A blocking failure MUST be visible and MUST NOT present the invalid artifact as a ready storyboard.
- **FR-020**: The draft and its interpretation MUST remain uncommitted and in-session. This feature does not create a stored source revision.

### Key Entities

- **Dialogue draft**: The single pasted text for this session. It is authoritative for exact source wording and source order. Speaker ownership may be explicit in that text or only provisional until interpretation; unresolved ownership blocks readiness. The draft is not a cast-confirmation record.
- **Source-linked interpretation**: The in-session ordered reading of the draft into source-authored utterances, actions, context, and notes, plus any derived beats attached to that order. It is discarded with the session and is not a stored Source Revision.
- **Display block**: One visible piece of a source utterance. Consecutive display blocks of the same utterance concatenate back to that utterance exactly.
- **Structure frame**: One reviewable storyboard frame with a single or split layout, panel descriptions, and either a display block, a source-authored silent action, or a derived beat.
- **Derived beat**: A pause, reaction, or continuity frame inserted during staging. It is marked derived, linked to surrounding source items, and adds no fact or dialogue.
- **Source-fidelity result**: The pass or blocking failure produced by comparing reconstructed source items, display blocks, wording, and order with the draft.
- **Ready storyboard**: The read-only sequence shown only after schema validation and source-fidelity checks both pass, including a reachable final frame and an account of every source-authored item.

### Out of Scope

- Persistent source revisions, project storage, and private links.
- Cast or alias confirmation, and any ambiguity-resolution screen beyond a blocking failure.
- Manual frame editing, regeneration, history, and undo.
- User-directed structural operations after generation: splitting, merging, adding, or deleting frames. This exclusion does not cover automatic display-block creation for overflow, source-authored silent or action frames, or derived beats created during initial staging.
- Export, Docker, and external access.
- Images, a Visual storyboard, audio, and video.
- Accounts, a Critic or Reviewer, candidate ranking, retrieval over a document collection, and fine-tuning.
- Restoring a Writer, Editor, Director, and Reviewer role sequence.
- An automatic repair loop after a blocking failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each acceptance scenario produces the specified ready storyboard or the specified blocking failure, and none presents an invalid artifact as ready.
- **SC-002**: For a passing multi-line dialogue, the user can open both the first frame and the last frame without editing or saving.
- **SC-003**: Every seeded loss, duplication, reordering, and wording change is blocked individually, so those fidelity defects do not collapse into one generic failure.
- **SC-004**: In a passing storyboard, concatenating the display blocks of each utterance reproduces that source utterance exactly, and every source-authored item is accounted for by a frame reference or review metadata.
- **SC-005**: For an utterance that cannot fit at the minimum readable size, the user sees consecutive display blocks without truncation and without the visual panels moving.

## Assumptions

- The user already has a nearly finished dialogue. This feature does not invent a story from a blank prompt.
- A recommended `Character: line` form may be used, but it is not required. Explicit speaker ownership is used when present. Otherwise interpretation may infer it provisionally. When ownership remains unresolved, the result is a blocking failure, not a confirmation screen.
- Split layout in this feature means two panels. Layouts with more than two panels are not part of the tracer.
- The minimum readable size and the fixed dialogue area are format rules applied deterministically. The model does not choose them per line.
- Source-authored actions can be silent frames. Derived beats are a separate staging insertion. Neither kind becomes an on-screen caption.
- One staging completion is shown. A preceding in-session interpretation step is allowed. This feature does not run an automatic repair loop after a blocking failure.
- Session loss of the uncommitted draft and its interpretation is acceptable. Persistence belongs to a later feature.
- The contest compatibility spike is accepted input for FR-018 only: the staging payload is one `json_object` response, locally validated, with no chunking assumption. Effective reasoning level remains unresolved and is not a requirement of this feature.
- The existing `FrameRenderer` already implements conditional full-height panels when a frame has no dialogue. This feature reuses that behavior.
- The unfilled SpecKit constitution scaffold does not add product principles for this feature.
