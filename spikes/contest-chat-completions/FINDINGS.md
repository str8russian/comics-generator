# Contest API compatibility findings

Live run: 2026-10-06. Model: `gpt-5.5`. Ten sequential `POST /v1/chat/completions` requests, with no retries. This is an observation record for later planning, not an application architecture decision.

The provider host, credentials, response message content, and the raw capability report are not stored here.

## Capability matrix

| Capability | Result | What was observed |
|---|---|---|
| Minimal Chat Completions | SUPPORTED | HTTP 200, `finish_reason=stop`, usage present |
| `reasoning_effort=low` | INCONCLUSIVE | HTTP 200; parameter accepted; effective application not observable |
| `reasoning_effort=medium` | INCONCLUSIVE | HTTP 200; parameter accepted; effective application not observable |
| `max_tokens` | SUPPORTED | Accepted, and the probe limit was observed (`finish_reason=length`) |
| `max_completion_tokens` | SUPPORTED | Accepted, and the probe limit was observed (`finish_reason=length`) |
| Small `json_object` | SUPPORTED | HTTP 200 and a parsed JSON object |
| Small `json_schema` | SUPPORTED | HTTP 200 and an object that conformed to the small requested schema |
| Invalid request body | SUPPORTED | HTTP 400 from an invalid body, using a valid token |
| Response metadata | SUPPORTED | HTTP status, content type, `finish_reason`, and usage were present on a success |
| Full Structure fixture | INCONCLUSIVE | See the two full-payload attempts below |

Prefer `max_completion_tokens` when an explicit output limit is needed. Both limit fields were accepted and observed on the small probes.

## Full Structure fixture

The representative fixture was 32,664 bytes and 19,498 characters, with 19 frames. Both full-payload attempts used a verified `max_completion_tokens` value of 20,010.

The large strict `json_schema` attempt returned HTTP 400. It produced no completion, no usage data, and no parsed document. Small-schema compatibility remains supported. Large strict-schema compatibility was not observed. This does not make `json_schema` unsupported for small responses.

The `json_object` fallback returned HTTP 200, `finish_reason=stop`, and usage data. The document parsed, passed the local probe schema, and contained 19 frames. It was 32,479 bytes and 19,398 characters. It was not truncated. It was not an exact semantic match to the requested fixture; the difference was about 100 characters.

## Transport capacity and source fidelity

Transport capacity and source fidelity are different results. The endpoint returned one complete, locally schema-valid, non-truncated 19-frame document in a single `json_object` completion. That shows a payload of this size can come back without chunking. The same document was not faithful to the requested fixture. A schema-valid model response is therefore not evidence that dialogue or structure was preserved.

Chunking is neither required nor justified by this evidence. The strict request failed before a completion, and the fallback finished with `finish_reason=stop`.

## Provisional recommendation

Use one `json_object` response for a full Structure storyboard, then apply deterministic local checks before anything is shown as ready:

- local schema validation;
- deterministic source-fidelity validation.

Do not assume chunking. Do not treat model-emitted dialogue as authoritative because it is schema-valid. Exact dialogue must be reconstructed from source-owned text or source references.

## Unresolved

Whether `reasoning_effort=low` or `reasoning_effort=medium` actually changes model behavior is unresolved. Both values were accepted. The responses did not echo the requested level, so effective application was not observable.
