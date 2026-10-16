import { AsyncLocalStorage } from "node:async_hooks";

export const SEEDED_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX = 120;

const storage = new AsyncLocalStorage();

export function currentProjectId() {
  return storage.getStore() ?? null;
}

export function requireProjectId() {
  const id = currentProjectId();
  if (!PROJECT_ID_PATTERN.test(String(id ?? ""))) {
    const error = new Error("project-required");
    error.code = "PROJECT_REQUIRED";
    throw error;
  }
  return id;
}

export function enterProject(projectId) {
  if (!PROJECT_ID_PATTERN.test(String(projectId ?? ""))) {
    throw new Error("project-required");
  }
  storage.enterWith(projectId);
}

export function withProject(projectId, fn) {
  if (!PROJECT_ID_PATTERN.test(String(projectId ?? ""))) {
    return Promise.resolve({ ok: false, httpStatus: 404, kind: "not-found" });
  }
  return Promise.resolve(storage.run(projectId, fn));
}

export function normalizeTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (!title || title.length > TITLE_MAX) return null;
  if (title.includes("\u0000")) return null;
  return title;
}

export async function touchProjectContent(queryable) {
  const id = requireProjectId();
  await queryable.query(
    "UPDATE project SET updated_at = clock_timestamp() WHERE id = $1",
    [id],
  );
}
