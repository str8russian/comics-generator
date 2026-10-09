# Data Model: Visual Storyboard Repair

This repair does not add tables. It uses the existing visual-workflow schema in `app/storyboard-web/db/migrations/003_visual_storyboard_workflow.sql`.

## Visible frame

A display unit produced by `expandStoryboardFrames`.

- `number`: 1-based index in the expanded list. This is the number the user writes.
- `id`: display id. Directing-beat segments currently look like `frame-1#2`.
- `structureFrameId`: underlying storyboard frame id.
- `structureSegmentIndex`: integer for a directing-beat segment, otherwise null.
- `layout`: `single` or `split2`.
- `dialogue`: reconstructed spoken text for that visible unit.
- `panels[]`: panel descriptions shown in the text storyboard.

Validation: a user instruction that names a number outside `1..visibleCount` is an expected rejection, not a successful no-op.

## Structural storyboard version

Existing `storyboard_version` / `storyboard_head`.

- Applying an edit inserts a new version whose parent is the previous head.
- Undo moves `storyboard_head.active_storyboard_version_id` to that parent.
- Frames stored on the version remain source-owned structure frames, not the expanded visible list.

Validation: `buildChecked` and dialogue fidelity still run before insert. Dialogue text is rebuilt from source items, never taken as model-authored wording.

## Source accounting

Existing source items on the confirmed material.

- `utterance` and `action` must appear exactly once as source-owned frames.
- `context` and `note` must appear in review and must not be dropped by an edit.
- The stored board’s `item-1` is context and must remain reviewed after a successful edit.

## Identity photo

Existing `visual_asset` (`kind = identity-reference`) and `character_identity`.

- MIME in (`image/png`, `image/jpeg`, `image/webp`).
- Raw `byte_length` in `(0, 12582912]`.
- SHA-256 of the stored bytes.
- Character name must already exist on the active material.

Validation: magic bytes must match the declared format. `image/jpg` is a JPEG declaration. HEIC/HEIF is unsupported.

## Safe failure kind

Not a stored entity. Returned by repaired endpoints:

| Kind | HTTP | Meaning |
|------|------|---------|
| `structure-rejected` | 409 | Fidelity or targeting rejected the structural candidate |
| `unsupported-image-format` | 400 | HEIC/HEIF or another unsupported still-image type |
| `image-too-large` | 400 | Raw bytes exceed the supported identity size |
| `invalid-image` | 400 | Declared as an image but bytes cannot be read as PNG, JPEG, or WebP |
| `invalid-request` | 400 | Malformed JSON or missing required identity/edit fields |
