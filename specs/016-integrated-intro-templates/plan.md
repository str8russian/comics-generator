# Feature 016 plan

## Path

`current project + current assets + render options → Video Spec with an optional intro segment → existing Remotion composition → one MP4`

No intro-only composition, no FFmpeg concat, no Swift runtime, no migration.

## Modules

- `app/storyboard-web/intro-templates.mjs` — versioned catalog, selection check, availability, and deterministic slot resolver. `story-shards-v1` is the only entry.
- `app/storyboard-web/video-spec.mjs` — accepts an already resolved intro or none. With an intro, adds 201 frames and offsets body `startFrame` values. Without one, omits the intro segment.
- `app/storyboard-web/server.mjs` — `GET /api/visual/intro-templates` and optional `introTemplateId` on the existing render request. Resolves slots on the server. Rejects unknown, wrong-version, and unavailable choices before `controller.start`.
- `app/storyboard-web/public/index.html`, `app.js`, `app.css` — labeled native selector. Options and duration come from the catalog response. **Без интро** stays the local empty choice.
- `prototypes/remotion-rough/src/Video.jsx` and `StoryShardsIntro.jsx` — map `story-shards-v1` version 1 inside `TelegramUnblockVideo`. `tools/render-spec.mjs` still performs one `selectComposition` / `renderMedia` for `CurrentStoryboard`.

Research context gains `introTemplateId` and `introTemplateVersion` on the existing jsonb context. That is application validation, not a schema migration.

## Resolver

Participating names are exact included canonical characters in first panel-subject order. Two names get three slots each; three get two. Slot images are the approved anchor, then distinct owned panel assets, then the anchor again if a slot is still empty. Title comes from `loadProject().title`. Asset ids are accepted only when `readAsset` returns them for the active project.

## Checkpoint

Do not render from this implementation pass. The owner runs the server, chooses the intro, and inspects `.render-output/<project id>/current.mp4`.
