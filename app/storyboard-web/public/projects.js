const list = document.querySelector("#project-list");
const status = document.querySelector("#project-list-status");
const continueRow = document.querySelector("#continue-row");
const continueLink = document.querySelector("#continue-project");
const newProject = document.querySelector("#new-project");

function showStatus(text) {
  status.hidden = !text;
  status.textContent = text || "";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function card(project, continueId) {
  const article = document.createElement("article");
  article.className = "project-card";
  const open = document.createElement("a");
  open.className = "project-card-open";
  open.href = `/projects/${project.id}`;
  const title = document.createElement("h2");
  title.textContent = project.title;
  const meta = document.createElement("p");
  meta.className = "project-card-meta";
  const when = formatDate(project.updatedAt);
  meta.textContent = [project.stage, when].filter(Boolean).join(" · ");
  open.append(title, meta);
  if (project.snippet) {
    const snippet = document.createElement("p");
    snippet.className = "project-card-snippet";
    snippet.textContent = project.snippet;
    open.append(snippet);
  }
  if (project.id === continueId) {
    const badge = document.createElement("p");
    badge.className = "project-card-continue";
    badge.textContent = "Продолжить";
    open.append(badge);
  }
  const form = document.createElement("form");
  form.className = "rename-form";
  const input = document.createElement("input");
  input.value = project.title;
  input.maxLength = 120;
  input.setAttribute("aria-label", `Название проекта ${project.title}`);
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Сохранить название";
  form.append(input, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const titleText = input.value.trim();
    if (!titleText) return;
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: titleText }),
    });
    if (!response.ok) {
      showStatus("Не удалось переименовать проект.");
      return;
    }
    await load();
  });
  article.append(open, form);
  return article;
}

async function load() {
  showStatus("");
  const response = await fetch("/api/projects");
  if (!response.ok) {
    showStatus("Не удалось загрузить проекты.");
    return;
  }
  const payload = await response.json();
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  list.replaceChildren(...projects.map((project) => card(project, payload.continueProjectId)));
  const current = projects.find((project) => project.id === payload.continueProjectId);
  continueRow.hidden = !current;
  if (current) continueLink.href = `/projects/${current.id}`;
}

newProject.addEventListener("click", async () => {
  newProject.disabled = true;
  try {
    const response = await fetch("/api/projects", { method: "POST" });
    if (!response.ok) {
      showStatus("Не удалось создать проект.");
      return;
    }
    const project = await response.json();
    if (!project?.id) {
      showStatus("Не удалось создать проект.");
      return;
    }
    window.location.assign(`/projects/${project.id}`);
  } finally {
    newProject.disabled = false;
  }
});

load();
