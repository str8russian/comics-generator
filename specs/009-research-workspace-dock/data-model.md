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
| `seq` | `bigserial` PK | FR-022 | Authoritative total order for extraction and Notes history |
| `id` | `uuid` UNIQUE | identity | Client may supply; server accepts or assigns |
| `occurred_at` | `timestamptz` | FR-019 | Server `clock_timestamp()` at insert (capture time for persistence); client may also send `client_occurred_at` for display only if needed, but ordering uses `seq` |
| `event_kind` | `text` CHECK | FR-019 | `note` \| `action_start` \| `action_terminal` |
| `semantic_action` | `text` CHECK | FR-019, action matrix | Closed enum (below) |
| `correlation_id` | `uuid` NULL | FR-022 | Required for `action_start` / `action_terminal`; NULL for `note` |
| `surface` | `text` CHECK | FR-020 | `dock_notes` \| `dock_commands` \| `product_control` |
| `submitted_text` | `text` NULL | FR-029, FR-021 | Raw owner/product submitted text when the action has text; never logged via `logLine` |
| `command_target` | `jsonb` NULL | FR-008–FR-011 | Actual command target snapshot (not ambient-only context) |
| `context` | `jsonb` NOT NULL | FR-014, FR-023 | Fixed-key capture-time context; missing keys present as JSON `null` |
| `outcome` | `text` NULL | FR-016, FR-032 | NULL for note/start; terminal: `success` \| `failure` \| `blocked` |
| `outcome_flags` | `jsonb` NOT NULL DEFAULT `{}` | FR-018 | Allowlisted flags only, e.g. `{ "retainedLastGoodImage": true }` |
| `outcome_kind` | `text` NULL | FR-032 | Compact safe failure/blocked kind already used by product (`provider`, `invalid-request`, …); no provider bodies |
| `duration_ms` | `integer` NULL | FR-019 | Set on terminal when matching start exists; non-negative |
| `research_error` | `text` NULL | FR-033 | Not stored on successful rows; clients learn save failures from HTTP. Reserved only if a later terminal needs to record `evidence_incomplete` without implying product failure — prefer omitting the terminal row on evidence-save failure instead |

### Constraints and indexes (each justified)

- `CHECK (event_kind IN (...))` — closed taxonomy (FR-019; no arbitrary payload types).
- `CHECK (semantic_action IN (...))` — closed action matrix.
- `CHECK (surface IN (...))` — dock vs product-control distinction (FR-020).
- `CHECK ((event_kind = 'note' AND correlation_id IS NULL) OR (event_kind <> 'note' AND correlation_id IS NOT NULL))` — notes are unpaired; actions correlate.
- `CHECK ((event_kind = 'action_terminal' AND outcome IS NOT NULL) OR (event_kind <> 'action_terminal' AND outcome IS NULL))` — terminal honesty.
- `CHECK (submitted_text IS NULL OR char_length(submitted_text) <= 8000)` — bound abuse; Structure edit already caps ~4000.
- Index `(correlation_id, event_kind)` — resolve start→terminal and duration (FR-022).
- Index `(event_kind, seq)` — Notes history filter (FR-013/FR-025).
- No index implied for full-text search (analysis out of scope).

### Closed `semantic_action` values

| semantic_action | Typical surfaces | Text captured? |
| --- | --- | --- |
| `note` | `dock_notes` | yes (`submitted_text`) |
| `reading` | `product_control` | yes (draft text at “Разобрать черновик” submit only — not autosave keystrokes) |
| `confirm_material` | `product_control` | no (button action; no free text) |
| `stage_storyboard` | `product_control` | no |
| `structure_edit` | `product_control`, `dock_commands` | yes (instruction) |
| `structure_undo` | `product_control` | no |
| `identity_save` | `product_control` | yes (comment only; **never** image/data URL) |
| `anchor_generate` | `product_control` | yes (instruction) |
| `anchor_approve` | `product_control` | no |
| `frame_generate` | `product_control` | no (button; no instruction field on frame generate) |
| `panel_generate` | `product_control`, `dock_commands` | yes (instruction; performance image omitted) |
| `placement_commit` | `product_control` | no text; target carries zoom/position numbers only |
| `visual_approve` | `product_control` | no |

### `command_target` object (actual target)

```json
{
  "kind": "storyboard" | "panel" | "none",
  "displayFrameNumber": null,
  "displayFrameId": null,
  "structureFrameId": null,
  "structureSegmentIndex": null,
  "panelIndex": null
}
```

Storyboard-wide Structure edit uses `kind: "storyboard"` even when a frame/panel is ambient in `context`. Panel commands use `kind: "panel"` with both display and structure identities when available.

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

Later navigation must not update historical rows (FR-023).

## Non-events (explicit)

Do **not** create research rows for:

- keystrokes / unsent drafts / draft autosave pulses (`draft-autosave.mjs`)
- zoom/placement `input` scrubbing (only committed `change` → `placement_commit`)
- pointer moves, hover, scroll
- fetch retries inside a single user action (no retry orchestration layer)
- operational `logLine` traffic

## Derived client projections (not tables)

- **Notes history**: `event_kind = note` ordered by `seq`.
- **Operations live**: in-page busy latch only.
- **Operations history**: `action_terminal` rows (plus optional display of interrupted unpaired starts as non-running historical gaps — never as live jobs).
- **Extraction**: full table ordered by `seq`.

## Relationship to product persistence

Research rows may mention product ids for context. They do not participate in product transactions. Product success/failure is decided by existing routes/stores; research appends are separate and may fail independently (see failure policy in [research.md](./research.md)).
