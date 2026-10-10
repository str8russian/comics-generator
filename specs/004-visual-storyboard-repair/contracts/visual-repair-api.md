# Contract: Visual repair endpoints

Existing routes. This repair tightens request validation, success behavior, and the public error body.

## `POST /api/visual/storyboard/edit`

Request:

```json
{ "instruction": "в кадре 14 должен быть только Путин на весь кадр" }
```

Success: `200` with the current visual state. Visible frame 14 is a single-panel Putin frame. Dialogue for that frame is unchanged. `canUndo` is true.

Expected rejection: `409`

```json
{ "status": "failed", "kind": "structure-rejected" }
```

The body MUST NOT include source-item ids, fidelity codes, prompts, or dialogue. Safe codes MAY be written to the server log.

Empty instruction: `400` `{ "status": "failed", "kind": "invalid-request" }`.

## `POST /api/visual/storyboard/undo`

Success: `200` visual state with the previous structure restored.

Nothing to undo: `409` `{ "status": "failed", "kind": "nothing-to-undo" }`.

## `POST /api/visual/characters/{name}/identity`

Request:

```json
{ "imageDataUrl": "data:image/jpeg;base64,...", "comment": "" }
```

Accepted data-URL types: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`.

Success: `200` visual state. The named character has an identity asset URL. No image-generation provider request occurs.

Failures:

| HTTP | kind | When |
|------|------|------|
| 400 | `unsupported-image-format` | HEIC/HEIF or another unsupported type |
| 400 | `image-too-large` | raw decoded bytes exceed 12 MiB |
| 400 | `invalid-image` | PNG/JPEG/WebP declared but bytes do not match |
| 400 | `invalid-request` | missing JSON image field or invalid character payload |
| 413 | (empty close) | encoded JSON body exceeds the transport limit |

The transport limit MUST be large enough for a 12 MiB raw image encoded as a data URL inside JSON.

## Client mapping

The page maps `structure-rejected`, `unsupported-image-format`, `image-too-large`, `invalid-image`, `nothing-to-undo`, and the existing visual kinds to specific Russian copy. `invalid-request` on these actions also gets a specific message instead of only “Не удалось выполнить действие.”
