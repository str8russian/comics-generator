# Gated single-panel revision

## Status

Implemented for the owner browser checkpoint. This spec does not claim owner acceptance, merge readiness, or production readiness.

Accepted direction: `DEC-050`, `DEC-053`, `DEC-055`, `DEC-075`, `DEC-076`, `DEC-077`, `DEC-079`, and `HYP-017`. The product owner completed the Product Gate before this slice. Feature 021 remains the only image-provider trace sink; its behavior-neutral contract is unchanged.

## Outcome

From one selected panel that already has a current image, the owner can create and compare revision candidates without changing the accepted panel image, navigate already generated candidates without another provider call, and explicitly Accept one selected candidate or Cancel the draft. Later Refine requests inherit the accepted supported visual state. New variation creates a visually independent alternative from the same current effective supported intent and does not send the current or selected image as a previous-image reference.

## First Happy Path

1. Open a project with one panel that already has a current image.
2. Select that panel and open its Panel Editor.
3. Choose **Уточнить текущее** (Refine current).
4. Enter one supported local change, such as a gaze or expression change.
5. Before generation, read the deterministic summary: basis, changes, preserved state, and text that will not be applied.
6. Start generation once.
7. See one draft candidate. The current panel image, storyboard head, render approval, and current asset stay unchanged.
8. Generate a second candidate. Move between Candidate 1 and Candidate 2 with candidate Undo/Redo. Those moves make no provider call. Undo to Candidate 1 and Refine again; that request uses Candidate 1 as its previous visual basis.
9. Select one candidate and press **Принять**.
10. Only then does that candidate become the current panel image, in one storyboard version and one global Undo step, with no second provider call.

**Новая вариация** and **Отменить черновик** are part of the same checkpoint. Their semantics are covered by automated tests even when the owner exercises only the Refine-and-Accept path in the browser.

## Entry

Production UI copy is Russian. Code and this spec keep the English contract terms Refine current and New variation.

For a panel with a current image, the Panel Editor offers:

- **Уточнить текущее** — starts from the current accepted panel image. Once the draft contains candidates, Refine starts from the selected candidate.
- **Новая вариация** — uses the current effective supported intent and approved identity, style, and applicable performance authority, and sends neither the current image nor a selected candidate as a previous-image reference.

A panel-target dock command for a panel that already has an image opens this same draft and carries the submitted text into it. It does not call the provider until the owner chooses a generative action. A command that is only zoom, pan, mirror, reset, or choosing an existing image focuses that existing control and makes no provider call.

Panels without a current image keep **Создать эту панель**. Frame generation is unchanged.

## Draft lifecycle

A successful revision result is a draft candidate. The open session holds the ordered candidates and exactly one selection. Candidate Undo and Redo navigate that list, make no provider call, and are distinct from global storyboard Undo. A later Refine uses the selected candidate as its visual basis. New variation appends to the same session and omits the previous image.

Accept promotes only the selected candidate. Cancel closes the draft and leaves the current image, generation, performance reference, placement, storyboard head, render state, and global Undo history unchanged. Closing the editor, Escape, changing stage, or reloading does not Cancel. The open draft returns on reload. Cancel asks for confirmation only when the draft already contains candidates.

Unaccepted and cancelled candidate bytes stay stored. They do not appear in the general reusable-asset picker. No pruning or deletion is part of this slice. After Accept or Cancel, the closed session is not a history browser.

## Effective state

The revision compiler is `panel-revision-intent/v1`. It covers assigned character, framing from close-up through waist-up, visible upper body and shoulders, in-crop gesture or the hands-out default, head turn, gaze, expression, supported eye and eyebrow state, the system-owned solid matte, and reference authority by identity.

A stored revision snapshot is reused when one exists. Otherwise the baseline is derived only from supported fields already stored on the asset. A new instruction is a patch: addressed properties replace prior values; omitted supported properties inherit. The compiler does not concatenate historical instructions and does not send raw source prose, Storyboarder prose, or unsupported owner prose to the provider.

For a legacy, uploaded, or reused image whose historical effective state is unknown, Refine still uses that image as the visual basis and compiles only the known supported state plus the explicit patch. The summary says that unknown history is not reconstructed.

Refine makes no provider call without a non-empty supported generative change. New variation may use an empty instruction. Zoom, pan, mirror, reset, and reuse stay on their existing provider-free paths.

## References

For Refine, the approved identity anchor and the selected visual basis are both sent. An applicable performance reference keeps its existing authority. Style is sent when the three-image budget allows. If style must be omitted, the existing omission evidence records that. Refine is never described as using a basis that was not sent. Reference budgeting does not change the chosen mode or start another provider attempt. New variation sends no previous-image reference.

A performance reference attached only on a candidate applies to the panel only if that candidate is accepted. Cancel does not change the current performance reference.

## Accept and Cancel

Accept checks that the selected candidate belongs to the open draft for the addressed project and panel, promotes its asset and effective supported intent, applies its performance choice when that candidate changed one, creates one storyboard version and one global Undo step, invalidates render approval the same way any accepted panel-image change does, records the owner Accept outcome, closes the draft, and makes no provider call. A failed Accept leaves the draft open and the current image unchanged.

Cancel records the owner Cancel outcome, closes the draft, and changes no accepted panel state. A failed Cancel leaves the draft recoverable and the current image unchanged.

## Failures inside one Happy Path

Provider failure or timeout adds no candidate, keeps the current image and any existing draft, and does not retry. If the provider result was stored and the HTTP response was lost, the next read shows the candidate without applying it. If candidate storage fails after provider success, the owner sees a storage failure, the current image stays, and the Feature 021 attempt remains. Accept and Cancel persistence failures leave the current image and the open draft. Foreground extraction failure keeps the original opaque candidate. Trace persistence failure stays fail-open and does not retry the provider.

## Acceptance-claim ledger

| Accepted claim | Required proof |
| --- | --- |
| One selected panel only | Browser Happy Path and address-isolation tests |
| Refine and New variation are distinct | Visible basis copy plus captured request references |
| Accepted local state carries forward | Accept change A, apply change B, prove A remains unless B supersedes it |
| Unsupported content cannot reach provider | Compiler/request test and visible Not applied summary |
| Candidate is not current before Accept | PostgreSQL and API assertions for current asset, storyboard head, render state, and global Undo |
| Draft history is provider-free | Undo/Redo request-count test and selected-basis test after Undo |
| Accept promotes only selected candidate | PostgreSQL lifecycle test, one storyboard version, zero Accept-time provider calls |
| Cancel changes no accepted state | PostgreSQL snapshot comparison, zero provider calls |
| Draft survives reload/restart | PostgreSQL-backed API/browser restoration test |
| Deterministic operations stay provider-free | Existing placement/reuse regressions plus R2 preflight test |
| Known failures retain last-good state | Provider, Accept, and Cancel controlled-failure tests |
| Exact provider evidence remains available | Feature 021 trace lookup linked through the candidate panel-generation identity |
| Owner Accept/Cancel is durable | Narrow review-outcome persistence and readback test |

## Value-loss review

Required and retained: effective-state inheritance, the supported-intent boundary, Refine and New variation, current or selected basis truth, candidate history inside the open draft, explicit Accept and Cancel, provider-free deterministic operations, durable provider evidence, and last-good-image protection.

Useful but deferred: a permanent history browser, multi-panel revision, richer recovery, historical backfill, an AI plan preview, candidate cleanup, and real-provider comparison.

Rejected: a generalized image editor, a generic command router, a candidate platform, a broad refactor, and a second trace or analytics subsystem.

## Provider policy

This slice makes no real provider calls. Verification uses the loopback fake provider or a deterministic provider double, synthetic `comics_test` data, and a non-production port. Each explicit Generate action is one provider attempt. Summary, candidate Undo/Redo, Accept, Cancel, zoom, pan, mirror, reset, upload, reuse, and reload make zero provider attempts.
