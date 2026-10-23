# Feature 020 plan

## Change surface

- Port `a1-known-matte-v2` into `app/storyboard-web/foreground/` (`config.mjs`, `color.mjs`, `decode.mjs`, `extract.mjs`, `contract.mjs`, `persist.mjs`). Thresholds are unchanged.
- Append `stage-a2-matte-contract-v1` in `compilePanelReadyPrompt` and `panelPrompt`. `anchorPrompt` and `anchor-prompt.mjs` stay unchanged.
- `finishPanelGeneration` and the upload branch of `prepareAssignment` store the original, then attach a foreground. Assignment, frame duplication, and provider reference assembly keep the original asset id.
- `loadVisualWithClient` reads existing extraction rows. It does not write them.
- `compileVideoSpec`, `FrameRenderer`, `prototypes/remotion-rough/src/Video.jsx`, and `renderer-remotion/Storyboard.tsx` draw `system-slate-matte` under the chosen image.
- The Panel Editor, in `app.js` via `foregroundChip`, shows `Фон отделён` or `Фон не отделён` with finding codes in a disclosure.
- `duplicateProject` copies a foreground asset and its extraction row when the source asset is copied.
- `backfill-panel-foreground.mjs` is the explicit, project-scoped, dry-run-by-default command.

## Storage and migration

`017_panel_foreground.sql` adds `panel-foreground` to the asset kind check and creates `panel_foreground_extraction`:

- `source_asset_id` primary key, cascading when the source asset is deleted;
- nullable `foreground_asset_id`, required only for `candidate-pass`, cascading when that derived asset is deleted;
- `extractor_version`, `contract_version`, `status` (`candidate-pass`, `review`, `reject`, `failed`), `findings`, and `timing_ms`.

The original `visual_asset` row is inserted first and never updated. A pass also inserts the RGBA PNG. A review, reject, or exception inserts only the metadata row. An exception is recorded as `extraction-exception` and does not fail the operation.

## Read model

Each panel with an image exposes:

- `assetId`: the original asset;
- `drawAssetId` and `asset`: the foreground when `usesForeground` is true, otherwise the original;
- `backgroundColor`: `#5d6e86`;
- `extraction.status`, `extraction.usesForeground`, and `extraction.findings` (`code`, `level`).

A panel image with no row uses status `not-extracted` and draws the original. The video spec copies `drawAssetId`, `backgroundColor`, `extractionStatus`, and `usesForeground`.

## Rendering

`FrameRenderer` sets the panel background only when it draws an image and the payload includes `backgroundColor`. Structure mode is unchanged. Remotion's production composition uses the same color under an image and keeps `#082b31` when the panel has no image. The legacy `renderer-remotion` composition accepts `backgroundColor`, `extractionStatus`, and `drawAsset` without changing storyboards that omit them.

Opaque images cover the underlay, so a fallback at the same zoom, pan, and mirror matches the previous image placement.

## Backfill

```text
node app/storyboard-web/backfill-panel-foreground.mjs --project <uuid>
node app/storyboard-web/backfill-panel-foreground.mjs --project <uuid> --apply
```

The command reads `DATABASE_URL`. It does not migrate and it does not call a provider. Dry-run counts panel and uploaded images that have no extraction row. `--apply` extracts only those rows for that project. A second apply writes nothing. Contract version is null because those images were not generated under the new prompt.

## Tests

- Ported extractor tests, plus byte-identical findings.
- Prompt: contract appended, remainder byte-identical, anchor unchanged, provenance fields present in the panel-generation path.
- FrameRenderer and video spec choose the foreground or the original and carry the background.
- PostgreSQL file `test/postgres/foreground.test.mjs` on `comics_test` only: pass, review, reject, exception, one version, Undo, upload, assign, duplicate frame, duplicate project, dry-run and idempotent backfill, `load` does not extract, prior asset bytes remain, other projects stay untouched.
