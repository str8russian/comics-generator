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

function hybridBackgroundUrl(frame) {
  return frame?.hybrid?.background?.asset
    || frame?.backgroundAsset
    || null;
}

function usesHybridVisualLayers(frame) {
  if (!frame) return false;
  const background = hybridBackgroundUrl(frame);
  if (!background) return false;
  const panels = frame.panels || [];
  return panels.length > 0 && panels.every((panel) => panel.characterAsset || panel.characterAssetId);
}

function characterLayerUrl(panel) {
  return panel.characterAsset
    || (panel.characterAssetId ? `/api/visual/assets/${panel.characterAssetId}` : null);
}

function placementPosition(panel) {
  if (panel.position) return panel.position;
  if (Number.isFinite(panel.positionX) && Number.isFinite(panel.positionY)) {
    return `${panel.positionX}% ${panel.positionY}%`;
  }
  return "50% 30%";
}

function placementAlign(panel) {
  if (panel.align) return panel.align;
  return placementPosition(panel);
}

export function render(frame, options) {
  const mode = options && options.mode === "structure" ? "structure" : "visual";
  const ownerDocument = (options && options.document) || document;
  const panels = frame.panels;
  const split = panels.length > 1;
  const hybridVisual = mode === "visual" && usesHybridVisualLayers(frame);
  const canvas = el("div", "frame-canvas mode-" + mode + (hybridVisual ? " hybrid-visual" : ""), ownerDocument);
  canvas.dataset.layout = frame.layout;
  canvas.dataset.mode = mode;
  const compositionMode = frame.compositionMode
    || frame.hybrid?.compositionMode
    || null;
  if (compositionMode) canvas.dataset.compositionMode = compositionMode;
  canvas.style.width = FRAME_GEOMETRY.width + "px";
  canvas.style.height = FRAME_GEOMETRY.height + "px";

  const strip = el("div", "panel-strip", ownerDocument);
  const dialogue = typeof frame.dialogue === "string" && frame.dialogue.trim() ? frame.dialogue : "";
  strip.style.bottom = dialogue ? (FRAME_GEOMETRY.dialogueBarHeight + "px") : "0";

  if (hybridVisual) {
    const background = el("img", "scene-background", ownerDocument);
    background.src = hybridBackgroundUrl(frame);
    background.alt = "";
    background.style.bottom = dialogue ? (FRAME_GEOMETRY.dialogueBarHeight + "px") : "0";
    canvas.append(background);
  }

  panels.forEach((panel, index) => {
    const column = el("section", "panel", ownerDocument);
    column.dataset.panelIndex = String(index);
    column.style.overflow = "hidden";
    if (index > 0) column.style.borderLeft = FRAME_GEOMETRY.panelGutter + "px solid " + FRAME_BG;
    if (mode === "structure") {
      const description = el("p", "panel-description", ownerDocument);
      description.textContent = panel.description || "";
      column.append(description);
    } else if (hybridVisual) {
      column.style.background = "transparent";
      const character = el("img", "character-layer", ownerDocument);
      character.src = characterLayerUrl(panel);
      character.alt = panel.subject + ". " + panel.role + ". " + panel.description;
      const position = placementPosition(panel);
      const align = placementAlign(panel);
      character.style.objectPosition = position;
      character.style.transformOrigin = align;
      character.style.transform = "scale(" + panel.zoom + ")";
      column.append(character);
    } else {
      const image = el("img", "panel-asset", ownerDocument);
      image.src = panel.asset;
      image.alt = panel.subject + ". " + panel.role + ". " + panel.description;
      image.style.objectPosition = panel.position;
      image.style.transformOrigin = panel.align;
      image.style.transform = "scale(" + panel.zoom + ")";
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
  };
}
