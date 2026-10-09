# comics-pipeline

Server-side half of the video-comic generator: the schema, the role prompts, the rule validator, and
the eval harness. The core pipeline remains data-first. The `storyboard-web` product spike also
contains an opt-in visual workflow that calls the configured image provider only after a user
selects an identity photo and starts a generation.

## Visual storyboard workflow spike

The local `storyboard-web` path now exercises the workflow from raw dialogue to a visual storyboard
ready for video: Interpret and Stage, free-form structural edits with undo, local identity photos,
iterative base anchors, one-frame-at-a-time generation, per-panel revisions and performance
references, placement-only zoom, and final visual approval. It deliberately has no generate-all
action.

Set `DATABASE_URL`, `BASE_URL`, and `CONTEST_API_TOKEN` as for the existing application. Text calls
use `CONTEST_MODEL`; image calls default to `gemini-3-pro-image-preview` and can be overridden with
`IMAGE_MODEL`. `IMAGE_TIMEOUT_MS` controls the image request timeout.

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
**pixel-identically at 15 sampled frames** (`mse_avg 0.00`), and the converted storyboard totals
**4748 frames** — the exact frame count of the shipped video.

That is sampled parity, not full-frame parity: 15 of 4748 frames were compared. Nothing here
establishes that the remaining frames match, and no claim that the format "loses nothing" is
supported by this evidence. Full-frame comparison is the check that would earn that phrasing.

## Layout

```
schema/          storyboard.schema.json (the contract), brief.schema.json (the input)
catalog/         devices.json, invariants.json, style-presets.json
prompts/         00-shared-context + one file per role
tools/           build-golden, validate, metrics, mutations, run, parity.sh
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

Expected: `4748 frames`, then `0 error(s), 0 warning(s), 0 diagnostic(s)`.

Prove the validator actually fires:

```sh
npm run mutations     # break one thing per rule; expect 26/26 rules proved to fire
```

`tools/mutations.mjs` holds a flat table of `rule -> mutation -> expected finding id`. Each row
mutates a clean golden in one way and asserts the rule fires. Zero findings on the golden only
shows the rule set accepts one artefact; this is what shows each rule works.

The frozen known-bad fixture covers the same ground for five rules with real observed output:

```sh
node tools/validate.mjs evals/fixtures/broken-storyboard.json   # expect 4 errors, 0 warnings, 2 diagnostics
```

It fires INV-005, INV-006, INV-009, INV-012 and INV-017. (Earlier notes claimed INV-007; that was
never true of this fixture — INV-007 has no violation in it, and the mutation table is where that
rule's coverage actually comes from.)

## Running the pipeline by hand

Four roles, in order, each in its own chat. Separate chats are not ceremony: in one chat the model
becomes attached to its own script and will not cut it, storyboard reasoning bleeds into the writing,
and — decisively — you cannot tell which stage caused a bad result, so you cannot tell which prompt to
fix.

```sh
export PIPELINE_MODEL="whatever you are using"
node tools/run.mjs new "writer-v1"
```

`PIPELINE_MODEL` is required — `run.mjs new` refuses to create a run that does not record which
model produced it, because every comparison in the eval is between runs. Each run folder also gets
a copy of the prompts, catalog and schema it used under `inputs/`, not just their hashes: a hash
tells you two runs differ, the copy tells you how, after you have since edited the prompt.

Then per case, for each role: paste `prompts/00-shared-context.md` + the role prompt + the inputs,
and file the JSON reply with `run.mjs stage`, which writes the next version and never overwrites
the previous one.

| step | prompt | inputs | file as |
|---|---|---|---|
| 1 | `01-writer.md` | brief | `01-script` |
| 2 | `02-editor.md` | brief + script | `02-script-edited` |
| 3 | `03-director.md` | brief + edited script + `catalog/devices.json` + style preset | `03-storyboard` → `.v1.json` |
| 4 | — | run `validate.mjs` | `validator.v1.json` |
| 5 | `03-director.md` | storyboard + validator findings, repair only what was flagged | `03-storyboard` → `.v2.json` |
| 6 | `04-reviewer.md` | brief + script + storyboard + validator report | `04-review` |
| 7 | `03-director.md` | review findings, if verdict is `repair` | `03-storyboard` → `.v3.json` |

A repair is not a new artefact, it is the next version of the artefact it repairs. Nothing is
overwritten, so the pre-repair state — which is what the experiment measures — survives.

```sh
R=evals/runs/<runId>/<case>
node tools/run.mjs stage evals/runs/<runId> <case> 03-storyboard <file>
node tools/validate.mjs $R/03-storyboard.v1.json --brief evals/cases/<case>/brief.json --json $R/validator.v1.json
node tools/metrics.mjs  $R/03-storyboard.v1.json --json $R/metrics.v1.json
node tools/metrics.mjs  $R/03-storyboard.v1.json --compare golden/zayavka-full/metrics.json
node tools/run.mjs summarize evals/runs/<runId>
```

`summarize` reports the highest version it finds and derives repair turns from how many storyboard
versions exist, so a heavily repaired run cannot be mistaken for a clean one.

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
- **heuristics** — one line in a role prompt plus a rubric item. A 60-line prompt budget is the
  *guideline*: nothing enforces it, and the existing prompts already exceed it (the Director is 136
  lines). Treat it as a prompt-bloat warning sign that should prompt a promote/retire/merge pass, not
  as a limit that has been held.
- **taste** — human approval gates. Deliberately not automated.

Rules the validator enforces are **not** repeated in prompts. That is the mechanism that stops
prompts from growing into 400 lines of mutually contradictory advice that the model half-ignores.

Within the validator, every rule carries a `provenance` label saying where its authority comes
from, and the label decides how the finding is counted:

| provenance | counted as | meaning |
|---|---|---|
| `structural` | defect | mechanically necessary given the schema, renderer, or sheet contract |
| `brief-derived` | defect | computable from the brief; may become a hard check |
| `style-preset preference` | diagnostic | a property of one visual language; threshold lives in `catalog/style-presets.json`, keyed by preset |
| `single-sample prior` | diagnostic | derived from one video; frozen until 5+ videos are accepted |
| `arbitrary initial threshold` | diagnostic | nobody validated the number |

Diagnostics are printed and written to the JSON output but excluded from the error and warning
counts. A run is not broken because it disagrees with a preference derived from `n=1`, and these
are the metrics §9 of the handoff marks as gameable: report them, never optimise them.

Preset-keyed thresholds are never substituted across presets. A storyboard naming a preset with no
`thresholds` block gets those rules reported as `SKIPPED`, so absent coverage cannot read as a
clean result.

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
