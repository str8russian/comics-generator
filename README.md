# comics-pipeline

Server-side half of the video-comic generator: the schema, the role prompts, the rule validator, and
the eval harness. No image generation here — assets are described placeholders until the compute
resource is known, which is deliberate and is what lets everything else be built and tuned now.

## The one structural decision

**The pipeline emits JSON, not TSX.** A thin data-driven Remotion component renders that JSON. The
visual output is unchanged; what changes is that the output becomes checkable.

This matters more than it sounds:

- A rule engine can enforce 25 invariants on JSON. It can enforce none on TSX source.
- Runs can be diffed against each other and against a golden. TSX diffs are noise.
- An LLM emitting JSON can be schema-validated and repaired. An LLM emitting TSX produces syntax
  errors and hallucinated imports that you find at render time.
- Replacing Remotion with the Swift/AVFoundation renderer becomes a renderer swap with a frame-exact
  oracle, instead of a rewrite with nothing to check against.

Verified: the JSON-driven renderer reproduces the hand-authored `zayavka-v1` composition
**pixel-identically** at 15 sampled frames, and the converted storyboard totals **4748 frames** —
the exact frame count of the shipped video. The format loses nothing.

## Layout

```
schema/          storyboard.schema.json (the contract), brief.schema.json (the input)
catalog/         devices.json, invariants.json, style-presets.json
prompts/         00-shared-context + one file per role
tools/           build-golden, validate, metrics, run, parity.sh
golden/          zayavka-v1 converted to JSON, plus its metrics baseline
renderer-remotion/  data-driven renderer + intro template registry
evals/           cases (briefs), fixtures (known-bad), runs (never overwritten), RUBRIC.md
docs/            CORRECTION_PROCESS.md — how a correction becomes a rule
```

## Setup

```sh
npm install
npm run check     # rebuild golden, validate it, print its metrics
```

Expected: `4748 frames`, then `0 error(s), 0 warning(s)`.

Prove the validator actually fires:

```sh
node tools/validate.mjs evals/fixtures/broken-storyboard.json   # expect 4 errors, 2 warnings
```

## Running the pipeline by hand

Four roles, in order, each in its own chat. Separate chats are not ceremony: in one chat the model
becomes attached to its own script and will not cut it, storyboard reasoning bleeds into the writing,
and — decisively — you cannot tell which stage caused a bad result, so you cannot tell which prompt to
fix.

```sh
export PIPELINE_MODEL="whatever you are using"
node tools/run.mjs new "writer-v1"
```

Then per case, for each role: paste `prompts/00-shared-context.md` + the role prompt + the inputs,
and save the JSON reply into the run folder.

| step | prompt | inputs | save as |
|---|---|---|---|
| 1 | `01-writer.md` | brief | `01-script.json` |
| 2 | `02-editor.md` | brief + script | `02-script-edited.json` |
| 3 | `03-director.md` | brief + edited script + `catalog/devices.json` + style preset | `03-storyboard.json` |
| 4 | — | run `validate.mjs` | `validator.json` |
| 5 | `03-director.md` | storyboard + validator findings, repair only what was flagged | `03-storyboard.json` (v2) |
| 6 | `04-reviewer.md` | brief + script + storyboard + validator report | `04-review.json` |
| 7 | `03-director.md` | review findings, if verdict is `repair` | `05-storyboard-repaired.json` |

Then:

```sh
R=evals/runs/<runId>/<case>
node tools/validate.mjs $R/03-storyboard.json --brief evals/cases/<case>/brief.json --json $R/validator.json
node tools/metrics.mjs  $R/03-storyboard.json --json $R/metrics.json
node tools/metrics.mjs  $R/03-storyboard.json --compare golden/zayavka-full/metrics.json
node tools/run.mjs summarize evals/runs/<runId>
```

Cap the repair loops at two per stage. A loop that will not converge is a prompt problem or a brief
problem, and another turn will not find it.

## Rendering

Copy `renderer-remotion/{types.ts,Storyboard.tsx,templates.tsx}` into a Remotion project's `src/sb/`,
import the storyboard JSON, and register a `<Composition>` with
`durationInFrames={sb.project.totalDurationFrames}`. The renderer computes no timing of its own; if a
duration is wrong, the storyboard is wrong.

Frame parity against a reference composition:

```sh
tools/parity.sh <remotion-project-dir> FullVideo SBGolden
```

## The three kinds of rule

Enforcement is split on purpose, and `docs/CORRECTION_PROCESS.md` is how a new correction gets
routed:

- **invariants** — code, in `tools/validate.mjs`. Free per run, never forgotten.
- **heuristics** — one line in a role prompt plus a rubric item. Subject to a 60-line prompt budget.
- **taste** — human approval gates. Deliberately not automated.

Rules the validator enforces are **not** repeated in prompts. That is the mechanism that stops
prompts from growing into 400 lines of mutually contradictory advice that the model half-ignores.

## Eval cases

| case | purpose |
|---|---|
| `zayavka-full` | regression anchor. A human-made golden output exists for this exact brief |
| `zayavka-60s` | the next video. Same cast, one third the length, `cast-panel-strip` intro to buy back runtime |
| `neighbours-barrier` | generalisation: three characters, no overlap with the known story |
| `minimal-two-hander` | degenerate input: two names and nothing else. Tests the safe-default path |

## Deliberately not here

Image generation, model selection, LoRA/adapter plumbing, Android and Windows renderers, audio.
Audio is out of scope for the product entirely. Style presets describe visuals by attribute and never
by franchise name — hosted image APIs degrade on named-IP prompts, and a preset named after someone
else's property is a liability in a shipping product.
