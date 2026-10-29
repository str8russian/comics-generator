# Storyboard Web architecture

This map describes the implementation tree after the bounded Stage 2B research-route extraction from base `2cdb4eb3fefc9b113bffda612aa1eb76ca529af0`. It is a navigation aid. It does not authorize a split of `server.mjs` or the pending stage change in `DEC-081`.

## Composition root and startup

[`app/storyboard-web/server.mjs`](../app/storyboard-web/server.mjs) is the HTTP composition root. Executing that file calls `startServer`, which listens on `STORYBOARD_PORT` (default `4173`) and `STORYBOARD_HOST` (default `127.0.0.1`). [`Dockerfile`](../Dockerfile) uses the same command. There is no npm start script.

`createServer` builds one HTTP server and, on the first `listen`, runs migrations and then attaches stores:

- configuration for text calls is [`loadConfig`](../app/storyboard-web/config.mjs) at request time, from `BASE_URL`, `CONTEST_API_TOKEN`, and the interpret/stage model settings;
- [`createPool`](../app/storyboard-web/db/pool.mjs) uses `DATABASE_URL`;
- [`migrate`](../app/storyboard-web/db/migrate.mjs) applies `app/storyboard-web/db/migrations/*.sql` under an advisory lock and records `schema_migration`;
- missing stores become [`createProjectStore`](../app/storyboard-web/project-store.mjs), [`createVisualStore`](../app/storyboard-web/visual-store.mjs), and [`createResearchStore`](../app/storyboard-web/research-store.mjs);
- [`createImageGenerationTraceRecorder`](../app/storyboard-web/image-generation-trace.mjs) shares that pool;
- the render controller is created on first render use through [`createRenderController`](../app/storyboard-web/render-service.mjs).

`migrate: false` or a supplied `migrate` function skips or replaces that startup migration. The same file still owns static-file serving, API dispatch, request bodies, and most product handlers. `server.mjs` is 2,988 lines. Research notes, events, and trace HTTP is [`research-routes.mjs`](../app/storyboard-web/research-routes.mjs) (235 lines), delegated once from `routeProduct`. These route groups remain in `server.mjs`: legacy storyboard, project/material/source, visual operations and storyboard editing, anchors and characters, panel generation and revision, render/video/intro, and static files plus project collection, open, rename, and duplicate. Useful seams for navigation are the static `routes` table, `routeProduct`, and the `createServer` dependency block. Those are facts about where to read, not an approved extraction plan.

## Browser UI

[`public/index.html`](../app/storyboard-web/public/index.html) is the project workspace (`Раскадровка`). [`public/projects.html`](../app/storyboard-web/public/projects.html) is the project list. Styles are [`public/app.css`](../app/storyboard-web/public/app.css) (2,047 lines) plus the served viewer stylesheet.

[`public/app.js`](../app/storyboard-web/public/app.js) is the composition root (3,378 lines). It passes page, API, research, and renderer dependencies into extracted client modules and calls `projectApi` from [`public/project-api.mjs`](../app/storyboard-web/public/project-api.mjs), which prefixes `/api/projects/:id`. Extracted modules include:

- [`workspace-stages.mjs`](../app/storyboard-web/public/workspace-stages.mjs) — stage list, hash navigation, and derived stage status;
- [`frame-inspector.mjs`](../app/storyboard-web/public/frame-inspector.mjs) (1,152 lines) — the overview inspector renderer plus the Frame Editor controller for current-frame lifecycle, tabs, dialogue drafts and leave confirmation, duration/frame controls, editor Undo placement, and panel placement interaction wiring;
- [`panel-basis.mjs`](../app/storyboard-web/public/panel-basis.mjs), [`panel-revision-view.mjs`](../app/storyboard-web/public/panel-revision-view.mjs);
- [`anchor-session.mjs`](../app/storyboard-web/public/anchor-session.mjs) and [`anchor-session-ui.mjs`](../app/storyboard-web/public/anchor-session-ui.mjs);
- [`research-dock.mjs`](../app/storyboard-web/public/research-dock.mjs), [`asset-picker.mjs`](../app/storyboard-web/public/asset-picker.mjs), [`export-timing.mjs`](../app/storyboard-web/public/export-timing.mjs), [`duplicate-project.mjs`](../app/storyboard-web/public/duplicate-project.mjs), [`draft-autosave.mjs`](../app/storyboard-web/public/draft-autosave.mjs).

Shared frame geometry and dialogue-region drawing live in [`prototypes/storyboard-viewer/frame-renderer.mjs`](../prototypes/storyboard-viewer/frame-renderer.mjs), served as `/frame-renderer.mjs`. [`public/visual-anchors.mjs`](../app/storyboard-web/public/visual-anchors.mjs) prepares the frame payload that renderer mounts. Foreground chips are client presentation in `panel-basis.mjs`; the system slate is [`SYSTEM_PANEL_BACKGROUND`](../app/storyboard-web/panel-background.mjs) (`#5d6e86`).

`STAGES` is Story (`story` / История), Storyboard (`storyboard` / Раскадровка), Characters (`characters` / Персонажи), Visual (`visual` / Визуал), Video (`video` / Видео). Storyboard and Visual are the frame stages. The Visual stage model locks image work while required anchors are missing. The Video stage model keeps `locked: false` when Visual is unapproved and still exposes `Собрать видео`, with an advisory note. `POST /api/visual/render` compiles a Video Spec when `load()` returns `status: "ready"`; the handler does not consult `readyForVideo`.

## HTTP and API

Static GET paths are the `routes` array in `server.mjs` (HTML, client modules, viewer assets, and the three files under `app/storyboard-web/public/character-anchors/`). Dynamic handling is `routeProduct` in the same file. Its first branch delegates `/api/research/notes`, `/api/research/events`, and `/api/research/trace` to [`research-routes.mjs`](../app/storyboard-web/research-routes.mjs); the other branches stay in `routeProduct`. Project pages are `/projects/:id`. APIs under `/api/projects/:id/...` are rewritten onto the same handlers inside `withProject`.

Handlers then call stores, [`interpretDraft`](../app/storyboard-web/interpret.mjs), [`stageStoryboard`](../app/storyboard-web/stage.mjs), [`editStoryboard`](../app/storyboard-web/storyboard-edit.mjs), image generation, or the render controller. Grouped surfaces:

- source and storyboard: `/api/draft`, `/api/readings`, `/api/confirmations`, `/api/material-states`, `/api/source-utterances`, `/api/storyboard-results`, `/api/visual/storyboard/edit`, `/api/visual/storyboard/undo`;
- characters and anchors: identity, anchor, anchor-session, accept, retire, restore, approve;
- frames and panels: generate, placement, and the `revision`, `revision-preview`, `revision-candidate`, `revision-navigate`, `revision-accept`, and `revision-cancel` panel paths;
- research: `/api/research/notes`, `/api/research/events`, `/api/research/trace` in `research-routes.mjs`;
- video: `/api/visual/intro-templates`, `/api/visual/render`, `/api/visual/render/result`, `/api/visual/approve`;
- product operations batch: `/api/visual/operations`.

[`app/storyboard-web/revision-route.mjs`](../app/storyboard-web/revision-route.mjs) re-exports deterministic revision copy from `app/storyboard-web/public/panel-revision-view.mjs`. It is not where HTTP revision routes are registered.

## Application and orchestration

Related modules, not a function list:

- source to structure: `interpret.mjs` and `stage.mjs` read [`prompts/interpret.md`](../app/storyboard-web/prompts/interpret.md) and [`prompts/stage.md`](../app/storyboard-web/prompts/stage.md), call the text provider, and validate against SpecKit schemas under `specs/`;
- source edits and cast inclusion: [`source-edit.mjs`](../app/storyboard-web/source-edit.mjs) with `project-store.mjs` (`reviseSourceUtterance`, `replacePendingCast`, `confirmReading`);
- structural edits: `storyboard-edit.mjs` uses [`prompts/edit-storyboard.md`](../app/storyboard-web/prompts/edit-storyboard.md);
- dialogue modes: [`dialogue-mode.mjs`](../app/storyboard-web/dialogue-mode.mjs) (`spoken`, `silent`, `hidden`) and [`timing.mjs`](../app/storyboard-web/timing.mjs);
- assembly: [`assembly.mjs`](../app/storyboard-web/assembly.mjs) `applyOperation` is the structural mutation set. [`applyProductOperation`](../app/storyboard-web/visual-store.mjs) is the persisted product-operation entry, including one `duplicateFrame` and the batch rejection of `duplicateFrame`;
- anchors: [`anchor-session-request.mjs`](../app/storyboard-web/anchor-session-request.mjs) and the anchor methods on `visual-store.mjs`;
- panel revision: [`panel-revision.mjs`](../app/storyboard-web/panel-revision.mjs) compiles effective revision state. The focused Panel Editor, Refine / New variation copy, and candidate draft flow are the retained Feature 022 UI;
- research capture: the dock and `public/app.js` emit events; [`research-routes.mjs`](../app/storyboard-web/research-routes.mjs) accepts the three research HTTP routes; `research-store.mjs` and [`research-text-policy.mjs`](../app/storyboard-web/research-text-policy.mjs) persist them;
- project duplication: [`project-duplicate.mjs`](../app/storyboard-web/project-duplicate.mjs);
- intro slots: [`intro-templates.mjs`](../app/storyboard-web/intro-templates.mjs).

## Persistence

[`db/pool.mjs`](../app/storyboard-web/db/pool.mjs) is the only pool constructor and it defaults to `DATABASE_URL`. [`db/migrate.mjs`](../app/storyboard-web/db/migrate.mjs) is the migration entry. SQL lives in [`db/migrations/`](../app/storyboard-web/db/migrations/) from `001_init.sql` through `021_panel_revision_session.sql`.

`project-store.mjs` holds drafts, readings, material states, and source utterances. `visual-store.mjs` holds storyboard versions, anchors, panel rows, placements, assets, and revision sessions. `research-store.mjs` holds the owner-research trace. Image bytes and derived foregrounds are stored asset rows; foreground extraction is [`app/storyboard-web/foreground/`](../app/storyboard-web/foreground/). The Video Spec and the gitignored render-output files are derived from stored state.

`GET /api/visual` is not a read-only route. `sendVisualState` calls `visualStore.load()`, and `loadVisual` calls `loadVisualWithClient`, which commits work from `ensureVersion`, `persistPanelIds`, `backfillPanelIds`, `backfillCurrentAssets`, and `ensurePanelRows`. Diagnostics that need a stable snapshot should use a read-only database transaction rather than that route.

## Providers and prompt compilation

Text completions go through [`provider.mjs`](../app/storyboard-web/provider.mjs) using `loadConfig`: `BASE_URL`, `CONTEST_API_TOKEN`, `CONTEST_TIMEOUT_MS` (default 120000), `INTERPRET_MODEL` / `STAGE_MODEL` (fallback `CONTEST_MODEL`), reasoning efforts, and optional token limits. Image calls go through [`image-provider.mjs`](../app/storyboard-web/image-provider.mjs): `IMAGE_MODEL` defaults to `gemini-3-pro-image-preview`, and `IMAGE_TIMEOUT_MS` falls back to `CONTEST_TIMEOUT_MS` or 180000. Anchor sessions use `anchorSessionProviderTimeoutMs`.

Server-owned prompts and effective state are compiled in `visual-model.mjs` (`compilePanelReadyPrompt`, `anchorPrompt`, `panelPrompt`, reference assembly) and `panel-revision.mjs`. Reference bytes are ordered and possibly resized by [`image-reference-strategy.mjs`](../app/storyboard-web/image-reference-strategy.mjs) (`budgeted` by default, or `passthrough`; `IMAGE_REQUEST_BUDGET_BYTES` defaults to 850000). The durable trace is `image-generation-trace.mjs`, written by the single image-request sink. Do not copy prompt text or credentials into task notes.

## Rendering

The browser draws a frame with `frame-renderer.mjs` and places a foreground, when one exists, over the system slate from `panel-background.mjs`. [`compileVideoSpec`](../app/storyboard-web/video-spec.mjs) turns the loaded visual state into schema `storyboard-video-spec-1`, including dialogue mode, timing, intro, and `backgroundColor`. [`render-service.mjs`](../app/storyboard-web/render-service.mjs) writes that spec and spawns [`prototypes/remotion-rough/tools/render-spec.mjs`](../prototypes/remotion-rough/tools/render-spec.mjs), which bundles `prototypes/remotion-rough/src`. Output defaults to `.render-output/<projectId>/current.mp4`, which is gitignored.

[`renderer-remotion/Storyboard.tsx`](../renderer-remotion/Storyboard.tsx) and [`templates.tsx`](../renderer-remotion/templates.tsx) are the historical data-driven renderer for the multi-role JSON storyboard. The production video path does not import them. `prototypes/remotion-rough/src/Video.jsx` does import `SYSTEM_PANEL_BACKGROUND` from the production module.

## Tests

Root scripts:

- `npm run test:storyboard` — `node --test app/storyboard-web/test/*.test.mjs`. This is the complete offline lane: the `*.test.mjs` files directly in `app/storyboard-web/test/`, no database, no provider credential, and no golden rebuild. It includes [`app/storyboard-web/test/postgres-verify.test.mjs`](../app/storyboard-web/test/postgres-verify.test.mjs), which exercises the verifier's refusal and skip guards in a subprocess.
- `npm run test:storyboard:postgres` — [`app/storyboard-web/test/postgres/verify.mjs`](../app/storyboard-web/test/postgres/verify.mjs). Requires `STORYBOARD_TEST_DATABASE_URL` whose database name is `comics_test`. It does not fall back to `DATABASE_URL`. It requires a nonzero test count and zero skips.
- `npm run test:storyboard:focus -- <paths>` — [`app/storyboard-web/test/focus-runner.mjs`](../app/storyboard-web/test/focus-runner.mjs). Explicit `app/storyboard-web/test/**/*.test.mjs` paths only.

Helpers and harnesses in `app/storyboard-web/test/` include `app/storyboard-web/test/workspace-harness.mjs`, `app/storyboard-web/test/offline-provider.mjs`, `app/storyboard-web/test/persistent-fake-provider.mjs`, and `app/storyboard-web/test/draft-page-loader.mjs`. Files in `app/storyboard-web/test/postgres/` talk to the disposable test database when the URL is set. `npm run golden` and `npm run check` run [`tools/build-golden.mjs`](../tools/build-golden.mjs) and can rewrite `golden/`.

## Historical and inactive areas

`schema/`, `catalog/`, top-level `prompts/`, `tools/`, `golden/`, `evals/`, and `renderer-remotion/` are the earlier multi-role pipeline and its eval harness. `spikes/` holds isolated experiments. `prototypes/storyboard-viewer/` and `prototypes/remotion-rough/` are still on the production frame and video path; other prototype material is not. `specs/` remains the feature-contract history, including older features and the retained Feature 022 spec. Open a spec when the task needs that contract. Open `evals/`, `golden/`, top-level `prompts/`, `tools/`, or `spikes/` when the task is about that experiment. None of these trees is a deletion list.

Older narrative docs under `docs/` belong to that history: `docs/CORRECTION_PROCESS.md`, `docs/HANDOFF.md`, `docs/PRODUCT_CONTEXT.md`, and the writer/Telegram plans. This file and `docs/CONTEXT_COST_BASELINE.md` describe the current production tree.

## Dependency flow

```text
browser
  public/index.html + public/app.js + workspace-stages
  frame-renderer.mjs + panel-background slate
    -> HTTP composition root (server.mjs routes and routeProduct; research-routes.mjs for the three research routes)
      -> interpret / stage / source-edit / storyboard-edit
         dialogue-mode / assembly / panel-revision / research capture
        -> project-store, visual-store, research-store
           provider.mjs, image-provider.mjs, image-reference-strategy
           image-generation-trace
          -> PostgreSQL (DATABASE_URL) and stored image assets
            -> compileVideoSpec
              -> render-service
                -> prototypes/remotion-rough
```

## Current implementation and pending product structure

The code in `workspace-stages.mjs` implements five visible stages in the order Story → Storyboard → Characters → Visual → Video. Feature 022's panel-revision behavior is part of this tree: effective-state compilation, Refine / New variation, draft candidates, and the focused Panel Editor. `DEC-080` keeps that code and rejects that product approach. It is not an accepted UX baseline.

`DEC-081` accepts a different information architecture: Story → Characters → Storyboard → Video, with character anchors blocking entry to Storyboard, Visual approval as a versioned gate inside Storyboard, and video assembly blocked until that approval is current. The Video stage and render handler described above still allow assembly without that gate. `DEC-081` is accepted direction and is not implemented at this commit. Documentation of the five-stage shell is evidence of the code, not a statement that the four-stage direction already exists.
