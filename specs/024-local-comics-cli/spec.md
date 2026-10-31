# Local Comics CLI runtime foundation

## Status

The local Comics CLI foundation is accepted. This contract includes `comics compare <ref-a> <ref-b>`.

## Command surface

```text
comics start
comics start <ref>
comics start <ref> --fresh
comics start <ref> --reuse <run-id>
comics compare <ref-a> <ref-b>
comics list
comics stop <run-id>
comics clean <run-id>
comics db list
comics db shell [<run-id>]
comics help
comics --help
```

`--fresh` and `--reuse` are mutually exclusive, and neither is valid without a ref. Unknown commands, unknown options, missing arguments, and extra arguments fail with usage. `comics db shell` without a run id opens database `comics`. With a run id it opens that run's registered managed database.

## Resources

The command discovers the Git repository from its installed package location and selects the unique worktree on local branch `master` as the primary checkout. The caller's current directory does not choose the repository.

CLI state is stored in a hidden sibling of that checkout: `<parent>/.comics-pipeline-runs/`. For the production checkout this is `/Users/andrey/Documents/Projects/.comics-pipeline-runs/`. The directory holds an atomic registry, a mutation lock, logs, temporary snapshots, and detached worktrees. Nothing there is committed.

`main` is the only run that uses the primary checkout, port `4173`, and database `comics`. A managed run id is either `sha` plus the full commit SHA or, for `--fresh`, `f` plus 16 random hex characters. Its database is `comics_cli_` plus that id. Its worktree is `<managed-root>/worktrees/<run-id>`. Managed ports are chosen from `4174`–`4273` after checking both the registry and the loopback listener.

## Lifecycle

- Bare `comics start` launches `node app/storyboard-web/server.mjs` from the primary checkout's current files. It does not copy the database or create a worktree.
- `comics start <ref>` resolves one unambiguous local commit-ish to a full SHA, creates a detached worktree at that SHA, and restores a `pg_dump` custom-format snapshot of `comics` into a new managed database. The same SHA later reuses that worktree and database only while that run's stored SHA is still the resolved SHA.
- An ordinary default start never implicitly reuses a database after its deterministic run was retargeted to another SHA. Returning that run to a different ref requires explicit `--reuse <run-id>`. `--fresh` creates a separate run instead. The command refuses before install, spawn, or registry mutation, and it does not print the requested SHA as running.
- Every managed launch requires the worktree to exist at its validated path, belong to the same repository, be clean of tracked and non-ignored untracked changes, and have actual `HEAD` equal to the stored and printed SHA. Drift or dirtiness is an inconsistency and is not repaired automatically. Bare `main` still launches the primary checkout's current dirty files.
- `--fresh` always creates a new run, worktree, snapshot, and port.
- `--reuse <run-id>` restarts a stopped managed run on its existing database. Before checkout, actual `HEAD` must equal the stored SHA and the worktree must be clean. After checkout, actual `HEAD` must equal the new SHA before installation or launch. A SHA change prints a warning that forward migrations are not downgraded. A failed checkout or install rolls back to the previous SHA, and a failed rollback is reported as incomplete. Once a server process for the target SHA has been spawned, a failed start stays on that SHA because the isolated database may already have applied its migrations.
- A healthy matching process makes `start` print the existing URL and exit without a second process.
- A live process whose command line is not the registered server is foreign. The CLI never signals it.
- A matching process that is alive but fails its HTTP check is unhealthy. `start` does not replace it and does not kill it.
- `stop` sends `SIGTERM` only to the matching PID, waits for exit, and preserves the worktree, database, log, and registry record. It does not send `SIGKILL`.
- `clean` requires a stopped, clean, consistent managed run. It removes the managed worktree with `git worktree remove --force` before dropping that `comics_cli_` database, then deletes the log and registry entry. It is not an implicit stop and it never drops `comics` or `comics_test`.
- Failed Git worktree removal never falls back to raw recursive deletion. The worktree, database, and registry entry stay, and the command fails. If Git removal succeeds and the database drop fails, the worktree is gone, the database and registry entry remain, and a later `clean <run-id>` retries the remaining database cleanup.
- Failed creation rolls back only the worktree, database, and dump created by that invocation. If Git cannot remove the new worktree, rollback is reported as incomplete and the directory is not raw-deleted.
- Registry writes use a temp file and rename. A malformed registry is refused rather than treated as empty.
- `comics start` writes a short progress line to stderr immediately before each stage it actually runs. The final run summary stays on stdout. Help, list, stop, clean, and db commands do not emit start progress. Compare progress is specified below. Progress does not include credentials, database URLs, or provider output.

## Compare

`comics compare <ref-a> <ref-b>` resolves two explicit local refs and starts two ordinary managed runs, labelled `left` and `right`. It does not diff Git, compare rendered output, open a browser, synchronize application state, or add a comparison screen. It does not create a comparison-group record or a second registry. After success, both runs remain ordinary entries in `comics list` and `comics db list`. The user stops and cleans each one with the existing commands. Compare does not stop or clean either side when it returns.

- Exactly two positional refs are required. Missing refs, extra arguments, and every option, including `--fresh`, `--reuse`, and `--open`, fail with usage.
- Both operands use the existing local-only ref rules. Compare never fetches.
- Both refs are resolved, and both existing-record checks below are finished, before either side is installed, checked out, started, or created. An unknown, ambiguous, or otherwise invalid right ref does not launch the left side.
- If both refs resolve to the same full commit SHA, compare refuses before database, worktree, install, spawn, or registry mutation.
- The first operand is `left` and the second is `right`. Those labels stay on progress, errors, and the final summary.
- `master`, `HEAD`, tags, local branches, existing remote-tracking refs, and commit IDs stay ordinary refs. Each side uses the deterministic managed run for its resolved SHA and the same safety rules as `comics start <ref>`. Neither side is the `main` run, uses port `4173`, or connects to database `comics`.
- A missing side is created with a detached worktree, isolated snapshot database, dependency installation, port allocation, server spawn, and health check. A stopped matching side restarts on its existing worktree and database. A healthy matching side is reused without a second process.
- Distinct sides have distinct run IDs, worktrees, databases, and non-`4173` ports.
- Existing deterministic-run retargeting, dirty or drifted worktrees, stored SHA checks, foreign PIDs, unhealthy processes, installation, rollback, cleanup, and migration-warning rules stay in force. An already inconsistent or unhealthy side is refused before either side launches.
- The sides run left, then right. Compare does not mutate the registry concurrently. If the left side fails, the right side is not attempted. If the right side fails after the left side is healthy, compare exits nonzero, identifies the right-side failure, and reports that the left run remains available, with enough left-side details to manage it. It does not roll back, stop, or clean the left side.
- A pre-spawn failure rolls back only resources newly created by that side. A post-spawn failure stays recorded under the accepted per-run rule.
- A successful pair summary is printed only when both sides are healthy. Stdout labels `left` and `right` and includes, for each, the requested ref, resolved SHA, run ID, status, worktree, database, port, URL, and provider mode. The summary does not claim that Git content or rendered output was compared.
- Live progress stays on stderr and is prefixed `[left]` or `[right]` for the side that is actually running that stage. The final summary stays on stdout.

## Provider and dependencies

Every run inherits the primary checkout's environment, including `.env.local` through Node's `--env-file-if-exists`. The CLI overrides `STORYBOARD_HOST`, `STORYBOARD_PORT`, and `DATABASE_URL` only. Provider mode is reported as `enabled (local configuration)`. Tokens, database URLs, and passwords are not printed or stored in the registry or log banner.

The first creation of a managed worktree runs `npm ci` there. A later SHA change reinstalls when `package-lock.json` changes or `node_modules` is missing. The primary checkout's `node_modules` is not shared or symlinked. A ref without `package-lock.json` fails installation instead of using an unlocked install.

`start` may run `docker compose up -d db` from the primary checkout and wait until `psql` can reach database `comics` on `127.0.0.1:5432`. It does not start the Compose `app` service. Missing Node `>=24`, npm, Git, Docker Compose, or the PostgreSQL client tools fails before mutation. The CLI does not kill foreign processes or rewrite Compose.

## Owner checkpoint

Review the feature worktree, then from an unrelated directory run the worktree executable: show `--help`; start this branch's ref as a managed run; open its URL and confirm the copied projects load without an unrequested provider action; `list`, `stop`, and start the same ref again to confirm reuse; `db list` and optionally `db shell`; then `stop` and `clean` and confirm the reported resources are gone. `comics compare <ref-a> <ref-b>` prints two managed URLs; open each, then stop and clean those run ids individually. Run `npm link` from the primary checkout only after integration.

## Deferred

Project transfer, automatic fetch, `open`, `--ephemeral`, aliases, shell completion, and any change to server routes, providers, schemas, migrations, or the main database contract are out of scope.
