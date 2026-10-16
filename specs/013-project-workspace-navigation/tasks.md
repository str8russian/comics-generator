# Tasks: Project workspace navigation

## Migration and persistence

- [x] T001 Prove a populated pre-013 schema migrates to one project and keeps draft text, revision ids, material state, storyboard heads, asset bytes, current assignments, accepted anchors, provenance, placement, and research rows without duplicates.
- [x] T002 Prove a fresh database still initializes, a second project is an explicit create, and title, `updated_at`, and `last_opened_at` move separately.

## Isolation

- [x] T003 Prove project B cannot read or mutate project A's draft, cast, storyboard, assets, anchors, provenance, renders, Notes, Commands, or Operations, and that an unknown id does not open A.
- [x] T004 Prove asset reuse is limited to the open project and that an async render completion stays on the initiating project.

## UI and routing

- [x] T005 Serve `/` as the list with `Новый проект` and `Продолжить`, and serve `/projects/{projectId}` as the workspace with title and `Проекты`.
- [x] T006 Show not-found for a bad id, keep rename off the source text, and require an explicit `Продолжить` click.

## Checkpoint

- [x] T007 Run the offline suite, the PostgreSQL lane, and the affected Feature 011 and 012 regressions.
- [x] T008 Back up the owner database outside Git, migrate it, and walk the browser Product Gate with zero provider calls.
