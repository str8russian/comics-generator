import { projectApi, projectIdFromLocation } from "./project-api.mjs";
import { bindDuplicateDialog, DUPLICATE_LABEL, requestProjectDuplicate } from "./duplicate-project.mjs";
import { bindDraftAutosave } from "/draft-autosave.mjs";
import { assessDialogue, compileOverflow, pageState } from "/overflow.mjs";
import * as FrameRenderer from "/frame-renderer.mjs";
import {
  bindResearchDock,
  createEmptyCommandTarget,
  createEmptyContext,
  createEmptyEditTarget,
} from "/research-dock.mjs";
import { renderAnchorWorkspace } from "/anchor-session-ui.mjs";
import { openAssetPicker } from "/asset-picker.mjs";
import { compileTransitionTimeline, formatExportRuntime } from "/export-timing.mjs";
import { presentFrameForMount } from "/visual-anchors.mjs";
import { bindWorkspaceStages, STAGES } from "./workspace-stages.mjs";
import { createFrameEditor, renderFrameInspector } from "./frame-inspector.mjs";
import { basisChip, foregroundChip, panelBasis } from "./panel-basis.mjs";
import { REVISION_COPY, renderRevisionSummary } from "./panel-revision-view.mjs";
export { presentFrameForMount };

const draftCompiler = typeof globalThis.window === "undefined"
  ? (await import(new URL("../panel-revision.mjs", import.meta.url).href)).summarizeRevision
  : null;

function compileDraft(mode, instructionText) {
  if (typeof draftCompiler !== "function") return null;
  const summary = draftCompiler({
    mode,
    instruction: instructionText,
    baseline: {},
    basis: mode === "new-variation" ? { kind: "none" } : { kind: "current-panel" },
  });
  return summary?.ok ? summary : null;
}

const form = document.querySelector("#draft-form");
const draftField = document.querySelector("#draft");
const loading = document.querySelector("#loading");
const notice = document.querySelector("#notice");
const failureCodes = document.querySelector("#failure-codes");
const failureKind = document.querySelector("#failure-kind");
const grid = document.querySelector("#storyboard");
const openLast = document.querySelector("#open-last");
const detail = document.querySelector("#detail");
const detailHost = document.querySelector("#detail-frame");
const detailOutside = document.querySelector("#detail-outside");
const detailRetained = document.querySelector("#detail-retained-notice");
const utteranceEdit = document.querySelector("#utterance-edit");
const utteranceEditor = document.querySelector("#utterance-editor");
const utteranceSpeaker = document.querySelector("#utterance-speaker");
const utteranceSource = document.querySelector("#utterance-source");
const utteranceScope = document.querySelector("#utterance-scope");
const utteranceText = document.querySelector("#utterance-text");
const utteranceError = document.querySelector("#utterance-error");
const utteranceSave = document.querySelector("#utterance-save");
const utteranceCancel = document.querySelector("#utterance-cancel");
const frameDialogue = document.querySelector("#frame-dialogue");
const frameDialogueSpoken = document.querySelector("#frame-dialogue-spoken");
const frameDialogueText = document.querySelector("#frame-dialogue-text");
const frameDialogueSpeaker = document.querySelector("#frame-dialogue-speaker");
const frameDialogueError = document.querySelector("#frame-dialogue-error");
const materialCastStatus = document.querySelector("#material-cast-status");
const closeDetail = document.querySelector("#close-detail");
const detailPanelControls = document.querySelector("#detail-panel-controls");
const nextFrame = document.querySelector("#next-frame");
const actionStatus = document.querySelector("#action-status");
const detailFrameNumber = document.querySelector("#detail-frame-number");
const detailGenerationStatus = document.querySelector("#detail-generation-status");
const renderTransition = document.querySelector("#render-transition");
const renderIntro = document.querySelector("#render-intro");
const introAvailability = document.querySelector("#intro-availability");
const renderRuntime = document.querySelector("#render-runtime");
const charactersWorkspace = document.querySelector("#characters-workspace");
const characterCards = document.querySelector("#character-cards");
const visualHeading = document.querySelector("#visual-heading");
const visualProgress = document.querySelector("#visual-progress");
const visualApproval = document.querySelector("#visual-approval");
const approveVisual = document.querySelector("#approve-visual");
const approvalCopy = document.querySelector("#approval-copy");
const readyForVideo = document.querySelector("#ready-for-video");
const buildMarker = document.querySelector("#build-marker");
const globalUndo = document.querySelector("#global-undo");
const workspaceUndoSlot = document.querySelector("#workspace-undo-slot");
const frameEditorUndo = document.querySelector("#frame-editor-undo");
const frameEditorTabs = document.querySelector("#frame-editor-tabs");
const frameEditorFrame = document.querySelector("#frame-editor-frame");
const prevFrame = document.querySelector("#prev-frame");
const frameEditorLeave = document.querySelector("#frame-editor-leave");
const frameEditorLeaveStay = document.querySelector("#frame-editor-leave-stay");
const frameEditorLeaveDiscard = document.querySelector("#frame-editor-leave-discard");
const frameEditorLeaveSave = document.querySelector("#frame-editor-leave-save");
const renderPanel = document.querySelector("#render-panel");
const renderStatus = document.querySelector("#render-status");
const startRender = document.querySelector("#start-render");
const renderError = document.querySelector("#render-error");
const renderPreview = document.querySelector("#render-preview");
const renderDownload = document.querySelector("#render-download");

const materialReview = document.querySelector("#material-review");
const materialSources = document.querySelector("#material-sources");
const materialCharacters = document.querySelector("#material-characters");
const addCharacterButton = document.querySelector("#add-character");
const addCharacterForm = document.querySelector("#add-character-form");
const addCharacterName = document.querySelector("#add-character-name");
const addCharacterSave = document.querySelector("#add-character-save");
const addCharacterCancel = document.querySelector("#add-character-cancel");
if (addCharacterButton) addCharacterButton.textContent = "Добавить персонажа";
if (addCharacterSave) addCharacterSave.textContent = "Добавить";
if (addCharacterCancel) addCharacterCancel.textContent = "Отмена";
const materialAliases = document.querySelector("#material-aliases");
const materialSpeakers = document.querySelector("#material-speakers");
const materialFindings = document.querySelector("#material-findings");
const materialMismatch = document.querySelector("#material-mismatch");
const confirmMaterial = document.querySelector("#confirm-material");
const stageMaterial = document.querySelector("#stage-material");
const researchDockHost = document.querySelector("#research-dock-host");
const researchDockRoot = document.querySelector("#research-dock");
const stageNav = document.querySelector("#stage-nav");
const framesArea = document.querySelector("#frames-area");
const frameInspector = document.querySelector("#frame-inspector");
const panelEditor = document.querySelector("#panel-editor");
const panelEditorTabs = document.querySelector("#panel-editor-tabs");
const framePanelActions = document.querySelector("#frame-panel-actions");
const detailTitle = document.querySelector("#detail-title");
const detailScroll = document.querySelector("#detail-scroll");
const revisionConfirm = document.querySelector("#revision-confirm");
const revisionConfirmKeep = document.querySelector("#revision-confirm-keep");
const revisionConfirmDo = document.querySelector("#revision-confirm-do");

let workspaceStages = null;
let selection = null;
let frameEditor = null;
let revisionPreflightEpoch = 0;
let dockSuspended = false;
let dockRestoreCollapsed = null;
let revisionCancelHandler = null;
let lastRenderStatus = null;
let readyFrames = [];
let draftSync = { state: "boot", savedText: null };
let review = null;
let castChain = Promise.resolve();
let visual = null;
let statusTimer = 0;
let busy = false;
let pendingCastEdit = null;
let pendingAddition = null;
let characterAddLocked = false;

export function setResearchDetailState(frames, index = -1) {
  readyFrames = Array.isArray(frames) ? frames.slice() : [];
  frameEditor?.setCurrentIndex(index);
}

export function setResearchVisualState(next, index = -1) {
  if (!next || next.status !== "ready") {
    visual = null;
    readyFrames = [];
    frameEditor?.setCurrentIndex(-1);
    if (charactersWorkspace) charactersWorkspace.hidden = true;
    if (characterCards) characterCards.replaceChildren();
    if (detailPanelControls) detailPanelControls.replaceChildren();
    return;
  }
  visual = next;
  readyFrames = withVisualReady(next.frames || []);
  frameEditor?.setCurrentIndex(index);
  if (charactersWorkspace) charactersWorkspace.hidden = false;
  if (visualHeading) visualHeading.hidden = !next.allAnchorsApproved;
  if (visualApproval) visualApproval.hidden = !next.complete;
  if (approveVisual) approveVisual.hidden = Boolean(next.readyForVideo);
  if (readyForVideo) readyForVideo.hidden = !next.readyForVideo;
  if (openLast) openLast.hidden = readyFrames.length === 0;
  renderCharacterCards();
  if (grid) {
    grid.replaceChildren();
    readyFrames.forEach((frame, frameIndex) => {
      const card = document.createElement("article");
      card.className = "story-card";
      const generate = document.createElement("button");
      generate.type = "button";
      generate.className = "generate-frame";
      generate.textContent = "Создать кадр";
      generate.addEventListener("click", async () => {
        await generateFrame(frame.id, generate, frameIndex);
      });
      card.append(generate);
      grid.append(card);
    });
  }
  if (frameEditor?.index >= 0 && readyFrames[frameEditor.index]) {
    renderPanelControls(readyFrames[frameEditor.index]);
  } else if (detailPanelControls) {
    detailPanelControls.replaceChildren();
  }
}

export function setResearchReviewState(documentState, mode) {
  showMaterial(documentState, mode);
}

export async function captureTestGenerateFrame(frameId, index = 0) {
  await generateFrame(frameId, { textContent: "" }, index);
}

export function captureResearchContext() {
  let workflowPhase = null;
  if (visual?.readyForVideo || visual?.approved) workflowPhase = "approved";
  else if (visual?.allAnchorsApproved) workflowPhase = "visual";
  else if (visual?.characters?.length) workflowPhase = "characters";
  else if (readyFrames.length) workflowPhase = "structure";
  else if (review?.mode === "material") workflowPhase = "material";
  else if (review?.mode === "reading") workflowPhase = "reading";
  else if (typeof draftField?.value === "string" && draftField.value.length > 0) workflowPhase = "draft";

  const detailIndex = frameEditor?.index ?? -1;
  const frame = detailIndex >= 0 ? readyFrames[detailIndex] : null;
  return createEmptyContext({
    workflowPhase,
    storyboardVersionId: typeof visual?.storyboardVersionId === "string" ? visual.storyboardVersionId : null,
    displayFrameNumber: detailIndex >= 0 ? detailIndex + 1 : null,
    displayFrameId: typeof frame?.id === "string" ? frame.id : null,
    structureFrameId: typeof frame?.structureFrameId === "string" ? frame.structureFrameId : null,
    structureSegmentIndex: Number.isInteger(frame?.structureSegmentIndex) ? frame.structureSegmentIndex : null,
    panelIndex: null,
    panelSubject: null,
    imageAssetId: null,
    generationId: null,
    characterName: null,
    anchorVersionId: null,
  });
}

function frameActionContextOverrides(frame, displayFrameNumber = null) {
  return {
    displayFrameNumber: Number.isInteger(displayFrameNumber) ? displayFrameNumber : null,
    displayFrameId: typeof frame?.id === "string" ? frame.id : null,
    structureFrameId: typeof frame?.structureFrameId === "string" ? frame.structureFrameId : null,
    structureSegmentIndex: Number.isInteger(frame?.structureSegmentIndex) ? frame.structureSegmentIndex : null,
  };
}

function panelActionContextOverrides(frame, panel, panelIndex, displayFrameNumber = null) {
  return {
    ...frameActionContextOverrides(frame, displayFrameNumber),
    panelIndex: Number.isInteger(panelIndex) ? panelIndex : null,
    panelId: typeof panel?.id === "string" ? panel.id : null,
    panelSubject: typeof panel?.subject === "string" ? panel.subject : null,
    imageAssetId: typeof panel?.assetId === "string" ? panel.assetId : null,
    generationId: typeof panel?.generationId === "string" ? panel.generationId : null,
  };
}

function characterActionContextOverrides(character, {
  imageAssetId = null,
  anchorVersionId = null,
} = {}) {
  return {
    characterName: typeof character?.name === "string" ? character.name : null,
    imageAssetId: typeof imageAssetId === "string" ? imageAssetId : null,
    anchorVersionId: typeof anchorVersionId === "string" ? anchorVersionId : null,
  };
}

async function postResearchEvent(body) {
  try {
    const response = await fetch(scoped("/api/research/events"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.event ?? null;
  } catch {
    return null;
  }
}

function beginProductResearchCapture({
  semanticAction,
  submittedText = null,
  commandTarget = null,
  editTarget = null,
  contextOverrides = null,
}) {
  const correlationId = crypto.randomUUID();
  const ambient = captureResearchContext();
  const context = createEmptyContext({
    ...ambient,
    ...(contextOverrides && typeof contextOverrides === "object" ? contextOverrides : {}),
  });
  const startSnapshot = {
    semanticAction,
    surface: "product_control",
    submittedText,
    commandTarget,
    editTarget,
    context,
  };
  let startSaved = false;
  let finished = false;

  return {
    correlationId,
    startSnapshot,
    async start() {
      try {
        const startEvent = await postResearchEvent({
          eventKind: "action_start",
          correlationId,
          ...startSnapshot,
        });
        startSaved = Boolean(startEvent);
        if (startEvent) {
          researchDock?.recordTerminalEvent(startEvent);
        } else {
          researchDock?.reportEvidenceSaveFailure?.({
            correlationId,
            semanticAction,
            surface: "product_control",
            phase: "start",
          });
        }
      } catch {
        startSaved = false;
        researchDock?.reportEvidenceSaveFailure?.({
          correlationId,
          semanticAction,
          surface: "product_control",
          phase: "start",
        });
      }
      return startSaved;
    },
    async terminal(outcome, { outcomeKind = null, outcomeFlags = {}, resultContext = null } = {}) {
      if (finished) return null;
      finished = true;
      const terminalBody = {
        eventKind: "action_terminal",
        correlationId,
        outcome,
        outcomeKind,
        outcomeFlags,
      };
      if (resultContext && typeof resultContext === "object") terminalBody.resultContext = resultContext;
      if (!startSaved) terminalBody.startSnapshot = startSnapshot;
      const terminalEvent = await postResearchEvent(terminalBody);
      if (terminalEvent) {
        researchDock?.recordTerminalEvent(terminalEvent);
      } else {
        researchDock?.reportEvidenceSaveFailure?.({
          correlationId,
          semanticAction,
          surface: "product_control",
          phase: "terminal",
        });
      }
      return terminalEvent;
    },
  };
}

function normalizeResearchClassification(classified) {
  if (!classified || typeof classified !== "object") {
    return { outcome: "success", outcomeKind: null, outcomeFlags: {} };
  }
  const outcome = classified.outcome === "failure"
    || classified.outcome === "blocked"
    || classified.outcome === "no-change"
    ? classified.outcome
    : "success";
  return {
    outcome,
    outcomeKind: typeof classified.outcomeKind === "string" ? classified.outcomeKind : null,
    outcomeFlags: classified.outcomeFlags && typeof classified.outcomeFlags === "object"
      ? classified.outcomeFlags
      : {},
    resultContext: classified.resultContext && typeof classified.resultContext === "object"
      ? classified.resultContext
      : null,
  };
}

async function runProductResearchAction({
  semanticAction,
  submittedText = null,
  commandTarget = null,
  editTarget = null,
  contextOverrides = null,
  busyMessage = null,
  classifyResult = null,
  operation,
}) {
  const capture = beginProductResearchCapture({
    semanticAction,
    submittedText,
    commandTarget,
    editTarget,
    contextOverrides,
  });

  const execute = async () => {
    if (busyMessage) {
      researchDock?.setLiveOperation({
        correlationId: capture.correlationId,
        semanticAction,
        surface: "product_control",
      });
    }
    await capture.start();
    try {
      const result = await operation({ correlationId: capture.correlationId });
      const classified = normalizeResearchClassification(
        typeof classifyResult === "function" ? classifyResult(result) : null,
      );
      await capture.terminal(classified.outcome, {
        outcomeKind: classified.outcomeKind,
        outcomeFlags: classified.outcomeFlags,
        resultContext: classified.resultContext,
      });
      return result;
    } catch (error) {
      const outcomeFlags = error?.outcomeFlags && typeof error.outcomeFlags === "object"
        ? error.outcomeFlags
        : {};
      await capture.terminal("failure", {
        outcomeKind: typeof error?.kind === "string" ? error.kind : "request-failed",
        outcomeFlags,
      });
      throw error;
    } finally {
      if (busyMessage) researchDock?.clearLiveOperation();
    }
  };

  if (busyMessage) return runBusy(busyMessage, execute);
  try {
    return await execute();
  } catch {
    return null;
  }
}

  const researchDock = researchDockRoot
  ? bindResearchDock({
    root: researchDockRoot,
    host: researchDockHost,
    detail,
    getContext: captureResearchContext,
  })
  : null;

export function getResearchDock() {
  return researchDock;
}

workspaceStages = stageNav
  ? bindWorkspaceStages({
    nav: stageNav,
    views: Object.fromEntries(STAGES.map((stage) => [stage.id, document.querySelector(`#stage-view-${stage.id}`)])),
    headers: Object.fromEntries(STAGES.map((stage) => [stage.id, document.querySelector(`#stage-header-${stage.id}`)])),
    framesArea,
    getFacts: workspaceFacts,
    onAction: runStageAction,
  })
  : null;
renderInspector();

export const draftAutosave = bindDraftAutosave({
  textarea: draftField,
  conflict: document.querySelector("#draft-conflict"),
  reloadButton: document.querySelector("#reload-draft"),
  keepButton: document.querySelector("#keep-draft"),
  onActivity(activity) {
    draftSync = activity;
    refreshConfirmation();
  },
});

function clearBoard() {
  readyFrames = [];
  visual = null;
  grid.replaceChildren();
  openLast.hidden = true;
  charactersWorkspace.hidden = true;
  visualHeading.hidden = true;
  visualApproval.hidden = true;
  readyForVideo.hidden = true;
  if (renderPanel) renderPanel.hidden = true;
  if (globalUndo) globalUndo.hidden = true;
  document.body.dataset.state = "";
  selection = null;
  renderInspector();
  refreshStages();
}

function showLoading() {
  clearBoard();
  notice.hidden = true;
  notice.textContent = "";
  loading.hidden = false;
  failureCodes.replaceChildren();
  failureCodes.hidden = true;
  failureKind.hidden = true;
  failureKind.textContent = "";
  delete document.body.dataset.kind;
}

function hideFailure() {
  failureCodes.replaceChildren();
  failureCodes.hidden = true;
  failureKind.hidden = true;
  failureKind.textContent = "";
  delete document.body.dataset.kind;
}

function showTerminal(view) {
  loading.hidden = true;
  clearBoard();
  document.body.dataset.state = view.state;
  notice.hidden = false;
  notice.textContent = view.state;
  failureCodes.replaceChildren();
  if (view.state === "blocked") {
    failureCodes.hidden = false;
    for (const code of view.codes || []) {
      const item = document.createElement("li");
      item.textContent = code;
      failureCodes.append(item);
    }
    failureKind.hidden = true;
    failureKind.textContent = "";
    delete document.body.dataset.kind;
    refreshStages();
    return;
  }
  failureCodes.hidden = true;
  failureKind.hidden = false;
  failureKind.textContent = view.kind || "";
  document.body.dataset.kind = view.kind || "";
  refreshStages();
}

export const STORY_CARD_CHROME = Object.freeze({
  desktopBorderBox: 384,
  padding: 12,
  border: 1,
});

export function cardContentWidth(borderBoxWidth, chrome = STORY_CARD_CHROME) {
  const width = Number(borderBoxWidth);
  if (!Number.isFinite(width)) return 0;
  return Math.max(0, width - chrome.padding * 2 - chrome.border * 2);
}

export function framePreviewGeometry(contentWidth) {
  const width = Number(contentWidth);
  const frameWidth = FrameRenderer.FRAME_GEOMETRY.width;
  const frameHeight = FrameRenderer.FRAME_GEOMETRY.height;
  if (!Number.isFinite(width) || width <= 0 || !(frameWidth > 0)) return null;
  const scale = width / frameWidth;
  return {
    contentWidth: width,
    scale,
    width,
    height: width * (frameHeight / frameWidth),
  };
}

function previewContentWidth(host) {
  const measured = Number(host?.clientWidth);
  if (Number.isFinite(measured) && measured > 0) return measured;
  return cardContentWidth(STORY_CARD_CHROME.desktopBorderBox);
}

function applyFramePreviewBox(stage, contentWidth) {
  const box = framePreviewGeometry(contentWidth);
  if (!box || !stage?.style) return null;
  stage.style.width = `${box.width}px`;
  stage.style.height = `${box.height}px`;
  stage.style.setProperty("--frame-scale", String(box.scale));
  if (stage.dataset) stage.dataset.frameScale = String(box.scale);
  return box;
}

const cardPreviewObservers = new WeakMap();

function fitCardPreview(host) {
  const stage = host?.querySelector?.(".frame-stage");
  if (!stage) return null;
  return applyFramePreviewBox(stage, previewContentWidth(host));
}

function watchCardPreview(host) {
  fitCardPreview(host);
  if (!host || typeof ResizeObserver !== "function") return;
  cardPreviewObservers.get(host)?.disconnect?.();
  const observer = new ResizeObserver(() => fitCardPreview(host));
  cardPreviewObservers.set(host, observer);
  observer.observe(host);
}

export function refitFramePreviews(root = grid) {
  const cards = root?.querySelectorAll?.(".story-card") || [];
  for (const card of cards) {
    const host = card.querySelector?.(".frame-host");
    if (host) fitCardPreview(host);
  }
}

function scheduleCardPreviewRefit() {
  refitFramePreviews();
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => refitFramePreviews());
  }
}

globalThis.addEventListener?.("resize", () => refitFramePreviews());

function mountFrame(host, frame, scale, mode) {
  host.replaceChildren();
  const stage = document.createElement("div");
  stage.className = "frame-stage";
  stage.style.width = `${FrameRenderer.FRAME_GEOMETRY.width * scale}px`;
  stage.style.height = `${FrameRenderer.FRAME_GEOMETRY.height * scale}px`;
  stage.style.setProperty("--frame-scale", String(scale));
  stage.dataset.frameScale = String(scale);
  const presented = presentFrameForMount(frame, mode);
  stage.append(FrameRenderer.render(presented.frame, { mode: presented.mode }));
  host.append(stage);
}

async function presentCheckedStoryboard(payload) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  let fitted;
  try {
    fitted = compileOverflow(payload.frames, (text, options) => FrameRenderer.measureDialogue(document, {
      layout: options.layout,
      speakerPanel: options.speakerPanel,
      panels: options.panels,
      dialogue: text,
    }, options.fontSize));
  } catch {
    showTerminal(pageState({ measurementError: true, http: payload }));
    return;
  }
  const dialogue = fitted.ok ? assessDialogue(payload.sourceItems || [], fitted.frames) : null;
  const view = pageState({ http: payload, fitted, dialogue });
  if (view.state !== "ready") {
    showTerminal(view);
    return;
  }
  showReady(fitted.frames, payload.readyEligible === true ? "ready" : "checked");
}

function showReady(frames, state = "ready") {
  loading.hidden = true;
  hideFailure();
  readyFrames = frames;
  document.body.dataset.state = state;
  notice.hidden = state === "ready";
  notice.textContent = state === "ready" ? "" : state;
  grid.replaceChildren();
  frames.forEach((frame, index) => grid.append(frameCard(frame, index)));
  scheduleCardPreviewRefit();
  resolveSelection();
  markSelectedCards();
  renderInspector();
  openLast.hidden = frames.length === 0;
  if (renderPanel) renderPanel.hidden = !visual;
  if (renderPanel && !renderPanel.hidden) refreshRenderStatus();
  refreshStages();
}

function textElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

const OVERVIEW_DIALOGUE_STATUS = { silent: "Молчание", hidden: "Без реплики" };
const GENERATION_ERROR_STATUS = "Ошибка генерации";

function overviewStatuses(frame) {
  if (frame?.frameKind === "text") return [];
  const statuses = [];
  const dialogue = OVERVIEW_DIALOGUE_STATUS[frame?.dialogueMode];
  if (dialogue) statuses.push({ text: dialogue, error: false });
  const failed = (frame?.panels || []).some((entry) => entry?.generationStatus === "failed");
  if (failed) statuses.push({ text: GENERATION_ERROR_STATUS, error: true });
  return statuses;
}

function overviewStatusRow(frame) {
  const statuses = overviewStatuses(frame);
  if (!statuses.length) return null;
  const row = document.createElement("div");
  row.className = "card-statuses";
  for (const status of statuses) {
    const node = textElement(
      "span",
      status.error ? "card-status card-status-error" : "card-status",
      status.text,
    );
    if (status.error && node.dataset) node.dataset.status = "generation-error";
    row.append(node);
  }
  return row;
}

function frameCard(frame, index) {
  const card = document.createElement("article");
  card.className = "story-card";
  card.dataset.ready = frame.visualReady ? "true" : "false";
  card.dataset.structureFrameId = frame.structureFrameId || frame.id || "";
  card.dataset.frameIndex = String(index);
  card.setAttribute?.("tabindex", "0");
  card.setAttribute?.("aria-label", `Кадр ${index + 1}`);
  const preview = document.createElement("div");
  preview.className = "frame-preview";
  const host = document.createElement("div");
  host.className = "frame-host";
  mountFrame(host, frame, 1);
  watchCardPreview(host);
  preview.append(host);
  if (frame.retainedImageNotice) preview.append(textElement("p", "retained-image-notice", frame.retainedImageNotice));
  if (frame.outsideFrameText) preview.append(textElement("p", "outside-frame", frame.outsideFrameText));
  const foot = document.createElement("div");
  foot.className = "card-foot";
  if (frame.frameKind === "text") {
    const top = document.createElement("div");
    top.className = "card-heading";
    top.append(textElement("span", "", `Кадр ${index + 1}`));
    top.append(textElement("span", "card-status", "Текстовая карточка"));
    card.append(top, textElement("p", "card-meta", "Текстовая карточка"), preview);
    const line = String(frame.textCard || "");
    if (line.trim()) card.append(textElement("p", "card-line", line));
    const seconds = formatSeconds(frame.durationSeconds);
    if (seconds && Number.isInteger(frame.durationFrames)) {
      foot.append(textElement("span", "card-duration", `${seconds} с · ${frame.durationFrames} кадров`));
    }
  } else {
    card.append(preview);
    const statuses = overviewStatusRow(frame);
    if (statuses) card.append(statuses);
    foot.append(textElement("span", "card-frame-number", `Кадр ${index + 1}`));
  }
  const open = document.createElement("button");
  open.type = "button";
  open.className = "card-open";
  open.textContent = "Открыть";
  open.addEventListener("click", (event) => {
    event?.stopPropagation?.();
    frameEditor.open(index);
  });
  foot.append(open);
  card.append(foot);
  card.addEventListener("click", () => selectFrameAt(index));
  card.addEventListener("dblclick", () => frameEditor.open(index));
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault?.();
    selectFrameAt(index);
  });
  return card;
}

function selectionKey(address) {
  return address ? `${address.structureFrameId}#${address.structureSegmentIndex ?? ""}` : "";
}

function selectedFrameIndex() {
  if (!selection) return -1;
  const index = structureFrameIndex(selection.structureFrameId, selection.structureSegmentIndex);
  return index >= 0 && frameMatchesAddress(readyFrames[index], selection.structureFrameId, selection.structureSegmentIndex)
    ? index
    : -1;
}

function setSelectionTo(index) {
  const frame = readyFrames[index];
  if (!frame) {
    selection = null;
    return;
  }
  selection = { ...frameAddress(frame), index };
}

function resolveSelection() {
  if (!selection) return;
  const index = structureFrameIndex(selection.structureFrameId, selection.structureSegmentIndex);
  if (index >= 0) {
    setSelectionTo(index);
    return;
  }
  if (!readyFrames.length) {
    selection = null;
    return;
  }
  setSelectionTo(Math.min(Math.max(selection.index - 1, 0), readyFrames.length - 1));
}

function markSelectedCards() {
  const current = selectedFrameIndex();
  for (const card of grid?.children || []) {
    const on = Number(card.dataset?.frameIndex) === current;
    const classes = String(card.className || "").split(/\s+/).filter((name) => name && name !== "is-selected");
    if (on) classes.push("is-selected");
    card.className = classes.join(" ");
    if (on) card.setAttribute?.("aria-current", "true");
    else card.removeAttribute?.("aria-current");
  }
}

function selectFrameAt(index) {
  if (!readyFrames[index]) return;
  setSelectionTo(index);
  markSelectedCards();
  renderInspector();
}

export function clearFrameSelection() {
  selection = null;
  markSelectedCards();
  renderInspector();
}

function renderInspector() {
  if (!frameInspector) return;
  frameInspector.hidden = readyFrames.length === 0;
  const index = selectedFrameIndex();
  const frame = index >= 0 ? readyFrames[index] : null;
  renderFrameInspector(frameInspector, frame ? inspectorModel(frame, index) : null, frame ? inspectorActions(frame, index) : {});
}

function inspectorModel(frame, index) {
  const address = frameAddress(frame);
  const key = selectionKey(address);
  const order = structureIdsInOrder(readyFrames);
  const structureIndex = order.indexOf(address.structureFrameId);
  const framePanels = frame.panels || [];
  const panels = framePanels.map((panel, panelIndex) => ({
    index: panelIndex,
    address: `${index + 1}.${panelIndex + 1}`,
    subject: panel.subject || null,
    manualSubject: panel.manualSubject || null,
    subjectEditable: Boolean(panel.subjectEditable),
    basisChip: basisChip(frame, panelIndex),
  }));
  return {
    key,
    displayNumber: index + 1,
    frameKind: frame.frameKind || null,
    layoutLabel: frame.frameKind === "text"
      ? "Текстовая карточка"
      : [frame.layout, frame.frameKind === "image" ? "кадр с изображением" : null].filter(Boolean).join(" · "),
    statusText: frameStatus(frame),
    assembly: Boolean(visual),
    timing: {
      label: `${formatSeconds(frame.durationSeconds)} с · ${frame.durationFrames} кадров`,
      frames: frame.durationFrames || 36,
      min: frame.minimumDurationFrames || 1,
    },
    canMoveEarlier: structureIndex > 0,
    canMoveLater: structureIndex >= 0 && structureIndex < order.length - 1,
    segmentNote: Number.isInteger(frame.structureSegmentIndex)
      ? "Это часть структурного кадра. Дублирование, вставка, удаление и порядок относятся ко всему структурному кадру."
      : null,
    textCard: frame.textCard || "",
    panels,
    characterNames: (visual?.characters || []).map((character) => character.name),
    showGenerate: Boolean(visual?.allAnchorsApproved)
      && !frame.visualReady
      && frame.frameKind !== "text"
      && frame.frameKind !== "image",
  };
}

function inspectorActions(frame, index) {
  const address = frameAddress(frame);
  const panels = frame.panels || [];
  return {
    openEditor: () => frameEditor.open(index),
    openPanel: (panelIndex) => {
      frameEditor.open(index, { panelIndex });
      frameEditor.selectPanel(panelIndex);
    },
    clearSelection: () => clearFrameSelection(),
    duplicate: () => runAssembly({
      op: "duplicateFrame",
      structureFrameId: address.structureFrameId,
      structureSegmentIndex: address.structureSegmentIndex,
    }, "Дублирую кадр…", { frame }),
    setDuration: (value) => runAssembly({
      op: "setDuration",
      ...address,
      durationFrames: Number(value),
    }, "Сохраняю длительность…", { submittedText: String(value), frame }),
    insertImageAfter: () => runAssembly({
      op: "insertFrame",
      afterStructureFrameId: address.structureFrameId,
      kind: "image",
    }, "Добавляю кадр…", { frame }),
    insertTextAfter: () => runAssembly({
      op: "insertFrame",
      afterStructureFrameId: address.structureFrameId,
      kind: "text",
    }, "Добавляю текстовую карточку…", { frame }),
    moveEarlier: () => moveStructureFrame(address.structureFrameId, -1),
    moveLater: () => moveStructureFrame(address.structureFrameId, 1),
    deleteFrame: () => runAssembly({
      op: "deleteFrame",
      structureFrameId: address.structureFrameId,
    }, "Удаляю кадр…", { frame }),
    setTextCard: (text) => runAssembly({
      op: "setTextCard",
      structureFrameId: address.structureFrameId,
      text,
    }, "Сохраняю текст карточки…", { submittedText: text, frame }),
    addPanel: () => runAssembly({
      op: "addPanel",
      ...address,
    }, "Добавляю панель…", { frame }),
    swapPanels: () => runAssembly({
      op: "reorderPanels",
      ...address,
      panelIds: [panels[1].id, panels[0].id],
    }, "Меняю панели местами…", { frame }),
    deletePanel: (panelIndex) => deletePanelWithConfirmation(frame, panels[panelIndex], panelIndex),
    setManualSubject: (panelIndex, characterName) => runAssembly({
      op: "setManualSubject",
      panelId: panels[panelIndex].id,
      characterName,
    }, "Сохраняю персонажа панели…", { submittedText: characterName, frame, panel: panels[panelIndex], panelIndex }),
    chooseAsset: (panelIndex, anchor, carryMetadata) => openPanelAssetPicker(frame, panels[panelIndex], panelIndex, anchor, carryMetadata),
    generateFrame: (button) => generateFrame(frame.id, button, index),
  };
}

function refreshStages() {
  workspaceStages?.refresh();
}

function workspaceFacts() {
  const state = document.body?.dataset?.state;
  return {
    draftText: typeof draftField?.value === "string" ? draftField.value : "",
    review: review?.mode || null,
    storyboardFailed: state === "blocked" || state === "failed",
    frames: readyFrames,
    visual,
    render: lastRenderStatus,
  };
}

function runStageAction(next, button) {
  const frame = readyFrames[next?.frameIndex];
  if (!frame) return;
  if (next.action === "generate-frame") generateFrame(frame.id, button, next.frameIndex);
  else if (next.action === "open-frame") frameEditor.open(next.frameIndex);
}

function frameStatus(frame) {
  const panels = Array.isArray(frame.panels) ? frame.panels : [];
  const readyCount = panels.filter((panel) => panel?.assetId).length;
  if (frame.frameKind === "text") return "Текстовая карточка";
  if (readyCount > 0 && readyCount < panels.length) return "Изображение готово частично";
  if (frame.frameKind === "image" || !String(frame.dialogue || "").trim()) {
    return frame.visualReady ? "Изображение" : "Кадр без реплики";
  }
  return frame.visualReady ? "Изображения готовы" : "Текст";
}

function formatSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 1000) / 1000);
}

function structureIdsInOrder(frames) {
  const ids = [];
  for (const frame of frames) {
    const id = frame.structureFrameId || frame.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function frameAddress(frame) {
  return {
    structureFrameId: frame.structureFrameId || frame.id,
    structureSegmentIndex: Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : null,
  };
}

function assemblyCommandTarget(frame, panel = null, panelIndex = null) {
  const displayIndex = readyFrames.findIndex((entry) => (
    (entry.structureFrameId || entry.id) === (frame?.structureFrameId || frame?.id)
    && entry.structureSegmentIndex === frame?.structureSegmentIndex
  ));
  const displayFrameNumber = displayIndex >= 0 ? displayIndex + 1 : null;
  const shared = {
    displayFrameNumber,
    displayFrameId: typeof frame?.id === "string" ? frame.id : null,
    structureFrameId: frame?.structureFrameId || frame?.id || null,
    structureSegmentIndex: Number.isInteger(frame?.structureSegmentIndex) ? frame.structureSegmentIndex : null,
  };
  if (panel) {
    return createEmptyCommandTarget("panel", {
      ...shared,
      panelIndex,
      panelId: panel.id,
    });
  }
  return createEmptyCommandTarget("frame", shared);
}

async function runAssembly(operation, message, {
  submittedText = null,
  frame = null,
  panel = null,
  panelIndex = null,
  previousDialogueMode = null,
} = {}) {
  const semanticAction = {
    insertFrame: "frame_insert",
    deleteFrame: "frame_delete",
    duplicateFrame: "frame_duplicate",
    reorderFrames: "frame_reorder",
    addPanel: "panel_add",
    deletePanel: "panel_delete",
    reorderPanels: "panel_reorder",
    setDuration: "frame_duration",
    setTextCard: "text_card",
    setManualSubject: "panel_subject",
    setFrameDialogue: "frame_dialogue",
    uploadAsset: "asset_assign",
    assignAsset: "asset_assign",
  }[operation?.op] || "storyboard_edit";
  const commandTarget = frame
    ? assemblyCommandTarget(frame, panel, panelIndex)
    : createEmptyCommandTarget("storyboard");
  return runProductResearchAction({
    semanticAction,
    submittedText,
    commandTarget,
    contextOverrides: {
      displayFrameNumber: commandTarget.displayFrameNumber,
      displayFrameId: commandTarget.displayFrameId,
      structureFrameId: commandTarget.structureFrameId,
      structureSegmentIndex: commandTarget.structureSegmentIndex,
      panelIndex: commandTarget.panelIndex,
      panelId: commandTarget.panelId,
      panelSubject: panel?.subject || null,
    },
    busyMessage: message,
    classifyResult: (result) => {
      if (operation?.op === "duplicateFrame") {
        if (result?.changed === false) return { outcome: "no-change" };
        const resultContext = createdFrameResearchAddress(
          result?.operationResult?.created,
          operation.structureSegmentIndex,
        );
        return resultContext ? { outcome: "success", resultContext } : { outcome: "success" };
      }
      const flags = operation?.op === "setFrameDialogue" && operation.dialogueMode
        ? {
          dialogueMode: operation.dialogueMode,
          ...(previousDialogueMode ? { previousDialogueMode } : {}),
        }
        : null;
      if (result?.changed === false) {
        return flags ? { outcome: "no-change", outcomeFlags: flags } : { outcome: "no-change" };
      }
      return flags ? { outcome: "success", outcomeFlags: flags } : null;
    },
    async operation() {
      const next = await fetchJson("/api/visual/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...operation,
          displayFrameNumber: commandTarget.displayFrameNumber,
          panelIndex: commandTarget.kind === "panel" ? commandTarget.panelIndex : operation.panelIndex,
        }),
      });
      if (next?.changed === false) {
        showActionNotice("Без изменений.", "no-change");
        return next;
      }
      if (next?.status === "ready") {
        applyVisual(next);
        if (operation?.op === "duplicateFrame") {
          openStructureAddress(next?.operationResult?.created);
        }
        showActionNotice("Изменение сохранено.", "success");
      }
      return next;
    },
  });
}

function moveStructureFrame(structureFrameId, direction) {
  const ids = structureIdsInOrder(readyFrames);
  const index = ids.indexOf(structureFrameId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  const next = ids.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  const frame = readyFrames.find((entry) => (entry.structureFrameId || entry.id) === structureFrameId);
  runAssembly({ op: "reorderFrames", structureFrameIds: next }, "Меняю порядок кадров…", { frame });
}

function panelAssets() {
  return (visual?.reusableAssets || []).map((asset) => {
    const provenance = asset.provenance && typeof asset.provenance === "object" ? asset.provenance : null;
    return {
      ...asset,
      subject: provenance?.subject || null,
      sourceLabel: provenance?.origin === "upload"
        ? "Загрузка"
        : (provenance?.origin === "generation" ? "Генерация" : null),
    };
  });
}

function openPanelAssetPicker(frame, panel, panelIndex, anchor, readCarryMetadata) {
  const carryMetadata = () => (typeof readCarryMetadata === "function" ? readCarryMetadata() : Boolean(readCarryMetadata));
  const assign = (operation, message) => runAssembly(operation, message, { frame, panel, panelIndex });
  openAssetPicker({
    anchor,
    assets: panelAssets(),
    currentAssetId: panel.assetId,
    obstacles: () => statusObstacles(),
    onSelect: (asset) => {
      assign({
        op: "assignAsset",
        assetId: asset.id,
        carryMetadata: carryMetadata(),
        targets: [{ panelId: panel.id }],
      }, "Назначаю изображение…");
    },
    onUpload: () => {
      const upload = document.createElement("input");
      upload.type = "file";
      upload.accept = "image/png,image/jpeg,image/webp";
      upload.addEventListener("change", () => {
        const file = upload.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          assign({
            op: "uploadAsset",
            imageDataUrl: String(reader.result || ""),
            carryMetadata: carryMetadata(),
            targets: [{ panelId: panel.id }],
          }, "Назначаю загруженное изображение…");
        };
        reader.readAsDataURL(file);
      });
      upload.click();
    },
  });
}

function deletePanelWithConfirmation(frame, panel, panelIndex) {
  const dialogue = String(frame.dialogue || "").trim();
  const speaking = frame.dialogueMode === "silent" || frame.dialogueMode === "hidden"
    ? false
    : (frame.dialogueMode === "spoken"
      ? frame.speakerPanel === panelIndex
      : (Boolean(dialogue) && frame.speakerPanel === panelIndex));
  if (speaking && globalThis.confirm?.(
    "Реплика останется без изменений. Говорящим станет оставшаяся панель. Удалить эту панель?",
  ) !== true) return;
  runAssembly({
    op: "deletePanel",
    panelId: panel.id,
    confirmSpeakerTransfer: speaking,
  }, "Удаляю панель…", {
    submittedText: speaking ? "Реплика остаётся у оставшейся панели" : null,
    frame,
    panel,
    panelIndex,
  });
}

function sourceItemIdOf(frame) {
  return frame?.displayBlock?.sourceItemId || frame?.sourceItemId || null;
}

function utteranceImpactMessage(count) {
  const noun = count % 10 === 1 && count % 100 !== 11 ? "реплике" : "репликах";
  return `Нельзя исключить: персонаж говорит в ${count} ${noun}.`;
}

function showCastStatus(message) {
  if (!materialCastStatus) return;
  materialCastStatus.hidden = !message;
  materialCastStatus.textContent = message || "";
}

function prepareUtteranceEditor() {
  if (utteranceEdit) utteranceEdit.hidden = true;
  if (utteranceEditor) {
    utteranceEditor.hidden = true;
    delete utteranceEditor.dataset.sourceId;
  }
  if (utteranceError) utteranceError.hidden = true;
}

function openUtteranceEditor(frame) {
  const sourceItemId = sourceItemIdOf(frame);
  if (!sourceItemId || !utteranceEditor) return;
  const item = (review?.sourceItems || []).find((entry) => entry.id === sourceItemId);
  const pieces = readyFrames
    .filter((entry) => sourceItemIdOf(entry) === sourceItemId)
    .slice()
    .sort((left, right) => (left.displayBlock?.start || 0) - (right.displayBlock?.start || 0));
  const speaker = (review?.cast?.speakers || []).find((entry) => entry.sourceItemId === sourceItemId);
  utteranceEditor.dataset.sourceId = sourceItemId;
  if (utteranceSpeaker) utteranceSpeaker.textContent = speaker?.characterName || item?.speakerLabel || "";
  if (utteranceSource) utteranceSource.textContent = item?.sourceQuote || pieces.map((entry) => entry.dialogue || "").join("");
  if (utteranceText) utteranceText.value = item?.text || pieces.map((entry) => entry.dialogue || "").join("");
  if (utteranceScope) {
    utteranceScope.hidden = pieces.length < 2;
    utteranceScope.textContent = pieces.length > 1 ? `Будет обновлено кадров: ${pieces.length}` : "";
  }
  if (utteranceError) utteranceError.hidden = true;
  utteranceEditor.hidden = false;
}

function frameMatchesAddress(frame, structureFrameId, structureSegmentIndex) {
  if ((frame?.structureFrameId || frame?.id) !== structureFrameId) return false;
  const frameSegment = Number.isInteger(frame?.structureSegmentIndex) ? frame.structureSegmentIndex : null;
  const wanted = Number.isInteger(structureSegmentIndex) ? structureSegmentIndex : null;
  return wanted == null ? frameSegment == null : frameSegment === wanted;
}

function structureFrameIndex(structureFrameId, structureSegmentIndex = null) {
  if (typeof structureFrameId !== "string" || !structureFrameId) return -1;
  let index = readyFrames.findIndex((frame) => frameMatchesAddress(frame, structureFrameId, structureSegmentIndex));
  if (index < 0) {
    index = readyFrames.findIndex((frame) => (frame.structureFrameId || frame.id) === structureFrameId);
  }
  return index;
}

function openStructureAddress(address) {
  const index = structureFrameIndex(address?.structureFrameId, address?.structureSegmentIndex);
  if (index >= 0) frameEditor.open(index);
}

function createdFrameResearchAddress(created, requestedSegment = null) {
  const structureFrameId = created?.structureFrameId;
  if (typeof structureFrameId !== "string" || !structureFrameId) return null;
  const preferredSegment = Number.isInteger(created?.structureSegmentIndex)
    ? created.structureSegmentIndex
    : (Number.isInteger(requestedSegment) ? requestedSegment : null);
  const index = structureFrameIndex(structureFrameId, preferredSegment);
  const frame = index >= 0 ? readyFrames[index] : null;
  return {
    createdStructureFrameId: structureFrameId,
    createdDisplayFrameId: typeof frame?.id === "string" ? frame.id : null,
    createdDisplayFrameNumber: index >= 0 ? index + 1 : null,
    createdStructureSegmentIndex: frame && Number.isInteger(frame.structureSegmentIndex)
      ? frame.structureSegmentIndex
      : preferredSegment,
  };
}

function saveEditorDialogue({ frame, mode, text, speakerPanelId, previousDialogueMode }) {
  return runAssembly({
    op: "setFrameDialogue",
    ...frameAddress(frame),
    dialogueMode: mode,
    ...(mode === "spoken" ? { text, ...(speakerPanelId ? { speakerPanelId } : {}) } : {}),
  }, "Сохраняю диалог кадра…", { frame, previousDialogueMode });
}

frameEditor = createFrameEditor({
  document,
  elements: {
    detail,
    detailHost,
    detailOutside,
    detailRetained,
    detailScroll,
    detailTitle,
    detailFrameNumber,
    detailPanelControls,
    panelEditor,
    frameDialogue,
    frameDialogueSpoken,
    frameDialogueText,
    frameDialogueSpeaker,
    frameDialogueError,
    closeDetail,
    openLast,
    nextFrame,
    prevFrame,
    frameEditorTabs,
    frameEditorFrame,
    frameEditorUndo,
    workspaceUndoSlot,
    globalUndo,
    frameEditorLeave,
    frameEditorLeaveStay,
    frameEditorLeaveDiscard,
    frameEditorLeaveSave,
  },
  renderer: FrameRenderer,
  getFrames: () => readyFrames,
  formatSeconds,
  mountFrame,
  frameAddress,
  runAssembly,
  deletePanel: deletePanelWithConfirmation,
  renderPanelControls,
  setSelection: setSelectionTo,
  markSelectedCards,
  renderInspector,
  prepareUtteranceEditor,
  saveDialogue: saveEditorDialogue,
  enterDetail: () => researchDock?.enterDetail(),
  leaveDetail: () => {
    hideRevisionConfirm();
    resumeDockAfterPanel();
    if (detailGenerationStatus) {
      detailGenerationStatus.hidden = true;
      detailGenerationStatus.textContent = "";
      delete detailGenerationStatus.dataset.kind;
    }
  },
  undo: performGlobalUndo,
  commitPlacement: commitEditorPlacement,
});

export function openResearchDetail(index) {
  frameEditor.open(index);
}

utteranceEdit?.addEventListener("click", () => {
  const frame = readyFrames[frameEditor.index];
  if (frame) openUtteranceEditor(frame);
});
utteranceCancel?.addEventListener("click", () => {
  if (utteranceEditor) utteranceEditor.hidden = true;
});
utteranceSave?.addEventListener("click", () => {
  const detailIndex = frameEditor.index;
  const frame = readyFrames[detailIndex];
  const sourceItemId = utteranceEditor?.dataset.sourceId;
  const spokenText = utteranceText?.value ?? "";
  if (!frame || !sourceItemId) return;
  runProductResearchAction({
    semanticAction: "source_utterance_edit",
    submittedText: spokenText,
    commandTarget: createEmptyCommandTarget("frame", {
      structureFrameId: frame.structureFrameId || frame.id || null,
      displayFrameId: frame.id || null,
      displayFrameNumber: detailIndex + 1,
      characterName: utteranceSpeaker?.textContent || null,
    }),
    async operation() {
      let response;
      try {
        response = await fetch(scoped("/api/source-utterances"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceItemId,
            spokenText,
            materialStateId: visual?.materialStateId || (review?.mode === "material" ? review.id : null),
            storyboardVersionId: visual?.storyboardVersionId || null,
          }),
        });
      } catch (error) {
        if (utteranceError) {
          utteranceError.hidden = false;
          utteranceError.textContent = "Не удалось сохранить реплику.";
        }
        throw error;
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        if (utteranceError) {
          utteranceError.hidden = false;
          utteranceError.textContent = payload?.message || "Не удалось сохранить реплику.";
        }
        const err = new Error(payload?.kind || "request-failed");
        err.kind = payload?.kind || "request-failed";
        throw err;
      }
      if (payload?.draft && typeof payload.draft.text === "string" && typeof payload.draft.revisionToken === "string") {
        draftAutosave.replaceAccepted(payload.draft.text, payload.draft.revisionToken);
      }
      if (utteranceEditor) utteranceEditor.hidden = true;
      try {
        const projectResponse = await fetch(scoped("/api/project"));
        if (projectResponse.ok) restoreReview(await projectResponse.json());
      } catch {
        // The saved revision remains active. The next reload shows it.
      }
      await refreshVisual();
      return payload;
    },
  });
});
detail.addEventListener("cancel", (event) => {
  if (revisionConfirm && !revisionConfirm.hidden) {
    event.preventDefault();
    hideRevisionConfirm();
    return;
  }
  frameEditor.handleCancel(event);
});

function presentDetailGeneration(text, kind = "success") {
  if (!detailGenerationStatus) return;
  detailGenerationStatus.hidden = false;
  detailGenerationStatus.dataset.kind = kind === "info" ? "running" : kind;
  detailGenerationStatus.textContent = text;
  const assertive = kind === "error";
  if (typeof detailGenerationStatus.setAttribute === "function") {
    detailGenerationStatus.setAttribute("aria-live", assertive ? "assertive" : "polite");
    detailGenerationStatus.setAttribute("role", assertive ? "alert" : "status");
  }
}

function showActionNotice(text, kind = "success") {
  if (!actionStatus) {
    notice.hidden = false;
    notice.textContent = text;
    notice.dataset.kind = kind;
    return;
  }
  globalThis.clearTimeout(statusTimer);
  actionStatus.hidden = false;
  actionStatus.dataset.kind = kind === "info" ? "running" : kind;
  actionStatus.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  actionStatus.replaceChildren();
  const message = document.createElement("p");
  message.textContent = text;
  actionStatus.append(message);
  if (kind === "error") {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Закрыть";
    dismiss.addEventListener("click", () => {
      actionStatus.hidden = true;
    });
    actionStatus.append(dismiss);
    return;
  }
  if (kind === "success" || kind === "no-change") {
    statusTimer = globalThis.setTimeout(() => {
      actionStatus.hidden = true;
    }, 4500);
  }
}

function scoped(path) {
  if (typeof path !== "string" || path === "/api/build" || path.startsWith("/api/build?")) return path;
  if (!path.startsWith("/api/")) return path;
  const resolved = projectApi(path);
  if (!resolved) throw new Error("project");
  return resolved;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(scoped(path), options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const kind = payload?.kind
      || (response.status === 413 ? "image-too-large" : null)
      || (response.status === 409 && payload?.status === "blocked" ? "structure-rejected" : "request-failed");
    const error = new Error(kind);
    error.kind = kind;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function actionMessage(kind) {
  const messages = {
    "identity-required": "Сначала выберите реальную фотографию персонажа.",
    "anchor-required": "Сначала утвердите базовый образ этого персонажа.",
    "style-required": "Сначала утвердите стиль проекта — без него нельзя создать панели этого кадра.",
    "subject-required": "Сначала выберите персонажа для панели.",
    "invalid-image": "Не удалось прочитать изображение. Выберите JPEG, PNG или WebP.",
    "unsupported-image-format": "Этот формат пока не поддерживается. Выберите JPEG, PNG или WebP.",
    "image-too-large": "Файл слишком большой. Выберите фото меньшего размера.",
    "structure-rejected": "Не удалось применить эту правку, не меняя реплики. Опишите изменение кадра иначе.",
    "invalid-request": "Не удалось прочитать запрос. Проверьте файл или формулировку правки и попробуйте ещё раз.",
    "empty-dialogue": "Введите текст реплики.",
    "speaker-required": "Выберите панель, которая говорит.",
    "speaker-not-found": "Прежняя панель больше не в кадре. Выберите, кто говорит.",
    "not-dialogue-frame": "У текстовой карточки нет реплики.",
    "invalid-mode": "Выберите состояние диалога.",
    "invalid-text": "Текст реплики слишком длинный.",
    "visual-incomplete": "Сначала создайте изображения для всех панелей.",
    timeout: "Генерация заняла слишком много времени. Попробуйте ещё раз.",
    "reference-payload-too-large": "Подготовка запроса остановлена: изображения-ориентиры не помещаются в безопасный размер. Генерация не отправлялась.",
    "provider-payload-too-large": "Провайдер отклонил запрос как слишком большой (413).",
    provider: "Провайдер не завершил генерацию. Уже готовые результаты сохранены.",
    "invalid-output": "Провайдер не вернул пригодное изображение.",
    database: "Не удалось сохранить результат. Попробуйте ещё раз.",
    "empty-refine": "Уточнение требует непустую правку.",
    "no-supported-change": "В правке нет поддерживаемого изменения изображения. Генерация не запускалась.",
    "deterministic-only": "Это действие выполняется без генерации изображения.",
    "image-required": "Сначала создайте изображение панели.",
    "stale-version": "Раскадровка уже изменилась. Обновите страницу и повторите действие.",
    "asset-load-failed": "Изображение не удалось показать. Обновите страницу или создайте панель заново.",
    "nothing-to-undo": "Нечего отменять.",
    "unknown-subject": "Этого персонажа нет в утверждённом составе.",
    "invalid-operation": "Эта операция сборки не поддерживается.",
    "invalid-position": "Нельзя вставить кадр в эту позицию.",
    "invalid-kind": "Можно добавить кадр с изображением или текстовую карточку.",
    "last-frame": "Нельзя удалить последний кадр.",
    "frame-not-found": "Этот структурный кадр уже изменился. Обновите страницу.",
    "segment-required": "Сначала выберите конкретную часть структурного кадра.",
    "segment-not-found": "Эта часть структурного кадра не найдена.",
    "layout-full": "В кадре уже две панели. Третью добавить нельзя.",
    "not-panel-frame": "У текстовой карточки нет панелей.",
    "last-panel": "В кадре должна остаться хотя бы одна панель.",
    "panel-not-found": "Панель не найдена. Обновите страницу.",
    "speaker-remains": "Нельзя удалить панель, которой принадлежит реплика. Удалите кадр или другую панель.",
    "invalid-order": "Порядок кадров или панелей не совпадает с текущей раскадровкой.",
    "invalid-duration": "Длительность должна быть целым положительным числом кадров.",
    "duration-truncates-dialogue": "Эта длительность оборвёт реплику до конца появления текста.",
    "not-text-card": "Текст можно менять только у текстовой карточки.",
    "invalid-text": "Текст слишком длинный или не распознан.",
    "asset-not-reusable": "Это изображение нельзя назначить из текущей раскадровки.",
    "render-busy": "Сборка видео уже идёт.",
    "no-storyboard": "Сначала откройте готовую раскадровку.",
    "render-failed": "Не удалось собрать видео.",
    "unknown-intro": "Этот шаблон интро недоступен.",
    "invalid-intro-version": "Версия шаблона интро не поддерживается.",
    "intro-cast-count": "Этот шаблон интро недоступен для текущего состава.",
    "intro-no-cast": "Не удалось определить персонажей текущей раскадровки для интро.",
    "intro-missing-title": "У проекта нет названия для интро.",
    "intro-missing-anchor": "Для интро нужен утверждённый базовый образ каждого участвующего персонажа.",
    "intro-asset": "Изображение для интро не принадлежит этому проекту.",
  };
  return messages[kind] || "Не удалось выполнить действие. Попробуйте ещё раз.";
}

function failureNotice(failures) {
  if (!failures?.length) return null;
  if (failures.length === 1) {
    const entry = failures[0];
    return `Не удалось создать панель ${entry.panelIndex + 1}. ${actionMessage(entry.kind)}`;
  }
  return `Кадр создан частично. Не удалось создать панели: ${failures.map((entry) => entry.panelIndex + 1).join(", ")}.`;
}

export function frameAttemptNotice({ generationFailures = [], visualReady = false } = {}) {
  const notice = failureNotice(generationFailures);
  if (notice) return { text: notice, kind: "error" };
  return {
    text: visualReady
      ? "Кадр готов. Проверьте изображения."
      : "Генерация завершилась, но кадр ещё не полностью готов.",
    kind: "info",
  };
}

export function describePanelAttempt(panel = {}) {
  const retainedAssetId = panel.assetId || null;
  if (panel.generationStatus !== "failed") {
    return {
      failureText: null,
      retained: Boolean(retainedAssetId),
      retainedAssetId,
    };
  }
  const base = actionMessage(panel.generationError || "provider");
  const failureText = retainedAssetId
    ? `${base} Показан предыдущий готовый вариант.`
    : base;
  return {
    failureText,
    retained: Boolean(retainedAssetId),
    retainedAssetId,
  };
}

async function runBusy(message, operation) {
  if (busy) return null;
  busy = true;
  document.body.dataset.busy = "true";
  showActionNotice(message, "running");
  try {
    return await operation();
  } catch (error) {
    showActionNotice(actionMessage(error.kind), "error");
    return null;
  } finally {
    busy = false;
    delete document.body.dataset.busy;
  }
}

const IDENTITY_MAX_BYTES = 12 * 1024 * 1024;
const IDENTITY_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function identityFileKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/.test(name)) {
    return "unsupported-image-format";
  }
  if (Number(file?.size) > IDENTITY_MAX_BYTES) return "image-too-large";
  if (type && !IDENTITY_TYPES.has(type) && !/\.(jpe?g|png|webp)$/.test(name)) {
    return "unsupported-image-format";
  }
  return null;
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      const error = new Error("invalid-image");
      error.kind = "invalid-image";
      reject(error);
    };
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function withVisualReady(frames) {
  return (frames || []).map((frame) => {
    const panels = Array.isArray(frame?.panels) ? frame.panels : [];
    const visualReady = frame?.frameKind === "text"
      ? Boolean(String(frame.textCard || "").trim())
      : panels.length > 0 && panels.every((panel) => Boolean(panel?.assetId));
    return { ...frame, visualReady };
  });
}

function fitFrames(frames) {
  try {
    const fitted = compileOverflow(frames, (text, options) => FrameRenderer.measureDialogue(document, {
      layout: options.layout,
      speakerPanel: options.speakerPanel,
      panels: options.panels,
      dialogue: text,
    }, options.fontSize));
    if (!fitted.ok) return withVisualReady(frames);
    return withVisualReady(fitted.frames);
  } catch (error) {
    console.warn("[visual] fitFrames failed", { kind: "measurement" });
    return withVisualReady(frames);
  }
}

function renderCharacterCards() {
  renderAnchorWorkspace({
    root: characterCards,
    characters: visual?.characters || [],
    fetchJson,
    applyVisual,
    runProductResearchAction,
    showActionNotice,
    characterActionContextOverrides,
  });
}

export function applyVisual(next) {
  if (!next || next.status !== "ready") return;
  visual = next;
  const fitted = fitFrames(next.frames || []);
  showReady(fitted, "ready");
  charactersWorkspace.hidden = false;
  visualHeading.hidden = !next.allAnchorsApproved;
  renderCharacterCards();
  const completed = (next.frames || []).filter((frame) => frame.visualReady).length;
  visualProgress.textContent = next.allAnchorsApproved
    ? `${completed} из ${(next.frames || []).length} кадров готовы`
    : "Сначала утвердите базовый образ каждого персонажа";
  visualApproval.hidden = !next.complete;
  approveVisual.hidden = next.readyForVideo;
  approvalCopy.textContent = next.approved
    ? "Текущая версия утверждена."
    : "Просмотрите все кадры и утвердите текущую версию.";
  readyForVideo.hidden = !next.readyForVideo;
  frameEditor.syncUndo(next);
  syncExportRuntime();
  refreshIntroTemplates();
  refreshStages();
  frameEditor.reconcile();
}

async function refreshVisual() {
  try {
    const next = await fetchJson("/api/visual");
    if (next.status === "ready") applyVisual(next);
  } catch {
    // Earlier checkpoints and isolated UI tests do not expose the visual API.
  }
}

async function generateFrame(frameId, button, index) {
  const source = (visual?.frames || []).find((frame) => frame.id === frameId)
    || readyFrames.find((frame) => frame.id === frameId);
  const panelCount = source?.panels?.length || 1;
  const progress = panelCount > 1
    ? `Создаю изображения этого кадра: ${panelCount} панели…`
    : "Создаю изображение этого кадра…";
  const displayIndex = readyFrames.findIndex((frame) => frame.id === frameId);
  const displayFrameNumber = displayIndex >= 0
    ? displayIndex + 1
    : (Number.isInteger(index) ? index + 1 : null);
  const frameForContext = source || { id: frameId };
  const initiationPanels = Array.isArray(source?.panels)
    ? source.panels.map((panel) => ({
      assetId: typeof panel?.assetId === "string" ? panel.assetId : null,
    }))
    : [];
  const frameTarget = createEmptyCommandTarget("frame", {
    displayFrameNumber,
    displayFrameId: typeof frameId === "string" ? frameId : null,
    structureFrameId: typeof source?.structureFrameId === "string" ? source.structureFrameId : null,
    structureSegmentIndex: Number.isInteger(source?.structureSegmentIndex) ? source.structureSegmentIndex : null,
  });
  await runProductResearchAction({
    semanticAction: "frame_generate",
    submittedText: null,
    commandTarget: frameTarget,
    contextOverrides: frameActionContextOverrides(frameForContext, displayFrameNumber),
    busyMessage: progress,
    classifyResult(next) {
      const failures = Array.isArray(next?.generationFailures) ? next.generationFailures : [];
      if (!failures.length) return { outcome: "success" };
      const kinds = failures
        .map((entry) => (typeof entry?.kind === "string" ? entry.kind : null))
        .filter(Boolean);
      const outcomeKind = kinds.length === 1 ? kinds[0] : (kinds[0] || "generation-failed");
      const retainedLastGoodImage = failures.some((entry) => {
        const panelIndex = entry?.panelIndex;
        return Number.isInteger(panelIndex)
          && typeof initiationPanels[panelIndex]?.assetId === "string";
      });
      return {
        outcome: "failure",
        outcomeKind,
        outcomeFlags: retainedLastGoodImage ? { retainedLastGoodImage: true } : {},
      };
    },
    async operation({ correlationId } = {}) {
      const previous = button?.textContent;
      if (button) button.textContent = panelCount > 1 ? `Создаю ${panelCount} панели…` : "Создаю…";
      try {
        const next = await fetchJson(`/api/visual/frames/${encodeURIComponent(frameId)}/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ correlationId }),
        });
        applyVisual(next);
        const fittedIndex = readyFrames.findIndex((frame) => frame.id === frameId);
        const openIndex = fittedIndex >= 0 ? fittedIndex : index;
        if (Number.isInteger(openIndex) && readyFrames[openIndex]) {
          frameEditor.open(openIndex);
        }
        const attempt = frameAttemptNotice({
          generationFailures: next.generationFailures || [],
          visualReady: Boolean(next.frames?.find((frame) => frame.id === frameId)?.visualReady),
        });
        showActionNotice(attempt.text, attempt.kind);
        return next;
      } catch (error) {
        console.error("[visual] frame generation failed", { kind: error?.kind || "request-failed", frameId });
        throw error;
      } finally {
        if (button && previous != null) button.textContent = previous;
      }
    },
  });
}

async function commitEditorPlacement(frame, panel, panelIndex, patch, messages, rollback) {
  const saved = panel.authoritativePlacement
    ? { ...panel.authoritativePlacement }
    : frameEditor.placementOf(panel);
  const intended = patch.reset === true
    ? { ...FrameRenderer.PLACEMENT_DEFAULTS }
    : {
      zoom: patch.zoom ?? saved.zoom,
      positionX: patch.positionX ?? saved.positionX,
      positionY: patch.positionY ?? saved.positionY,
      mirrored: patch.mirrored ?? saved.mirrored,
    };
  const displayFrameNumber = frameEditor.index >= 0 ? frameEditor.index + 1 : null;
  await runProductResearchAction({
    semanticAction: "placement_commit",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("panel", {
      displayFrameNumber,
      displayFrameId: typeof frame.id === "string" ? frame.id : null,
      structureFrameId: typeof frame.structureFrameId === "string" ? frame.structureFrameId : null,
      structureSegmentIndex: Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : null,
      panelIndex,
      panelId: panel.id,
      zoom: intended.zoom,
      positionX: intended.positionX,
      positionY: intended.positionY,
      mirrored: intended.mirrored,
    }),
    contextOverrides: panelActionContextOverrides(frame, panel, panelIndex, displayFrameNumber),
    busyMessage: messages.busy,
    classifyResult: (result) => (result?.changed === false ? { outcome: "no-change" } : null),
    async operation() {
      const body = patch.reset === true
        ? { reset: true }
        : {
          zoom: intended.zoom,
          positionX: intended.positionX,
          positionY: intended.positionY,
          mirrored: intended.mirrored,
        };
      try {
        const next = await fetchJson(
          `/api/visual/frames/${encodeURIComponent(frame.id)}/panels/${panelIndex}/placement`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (next?.changed === false) {
          showActionNotice("Без изменений.", "no-change");
          return next;
        }
        applyVisual(next);
        showActionNotice(messages.success, "success");
        return next;
      } catch (error) {
        rollback?.();
        throw error;
      }
    },
  });
}

function panelAddress(panelIndex) {
  return `${frameEditor.index >= 0 ? frameEditor.index + 1 : "?"}.${panelIndex + 1}`;
}

function panelOpenSection(name, title) {
  const node = document.createElement("section");
  node.className = `panel-subsection panel-subsection-${name}`;
  node.dataset.panelSection = name;
  const heading = document.createElement("h3");
  heading.className = "panel-subsection-title";
  heading.textContent = title;
  node.append(heading);
  return node;
}

function panelSubsection(name, title) {
  const node = document.createElement("details");
  node.className = `panel-subsection panel-subsection-${name}`;
  node.dataset.panelSection = name;
  const summary = document.createElement("summary");
  summary.className = "panel-subsection-title";
  summary.textContent = title;
  node.append(summary);
  return node;
}

function identityReference(panel) {
  const character = (visual?.characters || []).find((entry) => entry?.name && entry.name === panel.subject);
  const box = document.createElement("div");
  box.className = "panel-reference panel-reference-identity";
  if (character?.approvedAssetUrl) {
    const image = document.createElement("img");
    image.src = character.approvedAssetUrl;
    image.alt = `Базовый образ: ${character.name}`;
    box.append(image);
  }
  const copy = document.createElement("div");
  copy.append(
    textElement("p", "panel-reference-title", "Базовый образ персонажа · личность"),
    textElement("p", "helper", character?.approvedAssetUrl
      ? `Утверждённый базовый образ: ${character.name}. Только просмотр — меняется в «Персонажах».`
      : (panel.subject ? `Базовый образ для ${panel.subject} ещё не утверждён.` : "У панели нет персонажа.")),
  );
  box.append(copy);
  return box;
}

function renderPanelTabs(frame) {
  if (!panelEditorTabs) return;
  panelEditorTabs.replaceChildren();
  (frame.panels || []).forEach((panel, panelIndex) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "panel-editor-tab";
    tab.dataset.panelIndex = String(panelIndex);
    tab.textContent = `Панель ${panelAddress(panelIndex)}${panel.subject ? ` · ${panel.subject}` : ""}`;
    tab.setAttribute?.("aria-pressed", panelIndex === frameEditor.panelIndex ? "true" : "false");
    tab.addEventListener("click", () => frameEditor.selectPanel(panelIndex));
    panelEditorTabs.append(tab);
  });
}

function panelRevisionAddress(frame, panel, panelIndex) {
  const displayFrameNumber = frameEditor.index >= 0 ? frameEditor.index + 1 : null;
  return {
    displayFrameNumber,
    target: createEmptyCommandTarget("panel", {
      displayFrameNumber,
      displayFrameId: typeof frame.id === "string" ? frame.id : null,
      structureFrameId: typeof frame.structureFrameId === "string" ? frame.structureFrameId : null,
      structureSegmentIndex: Number.isInteger(frame.structureSegmentIndex) ? frame.structureSegmentIndex : null,
      panelIndex,
      panelId: panel.id,
    }),
  };
}

async function postPanelRevision(frame, panelIndex, suffix, body) {
  return fetchJson(`/api/visual/frames/${encodeURIComponent(frame.id)}/panels/${panelIndex}/revision${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function revisionButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.revisionAction = action;
  return button;
}

function bindInitialPanelCreate({ frame, panel, panelIndex, instruction, performance, imagePart }) {
  const regenerate = revisionButton("Создать эту панель", "create");
  regenerate.addEventListener("click", async () => {
    const panelInstruction = instruction.value;
    const displayFrameNumber = frameEditor.index >= 0 ? frameEditor.index + 1 : null;
    const busyText = `Создаю панель ${panelIndex + 1} кадра ${frameEditor.index + 1}…`;
    const successText = `Панель ${panelIndex + 1} кадра ${frameEditor.index + 1} готова.`;
    const addressed = panelRevisionAddress(frame, panel, panelIndex);
    const priorAssetId = typeof panel.assetId === "string" ? panel.assetId : null;
    regenerate.disabled = true;
    presentDetailGeneration(busyText, "running");
    try {
      await runProductResearchAction({
        semanticAction: "panel_generate",
        submittedText: panelInstruction,
        commandTarget: addressed.target,
        contextOverrides: panelActionContextOverrides(frame, panel, panelIndex, displayFrameNumber),
        busyMessage: busyText,
        async operation({ correlationId } = {}) {
          const file = performance.files?.[0];
          const performanceImageDataUrl = file ? await fileAsDataUrl(file) : undefined;
          try {
            const next = await fetchJson(
              `/api/visual/frames/${encodeURIComponent(frame.id)}/panels/${panelIndex}/generate`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ instruction: panelInstruction, performanceImageDataUrl, correlationId }),
              },
            );
            applyVisual(next);
            showActionNotice(successText);
            presentDetailGeneration(successText, "success");
            return next;
          } catch (error) {
            console.error("[visual] panel generation failed", {
              kind: error?.kind || "request-failed",
              frameId: frame.id,
              panelIndex,
            });
            presentDetailGeneration(actionMessage(error?.kind || "provider"), "error");
            if (priorAssetId) error.outcomeFlags = { retainedLastGoodImage: true };
            throw error;
          }
        },
      });
    } finally {
      regenerate.disabled = false;
    }
  });
  imagePart.append(instruction, regenerate);
}

function hideRevisionConfirm() {
  revisionCancelHandler = null;
  if (!revisionConfirm) return;
  revisionConfirm.hidden = true;
  if (detailScroll) detailScroll.inert = false;
}

function showRevisionConfirm(onConfirm) {
  revisionCancelHandler = onConfirm;
  if (!revisionConfirm) return;
  revisionConfirm.hidden = false;
  if (detailScroll) detailScroll.inert = true;
  revisionConfirmDo?.focus?.();
}

revisionConfirmKeep?.addEventListener("click", () => {
  hideRevisionConfirm();
});
revisionConfirmDo?.addEventListener("click", () => {
  const confirm = revisionCancelHandler;
  hideRevisionConfirm();
  confirm?.();
});

function suspendDockForPanel() {
  if (dockSuspended || !researchDockRoot) return;
  dockSuspended = true;
  dockRestoreCollapsed = researchDock?.isCollapsed?.() === true;
  researchDock?.setCollapsed?.(true);
  researchDockRoot.classList.add("research-dock--suspended");
}

function resumeDockAfterPanel() {
  if (!dockSuspended || !researchDockRoot) return;
  researchDockRoot.classList.remove("research-dock--suspended");
  if (dockRestoreCollapsed === false) researchDock?.setCollapsed?.(false);
  dockSuspended = false;
  dockRestoreCollapsed = null;
}

function bindPanelRevision({ frame, panel, panelIndex, instruction, performance, imagePart, epoch }) {
  const revision = panel.revision || null;
  instruction.value = revision?.draftInstruction || "";
  let activeMode = revision?.draftMode || "refine";
  let currentSummary = null;
  let revisionLocked = false;
  const summaryHost = document.createElement("div");
  summaryHost.className = "revision-summary-host";
  const compiledDraft = (mode, instructionText = instruction.value) => compileDraft(mode, instructionText);
  const localSummary = (mode) => {
    const compiled = compiledDraft(mode);
    return {
      basis: mode === "new-variation"
        ? { kind: "none", ordinal: null }
        : { kind: "current-panel", ordinal: null },
      changes: [],
      preserved: [],
      notApplied: [],
      reconstruction: revision?.summary?.reconstruction || compiled?.reconstruction || null,
      blockReason: compiled?.blockReason ?? (mode === "refine" && !instruction.value.trim() ? "empty-refine" : null),
      providerCall: compiled ? compiled.providerCall === true : false,
    };
  };
  const candidates = revision?.candidates || [];
  const selected = candidates.find((candidate) => candidate.id === revision?.selectedCandidateId) || null;
  const compare = document.createElement("div");
  compare.className = "revision-compare";
  const currentFigure = document.createElement("figure");
  currentFigure.className = "revision-current";
  currentFigure.dataset.panelIndex = String(panelIndex);
  const currentImage = document.createElement("img");
  currentImage.className = "revision-current-image";
  currentImage.alt = "Текущее изображение";
  if (panel.asset) currentImage.src = panel.asset;
  currentFigure.append(textElement("figcaption", "", "Текущее изображение"), currentImage);
  frameEditor.applyRendition(currentImage, frameEditor.placementOf(panel));
  compare.append(currentFigure);
  const history = document.createElement("div");
  history.className = "revision-history";
  if (selected) {
    const candidateFigure = document.createElement("figure");
    candidateFigure.className = "revision-candidate";
    const preview = document.createElement("img");
    preview.className = "revision-candidate-preview";
    preview.alt = `Кандидат ${selected.ordinal}`;
    preview.src = selected.assetUrl;
    const undo = revisionButton("←", "undo");
    const redo = revisionButton("→", "redo");
    undo.setAttribute("aria-label", REVISION_COPY.undo);
    redo.setAttribute("aria-label", REVISION_COPY.redo);
    undo.disabled = selected.ordinal <= 1;
    redo.disabled = selected.ordinal >= candidates.length;
    history.append(textElement("p", "revision-count", `Кандидат ${selected.ordinal} из ${candidates.length}`), undo, redo);
    candidateFigure.append(
      textElement("figcaption", "", `Кандидат ${selected.ordinal}`),
      preview,
      history,
      textElement("p", "revision-candidate-note", "Текущее изображение изменится только после «Принять кандидат»."),
    );
    compare.append(candidateFigure);
    undo.addEventListener("click", () => navigateRevision("undo"));
    redo.addEventListener("click", () => navigateRevision("redo"));
  }
  const modeField = document.createElement("fieldset");
  modeField.className = "revision-mode";
  modeField.append(textElement("legend", "", "Как создать следующий кандидат"));
  for (const [value, label] of [["refine", REVISION_COPY.refine], ["new-variation", REVISION_COPY.variation]]) {
    const choice = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `revision-mode-${panelIndex}`;
    input.value = value;
    input.checked = activeMode === value;
    choice.append(input, textElement("span", "", label));
    input.addEventListener("change", () => {
      if (!input.checked) return;
      activeMode = value;
      globalThis.clearTimeout(instruction.revisionTimer);
      if (!instruction.value.trim() || compiledDraft(value)) {
        paintSummary(instruction.value.trim() ? compiledDraft(value) : localSummary(value));
        if (compiledDraft(value)) return;
      }
      schedulePreflight(0);
    });
    modeField.append(choice);
  }
  const instructionLabel = document.createElement("label");
  instructionLabel.className = "revision-instruction";
  instructionLabel.append(textElement("span", "revision-instruction-label", "Что изменить"), instruction);
  const generate = revisionButton(REVISION_COPY.generate, "generate");
  generate.className = "revision-generate";
  const compose = document.createElement("div");
  compose.className = "revision-compose";
  compose.append(modeField, instructionLabel, summaryHost, generate);
  const review = document.createElement("div");
  review.className = "revision-review";
  let accept = null;
  if (selected) {
    accept = revisionButton(REVISION_COPY.accept, "accept");
    accept.className = "primary";
    review.append(accept);
  }
  let cancel = null;
  if (revision) {
    cancel = revisionButton(REVISION_COPY.cancel, "cancel");
    cancel.className = "secondary";
    review.append(cancel);
  }
  const syncGenerate = () => {
    generate.disabled = revisionLocked || currentSummary?.providerCall !== true;
  };
  const paintSummary = (summary) => {
    currentSummary = summary || null;
    summaryHost.replaceChildren();
    if (summary) summaryHost.append(renderRevisionSummary(document, summary));
    syncGenerate();
  };
  const applyServerPreflight = (mode, instructionText, summary) => {
    if (!String(instructionText).trim()) {
      const local = localSummary(mode);
      local.providerCall = summary.providerCall === true;
      local.blockReason = summary.blockReason ?? local.blockReason;
      if (summary.basis) local.basis = summary.basis;
      paintSummary(local);
      return;
    }
    paintSummary(summary);
  };
  const refreshPreflight = async (mode) => {
    const instructionText = instruction.value;
    const compiled = compiledDraft(mode, instructionText);
    if (compiled) {
      if (epoch !== revisionPreflightEpoch) return;
      paintSummary(String(instructionText).trim() ? compiled : localSummary(mode));
      return;
    }
    try {
      const preview = await postPanelRevision(frame, panelIndex, "-preview", { mode, instruction: instructionText });
      if (epoch !== revisionPreflightEpoch || instruction.value !== instructionText || activeMode !== mode) return;
      if (preview?.summary && typeof preview.summary.providerCall === "boolean") {
        applyServerPreflight(mode, instructionText, preview.summary);
        return;
      }
    } catch {
      // A missing compiler result keeps the create action blocked.
    }
    if (epoch !== revisionPreflightEpoch || instruction.value !== instructionText || activeMode !== mode) return;
    paintSummary(localSummary(mode));
  };
  const schedulePreflight = (delay) => {
    globalThis.clearTimeout(instruction.revisionTimer);
    instruction.revisionTimer = globalThis.setTimeout(() => {
      if (epoch !== revisionPreflightEpoch) return;
      refreshPreflight(activeMode);
    }, delay);
  };
  const setLocked = (locked) => {
    revisionLocked = locked;
    for (const button of imagePart.querySelectorAll("[data-revision-action]")) {
      if (button === generate) continue;
      button.disabled = locked;
    }
    for (const input of modeField.querySelectorAll("input")) input.disabled = locked;
    if (!locked) {
      const undo = history.querySelector('[data-revision-action="undo"]');
      const redo = history.querySelector('[data-revision-action="redo"]');
      if (undo) undo.disabled = !selected || selected.ordinal <= 1;
      if (redo) redo.disabled = !selected || selected.ordinal >= candidates.length;
      if (accept) accept.disabled = false;
      if (cancel) cancel.disabled = false;
    }
    syncGenerate();
  };
  const runRevision = async (suffix, body, { semanticAction, busy, success }) => {
    const addressed = panelRevisionAddress(frame, panel, panelIndex);
    setLocked(true);
    presentDetailGeneration(busy, "running");
    try {
      await runProductResearchAction({
        semanticAction,
        submittedText: instruction.value,
        commandTarget: addressed.target,
        contextOverrides: panelActionContextOverrides(frame, panel, panelIndex, addressed.displayFrameNumber),
        busyMessage: busy,
        async operation({ correlationId } = {}) {
          const file = performance.files?.[0];
          const performanceImageDataUrl = file ? await fileAsDataUrl(file) : undefined;
          try {
            const next = await postPanelRevision(frame, panelIndex, suffix, {
              ...body,
              instruction: instruction.value,
              correlationId,
              ...(performanceImageDataUrl ? { performanceImageDataUrl } : {}),
            });
            applyVisual(next);
            showActionNotice(success);
            presentDetailGeneration(success, "success");
            return next;
          } catch (error) {
            if (error?.payload?.summary) paintSummary(error.payload.summary);
            presentDetailGeneration(actionMessage(error?.kind || "provider"), "error");
            error.outcomeFlags = { retainedLastGoodImage: true };
            throw error;
          }
        },
      });
    } catch (error) {
      if (error?.payload?.summary) paintSummary(error.payload.summary);
      presentDetailGeneration(actionMessage(error?.kind || "provider"), "error");
      error.outcomeFlags = { retainedLastGoodImage: true };
      throw error;
    } finally {
      setLocked(false);
    }
  };
  async function navigateRevision(direction) {
    setLocked(true);
    try {
      const next = await postPanelRevision(frame, panelIndex, "-navigate", { direction });
      applyVisual(next);
    } catch (error) {
      presentDetailGeneration(actionMessage(error?.kind || "request-failed"), "error");
    } finally {
      setLocked(false);
    }
  }
  generate.addEventListener("click", () => runRevision("-candidate", { mode: activeMode }, {
    semanticAction: "panel_generate",
    busy: "Создаю кандидат…",
    success: "Кандидат готов. Текущее изображение панели не изменилось.",
  }));
  accept?.addEventListener("click", () => runRevision("-accept", { candidateId: selected?.id || null }, {
    semanticAction: "panel_revision_open",
    busy: "Принимаю кандидат…",
    success: "Кандидат стал текущим изображением панели.",
  }));
  cancel?.addEventListener("click", () => {
    showRevisionConfirm(() => runRevision("-cancel", {}, {
      semanticAction: "panel_revision_open",
      busy: "Отменяю черновик…",
      success: "Черновик отменён. Текущее изображение не изменилось.",
    }));
  });
  instruction.addEventListener("input", () => {
    currentSummary = { ...(currentSummary || {}), providerCall: false };
    syncGenerate();
    schedulePreflight(200);
  });
  if (revision?.summary) paintSummary(revision.summary);
  else paintSummary(localSummary(activeMode));
  imagePart.append(compare, compose);
  if (review.childNodes?.length || review.children?.length) imagePart.append(review);
}

function panelReadyImageControls(frame, panel, panelIndex) {
  const assign = document.createElement("div");
  assign.className = "panel-asset-assign";
  const choose = document.createElement("button");
  choose.type = "button";
  choose.dataset.panelIndex = String(panelIndex);
  choose.textContent = "Выбрать изображение…";
  choose.addEventListener("click", () => {
    openPanelAssetPicker(frame, panel, panelIndex, choose, false);
  });
  assign.append(choose);
  if (!panel.subjectEditable) return assign;
  const field = document.createElement("label");
  field.className = "panel-subject-field";
  const caption = document.createElement("span");
  caption.textContent = "Персонаж панели";
  const subject = document.createElement("select");
  subject.className = "inspector-select";
  subject.setAttribute("aria-label", "Персонаж панели");
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Выберите персонажа";
  subject.append(blank);
  const names = [];
  for (const character of visual?.characters || []) {
    if (character?.name && !names.includes(character.name)) names.push(character.name);
  }
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (panel.manualSubject === name || panel.subject === name) option.selected = true;
    subject.append(option);
  }
  subject.addEventListener("change", () => {
    if (!subject.value) return;
    runAssembly({
      op: "setManualSubject",
      panelId: panel.id,
      characterName: subject.value,
    }, "Сохраняю персонажа панели…", { submittedText: subject.value, frame, panel, panelIndex });
  });
  field.append(caption, subject);
  assign.append(field);
  return assign;
}

function renderPanelControls(frame) {
  const epoch = ++revisionPreflightEpoch;
  detailPanelControls.replaceChildren();
  frame.panels.forEach((panel, panelIndex) => {
    const section = document.createElement("section");
    section.className = "panel-control";
    section.dataset.panelIndex = String(panelIndex);
    section.hidden = panelIndex !== frameEditor.panelIndex;
    const description = document.createElement("p");
    description.className = "panel-description-copy";
    description.textContent = panel.description;
    const lineage = panel.assetProvenance;
    let lineageCopy = null;
    if (lineage?.description || lineage?.submittedText) {
      lineageCopy = document.createElement("p");
      lineageCopy.className = "asset-lineage";
      const parts = [];
      if (lineage.description) parts.push(lineage.description);
      if (lineage.submittedText) parts.push(`Правка: ${lineage.submittedText}`);
      lineageCopy.textContent = parts.join(" · ");
    }
    const attempt = describePanelAttempt(panel);
    let failure = null;
    if (attempt.failureText) {
      failure = document.createElement("p");
      failure.className = "panel-failure";
      failure.textContent = attempt.failureText;
      if (attempt.retainedAssetId) failure.dataset.assetId = attempt.retainedAssetId;
    }
    const instruction = document.createElement("textarea");
    instruction.placeholder = "Опишите, что изменить в этой панели";
    const performance = { files: [] };
    const imagePart = document.createElement("div");
    imagePart.className = "panel-subsection panel-subsection-image";
    imagePart.dataset.panelSection = "image";
    const basis = panelBasis(frame, panelIndex);
    if (basis) {
      const basisLine = document.createElement("p");
      basisLine.className = "panel-basis-line";
      basisLine.append(textElement("span", "panel-basis-label", "Сейчас: "), basisChip(frame, panelIndex));
      const foreground = foregroundChip(frame.panels[panelIndex]);
      if (foreground) basisLine.append(foreground);
      imagePart.append(basisLine);
      if (basis.hint) imagePart.append(textElement("p", "helper", basis.hint));
    }
    if (lineageCopy) imagePart.append(lineageCopy);
    if (failure) imagePart.append(failure);
    imagePart.append(panelReadyImageControls(frame, panel, panelIndex));
    if (panel.assetId) bindPanelRevision({ frame, panel, panelIndex, instruction, performance, imagePart, epoch });
    else bindInitialPanelCreate({ frame, panel, panelIndex, instruction, performance, imagePart });
    const framingPart = panelOpenSection("framing", "Кадрирование");
    const referencesPart = panelSubsection("references", "Референсы");
    referencesPart.append(description, identityReference(panel));
    section.append(imagePart, framingPart, referencesPart);
    frameEditor.renderPlacementControls({ frame, panel, panelIndex, framingPart, textElement });
    detailPanelControls.append(section);
  });
  frameEditor.finishPanelRender(frame);
}

approveVisual?.addEventListener("click", async () => {
  await runProductResearchAction({
    semanticAction: "visual_approve",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("storyboard"),
    busyMessage: "Утверждаю текущую визуальную раскадровку…",
    async operation() {
      const next = await fetchJson("/api/visual/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      applyVisual(next);
      showActionNotice("Визуальная раскадровка утверждена.");
      return next;
    },
  });
});

function textsMatch(readingText) {
  return draftSync.state === "idle"
    && typeof draftSync.savedText === "string"
    && draftField.value === draftSync.savedText
    && draftField.value === readingText;
}

const STORY_WAIT_COPY = "Это может занять некоторое время.";
const STORY_READING_SUCCESS = "Черновик разобран. Проверьте разбор и подтвердите.";
const STORY_STAGING_SUCCESS = "Раскадровка собрана.";
const STORY_READING_FAILURE = "Черновик не разобран. Текст на экране сохранён, можно попробовать ещё раз.";
const STORY_STAGING_FAILURE = "Раскадровку собрать не удалось. Подтверждённый разбор на месте, можно попробовать ещё раз.";
const STORY_STAGING_BLOCKED = "Раскадровку сейчас собрать нельзя. Подтверждённый разбор на месте, можно попробовать ещё раз.";
const STORY_OPERATIONS = {
  reading: {
    buttonId: "read-draft",
    pendingLabel: "Разбираю черновик…",
    idleLabel: "Разобрать черновик",
  },
  staging: {
    buttonId: "stage-material",
    pendingLabel: "Собираю раскадровку…",
    idleLabel: "Собрать раскадровку",
  },
};
const STORY_CONTROL_IDS = ["draft", "reload-draft", "keep-draft", "read-draft", "confirm-material", "stage-material"];
let storyLock = null;

function storyLocked() {
  return storyLock != null;
}

function storyboardReady() {
  const state = document.body?.dataset?.state;
  return readyFrames.length > 0 && state !== "failed" && state !== "blocked";
}

function storyControlNodes() {
  const nodes = [];
  for (const id of [...STORY_CONTROL_IDS, "add-character", "add-character-name", "add-character-save", "add-character-cancel"]) {
    const node = document.querySelector(`#${id}`);
    if (node) nodes.push(node);
  }
  for (const id of ["material-characters", "material-aliases", "material-speakers"]) {
    const root = document.querySelector(`#${id}`);
    if (!root?.querySelectorAll) continue;
    for (const node of root.querySelectorAll("button, input, textarea, select")) nodes.push(node);
  }
  return nodes;
}

function showStoryPending(label) {
  if (!loading) return;
  loading.hidden = false;
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  loading.setAttribute("aria-busy", "true");
  const spinner = document.createElement("span");
  spinner.className = "story-operation-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  copy.className = "story-operation-copy";
  const name = document.createElement("p");
  name.className = "story-operation-label";
  name.textContent = label;
  const wait = document.createElement("p");
  wait.className = "story-operation-wait";
  wait.textContent = STORY_WAIT_COPY;
  copy.append(name, wait);
  loading.replaceChildren(spinner, copy);
}

function hideStoryPending() {
  if (!loading) return;
  loading.hidden = true;
  loading.removeAttribute?.("aria-busy");
  loading.replaceChildren();
}

function showStoryNotice(message) {
  if (!notice) return;
  notice.hidden = false;
  notice.textContent = message;
}

function restoreStoryIdleLabels() {
  for (const spec of Object.values(STORY_OPERATIONS)) {
    const button = document.querySelector(`#${spec.buttonId}`);
    if (!button) continue;
    button.textContent = spec.idleLabel;
    button.classList?.remove?.("is-pending");
    button.removeAttribute?.("aria-busy");
  }
  const confirmButton = document.querySelector("#confirm-material");
  if (confirmButton) confirmButton.textContent = "Подтвердить";
}

function applyStoryLock() {
  if (!storyLock) return;
  const story = document.querySelector("#stage-view-story");
  if (story?.setAttribute) {
    story.setAttribute("aria-busy", "true");
    story.setAttribute("inert", "");
  }
  for (const entry of storyLock.controls) entry.node.disabled = true;
  const spec = STORY_OPERATIONS[storyLock.kind];
  const button = document.querySelector(`#${spec.buttonId}`);
  if (!button) return;
  button.textContent = spec.pendingLabel;
  button.classList?.add?.("is-pending");
  button.setAttribute("aria-busy", "true");
}

function acquireStoryOperation(kind) {
  if (storyLock) return false;
  storyLock = {
    kind,
    controls: storyControlNodes().map((node) => ({ node, disabled: Boolean(node.disabled) })),
  };
  applyStoryLock();
  showStoryPending(STORY_OPERATIONS[kind].pendingLabel);
  return true;
}

function releaseStoryOperation() {
  if (!storyLock) return;
  const story = document.querySelector("#stage-view-story");
  story?.removeAttribute?.("aria-busy");
  story?.removeAttribute?.("inert");
  for (const entry of storyLock.controls) entry.node.disabled = entry.disabled;
  storyLock = null;
  hideStoryPending();
  refreshConfirmation();
}

function refreshConfirmation() {
  if (!confirmMaterial || !materialMismatch) return;
  const readingMode = review?.mode === "reading";
  confirmMaterial.hidden = !readingMode;
  if (stageMaterial) stageMaterial.hidden = review?.mode !== "material" || storyboardReady();
  const matched = readingMode && textsMatch(review.text);
  confirmMaterial.disabled = !matched;
  materialMismatch.hidden = !readingMode || matched;
  if (!storyLocked()) restoreStoryIdleLabels();
  if (storyLocked()) applyStoryLock();
  refreshStages();
}

function hideReview() {
  review = null;
  if (materialReview) materialReview.hidden = true;
  refreshConfirmation();
}

function rowName(row) {
  const input = row.querySelector("input");
  if (input) return input.value;
  return row.dataset.characterName || "";
}

function characterNames() {
  return [...materialCharacters.querySelectorAll("li")].map((row) => rowName(row));
}

function extractedForCharacterName(name) {
  if (!name) return "";
  for (const row of materialCharacters.querySelectorAll("li")) {
    if (rowName(row) !== name) continue;
    return row.querySelector(".cast-include")?.dataset.extractedName || name;
  }
  return "";
}

function ownerLiveName(select) {
  const extracted = select.dataset.ownerExtracted || "";
  if (!extracted) return "";
  for (const row of materialCharacters.querySelectorAll("li")) {
    const key = row.querySelector(".cast-include")?.dataset.extractedName || "";
    if (key !== extracted) continue;
    return rowName(row);
  }
  return "";
}

function owningRow(node) {
  let current = node;
  while (current) {
    if (current.tagName === "LI") return current;
    current = current.parentNode;
  }
  return null;
}

function pendingRenameError(input) {
  const name = input.value.trim();
  if (!name) return "Введите имя персонажа.";
  const row = owningRow(input);
  for (const other of materialCharacters.querySelectorAll("li")) {
    if (other === row) continue;
    const otherName = rowName(other).trim();
    const otherExtracted = other.querySelector(".cast-include")?.dataset.extractedName || "";
    if (name === otherName || name === otherExtracted) return "Такое имя уже есть.";
  }
  return "";
}

function fillSelect(select, selected) {
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Не назначен";
  select.append(empty);
  for (const name of characterNames()) {
    if (!name) continue;
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  select.value = characterNames().includes(selected) ? selected : "";
}

function collectCast() {
  const characters = [];
  for (const row of materialCharacters.querySelectorAll("li")) {
    const toggle = row.querySelector(".cast-include");
    const name = rowName(row).trim();
    if (!name) return null;
    characters.push({
      name,
      included: toggle ? toggle.getAttribute("aria-pressed") === "true" : true,
      extractedName: toggle?.dataset.extractedName || name,
    });
  }
  if (pendingAddition && !characters.some((character) => character.name === pendingAddition.name)) {
    characters.push(pendingAddition);
  }
  const aliases = [];
  for (const select of materialAliases.querySelectorAll("select")) {
    if (!select.value) continue;
    aliases.push({ surface: select.dataset.surface, characterName: select.value });
  }
  const speakers = [];
  for (const select of materialSpeakers.querySelectorAll("select")) {
    if (!select.value) continue;
    speakers.push({ sourceItemId: select.dataset.sourceId, characterName: select.value });
  }
  return { characters, aliases, speakers };
}

function syncSelects() {
  for (const select of materialAliases.querySelectorAll("select")) fillSelect(select, ownerLiveName(select));
  for (const select of materialSpeakers.querySelectorAll("select")) fillSelect(select, ownerLiveName(select));
}

function scheduleCastSave() {
  if (storyLocked()) return;
  castChain = castChain.then(() => saveCast()).catch(() => {});
}

function castPhaseForReview() {
  return review?.mode === "reading" ? "pending_reading" : "material_state";
}

async function saveCast() {
  if (!review) return { ok: false };
  const cast = collectCast();
  if (!cast) return { ok: false };
  const path = review.mode === "reading"
    ? `/api/readings/${review.id}/cast`
    : "/api/material-states";
  const method = review.mode === "reading" ? "PUT" : "POST";
  const pending = pendingCastEdit;
  pendingCastEdit = null;
  let capture = null;
  if (pending) {
    capture = beginProductResearchCapture({
      semanticAction: "cast_edit",
      submittedText: pending.submittedText,
      commandTarget: null,
      editTarget: createEmptyEditTarget(pending.editKind, castPhaseForReview(), {
        characterName: pending.characterName,
        previousCharacterName: pending.previousCharacterName ?? null,
        surfaceForm: pending.surfaceForm ?? null,
        sourceItemId: pending.sourceItemId ?? null,
      }),
    });
    await capture.start();
  }
  let response;
  try {
    response = await fetch(scoped(path), {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cast),
    });
  } catch {
    renderReview();
    if (capture) await capture.terminal("failure", { outcomeKind: "request-failed" });
    return { ok: false };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const revertKind = payload?.kind === "speaking-character"
    || payload?.kind === "cast-reconciliation"
    || payload?.kind === "duplicate-name";
  if (response.status === 409 && !revertKind) {
    refreshConfirmation();
    renderReview();
    if (capture) await capture.terminal("failure", { outcomeKind: "stale-cast" });
    return { ok: false, stale: true };
  }
  if (!response.ok) {
    if (payload?.message) showCastStatus(payload.message);
    renderReview();
    if (capture) await capture.terminal(payload?.status === "blocked" ? "blocked" : "failure", { outcomeKind: payload?.kind || "request-failed" });
    return { ok: false };
  }
  review.cast = cast;
  showCastStatus("");
  if (review.mode === "material" && payload?.materialStateId) review.id = payload.materialStateId;
  renderReview();
  if (payload?.visualChanged) await refreshVisual();
  if (capture) await capture.terminal("success");
  return { ok: true };
}

function renderSources() {
  materialSources.replaceChildren();
  for (const item of review.sourceItems || []) {
    const row = document.createElement("li");
    row.dataset.sourceId = item.id;
    const owner = (review.cast?.speakers || []).find((speaker) => speaker.sourceItemId === item.id);
    row.textContent = owner ? `${item.sourceQuote} — ${owner.characterName}` : item.sourceQuote;
    materialSources.append(row);
  }
}

function renderFindings() {
  const blocking = (review.findings || []).filter((finding) => finding.code === "unresolved-speaker");
  if (review.cast) {
    const assigned = new Set((review.cast.speakers || []).map((speaker) => speaker.sourceItemId));
    const fromCast = (review.sourceItems || [])
      .filter((item) => item.kind === "utterance" && !assigned.has(item.id))
      .map((item) => ({ code: "unresolved-speaker", sourceItemId: item.id, sourceQuote: item.sourceQuote }));
    materialFindings.replaceChildren();
    materialFindings.hidden = fromCast.length === 0;
    for (const finding of fromCast) {
      const row = document.createElement("li");
      row.dataset.code = finding.code;
      row.dataset.sourceId = finding.sourceItemId;
      row.textContent = `Нет говорящего: ${finding.sourceQuote}`;
      materialFindings.append(row);
    }
    return;
  }
  materialFindings.replaceChildren();
  materialFindings.hidden = blocking.length === 0;
  for (const finding of blocking) {
    const row = document.createElement("li");
    row.dataset.code = finding.code;
    row.textContent = `Нет говорящего: ${finding.sourceQuote}`;
    materialFindings.append(row);
  }
}

function closeCharacterAdd() {
  if (addCharacterForm) addCharacterForm.hidden = true;
  if (addCharacterButton) addCharacterButton.hidden = false;
  if (addCharacterName) addCharacterName.value = "";
}

function openCharacterAdd() {
  if (storyLocked() || !review || characterAddLocked) return;
  if (addCharacterForm) addCharacterForm.hidden = false;
  if (addCharacterButton) addCharacterButton.hidden = true;
  if (addCharacterName) {
    addCharacterName.value = "";
    addCharacterName.focus?.();
  }
  showCastStatus("");
}

function characterAddError(name) {
  if (!name) return "Введите имя персонажа.";
  const characters = review?.cast?.characters || [];
  const taken = characters.some((character) => (
    character.name === name || (character.extractedName || character.name) === name
  ));
  if (taken) return "Такое имя уже есть.";
  return "";
}

function commitCharacterAdd() {
  if (storyLocked() || !review || characterAddLocked) return;
  const name = typeof addCharacterName?.value === "string" ? addCharacterName.value.trim() : "";
  const message = characterAddError(name);
  if (message) {
    showCastStatus(message);
    return;
  }
  showCastStatus("");
  characterAddLocked = true;
  pendingAddition = { name, included: true, extractedName: name };
  pendingCastEdit = {
    editKind: "character_add",
    submittedText: name,
    characterName: name,
    previousCharacterName: null,
  };
  castChain = castChain.then(async () => {
    try {
      const saved = await saveCast();
      if (!saved?.ok) renderReview();
    } finally {
      pendingAddition = null;
      characterAddLocked = false;
    }
  }).catch(() => {
    pendingAddition = null;
    characterAddLocked = false;
    renderReview();
  });
}

function renderReview() {
  closeCharacterAdd();
  materialReview.hidden = false;
  renderSources();
  materialCharacters.replaceChildren();
  const namesEditable = review.mode === "reading";
  for (const character of review.cast?.characters || []) {
    const row = document.createElement("li");
    row.className = "material-row";
    row.dataset.characterName = character.name;
    const included = character.included !== false;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cast-include";
    toggle.dataset.extractedName = character.extractedName || character.name;
    toggle.setAttribute("aria-pressed", included ? "true" : "false");
    toggle.textContent = included ? "✓" : "○";
    toggle.setAttribute("aria-label", included ? `В кадре: ${character.name}` : `Не в кадре: ${character.name}`);
    const nameNode = namesEditable ? document.createElement("input") : document.createElement("span");
    if (namesEditable) {
      nameNode.value = character.name;
      nameNode.dataset.previousName = character.name;
      nameNode.addEventListener("input", () => syncSelects());
      nameNode.addEventListener("blur", () => {
        if (storyLocked()) return;
        nameNode.value = nameNode.value.trim();
        const message = pendingRenameError(nameNode);
        if (message) {
          showCastStatus(message);
          renderReview();
          return;
        }
        syncSelects();
        pendingCastEdit = {
          editKind: "character_rename",
          submittedText: nameNode.value,
          characterName: nameNode.value,
          previousCharacterName: nameNode.dataset.previousName || null,
        };
        const label = toggle.getAttribute("aria-pressed") === "true" ? `В кадре: ${nameNode.value}` : `Не в кадре: ${nameNode.value}`;
        toggle.setAttribute("aria-label", label);
        scheduleCastSave();
      });
    } else {
      nameNode.className = "cast-name";
      nameNode.textContent = character.name;
    }
    toggle.addEventListener("click", () => {
      if (storyLocked()) return;
      const name = rowName(row);
      const next = toggle.getAttribute("aria-pressed") !== "true";
      if (!next) {
        const count = (review.cast?.speakers || []).filter((speaker) => speaker.characterName === name).length;
        if (count > 0) {
          showCastStatus(utteranceImpactMessage(count));
          return;
        }
      }
      showCastStatus("");
      toggle.setAttribute("aria-pressed", next ? "true" : "false");
      toggle.textContent = next ? "✓" : "○";
      toggle.setAttribute("aria-label", next ? `В кадре: ${name}` : `Не в кадре: ${name}`);
      pendingCastEdit = {
        editKind: "character_inclusion",
        submittedText: next ? "included" : "excluded",
        characterName: name,
        previousCharacterName: name,
      };
      scheduleCastSave();
    });
    row.append(toggle, nameNode);
    materialCharacters.append(row);
  }
  const aliasSurfaces = [];
  const seen = new Set();
  for (const form of review.surfaceForms || []) {
    if (seen.has(form.quote)) continue;
    seen.add(form.quote);
    aliasSurfaces.push(form.quote);
  }
  for (const alias of review.cast?.aliases || []) {
    if (seen.has(alias.surface)) continue;
    seen.add(alias.surface);
    aliasSurfaces.push(alias.surface);
  }
  materialAliases.replaceChildren();
  for (const surface of aliasSurfaces) {
    const row = document.createElement("li");
    row.className = "material-row";
    const label = document.createElement("span");
    label.textContent = surface;
    const select = document.createElement("select");
    select.dataset.surface = surface;
    const current = (review.cast?.aliases || []).find((alias) => alias.surface === surface);
    const aliasOwner = (review.cast?.characters || []).find((character) => character.name === current?.characterName);
    select.dataset.ownerExtracted = aliasOwner ? (aliasOwner.extractedName || aliasOwner.name) : "";
    fillSelect(select, current?.characterName || "");
    select.addEventListener("change", () => {
      if (storyLocked()) return;
      select.dataset.ownerExtracted = extractedForCharacterName(select.value);
      pendingCastEdit = {
        editKind: "alias_assignment",
        submittedText: select.value,
        characterName: select.value,
        surfaceForm: surface,
      };
      scheduleCastSave();
    });
    row.append(label, select);
    const mapped = (review.cast?.characters || []).find((character) => character.name === current?.characterName);
    if (mapped && mapped.included === false) {
      const mark = document.createElement("span");
      mark.textContent = "исключён";
      row.append(mark);
    }
    materialAliases.append(row);
  }
  materialSpeakers.replaceChildren();
  for (const item of (review.sourceItems || []).filter((entry) => entry.kind === "utterance")) {
    const row = document.createElement("li");
    row.className = "material-row";
    const label = document.createElement("span");
    label.textContent = item.sourceQuote;
    const select = document.createElement("select");
    select.dataset.sourceId = item.id;
    const current = (review.cast?.speakers || []).find((speaker) => speaker.sourceItemId === item.id);
    const speakerOwner = (review.cast?.characters || []).find((character) => character.name === current?.characterName);
    select.dataset.ownerExtracted = speakerOwner ? (speakerOwner.extractedName || speakerOwner.name) : "";
    fillSelect(select, current?.characterName || "");
    select.addEventListener("change", () => {
      if (storyLocked()) return;
      select.dataset.ownerExtracted = extractedForCharacterName(select.value);
      pendingCastEdit = {
        editKind: "speaker_assignment",
        submittedText: select.value,
        characterName: select.value,
        sourceItemId: item.id,
      };
      scheduleCastSave();
    });
    row.append(label, select);
    materialSpeakers.append(row);
  }
  renderFindings();
  refreshConfirmation();
}

function showMaterial(documentState, mode) {
  review = {
    mode,
    id: documentState.id,
    text: documentState.text,
    sourceItems: documentState.sourceItems || [],
    characters: documentState.characters || [],
    surfaceForms: documentState.surfaceForms || [],
    cast: documentState.cast || { characters: [], aliases: [], speakers: [] },
    findings: documentState.findings || [],
  };
  renderReview();
}

function restoreReview(project) {
  if (project?.reading?.status === "ready") {
    showMaterial(project.reading, "reading");
    return;
  }
  if (project?.material) {
    showMaterial(project.material, "material");
    return;
  }
  hideReview();
}

draftField.addEventListener("input", () => refreshConfirmation());

addCharacterButton?.addEventListener("click", () => openCharacterAdd());
addCharacterForm?.addEventListener("submit", (event) => {
  event.preventDefault?.();
  commitCharacterAdd();
});
addCharacterCancel?.addEventListener("click", () => {
  if (characterAddLocked) return;
  closeCharacterAdd();
  showCastStatus("");
});

confirmMaterial?.addEventListener("click", async () => {
  if (storyLocked()) return;
  if (!review || review.mode !== "reading" || confirmMaterial.disabled) return;
  const synced = await draftAutosave.flush();
  refreshConfirmation();
  if (!synced || !textsMatch(review.text)) return;
  const saved = await saveCast();
  if (!saved.ok) return;
  await runProductResearchAction({
    semanticAction: "confirm_material",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("none"),
    async operation() {
      let response;
      try {
        response = await fetch(scoped("/api/confirmations"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ readingId: review.id }),
        });
      } catch (error) {
        showTerminal(pageState({ http: { status: "failed", kind: "provider" } }));
        const err = error instanceof Error ? error : new Error("provider");
        err.kind = "provider";
        throw err;
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (response.status === 409) {
        refreshConfirmation();
        const err = new Error("stale");
        err.kind = "stale-reading";
        throw err;
      }
      if (!response.ok || !payload?.materialStateId) {
        showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
        const err = new Error("invalid-request");
        err.kind = "invalid-request";
        throw err;
      }
      review.mode = "material";
      review.id = payload.materialStateId;
      renderReview();
      return payload;
    },
  });
});

function restoreStoryboard(project) {
  const board = (project?.storyboards || []).find((item) => item?.materialStateId === project?.activeMaterialStateId);
  if (!board) return null;
  if (board.status === "blocked" || board.status === "failed") {
    showTerminal(pageState({ http: board }));
    return null;
  }
  if (board.status === "checked" && Array.isArray(board.frames) && board.frames.length > 0) {
    return presentCheckedStoryboard(board);
  }
  return null;
}

stageMaterial?.addEventListener("click", async () => {
  if (storyLocked()) return;
  if (!review || review.mode !== "material" || stageMaterial.hidden) return;
  if (!acquireStoryOperation("staging")) return;
  try {
    showLoading();
    await runProductResearchAction({
      semanticAction: "stage_storyboard",
      submittedText: null,
      commandTarget: createEmptyCommandTarget("storyboard"),
      async operation() {
        let response;
        try {
          response = await fetch(scoped("/api/storyboard-results"), { method: "POST" });
        } catch (error) {
          showTerminal(pageState({ http: { status: "failed", kind: "provider" } }));
          showStoryNotice(STORY_STAGING_FAILURE);
          const err = error instanceof Error ? error : new Error("provider");
          err.kind = "provider";
          throw err;
        }
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          showTerminal(pageState({ http: { status: "failed", kind: "invalid-request" } }));
          showStoryNotice(STORY_STAGING_FAILURE);
          const err = new Error("invalid-request");
          err.kind = "invalid-request";
          throw err;
        }
        if (!response.ok || !payload || payload.status === "failed") {
          showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
          showStoryNotice(STORY_STAGING_FAILURE);
          const err = new Error("failed");
          err.kind = payload?.kind || "request-failed";
          throw err;
        }
        if (payload.status === "blocked") {
          showTerminal(pageState({ http: payload }));
          showStoryNotice(STORY_STAGING_BLOCKED);
          const err = new Error("blocked");
          err.kind = "blocked";
          throw err;
        }
        if (payload.status !== "checked") {
          showTerminal(pageState({ http: { status: "failed", kind: "invalid-request" } }));
          showStoryNotice(STORY_STAGING_FAILURE);
          const err = new Error("invalid-request");
          err.kind = "invalid-request";
          throw err;
        }
        await presentCheckedStoryboard(payload);
        await refreshVisual();
        const state = document.body?.dataset?.state;
        if (state === "ready" || state === "checked") showStoryNotice(STORY_STAGING_SUCCESS);
        else showStoryNotice(state === "blocked" ? STORY_STAGING_BLOCKED : STORY_STAGING_FAILURE);
        return payload;
      },
    });
  } finally {
    releaseStoryOperation();
  }
});

function showMissingProject() {
  const missing = document.querySelector("#project-missing");
  const workspace = document.querySelector("#workspace-body");
  if (missing) missing.hidden = false;
  if (workspace) workspace.hidden = true;
  const rename = document.querySelector("#rename-form");
  if (rename) rename.hidden = true;
  const duplicate = document.querySelector("#duplicate-project");
  if (duplicate) duplicate.hidden = true;
  const dock = document.querySelector("#research-dock-host");
  if (dock) dock.hidden = true;
  if (stageNav) stageNav.hidden = true;
}

let savedProjectTitle = "";

function showProjectTitle(title) {
  savedProjectTitle = typeof title === "string" ? title : "";
  const input = document.querySelector("#project-title");
  if (input && document.activeElement !== input) input.value = savedProjectTitle;
}

draftAutosave.ready.then(async () => {
  try {
    const response = await fetch(scoped("/api/project"));
    if (response.status === 404) {
      showMissingProject();
      return;
    }
    if (!response.ok) return;
    const project = await response.json();
    showProjectTitle(project.title);
    restoreReview(project);
    await restoreStoryboard(project);
    await refreshVisual();
    workspaceStages?.settleDefault();
    await fetch(scoped("/api/project/open"), { method: "POST" });
  } catch {
    hideReview();
  } finally {
    workspaceStages?.settleDefault();
  }
});

document.querySelector("#rename-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#project-title");
  const title = input?.value ?? "";
  try {
    const response = await fetch(scoped("/api/project/rename"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) return;
    const payload = await response.json();
    showProjectTitle(payload.title);
  } catch {
    // The visible title stays as the user left it. The next reload shows the stored title.
  }
});

const duplicateButton = document.querySelector("#duplicate-project");
if (duplicateButton) duplicateButton.textContent = DUPLICATE_LABEL;
bindDuplicateDialog({
  dialog: document.querySelector("#duplicate-project-dialog"),
  form: document.querySelector("#duplicate-project-form"),
  titleInput: document.querySelector("#duplicate-project-title"),
  statusNode: document.querySelector("#duplicate-project-status"),
  submitButton: document.querySelector("#duplicate-project-submit"),
  cancelButton: document.querySelector("#duplicate-project-cancel"),
  openButton: duplicateButton,
  getSource: () => ({ id: projectIdFromLocation(), title: savedProjectTitle }),
  requestDuplicate: requestProjectDuplicate,
  onSuccess(project) {
    if (project?.id) window.location.assign(`/projects/${project.id}`);
  },
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (storyLocked()) return;
  if (!acquireStoryOperation("reading")) return;
  const submittedDraft = draftField.value;
  let staleReading = false;
  try {
    const synced = await draftAutosave.flush();
    if (!synced) return;
    applyStoryLock();
    showLoading();
    await runProductResearchAction({
      semanticAction: "reading",
      submittedText: submittedDraft,
      commandTarget: createEmptyCommandTarget("none"),
      async operation() {
        let response;
        try {
          response = await fetch(scoped("/api/readings"), { method: "POST" });
        } catch (error) {
          showTerminal(pageState({ http: { status: "failed", kind: "provider" } }));
          showStoryNotice(STORY_READING_FAILURE);
          const err = error instanceof Error ? error : new Error("provider");
          err.kind = "provider";
          throw err;
        }
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          showTerminal(pageState({ http: { status: "failed", kind: "invalid-request" } }));
          showStoryNotice(STORY_READING_FAILURE);
          const err = new Error("invalid-request");
          err.kind = "invalid-request";
          throw err;
        }
        if (response.status === 409 || payload?.kind === "stale-reading") {
          staleReading = true;
          materialMismatch.hidden = false;
          showStoryNotice(STORY_READING_FAILURE);
          const err = new Error("stale-reading");
          err.kind = "stale-reading";
          throw err;
        }
        if (!payload || payload.status !== "ready") {
          hideReview();
          showTerminal(pageState({ http: payload || { status: "failed", kind: "invalid-request" } }));
          showStoryNotice(STORY_READING_FAILURE);
          const err = new Error("invalid-request");
          err.kind = payload?.kind || "invalid-request";
          throw err;
        }
        hideFailure();
        showMaterial(payload, "reading");
        showStoryNotice(STORY_READING_SUCCESS);
        return payload;
      },
    });
  } finally {
    releaseStoryOperation();
    if (staleReading && materialMismatch) materialMismatch.hidden = false;
  }
});

const renderLabels = {
  idle: "Ожидание",
  running: "Сборка идёт",
  success: "Видео готово",
  failure: "Сборка не удалась",
};

let renderTimer = 0;

async function refreshRenderStatus() {
  if (!renderPanel || renderPanel.hidden) return;
  globalThis.clearTimeout(renderTimer);
  try {
    const status = await fetchJson("/api/visual/render");
    lastRenderStatus = status && typeof status.status === "string" ? { status: status.status } : null;
    refreshStages();
    if (!renderStatus) return;
    renderStatus.textContent = renderLabels[status.status] || renderLabels.idle;
    if (renderError) {
      renderError.hidden = status.status !== "failure";
      renderError.textContent = status.message || "Не удалось собрать видео.";
    }
    const ready = status.status === "success" && status.id;
    if (renderPreview) renderPreview.hidden = !ready;
    if (renderDownload) renderDownload.hidden = !ready;
    if (ready) {
      const src = scoped(`/api/visual/render/result?render=${encodeURIComponent(status.id)}`);
      if (renderPreview && !renderPreview.src.endsWith(encodeURIComponent(status.id))) renderPreview.src = src;
      if (renderDownload) renderDownload.href = src;
    }
    if (status.status === "running") renderTimer = globalThis.setTimeout(refreshRenderStatus, 2000);
  } catch {
    if (renderStatus) renderStatus.textContent = renderLabels.idle;
  }
}

function statusObstacles() {
  return [globalUndo, actionStatus].flatMap((node) => {
    if (!node || node.hidden || !node.getBoundingClientRect) return [];
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    return [{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }];
  });
}

function undoneNotice(next) {
  const label = next?.undoneLabel;
  const target = next?.undoneTarget;
  if (!label) return "Последнее изменение отменено.";
  if (Number.isInteger(target?.displayFrameNumber)) {
    const panel = Number.isInteger(target.panelIndex) ? `, панель ${target.panelIndex + 1}` : "";
    return `Отменено: ${label} · кадр ${target.displayFrameNumber}${panel}`;
  }
  return `Отменено: ${label}`;
}

function performGlobalUndo() {
  const pendingLabel = visual?.undoLabel || null;
  return runProductResearchAction({
    semanticAction: "storyboard_undo",
    submittedText: null,
    commandTarget: createEmptyCommandTarget("storyboard"),
    contextOverrides: {
      storyboardVersionId: visual?.storyboardVersionId || null,
    },
    busyMessage: "Отменяю последнее изменение…",
    async operation() {
      const next = await fetchJson("/api/visual/storyboard/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const undone = next?.undoneTarget;
      const createdId = undone?.op === "duplicateFrame" && typeof undone?.created?.structureFrameId === "string"
        ? undone.created.structureFrameId
        : null;
      const viewingCopy = Boolean(createdId && detail?.open && frameEditor.structureId === createdId);
      if (next?.status === "ready") applyVisual(next);
      if (viewingCopy) {
        openStructureAddress(undone.source?.structureFrameId ? undone.source : {
          structureFrameId: undone.structureFrameId,
          structureSegmentIndex: Number.isInteger(undone.structureSegmentIndex) ? undone.structureSegmentIndex : null,
        });
      }
      const label = next?.undoneLabel || pendingLabel;
      showActionNotice(undoneNotice({ ...next, undoneLabel: label }), "success");
      return next;
    },
  });
}

function selectedTransition() {
  return renderTransition?.value === "cross-dissolve" ? "cross-dissolve" : "hard-cut";
}

let introTemplates = [];

function selectedIntroTemplate() {
  const id = renderIntro?.value || "";
  if (!id) return null;
  const template = introTemplates.find((entry) => entry.id === id);
  if (!template || template.available === false) return null;
  return template;
}

function renderFailureText(error) {
  const message = typeof error?.payload?.message === "string"
    ? error.payload.message.replace(/\s+/g, " ").trim()
    : "";
  if (message && message.length <= 240 && !/postgres:\/\/|password|secret|api[_-]?key|authorization|bearer /i.test(message)) {
    return message;
  }
  return actionMessage(error?.kind);
}

function renderIntroOptions(templates) {
  if (!renderIntro?.replaceChildren) return;
  const current = renderIntro.value || "";
  renderIntro.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Без интро";
  renderIntro.append(none);
  for (const template of templates) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    option.disabled = template.available === false;
    renderIntro.append(option);
  }
  const still = templates.some((template) => template.id === current && template.available !== false);
  renderIntro.value = still ? current : "";
}

function syncIntroAvailability() {
  if (!introAvailability) return;
  const note = introTemplates.find((template) => template.available === false && template.message);
  introAvailability.hidden = !note;
  introAvailability.textContent = note?.message || "";
}

function refreshIntroTemplates() {
  if (!renderIntro) return;
  fetchJson("/api/visual/intro-templates")
    .then((payload) => {
      introTemplates = Array.isArray(payload?.templates) ? payload.templates : [];
      renderIntroOptions(introTemplates);
      syncIntroAvailability();
      syncExportRuntime();
    })
    .catch(() => {
      introTemplates = [];
      renderIntroOptions([]);
      syncIntroAvailability();
      syncExportRuntime();
    });
}

function syncExportRuntime() {
  if (!renderRuntime) return;
  const frames = (visual?.frames || []).map((frame) => ({
    kind: frame.frameKind === "text" ? "text" : (frame.frameKind || "image"),
    durationFrames: frame.durationFrames || 36,
  }));
  if (!frames.length) {
    renderRuntime.textContent = "";
    return;
  }
  const timeline = compileTransitionTimeline(frames, selectedTransition());
  const introFrames = selectedIntroTemplate()?.durationFrames || 0;
  renderRuntime.textContent = timeline.ok
    ? formatExportRuntime({
      totalDurationFrames: timeline.totalDurationFrames + introFrames,
      nominalDurationFrames: timeline.nominalDurationFrames + introFrames,
      mode: timeline.mode,
      overlapFrames: timeline.overlapFrames,
    })
    : "";
}

renderTransition?.addEventListener?.("change", () => {
  syncExportRuntime();
});

renderIntro?.addEventListener?.("change", () => {
  syncIntroAvailability();
  syncExportRuntime();
});

startRender?.addEventListener("click", async () => {
  if (renderError) renderError.hidden = true;
  if (busy) return;
  busy = true;
  document.body.dataset.busy = "true";
  showActionNotice("Запускаю сборку видео…", "running");
  const versionBefore = visual?.storyboardVersionId || null;
  try {
    const started = await fetchJson("/api/visual/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transition: selectedTransition(),
        introTemplateId: selectedIntroTemplate()?.id || null,
      }),
    });
    if (visual?.storyboardVersionId && versionBefore && visual.storyboardVersionId !== versionBefore) {
      showActionNotice("Сборка не должна менять раскадровку.", "error");
    }
    if (started?.status === "running") {
      lastRenderStatus = { status: "running" };
      refreshStages();
      if (renderStatus) renderStatus.textContent = renderLabels.running;
      if (started.totalDurationFrames && renderRuntime) {
        renderRuntime.textContent = formatExportRuntime({
          totalDurationFrames: started.totalDurationFrames,
          nominalDurationFrames: started.nominalDurationFrames || started.totalDurationFrames,
          mode: started.transition || selectedTransition(),
          overlapFrames: started.overlapFrames || 0,
        });
      }
      renderTimer = globalThis.setTimeout(refreshRenderStatus, 1000);
    }
  } catch (error) {
    const message = renderFailureText(error);
    showActionNotice(message, "error");
    lastRenderStatus = { status: "failure" };
    refreshStages();
    if (renderStatus) renderStatus.textContent = renderLabels.failure;
    if (renderError) {
      renderError.hidden = false;
      renderError.textContent = message;
    }
  } finally {
    busy = false;
    delete document.body.dataset.busy;
  }
});

async function loadBuildMarker() {
  if (!buildMarker) return;
  try {
    const response = await fetch("/api/build", { cache: "no-store" });
    if (!response.ok) throw new Error("status");
    const payload = await response.json();
    const id = typeof payload.id === "string" && payload.id ? payload.id : "unknown";
    const when = payload.builtAt ? ` · ${payload.builtAt}` : "";
    buildMarker.textContent = `Сборка ${id}${when}`;
  } catch {
    buildMarker.textContent = "Сборка unknown";
  }
}

loadBuildMarker();
