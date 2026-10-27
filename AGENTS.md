# Comics Generator — implementation entry

Current production is `storyboard-web`: `app/storyboard-web`, PostgreSQL, the browser UI, text and image providers, and Video Spec rendering. Continue in [README.md](README.md). Open [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layer map.

`master` shows five stages, in order: Story, Storyboard, Characters, Visual, Video (`app/storyboard-web/public/workspace-stages.mjs`). `DEC-081` accepts a pending four-stage direction: Story, Characters, Storyboard, Video, with Visual approval inside Storyboard and a hard render gate. Feature 022 remains in `master`; its product UX is owner-rejected (`DEC-080`). Read the code and `DEC-081` as separate facts.

`node app/storyboard-web/server.mjs` is the repository start path. `GET /api/visual` can persist repair rows through `loadVisual` in `app/storyboard-web/visual-store.mjs`.

## Where to look

1. Web server, HTTP, and orchestration — `app/storyboard-web/server.mjs`, `app/storyboard-web/config.mjs`, `app/storyboard-web/interpret.mjs`, `app/storyboard-web/stage.mjs`, `app/storyboard-web/storyboard-edit.mjs`, `app/storyboard-web/source-edit.mjs`, `app/storyboard-web/assembly.mjs`, `app/storyboard-web/dialogue-mode.mjs`
2. Browser UI — `app/storyboard-web/public/`; frames are drawn by `prototypes/storyboard-viewer/frame-renderer.mjs`
3. Persistence and migrations — `app/storyboard-web/db/`, `app/storyboard-web/project-store.mjs`, `app/storyboard-web/visual-store.mjs`, `app/storyboard-web/research-store.mjs`
4. Providers, prompt compilation, and the generation trace — `app/storyboard-web/provider.mjs`, `app/storyboard-web/image-provider.mjs`, `app/storyboard-web/image-reference-strategy.mjs`, `app/storyboard-web/visual-model.mjs`, `app/storyboard-web/panel-revision.mjs`, `app/storyboard-web/prompts/`, `app/storyboard-web/image-generation-trace.mjs`
5. Rendering and Video Spec — `app/storyboard-web/video-spec.mjs`, `app/storyboard-web/render-service.mjs`, `app/storyboard-web/panel-background.mjs`, `prototypes/remotion-rough/`; `renderer-remotion/` is the historical JSON renderer
6. Tests — `app/storyboard-web/test/`
7. Specs — `specs/`, on demand, as contracts and history
8. Historical, experimental, or specialized unless this task asks for them — `evals/`, `golden/`, top-level `prompts/`, top-level `tools/`, `spikes/`, and `prototypes/` other than the two trees named above. This is a routing rule, not a deletion list.

## Safe commands

From the repository root:

- Complete offline lane: `npm run test:storyboard`
- Isolated PostgreSQL lane: `npm run test:storyboard:postgres`
- Focused files: `npm run test:storyboard:focus -- app/storyboard-web/test/schema.test.mjs`

`test:storyboard` runs `app/storyboard-web/test/*.test.mjs`, including the offline PostgreSQL-verifier guards in `app/storyboard-web/test/postgres-verify.test.mjs`. It needs no database and no provider credential. `test:storyboard:postgres` runs `app/storyboard-web/test/postgres/verify.mjs`. Set `STORYBOARD_TEST_DATABASE_URL` to an isolated disposable database named `comics_test`. Keep the owner and production database out of test commands. The verifier reads that variable only, and it exits successfully only when tests are nonzero and skips are zero.

`test:storyboard:focus` accepts one or more explicit `app/storyboard-web/test/**/*.test.mjs` paths after `--`. It refuses an empty list, a path outside that tree, and a file whose name does not end in `.test.mjs`. Leave a glob unquoted so the shell expands it before `npm` runs. A quoted glob is a single literal path and is refused.

`npm run golden` and `npm run check` both invoke `tools/build-golden.mjs` and can rewrite golden artifacts. Run them only when the task explicitly authorizes golden regeneration.

## On demand

- [README.md](README.md) — runtime, environment, and the same test lanes
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current code map
- [docs/CONTEXT_COST_BASELINE.md](docs/CONTEXT_COST_BASELINE.md) — measurement protocol for the next five tasks
- `specs/019-workspace-shell/spec.md`, `specs/020-transparent-foreground/spec.md`, `specs/021-durable-generation-trace/spec.md`
- `specs/022-panel-revision/spec.md` records the retained, owner-rejected panel-revision work
