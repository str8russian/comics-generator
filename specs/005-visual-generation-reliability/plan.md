# Implementation Plan: Visual Generation Reliability

**Branch**: `codex/visual-generation-reliability` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-visual-generation-reliability/spec.md`

## Summary

Repair three vertical paths in the existing visual storyboard app:

1. Persist and reuse one project style seed so character anchors share one rendering language.
2. Keep generated panel assets through client fitting/overflow so Visual mode appears and survives reload.
3. Add in-workflow Russian progress/failure feedback and safe structured logs while completing those paths.

## Technical Context

**Language/Version**: Node.js 24, ESM (`.mjs`), browser JavaScript module `public/app.js`

**Primary Dependencies**: existing `pg`, Node `http` server, contest image provider adapter

**Storage**: local PostgreSQL (`comics` for walkthrough, `comics_test` for destructive tests)

**Testing**: `node:test` under `app/storyboard-web/test/**/*.test.mjs`; PostgreSQL files require `STORYBOARD_TEST_DATABASE_URL` naming `comics_test`

**Target Platform**: local Docker Compose database plus `app/storyboard-web/server.mjs` on `127.0.0.1:4174`

**Project Type**: web application (existing `app/storyboard-web/`)

**Performance Goals**: no batch generation; one frame at a time; short feedback loops for start/success/failure

**Constraints**: identity/style/performance authority separation; no product-memory/main-checkout/image-spike edits; no fidelity weakening; Russian UI copy stays Russian; no style-management UI

**Scale/Scope**: one migration, store/server/client changes, overflow metadata preservation, regression tests, browser verification

## Constitution Check

The repository constitution is still an unfilled template. This feature follows product principles in specs 003–004 and the owner brief: non-technical UI, short feedback loops, authority separation, recoverable versions, and tests that do not hide failures.

Post-design re-check: one new project-level table, no second app, no batch/video/dialogue-edit scope expansion.

## Project Structure

### Documentation (this feature)

```text
specs/005-visual-generation-reliability/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── visual-reliability-api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
app/storyboard-web/
├── db/migrations/004_project_style_seed.sql
├── overflow.mjs
├── visual-store.mjs
├── visual-model.mjs
├── server.mjs
├── public/app.js
└── test/
    ├── overflow.test.mjs
    ├── visual-model.test.mjs
    ├── visual-workflow.test.mjs
    └── postgres/visual-isolation.test.mjs
```

**Structure Decision**: Extend `app/storyboard-web/` only.

## Complexity Tracking

No constitution violations. Persisting a style seed is smaller and safer than continuing dynamic rediscovery.
