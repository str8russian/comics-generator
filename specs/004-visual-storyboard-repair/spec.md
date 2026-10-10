# Feature Specification: Visual Storyboard Repair

**Feature Branch**: `codex/visual-workflow-repair`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Repair the currently non-working visual-storyboard prototype. Make two reported vertical paths work reliably and make failures understandable to a non-technical user: free-form structural storyboard editing with undo, and local identity-photo intake. Do not redesign or expand the product."

## Clarifications

### Session 2026-10-09

- Q: What is the smallest reliable fix when a structural candidate fails fidelity? → A: Preserve unstaged context and notes locally; apply a bounded deterministic handler for simple “this numbered frame should show only this character as a full-frame panel” commands; keep the model path for other instructions with no unbounded retry.
- Q: Should HEIC/HEIF be supported in this repair? → A: No silent support. Show supported formats before selection and return a specific Russian message for HEIC/HEIF. JPEG, PNG, and WebP must work.
- Q: How should expected visual failures appear? → A: Each repaired endpoint returns a stable safe failure kind and the correct HTTP status. The page shows a concise Russian explanation. Expected validation and conflict cases must not fall back to “Не удалось выполнить действие.”

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable structural storyboard editing (Priority: P1)

The user can see numbered text-storyboard frames, write a free-form structural instruction that uses those visible numbers, apply it, and see the updated storyboard. Dialogue wording, dialogue order, and source ownership stay intact. “Вернуть обратно” restores the previous structural state.

The visible frame number is the number the user uses. A visible frame that comes from a directing-beat segment is the same unit the instruction targets. The user never needs to understand semantic frames, directing beats, source items, or validation codes.

The exact instruction `в кадре 14 должен быть только Путин на весь кадр` must succeed on the current stored 18-frame storyboard: visible frame 14 becomes a single full-frame panel containing only Putin, its dialogue stays exactly unchanged, other visible frames stay unchanged unless a minimal mechanically necessary change is required, and the visible frame count does not change.

**Why this priority**: The stored storyboard cannot currently accept this structural change. Without a working edit-and-undo path, the visual workflow cannot be demonstrated.

**Independent Test**: Open the stored 18-frame storyboard, apply that Putin full-frame instruction, confirm frame 14 and its dialogue, then use “Вернуть обратно” and confirm the original frame 14 returns.

**Acceptance Scenarios**:

1. **Given** the stored 18-frame storyboard, **When** the user applies `в кадре 14 должен быть только Путин на весь кадр`, **Then** the request succeeds, visible frame 14 is a single full-frame Putin panel, its dialogue is unchanged, the visible frame count stays 18, and unrelated visible frames stay unchanged.
2. **Given** that successful change, **When** the user selects “Вернуть обратно”, **Then** the previous structural state, including original frame 14, is restored.
3. **Given** a visible frame that originates from a directing-beat segment, **When** the user names that visible number in an instruction, **Then** the change is applied to that visible unit, not to a different internal frame.
4. **Given** a genuinely rejected structural instruction, **When** the change cannot be applied without altering dialogue or dropping source material, **Then** the page shows a concise, actionable Russian explanation and does not show only “Не удалось выполнить действие.”
5. **Given** a successful or rejected edit, **When** the user inspects the page, **Then** no internal term such as source ownership, semantic frame, directing beat, or validation code is presented as user-facing copy.

---

### User Story 2 - Reliable identity-photo intake (Priority: P1)

The user chooses a local real photo for a character, the UI validates the file before sending it, the server accepts and validates the bytes, and the saved photo appears in the character card. Base-anchor generation then becomes available. Saving the photo makes no image-generation request.

A normal local JPEG, PNG, or WebP photo is accepted. Invalid, unsupported, and oversized files produce a specific, understandable Russian message. HEIC/HEIF is not silently treated as supported.

**Why this priority**: Saving a local identity photo currently fails before storage, so the rest of the visual path cannot start.

**Independent Test**: Save a non-sensitive JPEG or PNG fixture for one character, confirm the photo appears and base-anchor generation is enabled, confirm no image-provider request occurred, then try one invalid file and confirm the Russian explanation.

**Acceptance Scenarios**:

1. **Given** a supported JPEG, PNG, or WebP file within the size limit, **When** the user saves it as a character’s identity photo, **Then** it is stored locally, appears in that character card, and “Создать base anchor” becomes enabled.
2. **Given** that save, **When** no generation is requested, **Then** no image-generation provider request is made.
3. **Given** a HEIC or HEIF file, **When** the user selects or saves it, **Then** the page names the supported formats and explains that this format is not supported, instead of a generic failure.
4. **Given** an oversized file or an unreadable image, **When** the user tries to save it, **Then** the page explains the specific problem in Russian.
5. **Given** the identity-photo control, **When** the user has not yet chosen a file, **Then** the supported formats are visible before selection.

---

### Edge Cases

- A simple full-frame-only-character instruction against a directing-beat visible frame changes only that visible unit and keeps the rest of the beat’s dialogue partitions.
- A rejected model-produced structural candidate is not retried in a loop. The user sees an understandable failure and can rephrase.
- `image/jpg` is treated as JPEG when the bytes are JPEG.
- A file close to the supported raw-size limit must still fit through the encoded request limit.
- An unexpected server failure may still use a generic fallback. Expected validation and conflict cases must not.
- Zoom remains a placement operation and must not call the image provider.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST apply a free-form structural instruction against the same numbered frames the user sees, including a visible frame that originates from a directing-beat segment.
- **FR-002**: The system MUST preserve spoken dialogue wording, dialogue order, and source ownership for every structural edit. Structural changes MUST NOT silently alter dialogue.
- **FR-003**: The instruction `в кадре 14 должен быть только Путин на весь кадр` MUST succeed on the current stored storyboard by making visible frame 14 a single full-frame Putin panel without changing that frame’s dialogue or the visible frame count.
- **FR-004**: Simple “this numbered frame should show only this named character as a full-frame panel” commands MUST be handled by a bounded deterministic path so that success does not depend on rewriting the entire storyboard through the model.
- **FR-005**: Unstaged context and notes MUST remain accounted for locally during structural edits. The model MUST NOT be able to drop them by returning an empty review list.
- **FR-006**: Other free-form structural instructions MAY still use the configured text provider. There MUST be no unbounded retry loop.
- **FR-007**: “Вернуть обратно” MUST restore the previous structural state.
- **FR-008**: A genuinely rejected structural edit MUST return HTTP 409, a stable safe failure kind, and a concise actionable Russian UI message. It MUST NOT expose validation codes, source-item identifiers, prompts, or dialogue contents in the user-visible message.
- **FR-009**: The system MUST accept a local JPEG, PNG, or WebP identity photo, store it locally, show it on the character card, and enable base-anchor generation without calling the image-generation provider.
- **FR-010**: Client `accept` rules, client validation, server validation, and documented formats MUST agree. Supported formats MUST be shown before file selection.
- **FR-011**: The raw-image size limit and the encoded JSON request limit MUST be internally consistent, so a supported raw file is not rejected only because of base64 and JSON expansion.
- **FR-012**: Unsupported formats, including HEIC/HEIF, oversized files, and unreadable bytes MUST return the correct HTTP status, a stable safe failure kind, and a specific Russian UI message.
- **FR-013**: Saving a local identity photo MUST remain a local operation. It MUST NOT send the photo to an external provider.
- **FR-014**: Safe development diagnostics MAY log bounded failure kinds and fidelity codes. They MUST NOT log dialogue, credentials, identity-image bytes, provider responses, or other sensitive content.
- **FR-015**: Existing Interpret, material review, Stage, dialogue preservation, storyboard rendering, result isolation, and zoom-without-provider behavior MUST continue to pass.

### Key Entities

- **Visible frame**: The numbered storyboard unit the user sees and names in an instruction. It may come from a whole structural frame or from one directing-beat segment.
- **Structural storyboard version**: An append-only storyboard state. Applying an edit creates a new version; undo points back at the previous version.
- **Identity photo**: A locally stored real photograph for one confirmed character. It is not an illustrated anchor and is not sent to the image provider when saved.
- **Safe failure kind**: A stable, non-sensitive label for an expected visual failure. The UI maps it to Russian copy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A non-technical user can apply the stored-storyboard instruction “frame 14 should contain only Putin as a full-frame panel” and see the intended frame 14 update on the first successful attempt.
- **SC-002**: After that change, one “Вернуть обратно” action restores the previous frame 14.
- **SC-003**: A supported JPEG or PNG identity photo appears on the character card immediately after save, and base-anchor generation becomes available without an image-generation request.
- **SC-004**: Expected identity and structural failures show a specific Russian explanation instead of only “Не удалось выполнить действие.”
- **SC-005**: HEIC/HEIF selection or save is explained as an unsupported format, with JPEG, PNG, and WebP named as the supported options.
- **SC-006**: Automated regression tests cover the required structural, identity, limit, isolation, zoom, and existing pipeline cases, and the browser paths in SC-001 through SC-004 are exercised against the local PostgreSQL-backed server.

## Assumptions

- This repair does not redesign the rest of the visual workflow. Identity anchors, one-frame-at-a-time generation, performance references, zoom, and visual approval remain as already specified in `specs/003-visual-storyboard-workflow/spec.md`.
- The current stored 18-frame storyboard, including its directing-beat opening, is the reference artifact for the reported structural failure.
- Dialogue-editing UI, direct description-editing UI, batch generation, video generation, full-frame assignment, automatic image reuse, and product-memory updates are out of scope.
- HEIC/HEIF conversion is out of scope unless an already-available dependency makes it a small vertical change. Current evidence shows no such support.
- The project constitution file is still an unfilled template. Product principles in this specification and in the existing storyboard features remain the governing constraints.
- Test doubles are allowed only in automated tests. Browser verification uses the local PostgreSQL-backed server. Saving identity uses a synthetic test image.
