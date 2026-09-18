# Turning corrections into rules

You are about to generate a second video, notice things that are wrong, and fix them. The value of
that work is not the fixed video — it is the rules you extract. This document is how a correction
becomes a permanent part of the system instead of a note you forget.

The loop has three steps: **observe, triage, install.**

## 1. Observe

Write every correction in the same shape, whether it came from you, from the Reviewer role, from the
validator, or later from a user:

```
location:            d07 panels[1]
observation:         Вероника держит поднятый палец, пока говорит Антон
consequence:         выглядит как будто она перебивает; зритель не понимает, кто говорит
minimum correction:  использовать нейтральный портрет в слушающем слоте
```

The `consequence` field is the one people skip and the one that matters. It is what separates "I
would have done it differently" from a defect, and later it is what tells you whether the rule is
worth its cost.

## 2. Triage into exactly one bucket

This is the whole discipline. Each bucket has a different enforcer, and a rule in the wrong bucket
either never fires or wastes prompt budget forever.

**Invariant — mechanically checkable.** Goes into `catalog/invariants.json` and into
`tools/validate.mjs` as code. Highest value: costs nothing per run, never forgotten, never argued
with. *Test: could a script decide this by reading the JSON, with no taste involved?*
Example: a listener holding an active gesture.

**Heuristic — needs judgement.** Goes into the owning role's prompt as one line, and into
`evals/RUBRIC.md` as a scored item. *Test: would two reasonable people agree on the verdict but not
on a formula?* Example: a tautological line.

**Device — missing vocabulary.** The output was not wrong, it was impoverished; the model lacked a
technique. Goes into `catalog/devices.json` with an id, an intent, a `useWhen`, an `avoidWhen`, and
its schema expression. *Test: is this a thing you want done more often, rather than a thing done
wrong?* Example: an all-cast reaction split.

**Schema gap — inexpressible.** The correct output cannot be represented at all. Goes into
`schema/storyboard.schema.json`, then the renderer, then the Director prompt — in that order.
*Test: could the Director have produced the right thing with the fields it has?* Example: a fullscreen
text interstitial before `textCard` scenes existed.

**Taste — irreducibly subjective.** Stays a human approval-gate item and is explicitly **not**
automated. Record it so that nobody tries later. *Test: is the oracle a person's feeling?* Example:
whether a likeness is flattering enough to show the depicted person.

## 3. Install, and prove it fires

**An invariant ships with a failing fixture first.** Take the actual bad output that prompted the
correction, freeze it under `evals/fixtures/`, write the rule, and confirm it flags that file. A rule
never observed to fire is indistinguishable from a rule that does not work. `evals/fixtures/broken-storyboard.json`
exists for exactly this purpose and currently proves INV-005, INV-007, INV-012, and INV-017.

**A heuristic ships with a rubric item**, so you can tell later whether adding the line to the prompt
actually changed anything.

**A device ships with an `avoidWhen`.** A device without one becomes a tic: the model will use it
everywhere because you told it the technique exists and never told it when to stop. Every overuse
problem in the reference production — constant close-ups, restless expression changes — is this
failure.

## The rule that keeps this from collapsing

**Role prompts have a hard budget of 60 lines of rules.** When a prompt exceeds it, you may not just
add. You must either:

- **promote** a heuristic to an invariant, moving it out of the prompt into code; or
- **retire** a rule that has not fired in the last N runs; or
- **merge** two rules that are really one.

Prompt bloat is the main failure mode of this whole approach. A 400-line prompt contains rules that
contradict each other, and the model quietly ignores half of them — including, unpredictably, the
ones you care about. A validator has no such limit, which is the real argument for pushing every
mechanically checkable rule into code: it is not just cheaper, it is the only place rules accumulate
without degrading each other.

## Ordering that saves the most work

Fix the artefact that **owns** the error, then reconcile downstream. A wrong expression choice is a
Director error, not an image error. A tautological line is a Writer or Editor error, not a Director
error. Repairing downstream of the real owner produces a video that works once and a system that has
learned nothing.

And validate the storyboard while it is still text. Every layout, rhythm, listener-state, and timing
correction is visible in a proxy render built from placeholder assets, at zero image cost. Only
likeness and style genuinely require generated images — which is why the placeholder path exists in
the schema and why the whole pipeline can be tuned before any GPU is available.
