# Durable image-generation trace

## Status

Stage 1 is accepted as implemented. Stage 2 connects the remaining production anchor routes to that same sink. This stage is awaiting coordinator review. It does not claim owner acceptance, and Feature 021 is not complete.

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
| Exact effective request | Final prompt and SHA-256, serialized-request SHA-256 and sizes, model, aspect ratio, strategy, and budget for panel and frame-panel attempts | Same proof for each current anchor shape below |
| Attributable attempt | Server-derived project, generation, and target ids; generation kind `panel` or `frame-panel`; nullable action correlation; compiler and build identity | Anchor action, basis, character, and source identity below |
| Sent and omitted references | Ordered final sent references, plus compact upstream and request-strategy omissions | Anchor asset ids and omissions below |
| Durable attempt | Prepared row before provider I/O and terminal update after the known outcome | Same lifecycle on anchor attempts |
| Behavior-neutral | Identical serialized request and provider call count with tracing on or off; trace failure does not change or retry the product operation | Same proof per anchor request shape |
| Inspectable evidence | One read-only inspection script over synthetic test data | Same script, including anchor-version lookup |
| Complete accepted coverage | Direct panel generation and each frame-panel provider attempt | Both production anchor routes below |

## Durable evidence contract

One additive PostgreSQL table, `image_generation_attempt`, records one row per traced provider attempt. It is not a generic event log. Existing generation rows stay product state, not the trace store.

Identity and lineage:

- attempt UUID and request-local diagnostic id;
- project id;
- generation kind `panel`, `frame-panel`, `anchor-session`, or `anchor`;
- server-derived action kind, using the same four values;
- panel-generation / source-record id for panel and frame attempts;
- anchor character, material state, pending anchor version, and basis for anchor attempts;
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

- `providerIoStarted`: `null` on a non-terminal prepared row, meaning provider I/O is not durably confirmed; `true` after a terminal update, because the production hook runs only after transport validation and immediately before the single provider attempt;
- applied timeout and latency;
- `providerHttpStatus`: the HTTP status from an observed provider response, or `null` when no response was observed. The database column remains `http_status`. A timeout or a network failure before any response does not store the application's mapped `504` or `502`;
- safe outcome or finish kind, including `timeout` and `provider`, so the product classification remains inspectable;
- only explicitly allowlisted scalar usage fields already returned by the provider adapter;
- output SHA-256, MIME, byte length, width, and height when output bytes exist.

No output asset id is required. Product asset persistence happens later. A non-terminal `prepared` row means interruption or unknown terminal state. `providerIoStarted` null does not mean provider I/O did not start, and the row is not an inferred provider failure. A failed terminal trace update leaves that prepared row unchanged.

Bounded JSON is used only for the ordered reference list and the omission list.

## Privacy boundary

The trace and container logs do not store candidate graphs, transformation histories, raw provider responses, exception text, image bytes, data URLs, credentials, authorization data, or copies of immutable saved descriptions and owner instructions already held by product records.

The exact provider-facing prompt is stored on the attempt row because it cannot be reconstructed later. Inspection of an explicitly selected attempt may print that prompt. Container operational logs stay content-free: trace id, stage, and safe code only.

The nullable correlation UUID does not foreign-key to research storage. Research persistence remains independently fail-open.

## Stage 1 versus Stage 2 coverage

Stage 1 plumbs trace context only through `generateOnePanel` and the initiating direct-panel and frame actions. Each direct panel generation records `panel`. Each provider attempt inside frame generation records `frame-panel`. Every frame-panel attempt shares the frame action correlation and keeps its own panel-generation id.

Stage 2 passes one opaque `traceContext` from both remaining production anchor routes into the same recorder. No second recorder is added.

## Anchor vocabulary

These values are allowlisted. Compiler ids and versions are not interpolated into prompt text.

Generation kind and action kind are the same value on each attempt:

| Value | Route |
| --- | --- |
| `panel` | Direct panel generation |
| `frame-panel` | One provider attempt inside frame generation |
| `anchor-session` | `POST /api/visual/characters/:name/anchor-session` |
| `anchor` | `POST /api/visual/characters/:name/anchor` |

Basis kind is null on panel and frame-panel rows. Anchor rows use exactly one of:

| Value | Meaning |
| --- | --- |
| `from-source` | Session assembly. The source image is the only identity reference. |
| `selected` | Session assembly. The selected previous candidate is the draft. |
| `accepted` | Session assembly. The accepted anchor is the authority, with optional source and style. |
| `persisted` | Stored `/anchor` assembly from the server identity, optional previous candidate, and optional style. |

Compiler identity:

| Attempt | Compiler id | Version | Prompt function |
| --- | --- | --- | --- |
| `anchor-session` | `anchor-session-prompt` | `v1` | `compilePrototypePrompt` |
| `anchor` | `anchor-prompt` | `v1` | `anchorPrompt` |

Panel compilers stay `constrained-panel-intent` / `v1` and `historical-panel-prompt` / `v1`.

## Anchor identity

The server owns project, character, material, anchor-version, and asset identity. A client-supplied copy is not authoritative. The nullable correlation id remains opaque attribution and has no foreign key.

`anchor-session` records:

- project id from the request scope;
- character name from the route;
- active material-state id when the server can read it, otherwise null;
- null anchor-version id, because a session attempt has no durable anchor version;
- the session basis the server assembled;
- the existing research correlation when the Characters-stage request forwards a valid UUID, otherwise null.

`anchor` records:

- project id from the request scope;
- character name and material-state id from the pending row `beginAnchor` created;
- that pending `character_anchor_version` id;
- basis `persisted`;
- a valid client correlation UUID when the request includes one, otherwise null.

Panel and frame columns stay null on anchor rows. Anchor columns stay null on panel and frame rows. No durable anchor-session id is invented.

Persisted asset ids reach the ordered sent-reference evidence through `resolveSessionImage` and the existing reference object. An asset loaded by id keeps the server asset id. A data URL or ephemeral selected candidate has a null asset id. The persisted style asset keeps its id. A request-budget omission keeps that known asset id when the shared strategy omits the role. This passthrough does not change reference order, bytes, prompt text, serialization, provider selection, timeout, or the product result.

Upstream omissions stay compact: role, asset id when known, and `reference-priority`, `reference-limit`, or `request-budget`. A reference excluded by the basis itself is not an omission. The same asset fulfilling two roles is not an omission. Current session and persisted assembly admit at most three references, so the three-reference cap does not drop an applicable reference today; the row still records a `reference-limit` omission if that guard drops one.

## Anchor inspection

The same read-only script loads one attempt, every attempt for a panel generation, every attempt for a correlation, or every attempt for a pending anchor-version id. Session attempts are found by attempt or correlation. They have no anchor-version id.

## Explicit non-goals

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

## Feature 021 is not complete

Passing Stage 1 and Stage 2 tests does not complete Feature 021. Stage 2 awaits coordinator review and final owner acceptance. This contract does not claim either.
