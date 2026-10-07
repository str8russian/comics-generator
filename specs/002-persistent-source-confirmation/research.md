# Research: Persistent Source and Cast Confirmation

Decisions for [plan.md](./plan.md). The specification is accepted. This file resolves storage, concurrency, and contract shape. It does not add product scope.

## Decision: PostgreSQL 16 through the `pg` driver, with SQL migrations

- **Decision**: The application stores the one local project in PostgreSQL 16. The Node process uses the `pg` package and talks to the database with explicit SQL. Migrations are ordered `.sql` files under `app/storyboard-web/db/migrations/`, applied by the application before it listens.
- **Rationale**: `DEC-046` already selects PostgreSQL for durability outside process memory. A small driver keeps confirmation, cast copy, and activation as visible transactions. The user does not open a database shell.
- **Alternatives considered**: An ORM or query builder adds a second schema language for one project. SQLite would contradict the accepted local-first direction. Writing JSON files in the repository would not give transactional confirmation.

## Decision: Docker Compose starts PostgreSQL and the application

- **Decision**: Repository-root `docker-compose.yml` runs `postgres:16` and a `node:24` application image. A named volume holds the database files. The application container waits until PostgreSQL is healthy, applies migrations, then listens. `docker compose up` is the local startup. No `psql` step is required.
- **Rationale**: Restarting the application container must not drop the project. The user should not create roles, databases, or extensions by hand.
- **Alternatives considered**: A host-installed PostgreSQL service makes setup depend on the machine. Running only the database in Compose and starting Node on the host is a useful developer shortcut, but the documented path is one Compose project so the database is not an extra product the user operates.

## Decision: One singleton project row

- **Decision**: Migration `001_init.sql` inserts exactly one `project` row. A unique constraint on a singleton flag prevents a second row. HTTP routes do not take a project id.
- **Rationale**: The specification is one resumable local project. A project list, accounts, and private links are out of scope.
- **Alternatives considered**: A project id in the URL implies a list and selection UI. Creating a project on first paste makes startup and tests race on “does the row exist?”. Seeding it in the migration makes resume deterministic.

## Decision: Draft autosave uses a revision token

- **Decision**: `working_draft.revision_token` is a UUID. Every successful save replaces the text and the token in one `UPDATE ... WHERE revision_token = $expected`. Zero updated rows is `409` `stale-draft`. The rejected body is not written. The conflict response contains no draft text. The client reloads `GET /api/project`.
- **Rationale**: Two overlapping saves, including two browser tabs, must not let an older textarea replace a newer saved draft. A token identifies the version the client thought it was editing. Comparing the full text in the `WHERE` clause would treat “my old text still matches” as success and would not detect that a newer different edit already landed and was then changed back by a third write; the token catches every successful save.
- **Alternatives considered**: Last-write-wins silently drops a tab. `ETag` on a hash of the text misses the case where two different saves are in flight and the client retries the older body after the newer one commits. A monotonic integer also works; a UUID avoids implying that clients may invent the next number.

## Decision: Confirmation compares exact draft text, and the reading stores that text

- **Decision**: A reading row stores the draft text and the revision token observed when the reading started. The provider is called only after that snapshot is committed. Confirmation runs in one transaction and succeeds only when `working_draft.text` is equal to `reading.draft_text` and the reading is the project’s current ready reading. The compare is PostgreSQL text equality of the two stored strings. The application does not normalize Unicode. A token change with identical text still matches. A different text is `409` `stale-reading` and inserts nothing.
- **Rationale**: The specification gates confirmation on character-for-character equality, not on the token. The token still tells the page that a save happened. The server snapshot, not the confirm request body, is the text that can be committed, so a client cannot confirm a reading against a different paste.
- **Alternatives considered**: Requiring the token to match would reject a save that wrote the same characters and would be stricter than the specification. Trusting text supplied in the confirm body would let a stale page commit characters the database no longer holds.

## Decision: JavaScript UTF-16 offsets, PostgreSQL `text`, reject NUL and unpaired surrogates

- **Decision**: Drafts and source revisions are PostgreSQL `text`. `node-pg` returns them as JavaScript strings. Source offsets remain JavaScript UTF-16 indexes, computed in Node after the string is loaded. SQL `substring` and `char_length` are not used to slice the draft. On save, the server rejects U+0000 and unpaired UTF-16 surrogates with `400` `invalid-request` and does not truncate.
- **Rationale**: PostgreSQL `text` cannot store U+0000, and Node encodes strings to UTF-8. Rejecting those two cases makes a successful round trip exact for Cyrillic, emoji, and combining marks. Existing fidelity code already slices with `String.prototype.slice`.
- **Alternatives considered**: `bytea` would preserve NUL but would force every read through a second encoding. Normalizing to NFC would change the user’s characters and fail SC-001.

## Decision: Immutable rows, mutable pointers

- **Decision**: The application inserts source revisions, interpretations, source items, provisional characters, surface forms, material states, cast rows, and storyboard results. It does not update or delete those rows. It may update only `project` active pointers, `project.current_reading_id`, `working_draft`, and the pre-confirm pending cast of the current reading.
- **Rationale**: The specification makes the Source Revision, Interpretation, and material state immutable. Pointers say which revision and material state are active. Restaging inserts another storyboard result; the newest row for that material state is the one shown.
- **Alternatives considered**: Updating a cast JSON column on the source revision would rewrite accepted state. Deleting the previous storyboard would make an older material state unable to show its previous result.

## Decision: Material state is a copy, not a patch log

- **Decision**: Each material state stores a complete canonical cast: characters, aliases, and speaker assignments. A correction inserts a new material state that references the same Source Revision and Interpretation, with `parent_material_state_id` pointing at the previous state. The transaction copies the previous rows and applies the one user change.
- **Rationale**: Resume and staging must read one state and get the whole cast. A patch log would have to be replayed and could make “the earlier mapping” depend on replay order.
- **Alternatives considered**: Storing only the changed alias would make the earlier state harder to distinguish without a replay. Mutable columns on one row contradict the artifact model.

## Decision: Current material state of a revision is the latest inserted row

- **Decision**: For one Source Revision, the current material state is the row with the greatest `created_at`, breaking ties by `id`. The project’s active material state is whatever `project.active_material_state_id` points at. Activating a revision sets that pointer to the revision’s current material state. The page does not offer a list of material states.
- **Rationale**: Cast corrections must remain distinguishable, and the user-facing history required here is the Source Revision list.
- **Alternatives considered**: A material-state browser is explicitly out of scope. Overwriting `active_material_state_id` without keeping the old row would destroy the earlier storyboard’s association.

## Decision: Dialogue strings are rebuilt from source offsets on read

- **Decision**: A storyboard result stores Stage structure and display-block offsets. Every API read re-derives `dialogue` and action text from the Source Revision slice. A stored dialogue string is not authoritative.
- **Rationale**: FR-014 keeps exact dialogue on source references. A persisted model or client string must not become a second copy that can drift.
- **Alternatives considered**: Persisting the checked HTTP body and trusting its `dialogue` field would let a bad write change the words the page shows after restart.

## Decision: Stage prompt file stays byte-identical; the user payload gains `cast`

- **Decision**: `app/storyboard-web/prompts/stage.md` is not edited. `eval/stage-artistic/` is not edited and is not run. The persistent staging path adds a `cast` object to the Stage user message. `requestStageCandidate` adds that object only when the caller passes a cast. The existing one-shot and the artistic runner omit it, so their user message remains `{ "sourceItems": [...] }`.
- **Rationale**: The acceptance example requires Stage to receive the confirmed mapping. The specification also says the artistic instructions and the saved baseline stay put. Receiving the cast is contract plumbing. It is not a directing change, and it does not need a new sentence in the artistic prompt.
- **Alternatives considered**: Adding a sentence to `stage.md` would change the bytes a future baseline run would send. Re-scoring the baseline would be prompt evaluation, which this feature excludes.

## Decision: Interpret schema and prompt gain characters and surface forms

- **Decision**: The persistent reading path validates an extended Interpret object: existing `sourceItems` plus required `characters` and `surfaceForms`. `app/storyboard-web/prompts/interpret.md` is extended to ask for those arrays and for nothing else. Speaker ownership stays on each utterance as `explicit`, `inferred`, or `unresolved`. The provider adapter in `provider.mjs` is unchanged.
- **Rationale**: Material review needs provisional people and aliases. The current schema forbids any property beyond `sourceItems`, so the extension has to be explicit. Existing one-shot fixtures that return only `sourceItems` must be updated when the shared prompt and schema change; fidelity rules for anchors and dialogue do not change.
- **Alternatives considered**: A second model call only for cast would add a provider request and a merge problem. Inferring aliases only with regular expressions would miss the Peskov case the specification wants the reading to propose and the user to correct.

## Decision: The one-shot `POST /api/storyboard` stays, and the page stops using it

- **Decision**: The existing tracer route remains for the current offline suite. It does not open a database transaction and does not insert a Source Revision. The product page uses the project routes. Staging from the page runs only from the active material state.
- **Rationale**: Rewriting every tracer test is not required to prove persistence. Leaving the route on the page would bypass confirmation.
- **Alternatives considered**: Deleting the route in this feature would mix a large test migration into the persistence work. Making the route write a revision would confirm material the user had not reviewed.

## Decision: Provider work happens outside the draft lock

- **Decision**: Reading and staging snapshot the ids and text they need, commit that snapshot, then call the provider. The result is saved only onto the snapshotted reading or material state. If the active material state changed while Stage was running, the result is still stored on the captured material state and is not marked ready for the new active state.
- **Rationale**: Holding a row lock for a model call would block autosave for the whole completion. Attaching a late result to a newer cast would label the old storyboard ready for the new mappings.
- **Alternatives considered**: Cancelling the provider call on every keystroke is unnecessary if the result cannot be confirmed or labeled ready for a different text or cast.

## Decision: Database failure stops startup or returns `database`

- **Decision**: If the server cannot connect or a migration fails, it logs `database-unavailable` or `migration-failed` plus the migration id, and it exits before listening. A later query failure is HTTP `503` `{ "status": "failed", "kind": "database" }`. Logs and that body omit the driver message, SQL text, connection string, and draft.
- **Rationale**: A half-migrated listener would persist some routes and fail others. Driver messages can echo statements and values.
- **Alternatives considered**: Starting anyway and failing on the first save looks like a lost draft. Returning `error.message` to the browser leaks database internals.

## Decision: Tests split offline from PostgreSQL

- **Decision**: The default `node --test` command does not read `.env.local`, does not call the live provider, and skips PostgreSQL files when `STORYBOARD_TEST_DATABASE_URL` is unset. A separate quickstart command exports that URL on the command line for a `comics_test` database created by Compose, then runs the PostgreSQL files. Those tests truncate application tables between cases. They never open the `comics` database used by the running app.
- **Rationale**: Anchor, fidelity, overflow, renderer, and log tests must stay runnable without Docker. Lost-update, rollback, and exact-text tests must hit real PostgreSQL because an in-memory substitute can pass while the SQL is wrong.
- **Alternatives considered**: Requiring Compose for every `node --test` run makes the existing suite depend on a database. Pointing tests at the app database would wipe the user’s project.

## Decision: Implementation phases inside one feature

- **Decision**: The first implementation phase demonstrates the P1 checkpoint: durable draft, Material review, atomic confirmation, cast correction, unresolved-speaker blocking, staging from the confirmed cast, and resume. The second phase adds Source Revision history, viewing, and activation with the destructive warning. The first migration already contains parent links and activation columns so phase two does not rewrite committed tables.
- **Rationale**: The specification marks revision activation as P2 and says it may follow inside the same feature. Shipping the schema once avoids a second migration that rewrites immutable rows.
- **Alternatives considered**: A second feature for history would leave parent links unspecified and tempt a later incompatible table change. Building the history UI before the draft survives restart delays the demonstrable checkpoint.
