import { randomUUID } from "node:crypto";
import { duplicateProject as copyCurrentProject } from "./project-duplicate.mjs";
import { normalizeTitle, PROJECT_ID_PATTERN } from "./project-scope.mjs";

const NEW_PROJECT_TITLE = "Новый проект";

function databaseFailure() {
  return { ok: false, httpStatus: 503, kind: "database" };
}

function notFound() {
  return { ok: false, httpStatus: 404, kind: "not-found" };
}

function invalidRequest() {
  return { ok: false, httpStatus: 400, kind: "invalid-request" };
}

export function snippetFromDraft(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= 120) return flat;
  return `${flat.slice(0, 117)}…`;
}

export function deriveStage({
  hasMaterial = false,
  hasStoryboard = false,
  hasVisual = false,
  visualApproved = false,
  renderReady = false,
} = {}) {
  if (renderReady) return "Готовое видео";
  if (visualApproved) return "Подготовка видео";
  if (hasVisual) return "Визуал";
  if (hasStoryboard) return "Структура";
  if (hasMaterial) return "Материал";
  return "Черновик";
}

function iso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function presentRow(row, renderReady) {
  return {
    id: row.id,
    title: row.title,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastOpenedAt: iso(row.last_opened_at),
    snippet: snippetFromDraft(row.draft_text),
    stage: deriveStage({
      hasMaterial: row.has_material,
      hasStoryboard: row.has_storyboard,
      hasVisual: row.has_visual,
      visualApproved: row.visual_approved,
      renderReady,
    }),
  };
}

export async function listProjects(pool, { renderReadyProjectIds = [] } = {}) {
  try {
    const result = await pool.query(`
      SELECT project.id,
             project.title,
             project.created_at,
             project.updated_at,
             project.last_opened_at,
             working_draft.text AS draft_text,
             (project.active_material_state_id IS NOT NULL) AS has_material,
             EXISTS (
               SELECT 1
               FROM storyboard_result
               WHERE storyboard_result.material_state_id = project.active_material_state_id
                 AND storyboard_result.status = 'checked'
             ) AS has_storyboard,
             EXISTS (
               SELECT 1
               FROM storyboard_result
               JOIN storyboard_head ON storyboard_head.storyboard_result_id = storyboard_result.id
               JOIN storyboard_version ON storyboard_version.id = storyboard_head.active_storyboard_version_id
               LEFT JOIN panel_visual_state
                 ON panel_visual_state.storyboard_version_id = storyboard_version.id
               WHERE storyboard_result.material_state_id = project.active_material_state_id
                 AND storyboard_result.status = 'checked'
                 AND (
                   panel_visual_state.current_asset_id IS NOT NULL
                   OR EXISTS (
                     SELECT 1
                     FROM character_anchor_head
                     WHERE character_anchor_head.material_state_id = project.active_material_state_id
                       AND character_anchor_head.anchor_version_id IS NOT NULL
                   )
                 )
             ) AS has_visual,
             EXISTS (
               SELECT 1
               FROM storyboard_result
               JOIN storyboard_head ON storyboard_head.storyboard_result_id = storyboard_result.id
               JOIN visual_approval
                 ON visual_approval.storyboard_version_id = storyboard_head.active_storyboard_version_id
               WHERE storyboard_result.material_state_id = project.active_material_state_id
                 AND storyboard_result.status = 'checked'
             ) AS visual_approved
      FROM project
      JOIN working_draft ON working_draft.project_id = project.id
      ORDER BY project.updated_at DESC, project.created_at DESC, project.id
    `);
    const ready = new Set(renderReadyProjectIds);
    const projects = result.rows.map((row) => presentRow(row, ready.has(row.id)));
    const opened = projects
      .filter((project) => project.lastOpenedAt)
      .sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? 1 : a.lastOpenedAt > b.lastOpenedAt ? -1 : 0));
    return {
      ok: true,
      httpStatus: 200,
      projects,
      continueProjectId: opened[0]?.id ?? null,
    };
  } catch {
    return databaseFailure();
  }
}

export async function createProject(pool) {
  const id = randomUUID();
  const token = randomUUID();
  let client;
  try {
    client = await pool.connect();
  } catch {
    return databaseFailure();
  }
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO project (id, title, created_at, updated_at)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp())`,
      [id, NEW_PROJECT_TITLE],
    );
    await client.query(
      `INSERT INTO working_draft (project_id, text, revision_token)
       VALUES ($1, '', $2)`,
      [id, token],
    );
    const row = await client.query(
      `SELECT id, title, created_at, updated_at, last_opened_at
       FROM project WHERE id = $1`,
      [id],
    );
    await client.query("COMMIT");
    const project = row.rows[0];
    return {
      ok: true,
      httpStatus: 201,
      project: {
        id: project.id,
        title: project.title,
        createdAt: iso(project.created_at),
        updatedAt: iso(project.updated_at),
        lastOpenedAt: null,
        snippet: null,
        stage: "Черновик",
      },
    };
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return databaseFailure();
  } finally {
    client.release();
  }
}

export async function duplicateProject(pool, sourceProjectId, title, options) {
  const copied = await copyCurrentProject(pool, sourceProjectId, title, options);
  if (!copied.ok) return copied;
  return {
    ok: true,
    httpStatus: 201,
    project: {
      id: copied.destinationId,
      title: copied.title,
      createdAt: copied.createdAt,
      updatedAt: copied.updatedAt,
      lastOpenedAt: null,
      snippet: snippetFromDraft(copied.draftText),
      stage: deriveStage({
        hasMaterial: copied.hasMaterial,
        hasStoryboard: copied.hasStoryboard,
        hasVisual: copied.hasVisual,
        visualApproved: copied.visualApproved,
        renderReady: false,
      }),
    },
  };
}

export async function renameProject(pool, projectId, title) {
  if (!PROJECT_ID_PATTERN.test(String(projectId ?? ""))) return notFound();
  const nextTitle = normalizeTitle(title);
  if (!nextTitle) return invalidRequest();
  try {
    const updated = await pool.query(
      `UPDATE project
       SET title = $2, updated_at = clock_timestamp()
       WHERE id = $1
       RETURNING id, title, updated_at`,
      [projectId, nextTitle],
    );
    if (updated.rowCount !== 1) return notFound();
    const row = updated.rows[0];
    return {
      ok: true,
      httpStatus: 200,
      id: row.id,
      title: row.title,
      updatedAt: iso(row.updated_at),
    };
  } catch {
    return databaseFailure();
  }
}

export async function markOpened(pool, projectId) {
  if (!PROJECT_ID_PATTERN.test(String(projectId ?? ""))) return notFound();
  try {
    const updated = await pool.query(
      `UPDATE project
       SET last_opened_at = clock_timestamp()
       WHERE id = $1
       RETURNING id, last_opened_at, updated_at`,
      [projectId],
    );
    if (updated.rowCount !== 1) return notFound();
    const row = updated.rows[0];
    return {
      ok: true,
      httpStatus: 200,
      id: row.id,
      lastOpenedAt: iso(row.last_opened_at),
      updatedAt: iso(row.updated_at),
    };
  } catch {
    return databaseFailure();
  }
}
