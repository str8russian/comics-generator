# Project API

Unscoped product routes are not served. `/api/build` and the legacy `/api/storyboard` route stay unscoped because they do not read or write a project.

## Collection

- `GET /api/projects` → `{ projects, continueProjectId }`. Each project has `id`, `title`, `createdAt`, `updatedAt`, `lastOpenedAt`, `snippet`, `stage`.
- `POST /api/projects` → `201` and the new project. No provider call. Body is ignored.

## One project

- `GET /api/projects/{projectId}` → the existing workspace document plus `id`, `title`, `createdAt`, `updatedAt`, `lastOpenedAt`. Missing id → `404` `{ status: "failed", kind: "not-found" }`.
- `PATCH /api/projects/{projectId}` with `{ title }` → `{ id, title, updatedAt }`. Title is a non-empty string up to 120 characters. This does not change the draft.
- `POST /api/projects/{projectId}/open` → `{ id, lastOpenedAt }` and does not change `updatedAt`.

## Existing workspace routes

The previous `/api/...` paths are the same under `/api/projects/{projectId}`. Examples: `/draft`, `/readings`, `/visual`, `/visual/assets/{assetId}`, `/visual/render`, `/research/notes`, `/research/trace`.

A resource id that belongs to another project is `404` or the existing rejection for a missing resource. It is not applied to the addressed project.

## Pages

- `GET /` → project list. No redirect.
- `GET /projects/{projectId}` → workspace application.
- Any other `/projects/...` path → not-found HTML with a link to `/`.
