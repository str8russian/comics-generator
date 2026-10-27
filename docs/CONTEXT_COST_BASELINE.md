# Context-cost baseline

Stage 1 records a fixed repository baseline and a protocol for the next five comparable implementation tasks. It does not estimate a savings percentage. Input-token totals for this pass are `unavailable`.

## Fixed baseline

| Fact | Value |
|---|---|
| Base commit | `794cfb32e9232e01112a17a7c2ce9001206921b9` |
| Commit time | 2026-10-25 14:48:05 +0300 |
| Baseline recorded | 2026-10-27 |
| Production contour | `app/storyboard-web`, PostgreSQL, browser UI, providers, Video Spec / `prototypes/remotion-rough` |

Before this pass the root had no `AGENTS.md` and no `docs/ARCHITECTURE.md`. `README.md` opened as the historical server-side pipeline and described `storyboard-web` as a product spike. `package.json` had pipeline and spike scripts only. It had no Storyboard Web offline, PostgreSQL, or focused test script.

### Zones and automatic context noise

Sizes are tracked-tree disk use at the base commit, measured on 2026-10-27. They are volume clues, not token counts.

| Zone | Role at this commit | Approx. size |
|---|---|---|
| `app/storyboard-web` | Current production application | 5.9M |
| `specs/` | Feature contracts and history; keep deliberately available | 16M |
| `prototypes/` | Production frame renderer and Remotion project, plus any inactive prototype material in that tree | 29M |
| `evals/` | Historical pipeline cases; `evals/runs/` is 2.0M of this | 2.1M |
| `spikes/` | Isolated experiments | 464K |
| `golden/` | Historical golden storyboard | 76K |
| top-level `prompts/` | Historical role prompts | 56K |

`server.mjs` is 3,148 lines and `public/app.js` is 3,913 lines. Opening either file is a large read even when the task needs only one handler.

The main automatic-noise sources observed from the root are: the README leading into `tools/`, `prompts/`, `golden/`, and `evals/`; `package.json` advertising spike scripts and `npm run check` before any production test lane; `evals/runs/` payloads (kept on purpose; `.gitignore` says nothing under `evals/runs/` is ignored); and the large `specs/` and `prototypes/` trees when a search is unscoped. `.gitignore` already excludes `.render-output/`, `node_modules/`, spike result directories, and `app/storyboard-web/eval/stage-artistic/results/`.

### Pre-change navigation audit

Hop counts are `unavailable`. This pass was told which files to inspect, so the column records the root files that did not answer and the code files that did. It is not an unguided-agent measurement.

| Question | Observed path before this pass |
|---|---|
| Production entrypoint | `README.md` names `storyboard-web` as a spike and gives no start command. `package.json` has no start script. `docker-compose.yml` has an `app` service and no command. The command is `Dockerfile` `CMD` and the direct-execution block at the end of `server.mjs`: `node app/storyboard-web/server.mjs`. |
| Browser UI | The README layout omits `public/`. The UI is `app/storyboard-web/public/index.html`, `public/app.js`, and `STAGES` in `public/workspace-stages.mjs`. Static serving is the `routes` array in `server.mjs`. |
| HTTP routes | No root index. Static paths are `routes` in `server.mjs`. Dynamic paths are `routeProduct` in the same file. |
| Orchestration | No root index. `server.mjs` imports `interpret.mjs`, `stage.mjs`, and `storyboard-edit.mjs`. Dialogue modes are `dialogue-mode.mjs`. Structural edits are `assembly.mjs` `applyOperation`. Persisted product operations are `visual-store.mjs` `applyProductOperation`. |
| Persistence and migrations | `docker-compose.yml` `db` service, then `db/pool.mjs` and `db/migrate.mjs` via `server.mjs`, then `db/migrations/` (`001` through `021`). `GET /api/visual` reaches `loadVisual` → `loadVisualWithClient`, which can commit backfills. |
| Providers and prompts | README env names, then `config.mjs` `loadConfig`, `provider.mjs`, `image-provider.mjs`, and `image-reference-strategy.mjs` `loadImageReferenceConfig`. Production prompt files are `app/storyboard-web/prompts/`. Panel and anchor compilation is `visual-model.mjs`. Revision compilation is `panel-revision.mjs`. Top-level `prompts/` is the historical role set. The trace module is `image-generation-trace.mjs`. |
| Rendering and Video Spec | README "Rendering" points at `renderer-remotion/` and `tools/parity.sh`. Production compilation is `video-spec.mjs` `compileVideoSpec`. Production render is `render-service.mjs` spawning `prototypes/remotion-rough/tools/render-spec.mjs`. Browser frames are `prototypes/storyboard-viewer/frame-renderer.mjs`. The slate is `panel-background.mjs`. |
| Complete offline tests | `package.json` has no Storyboard Web test script. Specs such as `specs/010-visual-placement-controls/quickstart.md` show `node --test test/**/*.test.mjs` from `app/storyboard-web`, which includes `test/postgres/`. A root command for only `test/*.test.mjs` was absent. |
| Focused tests | No root command and no empty-list refusal. Specs show ad hoc `node --test test/<file>.test.mjs`. |
| PostgreSQL tests | Absent from README and `package.json`. `STORYBOARD_TEST_DATABASE_URL` appears in specs and in `app/storyboard-web/test/postgres/verify.mjs`. The verifier accepts only the database name `comics_test`, ignores `DATABASE_URL`, and requires nonzero tests and zero skips. `docker/postgres/init-test-db.sql` creates `comics_test`. |

## After-change discoverability

Same questions, answered from the documents and scripts added in this pass. This is a structural comparison. It is not evidence of token savings.

| Question | Documented route |
|---|---|
| Production entrypoint | `AGENTS.md` names `node app/storyboard-web/server.mjs`. README "Start" and Architecture "Composition root and startup" name the same command, port, host, and Docker `CMD`. |
| Browser UI | `AGENTS.md` zone 2. Architecture "Browser UI" names `public/index.html`, `public/app.js`, `workspace-stages.mjs`, and `frame-renderer.mjs`. |
| HTTP routes | Architecture "HTTP and API" names the `routes` array, `routeProduct`, and the grouped surfaces. `revision-route.mjs` is identified as a re-export. |
| Orchestration | `AGENTS.md` zone 1 names the orchestration modules. Architecture "Application and orchestration" groups them. |
| Persistence and migrations | `AGENTS.md` zone 3 and the `GET /api/visual` warning. Architecture "Persistence" names the pool, migrator, migration directory, stores, and the `loadVisual` write. |
| Providers and prompts | `AGENTS.md` zone 4. Architecture "Providers and prompt compilation" names config, both providers, reference strategy, compilers, and the trace. |
| Rendering and Video Spec | `AGENTS.md` zone 5 separates `prototypes/remotion-rough` from historical `renderer-remotion/`. Architecture "Rendering" gives the compile and spawn path. |
| Complete offline tests | Explicit command `npm run test:storyboard` in `AGENTS.md`, README, and `package.json`. |
| Focused tests | Explicit command `npm run test:storyboard:focus -- <paths>`, with empty-list and path refusal documented. |
| PostgreSQL tests | Explicit command `npm run test:storyboard:postgres`, including the `comics_test` / `STORYBOARD_TEST_DATABASE_URL` rule and the owner-database warning. |

Concrete differences: each of the three test questions now has one root command; the entrypoint, five-stage shell, and pending `DEC-081` direction are on the first screen of `AGENTS.md`; historical pipeline instructions are under a labelled README section. Searches into `specs/` or `server.mjs` are still required for a contract detail or a handler body. The pre-change hop count that would make "fewer hops" a number is `unavailable`.

## Cursor indexing

No repository ignore file was added.

| Evidence | What was checked |
|---|---|
| Installed app | Cursor `3.27.14` (`CFBundleShortVersionString` and `CFBundleVersion`), bundle `com.todesktop.230313mzl4w4u92`, `Info.plist` dated 2026-10-23. User `settings.json` has no ignore list. |
| Official docs, fetched 2026-10-27 | [Ignore file](https://cursor.com/docs/reference/ignore-file) and [cursor.com/docs/context/ignore-files](https://cursor.com/docs/context/ignore-files) document `.cursorignore` only. |
| Semantics of `.cursorignore` | Gitignore patterns. Blocks Agent, Tab, and `@` mention access. Terminal and MCP tools are not blocked. `.gitignore` is also respected. The published default list includes common binaries and `node_modules/`. |
| `.cursorindexingignore` in this install | The app recognizes the filename for icons and as an `ignore` language in `cursor-retrieval`. `extensions/cursor-retrieval/dist/main.js` contains `.cursorignore` once and contains no `indexingignore` string. The current docs pages above do not define an index-only mode. |
| Staff note | A Cursor staff reply on 2026-09-07 in [How to reindexing my codebase](https://forum.cursor.com/t/how-to-reindexing-my-codebase/170407) says the old index-only behavior of `.cursorindexingignore` should not be expected for Instant Grep, and that `.cursorignore` is a hard exclude. |

The desired behavior was automatic-index noise reduction with deliberate reads and mentions kept. The only mechanism the current docs verify, `.cursorignore`, also blocks deliberate Agent and `@` access. The index-only filename is not verified for 3.27.14. A user-global ignore list would be out of scope. No pattern was added.

Manual action until a verified index-only control exists: open `evals/runs/`, `spikes/`, `golden/`, and historical `prompts/` by explicit path when a task needs them. Do not add a broad `prototypes/` pattern. `prototypes/remotion-rough` and `prototypes/storyboard-viewer` are on the production path. Do not add a broad binary pattern. Production anchors live at `app/storyboard-web/public/character-anchors/`. `.gitignore` remains the existing exclusion for `.render-output/` and generated spike results.

## Five comparable tasks

A comparable task is a bounded implementation or behavior-preserving refactor in the current `storyboard-web` production contour, started from an explicit base, using normal repository tools. Exclude pure product research, provider experiments, large data migrations or backfills, emergency incident response, and historical-pipeline-only work unless the ledger says why that task is still comparable.

Collection boundary: start at the first repository inspection for the task and end at the implementation report or clean commit. Later owner validation and corrective handoffs are appended to the same row. They are not a new comparable task.

For each task record:

- task identifier, category, base, head, agent/model/environment when the environment exposes them, and scope size;
- unique files opened or read before the first edit, grouped by module or zone;
- total unique files and modules read for the task;
- input tokens if exposed, otherwise `unavailable` (never estimate);
- total tool calls and navigation tool calls (list, search, and read operations before or during implementation);
- navigation share = navigation tool calls / total tool calls, only when both counts are observed;
- validation effort: commands, test counts, wall time when exposed, and reruns;
- regressions and rework: failed checks caused by the patch, corrective iterations, follow-up commits, and owner-returned defects;
- unexpected historical or noise files consulted, and why;
- outcome and residual uncertainty.

### Ledger

Values stay `pending` until that task is collected. Do not backfill estimates.

| Field | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|
| Category | pending | pending | pending | pending | pending |
| Base | pending | pending | pending | pending | pending |
| Head | pending | pending | pending | pending | pending |
| Agent / model / environment | pending | pending | pending | pending | pending |
| Scope size | pending | pending | pending | pending | pending |
| Files read before first edit | pending | pending | pending | pending | pending |
| Unique files / modules read | pending | pending | pending | pending | pending |
| Input tokens | pending | pending | pending | pending | pending |
| Total tool calls | pending | pending | pending | pending | pending |
| Navigation tool calls | pending | pending | pending | pending | pending |
| Navigation share | pending | pending | pending | pending | pending |
| Validation effort | pending | pending | pending | pending | pending |
| Regressions / rework | pending | pending | pending | pending | pending |
| Unexpected historical files | pending | pending | pending | pending | pending |
| Outcome and residual uncertainty | pending | pending | pending | pending | pending |

### After T5

Compare medians and ranges of the observed numeric fields. Report how many cells were `unavailable`. Name confounders before any comparison: model or tool changes, handoffs that already list the files to open, tasks that must enter `specs/` or historical trees, suite wall time dominated by the existing tests, and owner-returned defects that arrive after the commit. A sample of five can support a description of the median and the range. It cannot by itself support a causal claim that these documents or a future ignore file produced a percentage reduction. Do not publish a savings percentage from a partial ledger.

### Confounders already visible at Stage 1

- This baseline's own inspection was directed by a handoff that named the production files, so it cannot serve as T1.
- `specs/` is large and remains in scope for any task that changes a contract. Routing text does not make those reads unnecessary.
- `server.mjs` and `public/app.js` are single large files. A task that needs one handler still pays to locate it inside the file until a later, separately authorized split.
- Cursor 3.27.14 has no verified index-only exclude, so historical files remain in ordinary search.
- Token and tool-call totals depend on the client exposing them. When it does not, the cell is `unavailable`.
