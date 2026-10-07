# Stage artistic baseline: telegram-unblock-60s

Isolated evaluation for one Stage directing fixture. It does not change Interpret, Stage, the renderer, the provider, the schemas, or the retry policy. It does not read `.env.local` and it does not call a provider.

The historical harness under `evals/` is a different pipeline. Leave it untouched.

## Artifacts

- `fixture.json` — Stage input: one context item, 15 explicit utterances, and two source-authored actions, in source order. The object is `{ sourceItems }` only. It has no numeric offsets and no provider response.
- `target.json` — 17 semantic source frames. D01 and D06 each record two rendered display blocks. The rendered target is 19 frames. Stage is not required to emit 19 semantic frames.
- `rubric.md` — human 0–2 marks for focus, reactions, continuity, emphasis, the final joke, and restraint.
- `baseline-observation.md` — sanitized owner observation. No raw Stage JSON was retained, so none is stored here.
- `score.mjs` — scores one saved, schema-valid Stage response.

Dialogue wording comes from `evals/references/telegram-unblock-60s/human-reference.md`. The sealed draft leaves `Дмитрий Сергеевич ...` and `ДМИТРИЙ СЕРГЕЕВИЧ!!` unlabeled; this fixture gives both an explicit `Путин:` label because that is the submission that completed. `Подробности вам Дмитрий Сергеевич расскажет.` stays inside D01. D01 keeps the source spelling `телеграмм`. The storyboard display later uses `Telegram` for that sentence.

Joke-research parentheticals in the human reference are not source items here. A01 keeps the showing clause `(далее показывается спящий Песков.)`. A02 keeps its full parenthetical. The prototype viewer's `derived` flag on the shout is a staging note. D03 remains a source utterance.

## Score a saved candidate

From the repository root, with Node 24:

```sh
node app/storyboard-web/eval/stage-artistic/score.mjs path/to/candidate.json
```

The command prints a JSON report and exits 0 when the bundled fixture and the candidate are structurally usable. Exit 0 does not mean the directing matched the target. Artistic metrics use `"verdict": "not-a-pass-fail"`. A missing or duplicate source frame is reported under `sourceFidelity` and still exits 0.

The process exits 1 when the fixture, the target manifest, or the candidate structure is invalid. That includes a candidate that fails `specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json`. Paths named `.env` or `.env.*` are refused before they are read.

## What the report measures

For each of the 17 semantic source frames, the scorer reads `origin`, `sourceItemId`, `sourceRole`, and `layout`. A directing beat still counts as one frame. Its `segments` are not extra semantic frames and are not the overflow display blocks.

- Source-frame coverage, missing ids, duplicate ids, and unexpected source frames.
- Layout agreement out of 17.
- Deliberate-single agreement for D02, D03, D04, D11, D13, D14, and D15.
- Conversational-split agreement for D01, D05, D06, D07, D08, D09, D10, and D12.
- Single-layout agreement for A01 and A02.
- Context review coverage for C01.
- Derived-frame count.

`sourceFidelity.ok` means those account checks passed for this fixture. It is not `assessStage`, and it is not an artistic verdict. Layout disagreement leaves `sourceFidelity.ok` true when every source item is still accounted for once.

Panel descriptions, `speakerPanel`, participant choice, performance, and focus are not scored. The human rubric covers them. Participant names in `target.json` document the intended focus; the scorer does not search candidate prose for them.

## Boundaries

Exact agreement with this target is evidence about one dialogue. A uniform split can be schema-valid and source-faithful while scoring 0/7 on deliberate singles. A different board can be artistically strong when its reasons are as clear as the target's. Do not tune the Stage prompt from this comparison alone.

## Tests

```sh
node --test app/storyboard-web/test/**/*.test.mjs
node --test app/storyboard-web/eval/stage-artistic/test/score.test.mjs
```
