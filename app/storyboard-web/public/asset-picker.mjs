let active = null;

export function closeAssetPicker() {
  if (!active) return;
  active.popover.remove?.();
  active.document?.removeEventListener?.("keydown", active.onKey);
  active.document?.removeEventListener?.("pointerdown", active.onPointer);
  active = null;
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
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Выбрать изображение");
  }
  const list = document.createElement("div");
  list.className = "asset-picker-list";
  for (const asset of assets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "asset-picker-item";
    if (asset.id === currentAssetId) button.className += " is-current";
    const image = document.createElement("img");
    image.className = "asset-picker-thumb";
    image.alt = "";
    image.src = asset.url || "";
    const meta = document.createElement("span");
    meta.className = "asset-picker-meta";
    const kind = asset.kind === "uploaded-image" ? "Загрузка" : "Кадр";
    const size = `${asset.width || "?"}×${asset.height || "?"}`;
    const where = asset.provenance ? ` · ${asset.provenance}` : "";
    meta.textContent = `${kind} ${size}${where}`;
    if (asset.id === currentAssetId) meta.textContent += " · текущее";
    button.append(image, meta);
    button.addEventListener("click", () => onSelect?.(asset));
    list.append(button);
  }
  const upload = document.createElement("button");
  upload.type = "button";
  upload.className = "asset-picker-upload";
  upload.textContent = "Загрузить с диска…";
  upload.addEventListener("click", () => onUpload?.());
  popover.append(list, upload);
  return popover;
}

export function openAssetPicker(options = {}) {
  closeAssetPicker();
  const document = options.document || globalThis.document;
  const popover = buildAssetPicker({ ...options, document });
  const anchor = options.anchor;
  if (anchor?.getBoundingClientRect && popover.style) {
    const rect = anchor.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.max(8, rect.left)}px`;
    popover.style.zIndex = "40";
  }
  document.body?.append?.(popover);
  const onKey = (event) => {
    if (event.key === "Escape") closeAssetPicker();
  };
  const onPointer = (event) => {
    const target = event.target;
    if (popover.contains && popover.contains(target)) return;
    if (target === anchor) return;
    closeAssetPicker();
  };
  document.addEventListener?.("keydown", onKey);
  document.addEventListener?.("pointerdown", onPointer);
  popover.focus?.();
  active = { popover, document, onKey, onPointer };
  return popover;
}
