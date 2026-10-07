import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function draftInputError({ text, revisionToken }) {
  if (typeof text !== "string" || typeof revisionToken !== "string" || !UUID_PATTERN.test(revisionToken)) {
    return "invalid-request";
  }
  if (text.includes("\u0000") || hasUnpairedSurrogate(text)) return "invalid-request";
  return null;
}

function hasUnpairedSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function databaseFailure() {
  return { ok: false, httpStatus: 503, kind: "database" };
}

export async function loadProject(pool) {
  try {
    const draft = await pool.query(
      `SELECT project.active_source_revision_id,
              project.active_material_state_id,
              project.current_reading_id,
              working_draft.text,
              working_draft.revision_token
       FROM project
       JOIN working_draft ON working_draft.project_id = project.id
       WHERE project.singleton = true`,
    );
    if (draft.rowCount !== 1) return null;
    const row = draft.rows[0];
    const revisions = await pool.query(
      `SELECT id, parent_source_revision_id, created_at
       FROM source_revision
       ORDER BY created_at, id`,
    );
    const storyboards = await pool.query(
      `SELECT DISTINCT ON (storyboard_result.material_state_id)
              storyboard_result.material_state_id,
              material_state.source_revision_id,
              storyboard_result.status,
              (storyboard_result.status = 'checked'
               AND storyboard_result.material_state_id IS NOT DISTINCT FROM project.active_material_state_id) AS ready_eligible
       FROM storyboard_result
       JOIN material_state ON material_state.id = storyboard_result.material_state_id
       JOIN project ON project.singleton = true
       ORDER BY storyboard_result.material_state_id, storyboard_result.created_at DESC, storyboard_result.id DESC`,
    );
    return {
      draft: { text: row.text, revisionToken: row.revision_token },
      activeSourceRevisionId: row.active_source_revision_id,
      activeMaterialStateId: row.active_material_state_id,
      reading: null,
      sourceRevisions: revisions.rows.map((revision) => ({
        id: revision.id,
        parentSourceRevisionId: revision.parent_source_revision_id,
        createdAt: revision.created_at instanceof Date ? revision.created_at.toISOString() : revision.created_at,
      })),
      storyboards: storyboards.rows.map((storyboard) => ({
        materialStateId: storyboard.material_state_id,
        sourceRevisionId: storyboard.source_revision_id,
        status: storyboard.status,
        readyEligible: storyboard.ready_eligible === true,
      })),
    };
  } catch {
    return null;
  }
}

export async function saveDraft(pool, input) {
  if (draftInputError(input)) {
    return { ok: false, httpStatus: 400, kind: "invalid-request" };
  }
  try {
    const nextToken = randomUUID();
    const updated = await pool.query(
      `UPDATE working_draft
       SET text = $1, revision_token = $2, updated_at = now()
       WHERE revision_token = $3`,
      [input.text, nextToken, input.revisionToken],
    );
    if (updated.rowCount !== 1) {
      return { ok: false, httpStatus: 409, kind: "stale-draft" };
    }
    return { ok: true, httpStatus: 200, revisionToken: nextToken };
  } catch {
    return databaseFailure();
  }
}

export function createProjectStore(pool) {
  return {
    loadProject: () => loadProject(pool),
    saveDraft: (input) => saveDraft(pool, input),
  };
}
