export const FRAME_GEOMETRY = {
  width: 1920,
  height: 1080,
  dialogueBarHeight: 300,
  panelGutter: 48,
  splitPadding: "34px 44px 24px",
  singlePadding: "38px 70px 26px",
};

export const FONT_LADDER = {
  single: [58, 51, 46, 42],
  split2: [44, 38, 34, 31],
};

const FRAME_BG = "#02090b";

export const PLACEMENT_DEFAULTS = Object.freeze({
  zoom: 1,
  positionX: 50,
  positionY: 30,
  mirrored: false,
});

export function renditionTransform({ zoom = 1, mirrored = false } = {}) {
  const scale = "scale(" + Number(zoom) + ")";
  return mirrored ? "scaleX(-1) " + scale : scale;
}

export function panelContentSize(panelCount, hasDialogue) {
  const count = Math.max(1, Number(panelCount) || 1);
  const gutter = Math.max(0, count - 1) * FRAME_GEOMETRY.panelGutter;
  return {
    width: (FRAME_GEOMETRY.width - gutter) / count,
    height: FRAME_GEOMETRY.height - (hasDialogue ? FRAME_GEOMETRY.dialogueBarHeight : 0),
  };
}

function clampPercent(value) {
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped * 1000) / 1000;
}

export function panByPointer({
  positionX,
  positionY,
  deltaX,
  deltaY,
  frameScale,
  panelWidth,
  panelHeight,
  mirrored = false,
} = {}) {
  const scale = Number(frameScale);
  const width = Number(panelWidth);
  const height = Number(panelHeight);
  const dx = Number(deltaX);
  const dy = Number(deltaY);
  const x = Number(positionX);
  const y = Number(positionY);
  if (![scale, width, height, dx, dy, x, y].every((value) => Number.isFinite(value))) return null;
  if (!(scale > 0) || !(width > 0) || !(height > 0)) return null;
  const localX = dx / scale;
  const localY = dy / scale;
  const xSign = mirrored ? 1 : -1;
  return {
    positionX: clampPercent(x + xSign * (localX / width) * 100),
    positionY: clampPercent(y - (localY / height) * 100),
  };
}

function el(tag, className, ownerDocument) {
  const node = ownerDocument.createElement(tag);
  if (className) node.className = className;
  return node;
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

function selectedFontSize(dialogue, split, requested) {
  const ladder = split ? FONT_LADDER.split2 : FONT_LADDER.single;
  if (typeof requested === "number" && ladder.includes(requested)) return requested;
  return fontSizeFor(dialogue, split);
}

export function render(frame, options) {
  const mode = options && options.mode === "structure" ? "structure" : "visual";
  const ownerDocument = (options && options.document) || document;
  const panels = Array.isArray(frame.panels) ? frame.panels : [];
  const split = panels.length > 1;
  const canvas = el("div", "frame-canvas mode-" + mode, ownerDocument);
  canvas.dataset.layout = frame.layout || "single";
  canvas.dataset.mode = mode;
  canvas.style.width = FRAME_GEOMETRY.width + "px";
  canvas.style.height = FRAME_GEOMETRY.height + "px";
  if (frame.frameKind === "text") {
    canvas.dataset.kind = "text";
    canvas.style.background = FRAME_BG;
    const card = el("div", "text-card", ownerDocument);
    card.textContent = frame.textCard || "";
    canvas.append(card);
    return canvas;
  }

  const strip = el("div", "panel-strip", ownerDocument);
  const dialogue = typeof frame.dialogue === "string" && frame.dialogue.trim() ? frame.dialogue : "";
  strip.style.bottom = dialogue ? (FRAME_GEOMETRY.dialogueBarHeight + "px") : "0";

  panels.forEach((panel, index) => {
    const column = el("section", "panel", ownerDocument);
    column.dataset.panelIndex = String(index);
    if (index > 0) column.style.borderLeft = FRAME_GEOMETRY.panelGutter + "px solid " + FRAME_BG;
    if (mode === "structure") {
      const description = el("p", "panel-description", ownerDocument);
      description.textContent = panel.description || "";
      column.append(description);
    } else if (!panel.asset) {
      const placeholder = el("p", "panel-placeholder", ownerDocument);
      placeholder.textContent = "Нет изображения";
      column.append(placeholder);
    } else {
      const image = el("img", "panel-asset", ownerDocument);
      image.draggable = false;
      image.src = panel.asset;
      image.alt = panel.subject + ". " + panel.role + ". " + panel.description;
      image.style.objectPosition = panel.position;
      image.style.transformOrigin = panel.align;
      image.style.transform = renditionTransform({
        zoom: panel.zoom,
        mirrored: panel.mirrored === true,
      });
      column.append(image);
    }
    strip.append(column);
  });

  if (!dialogue) {
    canvas.append(strip);
    return canvas;
  }

  const bar = el("div", "dialogue-bar", ownerDocument);
  bar.style.height = FRAME_GEOMETRY.dialogueBarHeight + "px";
  const fontSize = selectedFontSize(dialogue, split, frame.fontSize);

  panels.forEach((panel, index) => {
    const cell = el("div", "dialogue-cell", ownerDocument);
    cell.style.padding = split ? FRAME_GEOMETRY.splitPadding : FRAME_GEOMETRY.singlePadding;
    if (index > 0) cell.style.borderLeft = FRAME_GEOMETRY.panelGutter + "px solid " + FRAME_BG;
    if (index === frame.speakerPanel) {
      const text = el("p", "dialogue-text" + (frame.silent ? " silent" : ""), ownerDocument);
      text.style.fontSize = fontSize + "px";
      text.textContent = dialogue;
      cell.append(text);
    }
    bar.append(cell);
  });

  canvas.append(strip, bar);
  return canvas;
}

function pixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function measureDialogue(doc, frame, fontSize) {
  const host = doc.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = FRAME_GEOMETRY.width + "px";
  host.style.height = FRAME_GEOMETRY.height + "px";
  host.style.overflow = "hidden";
  host.style.pointerEvents = "none";
  host.style.setProperty("--frame-scale", "1");
  const canvas = render({ ...frame, fontSize }, { mode: "structure", document: doc });
  host.append(canvas);
  const parent = doc.body || doc.documentElement;
  parent.append(host);
  try {
    const text = host.querySelector(".dialogue-text");
    if (!text) return true;
    const cell = text.parentElement;
    const computed = doc.defaultView.getComputedStyle(cell);
    const contentWidth = Math.max(0, cell.clientWidth - pixels(computed.paddingLeft) - pixels(computed.paddingRight));
    const contentHeight = Math.max(0, cell.clientHeight - pixels(computed.paddingTop) - pixels(computed.paddingBottom));
    text.style.width = contentWidth + "px";
    text.style.maxHeight = contentHeight + "px";
    const overflows = text.scrollHeight > text.clientHeight || text.scrollWidth > text.clientWidth;
    // True means the spoken text fits in the speaker cell.
    return !overflows;
  } finally {
    host.remove();
  }
}

if (typeof window !== "undefined") {
  window.FrameRenderer = {
    width: FRAME_GEOMETRY.width,
    height: FRAME_GEOMETRY.height,
    dialogueBarHeight: FRAME_GEOMETRY.dialogueBarHeight,
    panelGutter: FRAME_GEOMETRY.panelGutter,
    render,
    measureDialogue,
    fontSizeFor,
    PLACEMENT_DEFAULTS,
    renditionTransform,
    panelContentSize,
    panByPointer,
  };
}
