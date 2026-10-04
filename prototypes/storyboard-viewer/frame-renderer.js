// Canonical 1920×1080 video frame. Grid, detail, and a future projection all use render().
(function () {
  var WIDTH = 1920;
  var HEIGHT = 1080;
  var DIALOGUE_BAR_HEIGHT = 300;
  var PANEL_GUTTER = 48;
  var FRAME_BG = "#02090b";

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function fontSizeFor(text, split) {
    var length = text.length;
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

  function render(frame, options) {
    var mode = options && options.mode === "structure" ? "structure" : "visual";
    var panels = frame.panels;
    var split = panels.length > 1;
    var canvas = el("div", "frame-canvas mode-" + mode);
    canvas.dataset.layout = frame.layout;
    canvas.dataset.mode = mode;
    canvas.style.width = WIDTH + "px";
    canvas.style.height = HEIGHT + "px";

    var strip = el("div", "panel-strip");
    var dialogue = typeof frame.dialogue === "string" && frame.dialogue.trim() ? frame.dialogue : "";
    strip.style.bottom = dialogue ? (DIALOGUE_BAR_HEIGHT + "px") : "0";

    panels.forEach(function (panel, index) {
      var column = el("section", "panel");
      column.dataset.panelIndex = String(index);
      if (index > 0) column.style.borderLeft = PANEL_GUTTER + "px solid " + FRAME_BG;
      if (mode === "structure") {
        var description = el("p", "panel-description");
        description.textContent = panel.description || "";
        column.append(description);
      } else {
        var image = el("img", "panel-asset");
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

    var bar = el("div", "dialogue-bar");
    bar.style.height = DIALOGUE_BAR_HEIGHT + "px";
    var fontSize = fontSizeFor(dialogue, split);

    panels.forEach(function (panel, index) {
      var cell = el("div", "dialogue-cell");
      cell.style.padding = split ? "34px 44px 24px" : "38px 70px 26px";
      if (index > 0) cell.style.borderLeft = PANEL_GUTTER + "px solid " + FRAME_BG;
      if (index === frame.speakerPanel) {
        var text = el("p", "dialogue-text" + (frame.silent ? " silent" : ""));
        text.style.fontSize = fontSize + "px";
        text.textContent = dialogue;
        cell.append(text);
      }
      bar.append(cell);
    });

    canvas.append(strip, bar);
    return canvas;
  }

  window.FrameRenderer = {
    width: WIDTH,
    height: HEIGHT,
    dialogueBarHeight: DIALOGUE_BAR_HEIGHT,
    panelGutter: PANEL_GUTTER,
    render: render
  };
})();
