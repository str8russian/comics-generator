# Transparent foreground panel assets

## Status

Production contract for Feature 020. One owner-operated browser checkpoint. Implements `DEC-071` under the approved defaults D1–D12 in `DEC-073`.

## Contract

Generated and uploaded panel images gain a deterministic transparent foreground. The stored original stays unchanged. Frames draw that foreground over one system-owned background color. An extraction that does not pass draws the opaque original instead, and the Panel Editor says why.

### D1 — Extraction scope

Extraction runs for panel images created by panel generation, regeneration, and frame generation, and for uploaded panel images. Identity references, base anchors, performance references, and intro templates are unchanged.

### D2 — Matte contract

Every panel-image generation prompt appends the verbatim `stage-a2-matte-contract-v1` text. The rest of the prompt stays byte-identical to the pre-feature prompt for the same panel. The base-anchor prompt is unchanged. Generation provenance records the contract version and the SHA-256 of the contract text.

### D3 — Extractor

The extractor is `a1-known-matte-v2` with its frozen configuration. It runs synchronously after a successful panel-image or upload write, inside that same operation and transaction. It does not call a provider.

### D4 — Validation

`candidate-pass`, with or without warnings, uses the foreground. `review`, `reject`, and an extractor exception use the opaque original. The Panel Editor shows `Фон отделён` or `Фон не отделён`. Finding codes are available on demand and are not presented as an error. There is no automatic regeneration and no automatic provider retry. The owner can regenerate with the existing action.

### D5 — Storage

The original RGB asset is immutable, including its bytes and SHA-256. The foreground is a separate `panel-foreground` PNG RGBA asset linked to that source. Extraction metadata stores the extractor version, contract version, status, findings, and timing. One additive migration, `017_panel_foreground.sql`, adds the asset kind and `panel_foreground_extraction`. Composites are not stored.

### D6 — Background

Every panel uses one fixed system background, `system-slate-matte` (`#5d6e86`, RGB 93, 110, 134), equal to the reference slate-blue matte. An opaque fallback therefore looks the same as today at the same placement. There is no background-color UI.

### D7 — Rendering

`FrameRenderer` and the Remotion storyboard renderer draw that background under the panel image. They use the foreground when the extraction passed and the original otherwise, with the existing zoom, pan, and mirror transforms. Both surfaces receive the same draw asset, background color, and extraction status.

### D8 — Uploads and reuse

Uploaded panel images go through the same extractor. A pass uses the foreground. Any other result stays opaque and is labelled neutrally. Assigning or reusing an existing asset reuses its foreground record: no re-extraction and no extra byte copy inside the project. Project duplication carries foreground records under the reusable-asset rules in `DEC-063`: new destination-owned rows, no re-extraction. A foreground is not itself a picker entry.

### D9 — Existing projects

`node app/storyboard-web/backfill-panel-foreground.mjs --project <uuid>` is dry-run by default. `--apply` extracts foregrounds for that project's existing panel and uploaded images, makes no provider call, and is idempotent. Nothing extracts at startup or on `GET /api/visual`.

### D10 — Provider inputs

Any image sent to a provider, including the current panel as a regeneration basis or an anchor, is the original RGB asset. The RGBA foreground is never sent.

### D11 — Provider calls in this run

This implementation run makes zero real provider calls. Tests use synthetic fixtures. A live smoke test is optional and owner-run after the checkpoint.

### D12 — Out of scope

Project or frame background UI, per-frame or panel-region backgrounds, intro-template adoption, ML matting, matte-color variants, scene or image backgrounds (`DEC-050`), and R1 speaking/listening states.

## Invariants

- Manual UI and commands call the same addressable operations. Extraction is part of asset creation, not a new operation.
- One generation still creates one storyboard version, and one Undo reverts it. The foreground follows its source asset, so Undo does not leave a panel showing an orphaned foreground.
- The original asset bytes and SHA-256 are never modified. A foreground persistence failure is isolated, and the original asset always commits.
- Whether the foreground or the original is drawn, the Panel Editor states that fact.
- The same input bytes and frozen config produce the same RGBA pixels and the same extraction findings.
- `GET /api/visual` does not extract.

## Owner checkpoint

On a disposable `comics_test` project whose panels come from a fake provider serving archived Stage A2 images, the owner can:

- see extracted foregrounds over the system background, consistent across panels;
- find at least one panel that falls back to the opaque original, with `Фон не отделён` and finding codes;
- zoom, pan, and mirror a foreground panel as before;
- duplicate a frame and see the same foreground on the copy;
- compare one frame in Visual with a fake-provider render and see the same result;
- read the extraction status in the Panel Editor.

## Deferred

Background UI, intro adoption, and R1 speaking/listening states remain separate work.
