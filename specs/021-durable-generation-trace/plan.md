# Durable image-generation trace — plan

Stage 1 is accepted as implemented. Stage 2 adds anchor coverage on the same sink and is awaiting coordinator review. No `tasks.md`. This plan does not claim Feature 021 completion or owner acceptance.

## Verified call-site inventory

Verified on `368c6e39151ffec139842ccd106011477af118fc` before branching, and re-checked by an automated production scan after the change.

All non-test production image-provider calls converge on `executeImageRequest` in `app/storyboard-web/image-reference-strategy.mjs`. The only underlying call is `input.imageGenerator(...)` inside that function. `generateImage` in `app/storyboard-web/image-provider.mjs` is the production generator. Its only network send is `fetchImpl(...)` after transport validation.

Callers:

1. `deliverPreparedImage` → `executeImageRequest`
2. `handleAnchorSession` → `executeImageRequest` directly
3. `handleVisualAnchor` → `deliverPreparedImage`
4. `generateOnePanel` → `deliverPreparedImage`
5. direct panel generation invokes `generateOnePanel` once
6. frame generation invokes `generateOnePanel` once per panel

Stage 1 passes trace context on paths 4–6. Stage 2 passes the same opaque `traceContext` on paths 2 and 3. Every production caller of `executeImageRequest` now supplies that context: `deliverPreparedImage` forwards the caller's context, `handleAnchorSession` builds it for the session route, and `handleVisualAnchor` builds it for the persisted route before calling `deliverPreparedImage`. `generateOnePanel` is unchanged and still builds the panel and frame-panel context.

There is no second production image-provider route. `spikes/base-anchor-ui-prototype/` is not mounted by the storyboard server. It remains deferred and unchanged.

Non-generative upload, accept, approve, retire, restore, assignment, placement, reuse, and duplication actions do not call `executeImageRequest` and write no attempt row.

## One-table schema

Migration `018_image_generation_attempt.sql` adds `image_generation_attempt`.

The table holds the identity, request, and outcome fields in `spec.md`. `sent_references` and `omissions` are JSON arrays. `correlation_id` has no foreign key. `panel_generation_id` is stored without turning `panel_generation` into the trace store. `project_id` references `project` so a row cannot be written for an unknown project.

Migration `018` constrains `generation_kind` and `action_kind` to `panel` and `frame-panel`. Migration `019` is unchanged. Migration `020_image_generation_attempt_anchor.sql` is the only widening. It adds nullable `character_name`, `material_state_id`, `anchor_version_id`, and `basis_kind`, then replaces the kind checks with the vocabulary in `spec.md`. A fresh database applies `018`, then `019`, then `020`. An already-migrated `comics_test` database applies only `020`. Neither `018` nor `019` is rewritten.

The anchor identity check keeps panel rows free of anchor columns and anchor rows free of panel, frame, and panel-generation columns. An `anchor-session` row has a character name, a session basis, and a null anchor-version id. Its material-state id is null when the server has no active material state. An `anchor` row requires the character name, material-state id, pending anchor-version id, and basis `persisted`. There is still no foreign key from correlation, material state, or anchor version. `project_id` remains the only foreign key.

There is no bytea column, no raw response column, and no saved-description or instruction column.

## Single recorder

`createImageGenerationTraceRecorder` is the only insert and update path. `executeImageRequest` calls it. Upstream code forwards one opaque `traceContext` and does not persist, analyze, or own the lifecycle.

The server binds the recorder to the existing pool. Each write is its own `pool.query`, outside the product transaction. Build id is resolved once through `loadBuildInfo`, not with Git on every request.

`insertPrepared` validates server-derived identity, hashes the final prompt and final reference bytes, and stores strategy omissions observed from `prepared.omittedRoles`. Upstream omissions are copied from the opaque context after a role/reason allowlist. Identity fulfilled by the same asset is not reported as an omission.

`updateTerminal` records the known outcome. Allowlisted usage scalars are `prompt_tokens`, `completion_tokens`, `total_tokens`, `input_tokens`, and `output_tokens`. Output bytes are hashed and discarded.

Both writes are fail-open. A failure logs `event=image-generation-trace` with attempt id, stage, and a safe code. It does not log prompts, bodies, bytes, secrets, or exception text, and it does not retry the provider.

## Pre-I/O lifecycle

`generateImage` still validates configuration and the request before `fetchImpl`. `assessImageTransport` is that existing decision, extracted so the hook and the fetch share one result.

Order:

1. `prepareImageRequest` builds the exact request, unchanged.
2. `executeImageRequest` calls `imageGenerator` once, passing `beforeProviderIo` only when Stage 1 context and a recorder exist.
3. `generateImage` returns configuration and invalid-request failures before the hook. Those attempts create no row and no network call.
4. After validation says an external call will happen, the hook awaits `insertPrepared`.
5. `fetchImpl` runs once with the same serialized body.
6. `updateTerminal` records success, provider failure, or timeout.
7. Product persistence continues unchanged.

A payload rejection from `prepareImageRequest` returns before `imageGenerator`. No row is created. A prepared row stores `provider_io_started` as NULL. Inspection returns `providerIoStarted: null` until the terminal update sets it true. `http_status` stores only `diagnostics.providerStatus` or `metadata.providerStatus` from an actual provider response. Inspection exposes that value as `providerHttpStatus`. Timeout and network failure before a response leave it null and keep the outcome kind. Migration `019_image_generation_attempt_observed_facts.sql` makes the I/O column nullable, drops its false default, and converts existing prepared false values to NULL. A fresh database applies `018` and then `019`. An already-migrated `comics_test` database applies only `019`. No sweeper is added.

Anchor calls pass `traceContext` only after assembly and configuration succeed, so a zero-provider failure still creates no row. The hook stays inside the existing `beforeProviderIo` path.

## Opaque context

The browser already creates a correlation in `runProductResearchAction` and in dock command execution. Stage 1 adds that id to the JSON body of:

- product-control panel generation;
- dock panel generation;
- frame generation, once, shared by every panel attempt.

The server reads only `correlationId`. Invalid or absent values become null and do not change the product result. Project, frame, panel, generation, and source ids are taken from the server route and from `beginPanelGeneration`. Client copies of those ids are ignored.

Compiler identity is `constrained-panel-intent` / `v1` or `historical-panel-prompt` / `v1`. Neither string is added to prompt text.

Upstream omissions:

- `reference-priority` when panel-ready assembly drops the previous image at the three-reference limit;
- `reference-limit` when historical assembly drops a distinct style image at that limit;
- `request-budget` when request strategy omits style while fitting the payload.

`styleDroppedByLimit` records the historical decision that already existed. It does not change which references are sent. The same asset used for identity and style is not an omission.

## Request-equivalence proof

With tracing absent, `executeImageRequest` does not pass `beforeProviderIo`. With tracing present, the hook runs only after transport validation and does not receive or return the serialized body.

Tests compare tracing on and off:

- serialized provider body and request SHA-256;
- ordered reference roles;
- model, aspect ratio, timeout, and strategy;
- provider call count;
- product-visible result, ignoring latency.

Prepared-insert failure and terminal-update failure keep that result and that single call.

## Test and database isolation

Offline tests use an in-memory query double. The PostgreSQL test uses `STORYBOARD_TEST_DATABASE_URL` only when the database name is `comics_test`, advisory-locks its own critical section, and deletes only `021…` project and attempt ids. It does not `TRUNCATE` and does not open the `comics` database.

The offline suite is `node --test test/**/*.test.mjs` from `app/storyboard-web`. The isolated lane is `node test/postgres/verify.mjs` with `STORYBOARD_VERIFY_FILES` pointed at the trace test when a full-lane run is not required. The checkpoint runs the trace file through that verifier.

## Inspection checkpoint

`app/storyboard-web/inspect-image-generation-attempt.mjs` opens a read-only transaction and loads one attempt by `--attempt`, every attempt for a `--panel-generation`, every attempt for a `--correlation`, or every attempt for an `--anchor-version`. Output is the bounded evidence chain, including the exact prompt for the selected row. It does not print reference bytes, output bytes, data URLs, credentials, authorization data, or raw provider responses. It is not an API.

The Stage 1 checkpoint uses a synthetic `comics_test` project, a non-production port, and a loopback fake provider. It shows one successful panel regeneration, one known provider failure, a prepared row visible before the fake provider is released, and read-only lookups by attempt, panel generation, and correlation. It does not start, stop, migrate, or reconfigure the production app, and it does not use port `4173` or the `comics` database.

## Stage 2 anchor context

`handleAnchorSession` and `handleVisualAnchor` each build one `traceContext` and pass it through. Intermediate code only forwards it. The client forwards the correlation already created by `runProductResearchAction` on the Characters-stage anchor-session request. The server accepts that value with the existing nullable UUID check. Project, character, material, anchor version, and asset ownership come from the server route, `beginAnchor`, `readAsset`, or `readActiveMaterialStateId`.

`readActiveMaterialStateId` is a read of `project.active_material_state_id`. It does not call `ensureVersion` and does not insert a product row. If it is absent or fails, the session material-state id is null and generation continues.

`resolveSessionImage` returns the loaded `visual_asset.id` with the bytes. `assembleAnchorSession` copies that id onto the reference and does not copy a client id from a data URL. `readAnchorStyle` keeps its id on the style reference. `toReference` already reads `id` or `assetId`, so the sink hashes the same bytes and stores the server asset id.

The request-budget omission path is the existing sink. It copies the asset id from the original reference. Current production anchor modes do not both include a style reference and use `revision`: `selected` is `revision` but does not send style, while `accepted` and persisted `/anchor` send style under `initial` and `anchor`, which do not omit style. The seam test still proves that a style reference produced by anchor assembly keeps its asset id when the shared strategy omits that role.

Compiler constants live beside the prompt functions and are not read by those functions.

## Stage 2 inspection and checkpoint

`inspect-image-generation-attempt.mjs` adds `--anchor-version`. The output includes basis, character, material state, anchor version, compiler identity, ordered sent assets, omissions, the exact prompt and request evidence, and the provider outcome.

The Stage 2 checkpoint uses the Characters-stage anchor-session surface on `comics_test`, a non-production port, and a loopback fake provider. It shows one successful generation and one known provider failure, then reads the rows by attempt and correlation. The persisted `/anchor` route is covered by focused HTTP tests, not by a new browser control.

Stage 2 does not implement R2, a viewer, recovery, or historical backfill. Feature 021 still awaits coordinator review and final owner acceptance.
