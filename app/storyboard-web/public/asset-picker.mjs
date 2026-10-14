let active = null;

export const ASSET_PICKER_WIDTH = 600;
export const ASSET_PICKER_MARGIN = 8;

export function placeAssetPicker({
  anchor,
  popoverHeight = 320,
  viewport,
  obstacles = [],
} = {}) {
  const margin = ASSET_PICKER_MARGIN;
  const width = Math.min(ASSET_PICKER_WIDTH, Math.max(160, viewport.width - margin * 2));
  const height = Math.min(popoverHeight, Math.max(120, viewport.height - margin * 2));
  const spaceBelow = viewport.height - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  let placement = "below";
  let top = anchor.bottom + 6;
  if (spaceBelow < height && spaceAbove > spaceBelow) {
    placement = "above";
    top = anchor.top - 6 - height;
  }
  top = Math.max(margin, Math.min(top, viewport.height - height - margin));
  let left = anchor.left;
  left = Math.max(margin, Math.min(left, viewport.width - width - margin));
  let box = { top, left, width, height, placement };
  for (const obstacle of obstacles) {
    if (!obstacle || !intersects(box, obstacle)) continue;
    const shifted = box.top + obstacle.height + 8;
    const nextTop = Math.max(margin, Math.min(shifted, viewport.height - height - margin));
    if (nextTop !== box.top) box = { ...box, top: nextTop };
  }
  return box;
}

function intersects(box, obstacle) {
  return box.left < obstacle.left + obstacle.width
    && box.left + box.width > obstacle.left
    && box.top < obstacle.top + obstacle.height
    && box.top + box.height > obstacle.top;
}

export function anchorIntersectsViewport(rect, viewport) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
}

export function closeAssetPicker() {
  if (!active) return;
  const { popover, document, window, onKey, onPointer, onGeometry, anchor } = active;
  popover.remove?.();
  document?.removeEventListener?.("keydown", onKey);
  document?.removeEventListener?.("pointerdown", onPointer);
  window?.removeEventListener?.("scroll", onGeometry, true);
  window?.removeEventListener?.("resize", onGeometry);
  const restore = active.restoreFocus;
  active = null;
  if (restore && anchorConnected(anchor)) anchor.focus?.();
}

function anchorConnected(anchor) {
  if (!anchor) return false;
  if (anchor.isConnected === false) return false;
  return true;
}

function assetSummary(asset, current) {
  const provenance = asset?.provenance && typeof asset.provenance === "object" ? asset.provenance : null;
  const bits = [];
  const subject = asset?.subject || provenance?.subject || "";
  if (subject) bits.push(subject);
  if (asset?.sourceLabel) bits.push(asset.sourceLabel);
  else if (typeof asset?.provenance === "string" && asset.provenance) bits.push(asset.provenance);
  else if (provenance?.origin === "upload") bits.push("Загрузка");
  else if (provenance?.origin === "generation") bits.push("Генерация");
  if (current) bits.push("текущее");
  return bits.join(" · ") || (current ? "текущее" : "Изображение");
}

export function buildAssetPicker({
  assets = [],
  currentAssetId = null,
  onSelect,
  onUpload,
  document = globalThis.document,
} = {}) {
  const popover = document.createElement("div");
  popover.className = "asset-picker";
  if (typeof popover.setAttribute === "function") {
    popover.setAttribute("role", "group");
    popover.setAttribute("aria-label", "Выбрать изображение");
  }
  const upload = document.createElement("button");
  upload.type = "button";
  upload.className = "asset-picker-upload";
  upload.textContent = "Загрузить с диска…";
  upload.addEventListener("click", () => onUpload?.());
  const list = document.createElement("div");
  list.className = "asset-picker-list";
  for (const asset of assets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "asset-picker-item";
    if (asset.id === currentAssetId) button.className += " is-current";
    if (button.dataset) button.dataset.assetId = asset.id;
    else button.dataset = { assetId: asset.id };
    const image = document.createElement("img");
    image.className = "asset-picker-thumb";
    image.alt = "";
    image.src = asset.url || "";
    const meta = document.createElement("span");
    meta.className = "asset-picker-meta";
    meta.textContent = assetSummary(asset, asset.id === currentAssetId);
    button.append(image, meta);
    button.addEventListener("click", () => onSelect?.(asset));
    list.append(button);
  }
  popover.append(upload, list);
  return popover;
}

function viewportOf(window) {
  return {
    width: window?.innerWidth || 1280,
    height: window?.innerHeight || 800,
  };
}

function focusInitial(popover, currentAssetId) {
  const buttons = [...(popover.querySelectorAll?.("button") || [])];
  const current = buttons.find((button) => button.dataset?.assetId === currentAssetId);
  const firstAsset = buttons.find((button) => button.className?.includes("asset-picker-item"));
  const upload = buttons.find((button) => button.className?.includes("asset-picker-upload"));
  (current || firstAsset || upload)?.focus?.();
}

export function openAssetPicker(options = {}) {
  closeAssetPicker();
  const document = options.document || globalThis.document;
  const window = options.window || globalThis.window;
  const anchor = options.anchor;
  const popover = buildAssetPicker({
    ...options,
    document,
    onSelect: (asset) => {
      closeAssetPicker();
      options.onSelect?.(asset);
    },
    onUpload: () => {
      closeAssetPicker();
      options.onUpload?.();
    },
  });
  const applyPlace = () => {
    if (!anchorConnected(anchor) || !anchor?.getBoundingClientRect) {
      closeAssetPicker();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewport = viewportOf(window);
    if (!anchorIntersectsViewport(rect, viewport)) {
      closeAssetPicker();
      return;
    }
    const placed = placeAssetPicker({
      anchor: rect,
      popoverHeight: popover.offsetHeight || 320,
      viewport,
      obstacles: typeof options.obstacles === "function" ? options.obstacles() : (options.obstacles || []),
    });
    if (popover.style) {
      popover.style.position = "fixed";
      popover.style.top = `${placed.top}px`;
      popover.style.left = `${placed.left}px`;
      popover.style.width = `${placed.width}px`;
      popover.style.zIndex = "40";
    }
    popover.dataset.placement = placed.placement;
  };
  if (anchor?.getBoundingClientRect && popover.style) applyPlace();
  document.body?.append?.(popover);
  focusInitial(popover, options.currentAssetId);
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault?.();
      closeAssetPicker();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    const buttons = [...(popover.querySelectorAll?.("button") || [])];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? index + 1 : index - 1;
    if (buttons[next]) {
      event.preventDefault?.();
      buttons[next].focus?.();
    }
  };
  const onPointer = (event) => {
    const target = event.target;
    if (popover.contains?.(target)) return;
    if (target === anchor) return;
    closeAssetPicker();
  };
  const onGeometry = () => applyPlace();
  document.addEventListener?.("keydown", onKey);
  document.addEventListener?.("pointerdown", onPointer);
  window?.addEventListener?.("scroll", onGeometry, true);
  window?.addEventListener?.("resize", onGeometry);
  active = {
    popover,
    document,
    window,
    onKey,
    onPointer,
    onGeometry,
    anchor,
    restoreFocus: true,
  };
  return popover;
}
