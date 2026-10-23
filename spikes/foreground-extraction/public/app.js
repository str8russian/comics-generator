import { buildOwnerReviewExport, buildStageA2OwnerReviewExport } from "/review.mjs";

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
      ["crop-matte-edge-contact.png", "Matte-like edge contact"],
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

function figureOrEmpty(src, caption) {
  if (!src) return `<figure class="missing"><figcaption>${escapeHtml(caption)} — not available</figcaption></figure>`;
  return figure(src, caption);
}

function renderStageA2() {
  document.title = "Stage A2 foreground extraction";
  document.querySelector(".eyebrow").textContent = "Spike A · Stage A2 · provider evaluation";
  const counts = { all: 0, "candidate-pass": 0, review: 0, reject: 0, failed: 0, unattempted: 0 };
  const flat = payload.identities.flatMap((identity) => identity.cells);
  for (const cell of flat) {
    counts.all += 1;
    if (cell.state === "succeeded") counts[cell.automaticStatus] += 1;
    else counts[cell.state] += 1;
  }
  summary.innerHTML = `
    <span class="pill">${counts.all} cells</span>
    <span class="pill">candidate-pass ${counts["candidate-pass"]}</span>
    <span class="pill">review ${counts.review}</span>
    <span class="pill">reject ${counts.reject}</span>
    <span class="pill">failed ${counts.failed}</span>
    <span class="pill">unattempted ${counts.unattempted}</span>
    <span class="pill">provider calls ${escapeHtml(payload.providerCalls)}</span>
    <span class="pill">stop ${escapeHtml(payload.stopReason || "none")}</span>
    <span class="pill">contract ${escapeHtml(payload.matteContract?.version)}</span>`;
  const filterNames = ["all", "candidate-pass", "review", "reject", "failed", "unattempted"];
  filters.innerHTML = filterNames.map((status) => `
    <button type="button" data-filter="${status}" aria-pressed="${filter === status}">${status}</button>`).join("");
  for (const button of filters.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      renderStageA2();
    });
  }
  items.innerHTML = payload.identities.map((identity) => {
    const visible = identity.cells.filter((cell) => {
      if (filter === "all") return true;
      if (filter === "failed" || filter === "unattempted") return cell.state === filter;
      return cell.state === "succeeded" && cell.automaticStatus === filter;
    });
    if (visible.length === 0) return "";
    return `<section class="identity">
      <h2>${escapeHtml(identity.characterName)}</h2>
      <p class="meta">Source sha256 ${escapeHtml(identity.sha256)}</p>
      <div class="source-photo">${figure(identity.sourceUrl, "Source photograph")}</div>
      ${visible.map((cell) => stageA2Cell(cell)).join("")}
    </section>`;
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

function stageA2Cell(cell) {
  const files = cell.files || {};
  const original = files["original.png"] || files["original.jpeg"] || files["original.webp"] || null;
  const stateLabel = cell.state === "succeeded" ? cell.automaticStatus : cell.state;
  const crops = [
    ["crop-hair.png", "Hair"],
    ["crop-ear-silhouette.png", "Ear / silhouette"],
    ["crop-shoulder-contact.png", "Shoulder / canvas contact"],
    ["crop-enclosed-pocket.png", "Enclosed pocket"],
    ["crop-contour-gap.png", "Contour"],
    ["crop-matte-edge-contact.png", "Matte-like edge contact"],
    ["crop-worst-boundary.png", "Worst boundary"],
  ];
  const banner = cell.state === "failed"
    ? `<p class="banner failed">Provider failed${cell.provider?.[0]?.kind ? `: ${escapeHtml(cell.provider.map((item) => item.kind || item.providerStatus || "failed").join(", "))}` : ""}. No usable foreground was stored.</p>`
    : cell.state === "unattempted"
      ? `<p class="banner unattempted">Unattempted: ${escapeHtml(cell.unattemptedReason || "not started")}.</p>`
      : cell.reviewRisk
        ? `<p class="banner review-risk">Upstream anchor remains automatic review. This cell stays review-risk and is not a candidate pass.</p>`
        : "";
  const judgement = cell.state === "succeeded"
    ? `<form class="judgement" data-id="${escapeHtml(cell.id)}">
        <div>
          ${["accept", "review", "reject"].map((value) => `
            <label><input type="radio" name="judgement-${escapeHtml(cell.id)}" value="${value}"> ${value}</label>`).join("")}
        </div>
        <textarea name="note" maxlength="500" placeholder="Short note"></textarea>
      </form>`
    : "";
  return `<article class="card" id="${escapeHtml(cell.id)}">
    <div class="card-head">
      <h2>${escapeHtml(cell.id)}</h2>
      <span class="status ${escapeHtml(stateLabel)}">${escapeHtml(stateLabel)}</span>
      <span class="pill">${escapeHtml(cell.cell)}</span>
    </div>
    ${banner}
    <p class="meta">Prompt contract ${escapeHtml(cell.contract?.contractVersion || payload.matteContract?.version)} · ${escapeHtml(cell.contract?.contractSha256 || payload.matteContract?.sha256)}</p>
    <p class="meta">Compiler ${escapeHtml(cell.contract?.compilerVersion || "n/a")} · roles ${escapeHtml((cell.contract?.roles || cell.request?.referenceRoles || []).join(", ") || "n/a")} · request ${escapeHtml(cell.request?.sha256 || "not prepared")}</p>
    <p class="meta">Model ${escapeHtml(cell.request?.model || payload.model || "n/a")} · timeout ${escapeHtml(cell.request?.timeoutMs ?? "n/a")} ms · body ${escapeHtml(cell.request?.originalBodyBytes ?? "n/a")} → ${escapeHtml(cell.request?.finalBodyBytes ?? "n/a")} · transform ${escapeHtml(cell.request?.transformStep || "n/a")}</p>
    <p class="meta">Reasons: ${escapeHtml(cell.reasons?.length ? cell.reasons.join(", ") : "none")}</p>
    <p class="meta">Warnings: ${escapeHtml(cell.warnings?.length ? cell.warnings.join(", ") : "none")}</p>
    <div class="pair panel-size">
      ${figureOrEmpty(original, "Original RGB output")}
      ${figureOrEmpty(files["composite-checkerboard.png"], "Extracted RGBA on checkerboard")}
    </div>
    <h3>Panel-size composites</h3>
    <div class="composites">
      ${figureOrEmpty(files["composite-black.png"], "Black")}
      ${figureOrEmpty(files["composite-white.png"], "White")}
      ${figureOrEmpty(files["composite-magenta.png"], "Magenta")}
      ${figureOrEmpty(files["composite-green.png"], "Green")}
      ${figureOrEmpty(files["composite-slate.png"], "System slate")}
    </div>
    <h3>Enlarged crops</h3>
    <div class="crops">
      ${crops.map(([name, label]) => figureOrEmpty(files[name], label)).join("")}
    </div>
    <div class="pair">
      ${figureOrEmpty(files["foreground.png"], "Foreground RGBA")}
      ${figureOrEmpty(files["alpha.png"], "Alpha")}
    </div>
    <p class="meta">Runtime: extract ${escapeHtml(cell.timing?.extractCoreMs)} ms · diagnostic artifacts ${escapeHtml(cell.timing?.diagnosticMs)} ms</p>
    ${judgement}
  </article>`;
}

document.querySelector("#download").addEventListener("click", () => {
  const exportPayload = payload.stage === "a2"
    ? buildStageA2OwnerReviewExport({
      runId: payload.runId,
      manifestHash: payload.manifestHash,
      items: payload.identities.flatMap((identity) => identity.cells.map((cell) => ({
        id: cell.id,
        identityId: cell.identityId,
        cell: cell.cell,
        attemptState: cell.state,
        automaticStatus: cell.state === "succeeded" ? cell.automaticStatus : null,
        reviewRisk: cell.reviewRisk === true,
        judgement: judgements.get(cell.id)?.judgement ?? null,
        note: judgements.get(cell.id)?.note ?? "",
      }))),
    })
    : buildOwnerReviewExport({
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
  if (payload.stage === "a2") renderStageA2();
  else render();
}
