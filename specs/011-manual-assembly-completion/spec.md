# Feature Specification: Manual assembly and completion

**Feature Branch**: `codex/011-manual-assembly-completion`

**Created**: 2026-10-14

**Status**: Draft

**Input**: Block B of `DEC-055`, with `Q-039`, `Q-040`, and `Q-041` settled only for this Happy Path.

## User Scenarios & Testing

### User Story 1 — Assemble frames and panels (Priority: P1)

From the current browser storyboard, the owner inserts, deletes, and reorders frames, and adds, deletes, and reorders panels. A single panel frame becomes `split2` when a panel is added, and returns to `single` when one panel of a pair is removed. Character ownership, source-linked dialogue, the assigned image, and zoom/pan/mirror stay with the semantic panel.

**Independent Test**: Reorder two panels that already have different placement and dialogue roles. The speaking panel, its source text, its image, and its placement move together. An invalid reorder leaves the previous board unchanged.

**Acceptance Scenarios**:

1. **Given** a structure frame, **When** the owner inserts an image frame or a text card at a chosen position, **Then** the new frame has a new identity and existing frames keep theirs.
2. **Given** a selected structure frame, **When** the owner deletes or reorders frames, **Then** the operation addresses that structure frame, not a different node that merely shares a display number.
3. **Given** a `single` frame, **When** the owner adds a panel, **Then** the frame becomes `split2` and the original panel keeps its identity and state. **Given** a `split2` frame, **When** the owner removes the non-speaking panel, **Then** the frame becomes `single`.
4. **Given** typed dialogue, **When** panels move, **Then** the dialogue wording and source order stay unchanged, and the speaker index follows the same semantic panel.

### User Story 2 — Use an image without generation (Priority: P1)

The owner uploads a PNG, JPEG, or WebP, or picks an image already in this storyboard, and assigns it to one or more panels. The same asset id is reused. No image provider is called and no generation attempt is recorded.

**Independent Test**: Upload one file, assign it, then assign that same asset to a second panel. Exactly one new asset row exists when the bytes are new. The second assignment adds none. Panel descriptions stay as they were.

**Acceptance Scenarios**:

1. **Given** a local PNG, JPEG, or WebP within the existing size limit, **When** the owner assigns it, **Then** the panel shows that image after reload.
2. **Given** an image already stored for this storyboard, **When** the owner assigns it again, **Then** the panel references the same asset id and the bytes are not duplicated.
3. **Given** a rejected file, **When** assignment fails, **Then** the previous image and storyboard remain usable.

### User Story 3 — Set frame kind and duration (Priority: P1)

The owner can use an ordinary dialogue frame, an image-only frame with no dialogue bar, and a text card whose text is not source dialogue. Each configurable frame shows duration in frames and seconds. A frame without typed dialogue starts at 36 frames (1.2 seconds at 30 fps).

**Independent Test**: Create an image-only frame and a text card, change the card text and duration, reload, and see the same values. A dialogue duration shorter than the reveal is rejected and the text is unchanged.

**Acceptance Scenarios**:

1. **Given** no explicit duration, **When** a frame has typed dialogue, **Then** the compiled duration is 12 frames of pre-roll, reveal at 12 characters per second, and a 36-frame hold.
2. **Given** no typed dialogue and no stored duration, **When** the frame is shown, **Then** the duration is 36 frames and 1.2 seconds.
3. **Given** a typed-dialogue frame, **When** the owner sets a duration that would cut the line off before the reveal finishes, **Then** the save is rejected and the wording stays as stored.

### User Story 4 — Render the current board (Priority: P1)

The owner starts one local Remotion render from the browser. The page shows idle, running, success, or failure without a made-up percentage. Success plays and downloads the video. The video uses the current order, assigned images, text cards, durations, zoom, pan, mirror, a 1920×1080 frame, a 300 px dialogue area when dialogue exists, no horizontal dialogue hairline, and a 48 px `split2` divider.

**Independent Test**: Compile the persisted board to one video spec, render it with the existing Remotion composition, and see a playable file whose spec contains those fields.

**Acceptance Scenarios**:

1. **Given** a render is already running, **When** the owner starts another, **Then** the second start is refused and the first continues.
2. **Given** success, **When** the owner opens the result, **Then** the server only serves the current render output.
3. **Given** failure, **When** the page explains it, **Then** the message is short and safe, and the server log keeps the operational detail.

### User Story 5 — See which build is running (Priority: P2)

The storyboard page shows a build marker that comes from the running server. A Docker rebuild followed by reload shows the new marker rather than a cached one.

**Independent Test**: `GET /api/build` returns a git SHA, a source fingerprint, or the explicit fallback `dev`, with `Cache-Control: no-store`. If the request fails, the page shows `unknown`.

## Requirements

- **FR-001**: Manual structure edits MUST go through one addressable operation layer. The browser calls that layer. This block MUST NOT add a natural-language command parser.
- **FR-002**: Frames keep a stable structure id across reorder. A new frame gets a new id. Display ordinals and overflow ids MUST NOT be used as the only structure address.
- **FR-003**: Each panel MUST have a stable id. Reorder, `single`/`split2` changes, and copy-forward MUST move placement, assignment, subject, and source-linked dialogue ownership with that id. Panel index MAY remain the display coordinate.
- **FR-004**: Accepted mutations MUST be atomic. A rejected mutation MUST leave the last saved storyboard and assets usable.
- **FR-005**: Dialogue wording and source order MUST NOT be rewritten by structure, upload, duration, or render operations.
- **FR-006**: Upload and reuse MUST validate PNG, JPEG, and WebP within the existing 12 MiB limit, MUST NOT call an image provider, and MUST NOT create a generation attempt. Reuse MUST keep the same asset id.
- **FR-007**: Asset bytes, panel intent (`description`), and an optional owner note MUST stay separate. Reuse MUST NOT copy another panel’s description or note.
- **FR-008**: The practical layouts are only `single` and `split2`.
- **FR-009**: Duration MUST be stored in frames, shown in seconds at 30 fps, and rejected when it is not a positive finite integer or when it would truncate typed dialogue before reveal completes.
- **FR-010**: Text-card text MUST be owner-authored display text and MUST NOT create or edit source items.
- **FR-011**: One compiler MUST turn the persisted current storyboard into the Remotion input, including order, kinds, assets, text, durations, dialogue, speaker ownership, and per-panel zoom, position, and mirror.
- **FR-012**: The Remotion frame MUST stay 1920×1080, keep a 300 px dialogue area when typed dialogue exists, draw no horizontal dialogue hairline, and keep a 48 px vertical divider for `split2`.
- **FR-013**: At most one local render runs at a time. States are idle, running, success, and failure. The result route MUST NOT accept a client-chosen file path.
- **FR-014**: The build marker MUST be served by the running process and MUST NOT be a hard-coded client string. Missing git metadata MUST fall back to a build-time source fingerprint, then `dev`. The page shows `unknown` only when that request fails.
- **FR-015**: These operations MUST make zero image-provider calls.

## Owner corrections

- A frame with one assigned panel and one empty panel shows the assigned image immediately and a placeholder for the missing panel.
- One anchored picker assigns a reusable thumbnail or a disk upload in the same step.
- Either panel of a `split2` frame can be deleted. Deleting the speaking panel requires an explicit confirmation that the exact dialogue stays and ownership moves to the surviving panel.
- Reorder controls say what they do and are disabled at the ends. A panel note is labeled as a note that is not used for generation.
- The current visible asset is one choice. A later successful generation replaces an earlier upload or reuse. Failure keeps the last-good image. The current image is the revision reference. A manual panel without an explicit cast subject cannot generate.
- Every accepted storyboard-content change is one persisted undo step. Undo walks backward and survives reload. Redo is out of scope.
- Operations shows each owner action and the submitted instruction text.

## Out of Scope

- Block C base-image redesign, speaking/listening renditions, and performance-reference transfer.
- Block D undo history, source-aware dialogue editing, intent synchronization, and matte color.
- Intro, title, and outro templates.
- Layouts other than `single` and `split2`.
- Production queues, cancellation, crash recovery, remote workers, and a durable render registry.
- Repair of the unrelated PostgreSQL `storyboard-result` expectation.
