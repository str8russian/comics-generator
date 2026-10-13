# Quickstart: Visual placement controls

## Deterministic checks

From `app/storyboard-web`:

```bash
node --test test/renderer-structure.test.mjs test/visual-model.test.mjs test/visual-workflow.test.mjs test/research-capture.test.mjs
node --test test/**/*.test.mjs
```

From the repository root, when local Compose `comics_test` is already reachable:

```bash
STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
  node app/storyboard-web/test/postgres/verify.mjs
```

Do not print the URL. Do not call an image provider.

## Owner checkpoint

Start the existing app against the local database. Do not regenerate images.

```bash
node --env-file=.env.local app/storyboard-web/server.mjs
```

Open `http://127.0.0.1:4173/`.

1. Open a generated `single` frame and a generated `split2` frame in Visual detail.
2. Drag left, right, up, and down. Only the dragged panel moves.
3. Zoom after pan, and pan after zoom. Neither value returns to the default.
4. Reset. Expect zoom `1`, position `50/30`, mirror off.
5. Mirror, then pan and zoom while mirrored. Turn mirror off. Pan and zoom stay.
6. Close and reopen detail, then reload. The same placement remains.
7. Confirm the horizontal hairline is gone and the split divider is still 48 px.
8. Confirm Close, Next, panel regeneration controls, dialogue, zoom, and the Research dock still open. Do not start a live generation.
