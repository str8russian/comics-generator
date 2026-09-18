# Tier-3 rubric

Scored by an LLM judge on a sample of runs, or by you when you disagree with the judge.
Do not run this on every change — tiers 1 and 2 catch most regressions for free.

Each item is scored **0, 1, or 2** and **every score requires a one-line justification naming a
location**. A score without a location is discarded, because it cannot be acted on and cannot be
argued with.

| score | meaning |
|---|---|
| 0 | fails clearly and a viewer would notice |
| 1 | partially works, or works with one exception |
| 2 | works throughout |

## Items

**R1 — Expression fit.** Each panel's expression matches its line's emotion in valence, intensity,
and direction. Not merely permitted by the sheet — correct.

**R2 — Listener behaviour.** Listeners are attentive and stable. No active gesture while another
character talks. Listener changes happen only where something dramatic justifies them.

**R3 — Motivated change.** Every expression, layout, and shot change has a reason a viewer could
feel. Nothing changes as a side effect.

**R4 — Pair composition.** In split layouts, the two portraits work together, not just individually.
No two identical head tilts pointing the same way.

**R5 — Framing discipline.** Close-ups mark turning points and nothing else. The video is not shot
entirely in one size.

**R6 — Dialogue quality.** No tautology, no restatement, no exposition a real person would not speak.
Lines are speakable and short enough to read.

**R7 — Voice differentiation.** Characters could not swap lines unnoticed.

**R8 — Rhythm.** Line lengths vary. Pauses land where the audience needs them. The list-of-three, if
present, escalates.

**R9 — Landing.** There is a silent beat after the punchline, and the last scene feels like an ending
rather than a stop.

**R10 — Device selection.** Devices are varied, motivated, and each one respects its `avoidWhen`. A
device whose `useWhen` obviously applied and was not used counts against this item.

**R11 — Fact fidelity.** Everything in `requiredFacts` is present and uncontradicted; every
`mustIncludeLines` string is verbatim.

**R12 — Asset economy.** The expression sheet is the minimum the script needs. Reuse factor is
healthy. No entry exists that appears once for no reason.

## Reporting

```json
{
  "runId": "…", "caseId": "…",
  "scores": [ { "item": "R1", "score": 1, "location": "d07 panels[1]", "justification": "…" } ],
  "total": 19,
  "worstItems": ["R3", "R8"]
}
```

Total is out of 24. Track the total across runs, but act on `worstItems` — the total tells you
whether you are moving, the items tell you what to edit.

## What is deliberately not here

Likeness, respectfulness of the depiction, and whether the video is funny. Those are human approval
gates. A judge that scores them produces a number that feels like evidence and is not.
