// Port of prototypes/storyboard-viewer/frame-renderer.mjs (served to the
// production page as /frame-renderer.mjs): FRAME_GEOMETRY, render,
// dialogueRegionVisible, visibleDialogueText, fontSizeFor, renditionTransform,
// panelContentSize, panByPointer. measureDialogue and overflow splitting are
// not ported. Stage, review, and basis labels never enter the canvas.

export const FRAME_GEOMETRY = {
  width: 1920,
  height: 1080,
  dialogueBarHeight: 300,
  panelGutter: 48,
  splitPadding: "34px 44px 24px",
  singlePadding: "38px 70px 26px",
};

const FRAME_BG = "#02090b";

export function renditionTransform({ zoom = 1, mirrored = false } = {}) {
  const scale = `scale(${Number(zoom)})`;
  return mirrored ? `scaleX(-1) ${scale}` : scale;
}

export function panelContentSize(panelCount, hasDialogue) {
  const count = Math.max(1, Number(panelCount) || 1);
  const gutter = Math.max(0, count - 1) * FRAME_GEOMETRY.panelGutter;
  return {
    width: (FRAME_GEOMETRY.width - gutter) / count,
    height: FRAME_GEOMETRY.height - (hasDialogue ? FRAME_GEOMETRY.dialogueBarHeight : 0),
  };
}

export function dialogueRegionVisible(frame) {
  if (frame?.frameKind === "text") return false;
  if (frame?.dialogueMode === "spoken" || frame?.dialogueMode === "silent") return true;
  if (frame?.dialogueMode === "hidden") return false;
  return typeof frame?.dialogue === "string" && frame.dialogue.trim().length > 0;
}

export function visibleDialogueText(frame) {
  if (frame?.frameKind === "text") return "";
  if (frame?.dialogueMode === "silent" || frame?.dialogueMode === "hidden") return "";
  const text = typeof frame?.dialogue === "string" ? frame.dialogue : "";
  return text.trim() ? text : "";
}

function clampPercent(value) {
  return Math.round(Math.min(100, Math.max(0, value)) * 1000) / 1000;
}

export function panByPointer({ positionX, positionY, deltaX, deltaY, frameScale, panelWidth, panelHeight, mirrored = false } = {}) {
  const values = [frameScale, panelWidth, panelHeight, deltaX, deltaY, positionX, positionY].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [scale, width, height, dx, dy, x, y] = values;
  if (!(scale > 0) || !(width > 0) || !(height > 0)) return null;
  const xSign = mirrored ? 1 : -1;
  return {
    positionX: clampPercent(x + xSign * ((dx / scale) / width) * 100),
    positionY: clampPercent(y - ((dy / scale) / height) * 100),
  };
}

export function fontSizeFor(text, split) {
  const length = text.length;
  if (split) {
    if (length > 120) return 31;
    if (length > 80) return 34;
    if (length > 45) return 38;
    return 44;
  }
  if (length > 125) return 42;
  if (length > 90) return 46;
  if (length > 60) return 51;
  return 58;
}

function el(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function render(frame, { mode = "visual", document: doc = globalThis.document } = {}) {
  const structure = mode === "structure";
  const panels = Array.isArray(frame.panels) ? frame.panels : [];
  const split = panels.length > 1;
  const canvas = el(doc, "div", `frame-canvas mode-${structure ? "structure" : "visual"}`);
  canvas.dataset.layout = frame.layout || "single";
  canvas.style.width = `${FRAME_GEOMETRY.width}px`;
  canvas.style.height = `${FRAME_GEOMETRY.height}px`;
  if (frame.frameKind === "text") {
    canvas.dataset.kind = "text";
    canvas.style.background = FRAME_BG;
    const card = el(doc, "div", "text-card");
    card.textContent = frame.textCard || "";
    canvas.append(card);
    return canvas;
  }
  const strip = el(doc, "div", "panel-strip");
  const showRegion = dialogueRegionVisible(frame);
  const dialogue = visibleDialogueText(frame);
  strip.style.bottom = showRegion ? `${FRAME_GEOMETRY.dialogueBarHeight}px` : "0";
  panels.forEach((panel, index) => {
    const column = el(doc, "section", "panel");
    column.dataset.panelIndex = String(index);
    if (index > 0) column.style.borderLeft = `${FRAME_GEOMETRY.panelGutter}px solid ${FRAME_BG}`;
    if (structure) {
      const description = el(doc, "p", "panel-description");
      description.textContent = panel.description || "";
      column.append(description);
    } else if (!panel.asset) {
      const placeholder = el(doc, "p", "panel-placeholder");
      placeholder.textContent = "Нет изображения";
      column.append(placeholder);
    } else {
      const image = el(doc, "img", "panel-asset");
      image.draggable = false;
      image.src = panel.asset;
      image.alt = [panel.subject, panel.role, panel.description].filter(Boolean).join(". ");
      image.style.objectPosition = panel.position;
      image.style.transformOrigin = panel.align;
      image.style.transform = renditionTransform({ zoom: panel.zoom, mirrored: panel.mirrored === true });
      column.append(image);
    }
    strip.append(column);
  });
  if (!showRegion) {
    canvas.append(strip);
    return canvas;
  }
  const bar = el(doc, "div", "dialogue-bar");
  bar.style.height = `${FRAME_GEOMETRY.dialogueBarHeight}px`;
  const fontSize = fontSizeFor(dialogue, split);
  panels.forEach((panel, index) => {
    const cell = el(doc, "div", "dialogue-cell");
    cell.style.padding = split ? FRAME_GEOMETRY.splitPadding : FRAME_GEOMETRY.singlePadding;
    if (index > 0) cell.style.borderLeft = `${FRAME_GEOMETRY.panelGutter}px solid ${FRAME_BG}`;
    if (dialogue && index === frame.speakerPanel) {
      const text = el(doc, "p", "dialogue-text");
      text.style.fontSize = `${fontSize}px`;
      text.textContent = dialogue;
      cell.append(text);
    }
    bar.append(cell);
  });
  canvas.append(strip, bar);
  return canvas;
}

// mountFrame in app/storyboard-web/public/app.js: a scaled stage around one canvas.
export function mountFrame(host, frame, scale, mode, doc = globalThis.document) {
  host.replaceChildren();
  const stage = doc.createElement("div");
  stage.className = "frame-stage";
  stage.style.width = `${FRAME_GEOMETRY.width * scale}px`;
  stage.style.height = `${FRAME_GEOMETRY.height * scale}px`;
  stage.style.setProperty("--frame-scale", String(scale));
  stage.dataset.frameScale = String(scale);
  stage.append(render(frame, { mode, document: doc }));
  host.append(stage);
  return stage;
}
