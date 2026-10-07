# Contract: Stage input from a material state

Stage response JSON stays [the tracer stage schema](../../001-structure-storyboard-tracer/contracts/stage-response.schema.json). This feature does not add response properties, dialogue fields, or fit offsets.

`app/storyboard-web/prompts/stage.md` stays byte-identical. `app/storyboard-web/eval/stage-artistic/` stays untouched and is not executed. The artistic instructions are not rewritten.

## When Stage is called

The page calls `POST /api/storyboard-results`. The server loads the active material state. It does not accept a draft or a cast in that request body.

If any utterance in the linked interpretation has no speaker assignment in that material state, the server inserts a `blocked` result with `unresolved-speaker` on that material state and does not call the provider.

Otherwise it calls the existing Stage function once, with `response_format.type` `json_object`, through the unchanged provider adapter.

## User message

The persistent path sends:

```json
{
  "sourceItems": [],
  "cast": {
    "characters": [{ "id": "uuid", "name": "Песков" }],
    "aliases": [{ "surface": "Дмитрий Сергеевич", "characterId": "uuid" }],
    "speakers": [{ "sourceItemId": "model-id", "characterId": "uuid" }]
  }
}
```

`sourceItems` keeps the tracer’s model fields: `id`, `kind`, `segmentIds`, `speakerStatus`, `sourceQuote`, `text`, and `speakerLabel` when present. `text` is the spoken text derived on the server. It is not a license to rewrite the line.

`cast` is added only by the persistent path. `requestStageCandidate` omits `cast` when the caller does not pass one. The one-shot tracer and the artistic runner therefore keep the user message `{ "sourceItems": [...] }`.

`aliases[].surface` is the confirmed surface text. For the acceptance example it is `Дмитрий Сергеевич` and `characterId` refers to the character named `Песков`. The server copies those values from the material state. Stage is not asked to discover the link.

`speakers` lists only assigned utterances. An unassigned utterance never reaches this payload, because staging already returned `unresolved-speaker`.

## What Stage must not become

The cast is identity input. It does not replace spoken words. The server still rebuilds every displayed dialogue string from the Source Revision and the display-block offsets. A panel description that ignores `Песков`, or that uses an awkward composition, can still be a ready storyboard when source fidelity passes. This feature does not score that description and does not change the Stage prompt to demand a layout.

## Result binding

The inserted `storyboard_result.material_state_id` is the id captured before the provider call. The row’s `status` is `checked`, `blocked`, or `failed`. The page computes `ready` later, and only for the active material state, using the existing overflow compiler and `FrameRenderer`.
