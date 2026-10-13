# Feature Specification: Visual placement controls

**Feature Branch**: `codex/010-visual-placement-controls`

**Created**: 2026-10-14

**Status**: Draft

**Input**: Block A of `DEC-055`. Correct the static composition of already-generated panel images without regeneration: remove the horizontal hairline, drag each panel image to pan it, keep zoom, reset a selected panel, and horizontally mirror a selected panel.

## User Scenarios & Testing

### User Story 1 — Clean frame and direct pan (Priority: P1)

The owner opens an already-generated single or split frame in Visual detail and corrects the crop by dragging the panel image. The thin horizontal line between the picture and the dialogue is gone. The approved vertical split divider stays.

**Why this priority**: Unwanted hairline and missing pan are the P0 blockers to finishing a video without regenerating images.

**Independent Test**: Open a generated `single` frame and a generated `split2` frame. Drag one panel left, right, up, and down. Only that panel’s focal placement changes. The horizontal hairline is absent. The split divider remains 48 px in both the image strip and the dialogue cells.

**Acceptance Scenarios**:

1. **Given** a generated frame with dialogue, **When** it is shown in the storyboard or Visual detail, **Then** there is no 1–3 px horizontal rule between the visual area and the 300 px dialogue area.
2. **Given** a generated `split2` frame, **When** it is shown, **Then** the vertical divider between panels remains 48 px in both the image strip and the dialogue cells.
3. **Given** Visual detail for a generated image, **When** the owner drags that image, **Then** the focal placement follows the pointer at the rendered detail scale, and the other panel does not move.
4. **Given** a drag in progress, **When** the pointer is still moving, **Then** the picture may preview continuously, and the product records one committed placement at drag end.

### User Story 2 — Zoom, reset, and mirror compose (Priority: P1)

The owner keeps the existing zoom control, resets a panel to the deterministic default, and mirrors one panel horizontally. Pan, zoom, and mirror do not wipe each other.

**Why this priority**: Zoom is already useful. Reset and mirror are the other owner-visible controls in this block.

**Independent Test**: Zoom after pan and pan after zoom. Reset returns `zoom=1`, `positionX=50`, `positionY=30`, mirror off. Mirror flips only the selected panel, keeps the stored zoom and pan, and turning it off restores the unmirrored picture with those same values.

**Acceptance Scenarios**:

1. **Given** a non-default pan, **When** the owner commits zoom, **Then** the pan is unchanged. **Given** a non-default zoom, **When** the owner commits pan, **Then** the zoom is unchanged.
2. **Given** a selected panel, **When** the owner resets placement, **Then** that panel becomes zoom `1`, position `50/30`, mirror off, and the other panel is unchanged.
3. **Given** a selected panel, **When** the owner toggles horizontal mirror, **Then** only that rendition flips, no image provider is called, and the stored zoom and pan stay in place.
4. **Given** a failed save, **When** the control reports the result, **Then** it does not claim success and the last authoritative placement and last-good image remain usable.

### User Story 3 — Placement survives reload (Priority: P2)

Zoom, pan, and mirror are per-panel product state. They survive closing detail and reloading the browser. An unchanged panel keeps that rendition when storyboard state is copied forward.

**Independent Test**: Set a non-default zoom, pan, and mirror, close and reopen detail, reload, and read the same values back. Copy-forward of an unchanged panel keeps them.

**Acceptance Scenarios**:

1. **Given** a committed non-default placement, **When** detail is closed and reopened or the browser reloads, **Then** the same zoom, pan, and mirror are shown.
2. **Given** an unchanged panel description on a storyboard edit, **When** visual state is copied forward, **Then** zoom, pan, and mirror are copied with that panel.

### Edge Cases

- Non-finite or out-of-range zoom or position is rejected and does not become the stored placement. Zoom stays within 1–3. Position stays within 0–100.
- A drag on one panel never writes the other panel, another frame, or a new asset.
- Pointer movement is not a research event. One committed placement is.
- Panel regeneration, dialogue ownership, Close, Next, and the Research dock stay available. Placement itself does not start a generation attempt.

## Requirements

### Functional Requirements

- **FR-001**: The storyboard frame MUST NOT draw a horizontal hairline between the visual area and the dialogue area. Dialogue-bar height stays 300 px. Frame size stays 1920×1080.
- **FR-002**: `split2` MUST keep the 48 px vertical divider in both the image strip and the dialogue cells. A `single` frame MUST NOT gain that divider.
- **FR-003**: Visual detail MUST let the owner drag an existing generated panel image to change that panel’s focal placement. Storyboard-card thumbnails are not required to be draggable.
- **FR-004**: The same pointer gesture MUST move the focal placement in the expected direction at the rendered detail-frame scale, without a jump caused by that scale.
- **FR-005**: The existing zoom control MUST remain. Committing zoom MUST preserve current pan and mirror. Committing pan MUST preserve current zoom and mirror.
- **FR-006**: Reset MUST restore exactly zoom `1`, position `50/30`, and mirror off for the addressed panel only.
- **FR-007**: Horizontal mirror MUST affect only the addressed panel rendition, preserve stored zoom and pan, and restore the unmirrored rendition with those values when turned off.
- **FR-008**: Zoom, pan, and mirror MUST be authoritative per storyboard version, frame id, and panel index. They MUST survive detail close/reopen and reload. They MUST NOT call an image provider, start or finish a panel-generation attempt, or create or copy a visual asset.
- **FR-009**: Manual controls MUST commit through the existing placement operation on the server/store boundary. A failed commit MUST NOT be presented as saved.
- **FR-010**: Research capture MUST record the committed placement, including mirror, and MUST NOT record pointer-move events.
- **FR-011**: Placement MUST NOT change frame identity, panel order, character assignment, speaker panel, dialogue text, source spans, or the underlying asset bytes.

### Key Entities

- **Panel rendition placement**: zoom, horizontal focal percent, vertical focal percent, and horizontal mirror for one panel image. Default is zoom `1`, position `50/30`, mirror off.
- **Placement operation**: one addressed update of that rendition, or an explicit reset to the default. It does not create an asset or a generation attempt.

## Success Criteria

- **SC-001**: The owner can pan, zoom, reset, and mirror a generated panel in Visual detail with no image regeneration.
- **SC-002**: A split frame shows no horizontal hairline and still shows the 48 px vertical divider.
- **SC-003**: After reload, the committed zoom, pan, and mirror for each panel are unchanged.
- **SC-004**: Placement operations during deterministic verification make zero provider calls, zero generation attempts, and zero new or duplicated assets.

## Assumptions

- Direct drag updates the existing focal percents. It is not a freeform layout editor, animation, or camera move.
- Mirror is a rendition flag on the panel’s visual state, not a change to semantic intent, character assignment, or asset identity.
- Existing rows default to mirror off.
- Historical Remotion rough sources that are not the live storyboard renderer are left unchanged in this slice.

## Out of Scope

- Block B frame/panel assembly, upload, text cards, duration, and browser-launched Remotion rendering.
- Block C base-image workflow and speaking/listening assets.
- Block D undo/redo, dialogue edits, intent sync, and matte-color controls.
- Nested-panel cleanup, cumulative revision history, operation recovery, and a new natural-language batch parser.
- Repair of the unrelated PostgreSQL `storyboard-result` failure.
- Live provider calls or provider prompt changes.
