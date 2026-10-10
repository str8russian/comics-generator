# Quickstart: Visual storyboard repair

## Prerequisites

- PostgreSQL from repository Compose, database `comics` for the local product server, `comics_test` for verification.
- `app/storyboard-web/server.mjs` serving this worktree, currently expected at `http://127.0.0.1:4174/`.
- Provider credentials are required for model-backed structural edits and image generation. Identity save and the deterministic full-frame command must not call the image provider.

## Automated tests

From the repository root:

```sh
node --test app/storyboard-web/test/**/*.test.mjs
```

PostgreSQL files skip unless `STORYBOARD_TEST_DATABASE_URL` is set. Final verification:

```sh
STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
  node app/storyboard-web/test/postgres/verify.mjs
```

That command must not open database `comics`.

## Browser paths

1. Open `http://127.0.0.1:4174/`.
2. Confirm the stored 18-frame text storyboard.
3. Apply `в кадре 14 должен быть только Путин на весь кадр`.
4. Confirm visible frame 14 is single-panel Putin, dialogue unchanged, other frames unchanged, count still 18.
5. Select “Вернуть обратно” and confirm original frame 14.
6. Save a synthetic JPEG or PNG for one character. Confirm the photo appears and “Создать base anchor” is enabled.
7. Confirm logs show no image-provider request during that save.
8. Try a HEIC/HEIF or other invalid file and confirm the Russian explanation names the problem.

## Evidence already captured

- Structural 409 body: `{ "status": "blocked", "failures": [{ "code": "unaccounted-source-item", "sourceItemId": "item-1" }] }`.
- Identity 400 body for a valid PNG: `{ "status": "failed", "kind": "invalid-request" }`.
