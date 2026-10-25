# Durable image-generation trace

## Status

Stage 1 contract for Feature 021. Stage 1 acceptance is not Feature 021 completion and does not claim owner acceptance. The feature is complete only after Stage 1 and Stage 2 checkpoints are both accepted.

Accepted decisions: `DEC-075`, `DEC-076`, `DEC-077`. The feature gate is explicitly invoked.

## Accepted full-feature outcome

One behavior-neutral, database-backed evidence chain for every production image-provider attempt while trace storage is available:

`initiating action and immutable source state → exact provider request → provider outcome → read-only inspection`

The chain must let a later R2 diagnostic determine what was sent without reconstructing the effective request from Git history. It covers direct panel generation, each provider attempt inside frame generation, and every current reachable anchor-generation path. Anchor coverage is Stage 2. This Stage 1 contract does not satisfy that claim.

## Stage 1 Happy Path

Through the existing browser product surface, initiate one panel regeneration using the established fake provider.

The visible product result stays unchanged. A read-only diagnostic shows:

- initiating action and nullable research correlation;
- immutable project, source, and target identity;
- exact final provider-facing prompt and hash;
- exact serialized-request hash and sizes;
- model, aspect ratio, reference strategy, and budget;
- ordered references actually sent;
- compact explicit omissions;
- compiler and build identity;
- prepared-before-I/O state and terminal provider outcome.

Also demonstrate one known provider failure or timeout with truthful terminal evidence. Use synthetic data, `comics_test`, a non-production port, and a loopback fake provider. Make zero real provider calls.

## Acceptance-claim ledger

| Accepted claim | Stage 1 proof | Still open after Stage 1 |
| --- | --- | --- |
| Exact effective request | Final prompt and SHA-256, serialized-request SHA-256 and sizes, model, aspect ratio, strategy, and budget for panel and frame-panel attempts | Anchor request shapes |
| Attributable attempt | Server-derived project, generation, and target ids; generation kind `panel` or `frame-panel`; nullable action correlation; compiler and build identity | Anchor action and target identity |
| Sent and omitted references | Ordered final sent references, plus compact upstream and request-strategy omissions | Anchor omissions and preserved anchor asset ids |
| Durable attempt | Prepared row before provider I/O and terminal update after the known outcome | Same lifecycle on anchor attempts |
| Behavior-neutral | Identical serialized request and provider call count with tracing on or off; trace failure does not change or retry the product operation | Same proof per anchor request shape |
| Inspectable evidence | One read-only inspection script over synthetic test data | Same script, anchor rows |
| Complete accepted coverage | Direct panel generation and each frame-panel provider attempt | Every current reachable anchor generation path |

## Durable evidence contract

One additive PostgreSQL table, `image_generation_attempt`, records one row per traced provider attempt. It is not a generic event log. Existing generation rows stay product state, not the trace store.

Identity and lineage:

- attempt UUID and request-local diagnostic id;
- project id;
- generation kind `panel` or `frame-panel`;
- server-derived action kind `panel` or `frame-panel`;
- panel-generation / source-record id;
- storyboard version, frame, panel, and panel index where available;
- nullable research correlation UUID, with no requirement that a research row exist;
- compiler id and version;
- build marker from the existing build-info mechanism;
- prepared and terminal timestamps;
- state `prepared`, `succeeded`, or `failed`.

Request evidence:

- exact final provider-facing prompt and SHA-256;
- model and aspect ratio;
- reference strategy and configured budget;
- original and final serialized-body sizes;
- exact serialized-request SHA-256;
- ordered final sent references: role, persisted asset id when preserved, SHA-256, MIME, byte length, width, and height;
- compact explicit omissions: role, asset id when known, and a safe reason code.

Outcome evidence:

- whether provider I/O began;
- applied timeout, latency, and safe HTTP status;
- safe outcome or finish kind;
- only explicitly allowlisted scalar usage fields already returned by the provider adapter;
- output SHA-256, MIME, byte length, width, and height when output bytes exist.

No output asset id is required. Product asset persistence happens later. A non-terminal `prepared` row means interruption or unknown terminal state. It is not an inferred provider failure.

Bounded JSON is used only for the ordered reference list and the omission list.

## Privacy boundary

The trace and container logs do not store candidate graphs, transformation histories, raw provider responses, exception text, image bytes, data URLs, credentials, authorization data, or copies of immutable saved descriptions and owner instructions already held by product records.

The exact provider-facing prompt is stored on the attempt row because it cannot be reconstructed later. Inspection of an explicitly selected attempt may print that prompt. Container operational logs stay content-free: trace id, stage, and safe code only.

The nullable correlation UUID does not foreign-key to research storage. Research persistence remains independently fail-open.

## Stage 1 versus Stage 2 coverage

Stage 1 plumbs trace context only through `generateOnePanel` and the initiating direct-panel and frame actions. Each direct panel generation records `panel`. Each provider attempt inside frame generation records `frame-panel`. Every frame-panel attempt shares the frame action correlation and keeps its own panel-generation id.

Anchor calls may still reach `executeImageRequest`. They do not receive Stage 1 trace context and therefore write no attempt row.

Stage 2, after a separate owner checkpoint, connects every current reachable anchor-generation path to the same table, recorder, lifecycle, privacy rules, and inspection script. Stage 2 is not implemented here and remains an open ledger item.

## Explicit non-goals

- Stage 2 anchor context plumbing;
- R2 revision behavior or Accept/Cancel;
- R1 speaking or listening states;
- video-render or text-model tracing;
- retention or pruning implementation;
- viewer, API, dashboard, export, or analytics;
- historical reconstruction or backfill;
- image bytes or raw provider responses in the trace;
- generic observability or event infrastructure;
- cancellation, resume, overlap handling, recovery workers, or stale-attempt cleanup;
- real provider calls.

## Stage 1 is not feature completion

Passing Stage 1 tests and the Stage 1 checkpoint does not complete Feature 021. Anchor coverage stays visible in the acceptance-claim ledger until Stage 2 is accepted or the owner explicitly removes it. This contract does not claim owner acceptance.
