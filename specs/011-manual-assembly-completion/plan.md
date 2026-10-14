# Implementation plan: Manual assembly and completion

## Approach

Keep the storyboard JSON as the structure document and `panel_visual_state` as rendition state. Stop using panel index as the only identity.

- Give every panel a stable `id` in the frames JSON. Backfill missing ids on load and persist them on the current version.
- Add `panel_id`, `assigned_asset_id`, and `assignment_origin` to `panel_visual_state`. Copy rendition rows by `panel_id` when a structure edit creates the next storyboard version. Write the new display frame id and panel index on the copy.
- Manual edits call `applyProductOperation`. Structure changes that move rows create one new version inside a locked transaction. Duration, text-card text, and the optional owner note update the current version in place because they do not change identity or index. Upload and assignment update `assigned_asset_id` only.
- The current image is the assigned asset when present, otherwise the existing ready generation. Assignment does not insert `panel_generation`.
- `compileVideoSpec` reads the loaded visual state. The existing `prototypes/remotion-rough` composition renders that spec. The server keeps one in-memory render and one output file.
- The build marker is `GET /api/build`: git SHA when `.git` is available, otherwise `build-info.json` written during the image build, otherwise `dev`.

## Data model

- **Panel id**: string on each panel object, unique within the storyboard. New panels get a new id. Reorder keeps the id.
- **Frame id**: existing structure id. Insert allocates a new id. Display ids such as `frame#2` stay derived.
- **Segment address**: operations that edit panels, duration, or text take `structureFrameId` plus `structureSegmentIndex`. A directing beat without a segment index is rejected so a display card cannot edit the wrong node. Frame insert, delete, and reorder use the structure frame id. Insert after a segment places the new frame after that whole structure frame.
- **Assigned asset**: `assigned_asset_id` points at an existing `visual_asset`. `assignment_origin` is `upload` or `reuse`. New uploads use kind `uploaded-image`. The same sha256 among `uploaded-image` and `panel-image` reuses the row.
- **Owner note**: optional `ownerDescription` on the panel object. It is not `description` and is not copied by reuse.
- **Frame kind**: absent means dialogue when `dialogue` has text, otherwise image. `frameKind: "image"` and `frameKind: "text"` are explicit. Text cards store `textCard` and have no panels and no source item.
- **Duration**: optional positive integer `durationFrames` on the structure frame or segment. Absent dialogue frames compile as 12 + ceil(graphemes / 12 × 30) + 36. Absent frames without typed dialogue compile as 36. The reveal minimum is the smallest duration at which the last Remotion frame shows every character.

## API

- `POST /api/visual/operations` with one operation or `{ op: "batch", operations: [...] }`.
- `GET /api/visual` includes panel ids, effective duration, text cards, assignment, and reusable assets for this storyboard result.
- `POST /api/visual/render`, `GET /api/visual/render`, `GET /api/visual/render/result`.
- `GET /api/build`.

## Renderer

Adapt `prototypes/remotion-rough/src/Video.jsx` and add a `CurrentStoryboard` composition whose duration comes from the compiled spec. Remove the 2 px dialogue border. Pass mirror as `scaleX(-1)` with the existing zoom and object position. Keep `panelGutterPx` at 48.

## Docker

Install Remotion and its browser in the existing app image. Write `build-info.json` from a hash of the copied sources plus the build time, because `.git` is not in the build context.

## Tests

Pure tests cover identity, rejection, duration, the video spec, render-state rules, and the build marker. PostgreSQL covers assignment, dedup, and copy-forward by panel id. One short Remotion render checks that the composition writes a playable file.

## Correction 3

- Undo: `POST /api/visual/storyboard/undo` with `content-type: application/json` and `{}`. Return `undoneLabel` and `undoneTarget` from the version being left. Remove `#undo-structure`.
- No-op: compare canonical frame JSON and panel visual fields before `forkVisibleState`. Return `changed: false` and record research outcome `no-change`.
- Performance reference: store `performance_intent` (`keep`, `set`, `clear`) on the pending generation. Apply `performance_asset_id` only in the successful generation fork.
- Provenance: nullable `visual_asset.provenance` jsonb, backfilled from ready `panel_generation` rows only. Assignment carry is decided in `metadataCarryDecision`.
- Picker: `placeAssetPicker` anchors a 600px popover, flips, clamps, and closes with the anchor. Upload is sticky; assets are a three-column grid.
- Status: `#action-status` is fixed, with polite and assertive `aria-live`.
- Operations: extend the research semantic-action check with the assembly and render actions, and store `panelId`, `transitionMode`, and `transitionOverlapFrames` in context. Labels include `кадр N, панель M`.
- Render evidence: the server writes one start when a render is accepted and one terminal when `createRenderController` finishes. The browser poll does not append a terminal.
- Export: `CROSS_DISSOLVE_OVERLAP_FRAMES` is 6. `compileVideoSpec` takes `transition`. Hard cut keeps the current start and total. Cross dissolve overlaps only when both frames are non-text and at least six frames. The choice is request state, not a storyboard version.
- Subjects: `setManualSubject` rejects a name that is not an exact `canonical_character.name` before any fork.
