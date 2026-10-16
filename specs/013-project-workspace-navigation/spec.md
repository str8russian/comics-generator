# Project workspace navigation

## Status

Accepted for one owner-operated browser checkpoint. This contract is the production semantics for Feature 013. It does not amend earlier feature specs; those workflows stay as they are and are reached through a project address.

## Product Gate

One continuous browser path, with no model or image-provider call:

1. Start from the existing populated singleton database.
2. Open `/` and see a project list that contains the migrated work.
3. Open that project and see its current stage and existing storyboard and visual state.
4. Return to `Проекты` and choose `Новый проект`.
5. Land on a stable `/projects/{projectId}` URL with an empty ready-dialogue draft.
6. Enter and persist a distinct draft in the new project.
7. Return to the list and reopen the migrated project.
8. The old state is intact and the new draft is absent from it.
9. Reload the old project URL and remain in that project.
10. Return to `/` and use `Продолжить` to reopen the last opened project.

`/` never opens a project by itself. `Продолжить` is an explicit click.

## Project

The user-facing entity is **Project**. A source dialogue is source-owned material inside a project. A rendered video is an output of a project, not the list entity.

Minimum metadata: stable id, title, `created_at`, `updated_at`, `last_opened_at`. No thumbnails, tags, folders, owners, permissions, share state, or arbitrary metadata.

- A new project starts titled `Новый проект`. The user can rename it. Dialogue text never rewrites a title.
- The migrated singleton starts as `Текущий ролик` and can be renamed.
- `updated_at` changes when content or the title changes. Opening changes only `last_opened_at`.
- The stage label is derived from persisted project state: `Черновик`, `Материал`, `Структура`, `Визуал`, `Подготовка видео`. `Готовое видео` is shown only while this process still has a successful render for that project. There is no second workflow state machine and no progress percentage.

`/` shows `Новый проект` (empty ready-dialogue meaning), one card per project (title, content-modification date, draft snippet when present, derived stage), and `Продолжить` on the project with the latest `last_opened_at`.

## Workspace

- `/projects/{projectId}` opens that project. Reload keeps it.
- The server serves the application for that route and does not fall back to another project.
- The workspace shows the current title and `Проекты`.
- Rename from the list or the workspace changes only the title and `updated_at`.
- An unknown or malformed id shows a minimal not-found result with a way back to `/` and does not open or mutate another project.

## New project

`Новый проект` creates one durable project and opens it with an empty ready-dialogue draft and none of another project's source revisions, interpretation, material, cast, storyboard, placement, assets, identity, anchors, provenance, style seed, timing, renders, Notes, Commands, or Operations. The existing ready-dialogue workspace remains the workspace. There is no reduced intake application.

## Ownership

Every read, mutation, asset selection, and derived output uses the project id in the request. There is no process-global, browser-global, or database-singleton current project.

Relational ancestry is enough where it is unambiguous. Direct `project_id` is added only on roots that are otherwise unowned: `source_revision`, `reading`, `visual_asset`, and `research_event`. A valid id from project A supplied while addressing project B is rejected. Asset bytes may stay in `visual_asset`, but project B cannot list or assign project A's asset. There is no shared Asset Library.

An operation result is written to the project that started it. Navigation does not retarget that write. This slice does not add cancellation, resume, retry, polling, or overlapping-operation recovery.

The in-memory render stays one current result per project. It is not a new render-history entity.

## Migration

The forward migration keeps the existing project id, drops only the singleton uniqueness constraint, adds the metadata above, and attaches every existing reachable source, material, storyboard, visual, asset, anchor, provenance, timing, and research row to that first project. Stored source text and image bytes stay byte-identical. Heads, accepted anchors, provenance, placement, duration, and current render visibility stay as they are. It creates no duplicate revisions, interpretations, assets, anchors, or projects. It runs once through the existing migration runner and fails instead of partially migrating contradictory ownership. The second project is created only by the user.

## Protected behavior

Exact source wording, order, speaker ownership, immutable Source Revisions, and source-linked Project Document behavior stay. So do character confirmation and Structure, Visual, and final approval boundaries; deterministic FrameRenderer geometry; Feature 011 manual assembly, placement, upload and reuse, duration, undo, render, and export; system-owned panel grammar and prompt compilation; project-owned current assets and last-good-image behavior; Feature 012 base-anchor creation, refinement, replacement, delete, and restore; Accept as the only current-anchor replacement; source-image provenance and no duplicate source insertion on accepted Refine; the 58-second server cap and 60-second browser deadline; sanitized logs and research evidence; and the current image-reference budget.

No provider call is made for list, create, open, rename, continue, or migration.

## Failures in this slice

Migration loss or duplication fails closed. Cross-project reads and mutations are rejected and both projects stay unchanged. A new project's asset picker and research dock do not show the other project. Async completion stays on the initiating project. An unknown URL does not open the migrated project. The owner's database is not migrated until a recoverable backup exists outside Git.

## Deferred

Delete, archive, duplicate, search, folders, filters, sorting, tags, thumbnails, automatic open, accounts, teams, permissions, sharing changes, cross-project libraries, revision browsers on cards, a separate last-render badge, multi-tab conflict resolution, cancellation and resume, render queues and retention, Block C speaking and listening work, Block D editing, and external-user retention or deployment changes.
