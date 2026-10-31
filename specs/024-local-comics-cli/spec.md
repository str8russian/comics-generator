# Local Comics CLI runtime foundation

## Status

SpecKit Lite contract for the first CLI increment. Owner acceptance is still required. `comics compare` is deferred and is not implemented here.

## Command surface

```text
comics start
comics start <ref>
comics start <ref> --fresh
comics start <ref> --reuse <run-id>
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
- `comics start <ref>` resolves one unambiguous local commit-ish to a full SHA, creates a detached worktree at that SHA, and restores a `pg_dump` custom-format snapshot of `comics` into a new managed database. The same SHA later reuses that worktree and database.
- `--fresh` always creates a new run, worktree, snapshot, and port.
- `--reuse <run-id>` restarts a stopped managed run on its existing database. It retargets the worktree only when that worktree has no tracked or non-ignored untracked changes. A SHA change prints a warning that forward migrations are not downgraded.
- A healthy matching process makes `start` print the existing URL and exit without a second process.
- A live process whose command line is not the registered server is foreign. The CLI never signals it.
- A matching process that is alive but fails its HTTP check is unhealthy. `start` does not replace it and does not kill it.
- `stop` sends `SIGTERM` only to the matching PID, waits for exit, and preserves the worktree, database, log, and registry record. It does not send `SIGKILL`.
- `clean` requires a stopped, clean, consistent managed run. It prints the worktree and database, drops only that `comics_cli_` database, removes only that managed worktree, and then deletes the registry entry. It is not an implicit stop and it never drops `comics` or `comics_test`.
- Failed creation removes only the worktree, database, and dump created by that invocation.
- Registry writes use a temp file and rename. A malformed registry is refused rather than treated as empty.

## Provider and dependencies

Every run inherits the primary checkout's environment, including `.env.local` through Node's `--env-file-if-exists`. The CLI overrides `STORYBOARD_HOST`, `STORYBOARD_PORT`, and `DATABASE_URL` only. Provider mode is reported as `enabled (local configuration)`. Tokens, database URLs, and passwords are not printed or stored in the registry or log banner.

The first creation of a managed worktree runs `npm ci` there. A later SHA change reinstalls when `package-lock.json` changes or `node_modules` is missing. The primary checkout's `node_modules` is not shared or symlinked. A ref without `package-lock.json` fails installation instead of using an unlocked install.

`start` may run `docker compose up -d db` from the primary checkout and wait until `psql` can reach database `comics` on `127.0.0.1:5432`. It does not start the Compose `app` service. Missing Node `>=24`, npm, Git, Docker Compose, or the PostgreSQL client tools fails before mutation. The CLI does not kill foreign processes or rewrite Compose.

## Owner checkpoint

Review the feature worktree, then from an unrelated directory run the worktree executable: show `--help`; start this branch's ref as a managed run; open its URL and confirm the copied projects load without an unrequested provider action; `list`, `stop`, and start the same ref again to confirm reuse; `db list` and optionally `db shell`; then `stop` and `clean` and confirm the reported resources are gone. Run `npm link` from the primary checkout only after integration.

## Deferred

`comics compare`, paired runs, project transfer, automatic fetch, `open`, `--ephemeral`, aliases, shell completion, and any change to server routes, providers, schemas, migrations, or the main database contract are out of scope.
