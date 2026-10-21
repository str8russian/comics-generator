# Project duplication

## Status

Production contract for Feature 017. One owner-operated browser checkpoint. This does not add project deletion, export, templates, or a shared asset library.

## Entry

**Дублировать проект** is on every project card at `/` and in the open project workspace.

The action opens a confirmation form. The form is a dialog: the title field receives focus, Tab reaches the field and the actions, Enter submits, and Escape cancels. The field is labeled **Название копии**. Its initial value is `Копия — <исходное название>`. That value is shortened to the existing 120-character title limit only when the full string would exceed it, and the cut does not split a character. The owner can edit the field before submitting.

**Отмена**, closing the dialog, or Escape creates nothing and leaves the current page in place. **Создать копию** creates exactly one duplicate and opens `/projects/{newProjectId}`. While the request is in flight, the field and both actions are disabled.

Repeating the action creates another independent project. The action is not idempotent.

## Request

`POST /api/projects/{sourceProjectId}/duplicate` with JSON `{ "title": string }`.

The source id comes from the route. The title is validated with the existing project-title rule: a non-empty string of at most 120 characters. Any other JSON field is ignored. In particular, a browser-supplied asset, revision, material, storyboard, anchor, or other internal id never selects what is copied.

| Result | Response |
| --- | --- |
| Created | `201` and the new project presentation: id, title, timestamps, snippet, and derived stage. `lastOpenedAt` is empty until the new project is opened. The stage is not **Готовое видео**. |
| Invalid title, wrong JSON, or a non-object body | `400` `invalid-request` |
| Unknown source | `404` `not-found` |
| Wrong method | `405` |
| Wrong content type | `415` |
| Database failure after the copy has started | truthful database failure, and the failed attempt leaves no project, draft, or asset |

Failure feedback stays on the source page or the list. It is in Russian and does not claim that a copy exists. Success feedback is the opened copy.

## What the copy contains

The copy is a new project with the submitted title, fresh timestamps, and no inherited open time. It has its own ids for every copied row. It is a snapshot of the source's current accepted working state, not its history.

The copy includes:

- the working draft text and a new revision token;
- when the source has active material: one new ready reading used only so the copied interpretation has a reading, the active source text, the interpretation rows linked to that source, one source revision with no parent, one material state with no parent, canonical names, `included`, aliases, and speaker assignments;
- project character exclusions;
- the latest checked storyboard for that material, its payload, and one active version with the current frames, dialogue modes, panel identities, frame timing, and text-card state, plus a new head;
- the current panel rows for that version: subject, performance reference, current and assigned image meaning, zoom, pan, mirror, and current image;
- current character identity, the current approved anchor for each anchor head, the provenance needed for a ready upload or a source photo, and the current style seed. The seed keeps the exact anchor that established it. When that anchor is still a current head, the copy reuses that head. When it is an older approved anchor, the copy adds that one anchor as a destination row with a new id, no parent, no provider metadata, and no head, and points the seed at that row. Its identity, output, and style assets are new destination-owned rows. If that exact anchor cannot be loaded, is not approved, or its seed asset cannot be copied, duplication fails and rolls back;
- the current Visual approval only when that copied visual state is approved. Its snapshot refers only to copied asset ids and still matches the copied current state;
- a new project-owned asset for every asset reachable from that copied graph. Bytes, media metadata, kind, and accepted provenance are kept. Provenance ids that point at copied assets, anchors, or storyboards are remapped. Provenance ids that cannot be remapped are omitted.

The structural reading is not `project.current_reading_id` and does not carry pending cast or a failure.

## What the copy omits

- Notes, Commands, action trace, and every other research event;
- `current_reading_id`, pending cast, blocked, failed, or pending readings, locks, and other in-flight state;
- source revision history and material history before the active snapshot;
- storyboard parent versions, undo and redo, version instruction, and operation context;
- panel generation rows and generation history. `current_generation_id` is empty even when the current image bytes are copied;
- anchor candidates other than the current approved heads and, when needed, the single older approved anchor named by the current style seed. That seed dependency is not a head, a candidate, or a history chain. Parent anchor links and provider operation metadata are omitted;
- render controller state, render files, prior MP4, render history, and the remembered transition or intro choice;
- any unapproved temporary candidate not listed above.

The source project is not modified: not its title, timestamps, heads, approvals, revisions, current render, or trace.

## Isolation

The copy runs in one database transaction over a consistent source snapshot. A failure rolls the whole attempt back. The project list never shows a partial destination.

Every copied asset has a new id owned by the destination. Asset bytes are not shared with the source, and there is no shared asset library. Destination rows do not reference source assets, material, storyboard, anchors, or heads. Deleting either project's rows leaves the other project able to load and serve its assets. This slice does not add a delete action in the product.

Asset reads, pickers, intro resolution, and render compilation stay project-scoped. The copy can be compiled and rendered through the existing flow. It has no prior render result. No language-model or image-provider call is made.

## Protected

Exact source wording, order, and speaker ownership stay. Explicit `spoken`, `silent`, and `hidden` modes stay. Blank-project creation, open, rename, continue, manual assembly, anchors, Visual approval, intro choice, compile, and render stay as they are. The duplicate is a new project with no permanent link back to the source. Editing either project afterward does not change the other.

## Out of scope

Export and import, templates, branches, linked variants, lineage, sharing, bulk copy, search, sorting, folders, thumbnails, permissions, queues, cancellation, and a project-delete UI or API. Also intro motion, render credits, Feature 014 source-edit debt, and provider quality.

## Owner checkpoint

Offline tests do not accept this feature. The owner uses the running application, without a model or image provider:

1. From the list, edit the proposed name and duplicate a populated project.
2. The new project opens at its own URL with that title and the same accepted Structure and Visual state.
3. Notes, Commands, Operations, undo, and the previous render preview or download are absent.
4. A visible change in the copy leaves the source unchanged. A different change in the source leaves the copy unchanged.
5. The copy reaches the existing compile or render path without a provider call and without the source MP4.
6. Duplicate from the list and from the project page, including the keyboard and one cancel that creates nothing.
