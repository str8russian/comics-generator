# Run 2026-09-21T21-37-15_telegram-unblock-staged-v1_e5c5d7

Model: `codex/inherited-current-session-model`

Generation: temperature=—, topP=—, seed=—, reasoningEffort=—, interface=codex-subagent

Prompt versions: `00-shared-context.md@8ca0a2968fe8`, `01-writer.md@5af6ef5f42ba`, `02-editor.md@a4372b972ab3`, `03-director.md@d206428e7d5e`, `04-reviewer.md@dd17447011bc`, `05-single-shot.md@41901b31ba74`

Exact inputs used by this run are copied under `inputs/`.

## Tier 1 — validity

| case | storyboard | repair turns | errors | warnings | diagnostics | top rules |
|---|---|---|---|---|---|---|
| minimal-two-hander | — | — | — | — | — | — |
| neighbours-barrier | — | — | — | — | — | — |
| telegram-unblock-60s | v2 | 1 | 0 | 1 | 0 | INV-018 |
| zayavka-60s | — | — | — | — | — | — |
| zayavka-full | — | — | — | — | — | — |

## Tier 2 — drift metrics

| metric | golden | minimal-two-hander | neighbours-barrier | telegram-unblock-60s | zayavka-60s | zayavka-full |
|---|---|---|---|---|---|---|
| durationSeconds | 158.27 | — | — | 44.23 | — | — |
| lineCount | 24 | — | — | 6 | — | — |
| linesPerMinute | 9.1 | — | — | 8.1 | — | — |
| closeUpSceneRatio | 0.158 | — | — | 0.167 | — | — |
| splitSceneRatio | 0.737 | — | — | 0.5 | — | — |
| silentBeatCount | 1 | — | — | 1 | — | — |
| expressionReuseFactor | 2.538 | — | — | 1.5 | — | — |
| distinctExpressionsUsed | 13 | — | — | 6 | — | — |
| longestStaticRun | 2 | — | — | 1 | — | — |
| listenerChanges | 0 | — | — | 0 | — | — |
| distinctDevicesUsed | 12 | — | — | 7 | — | — |
| proposedDeviceCount | 0 | — | — | 0 | — | — |

## Tier 3 — judgement

Rubric scores go here (see `evals/RUBRIC.md`). Then your own verdict on the
rendered video, which outranks every number above.

## Corrections produced by this run

Every correction below must be triaged per `docs/CORRECTION_PROCESS.md` into exactly one of:
invariant (code) / heuristic (prompt + rubric) / device (catalog) / schema gap / taste (approval gate).

| observation | location | triage | artefact changed |
|---|---|---|---|
| Cast-panel intro renders without portraits because supplied slot names do not match the template contract | `t01.slots` | schema gap | none in this run |
| Fixed four-line deduction for a cast-title intro leaves a 60s brief at 44.23s | shared line-budget guidance | heuristic | none in this run |
| Script uses no character-specific public material and remains generic | Writer output | research/input hypothesis; attribution deferred | none in this run |
| Final punchline is not strong enough for release despite Reviewer `accept` | `b05`–`b06` | taste / human gate | none in this run |
| Editor made one rewrite and no cuts; Reviewer made no findings | role outputs | role value unproven | none in this run |
