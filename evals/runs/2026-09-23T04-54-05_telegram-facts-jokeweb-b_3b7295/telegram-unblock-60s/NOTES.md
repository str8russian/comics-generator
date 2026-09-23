# telegram-unblock-60s

File every stage artefact with `run.mjs stage`, which writes the next version and never
overwrites the previous one:

```
node tools/run.mjs stage evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295 telegram-unblock-60s 01-script <file>        # Writer
node tools/run.mjs stage evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295 telegram-unblock-60s 02-script-edited <file> # Editor
node tools/run.mjs stage evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295 telegram-unblock-60s 03-storyboard <file>    # Director
node tools/run.mjs stage evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295 telegram-unblock-60s 04-review <file>        # Reviewer
```

A repair is **not** a new stage. Filing a repaired storyboard writes `03-storyboard.v2.json`
and leaves `v1` in place: the pre-repair state is what the experiment measures.

Then, per storyboard version (bump `v1` to match the version you are checking):

```
node tools/validate.mjs evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295/telegram-unblock-60s/03-storyboard.v1.json --brief evals/cases/telegram-unblock-60s/brief.json --json evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295/telegram-unblock-60s/validator.v1.json
node tools/metrics.mjs evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295/telegram-unblock-60s/03-storyboard.v1.json --json evals/runs/2026-09-23T04-54-05_telegram-facts-jokeweb-b_3b7295/telegram-unblock-60s/metrics.v1.json
```

`run.mjs summarize` reports the highest version it finds, and derives repair turns from how
many storyboard versions exist.

## Your verdict on the rendered video

(the only real oracle — watch it and write what is wrong, in the finding form:
location / observation / consequence / minimum correction)
