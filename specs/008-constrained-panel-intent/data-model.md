# Data Model: Constrained panel intent

**Conclusion**: **No schema migration or new persistent entity is necessary.** The Happy Path reuses existing Stage panel `{ description }`, cast, `storyboard_result` jsonb payloads, and Visual authority/generation tables.

## Reused persistent structures

### Stage panel (unchanged contract)

- Shape remains `{ description: string }` per `stage-response.schema.json`.
- Description is Structure **review content**, not a provider prompt.
- After this feature, descriptions presented as ready must satisfy supported-intent validation.

### Cast / speaker ownership (unchanged)

- Confirmed characters, aliases, and speaker assignments remain the authority for who exists and who speaks.
- Source dialogue wording continues to be reconstructed server-side from source items; Stage never owns dialogue strings.

### `storyboard_result.stage_payload`

- Continues to store `{ frames, review }` jsonb.
- No new columns. Ready eligibility remains `status === "checked"` for the active material state, now also implying panel-intent checks passed inside `buildChecked`.

### Visual entities (unchanged)

Reuse without modification of purpose:

- `character_anchor_version` — identity authority
- `project_style_seed` — project-style authority
- `panel_visual_state.subject` — derived character assignment for generation (must align with exactly-one ready rule)
- `panel_generation` — append-only attempts; may continue to snapshot description/instruction fields for lineage, but those snapshots are **not** concatenated into the provider prompt on the constrained eligible path
- `visual_approval` — human Visual gate; no auto-approval

## Derived / non-persistent concepts

| Concept | Representation | Persistence |
|---------|----------------|-------------|
| Supported panel intent | Ephemeral compiler object: character, shot scale/crop within close-up→waist-up, visible geometry/gesture/head/gaze/expression tokens, panel side, speaking/listening role, system matte background | None |
| Panel subject cardinality | Distinct cast/alias matches in a panel description | None (computed at readiness and Visual bootstrap) |
| Unsupported semantic category | Deterministic detector result over description text | None; surfaces as blocked failure codes |
| Compiler version | Constant string e.g. `constrained-panel-intent/v1` | Logged only |
| Ready Structure storyboard | Existing checked + readyEligible path after fidelity **and** panel-intent pass | Existing |
| Independently compiled generation request | Prompt string from supported intent + reference-role labels + matte rule | Transient provider call only; not archived |

## Validation rules (product-level)

For every future generated-image panel presented as ready:

1. Exactly one assigned character (cast-aware).
2. Description contains only supported visual categories.
3. No more-than-waist-up body coverage.
4. Support-dependent narrative cues are absent unless expressed as allowed visible geometry/expression.
5. Source wording, order, and speaker ownership still pass existing fidelity checks.

For eligible system-created image generation:

1. Provider prompt must not contain concatenated raw source text or arbitrary full panel-description prose.
2. Prompt must include system solid-matte background rule and waist-up ceiling.
3. Identity and project-style authorities remain separate from performance authority; acceptance path uses no performance reference.

## Illustrative blocked failure codes

Stable safe codes for Structure readiness (names illustrative; exact strings chosen at implementation):

| Code | Meaning |
|------|---------|
| `unsupported-panel-intent` | Unsupported semantic category present in a ready candidate description |
| `panel-subject-required` | Zero assigned characters |
| `panel-subject-ambiguous` | Multiple distinct assigned characters |
| `panel-framing-unsupported` | More-than-waist-up / full-body framing language |

These reuse the existing `status: "blocked"` + `failures[]` channel. They are not a new state machine.

## Explicitly rejected persistence / architecture

- New tables, columns, asset kinds, or operation resources
- Typed persistent panel-intent schema (would require owner approval if later proven necessary)
- Automatic reviewer / visual-content detector store
- Prompt archive, provider-payload store, diagnostic ZIP, generated-image fixtures
- Feature 006 hybrid background/cutout/operation schema
