# Fact pack vs bounded Joke Webs

Prepared before inspecting any output from this experiment. This follows the stopped 6+6 Writer
baseline on `telegram-unblock-60s`. Its purpose is practical: determine whether a compact supplied
fact pack is enough for a usable Russian comedy scene, or whether a bounded Joke Webs-inspired
ideation pass produces a better script.

This is not a test of factual research, the full staged pipeline, or the exact causal contribution
of every part of Joke Webs.

## Frozen controls

- Model: `gpt-5.6-sol`.
- Reasoning effort: `high`.
- Every sample runs in a clean context with no previous outputs.
- No web search, retrieval, tools, Editor, Director, Reviewer, repair, validation, or rendering.
- Both arms receive the same `brief.json`, `fact-pack.v1.json`, scene contract, tone boundary,
  knowledge boundary, agency clarification, and output limits.
- The human reference and its derived joke connections remain hidden from generation.
- Do not edit prompts, brief, or fact pack after the first output is inspected.
- Do not stage or commit.

## Arms

### A — fact pack, direct script

`prompts/07-fact-rich-writer.md` plus the brief and fact pack. Output the script only.

### B — fact pack, bounded Joke Webs

`prompts/08-joke-web-writer.md` plus the identical brief and fact pack. Produce four bounded webs,
cross-web connections, selected comic moves, beats, and then a script under the same scene contract
as arm A.

The webs are an experimental scaffold inside one Writer call, not a new pipeline role.

## Joke Web bounds

There are exactly four webs: Putin, Peskov, Durov, and the situation.

For each web:

- choose no more than two seed nodes from its fact-pack group;
- create no more than three first-level associations per seed;
- deepen no more than one first-level association per seed;
- create no more than two second-level associations on that chosen branch;
- stop after level two and apply the result back to the character or situation;
- never exceed eight new association nodes in the web.

Across all webs, emit exactly four cross-web connections and select two to four comic moves. Do not
expand every branch. Stop earlier exploration once the required four viable connections exist.

## Fact-pack hygiene

- Facts are grouped by character or situation and shuffled within each group.
- Matching facts are not aligned, paired, cross-referenced, or placed under mirrored thematic
  headings.
- Owner-known punchlines and joins are absent. In particular, the pack contains the VK wall meme
  but does not mention the Berlin Wall.
- The pack includes plausible unused nodes so selection quality remains observable. They are not
  labelled as distractors in generation input.
- All items are supplied creative premises. Their external accuracy is not part of this test.

## Initial sample and stopping rule

Run four samples in interleaved order: A1, B1, A2, B2.

Extract the scripts, remove arm identity and ideation artifacts, randomise presentation, and review
blind. Stop after four samples if the two comparisons give the same clear winner and at least one
script is usable, or if both B samples reproduce the same known failure before a usable script
appears.

If the comparisons disagree or are too close, run A3 and B3 without changing anything, then stop.
The hard cap is six scripts. There is no best-of extension for only one arm during this comparison.

## Usability gates

A script is usable only if all of the following hold:

1. Agency is correct: the state owns lifting its restrictions; Durov's leverage is cooperation or
   refusal, not lifting the state's restriction himself.
2. Adjacent lines and actions form a causal exchange rather than a list of bits.
3. At least two lines or actions depend on the specific public personas in the scene.
4. The Russian sounds written in Russian rather than translated from English.
5. The scene contains two to four connected comic moves, progression or escalation, and a final
   move stronger than the preceding material.
6. At least one connection produces a recognisable comic effect rather than merely reciting a
   supplied fact.
7. No factual claim about a real person appears unless it is present in the brief or fact pack.

After the gates, record a forced preference and one deciding reason. Do not score by totals. Inspect
arm B's webs only after blind script preferences are fixed. Compare the preferred generated script
with the sealed human reference only afterward; resemblance earns no credit by itself.

## Interpretation

- A is usable and no worse than B: keep the fact-rich direct Writer; drop Joke Webs for now.
- B is usable and clearly preferred: retain the bounded ideation artifact inside an experimental
  Writer prompt; do not create a separate role.
- B finds useful connections but produces a weak script: freeze one connection and run a later,
  separate connection-to-scene test.
- B only restates the pack or returns to generic bureaucracy: this Joke Webs adaptation has not
  earned further complexity.
- Both scripts fail while B has useful connections: scene construction and dialogue are the next
  bottleneck.
- Both scripts fail and B has no useful connections: stop adding ideation machinery at this model
  and prompt level.

If the fact pack alone solves the writing problem, the next product question is how public-figure
and personally-known-character facts are elicited. The intended future UX keeps the internal web
hidden and asks the user a small number of high-value questions; that UX is out of scope here.
