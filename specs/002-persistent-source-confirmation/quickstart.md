# Quickstart: Persistent Source and Cast Confirmation

Validation guide for after implementation. This plan does not add those commands yet, and it does not create `tasks.md`.

## Preconditions

- Repository root and Node 24.
- `pg` is installed when the implementation adds it. Offline tests do not open a database.
- Do not pass `--env-file` or `--env-file-if-exists=.env.local` to the default test command.
- Do not call the live provider. Reading and Stage tests use the existing fake chat-completions adapter.
- The owner’s reference dialogue is not copied into fixtures.

## Default checks

From the repository root:

```sh
node --test app/storyboard-web/test/**/*.test.mjs
```

Expected:

- Existing tracer suites still pass: fidelity, anchors, overflow, renderer structure, HTTP allowlist, and lifecycle log redaction.
- PostgreSQL test files skip when `STORYBOARD_TEST_DATABASE_URL` is unset. They do not connect and do not read `.env.local`.
- Interpret schema tests compile `specs/002-persistent-source-confirmation/contracts/interpret-response.schema.json` with Ajv strict mode. `characters` and `surfaceForms` are required. A model offset, an unknown property, or a surface form without `quote` fails. The tracer stage response schema is unchanged.
- A prompt test reads `app/storyboard-web/prompts/stage.md` and compares it to the bytes from before this feature. `app/storyboard-web/eval/stage-artistic/` is not executed.
- The persistent Stage caller includes `cast` only when a material state is supplied. The one-shot caller’s user message is still `{ "sourceItems": [...] }`.
- Log tests post a draft containing a unique marker and assert that marker, `Bearer`, the provider host, and `DATABASE_URL` are absent from log lines and from `409`, `502`, `503`, and `504` bodies.
- `POST /api/storyboard` still does not insert a Source Revision.

`npm run check` remains the historical video-pipeline check. It does not start PostgreSQL or the provider.

## PostgreSQL checks

Start only the database:

```sh
docker compose up -d db
```

Compose creates `comics` for the application and `comics_test` for tests. Then, with the test URL on the command line and not in `.env.local`:

```sh
STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
  node --test app/storyboard-web/test/postgres/*.test.mjs
```

The port published for the database is `5432` unless Compose overrides it. The application database `comics` is not truncated.

Expected:

- A stale draft token does not replace a newer text. The newer text remains character for character, including `Дмитрий Сергеевич`, an emoji, and `е` plus U+0308.
- Confirmation of a reading whose stored text differs from the working draft inserts no Source Revision, Interpretation, or material state.
- A successful confirmation inserts exactly one of each, and a rolled-back failure inserts none.
- A cast correction inserts a new material state and no new Source Revision or Interpretation. The previous material state’s storyboard stays stored and is not `readyEligible`.
- Activation with `confirmDiscard: false` leaves the working draft and the revision count unchanged. `confirmDiscard: true` replaces the draft with the selected revision text and still inserts no Source Revision.
- Rebuilt dialogue equals the source slice. A tampered stored dialogue string is not what `GET /api/project` returns.
- U+0000 is `400` and is not stored.

## Application startup

```sh
docker compose up
```

Expected:

- PostgreSQL becomes healthy, then the application applies `app/storyboard-web/db/migrations/001_init.sql` and listens.
- The log line is the bound URL. It does not contain the database password or a draft.
- Opening the URL loads the singleton project. Pasting, refreshing, and restarting the application container show the same draft text.
- Stopping Compose without deleting the volume, then starting it again, shows the same project. `docker compose down -v` deletes that volume; the quickstart does not use `-v`.
- If PostgreSQL is down, the application process exits before listening and logs `database-unavailable`.
- A deliberately broken migration file, used only in a test image, exits with `migration-failed` and does not listen.

Provider credentials stay in the untracked `.env.local` and are optional for resume. A reading or staging call without them returns `configuration` and does not contact a provider. The default test command does not use that file.

## Manual P1 checkpoint

Use a synthetic Russian dialogue, not the owner’s reference text.

1. Paste the dialogue and refresh. The same characters are in the textarea.
2. Request a reading. Material review shows source items, characters, aliases, and speaker findings. It does not show a non-blocking finding.
3. Map `Дмитрий Сергеевич` to `Песков` if both strings are in the fixture. The draft text is unchanged.
4. Confirm. Restart the application container. The same revision, interpretation order, and mapping are loaded.
5. Leave one speaker unassigned and request a storyboard. The page shows `unresolved-speaker` and no ready frames. Stage is not called.
6. Assign that speaker and stage. The storyboard can be labeled ready after fitting. Dialogue still contains the original surface form.
7. Change only the alias. The previous frames may remain visible and are not labeled ready. Stage again. The new result is eligible for ready, and the source text is unchanged.

The P2 check adds: edit punctuation, confirm a new revision, view the old text, and cancel activation while an unsaved edit exists. The warning is the contract string, and the unsaved edit is still present after cancel.

## Live provider

Not part of either test command. Do not add a live smoke to this feature’s default path.
