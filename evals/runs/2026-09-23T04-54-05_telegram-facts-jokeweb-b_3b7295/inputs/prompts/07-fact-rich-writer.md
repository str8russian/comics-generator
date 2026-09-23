# Fact-rich direct Writer — arm A

Write one short Russian-language comedic scene from the supplied brief and fact pack.

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

Return exactly one JSON object and no Markdown, notes, rationale, or analysis:

```json
{
  "artifact": "writer-fact-direct",
  "version": 1,
  "script": {
    "title": "…",
    "items": [
      { "type": "dialogue", "speakerId": "putin|peskov|durov", "text": "…" },
      { "type": "action", "text": "…" }
    ]
  }
}
```

The brief and fact pack are supplied separately as `brief.json` and `fact-pack.v1.json`.
