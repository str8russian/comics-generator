# W1 workspace prototype

An isolated, standalone browser prototype of a stage-based Comics Generator workspace. It exists so the owner can judge, on one real project, whether stages plus contextual frame actions remove the current control overload while keeping every existing operation findable. It is not production code, never writes anywhere, and makes no provider calls.

## Run

```sh
npm run prototype:w1          # http://127.0.0.1:4190/
npm run prototype:w1:test     # node:test suite
```

`W1_PROTOTYPE_PORT` changes the port; 4173 (production app) and 5432 (PostgreSQL) are refused. `W1_DATA=fixture` forces the synthetic fixture even when a local export exists.

## Data

- `snapshot/` (gitignored): one real project exported read-only. When `snapshot/snapshot.json` exists the server serves it under `/data/`; otherwise it serves `fixture/`.
- `fixture/`: a committed synthetic project with SVG placeholder images. It covers what a real project may lack: Silent and No line frames, a text card, a two-part directing beat, panels without images (base state), and a character without an approved anchor.

### Export a real project

```sh
node prototypes/w1-workspace/export-snapshot.mjs --list             # candidates only
node prototypes/w1-workspace/export-snapshot.mjs                    # most recent eligible project
node prototypes/w1-workspace/export-snapshot.mjs --project <uuid>   # a specific project
```

The exporter connects with `W1_EXPORT_DATABASE_URL`, else `DATABASE_URL`, else the docker-compose default on `127.0.0.1:5432`. It does not use the production HTTP API, because `GET /api/visual` lazily writes (head version, dialogue-mode and panel-id backfills, current-asset and style-seed backfills, panel-row upserts). It runs only `SELECT` statements inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`, with `default_transaction_read_only=on` on the connection, and checks `transaction_read_only` before reading. It imports only `pg` and Node built-ins. Identity photos are not exported; panel images, base anchors, and performance references are.

Eligible means: at least one approved base anchor, at least one split frame, and at least one panel with an assigned image. The default pick is the most recently updated eligible project.

## What is real and what is a stub

Real, in memory, through one dispatcher keyed by production operation names (`public/store.mjs`):

- `duplicateFrame` (single frame, no batch): inserted after the source, new frame and panel ids, selected, renumbered, one Undo removes it.
- `setFrameDialogue` for dialogue mode (Spoken / Silent / No line) and speaker.
- `placement` for zoom, pan (drag or arrows), mirror, and reset, with Feature 010 ranges and defaults.
- `undoStoryboardEdit` (one global Undo) and the prototype-only Reset to snapshot.

Everything else is navigation or a labelled stub. Stubs still call the same dispatcher and show an inline "Not wired in prototype" note with the production operation name. The future entry points (`Refine current`, `New variation`, performance reference, and Apply in the assistant plan preview) are marked as R2, R3, or W3. The assistant field is a mock: it shows its scope and one static plan layout, and never calls a model.

State lives in the tab's memory. Reloading restores the snapshot.

## Files

- `server.mjs`: static `node:http` server for `public/` and `/data/`; GET and HEAD only.
- `export-snapshot.mjs`: read-only exporter.
- `public/operations.mjs`: ports of the production operations (see `OPERATIONS_INVENTORY.md` for sources).
- `public/model.mjs`: snapshot loader and display model; missing fields become visible notes.
- `public/store.mjs`: dispatcher, Undo, Reset, selection.
- `public/stages.mjs`: stage status and next action.
- `public/frame-renderer.mjs`: port of the shared frame geometry.
- `public/app.mjs`, `public/index.html`, `public/app.css`: the workspace UI.
- `OPERATIONS_INVENTORY.md`: every existing operation and where it lives in the prototype.
- `test/`: dispatcher, loader, isolation, and inventory-completeness tests.
