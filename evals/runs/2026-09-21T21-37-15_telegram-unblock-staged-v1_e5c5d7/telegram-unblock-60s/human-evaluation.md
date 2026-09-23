# Human evaluation — telegram-unblock-60s

Evaluation performed only after Writer, Editor, Director, validator repair, Reviewer and placeholder
rendering were complete. The sealed human reference was not available to any generation role.

## Outcome

The staged result is mechanically renderable after one repair, but it is not a usable creative
result. The human reference wins decisively. The generated script breaks conversational causality at
the answer to Durov's question; the following inference exists in the `intent` metadata but is not
communicated by the spoken lines. It also does not exploit the three public personas, does not
escalate, and contains no essential visual joke. The result could be rewritten for almost any
official, spokesperson and technology founder without materially changing it.

The machine Reviewer returned `accept`. That verdict means only that it found no remaining issue
inside its deliberately narrow remit. It explicitly deferred whether the punchline is funny, and it
did not have enough template-contract information to detect the broken intro before rendering.

## Pre-written criteria

| criterion | staged result | judgement |
|---|---|---|
| Complete setup, development and landing within the duration ceiling | 44.23s is acceptable in itself, but the dialogue does not establish its intended procedural loop | fail on development, not duration |
| Distinct function and voice for all three characters | Putin and Durov are legible; Peskov is a generic bureaucrat | partial |
| Serious opening that escalates | Serious opening, but no escalation: the exchange moves directly to one generic contradiction | fail |
| Economical, recognisable real-world material | Uses only the premise that Telegram is restricted; no character-specific public material | fail creatively, safe factually |
| Audience connects two facts | “Officially press the unofficial button” is self-contained wordplay, not a connection between facts | fail |
| Essential visual joke | None; the final close silent reaction is punctuation, not a visual premise | fail |
| Final beat stronger than preceding beats | It is the only joke and does end the exchange, but is not a strong payoff | weak / partial |
| No dossier required | Yes | pass |
| Targets public conduct/persona | Yes; it is generic and non-invasive | pass |
| A different solution may beat the reference | Allowed, but this solution does not | fail on quality, not similarity |

## What the human reference demonstrates

The reference uses several independent public associations as an escalating chain rather than as a
list: Peskov's apparent dozing becomes a visual interruption; his WhatsApp line compounds the
mistake; a known Putin remark functions as an economical response; Durov's expected concessions
build a false direction; the shirtless-photo overlap creates an inference for the audience; and the
VK-wall setup is redirected to the Berlin Wall for the final beat. Whether every individual joke is
kept is a taste question, but the structural advantage is clear: character-specific material creates
causality, escalation and multiple joke mechanisms.

## Render inspection

The `cast-panel-strip` intro is broken in the rendered video. The storyboard supplies
`putinPortrait`, `peskovPortrait` and `durovPortrait`, while the renderer template requires the
array slots `portraits` and `names`. The first 12 seconds therefore show the heading without the
cast panels. The schema permits arbitrary template slots, the Director was not given a template
registry, and neither the validator nor Reviewer could prove that the required slots were present.

The remaining placeholder render is readable and the dialogue timing works, but the long empty
intro makes the already short piece feel more underfilled.

## Triage

1. **Schema gap:** template-specific required slots are absent from the storyboard contract supplied
   to the Director. The three unused `*.title-portrait` entries and the empty intro were two symptoms
   of this same gap: the renderer expected a `portraits` array of expression-entry ids, while the
   Director invented per-character inline slot names. The repair deleted the referenced-capable
   entries but left three ignored inline assets, clearing the rule without fixing the render or image
   cost. Make the template registry machine-readable to generation and validation; do not treat this
   as a one-off Director typo.
2. **Heuristic:** short duration is not a defect; the target is a ceiling. The relevant issue is that
   the universal four-line intro deduction yielded five spoken lines plus one silent beat and charged
   more dialogue capacity than the 12-second intro used. Revisit the accounting only after the
   writing baseline is established.
3. **Input/research hypothesis (no artifact changed yet):** without supplied facts or a bounded
   research stage, Writer fell back to generic bureaucracy. The next controlled test should keep the
   prompts unchanged and add a concise, sourced comedy-material packet to the brief/input. If Writer
   still fails to convert that material into setup, escalation and payoff, the deficiency can then be
   attributed to the Writer prompt.
4. **Taste / human gate:** the final punchline is too weak for release even though Reviewer accepted
   it. Funny remains a human approval decision in the current architecture.
5. **Role-value evidence:** Editor made one rewrite and no cuts; the rewrite removed the remaining
   grammatical tether to Durov's question and was not useful. Reviewer produced no actionable
   findings despite the visible non-sequitur. One run is insufficient to rule out redesigned roles,
   but neither current role has justified its cost.

No role prompt, schema, validator or catalog was changed in response to this run.
