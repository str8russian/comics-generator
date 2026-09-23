# Fact-rich bounded Joke Webs Writer — arm B

Write one short Russian-language comedic scene from the supplied brief and fact pack. Before the
scene, create a compact Joke Webs-inspired ideation artifact using the exact bounds below.

## Shared scene contract

- The meeting and all dialogue are fictional.
- The Russian state imposed the restrictions and owns the decision to lift them. Durov cannot lift
  the state's restriction himself; his leverage is cooperation, conditions, or refusal.
- Write idiomatic spoken Russian directly. Do not compose in English and translate.
- Any factual claim about a real person must be present in the brief or fact pack. Do not browse,
  research, or add biographical claims from memory.
- For this experiment, every fact-pack item is an accepted creative premise and does not need
  verification. The brief's warning about unsupported claims means that you must not add claims
  outside the supplied brief and fact pack.
- You may freely invent linguistic associations, comparisons, exaggerations, hypothetical actions,
  fictional dialogue, and visual comedy.
- Adult political satire is allowed, including toilet humour, mild fictional aggression,
  irreverence, and uncomfortable public-image jokes. Do not become naturalistic, graphically
  violent, or gratuitously cruel.
- Target public conduct and public personas, not immutable traits or private speculation.
- Create one causally coherent negotiation scene with two to four connected comedic moves,
  progression or escalation, and a final move stronger than the preceding material.
- You do not have to use every supplied fact. Do not explain references to the viewer if the joke
  works by letting the viewer connect them.
- Use at most 14 dialogue items and at most 4 short visual-action items. A shorter scene is welcome
  if it feels complete.

## Bounded Joke Webs procedure

Build exactly four Russian-language webs: `putin`, `peskov`, `durov`, and `situation`.

For each web:

1. Choose no more than two seed node ids from the corresponding fact-pack group.
2. Temporarily take each seed away from the meeting and its original context.
3. Generate one to three short first-level associations. Associations may use meanings, word
   splitting, substitutions, sound-alikes, idioms, clichés, opposites, behaviour, biography already
   present in the pack, public images, history already present in the pack, status, analogy,
   comparison, or exaggeration.
4. Choose no more than one first-level association per seed for deeper exploration.
5. Generate no more than two second-level associations on that chosen branch.
6. Stop at level two. Apply the useful result back to the character or situation. Do not recurse
   further and do not expand every branch.
7. Never create more than eight new association nodes in one web. This global per-web cap overrides
   all per-seed maxima above. Stop exploring once four viable cross-web connections have been found.

Then produce exactly four `connections`. Every connection must cite nodes from at least two
different webs and state a possible comic use. Select two to four of those connections as ordered
comic `moves`, then create five to eight short `beats` leading to the final scene.

The method is:

`supplied node -> remove from context -> new association -> apply back across webs and to the scene`

Do not copy the fact pack into the webs, write an essay, score your own ideas, explain your private
reasoning, or add facts about the real people.

Return exactly one JSON object and no Markdown or commentary:

```json
{
  "artifact": "writer-fact-joke-web",
  "version": 1,
  "ideation": {
    "webs": {
      "putin": [
        {
          "seedId": "a putin fact-pack node id",
          "level1": [{ "id": "p1a1", "text": "не более 8 слов" }],
          "level2": [{ "id": "p1b1", "parentId": "p1a1", "text": "не более 8 слов" }],
          "reapplication": "не более 20 слов"
        }
      ],
      "peskov": [],
      "durov": [],
      "situation": []
    },
    "connections": [
      {
        "id": "c1",
        "nodeIds": ["node from one web", "node from another web"],
        "comicUse": "не более 20 слов"
      }
    ],
    "moves": [
      {
        "id": "m1",
        "connectionIds": ["c1"],
        "text": "не более 25 слов"
      }
    ],
    "beats": [
      {
        "id": "b1",
        "serves": "setup|turn|payoff|m1|m2|m3|m4",
        "text": "не более 20 слов"
      }
    ]
  },
  "script": {
    "title": "…",
    "items": [
      { "type": "dialogue", "speakerId": "putin|peskov|durov", "text": "…" },
      { "type": "action", "text": "…" }
    ]
  }
}
```

All four web arrays must be non-empty. Emit exactly four connections, two to four moves, and five
to eight beats. The brief and fact pack are supplied separately as `brief.json` and
`fact-pack.v1.json`.
