# Contract notes: Panel-ready dialogue frame

Observable interface changes are **minimal**. Prefer existing Visual routes and shapes. This note documents only the clarifications required by the Plan.

## Unchanged routes

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/visual` | Load visual state including panels’ `assetId`, `generationStatus`, `generationError`, `visualReady`, style seed ids |
| `POST` | `/api/visual/frames/:frameId/generate` | Synchronous frame generation (two panels for split2) |
| `POST` | `/api/visual/frames/:frameId/panels/:panelIndex/generate` | Panel-scoped regeneration; optional performance image in body |
| `PATCH` | `/api/visual/frames/:frameId/panels/:panelIndex/placement` | Zoom/position only; no provider generation |

## Frame generate — preflight failure (new honesty)

For an **eligible** ordinary two-character `split2` frame, if required authority is missing (unresolved subject, missing approved identity anchor, or missing project style seed), the handler MUST:

- perform **zero** provider image calls;
- not advance any panel’s ready pointer;
- return an actionable failed outcome with a stable kind:

| Kind | Meaning |
|------|---------|
| `subject-required` | One or both panel subjects unresolved |
| `anchor-required` | Missing approved identity anchor for a required subject |
| `style-required` | Missing approved project style seed |

Transport may be a non-2xx visual failure payload `{ status: "failed", kind }` (preferred for whole-frame block) consistent with existing `sendVisualFailure` patterns. Do not invent an operation resource or `202`.

Out-of-scope frame types keep historical generate behavior and are not forced through this preflight contract.

## Frame generate — success and partial attempt (existing shape, clarified semantics)

Successful transport remains HTTP 200 with the refreshed visual state plus:

```json
{
  "generationFailures": [{ "panelIndex": 1, "kind": "provider" }]
}
```

Semantics:

- `generationFailures` empty ⇒ latest frame attempt fully succeeded for requested panels.
- `generationFailures` non-empty ⇒ latest attempt is partial or failed; MUST NOT be described as fully successful.
- Frame `visualReady` remains true iff every panel currently has a ready `assetId`, which may still be true when a replacement attempt failed and previous ready images were retained.
- Per panel, `generationStatus`/`generationError` reflect the latest attempt; `assetId` reflects the current ready generation pointer.

Clients MUST treat attempt outcome (`generationFailures` / latest status) and artifact readiness (`visualReady` / `assetId`) as distinct.

## Panel generate

- Invalid `performanceImageDataUrl` ⇒ `invalid-image` (or existing image parse kinds); no provider call; ready pointer unchanged.
- Missing anchor/style for eligible panel-ready regeneration ⇒ same authority kinds as preflight; no provider call.
- Provider/`timeout`/`invalid-output` failures preserve previous ready `assetId` when present.

## Placement

Unchanged: PATCH updates zoom/position only. Implementations MUST NOT call the image provider.

## UI copy kinds to support

Add Russian actionable copy for `style-required` (and `subject-required` if exposed). Existing kinds (`anchor-required`, `invalid-image`, `provider`, `timeout`, `invalid-output`) remain.

No attempt-history browser, candidate gallery, or provenance export endpoints are part of this contract.
