# Feature Specification: Visual Storyboard Workflow Spike

**Feature Branch**: `codex/visual-workflow-spike`

**Status**: Implemented spike; local product walkthrough pending user-supplied identity photos

## Goal

Exercise one real end-to-end path from a saved raw Russian dialogue to an approved visual storyboard. The spike uses the existing Interpret, cast confirmation, and Stage flow, then adds editable storyboard structure, user-supplied identity photos, iterative base anchors, panel-specific image generation, optional performance references, non-destructive panel zoom, and final Visual approval.

## User-visible scope

1. The existing raw-dialogue flow remains the entry point.
2. After Stage, the user can describe structural storyboard changes in free-form text, apply them, and undo the latest applied change.
3. Each confirmed character accepts a local identity photo and free-form anchor direction. The user can generate, revise, and approve a base anchor.
4. After all character anchors are approved, the user generates one frame at a time. A split frame generates each panel independently.
5. A generated panel can be regenerated from free-form direction. An optional local performance reference can guide that panel and later regenerations.
6. Panel zoom and focal position are placement changes and never call the image provider.
7. The visual storyboard can be approved only when every panel has an image. Approval marks the current visual state ready for video generation.

## Deliberate limits

- No batch generation.
- No dialogue editing UI in this slice.
- No direct text-description editing UI in this slice.
- No video generation in this slice; the terminal state is `Ready for video`.
- This slice does not implement automatic reuse. Every generated panel has its own assignment; this does not supersede the product requirement that deliberate reuse is allowed and encouraged when two panels genuinely need the same image.
- The image-spike worktree is read-only evidence. The product code owns its provider adapter and storage.

## Validation

- Offline tests never call a provider.
- Structural edits must preserve source dialogue and source order.
- Uploaded and generated image bytes are validated before storage and are served only by opaque asset id.
- Every provider result and every accepted anchor/panel version remains recoverable.
- Zoom updates do not create an image-generation request.
