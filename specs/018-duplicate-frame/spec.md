# Duplicate frame

## Status

Production contract for Feature 018. One owner-operated browser checkpoint. This does not claim owner acceptance.

Duplicate is one addressable storyboard operation and a future primitive for composed actions such as progressive push-in. This feature does not implement progressive push-in, an AI planner, a device catalogue, or a macro layer.

## User action

**Дублировать кадр** is on the existing per-frame assembly controls, with insert, move, and delete; since Feature 019 these live in the frame inspector (`specs/019-workspace-shell/spec.md`). It is available for ordinary image frames, dialogue frames, and text cards. It is distinct from **Кадр с изображением после**, which creates a blank frame.

There is no new toolbar, context menu, bulk selection, or editor surface. One product-operation busy boundary blocks a second click while the request is in flight.

## Address and placement

The mutation address is the stable structure frame, never a display ordinal:

```json
{
  "op": "duplicateFrame",
  "structureFrameId": "...",
  "structureSegmentIndex": null
}
```

`displayFrameNumber` may travel with the request as research and UI context. It is not the mutation identity.

`duplicateFrame` is allowed only as that single top-level operation. A top-level `{ "op": "batch", "operations": [...] }` payload that contains `duplicateFrame` anywhere is rejected as `invalid-operation` before a transaction, version, head movement, panel-state copy, asset write, render invalidation, or provider call. The other operations in that batch are not applied. There is no batch result and no batch trace.

The duplicate is inserted immediately after the addressed structural frame. Existing frames keep their identities and relative order. Display numbers are derived again from the resulting order.

If the visible card belongs to a compound directing beat, Duplicate clones the complete structural frame, including its ordered segments, and inserts that complete clone after the source structural frame. It does not split or extract one segment. The clicked `structureSegmentIndex` stays UI and trace context. The assembly note says that duplication, insertion, deletion, and ordering apply to the whole structural frame.

## Copied state

The duplicate is a structured clone of the source frame's current semantic and presentation state, then new identities are assigned. That includes layout and frame kind, dialogue mode, stored dialogue or text-card text, speaker ownership and dormant speaker identity remapped onto the new panel ids, duration, directing and source-link and display-block values, ordered segments, ordered panels and their descriptions, manual subjects, and other stored panel fields, plus the effective image reference, asset origin, performance reference, zoom, pan, and mirror for every panel.

Ephemeral browser state and database or version metadata are not written into the frame JSON. Source-link metadata is preserved. Duplicating a frame does not create or change a source revision, interpretation, material state, working draft, draft token, source item, character anchor, style seed, or reusable-asset membership.

## Identity

The duplicate receives one new structural frame id, new panel ids for every cloned panel, and new `panel_visual_state` row ids on the new storyboard version. The source frame, its panels, and earlier versions stay unchanged.

Later edits, placement, image assignment, dialogue mode, panel changes, generation, reorder, and deletion addressed to the duplicate do not change the source. The shared objects are immutable references: the same `visual_asset`, approved character resources, and performance asset, until one side is changed explicitly.

## Assets and generation

Duplicate creates no `visual_asset` row, no copied image bytes, no provider call, and no `panel_generation` row. The copied panel starts with the same effective current image and reusable visual references.

The source panel's new version row may keep its existing `current_generation_id`, because that is how ordinary version copy-forward already works and it does not insert a generation. The duplicate's new panel row does not receive that pointer. Its current and assigned asset ids, origin, performance reference, zoom, pan, and mirror are copied. Generation history is not manufactured for the copy.

## Version and Undo

One successful click creates one `storyboard_version`, moves the head once, and records `duplicateFrame` as the instruction. The version operation context contains the source structure frame and the created structure frame.

The existing global Undo removes the whole duplicate in one step and restores the previous order, numbering, panel state, Visual approval, and render-affecting state. There is no second Undo button, redo, or history browser.

A missing or stale source address, an invalid persisted source, a database failure, or a rejected mutation leaves the previous head and the source frame unchanged.

## Selection

After success the client applies the returned visual state, resolves the created structure address in the new displayed list, and opens that copy. The detail shows the derived **Кадр N**. The source is not left selected.

The response carries the created structure frame id. The client does not guess it from the source index plus one. For a compound frame, `structureSegmentIndex` selects the matching display segment of the clone.

If Undo of `duplicateFrame` happens while that copy is open, the detail opens the source frame when it still exists. It does not keep a stale modal or a stale display number. Next-frame navigation and the grid follow the new order.

## Research

`frame_duplicate` is a semantic action on the existing research path: runtime allowlist, additive PostgreSQL check, and the research event schema.

One paired trace identifies the source structure frame and the clicked display or segment context, plus the created structure frame and the resulting display address. Success, failure, and no-change follow the existing outcome contract. The created id is a result-context field. It is not encoded into submitted text, a label, or an unrelated boolean. The storyboard-version operation context stores the same source and created mapping.

## Approval and render

Duplicate is a storyboard-content mutation. The new version is not Visual-approved. A process-current render for the previous sequence is dropped through the existing invalidation path and is not presented as current for the duplicated sequence.

## API

`POST /api/visual/operations` stays the only endpoint. A successful change returns the ready visual payload plus:

```json
{
  "changed": true,
  "operationResult": {
    "op": "duplicateFrame",
    "source": {
      "structureFrameId": "source-id",
      "structureSegmentIndex": null
    },
    "created": {
      "structureFrameId": "new-id",
      "structureSegmentIndex": null
    }
  }
}
```

Display numbers are derived after the visual state loads. Database row ids are not product addresses.

## Owner checkpoint

1. Note the source frame number, layout, dialogue mode and text, panels, images, placement, and duration.
2. Click **Дублировать кадр**.
3. The copy opens immediately at the next derived number.
4. Visible content matches and the frame identity is distinct.
5. Change one safe property of the copy. The source does not change.
6. Undo that property change if needed, returning to the freshly duplicated state.
7. One global Undo removes the duplicate and returns to the source.
8. Operations shows one `frame_duplicate` action with the source and created addresses.
9. Reload and confirm the persisted result, or repeat the action.

No real image call is used to prepare or verify the checkpoint.

## Protected

Project scope, secrets, owner data, source fidelity, frame geometry, panel gutter, placement, dialogue modes, text cards, Remotion compilation, and project duplication stay as they are.

## Out of scope

Progressive push-in and sequential-zoom macros. AI command composition, planner behavior, and device catalogues. Batch duplication, multi-select, project duplication, and cross-project behavior. Linked or live clones. Image-byte copying, asset import or export, generation, retries, and provider prompts. Source revision, interpretation, material or draft, cast, anchor, style-seed, and reusable-library semantics. Redo, a history browser, and a new history framework. Layouts beyond the accepted ones. Foreground extraction, transparency, and compositing. Unrelated Feature 011, 014, 015, 016, and 017 debt.
