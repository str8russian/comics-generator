import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createServer } from "../server.mjs";

const unknownId = "00000000-0000-4000-8000-000000000099";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function send(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

test("root lists projects and a bad project URL does not open another project", async () => {
  const opened = [];
  const server = createServer({
    migrate: false,
    projectStore: {
      async listProjects() {
        return {
          ok: true,
          projects: [{
            id: unknownId,
            title: "Текущий ролик",
            createdAt: "2026-10-16T00:00:00.000Z",
            updatedAt: "2026-10-16T00:00:00.000Z",
            lastOpenedAt: "2026-10-16T01:00:00.000Z",
            snippet: "Аня: старый черновик",
            stage: "Визуал",
          }],
          continueProjectId: unknownId,
        };
      },
      async loadProject() {
        return { missing: true };
      },
      async createProject() {
        return {
          ok: true,
          httpStatus: 201,
          project: {
            id: "00000000-0000-4000-8000-000000000077",
            title: "Новый проект",
            stage: "Черновик",
          },
        };
      },
      async markOpened(projectId) {
        opened.push(projectId);
        return {
          ok: true,
          id: projectId,
          lastOpenedAt: "2026-10-16T02:00:00.000Z",
          updatedAt: "2026-10-16T00:00:00.000Z",
        };
      },
    },
  });
  const port = await listen(server);
  try {
    const root = await send(port, { path: "/" });
    assert.equal(root.status, 200);
    assert.match(root.body, /Новый проект/);
    assert.match(root.body, /Проекты/);
    assert.equal(root.body.includes("http-equiv"), false);
    assert.equal(root.body.includes("location.replace"), false);

    const malformed = await send(port, { path: "/projects/not-a-uuid" });
    assert.equal(malformed.status, 200);
    assert.match(malformed.body, /Проект не найден/);
    assert.match(malformed.body, /href="\/"/);
    assert.equal(malformed.body.includes("id=\"draft\""), false);

    const unscoped = await send(port, { method: "PUT", path: "/api/draft" });
    assert.equal(unscoped.status, 404);

    const missing = await send(port, { path: `/api/projects/${unknownId}` });
    assert.equal(missing.status, 404);
    assert.match(missing.body, /not-found/);
    assert.equal(opened.length, 0);

    const created = await send(port, { method: "POST", path: "/api/projects" });
    assert.equal(created.status, 201);
    assert.match(created.body, /Новый проект/);

    const workspace = await send(port, { path: `/projects/${unknownId}` });
    assert.match(workspace.body, /Проекты/);
    assert.match(workspace.body, /id="project-title"/);
    assert.match(workspace.body, /id="project-missing"/);
  } finally {
    await close(server);
  }
});
