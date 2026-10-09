# Contract: Hybrid dialogue frame API behavior

## Selected-frame hybrid generation (async operation)

### Start generation

`POST /api/visual/frames/:frameId/generate`

Behavior:

1. Validate the request against the active storyboard version and selected frame.
2. Validate required authorities **before** creating an operation:
   - project style authority must exist → otherwise `409` `{ "status": "failed", "kind": "style-required" }`;
   - every required panel subject must have an approved identity anchor → otherwise `409` `{ "status": "failed", "kind": "anchor-required" }`;
   - on these validation failures: create **no** operation, **no** generation record, and make **no** provider request.
3. Create a persisted `visual_frame_operation` with initial phase `queued` / status `running` and a frame-scoped `write_version`.
4. Set `frame_hybrid_state.active_operation_id` to that operation.
5. Return promptly:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "status": "accepted",
  "operationId": "<uuid>",
  "frameId": "<frame-id>",
  "storyboardVersionId": "<uuid>",
  "phase": "queued",
  "writeVersion": 1
}
```

6. Server-side orchestration continues asynchronously and advances real phases only when corresponding work runs:
   - `preparing-background`
   - `generating-background` (skipped as a provider phase when a ready background is reused after prepare confirms reuse)
   - `generating-character-states`
   - `assembling`
   - `complete`
   - `failed`

Ordinary dialogue panels MUST follow the hybrid model:

1. ensure scene background for version-scoped scene `"primary"` (reuse ready, or create/retry failed under scene write authority);
2. ensure one character visual state per required panel;
3. validate deterministic assembly.

Shared background write authority:

- Sole current background pointer: `scene_background_state.current_generation_id`.
- To create/replace that background, the operation atomically claims `scene_background_state.active_operation_id` and captures/bumps scene `write_version`.
- Completing background work may advance `current_generation_id` only when operation id and captured scene write version still match.
- Ready background reuse does not claim replacement authority.
- Stale background completions may finalize their own records but must not change the current background pointer.

The endpoint MUST NOT satisfy ordinary dialogue success by silently returning two independent full-scene panel images as the hybrid result.

### Poll operation status (canonical live phase source)

`GET /api/visual/frames/:frameId/operations/:operationId`

This is the **canonical** live phase source while an operation is running.

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "operationId": "<uuid>",
  "frameId": "<frame-id>",
  "storyboardVersionId": "<uuid>",
  "writeVersion": 1,
  "phase": "generating-character-states",
  "status": "running",
  "errorKind": null,
  "componentFailures": [],
  "visualReady": false,
  "hybrid": {
    "sceneKey": "primary",
    "compositionMode": "near-frontal-pair",
    "background": { "status": "ready", "assetId": "<uuid>" },
    "panels": [
      {
        "panelIndex": 0,
        "subject": "<name>",
        "status": "pending",
        "assetId": null,
        "errorKind": null,
        "zoom": 1,
        "positionX": 50,
        "positionY": 30,
        "fitMode": "manual"
      }
    ]
  },
  "createdAt": "<iso>",
  "updatedAt": "<iso>",
  "finishedAt": null
}
```

Rules:

- Live phase polling uses this operation endpoint only.
- No fabricated percentages and no timer-simulated phase transitions.
- No independently calculated client phase may override the persisted operation state.
- Stale completions whose operation id / write version are no longer authoritative MUST NOT replace newer head pointers (frame heads via frame authority; shared background via scene authority).
- The frame enters Visual mode only when required background + all panel character states are ready and assembly validates (`visualReady: true` on complete).
- Operation `status` values are only `running`, `complete`, `failed`. Cancellation is out of scope.

### Retry

- Retry is another `POST /api/visual/frames/:frameId/generate` (or panel regenerate below).
- Retry creates a **new** operation and new generation records.
- A failed background may be retried by a new frame operation without a dedicated background-approval UI.
- A ready background for `(storyboard_version_id, "primary")` is reused while character states are retried, without claiming scene replacement authority.

### Failure response examples

Missing style before accept:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{ "status": "failed", "kind": "style-required" }
```

Missing required identity anchor before accept:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{ "status": "failed", "kind": "anchor-required" }
```

Unknown frame:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{ "status": "failed", "kind": "not-found" }
```

Terminal operation failure is observed via the canonical poll endpoint (`status: "failed"`, `phase: "failed"`, `errorKind`, `componentFailures`), while previously ready visible assets remain available through `GET /api/visual`.

## Component status surface (`GET /api/visual`)

Each split frame includes:

- `visualReady`
- `hybrid.sceneKey` (`"primary"` in this slice)
- `hybrid.compositionMode`
- `hybrid.activeOperationId`
- `hybrid.operation` summary when an operation exists (`operationId`, `phase`, `status`, `errorKind`, `writeVersion`) — used only to restore the correct operation id after page reload
- `hybrid.background`: resolved through scene association → `scene_background_state.current_generation_id` only
- `hybrid.panels[i]`: `{ subject, status, assetId?, errorKind?, zoom, positionX, positionY, fitMode }`
- concise panel descriptions / detailed briefs distinct from compiled prompts

Reload behavior:

1. `GET /api/visual` restores `activeOperationId` / latest persisted operation summary.
2. If that operation is still `running`, the client resumes live polling on  
   `GET /api/visual/frames/:frameId/operations/:operationId`.
3. Client-derived phase estimates must never override persisted operation state.

Fitted/overflow display pieces MUST preserve hybrid assignment and placement fields.

### Read precedence

- Complete current hybrid assembly wins when `visualReady` is true.
- Historical full-panel assets may remain readable for historical versions/frames not yet migrated.
- After hybrid generation begins for the current frame/version, do not silently fall back to an old full-scene image while claiming hybrid success.
- Failed/incomplete attempts keep the previously visible valid result and expose attempt failure separately.

## Character-state / panel regenerate

`POST /api/visual/frames/:frameId/panels/:panelIndex/generate`

Panel regeneration in feature 006 revises an already assembled hybrid frame. It must not introduce a second implicit background workflow.

Preconditions validated **before** creating an operation:

1. Ready primary-scene background must already exist → otherwise  
   `409` `{ "status": "failed", "kind": "frame-generation-required" }`  
   with **no** operation, **no** generation record, and **no** provider request. UI directs the user to generate the complete selected frame first.
2. Project style authority must exist → otherwise `409` `style-required` (no operation / no provider work).
3. Assigned subject must have an approved identity anchor → otherwise `409` `anchor-required` (no operation / no provider work).

Accepted behavior:

- Creates a persisted `visual_frame_operation` with `scope = panel` and `panelIndex`.
- Returns `202` with `operationId`; client polls the canonical operation endpoint.
- Reuses the ready primary-scene background; does not claim scene replacement authority; generates only the selected panel’s character state.
- Identity and style authorities are distinct required roles even if both resolve to the same underlying asset.
- Uses finalize-once generation records and frame-scoped stale-write/`write_version` rules for the character-state head pointer.

## Placement

`PATCH /api/visual/frames/:frameId/panels/:panelIndex/placement`

Body fields: `zoom`, `positionX`, `positionY`, optional `fitMode`.

- Updates `panel_visual_state` placement only.
- MUST NOT call the image provider.
- MUST NOT mutate or regenerate the scene background.
- Placement survives reload for the same storyboard version.

## Diagnostic export

`GET /api/visual/frames/:frameId/diagnostics`

Browser-download contract:

```http
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="frame-<frameId>-diagnostics.zip"
```

Scope: current active storyboard result/version and the requested frame only.

Archive MUST include safe local diagnostic data:

- operation and generation identifiers;
- result/version, semantic frame, visible frame, and panel identifiers;
- human-readable briefs;
- compiled provider prompts;
- negative constraints;
- reference roles and local asset identifiers or hashes;
- provider/model and non-secret parameters;
- lifecycle statuses, durations, and safe error kinds;
- background, raw chromakey character state, derived RGBA cutout, and deterministic composite where available;
- crop/placement settings;
- assembly manifest;
- prompt compiler / app / spec version identifiers when available.

Archive MUST exclude:

- API tokens, `.env`, Authorization headers;
- signed URL query strings / provider URLs containing secrets;
- raw provider response bodies containing secrets;
- unrelated frames and unrelated storyboard results/versions;
- automatic network upload behavior.

If no generation evidence exists for the frame, return:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{ "status": "failed", "kind": "not-found" }
```

## Provenance

- Every provider request creates a finalize-once `generation_record`.
- Provenance inputs are immutable after creation; lifecycle fields finalize exactly once from `pending` to `ready` or `failed`.
- Terminal records are never rewritten or reused; retries create new records.
- Component generation rows link to that record.
- Routine logs use allowlisted safe fields only and never print prompts, dialogue, image bytes, credentials, or full provider bodies.

## Style and identity authority

- Background generation: required project style authority; no character identity references.
- Character-state generation: required identity authority for assigned subjects and required project style authority as distinct roles.
- Validate both before creating an operation; missing style → `style-required`; missing identity → `anchor-required`.
- No silent text-only style fallback while claiming reproducible project style.

## Failure kinds (minimum)

- `configuration`, `invalid-request`, `invalid-image`, `unsupported-image-format`
- `anchor-required`, `style-required`
- `frame-generation-required` (panel regenerate without a ready primary-scene background)
- `provider`, `timeout`, `invalid-output`
- `matte-failed` (no usable alpha, keyed backing failure, or chromakey acceptance threshold failure)
- `assembly-failed`
- `database`, `conflict` (stale write / superseded operation or scene write authority)
- `not-found`

UI maps these to concise Russian actionable copy.

## Logging events (safe fields only)

- `visual-hybrid-frame-start`
- `visual-hybrid-operation-phase`
- `visual-background-start` / `visual-background-provider` / `visual-background-storage`
- `visual-character-state-start` / `visual-character-state-provider` / `visual-character-state-matte` / `visual-character-state-storage`
- `visual-hybrid-frame-outcome`
- `visual-diagnostics-export`
- existing placement / load-failed events

Allowed fields: feature-005 allowlist plus component type, scene key, operation id, frame write version, scene write version, matte acceptance flags, generation record id, and app git commit when available.

## Non-goals in this contract

- Batch generate-all-frames
- Background approval gate
- Multi-scene manager
- Automatic full-panel fallback
- Cancellation of in-flight operations
- Interpret/Stage/source/dialogue/structural-edit contract changes
- Timer-simulated progress phases
