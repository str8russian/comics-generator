# Research: Constrained panel intent

**Date**: 2026-10-11
**Branch**: `codex/008-constrained-panel-intent`
**Base**: `d6a93e0fd8b76ec4a7ea9a86fb1d71c4a199197a`
**Spec**: [spec.md](./spec.md)

## Evidence summary (current code)

### Structure ownership

- Persistent Happy Path: draft → Interpret (`interpret.mjs`) → cast confirmation → `POST /api/storyboard-results` → `projectStore.stageActiveMaterial` → `stageStoryboard` (`stage.mjs`) → `buildChecked`.
- Stage prompt (`prompts/stage.md`) and schema (`specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json`) allow only free-text `panels[].description` (`additionalProperties: false`).
- Readiness today: Ajv schema → `assessStage` (source accounting) → `buildChecked` dialogue rebuild → `assessDialogue`. Success status is `"checked"`; UI presents ready when `readyEligible` is true. No visual-grammar gate exists.
- Panel subject for Visual is derived later in `visual-store.ensurePanelRows` via `resolvePanelSubject(description, cast)` — earliest cast/alias substring match; zero/multi cardinality is not fidelity-gated.
- Feature 004 (`storyboard-edit.mjs`) is user-initiated Structure edit + undo. It reuses `buildChecked` but is not an automatic unsupported-intent repair loop. Deterministic path only handles a narrow full-frame-character command.

### Visual compilation ownership

- Frame generate (`POST /api/visual/frames/:id/generate`, client body `{}`) is the system-created Happy Path: no performance reference, no user-authored regeneration prompt.
- Eligible ordinary `split2` panels use `compilePanelReadyIntent` / `compilePanelReadyPrompt` in `visual-model.mjs`.
- That compiler still concatenates `Panel description: ${intent.description}` and `User revision request: ${intent.instruction}` into the provider prompt, while also emitting one-character / uniform-background rules.
- Historical `panelPrompt` remains for ineligible layouts and still forwards description prose.
- Reference assembly for panel-ready already protects identity → style → performance → previous under the three-image limit.
- Sanitized `logVisual` already records panel address (`frameId`, `panelIndex`), terminal `status`/`kind`, and avoids long strings/prompts/bytes. It does not record compiler version, structured canonical intent evidence, or identity/style authority asset ids.

### Safe fixtures / eval

- Stage artistic eval fixture: `app/storyboard-web/eval/stage-artistic/` (sourceItems + target; no committed owner dialogue body).
- Offline Visual/Structure tests: `test/visual-model.test.mjs`, `test/visual-workflow.test.mjs`, `test/fidelity-*.test.mjs`, `test/storyboard-ready.test.mjs`, `test/storyboard-blocked.test.mjs`, `test/stage-cast.test.mjs`, `test/persistent-fake-provider.mjs`, `test/visual-repair-fixtures.mjs`.
- Owner reference dialogue remains paste-only acceptance evidence; do not duplicate protected material into fixtures.

### Provider calls this Plan stage

**0**. Decisions resolved from code evidence and accepted product decisions. Live provider quality remains an implementation/acceptance concern under DEC-049.

## Decisions

### D1: Dual ownership boundary — Stage constraint + ready gate, and independent Visual compilation

**Decision**: Implement both boundaries in one vertical slice:

1. Constrain Storyboarder output via `prompts/stage.md` (and keep `prompts/edit-storyboard.md` aligned so user Structure edits cannot reintroduce unsupported grammar as ready content).
2. Add deterministic `assessPanelIntent(frames, cast)` called from `buildChecked` so unsupported candidates cannot become ready.
3. Rewrite the eligible panel-ready compiler so the provider-facing prompt is assembled only from bounded, canonical supported-intent values + identity/style reference-role instructions + the system matte-background rule, without concatenating raw description or raw source prose and without copying arbitrary description substrings (except the cast-resolved canonical character name).

**Rationale**: Spec FR-009 requires the two boundaries to be independently testable. Observed bedroom-like failure shows Structure prose alone is insufficient if the compiler still forwards it.

**Alternatives rejected**:

- Prompt-only Stage edit — fails FR-009 and FR-013 when unsupported detail survives.
- Compiler-only Visual edit — leaves Structure review misrepresenting the Visual grammar (US1 / FR-016).
- Automatic repair/normalization loop that rewrites Storyboarder prose into a new ready board — larger than rejection; no existing auto-repair path; closer to a new subsystem.

### D2: Supported-intent representation — existing free-text `description` + cast-derived subject, with non-persistent compile-time intent

**Decision**: Keep the Stage JSON panel contract as `{ description }` only. Do **not** add persistent typed intent fields, tables, columns, or asset types.

Representation plan:

| Layer | Representation |
|-------|----------------|
| Structure review content | Existing `description` string, constrained by prompt + validator to supported categories only |
| Character assignment | Cast-aware subject resolution over description; readiness requires exactly one distinct assigned character per future image panel |
| Downstream compile-time intent | Ephemeral object of **canonical** supported values (character, shot scale/crop, visible geometry, gesture, head pose, gaze, expression, matte background). Frame side and speaker/listener role are internal derivation inputs only, not provider-facing relational prose. Not persisted as a new entity |
| Provider prompt | Assembled only from those canonical values + identity/style reference-role instructions that add no scene content + system matte rule |

**Rationale**: Happy Path is achievable without a material schema boundary. Spec leaves representation open and forbids new persistent entities (FR-022). Existing `description` already reaches Structure review and FrameRenderer; tightening it avoids dual sources of truth.

**Alternatives rejected**:

- Small typed extension to Stage schema / Project Document panel fields — material schema boundary requiring owner approval before Tasks; larger migration of Stage prompt, Ajv contract, edit path, and stored payloads for no Happy Path necessity once rejection + independent compile exist.
- Bounded non-persistent normalization that silently rewrites descriptions before ready — obscures review content, resembles a repair subsystem, and is larger than reject-or-correct-before-ready.
- New permanent AI role or reviewer for visual grammar — rejected by FR-021/FR-022 and DEC-036/Q-033 (one image-preparation function; no separate automatic reviewer).

**Owner approval**: none required for persistence/schema. If implementation later proves Happy Path impossible without a new persistent field, stop and request owner approval before Tasks continue — do not treat that as pre-authorized.

### D3: Structure readiness — prefer rejection inside `buildChecked`

**Decision**:

- Extend `buildChecked(draft, sourceItems, stage, cast)` to accept cast (characters + aliases) from `stageStoryboard` and `editStoryboard`.
- After existing fidelity/dialogue checks pass, run `assessPanelIntent` over every future generated-image panel (including directing-beat segment panels).
- On failure, return existing `status: "blocked"` with new safe failure codes (illustrative): `unsupported-panel-intent`, `panel-subject-required`, `panel-subject-ambiguous`, `panel-framing-unsupported`.
- Prefer rejection for the first slice. Do not add an automatic rewrite/retry loop. Model may still be constrained by the Stage prompt to reduce block rate, but readiness must not depend on prompt trust alone.

Subject cardinality:

- Extend subject resolution beyond “earliest match” to detect zero distinct cast matches and multiple distinct cast matches in one panel description.
- Exactly one distinct assigned character is required for readiness.

Unsupported-category detection:

- Deterministic RU/EN pattern/heuristic checks for locations/scenery, interiors, furniture, props/objects, additional people, physical interaction, visible text/style instructions, and invisible narrative/temporal prose.
- Support-dependent wording (`сидит`, `лежит`, `sleeping`, `waking`, meeting context, etc.) must be converted by Storyboarder into visible upper-body geometry/expression, or the candidate is rejected if those cues remain as support/scene invitations.
- Synthetic mutations isolate each unsupported semantic category; do not encode one dialogue’s artistic direction as universal layout rules.

**Rationale**: Single insertion point covers Stage and 004 edit. Existing blocked presentation path already prevents ready UI. Matches “prefer rejection if sufficient.”

**Alternatives rejected**:

- Rely on feature 004 user edit as the correction path — requires extra user action; fails the Happy Path admission test for non-user-dependent Stage failures.
- Schema-only enrichment without local validator — still trusts the model.
- New repair subsystem / second Stage call on failure — premature hardening.

### D4: Independent downstream compilation for system-created generation

**Decision**: Evolve `compilePanelReadyIntent` / `compilePanelReadyPrompt` (eligible panel-ready path) into a **canonical closed** compiler boundary:

1. The provider-facing prompt is assembled from **bounded, canonical supported-intent values only**.
2. Except for the cast-resolved canonical character name, the compiler must **not** copy arbitrary substrings from the panel description into the provider prompt.
3. Unknown, unrecognized, or unsupported wording contributes **no** provider-facing text.
4. The compiler must **never** fall back to the full description when extraction yields no supported attributes; it must use supported neutral defaults or reject at the appropriate existing boundary.
5. Raw source text is never an input; full panel `description` is never concatenated.
6. Frame side and speaker/listener role may remain internal inputs for deriving concrete supported visual attributes (viewer-relative gaze, visible facial state). They must **not** become relational or scenario prose such as “two-character dialogue pair,” “partner,” meeting context, or other language that can invite additional people, scenery, or out-of-grammar composition.
7. Provider-facing output remains limited to: the assigned character; close-up through waist-up framing and crop; visible upper-body geometry and in-crop gesture; head turn and tilt; gaze direction; facial expression; the system-defined solid matte background; and identity/style reference-role instructions that do not add scene content.
8. Background wording becomes a **system-defined solid matte** rule (stronger than “simple uniform non-scenic”).
9. Shot-scale ceiling is waist-up (never more body coverage); crop-safe guidance remains.
10. Identity and project-style authorities continue via existing `assemblePanelReadyReferences`; Happy Path acceptance uses no performance reference and empty instruction.
11. User-authored `instruction` forwarding on panel regenerate remains untouched as a later DEC-050 slice; the Happy Path frame-generate body stays `{}`.
12. Nested-panel elimination is **not** claimed solved; that remains a later slice (FR-023).

Compiler version: introduce a short constant (e.g. `constrained-panel-intent/v1`) used in logs and tests.

**Rationale**: Current eligible compiler still embeds `Panel description:` and relational layout phrasing, so it fails FR-010–FR-013 even after Structure cleanup. Frame generate is already separable from regenerate.

**Alternatives rejected**:

- Keep description concatenation “for human context” — contradicts FR-012 and the bedroom-like evidence path.
- Free-text extraction that copies arbitrary recognized substrings into the prompt — still leaks unrecognized/unsupported wording and is not a closed canonical boundary.
- Fall back to full description when extraction is empty — reopens FR-013.
- Design user-regeneration prompt filtering now — explicitly out of scope.
- Replace image-provider or FrameRenderer — unnecessary.
- Apply a new general prompt-sanitization framework — over-scoped; gatekeeper rejects cross-cutting platforms.

Residual disclosure: historical `panelPrompt` for ineligible layouts may still forward prose; this slice’s acceptance uses an eligible panel-ready path. Nested-panel artifacts may still appear and remain unsolved (FR-023).

### D5: Validation and mutation coverage

**Decision**: Deterministic offline tests (provider doubles; no prompt archives):

| Proof | Primary home |
|-------|----------------|
| Unsupported category absent from ready Structure panels | new/extended fidelity or panel-intent tests calling `assessPanelIntent` / `buildChecked` |
| Exactly one assigned character per future image panel | subject-cardinality tests with cast/aliases |
| More-than-waist-up rejected | framing patterns in `assessPanelIntent` |
| Support-dependent narrative wording converted or rejected | synthetic RU/EN mutations |
| Downstream compiled prompt contains only canonical supported-intent values; no raw description/source concatenation | `visual-model.test.mjs` assertions on compiler output |
| Unique canary text in unsupported/unrecognized upstream prose is absent from compiled provider prompt; recognized intent emitted only as canonical values | compiler canary mutations (pure function) |
| Each unsupported semantic category absent from compiled provider input | compiler mutations (pure function) |
| No full-description fallback; no relational/scenario provider prose | `visual-model.test.mjs` |
| Eligible frame generate uses constrained compiler | `visual-workflow.test.mjs` spy on `imageGenerator` prompt |
| `logVisual` records structured canonical intent evidence and excludes raw prose | `visual-workflow.test.mjs` logging assertions |
| Source wording/order/speaker ownership unchanged | existing fidelity/overflow regressions remain green |
| FrameRenderer geometry unchanged | no edits to `frame-renderer.mjs`; overflow/placement regressions |

Reference dialogue: browser acceptance via owner paste; offline Stage intent tests may reuse safe synthetic boards and, where useful, `eval/stage-artistic` structural fixtures without copying protected dialogue text.

### D6: Diagnostics — extend existing `logVisual` only

**Decision**: No diagnostic subsystem. Reuse `logVisual` sanitization (drop strings >120 chars). Add only these fields when available on panel generate / outcome:

| Field | Consumer | Action enabled | Why existing evidence is insufficient |
|-------|----------|----------------|----------------------------------------|
| `frameId` + `panelIndex` | already present | locate panel | covered |
| `compilerVersion` | implementation agent | reproduce compiler behavior | not logged today |
| compact, safe, **structured canonical intent evidence** (actual supported intent used for compilation) | implementation agent | reconstruct/understand compiler input | not logged today |
| optional intent fingerprint (supplement only) | implementation agent | quick equality check | must not replace structured intent |
| `identityAssetId` / `styleAssetId` (short ids) | implementation agent | confirm authorities | not on panel path today |
| `status` / `kind` | already present | terminal result / rejection | covered |

Together with panel address, compiler version, identity/style authority ids, and terminal result/failure reason, the structured canonical intent evidence must be sufficient to reconstruct or understand the compiler input. A fingerprint alone is insufficient.

Structure blocked failures continue via existing `failures[].code` (and optional panel address fields if already safe). Do not log raw panel descriptions, source material, user material, complete prompts, provider payloads, credentials, secret-bearing URLs, or image bytes.

**Alternatives rejected**: fingerprint-as-sole-intent-evidence; ZIP export; prompt archive; provider-response storage; image fixtures; new observability service; new table/migration/persistent entity.

### D7: No new persistence, operations, or 006 architecture

**Decision**: No new migration, table, column, asset kind, workflow stage, permanent AI role, operation resource, state machine, polling, recovery, or hybrid composition. Feature 006 remains historical evidence only.

**Rationale**: FR-022 / DEC-047 / DEC-048 / DEC-050.

### D8: Browser acceptance path

**Decision**: One uninterrupted session:

1. Paste retained Putin/Durov/Peskov reference dialogue; create complete Structure storyboard.
2. Inspect every future generated-image panel description for one-character supported intent only.
3. With approved identity + project style, generate one eligible panel via existing frame/panel Visual path with no performance reference and no user regeneration prompt.
4. Review character-only waist-up-or-closer result on solid matte background in existing FrameRenderer geometry.

Human-reviewed: identity, style, framing, matte background, absence of invented environment/furniture/props/people/interaction, artistic acceptance.
Deterministic: source fidelity, subject cardinality, unsupported-category rejection, canonical closed compiler (canary prose absent), structured diagnostic intent evidence, FrameRenderer untouched, authority preflight.

Live provider environmental invention cannot serve as acceptance evidence; preserve as reproducible failure and require smallest correction (FR-019).

## Open questions resolved for Plan

| Question | Resolution |
|----------|------------|
| Structure insertion point | `assessPanelIntent` inside `buildChecked`; Stage/edit prompts constrain upstream |
| Repair vs reject | Reject for first slice |
| Typed persistent intent fields | Not required; ephemeral compile-time intent only |
| Compiler concatenation | Canonical closed eligible compiler; no description substring copy except cast-resolved character name; no full-description fallback |
| Diagnostics | Minimal `logVisual` additions: structured canonical intent evidence required; fingerprint optional supplement only |
| Q-020 / Q-035 / Q-036 | Do not expand into layout-rendition systems, auto package review, or new framing UX in this slice |
| Q-033 / DEC-036 | No new AI role; image-preparation remains one function owning briefs/compilation |

## Gatekeeper notes from research

- Vertical: Structure ready-gate + Visual compiler + focused tests → browser Structure review + one generated panel.
- Not layer-only: both ownership boundaries required.
- Persistence/diagnostics/concurrency do not dominate.
- Deferred slices (nested panels, user regen filter, performance-reference transfer) stay out.
