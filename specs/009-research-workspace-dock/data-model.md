# Data model: Research workspace dock

PostgreSQL remains the durable store for this slice’s research evidence. Product tables are unchanged. Research evidence is append-only and is never a source of product state, revision history, or operation recovery.

Normative HTTP shapes: [contracts/research-api.md](./contracts/research-api.md). Event JSON shape: [contracts/research-event.schema.json](./contracts/research-event.schema.json).

## Why a persistent entity is required

| Spec need | Why smaller reuse fails |
| --- | --- |
| FR-024/025 reload **and** application restart | Browser-only storage is not the Compose volume boundary; app-container files are ephemeral without a new volume |
| FR-022 one authoritative ordering + action/result association | Dual stores (Notes table + separate log) create dual clocks; memory loses restart |
| FR-029 raw owner text in a separate research path | Must not enter sanitized operational logs or product JSON columns |
| FR-033 honest save failure + testability | DI store + SQL insert failure is already the project’s proven pattern |

Rejected alternatives and detail: [research.md](./research.md).

## Write rules

| Table | Insert | Update | Delete |
| --- | --- | --- | --- |
| Existing product tables | unchanged | unchanged | unchanged |
| `research_event` | yes (append only) | no | no |

No note edit/delete. No compaction job. No foreign keys into product tables that would cascade or imply ownership of storyboard/visual rows (IDs may be recorded as opaque context strings/uuids only).

## Migration

`app/storyboard-web/db/migrations/005_research_workspace_dock.sql` — one table, applied by existing `migrate.mjs`.

## Entity: `research_event`

One ordered local research trace entry (and Notes messages when `event_kind = note`).

| Field | Type | Required by | Notes |
| --- | --- | --- | --- |
| `seq` | `bigserial` PK | FR-022 | Authoritative total order for extraction and history projections |
| `id` | `uuid` UNIQUE | identity | Client may supply; server accepts or assigns |
| `occurred_at` | `timestamptz` | FR-019 | Server `clock_timestamp()` at insert; ordering uses `seq`; duration uses these server timestamps |
| `event_kind` | `text` CHECK | FR-019 | `note` \| `action_start` \| `action_terminal` |
| `semantic_action` | `text` CHECK | FR-019, action matrix | Closed enum (below), includes `cast_edit` |
| `correlation_id` | `uuid` NULL | FR-022 | Required for `action_start` / `action_terminal`; NULL for `note` |
| `surface` | `text` CHECK | FR-020 | `dock_notes` \| `dock_commands` \| `product_control` |
| `submitted_text` | `text` NULL | FR-029, FR-021 | Raw owner/product submitted text when the action has text; never logged via `logLine`; subject to protected-content validation before insert |
| `command_target` | `jsonb` NULL | FR-008–FR-011 | Actual **Commands / storyboard-panel** target snapshot (not ambient-only context; not cast edits) |
| `edit_target` | `jsonb` NULL | FR-019/020 cast coverage | Fixed-key cast-edit descriptor; used only with `cast_edit` |
| `context` | `jsonb` NOT NULL | FR-014, FR-023 | Fixed-key capture-time context; missing keys present as JSON `null` |
| `outcome` | `text` NULL | FR-016, FR-032 | NULL for note/start; terminal: `success` \| `failure` \| `blocked` |
| `outcome_flags` | `jsonb` NOT NULL DEFAULT `{}` | FR-018 | Allowlisted flags only, e.g. `{ "retainedLastGoodImage": true, "evidenceIncomplete": true }` |
| `outcome_kind` | `text` NULL | FR-032 | Compact safe failure/blocked kind (`provider`, `invalid-request`, `protected-content`, …); no provider bodies; never echoes rejected secrets |
| `duration_ms` | `integer` NULL | FR-019 | Set on terminal only when a matching start row exists; derived from server `occurred_at` values; null when start absent/incomplete |

There is **no** `research_error` column. Research-save failures remain transient honest HTTP/UI failures.

### Constraints and indexes (each justified)

- `CHECK (event_kind IN (...))` — closed taxonomy (FR-019; no arbitrary payload types).
- `CHECK (semantic_action IN (...))` — closed action matrix including `cast_edit`.
- `CHECK (surface IN (...))` — dock vs product-control distinction (FR-020).
- `CHECK ((event_kind = 'note' AND correlation_id IS NULL) OR (event_kind <> 'note' AND correlation_id IS NOT NULL))` — notes are unpaired; actions correlate.
- `CHECK ((event_kind = 'action_terminal' AND outcome IS NOT NULL) OR (event_kind <> 'action_terminal' AND outcome IS NULL))` — terminal honesty.
- `CHECK ((semantic_action = 'cast_edit' AND edit_target IS NOT NULL) OR (semantic_action <> 'cast_edit' AND edit_target IS NULL))` — cast edits use `edit_target` only.
- **No** universal `char_length(submitted_text) <= 8000` check — would reject product-accepted drafts at `reading` capture (FR-019/021). Request-size protection is the existing HTTP body limit (`413`), with no silent truncation.
- **Partial unique index** `UNIQUE (correlation_id) WHERE event_kind = 'action_start'` — at most one start per correlation (FR-022).
- **Partial unique index** `UNIQUE (correlation_id) WHERE event_kind = 'action_terminal'` — at most one terminal per correlation (FR-022).
- Index `(event_kind, seq)` — Notes history filter (FR-013/FR-025).
- Index `(surface, seq)` — Commands-history projection (`dock_commands`).
- No index implied for full-text search (analysis out of scope).

### Closed `semantic_action` values

| semantic_action | Typical surfaces | Text / value captured? |
| --- | --- | --- |
| `note` | `dock_notes` | yes (`submitted_text`) |
| `reading` | `product_control` | yes — **full draft** at “Разобрать черновик” submit only (not autosave keystrokes) |
| `confirm_material` | `product_control` | no (button action; no free text) |
| `stage_storyboard` | `product_control` | no |
| `cast_edit` | `product_control` | yes — submitted/selected owner value only; details in `edit_target` |
| `structure_edit` | `product_control`, `dock_commands` | yes (instruction; existing product cap 4000 on Structure edit path) |
| `structure_undo` | `product_control` | no |
| `identity_save` | `product_control` | yes (comment only; **never** image/data URL) |
| `anchor_generate` | `product_control` | yes (instruction) |
| `anchor_approve` | `product_control` | no |
| `frame_generate` | `product_control` | no (button; no instruction field on frame generate) |
| `panel_generate` | `product_control`, `dock_commands` | yes (instruction; performance image omitted) |
| `placement_commit` | `product_control` | no text; `command_target` may carry zoom/position numbers only |
| `visual_approve` | `product_control` | no |

### `command_target` object (actual Commands / visual target)

Used for storyboard/panel/frame/placement/identity/anchor targets. **Not** used for cast edits.

```json
{
  "kind": "storyboard" | "panel" | "frame" | "character" | "none",
  "displayFrameNumber": null,
  "displayFrameId": null,
  "structureFrameId": null,
  "structureSegmentIndex": null,
  "panelIndex": null,
  "zoom": null,
  "positionX": null,
  "positionY": null,
  "characterName": null,
  "anchorVersionId": null
}
```

Storyboard-wide Structure edit uses `kind: "storyboard"` even when a frame/panel is ambient in `context`. Panel commands use `kind: "panel"` with both display and structure identities when available.

### `edit_target` object (cast corrections only)

```json
{
  "editKind": "character_rename" | "alias_assignment" | "speaker_assignment",
  "castPhase": "pending_reading" | "material_state",
  "characterName": null,
  "previousCharacterName": null,
  "surfaceForm": null,
  "sourceItemId": null
}
```

| editKind | submittedText | Required edit_target fields |
| --- | --- | --- |
| `character_rename` | new character name | `characterName` (= new), `previousCharacterName` when known |
| `alias_assignment` | selected character name | `surfaceForm`, `characterName` |
| `speaker_assignment` | selected character name | `sourceItemId`, `characterName` |

`castPhase = pending_reading` when `saveCast()` uses `PUT /api/readings/:id/cast`; `material_state` when it uses `POST /api/material-states`. Do not persist the full cast arrays.

### `context` object (capture-time; fixed keys)

All keys always present; unavailable values are JSON `null`:

| Key | Meaning |
| --- | --- |
| `workflowPhase` | `draft` \| `reading` \| `material` \| `structure` \| `characters` \| `visual` \| `approved` \| null |
| `storyboardVersionId` | active visual storyboard version id if known |
| `displayFrameNumber` | 1-based number as shown in the UI |
| `displayFrameId` | expanded/display frame id |
| `structureFrameId` | underlying structure frame id (`expandStoryboardFrames`) |
| `structureSegmentIndex` | segment index or null |
| `panelIndex` | 0-based panel index or null |
| `panelSubject` | character subject string or null |
| `imageAssetId` | last-good/current asset id if known (id only) |
| `generationId` | current/last generation id if known (id only) |
| `characterName` | for identity/anchor actions |
| `anchorVersionId` | for anchor actions |

Later navigation must not update historical rows (FR-023). Terminals copy context from the stored start (or from client `startSnapshot` when start is absent).

### Correlation and terminal derivation rules

1. Inserting a second `action_start` or second `action_terminal` for the same `correlation_id` fails (`400 invalid-request` / unique violation mapped to invalid-request).
2. When a start row exists for `correlation_id`, terminal insert **ignores** client-supplied `semanticAction`, `surface`, `commandTarget`, `editTarget`, `context`, and `submittedText` for persistence and uses the start row’s values; client may send outcome fields only. `duration_ms = terminal.occurred_at - start.occurred_at` in milliseconds.
3. When no start row exists, terminal is accepted only with a complete `startSnapshot` (same allowlisted start fields); stored terminal copies those snapshot fields; `duration_ms` is null; `outcome_flags.evidenceIncomplete = true`. This is incomplete evidence, not recovery.
4. Mismatched client terminal metadata that disagrees with a stored start is not applied; if a client sends a conflicting `semanticAction` while a start exists, the write still stores start-derived fields (or rejects with `invalid-request` if the implementation chooses strict reject — either is acceptable if tests prove navigation cannot relabel; prefer **derive-from-start**).

## Protected-content validation (column values)

Before any insert that includes `submitted_text` or text-bearing `edit_target` values, apply the bounded server-side policy in [research.md](./research.md) / [contracts/research-api.md](./contracts/research-api.md). Rejection stores nothing.

## Non-events (explicit)

Do **not** create research rows for:

- keystrokes / unsent drafts / draft autosave pulses (`draft-autosave.mjs`)
- zoom/placement `input` scrubbing (only committed `change` → `placement_commit`)
- pointer moves, hover, scroll
- fetch retries inside a single user action (no retry orchestration layer)
- operational `logLine` traffic
- every intermediate cast keystroke before a successful `saveCast()`

Source-text edits in the draft textarea are captured only as the full draft on the next `reading` submit.

## Derived client projections (not tables)

- **Notes history**: `event_kind = note` ordered by `seq` (must survive reload/restart).
- **Commands history**: events with `surface = dock_commands` ordered by `seq` (independent of Notes; derived from the same trace; open-page/in-session projection required; durable Commands-history return after restart is not required by the approved scenario).
- **Operations live**: in-page busy latch only.
- **Operations history**: `action_terminal` rows (plus optional display of interrupted unpaired starts as non-running historical gaps — never as live jobs).
- **Extraction**: full table ordered by `seq`.

## Relationship to product persistence

Research rows may mention product ids for context. They do not participate in product transactions. Product success/failure is decided by existing routes/stores; research appends are separate and may fail independently (see failure policy in [research.md](./research.md)).
