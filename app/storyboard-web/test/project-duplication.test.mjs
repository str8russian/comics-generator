import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServer } from "../server.mjs";
import { close, listen, request } from "./loopback-http.mjs";
import {
  DUPLICATE_CANCEL_LABEL,
  DUPLICATE_LABEL,
  DUPLICATE_SUBMIT_LABEL,
  DUPLICATE_TITLE_LABEL,
  bindDuplicateDialog,
  duplicateFailureMessage,
  proposedDuplicateTitle,
} from "../public/duplicate-project.mjs";

const sourceId = "00000000-0000-4000-8000-000000000041";
const copyId = "00000000-0000-4000-8000-000000000042";

async function send(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  const response = await request(port, { method, path, headers, body });
  return {
    status: response.status,
    headers: response.headers,
    body: response.body.toString("utf8"),
  };
}

function element(tag) {
  const listeners = new Map();
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    attrs: {},
    className: "",
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    open: false,
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === "hidden") this.hidden = true;
    },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    append(...children) {
      for (const child of children) this.children.push(child);
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    querySelector(selector) {
      const id = selector.startsWith("#") ? selector.slice(1) : "";
      const stack = [...this.children];
      while (stack.length) {
        const current = stack.shift();
        if (current.id === id) return current;
        stack.push(...(current.children ?? []));
      }
      return null;
    },
    focus() {
      this.focused = true;
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      this.dispatch("close");
    },
  };
  return node;
}

test("proposed duplicate titles use the Russian prefix and stay within 120 characters", () => {
  assert.equal(proposedDuplicateTitle("Ролик"), "Копия — Ролик");
  const long = "Я".repeat(120);
  const proposed = proposedDuplicateTitle(long);
  assert.equal(proposed.startsWith("Копия — "), true);
  assert.equal(proposed.length <= 120, true);
  assert.equal(proposed.length, 120);
  const emoji = `${"Я".repeat(111)}🙂`;
  const clipped = proposedDuplicateTitle(emoji);
  assert.equal(clipped.includes("🙂"), false);
  assert.equal(clipped.length <= 120, true);
  assert.equal([...clipped].length, [...clipped].length);
});

test("duplicate route accepts only the route id and the submitted title", async () => {
  const calls = [];
  let providerCalls = 0;
  const server = createServer({
    migrate: false,
    fetchImpl() {
      providerCalls += 1;
      throw new Error("provider");
    },
    projectStore: {
      async duplicateProject(projectId, title, options) {
        calls.push({ projectId, title, options });
        if (projectId !== sourceId) return { ok: false, httpStatus: 404, kind: "not-found" };
        if (title === "сломать") return { ok: false, httpStatus: 503, kind: "database" };
        return {
          ok: true,
          httpStatus: 201,
          project: {
            id: copyId,
            title,
            createdAt: "2026-10-21T00:00:00.000Z",
            updatedAt: "2026-10-21T00:00:00.000Z",
            lastOpenedAt: null,
            snippet: "Аня: текст",
            stage: "Подготовка видео",
          },
        };
      },
    },
  });
  const port = await listen(server);
  try {
    const created = await send(port, {
      method: "POST",
      path: `/api/projects/${sourceId}/duplicate`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Копия — Ролик",
        assetId: "00000000-0000-4000-8000-000000000099",
        materialStateId: "00000000-0000-4000-8000-000000000098",
        storyboardVersionId: "00000000-0000-4000-8000-000000000097",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(JSON.parse(created.body).id, copyId);
    assert.equal(JSON.parse(created.body).title, "Копия — Ролик");
    assert.deepEqual(calls, [{ projectId: sourceId, title: "Копия — Ролик", options: undefined }]);
    assert.equal(providerCalls, 0);

    const empty = await send(port, {
      method: "POST",
      path: `/api/projects/${sourceId}/duplicate`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    assert.equal(empty.status, 400);
    assert.match(empty.body, /invalid-request/);

    const overlong = await send(port, {
      method: "POST",
      path: `/api/projects/${sourceId}/duplicate`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Я".repeat(121) }),
    });
    assert.equal(overlong.status, 400);

    const missing = await send(port, {
      method: "POST",
      path: "/api/projects/00000000-0000-4000-8000-000000000099/duplicate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Копия" }),
    });
    assert.equal(missing.status, 404);
    assert.match(missing.body, /not-found/);

    const method = await send(port, {
      method: "GET",
      path: `/api/projects/${sourceId}/duplicate`,
    });
    assert.equal(method.status, 405);

    const type = await send(port, {
      method: "POST",
      path: `/api/projects/${sourceId}/duplicate`,
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ title: "Копия" }),
    });
    assert.equal(type.status, 415);

    const failed = await send(port, {
      method: "POST",
      path: `/api/projects/${sourceId}/duplicate`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "сломать" }),
    });
    assert.equal(failed.status, 503);
    assert.match(failed.body, /database/);
    assert.equal(providerCalls, 0);
    assert.deepEqual(calls.map((call) => call.title), ["Копия — Ролик", "Копия", "сломать"]);
    assert.equal(calls[1].projectId, "00000000-0000-4000-8000-000000000099");
  } finally {
    await close(server);
  }
});

test("both duplicate entry points are keyboard-operable Russian forms", async () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const projects = readFileSync(new URL("../public/projects.html", import.meta.url), "utf8");
  const listScript = readFileSync(new URL("../public/projects.js", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(index, new RegExp(DUPLICATE_LABEL));
  assert.match(index, new RegExp(DUPLICATE_TITLE_LABEL));
  assert.match(projects, new RegExp(DUPLICATE_TITLE_LABEL));
  assert.match(listScript, /textContent = DUPLICATE_LABEL/);
  assert.match(listScript, /duplicateControl\.open/);
  assert.match(workspace, /duplicate-project/);

  const dialog = element("dialog");
  dialog.id = "duplicate-project-dialog";
  const form = element("form");
  const titleInput = element("input");
  titleInput.id = "duplicate-project-title";
  const status = element("p");
  const submit = element("button");
  submit.type = "submit";
  const cancel = element("button");
  cancel.type = "button";
  form.append(titleInput, status, cancel, submit);
  dialog.append(form);
  const openButton = element("button");

  const requests = [];
  const opened = [];
  let mode = "success";
  let release = () => {};
  const control = bindDuplicateDialog({
    dialog,
    form,
    titleInput,
    statusNode: status,
    submitButton: submit,
    cancelButton: cancel,
    openButton,
    getSource: () => ({ id: sourceId, title: "Исходный ролик" }),
    async requestDuplicate(input) {
      requests.push(input);
      if (mode === "pending") await new Promise((resolve) => { release = resolve; });
      if (mode === "fail" || mode === "pending") {
        if (mode === "fail") return { ok: false, message: duplicateFailureMessage({ status: 503, kind: "database" }) };
      }
      if (mode === "fail") return { ok: false, message: duplicateFailureMessage({ status: 503, kind: "database" }) };
      return { ok: true, project: { id: copyId, title: input.title } };
    },
    onSuccess(project) {
      opened.push(project.id);
    },
  });

  openButton.dispatch("click");
  assert.equal(dialog.open, true);
  assert.equal(titleInput.focused, true);
  assert.equal(titleInput.value, "Копия — Исходный ролик");
  assert.equal(submit.textContent, DUPLICATE_SUBMIT_LABEL);
  assert.equal(cancel.textContent, DUPLICATE_CANCEL_LABEL);

  cancel.dispatch("click");
  assert.equal(dialog.open, false);
  assert.equal(requests.length, 0);
  assert.equal(opened.length, 0);

  control.open({ id: sourceId, title: "Исходный ролик" });
  const cancelEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  dialog.dispatch("cancel", cancelEvent);
  assert.equal(requests.length, 0);

  mode = "pending";
  titleInput.value = "Вариант А";
  form.dispatch("submit", { preventDefault() {} });
  await Promise.resolve();
  assert.equal(submit.disabled, true);
  assert.equal(titleInput.disabled, true);
  assert.equal(cancel.disabled, true);
  mode = "success";
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(opened, [copyId]);
  assert.equal(requests.at(-1).title, "Вариант А");
  assert.equal(requests.at(-1).id, sourceId);

  mode = "fail";
  opened.length = 0;
  control.open({ id: sourceId, title: "Исходный ролик" });
  titleInput.value = "Вариант Б";
  form.dispatch("submit", { preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened.length, 0);
  assert.equal(dialog.open, true);
  assert.match(status.textContent, /Не удалось дублировать проект/);
  assert.match(duplicateFailureMessage({ status: 400, kind: "invalid-request" }), /Название копии/);
  assert.match(duplicateFailureMessage({ status: 404, kind: "not-found" }), /не найден/);
});
