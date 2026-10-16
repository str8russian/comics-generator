# Plan: Project workspace navigation

## Path

Keep the existing storyboard application. Remove the singleton constraint, address every product route with `/api/projects/{projectId}/...`, and make `/` the project list.

1. Migration `011_project_workspace.sql` adds title and timestamps, drops the singleton constraint, and sets `project_id` on `source_revision`, `reading`, `visual_asset`, and `research_event`. Child rows stay owned through those roots or through `material_state` → `source_revision`.
2. Store queries take the project id from the request scope. They do not select `singleton = true`.
3. The page `/projects/{projectId}` serves the current workspace. `/` serves the list. Malformed ids serve a small not-found page.
4. The render controller keeps one in-memory result per project id, written under that id, including when the completion runs after the response.

## Checkpoint

The browser path in `spec.md` against the worktree server on `http://127.0.0.1:4173/`, after the migration has been proved on `comics_test` and the owner database has a backup outside Git.

## Tests

Focused migration, isolation, and route tests first. Then the offline `app/storyboard-web` suite, the PostgreSQL lane with `STORYBOARD_TEST_DATABASE_URL`, and the Feature 011 and 012 suites affected by routing. No live provider calls.

## Out of this path

No new render-history table, no research-dock redesign, and no change to prompts, geometry, or provider configuration.
