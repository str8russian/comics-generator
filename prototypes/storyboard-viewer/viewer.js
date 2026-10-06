import "./frame-renderer.mjs";
(function () {
  var data = window.STORYBOARD_DATA;
  var frames = data.frames;
  var GRID_SCALE = 0.2;
  var DETAIL_SCALE = 0.5;
  var reviewMode = "visual";
  var metadataOn = false;
  var activeIndex = -1;
  var trigger = null;
  var hashWasPushed = false;

  document.title = data.documentTitle;
  var description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", data.description);
  document.querySelector("#story-title").textContent = data.title;

  var summary = document.querySelector("#story-summary");
  summary.textContent = "";
  data.summary.forEach(function (item) {
    var span = document.createElement("span");
    var strong = document.createElement("strong");
    strong.textContent = String(item.value);
    span.append(strong, " " + item.label);
    summary.append(span);
  });

  var grid = document.querySelector("#storyboard");
  var dialog = document.querySelector("#detail");
  var detailHost = document.querySelector("#detail-frame");
  var closeButton = document.querySelector("#close-detail");
  var prevButton = document.querySelector("#prev-frame");
  var nextButton = document.querySelector("#next-frame");

  function layoutLabel(layout) {
    return layout === "split2" ? "2 панели" : "1 панель";
  }

  function layoutDetail(layout) {
    return layout === "split2" ? "Две панели · сплит-экран" : "Одна панель";
  }

  function assetName(asset) {
    var parts = String(asset).split("/");
    return parts[parts.length - 1] || String(asset);
  }

  function stateId(asset) {
    var name = assetName(asset);
    var dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function stageFor(host, scale) {
    var stage = host.firstElementChild;
    if (!stage || !stage.classList.contains("frame-stage")) {
      stage = document.createElement("div");
      stage.className = "frame-stage";
      stage.style.width = (window.FrameRenderer.width * scale) + "px";
      stage.style.height = (window.FrameRenderer.height * scale) + "px";
      stage.style.setProperty("--frame-scale", String(scale));
      host.textContent = "";
      host.append(stage);
    }
    return stage;
  }

  function showFrame(host, frame, scale) {
    var stage = stageFor(host, scale);
    var canvas = window.FrameRenderer.render(frame, { mode: reviewMode });
    var previous = stage.firstElementChild;
    if (previous && previous.classList.contains("frame-canvas")) previous.replaceWith(canvas);
    else stage.append(canvas);
  }

  function syncControls() {
    document.body.classList.toggle("review-structure", reviewMode === "structure");
    document.body.classList.toggle("review-visual", reviewMode === "visual");
    document.body.classList.toggle("show-metadata", metadataOn);
    document.querySelectorAll("[data-mode]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === reviewMode));
    });
    document.querySelectorAll("[data-metadata-toggle]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(metadataOn));
    });
  }

  function repaintFrames() {
    grid.querySelectorAll(".frame-card").forEach(function (card) {
      showFrame(card.querySelector(".frame-host"), frames[Number(card.dataset.index)], GRID_SCALE);
    });
    if (dialog.open && activeIndex >= 0) showFrame(detailHost, frames[activeIndex], DETAIL_SCALE);
  }

  function setMetadata(on) {
    metadataOn = Boolean(on);
    syncControls();
  }

  function setMode(next) {
    var mode = next === "structure" ? "structure" : "visual";
    var changed = mode !== reviewMode;
    reviewMode = mode;
    metadataOn = mode === "structure";
    syncControls();
    if (changed) repaintFrames();
  }

  function panelMeta(panel) {
    var block = document.createElement("div");
    block.className = "panel-meta";
    var title = document.createElement("p");
    title.className = "panel-meta-title";
    title.textContent = panel.subject + " · " + panel.role + " · " + panel.shot;
    var state = document.createElement("p");
    state.className = "state-id";
    state.textContent = stateId(panel.asset);
    var file = document.createElement("p");
    file.className = "file-name";
    file.textContent = assetName(panel.asset);
    block.append(title, state, file);
    return block;
  }

  function renderGrid() {
    var frameWidth = window.FrameRenderer.width * GRID_SCALE;
    grid.textContent = "";
    frames.forEach(function (frame, index) {
      var card = document.createElement("button");
      card.className = "frame-card";
      card.type = "button";
      card.dataset.index = String(index);
      card.style.width = frameWidth + "px";
      card.setAttribute("aria-label", "Открыть " + frame.id + ": " + frame.speaker);

      var top = document.createElement("div");
      top.className = "card-topline";
      var frameNo = document.createElement("span");
      frameNo.className = "frame-no";
      frameNo.textContent = frame.id;
      var speaker = document.createElement("span");
      speaker.className = "speaker-tag";
      speaker.textContent = frame.speaker;
      var layout = document.createElement("span");
      layout.className = "layout-tag";
      layout.textContent = layoutLabel(frame.layout);
      top.append(frameNo, speaker, layout);

      var host = document.createElement("div");
      host.className = "frame-host";
      showFrame(host, frame, GRID_SCALE);

      var meta = document.createElement("div");
      meta.className = "card-meta diagnostic";
      var provenance = document.createElement("span");
      provenance.className = "provenance" + (frame.derived ? " derived" : "");
      provenance.textContent = frame.provenance;
      var note = document.createElement("p");
      note.className = "card-note";
      note.textContent = frame.note;
      meta.append(provenance, note);
      frame.panels.forEach(function (panel) { meta.append(panelMeta(panel)); });

      card.append(top, host, meta);
      grid.append(card);
    });
  }

  function renderDetail(index) {
    var frame = frames[index];
    activeIndex = index;
    document.querySelector("#detail-title").textContent = "Кадр " + String(index + 1).padStart(2, "0") + " · " + frame.speaker;
    showFrame(detailHost, frame, DETAIL_SCALE);
    document.querySelector("#detail-note").textContent = frame.note;
    document.querySelector("#detail-type").textContent = frame.type;
    document.querySelector("#detail-layout-meta").textContent = layoutDetail(frame.layout);
    document.querySelector("#detail-source").textContent = frame.source;
    document.querySelector("#detail-provenance").textContent = frame.provenance;
    document.querySelector("#detail-position").textContent = (index + 1) + " / " + frames.length;
    var panels = document.querySelector("#detail-panels");
    panels.textContent = "";
    frame.panels.forEach(function (panel) { panels.append(panelMeta(panel)); });
    prevButton.disabled = index === 0;
    nextButton.disabled = index === frames.length - 1;
  }

  function openDetail(index, updateHash) {
    if (updateHash === undefined) updateHash = true;
    trigger = document.activeElement;
    renderDetail(index);
    if (!dialog.open) dialog.showModal();
    if (updateHash && location.hash !== "#" + frames[index].id) {
      history.pushState({ frame: index }, "", "#" + frames[index].id);
      hashWasPushed = true;
    }
  }

  function closeDetail(fromHistory) {
    if (!dialog.open) return;
    dialog.close();
    activeIndex = -1;
    if (!fromHistory && hashWasPushed && location.hash) history.back();
    else if (!fromHistory && location.hash) history.replaceState(null, "", location.pathname + location.search);
    hashWasPushed = false;
    if (trigger instanceof HTMLElement) trigger.focus();
  }

  function navigate(delta) {
    var nextIndex = Math.max(0, Math.min(frames.length - 1, activeIndex + delta));
    if (nextIndex === activeIndex) return;
    renderDetail(nextIndex);
    history.replaceState({ frame: nextIndex }, "", "#" + frames[nextIndex].id);
  }

  function indexFromHash() {
    if (!location.hash || location.hash === "#") return -1;
    var id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch (error) { return -1; }
    return frames.findIndex(function (frame) { return frame.id === id; });
  }

  renderGrid();
  syncControls();

  document.querySelectorAll("[data-mode]").forEach(function (button) {
    button.addEventListener("click", function () { setMode(button.dataset.mode); });
  });
  document.querySelectorAll("[data-metadata-toggle]").forEach(function (button) {
    button.addEventListener("click", function () { setMetadata(!metadataOn); });
  });

  grid.addEventListener("click", function (event) {
    var card = event.target.closest(".frame-card");
    if (card) openDetail(Number(card.dataset.index));
  });

  closeButton.addEventListener("click", function () { closeDetail(false); });
  prevButton.addEventListener("click", function () { if (activeIndex > 0) navigate(-1); });
  nextButton.addEventListener("click", function () { if (activeIndex < frames.length - 1) navigate(1); });

  dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    closeDetail(false);
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) closeDetail(false);
  });
  document.addEventListener("keydown", function (event) {
    if (!dialog.open) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
  });
  window.addEventListener("popstate", function () {
    var index = indexFromHash();
    if (index >= 0) openDetail(index, false);
    else closeDetail(true);
  });

  var initialIndex = indexFromHash();
  if (initialIndex >= 0) openDetail(initialIndex, false);
})();
