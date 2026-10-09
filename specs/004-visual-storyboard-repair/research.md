# Research: Visual Storyboard Repair

## Decision: Preserve unstaged context and notes locally

- Decision: After any structural candidate is produced, set `review` to the source-item ids whose kind is `context` or `note`. Send that same list into the model as current review. Do not send `review: []`.
- Rationale: The live 409 body was `unaccounted-source-item` for `item-1`, a context row already stored in Stage review. The edit helper currently hard-codes empty review, so the model drops a required source item. Restoring review is enforcing the existing accounting invariant, not skipping it.
- Alternatives considered: Asking the model to remember review. Rejected because the prompt also says not to add review items, and the current payload contradicts the stored state. Weakening `assessStage` to allow missing context. Rejected by the specification.

## Decision: Deterministic handler for simple full-frame-only-character commands

- Decision: If the instruction names one visible frame number, one confirmed character, and a full-frame / only-that-character intent, apply the layout change in process. Keep dialogue by leaving source ownership unchanged. Then run the existing `buildChecked` / fidelity path. Other instructions still go to the configured text provider once, with no retry loop.
- Rationale: The reported instruction is mechanically a layout change on visible frame 14 (`frame-12`). Sending the whole board through the model is what created the review miss and can also retarget `frame-14` instead of visible 14. A bounded handler makes the demonstrated path reliable.
- Alternatives considered: Better targeting context only. Necessary but not sufficient for the exact reported command. Constrained model repair loops. Forbidden as unbounded retry. Changing the Stage prompt. No evidence it caused this 409.

## Decision: Visible numbers are the targeting unit

- Decision: Resolve the user’s number against `expandStoryboardFrames` output, using `structureFrameId` and `structureSegmentIndex`. Directing-beat segments stay the visible unit.
- Rationale: The stored board has 16 structure frames and 18 visible frames. Visible 1–3 are `frame-1` segments 0–2. Visible 14 is `frame-12`.
- Alternatives considered: Teaching the user internal ids, or adding a frame-selection UI. Both are out of scope.

## Decision: Identity parser and store must share one byte field

- Decision: `parseImageDataUrl` returns `bytes`. `saveIdentity` and `insertAsset` read `bytes`. Invalid images return a specific kind instead of throwing into a generic database failure.
- Rationale: A valid PNG currently returns HTTP 400 `invalid-request` because the parser’s `buffer` never satisfies `image?.bytes`. That matches the reported generic UI copy, which does not map `invalid-request`.
- Alternatives considered: Treating the report as HEIC-only. A valid PNG reproduced `invalid-request`, so HEIC is a remaining limitation, not the reported 400.

## Decision: Align transport and raw-image limits

- Decision: Keep the raw stored-image limit at 12 MiB (`visual_asset_size_check`). Set the identity JSON body limit high enough for base64 plus JSON wrapping of that raw size. Reject oversized raw files as `image-too-large` before insert.
- Rationale: 12 MiB raw becomes 16 MiB base64, then larger as a data URL inside JSON. `IMAGE_MAX_BODY_BYTES` is currently 16 MiB, so a supported raw file can miss the transport limit.
- Alternatives considered: Lowering the documented raw limit. Rejected because the database already allows 12 MiB and the product asks for a file close to the supported limit to succeed.

## Decision: HEIC/HEIF stays an explicit limitation

- Decision: Detect HEIC/HEIF by MIME, extension, and `ftyp` brand. Return `unsupported-image-format` with specific Russian copy. Do not convert HEIC in this repair. JPEG `image/jpg` is accepted when the bytes are JPEG.
- Rationale: No existing dependency performs a safe HEIC decode. Silently pretending HEIC works would hide the limitation.
- Alternatives considered: Adding a converter. Out of scope for a small vertical repair.

## Decision: Error contract for repaired endpoints

- Decision: Structural conflict → HTTP 409 `structure-rejected`. Unsupported image → 400 `unsupported-image-format`. Oversize → 400 `image-too-large`. Unreadable image → 400 `invalid-image`. Map those kinds in the client. Log safe kinds and fidelity codes. Do not put source-item ids, dialogue, or image bytes in the UI or logs.
- Rationale: The 409 body had no `kind`, so `fetchJson` threw a generic error. Expected cases must not use the generic fallback.
- Alternatives considered: Showing fidelity codes in the page. Rejected as internal language.
