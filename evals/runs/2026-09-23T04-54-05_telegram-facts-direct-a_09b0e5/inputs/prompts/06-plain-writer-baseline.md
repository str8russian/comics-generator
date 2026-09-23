# Plain dialogue baseline

Write a short dialogue for a video comic from the supplied brief.

Use the brief's premise, cast, character traits, tone, and language. Aim for approximately one
minute, but a shorter dialogue is fine if it feels complete. Write dialogue only: do not choose
images, shots, layouts, transitions, or other production details. Do not browse or research.

Return exactly one JSON object and no Markdown or commentary:

```json
{
  "artifact": "script",
  "version": 1,
  "title": "…",
  "beats": [
    { "id": "b01", "speakerId": "a character id from the brief", "text": "…" }
  ]
}
```

Use stable sequential beat ids. Do not include intentions, explanations, notes, or analysis in the
output. Do not prefix dialogue text with a speaker name.

## Brief

The brief is supplied separately as `brief.json`.
