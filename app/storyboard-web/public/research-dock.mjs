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

function panelTargetKey(panel) {
  return [
    "panel",
    panel?.displayFrameId ?? "",
    String(panel?.panelIndex ?? ""),
    panel?.structureFrameId ?? "",
  ].join(":");
}

function samePanelTarget(a, b) {
  if (!a || !b) return false;
  return a.kind === "panel"
    && b.kind === "panel"
    && a.displayFrameId === b.displayFrameId
    && a.panelIndex === b.panelIndex
    && a.structureFrameId === b.structureFrameId;
}

function formatCommandTargetLabel(target, { unsupported = false } = {}) {
  if (unsupported || !target) {
    return "Цель: недоступна / устарела — выберите поддерживаемую цель явно";
  }
  if (target.kind === "storyboard") {
    return "Цель: раскадровка (storyboard Structure edit)";
  }
  if (target.kind === "panel") {
    const displayNumber = target.displayFrameNumber == null ? "?" : String(target.displayFrameNumber);
    const displayId = target.displayFrameId ?? "—";
    const structureId = target.structureFrameId ?? "—";
    const segment = target.structureSegmentIndex == null ? "—" : String(target.structureSegmentIndex);
    const zeroBased = target.panelIndex == null ? "—" : String(target.panelIndex);
    const oneBased = target.panelIndex == null ? "—" : String(target.panelIndex + 1);
    return [
      `Цель: панель ${oneBased} (1-based) / panelIndex ${zeroBased} (0-based)`,
      `display кадр ${displayNumber} / ${displayId}`,
      `structure ${structureId} / segment ${segment}`,
    ].join(" · ");
  }
  return "Цель: не поддерживается";
}

function formatCommandsHistoryItem(event) {
  const stamp = event.occurredAt || "";
  if (event.eventKind === "action_start") {
    const action = event.semanticAction || "command";
    const text = event.submittedText || "";
    return stamp ? `${stamp} — ${action}: ${text}` : `${action}: ${text}`;
  }
  if (event.eventKind === "action_terminal") {
    const action = event.semanticAction || "command";
    const outcome = event.outcome || "failure";
    return stamp ? `${stamp} — ${action} → ${outcome}` : `${action} → ${outcome}`;
  }
  return stamp ? `${stamp} — ${event.submittedText || ""}` : String(event.submittedText || "");
}

function newCorrelationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

export function bindResearchDock({
  root,
  host,
  detail,
  getContext,
  fetchImpl = defaultFetch,
  executeDockCommand = null,
  isProductBusy = null,
} = {}) {
  const notesDraft = document.querySelector("#research-notes-draft");
  const notesSend = document.querySelector("#research-notes-send");
  const notesHistory = document.querySelector("#research-notes-history");
  const notesStatus = document.querySelector("#research-notes-status");
  const commandsDraft = document.querySelector("#research-commands-draft");
  const commandsSend = document.querySelector("#research-commands-send");
  const commandsForm = document.querySelector("#research-commands-form");
  const commandsStatus = document.querySelector("#research-commands-status");
  const commandsHistory = document.querySelector("#research-commands-history");
  const commandsTarget = document.querySelector("#research-commands-target");
  const commandsTargetLabel = document.querySelector("#research-commands-target-label");
  const commandsUnavailable = document.querySelector("#research-commands-unavailable");
  const operationsList = document.querySelector("#research-operations-list");
  const toggle = document.querySelector("#research-dock-toggle");

  let collapsed = false;
  let notes = [];
  let commandEvents = [];
  let terminalEvents = [];
  let live = null;
  let sendingNote = false;
  let sendingCommand = false;
  let availableTargets = { storyboardAvailable: false, panels: [] };
  let stickyTarget = createEmptyCommandTarget("storyboard");
  let targetUnsupported = true;

  function snapshotContext() {
    const base = createEmptyContext();
    if (typeof getContext !== "function") return base;
    const provided = getContext() || {};
    return createEmptyContext(provided);
  }

  function productBusy() {
    if (typeof isProductBusy === "function") return Boolean(isProductBusy());
    return document?.body?.dataset?.busy === "true";
  }

  function setNotesStatus(text, kind = "info") {
    if (!notesStatus) return;
    if (!text) {
      notesStatus.hidden = true;
      notesStatus.textContent = "";
      delete notesStatus.dataset.kind;
      return;
    }
    notesStatus.hidden = false;
    notesStatus.textContent = text;
    notesStatus.dataset.kind = kind;
  }

  function setCommandsStatus(text, kind = "info") {
    if (!commandsStatus) return;
    if (!text) {
      commandsStatus.hidden = true;
      commandsStatus.textContent = "";
      delete commandsStatus.dataset.kind;
      return;
    }
    commandsStatus.hidden = false;
    commandsStatus.textContent = text;
    commandsStatus.dataset.kind = kind;
  }

  function renderNotes() {
    if (!notesHistory) return;
    clearChildren(notesHistory);
    for (const note of notes) {
      const stamp = note.occurredAt || "";
      const text = note.submittedText || "";
      appendTextItem(notesHistory, stamp ? `${stamp} — ${text}` : text);
    }
  }

  function renderCommandsHistory() {
    if (!commandsHistory) return;
    clearChildren(commandsHistory);
    for (const event of commandEvents) {
      if (event?.surface && event.surface !== "dock_commands") continue;
      if (event?.eventKind !== "action_start" && event?.eventKind !== "action_terminal") continue;
      appendTextItem(commandsHistory, formatCommandsHistoryItem(event));
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

  function resolveStickyAgainstAvailable() {
    if (stickyTarget?.kind === "storyboard") {
      if (availableTargets.storyboardAvailable) {
        targetUnsupported = false;
        stickyTarget = createEmptyCommandTarget("storyboard");
        return;
      }
      targetUnsupported = true;
      return;
    }
    if (stickyTarget?.kind === "panel") {
      const match = (availableTargets.panels || []).find((panel) => samePanelTarget(
        createEmptyCommandTarget("panel", panel),
        stickyTarget,
      ));
      if (match) {
        targetUnsupported = false;
        stickyTarget = createEmptyCommandTarget("panel", match);
        return;
      }
      targetUnsupported = true;
      return;
    }
    targetUnsupported = true;
  }

  function ensureDefaultStoryboardTarget() {
    if (stickyTarget?.kind === "panel") return;
    if (availableTargets.storyboardAvailable) {
      stickyTarget = createEmptyCommandTarget("storyboard");
      targetUnsupported = false;
      return;
    }
    if (!stickyTarget || stickyTarget.kind === "storyboard") {
      stickyTarget = createEmptyCommandTarget("storyboard");
      targetUnsupported = true;
    }
  }

  function renderTargetControls() {
    resolveStickyAgainstAvailable();
    if (commandsTarget) {
      clearChildren(commandsTarget);
      if (availableTargets.storyboardAvailable) {
        const option = document.createElement("option");
        option.value = "storyboard";
        option.textContent = "Раскадровка (Structure edit)";
        commandsTarget.append(option);
      }
      for (const panel of availableTargets.panels || []) {
        const option = document.createElement("option");
        option.value = panelTargetKey(panel);
        const oneBased = panel.panelIndex + 1;
        option.textContent = [
          `Панель ${oneBased}`,
          `display ${panel.displayFrameNumber}/${panel.displayFrameId}`,
          `structure ${panel.structureFrameId ?? "—"}`,
          `panelIndex ${panel.panelIndex} (0-based)`,
        ].join(" · ");
        commandsTarget.append(option);
      }
      if (stickyTarget?.kind === "storyboard" && availableTargets.storyboardAvailable) {
        commandsTarget.value = "storyboard";
      } else if (stickyTarget?.kind === "panel" && !targetUnsupported) {
        commandsTarget.value = panelTargetKey(stickyTarget);
      } else if (commandsTarget.children?.length) {
        // Keep select populated but do not silently change stickyTarget.
        commandsTarget.value = commandsTarget.children[0].value;
      }
    }
    if (commandsTargetLabel) {
      commandsTargetLabel.textContent = formatCommandTargetLabel(stickyTarget, {
        unsupported: targetUnsupported,
      });
    }
    if (commandsUnavailable) {
      const noChoices = !availableTargets.storyboardAvailable
        && !(availableTargets.panels || []).length;
      commandsUnavailable.hidden = !noChoices && !targetUnsupported;
      if (targetUnsupported) {
        commandsUnavailable.hidden = false;
        commandsUnavailable.textContent = noChoices
          ? "Нет поддерживаемой цели команды. Доступны только правка раскадровки и явно выбранная панель."
          : "Выбранная цель недоступна или устарела. Выберите поддерживаемую цель явно.";
      }
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

  async function postResearchEvent(body) {
    try {
      const response = await fetchImpl("/api/research/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response?.ok) return null;
      const payload = await response.json();
      return payload?.event ?? null;
    } catch {
      return null;
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
      const commandsResponse = await fetchImpl("/api/research/trace?surface=dock_commands");
      if (commandsResponse?.ok) {
        const payload = await commandsResponse.json();
        commandEvents = Array.isArray(payload?.events)
          ? payload.events.filter((event) => (
            event?.surface === "dock_commands"
            && (event?.eventKind === "action_start" || event?.eventKind === "action_terminal")
          ))
          : [];
        renderCommandsHistory();
      }
    } catch {
      // Same offline tolerance as Notes hydrate.
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
    if (!notesDraft || sendingNote) return;
    const submittedText = String(notesDraft.value || "");
    if (!submittedText.trim()) return;
    sendingNote = true;
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
      notesDraft.value = "";
      setNotesStatus("");
      renderNotes();
    } catch {
      setNotesStatus("Не удалось сохранить заметку.", "error");
    } finally {
      sendingNote = false;
    }
  }

  async function sendCommand(event) {
    if (event?.preventDefault) event.preventDefault();
    if (!commandsDraft || sendingCommand) return;
    if (productBusy()) {
      setCommandsStatus("Команды недоступны, пока выполняется продуктовая операция.", "error");
      return;
    }
    const instruction = String(commandsDraft.value || "");
    if (!instruction.trim()) return;

    resolveStickyAgainstAvailable();
    if (targetUnsupported || !stickyTarget) {
      setCommandsStatus(
        "Выбранная цель недоступна или не поддерживается. Выберите цель явно — продуктовый вызов не выполнен.",
        "error",
      );
      return;
    }
    if (typeof executeDockCommand !== "function") {
      setCommandsStatus("Команды ещё не подключены к продукту.", "error");
      return;
    }

    const commandTarget = createEmptyCommandTarget(stickyTarget.kind, stickyTarget);
    const semanticAction = commandTarget.kind === "panel" ? "panel_generate" : "structure_edit";
    const correlationId = newCorrelationId();
    const context = snapshotContext();
    const startSnapshot = {
      semanticAction,
      surface: "dock_commands",
      submittedText: instruction,
      commandTarget,
      editTarget: null,
      context,
    };

    sendingCommand = true;
    setCommandsStatus("");
    let startSaved = false;
    try {
      const startEvent = await postResearchEvent({
        eventKind: "action_start",
        correlationId,
        ...startSnapshot,
      });
      startSaved = Boolean(startEvent);
      if (startEvent) {
        commandEvents = [...commandEvents, startEvent];
        terminalEvents = [...terminalEvents, startEvent];
        renderCommandsHistory();
        renderOperations();
      }
    } catch {
      startSaved = false;
    }

    live = {
      correlationId,
      semanticAction,
      surface: "dock_commands",
    };
    renderOperations();

    let productOk = false;
    let productError = null;
    try {
      const result = await executeDockCommand({
        instruction,
        commandTarget,
        correlationId,
        semanticAction,
        context,
      });
      productOk = Boolean(result?.ok);
      productError = result?.error ?? null;
      if (result?.blocked) {
        setCommandsStatus("Команды недоступны, пока выполняется продуктовая операция.", "error");
      } else if (!productOk) {
        setCommandsStatus("Команда не выполнена.", "error");
      }
    } catch (error) {
      productOk = false;
      productError = error;
      setCommandsStatus("Команда не выполнена.", "error");
    }

    const terminalBody = {
      eventKind: "action_terminal",
      correlationId,
      outcome: productOk ? "success" : "failure",
      outcomeKind: productOk
        ? null
        : (typeof productError?.kind === "string" ? productError.kind : "request-failed"),
      outcomeFlags: {},
    };
    if (!startSaved) terminalBody.startSnapshot = startSnapshot;
    const terminalEvent = await postResearchEvent(terminalBody);
    if (terminalEvent) {
      commandEvents = [...commandEvents, terminalEvent];
      terminalEvents = [...terminalEvents, terminalEvent];
      renderCommandsHistory();
      renderOperations();
    }

    live = null;
    renderOperations();
    if (productOk) {
      commandsDraft.value = "";
      setCommandsStatus("");
    }
    sendingCommand = false;
  }

  function selectCommandTarget(next) {
    if (!next || typeof next !== "object") return;
    if (next.kind === "storyboard") {
      stickyTarget = createEmptyCommandTarget("storyboard");
      resolveStickyAgainstAvailable();
      renderTargetControls();
      return;
    }
    if (next.kind === "panel") {
      stickyTarget = createEmptyCommandTarget("panel", next);
      resolveStickyAgainstAvailable();
      renderTargetControls();
    }
  }

  function setAvailableTargets(next = {}) {
    availableTargets = {
      storyboardAvailable: Boolean(next.storyboardAvailable),
      panels: Array.isArray(next.panels) ? next.panels.map((panel) => ({
        displayFrameNumber: panel.displayFrameNumber ?? null,
        displayFrameId: panel.displayFrameId ?? null,
        structureFrameId: panel.structureFrameId ?? null,
        structureSegmentIndex: Number.isInteger(panel.structureSegmentIndex)
          ? panel.structureSegmentIndex
          : null,
        panelIndex: Number.isInteger(panel.panelIndex) ? panel.panelIndex : null,
      })).filter((panel) => panel.displayFrameId && Number.isInteger(panel.panelIndex)) : [],
    };
    if (stickyTarget?.kind !== "panel") {
      ensureDefaultStoryboardTarget();
    }
    resolveStickyAgainstAvailable();
    renderTargetControls();
  }

  function onTargetSelectChange() {
    if (!commandsTarget) return;
    const value = commandsTarget.value;
    if (value === "storyboard") {
      selectCommandTarget({ kind: "storyboard" });
      return;
    }
    const panel = (availableTargets.panels || []).find((entry) => panelTargetKey(entry) === value);
    if (panel) selectCommandTarget({ kind: "panel", ...panel });
  }

  function enterDetail() {
    reparentDockIntoDetail({ dock: root, detail, host });
  }

  function exitDetail() {
    restoreDockToHost({ dock: root, host, detail });
  }

  if (notesSend) {
    setElementAttribute(notesSend, "data-research-allow", "notes-send");
    notesSend.addEventListener("click", () => {
      void sendNote();
    });
  }
  if (commandsForm) {
    commandsForm.addEventListener("submit", (event) => {
      void sendCommand(event);
    });
  }
  if (commandsSend) {
    commandsSend.addEventListener("click", () => {
      void sendCommand();
    });
  }
  if (commandsDraft) {
    commandsDraft.addEventListener("keydown", (event) => {
      if (event?.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        void sendCommand(event);
      }
    });
  }
  if (commandsTarget) {
    commandsTarget.addEventListener("change", () => {
      onTargetSelectChange();
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
  renderCommandsHistory();
  renderOperations();
  renderTargetControls();
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
      if (event.surface === "dock_commands") {
        commandEvents = [...commandEvents, event];
        renderCommandsHistory();
      }
      renderOperations();
    },
    captureContext: snapshotContext,
    createEmptyCommandTarget,
    setAvailableTargets,
    selectCommandTarget,
    getCommandTarget: () => createEmptyCommandTarget(stickyTarget?.kind || "storyboard", stickyTarget || {}),
    isCommandTargetUnsupported: () => targetUnsupported,
  };
}
