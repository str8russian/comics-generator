# Implementation Plan: Visual Storyboard Repair

**Branch**: `codex/visual-workflow-repair` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-visual-storyboard-repair/spec.md`

## Summary

Repair two already-specified visual-workflow paths that fail in the current prototype: numbered structural storyboard editing with undo, and local identity-photo intake. Keep the existing application in `app/storyboard-web/`. Do not redesign the rest of the product.

Evidence from the stored 18-frame storyboard:

- `POST /api/visual/storyboard/edit` returns `409` `{ status: "blocked", failures: [{ code: "unaccounted-source-item", sourceItemId: "item-1" }] }`. `item-1` is a context item that Stage already placed in review. The edit path sends `currentStoryboard.review: []`, so the model omits it, fidelity blocks, and the UI falls back to “Не удалось выполнить действие.”
- Visible frame 14 is structure `frame-12`, not `frame-14`, because `frame-1` is a three-segment directing beat. The reported instruction must target that visible unit.
- `POST /api/visual/characters/Путин/identity` returns `400` `{ status: "failed", kind: "invalid-request" }` for a valid 1×1 PNG. `parseImageDataUrl` returns `buffer`, while `saveIdentity` requires `image.bytes`. The UI does not map `invalid-request`, so the user sees the generic fallback.

## Technical Context

**Language/Version**: Node.js 24, ESM (`.mjs`), browser JavaScript module `public/app.js`

**Primary Dependencies**: existing `pg`, `ajv`, Node `http` server, configured contest text and image providers

**Storage**: local PostgreSQL (`comics`), append-only `storyboard_version` / `visual_asset` / `character_identity`

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL files skip unless `STORYBOARD_TEST_DATABASE_URL` names `comics_test`

**Target Platform**: local Docker Compose database plus `app/storyboard-web/server.mjs` on `127.0.0.1:4174`

**Project Type**: web application (existing `app/storyboard-web/`)

**Performance Goals**: identity save is local and immediate; a simple numbered full-frame command does not wait on a model rewrite of the whole board

**Constraints**: no unbounded retry; no fidelity weakening; no identity bytes to the image provider; no Stage-prompt change unless evidence requires it (it does not); existing Russian UI copy stays Russian; no product-memory, main-checkout, or image-spike edits

**Scale/Scope**: two vertical slices, two repaired endpoints, client error mapping, regression tests, browser verification of the stored storyboard

## Constitution Check

The repository constitution at `.specify/memory/constitution.md` is still an unfilled template. This repair follows the product principles in the specification, `docs/HANDOFF.md`, and specs 001–003: source fidelity stays authoritative, the UI stays non-technical, provider calls stay explicit, and tests must not hide failures as success.

Post-design re-check: no new service, no schema redesign, no Stage-prompt change, no fidelity removal. Deterministic handling is limited to simple numbered full-frame-only-character commands. Review accounting is restored locally because it is already a source-item invariant, not a loosened check.

## Project Structure

### Documentation (this feature)

```text
specs/004-visual-storyboard-repair/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── visual-repair-api.md
└── tasks.md
```

### Source Code (repository root)

```text
app/storyboard-web/
├── storyboard-edit.mjs
├── image-info.mjs
├── visual-store.mjs
├── visual-model.mjs
├── server.mjs
├── public/app.js
├── public/index.html
└── test/
    ├── storyboard-edit.test.mjs
    ├── visual-workflow.test.mjs
    ├── visual-model.test.mjs
    └── postgres/visual-isolation.test.mjs
```

**Structure Decision**: Extend the existing `app/storyboard-web/` application. Do not add a second app directory.

## Complexity Tracking

No constitution violations. The deterministic structural handler is additional logic, not a new project: it avoids an unbounded model retry while keeping fidelity checks on the resulting frames.
