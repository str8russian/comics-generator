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
  "panelSubject",
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

export function createEmptyEditTarget(editKind, castPhase, overrides = {}) {
  return {
    editKind,
    castPhase,
    characterName: Object.hasOwn(overrides, "characterName") ? overrides.characterName : null,
    previousCharacterName: Object.hasOwn(overrides, "previousCharacterName")
      ? overrides.previousCharacterName
      : null,
    surfaceForm: Object.hasOwn(overrides, "surfaceForm") ? overrides.surfaceForm : null,
    sourceItemId: Object.hasOwn(overrides, "sourceItemId") ? overrides.sourceItemId : null,
  };
}

const EVIDENCE_SAVE_FAILURE_LABEL = "Действие продукта выполнено, результат исследования не сохранён.";
const EVIDENCE_SAVE_FAILURE_LABEL_START = "Не удалось сохранить начало исследования; действие продукта продолжается.";

const RU_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const UTC_PLUS_3_MS = 3 * 60 * 60 * 1000;

/** Visible dock timestamps: Russian date + 24h clock in fixed UTC+3. Stored values unchanged. */
export function formatResearchTimestamp(value) {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const moscow = new Date(date.getTime() + UTC_PLUS_3_MS);
  const day = moscow.getUTCDate();
  const month = RU_MONTHS_GENITIVE[moscow.getUTCMonth()];
  const year = moscow.getUTCFullYear();
  const hh = String(moscow.getUTCHours()).padStart(2, "0");
  const mm = String(moscow.getUTCMinutes()).padStart(2, "0");
  const ss = String(moscow.getUTCSeconds()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}:${ss} (UTC+3)`;
}

function evidenceSaveFailurePhase(phase) {
  return phase === "start" ? "start" : "terminal";
}

function evidenceSaveFailureLabel(phase) {
  return evidenceSaveFailurePhase(phase) === "start"
    ? EVIDENCE_SAVE_FAILURE_LABEL_START
    : EVIDENCE_SAVE_FAILURE_LABEL;
}

function numericSeq(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function projectOperations({ live = null, events = [], localEvidenceFailures = [] } = {}) {
  const items = [];
  if (live) {
    items.push({
      status: "running",
      correlationId: live.correlationId ?? null,
      semanticAction: live.semanticAction ?? null,
      surface: live.surface ?? null,
      occurredAt: live.occurredAt ?? null,
      seq: Object.hasOwn(live, "seq") ? live.seq : null,
      outcomeKind: null,
      outcomeFlags: {},
      durationMs: null,
      localOnly: false,
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

  const persisted = [];

  for (const terminal of terminals) {
    const status = terminal.outcome === "success" || terminal.outcome === "failure" || terminal.outcome === "blocked"
      ? terminal.outcome
      : "failure";
    const outcomeFlags = terminal.outcomeFlags && typeof terminal.outcomeFlags === "object"
      ? { ...terminal.outcomeFlags }
      : {};
    persisted.push({
      status,
      correlationId: terminal.correlationId ?? null,
      semanticAction: terminal.semanticAction ?? null,
      surface: terminal.surface ?? null,
      occurredAt: terminal.occurredAt ?? null,
      seq: Object.hasOwn(terminal, "seq") ? terminal.seq : null,
      outcomeKind: terminal.outcomeKind ?? null,
      outcomeFlags,
      durationMs: Object.hasOwn(terminal, "durationMs") ? terminal.durationMs : null,
      localOnly: false,
      historical: false,
      label: formatOperationLabel({
        status,
        semanticAction: terminal.semanticAction,
        outcomeKind: terminal.outcomeKind,
        outcomeFlags,
      }),
    });
  }

  for (const [correlationId, start] of starts) {
    if (live?.correlationId === correlationId) continue;
    if (terminals.some((terminal) => terminal.correlationId === correlationId)) continue;
    persisted.push({
      status: "interrupted",
      correlationId,
      semanticAction: start.semanticAction ?? null,
      surface: start.surface ?? null,
      occurredAt: start.occurredAt ?? null,
      seq: Object.hasOwn(start, "seq") ? start.seq : null,
      outcomeKind: null,
      outcomeFlags: {},
      durationMs: null,
      localOnly: false,
      historical: true,
      label: formatOperationLabel({
        status: "interrupted",
        semanticAction: start.semanticAction,
        outcomeKind: null,
      }),
    });
  }

  persisted.sort((a, b) => numericSeq(a.seq) - numericSeq(b.seq));
  items.push(...persisted);

  for (const failure of localEvidenceFailures || []) {
    if (!failure || typeof failure !== "object") continue;
    const phase = evidenceSaveFailurePhase(failure.phase);
    items.push({
      status: "evidence-save-failure",
      correlationId: failure.correlationId ?? null,
      semanticAction: failure.semanticAction ?? null,
      surface: failure.surface ?? null,
      occurredAt: null,
      seq: null,
      outcomeKind: null,
      outcomeFlags: {},
      durationMs: null,
      localOnly: true,
      historical: false,
      phase,
      label: evidenceSaveFailureLabel(phase),
    });
  }

  return items;
}

function formatOperationLabel({ status, semanticAction, outcomeKind, outcomeFlags = {} }) {
  const action = semanticAction || "operation";
  if (status === "running") return `Выполняется: ${action}`;
  if (status === "success") return `Успех: ${action}`;
  if (status === "interrupted") return `Прервано (историческое): ${action}`;
  if (status === "blocked") return `Блокировано: ${action}`;
  if (status === "evidence-save-failure") return EVIDENCE_SAVE_FAILURE_LABEL;
  const kind = outcomeKind ? ` (${outcomeKind})` : "";
  const retained = outcomeFlags?.retainedLastGoodImage === true
    ? " · показан предыдущий вариант"
    : "";
  return `Ошибка: ${action}${kind}${retained}`;
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
    String(panel?.structureSegmentIndex ?? ""),
  ].join(":");
}

function samePanelTarget(a, b) {
  if (!a || !b) return false;
  return a.kind === "panel"
    && b.kind === "panel"
    && a.displayFrameId === b.displayFrameId
    && a.panelIndex === b.panelIndex
    && a.structureFrameId === b.structureFrameId
    && a.structureSegmentIndex === b.structureSegmentIndex;
}

function ownerFacingCommandLabel(target) {
  if (!target) return "";
  if (target.kind === "storyboard") {
    return "Изменить структуру всей раскадровки";
  }
  if (target.kind === "panel") {
    const displayNumber = target.displayFrameNumber == null ? "?" : String(target.displayFrameNumber);
    const oneBased = target.panelIndex == null ? "?" : String(target.panelIndex + 1);
    const subject = typeof target.panelSubject === "string" && target.panelSubject.trim()
      ? ` — ${target.panelSubject.trim()}`
      : "";
    return `Перегенерировать изображение: кадр ${displayNumber}, панель ${oneBased}${subject}`;
  }
  return "";
}

function formatCommandTargetLabel(target, { unsupported = false, unselected = false } = {}) {
  if (unselected || !target) {
    return "Действие не выбрано — выберите действие, чтобы ограничить выполнение";
  }
  if (unsupported) {
    return "Выбранное действие недоступно — выберите другое действие";
  }
  return ownerFacingCommandLabel(target) || "Действие не поддерживается";
}

function formatCommandsHistoryItem(event) {
  if (event?.eventKind !== "action_start") return "";
  const stamp = formatResearchTimestamp(event.occurredAt);
  const actionLabel = ownerFacingCommandLabel(event.commandTarget)
    || (event.semanticAction === "panel_generate"
      ? "Перегенерировать изображение"
      : event.semanticAction === "structure_edit"
        ? "Изменить структуру всей раскадровки"
        : (event.semanticAction || "команда"));
  const text = event.submittedText || "";
  const body = `${actionLabel}: ${text}`.trim();
  return stamp ? `${stamp} — ${body}` : body;
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
  let localEvidenceFailures = [];
  let live = null;
  let sendingNote = false;
  let sendingCommand = false;
  let availableTargets = { storyboardAvailable: false, panels: [] };
  let stickyTarget = null;
  let targetUnsupported = false;
  let rememberedExpandedSize = null;

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
      const stamp = formatResearchTimestamp(note.occurredAt);
      const text = note.submittedText || "";
      appendTextItem(notesHistory, stamp ? `${stamp} — ${text}` : text);
    }
  }

  function renderCommandsHistory() {
    if (!commandsHistory) return;
    clearChildren(commandsHistory);
    for (const event of commandEvents) {
      if (event?.surface && event.surface !== "dock_commands") continue;
      if (event?.eventKind !== "action_start") continue;
      const line = formatCommandsHistoryItem(event);
      if (line) appendTextItem(commandsHistory, line);
    }
  }

  function renderOperations() {
    if (!operationsList) return;
    clearChildren(operationsList);
    const projection = projectOperations({
      live,
      events: terminalEvents,
      localEvidenceFailures,
    });
    for (const item of projection) {
      const stamp = formatResearchTimestamp(item.occurredAt);
      const prefix = stamp ? `${stamp} — ` : "";
      appendTextItem(operationsList, `${prefix}${item.label}`);
    }
  }

  function reportEvidenceSaveFailure({
    correlationId = null,
    semanticAction = null,
    surface = null,
    phase = "terminal",
  } = {}) {
    const entry = {
      correlationId,
      semanticAction,
      surface,
      phase,
    };
    localEvidenceFailures = [
      ...localEvidenceFailures.filter((item) => item?.correlationId !== correlationId),
      entry,
    ];
    renderOperations();
  }

  function clearEvidenceSaveFailure(correlationId) {
    if (!correlationId) return;
    const next = localEvidenceFailures.filter((item) => item?.correlationId !== correlationId);
    if (next.length === localEvidenceFailures.length) return;
    localEvidenceFailures = next;
    renderOperations();
  }

  function clearCommandSelection() {
    stickyTarget = null;
    targetUnsupported = false;
  }

  function resolveStickyAgainstAvailable() {
    if (!stickyTarget) {
      targetUnsupported = false;
      return;
    }
    if (stickyTarget.kind === "storyboard") {
      if (availableTargets.storyboardAvailable) {
        targetUnsupported = false;
        stickyTarget = createEmptyCommandTarget("storyboard");
        return;
      }
      clearCommandSelection();
      return;
    }
    if (stickyTarget.kind === "panel") {
      const match = (availableTargets.panels || []).find((panel) => samePanelTarget(
        createEmptyCommandTarget("panel", panel),
        stickyTarget,
      ));
      if (match) {
        targetUnsupported = false;
        stickyTarget = createEmptyCommandTarget("panel", match);
        return;
      }
      clearCommandSelection();
      return;
    }
    clearCommandSelection();
  }

  function renderTargetControls() {
    resolveStickyAgainstAvailable();
    if (commandsTarget) {
      clearChildren(commandsTarget);
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Выберите действие";
      commandsTarget.append(placeholder);
      if (availableTargets.storyboardAvailable) {
        const option = document.createElement("option");
        option.value = "storyboard";
        option.textContent = "Изменить структуру всей раскадровки";
        commandsTarget.append(option);
      }
      for (const panel of availableTargets.panels || []) {
        const option = document.createElement("option");
        option.value = panelTargetKey(panel);
        option.textContent = ownerFacingCommandLabel(createEmptyCommandTarget("panel", panel));
        commandsTarget.append(option);
      }
      if (stickyTarget?.kind === "storyboard" && availableTargets.storyboardAvailable && !targetUnsupported) {
        commandsTarget.value = "storyboard";
      } else if (stickyTarget?.kind === "panel" && !targetUnsupported) {
        commandsTarget.value = panelTargetKey(stickyTarget);
      } else {
        commandsTarget.value = "";
      }
    }
    if (commandsTargetLabel) {
      commandsTargetLabel.textContent = formatCommandTargetLabel(stickyTarget, {
        unsupported: targetUnsupported,
        unselected: !stickyTarget,
      });
    }
    if (commandsUnavailable) {
      const noChoices = !availableTargets.storyboardAvailable
        && !(availableTargets.panels || []).length;
      commandsUnavailable.hidden = !noChoices;
      if (noChoices) {
        commandsUnavailable.textContent =
          "Нет поддерживаемого действия. Доступны правка раскадровки и панели открытого кадра.";
      }
    }
  }

  function rememberExpandedSizeFromDom() {
    if (!root || collapsed) return;
    const width = root.style?.width || (root.offsetWidth ? `${root.offsetWidth}px` : "");
    const height = root.style?.height || (root.offsetHeight ? `${root.offsetHeight}px` : "");
    if (width || height) {
      rememberedExpandedSize = {
        width: width || null,
        height: height || null,
      };
    }
  }

  function applyRememberedExpandedSize() {
    if (!root || !rememberedExpandedSize) return;
    if (rememberedExpandedSize.width) root.style.width = rememberedExpandedSize.width;
    if (rememberedExpandedSize.height) root.style.height = rememberedExpandedSize.height;
  }

  function clearInlineDockSize() {
    if (!root?.style) return;
    root.style.width = "";
    root.style.height = "";
    if (typeof root.style.removeProperty === "function") {
      root.style.removeProperty("width");
      root.style.removeProperty("height");
    }
  }

  function setCollapsed(next) {
    const becomingCollapsed = Boolean(next);
    if (becomingCollapsed && !collapsed) {
      rememberExpandedSizeFromDom();
      clearInlineDockSize();
    }
    collapsed = becomingCollapsed;
    if (root) {
      const classes = String(root.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((name) => name !== "research-dock--collapsed");
      if (collapsed) classes.push("research-dock--collapsed");
      root.className = classes.join(" ");
    }
    if (!collapsed) {
      applyRememberedExpandedSize();
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
            && event?.eventKind === "action_start"
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
        const protectedContent = payload?.kind === "protected-content";
        setNotesStatus(
          protectedContent
            ? "Не удалось сохранить заметку: текст отклонён."
            : "Не удалось сохранить заметку.",
          "error",
        );
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
    if (!stickyTarget || targetUnsupported) {
      setCommandsStatus(
        "Выберите действие — продуктовый вызов и запись исследования не выполнены.",
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
    if (!startSaved) {
      reportEvidenceSaveFailure({
        correlationId,
        semanticAction,
        surface: "dock_commands",
        phase: "start",
      });
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
      clearEvidenceSaveFailure(correlationId);
      terminalEvents = [...terminalEvents, terminalEvent];
      renderOperations();
    } else if (productOk) {
      reportEvidenceSaveFailure({
        correlationId,
        semanticAction,
        surface: "dock_commands",
        phase: "terminal",
      });
    } else if (!startSaved) {
      reportEvidenceSaveFailure({
        correlationId,
        semanticAction,
        surface: "dock_commands",
        phase: "start",
      });
    }

    live = null;
    renderOperations();
    if (productOk) {
      commandsDraft.value = "";
      if (!terminalEvent) {
        setCommandsStatus(EVIDENCE_SAVE_FAILURE_LABEL, "error");
      } else {
        setCommandsStatus("");
      }
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
        panelSubject: typeof panel.panelSubject === "string" ? panel.panelSubject : null,
      })).filter((panel) => panel.displayFrameId && Number.isInteger(panel.panelIndex)) : [],
    };
    resolveStickyAgainstAvailable();
    renderTargetControls();
  }

  function onTargetSelectChange() {
    if (!commandsTarget) return;
    const value = commandsTarget.value;
    if (!value) {
      clearCommandSelection();
      renderTargetControls();
      return;
    }
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
  if (root && typeof root.addEventListener === "function") {
    root.addEventListener("mouseup", () => {
      if (!collapsed) rememberExpandedSizeFromDom();
    });
    root.addEventListener("pointerup", () => {
      if (!collapsed) rememberExpandedSizeFromDom();
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
    getOperationsProjection: () => projectOperations({
      live,
      events: terminalEvents,
      localEvidenceFailures,
    }),
    setLiveOperation(next) {
      live = next ? { ...next } : null;
      renderOperations();
    },
    clearLiveOperation() {
      live = null;
      renderOperations();
    },
    reportEvidenceSaveFailure,
    clearEvidenceSaveFailure,
    recordTerminalEvent(event) {
      if (!event) return;
      if (event.correlationId) clearEvidenceSaveFailure(event.correlationId);
      terminalEvents = [...terminalEvents, event];
      if (event.surface === "dock_commands" && event.eventKind === "action_start") {
        commandEvents = [...commandEvents, event];
        renderCommandsHistory();
      }
      renderOperations();
    },
    captureContext: snapshotContext,
    createEmptyCommandTarget,
    setAvailableTargets,
    selectCommandTarget,
    getCommandTarget: () => (stickyTarget
      ? createEmptyCommandTarget(stickyTarget.kind, stickyTarget)
      : null),
    isCommandTargetUnsupported: () => !stickyTarget || targetUnsupported,
    rememberExpandedSizeFromDom,
    recordExpandedSize(size) {
      if (!size || typeof size !== "object") return;
      rememberedExpandedSize = {
        width: size.width || null,
        height: size.height || null,
      };
    },
    getRememberedExpandedSize: () => (rememberedExpandedSize
      ? { ...rememberedExpandedSize }
      : null),
  };
}
