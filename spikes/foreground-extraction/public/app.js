import { buildOwnerReviewExport } from "/review.mjs";

const judgements = new Map();
let payload = null;
let filter = "all";

const summary = document.querySelector("#summary");
const filters = document.querySelector("#filters");
const items = document.querySelector("#items");
const disclosure = document.querySelector("#disclosure");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function figure(src, caption) {
  if (!src) return "";
  return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function selectionText(item) {
  const selection = item.corpusSelection || {};
  if (item.corpus === "historical-hard-case") {
    return `Historical hard case. ${selection.selectionNote || ""} No style-corpus judgement is attached.`;
  }
  return `Corpus selection: style ${selection.ownerStyleJudgement}, identity ${selection.identity}, contour/tone ${selection.contourAndTonalComplexity}. ${selection.selectionNote || ""}`;
}

function metricList(item) {
  const metrics = item.metrics || {};
  const matte = metrics.matte?.rgb?.join(", ") || "n/a";
  const contacts = (metrics.edgeContacts || [])
    .filter((edge) => edge.totalPixels > 0)
    .map((edge) => `${edge.edge} ${edge.totalPixels}px/${edge.runCount} runs`)
    .join(", ") || "none";
  const pockets = (metrics.enclosedComponents || [])
    .map((pocket) => `${pocket.action} ${pocket.area}px @ ${pocket.centroid.x},${pocket.centroid.y}`)
    .join("; ") || "none";
  return `
    <ul class="mono">
      <li>matte rgb ${escapeHtml(matte)}; perimeter support ${escapeHtml(metrics.perimeterSupport)}</li>
      <li>foreground ${escapeHtml(metrics.foregroundArea)} / background ${escapeHtml(metrics.backgroundArea)}</li>
      <li>edge contact: ${escapeHtml(contacts)}</li>
      <li>enclosed: ${escapeHtml(pockets)}</li>
      <li>boundary ${escapeHtml(metrics.boundaryPixelCount)}; residual mean ${escapeHtml(metrics.decontamination?.residualMean)} max ${escapeHtml(metrics.decontamination?.residualMax)}</li>
      <li>alpha ${escapeHtml((metrics.alphaHistogram || []).map((bin) => `${bin.name}:${bin.count}`).join(" "))}</li>
    </ul>`;
}

function render() {
  const counts = { all: payload.items.length, "candidate-pass": 0, review: 0, reject: 0 };
  for (const item of payload.items) counts[item.status] += 1;
  summary.innerHTML = `
    <span class="pill">${counts.all} items</span>
    <span class="pill">candidate-pass ${counts["candidate-pass"]}</span>
    <span class="pill">review ${counts.review}</span>
    <span class="pill">reject ${counts.reject}</span>
    <span class="pill">extract max ${escapeHtml(payload.timing.extractCore.maxMs)} ms</span>
    <span class="pill">provider calls ${escapeHtml(payload.providerCalls)}</span>`;
  filters.innerHTML = ["all", "candidate-pass", "review", "reject"].map((status) => `
    <button type="button" data-filter="${status}" aria-pressed="${filter === status}">${status}</button>`).join("");
  for (const button of filters.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      render();
    });
  }
  const visible = payload.items.filter((item) => filter === "all" || item.status === filter);
  items.innerHTML = visible.map((item) => {
    const state = judgements.get(item.id) || { judgement: null, note: "" };
    const files = item.files || {};
    const crops = [
      ["crop-hair.png", "Hair"],
      ["crop-ear-silhouette.png", "Ear / silhouette"],
      ["crop-shoulder-contact.png", "Shoulder / canvas contact"],
      ["crop-enclosed-pocket.png", "Enclosed pocket"],
      ["crop-contour-gap.png", item.crops?.contourGap?.role === "leak-site" ? "Contour gap" : "Silhouette contour"],
      ["crop-worst-boundary.png", "Worst boundary"],
    ];
    return `<article class="card" id="${escapeHtml(item.id)}">
      <div class="card-head">
        <h2>${escapeHtml(item.id)}</h2>
        <span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
        <span class="pill">${escapeHtml(item.corpus)}</span>
        <span class="pill">${escapeHtml(item.extractionRole)}</span>
      </div>
      <p class="meta">${escapeHtml(selectionText(item))}</p>
      <p class="meta">Alias ${escapeHtml(item.alias)} · sha256 ${escapeHtml(item.sha256)} · ${escapeHtml(item.input?.width)}×${escapeHtml(item.input?.height)} · channels ${escapeHtml(item.input?.channels)} · alpha ${escapeHtml(item.input?.hasAlpha)}</p>
      <div class="pair">
        ${figure(files.original, "Original opaque output")}
        ${figure(files["composite-checkerboard.png"], "Extracted RGBA on checkerboard")}
      </div>
      <h3>Panel-size composites</h3>
      <div class="composites">
        ${figure(files["composite-black.png"], "Black")}
        ${figure(files["composite-white.png"], "White")}
        ${figure(files["composite-magenta.png"], "Magenta")}
        ${figure(files["composite-green.png"], "Green")}
        ${figure(files["composite-slate.png"], "System slate")}
      </div>
      <h3>Enlarged crops</h3>
      <div class="crops">
        ${crops.map(([name, label]) => figure(files[name], label)).join("")}
      </div>
      <h3>Alpha and boundary</h3>
      <div class="pair">
        ${figure(files["alpha.png"], "Alpha")}
        ${figure(files["boundary-overlay.png"], "Boundary overlay")}
      </div>
      <p class="meta">Reasons: ${escapeHtml(item.reasons?.length ? item.reasons.join(", ") : "none")}</p>
      <p class="meta">Warnings: ${escapeHtml(item.warnings?.length ? item.warnings.join(", ") : "none")}</p>
      <p class="meta">Runtime: extract ${escapeHtml(item.timing?.extractCoreMs)} ms · diagnostic artifacts ${escapeHtml(item.timing?.diagnosticMs)} ms</p>
      ${metricList(item)}
      <details>
        <summary>Thresholds and full metrics</summary>
        <pre class="mono">${escapeHtml(JSON.stringify({ thresholds: payload.thresholds, metrics: item.metrics }, null, 2))}</pre>
      </details>
      <form class="judgement" data-id="${escapeHtml(item.id)}">
        <div>
          ${["accept", "reject", "uncertain"].map((judgement) => `
            <label><input type="radio" name="judgement-${escapeHtml(item.id)}" value="${judgement}" ${state.judgement === judgement ? "checked" : ""}> ${judgement}</label>`).join("")}
        </div>
        <textarea name="note" maxlength="500" placeholder="Short note">${escapeHtml(state.note)}</textarea>
      </form>
    </article>`;
  }).join("");
  for (const form of items.querySelectorAll("form")) {
    const id = form.dataset.id;
    form.addEventListener("change", () => {
      const selected = form.querySelector("input:checked");
      judgements.set(id, {
        judgement: selected ? selected.value : null,
        note: form.note.value,
      });
    });
    form.note.addEventListener("input", () => {
      const current = judgements.get(id) || { judgement: null, note: "" };
      judgements.set(id, { ...current, note: form.note.value });
    });
  }
}

document.querySelector("#download").addEventListener("click", () => {
  const exportPayload = buildOwnerReviewExport({
    runId: payload.runId,
    manifestHash: payload.manifestHash,
    items: payload.items.map((item) => ({
      id: item.id,
      automaticStatus: item.status,
      judgement: judgements.get(item.id)?.judgement ?? null,
      note: judgements.get(item.id)?.note ?? "",
    })),
  });
  const blob = new Blob([`${JSON.stringify(exportPayload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${payload.runId}-owner-review.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

const response = await fetch("/api/run");
if (!response.ok) {
  disclosure.textContent = "The diagnostic run could not be loaded.";
} else {
  payload = await response.json();
  disclosure.textContent = payload.ownerReview.reloadLoss;
  render();
}
