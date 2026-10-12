export const CONTEXT_KEYS = [
  "workflowPhase",
  "storyboardVersionId",
  "displayFrameNumber",
  "displayFrameId",
  "structureFrameId",
  "structureSegmentIndex",
  "panelIndex",
  "panelSubject",
  "imageAssetId",
  "generationId",
  "characterName",
  "anchorVersionId",
];

const COMMAND_TARGET_KEYS = [
  "kind",
  "displayFrameNumber",
  "displayFrameId",
  "structureFrameId",
  "structureSegmentIndex",
  "panelIndex",
  "zoom",
  "positionX",
  "positionY",
  "characterName",
  "anchorVersionId",
];

export function createEmptyContext(overrides = {}) {
  const context = {};
  for (const key of CONTEXT_KEYS) {
    context[key] = Object.hasOwn(overrides, key) ? overrides[key] : null;
  }
  return context;
}

export function createEmptyCommandTarget(kind = "storyboard", overrides = {}) {
  const target = { kind };
  for (const key of COMMAND_TARGET_KEYS) {
    if (key === "kind") continue;
    target[key] = Object.hasOwn(overrides, key) ? overrides[key] : null;
  }
  return target;
}

export function projectOperations({ live = null, events = [] } = {}) {
  const items = [];
  if (live) {
    items.push({
      status: "running",
      correlationId: live.correlationId ?? null,
      semanticAction: live.semanticAction ?? null,
      surface: live.surface ?? null,
      occurredAt: live.occurredAt ?? null,
      outcomeKind: null,
      historical: false,
      label: formatOperationLabel({
        status: "running",
        semanticAction: live.semanticAction,
        outcomeKind: null,
      }),
    });
  }

  const starts = new Map();
  const terminals = [];
  for (const event of events || []) {
    if (!event || typeof event !== "object") continue;
    if (event.eventKind === "action_start" && event.correlationId) {
      starts.set(event.correlationId, event);
    }
    if (event.eventKind === "action_terminal") {
      terminals.push(event);
    }
  }

  for (const terminal of terminals) {
    const status = terminal.outcome === "success" || terminal.outcome === "failure" || terminal.outcome === "blocked"
      ? terminal.outcome
      : "failure";
    items.push({
      status,
      correlationId: terminal.correlationId ?? null,
      semanticAction: terminal.semanticAction ?? null,
      surface: terminal.surface ?? null,
      occurredAt: terminal.occurredAt ?? null,
      outcomeKind: terminal.outcomeKind ?? null,
      historical: false,
      label: formatOperationLabel({
        status,
        semanticAction: terminal.semanticAction,
        outcomeKind: terminal.outcomeKind,
      }),
    });
  }

  for (const [correlationId, start] of starts) {
    if (live?.correlationId === correlationId) continue;
    if (terminals.some((terminal) => terminal.correlationId === correlationId)) continue;
    items.push({
      status: "interrupted",
      correlationId,
      semanticAction: start.semanticAction ?? null,
      surface: start.surface ?? null,
      occurredAt: start.occurredAt ?? null,
      outcomeKind: null,
      historical: true,
      label: formatOperationLabel({
        status: "interrupted",
        semanticAction: start.semanticAction,
        outcomeKind: null,
      }),
    });
  }

  return items;
}

function formatOperationLabel({ status, semanticAction, outcomeKind }) {
  const action = semanticAction || "operation";
  if (status === "running") return `Выполняется: ${action}`;
  if (status === "success") return `Успех: ${action}`;
  if (status === "interrupted") return `Прервано (историческое): ${action}`;
  if (status === "blocked") return `Блокировано: ${action}`;
  const kind = outcomeKind ? ` (${outcomeKind})` : "";
  return `Ошибка: ${action}${kind}`;
}

export function reparentDockIntoDetail({ dock, detail }) {
  if (!dock || !detail) return;
  if (dock.parentNode !== detail) detail.appendChild(dock);
}

export function restoreDockToHost({ dock, host }) {
  if (!dock || !host) return;
  if (dock.parentNode !== host) host.appendChild(dock);
}

function clearChildren(node) {
  if (!node) return;
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  node.children = [];
  node.textContent = "";
}

function appendTextItem(list, text) {
  const item = document.createElement("li");
  item.textContent = text;
  list.append(item);
}

function setElementAttribute(element, name, value) {
  if (!element) return;
  if (typeof element.setAttribute === "function") {
    element.setAttribute(name, value);
    return;
  }
  if (name === "data-research-allow") {
    element.dataset = element.dataset || {};
    element.dataset.researchAllow = String(value);
    return;
  }
  if (name.startsWith("aria-") || name.startsWith("data-")) {
    element.dataset = element.dataset || {};
    const key = name.includes("-")
      ? name.replace(/^aria-|^data-/, "").replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
      : name;
    element.dataset[key] = String(value);
  }
}

async function defaultFetch(url, init) {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("fetch is not available");
  }
  return globalThis.fetch(url, init);
}

export function bindResearchDock({
  root,
  host,
  detail,
  getContext,
  fetchImpl = defaultFetch,
} = {}) {
  const draft = document.querySelector("#research-notes-draft");
  const send = document.querySelector("#research-notes-send");
  const history = document.querySelector("#research-notes-history");
  const status = document.querySelector("#research-notes-status");
  const operationsList = document.querySelector("#research-operations-list");
  const toggle = document.querySelector("#research-dock-toggle");

  let collapsed = false;
  let notes = [];
  let terminalEvents = [];
  let live = null;
  let sending = false;

  function snapshotContext() {
    const base = createEmptyContext();
    if (typeof getContext !== "function") return base;
    const provided = getContext() || {};
    return createEmptyContext(provided);
  }

  function setNotesStatus(text, kind = "info") {
    if (!status) return;
    if (!text) {
      status.hidden = true;
      status.textContent = "";
      delete status.dataset.kind;
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function renderNotes() {
    if (!history) return;
    clearChildren(history);
    for (const note of notes) {
      const stamp = note.occurredAt || "";
      const text = note.submittedText || "";
      appendTextItem(history, stamp ? `${stamp} — ${text}` : text);
    }
  }

  function renderOperations() {
    if (!operationsList) return;
    clearChildren(operationsList);
    const projection = projectOperations({ live, events: terminalEvents });
    for (const item of projection) {
      const stamp = item.occurredAt ? `${item.occurredAt} — ` : "";
      appendTextItem(operationsList, `${stamp}${item.label}`);
    }
  }

  function setCollapsed(next) {
    collapsed = Boolean(next);
    if (root) {
      const classes = String(root.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((name) => name !== "research-dock--collapsed");
      if (collapsed) classes.push("research-dock--collapsed");
      root.className = classes.join(" ");
    }
    if (toggle) {
      setElementAttribute(toggle, "aria-expanded", collapsed ? "false" : "true");
      toggle.textContent = collapsed ? "Research ▴" : "Research ▾";
    }
  }

  async function hydrate() {
    try {
      const notesResponse = await fetchImpl("/api/research/trace?kind=note");
      if (notesResponse?.ok) {
        const payload = await notesResponse.json();
        notes = Array.isArray(payload?.events)
          ? payload.events.filter((event) => event?.eventKind === "note")
          : [];
        renderNotes();
      }
    } catch {
      // Isolated page tests and offline boots may not expose research routes.
    }

    try {
      const traceResponse = await fetchImpl("/api/research/trace");
      if (traceResponse?.ok) {
        const payload = await traceResponse.json();
        terminalEvents = Array.isArray(payload?.events)
          ? payload.events.filter((event) => (
            event?.eventKind === "action_start" || event?.eventKind === "action_terminal"
          ))
          : [];
        renderOperations();
      }
    } catch {
      // Same offline tolerance as Notes hydrate.
    }
  }

  async function sendNote() {
    if (!draft || sending) return;
    const submittedText = String(draft.value || "");
    if (!submittedText.trim()) return;
    sending = true;
    setNotesStatus("");
    try {
      const response = await fetchImpl("/api/research/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submittedText,
          context: snapshotContext(),
        }),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok || !payload?.event) {
        setNotesStatus("Не удалось сохранить заметку.", "error");
        return;
      }
      notes = [...notes, payload.event];
      draft.value = "";
      setNotesStatus("");
      renderNotes();
    } catch {
      setNotesStatus("Не удалось сохранить заметку.", "error");
    } finally {
      sending = false;
    }
  }

  function enterDetail() {
    reparentDockIntoDetail({ dock: root, detail, host });
  }

  function exitDetail() {
    restoreDockToHost({ dock: root, host, detail });
  }

  if (send) {
    setElementAttribute(send, "data-research-allow", "notes-send");
    send.addEventListener("click", () => {
      void sendNote();
    });
  }
  if (toggle) {
    toggle.addEventListener("click", () => {
      setCollapsed(!collapsed);
    });
  }
  if (detail) {
    detail.addEventListener("close", () => {
      exitDetail();
    });
  }

  setCollapsed(false);
  renderNotes();
  renderOperations();
  const ready = hydrate();

  return {
    ready,
    enterDetail,
    exitDetail,
    isCollapsed: () => collapsed,
    setCollapsed,
    getOperationsProjection: () => projectOperations({ live, events: terminalEvents }),
    setLiveOperation(next) {
      live = next ? { ...next } : null;
      renderOperations();
    },
    clearLiveOperation() {
      live = null;
      renderOperations();
    },
    recordTerminalEvent(event) {
      if (!event) return;
      terminalEvents = [...terminalEvents, event];
      renderOperations();
    },
    captureContext: snapshotContext,
    createEmptyCommandTarget,
  };
}
