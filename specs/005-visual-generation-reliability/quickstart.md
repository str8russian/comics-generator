# Quickstart: Visual Generation Reliability

## Prerequisites

- PostgreSQL with `comics` (walkthrough) and `comics_test` (automated destructive tests)
- Env file with contest image credentials for live browser checks
- Server:

```sh
STORYBOARD_PORT=4174 STORYBOARD_HOST=127.0.0.1 DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics \
  node --env-file=/Users/andrey/Documents/Projects/comics-pipeline/.env.local app/storyboard-web/server.mjs
```

## Offline suite

```sh
node --test app/storyboard-web/test/**/*.test.mjs
```

## PostgreSQL suite

```sh
STORYBOARD_TEST_DATABASE_URL=postgres://comics:comics@127.0.0.1:5432/comics_test \
  node app/storyboard-web/test/postgres/verify.mjs
```

Do not point destructive helpers at `comics`.

## Browser checks

1. Confirm or backfill the project style seed from the first approved anchor.
2. Regenerate corrected candidates for at least two non-seed characters; visually compare against the seed.
3. Generate one single-panel frame; confirm Visual mode, close/reopen, reload.
4. Generate one split frame; confirm both panels and dialogue placement; reload.
5. Force one provider failure in an isolated configuration; confirm Russian failure copy, logs, and retry.
