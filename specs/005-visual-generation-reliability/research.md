# Research: Visual Generation Reliability

**Date**: 2026-10-09

## Evidence summary

### Anchor style inconsistency

Current approved anchors in `comics`:

| Character | Created | Approved | Output asset |
|-----------|---------|----------|--------------|
| Путин | 15:53:13Z | 16:04:26Z | `b9f5e249-...` |
| Песков | 15:54:31Z | 16:04:32Z | `8bb837ec-...` |
| Дуров | 15:55:56Z | 16:04:30Z | `75fc249e-...` |

All three first candidates were generated before any approval. `projectStyleAnchor` only returns an already-approved anchor, so every first-wave request received identity only. The shared text `STYLE_LANGUAGE` block was insufficient to lock rendering language. Download evidence matches these three output assets and shows divergent line weight, tonal grouping, palette, crop, and detail density.

Additional design flaw: style is rediscovered as “earliest approved except this character”, so regenerating the first-approved character can select a different character as style authority. Style is not persisted as project state, and `character_anchor_version` does not record which style asset was used.

### Invisible generated frame

PostgreSQL shows ready `panel_generation` rows with output assets for `frame-1#1` and `frame-1#2`. `/api/visual` returns `visualReady: true` and valid `assetId` values. Reproduction against `compileOverflow` proves that fitting rebuilds panels as `{ description }` only, dropping `assetId`, asset URL, zoom, position, generation status, and `visualReady`. Client `applyVisual` always runs `fitFrames`, so Visual mode never appears even after successful generation and reload.

### Observability

Visual endpoints largely return success or failure without bounded phase events. The UI can open a frame after generation without explaining partial/failed outcomes beyond a brief notice, and client fitting failures are silent.

## Decisions

### D1: Explicit project style seed

**Decision**: Persist one style seed per material state from the first approved base-anchor output. Do not rotate it.

**Rationale**: Matches the owner's recommended baseline and eliminates rediscovery drift.

**Alternatives rejected**: Continue “earliest approved except self”; allow silent reseeding on later approvals; build a style-picker UI in this slice.

### D2: Preserve visual panel fields through overflow

**Decision**: Overflow/fitting copies full panel objects and recomputes `visualReady` from preserved `assetId`s. Dialogue split pieces share the same visual assignments.

**Rationale**: Proven root cause of invisible frames; placement-only dialogue pieces must not invent a second generation path.

**Alternatives rejected**: Bypass fitting for visual frames; store fitted frames server-side; regenerate after fitting.

### D3: Safe structured visual logging

**Decision**: Extend existing `logLine` allowlisting with visual-phase events and safe fields only.

**Rationale**: Reuses the server's allowlisted logger pattern from Interpret/Stage.

## Reference-limit policy

Provider max three images for anchors:

1. Identity is mandatory.
2. Previous candidate is mandatory for a revision.
3. Style seed is included when distinct from identity and previous; if the seed equals the previous candidate for the seed character, style authority remains in prompt text and the previous image represents both continuity and style.
