const PROJECT_PATH = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export function projectIdFromLocation(pathname = globalThis.location?.pathname ?? "") {
  const match = String(pathname).match(PROJECT_PATH);
  return match ? match[1] : null;
}

export function projectApi(path, pathname) {
  const id = projectIdFromLocation(pathname);
  if (!id || typeof path !== "string") return null;
  if (path.startsWith(`/api/projects/${id}/`) || path === `/api/projects/${id}`) return path;
  if (path === "/api/project" || path === "/api/project/rename") return `/api/projects/${id}`;
  if (path === "/api/project/open") return `/api/projects/${id}/open`;
  if (path.startsWith("/api/")) return `/api/projects/${id}${path.slice(4)}`;
  return path;
}
