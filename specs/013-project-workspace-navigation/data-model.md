# Data model: Project ownership

## Project

`project` is no longer unique on `singleton`.

| Column | Meaning |
| --- | --- |
| `id` | Stable id. The migrated row keeps `00000000-0000-4000-8000-000000000001` when that is the existing id. |
| `title` | `Текущий ролик` for that migrated row. `Новый проект` for a user-created row until renamed. |
| `created_at` | Set once. |
| `updated_at` | Content or title change. Not an open. |
| `last_opened_at` | Set only when the workspace is opened. Null until then. |
| `active_source_revision_id`, `active_material_state_id`, `current_reading_id` | Unchanged pointers. Each target must belong to this project. |

`singleton` is dropped.

## Ownership map

Direct `project_id` is only on roots that had no reliable parent.

| Artifact | Resolution |
| --- | --- |
| Working draft | `working_draft.project_id` |
| Reading, pending cast | `reading.project_id` |
| Source Revision | `source_revision.project_id`. Parent links stay inside that project. |
| Interpretation, source items, provisional characters, surface forms | `interpretation.source_revision_id` |
| Material state, canonical cast, aliases, speakers | `material_state.source_revision_id` |
| Storyboard result | `storyboard_result.material_state_id` |
| Storyboard version and head | `storyboard_version.storyboard_result_id` and `storyboard_head` |
| Panel visual state, placement, duration, current asset assignment | `panel_visual_state.storyboard_version_id`. Duration and placement remain in the version frames and panel row. |
| Panel generation | `panel_generation.panel_visual_state_id` |
| Visual approval | `visual_approval.storyboard_version_id` |
| Visual asset, including upload and reuse rows | `visual_asset.project_id`. Same bytes in another project are a different row. |
| Character identity | `character_identity.material_state_id` |
| Anchor version, provenance, source asset | `character_anchor_version.material_state_id` |
| Anchor head | `character_anchor_head.material_state_id` |
| Project style seed | `project_style_seed.material_state_id` |
| Timing and Video Spec | Derived at read time from the project's active storyboard. Not a stored singleton. |
| Render output | Process memory and `{outputDir}/{projectId}/current.mp4`. Not a table. |
| Notes, Commands, Operations | `research_event.project_id` |

A foreign id used while addressing another project fails the owning join or the `project_id` predicate. It is not attached and not ignored as success.

## Migration rule

If the database is empty of projects and of those root artifacts, the migration only removes the singleton constraint. If there is exactly one project, every existing root row is assigned to it and contradictory pointers abort the transaction. Any other project count aborts. The migration does not insert a second project.
