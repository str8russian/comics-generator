# Contract: Visual reliability API behavior

## Style seed

- `POST .../anchors/:id/approve` sets `project_style_seed` when absent.
- `POST .../characters/:name/anchor` uses the stored seed for style authority when present and distinct.
- Response of `GET /api/visual` MAY include `styleSeedAssetId` for diagnostics/UI readiness; no style-management endpoints are added.

## Frame and panel generation

- `POST /api/visual/frames/:frameId/generate` still generates required panels for one frame.
- Successful panels remain assigned after response.
- Partial failure returns visual state plus `generationFailures: [{ panelIndex, kind }]`.
- Expected kinds include at least: `timeout`, `provider`, `invalid-image`, `database`, `anchor-required`, `stale-version` / conflict equivalents already used by the app.

## Display path

- Clients MUST treat fitting/overflow as metadata-preserving.
- A frame is visually ready only when every required panel has `assetId`.

## Logging events (safe fields only)

Events: `visual-identity-start`, `visual-identity-outcome`, `visual-anchor-start`, `visual-anchor-provider`, `visual-anchor-storage`, `visual-anchor-approve`, `visual-frame-start`, `visual-panel-start`, `visual-panel-provider`, `visual-panel-storage`, `visual-frame-outcome`, `visual-placement`, `visual-load-failed`.

Allowed fields: request serial, operation/event, storyboard result/version ids, frame id, panel index, generation/anchor id, status, safe failure kind, HTTP status, provider status, latency, model name, validated image mime/width/height/byte_length.

Forbidden: credentials, auth headers, provider URL query strings, prompts, dialogue, panel descriptions, image bytes/base64, full provider bodies, free-form comments, sensitive stacks.
