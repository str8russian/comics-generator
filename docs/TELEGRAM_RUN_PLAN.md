# Telegram 60s run plan

Created 2026-09-22 before any role output. This file records the product owner's decision to use the
new `telegram-unblock-60s` case for the next pipeline exercise. It does not delete or reinterpret the
older `zayavka-60s` case in `HANDOFF.md`.

## Purpose

Test whether the existing pipeline can independently turn a realistic one-line situation into a
usable one-minute satirical video-comic. A separately sealed human draft exists for diagnosis, but
it is not generation input.

## Controls

- Use the same recorded model and reasoning effort for all generative roles.
- Give every role only the inputs declared in its checked-in prompt.
- Do not give any role the files under `evals/references/telegram-unblock-60s/`.
- Do not add web research or a fact pack to the first staged run.
- Do not tune role prompts between stages or repair turns.
- Use clean agent context for Writer, Editor, Director and Reviewer.
- Preserve every output using `tools/run.mjs stage`; never overwrite.
- Cap repair at two total storyboard repair turns.
- Do not stage or commit.

## Order

1. Validate the new brief.
2. Draft and seal the single-shot baseline prompt before inspecting staged output.
3. Scaffold one recorded run.
4. Writer -> Editor -> Director.
5. Validate and compute metrics; allow a targeted Director repair if required.
6. Reviewer; allow a targeted Director repair if its verdict is `repair`.
7. Render the placeholder version and inspect it.
8. Compare Writer/Editor output and final storyboard against the sealed human reference using the
   pre-written comparison criteria.
9. Triage corrections per `docs/CORRECTION_PROCESS.md` and stop. Do not tune prompts in this run.

## Interpretation

- Missing useful factual material is evidence for testing a pre-Writer research stage later, not
  permission to add one mid-run.
- Facts were available but not converted into structure or jokes: Writer problem.
- Good script, weak visual staging: Director problem.
- Editor only paraphrases or removes working material: Editor value is unproven.
- Reviewer mostly duplicates validator findings: Reviewer value is unproven.
