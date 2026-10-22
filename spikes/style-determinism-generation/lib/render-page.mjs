import {
  BLIND_NOTE,
  CONDITION_BY_CODE,
  DISPLAY_CODE_ORDER,
  JUDGEMENT_FIELDS,
  NO_WINNER_NOTE,
  REPETITIONS,
  SAME_IDENTITY_STATEMENT,
  SEED_NOTE,
  SOURCES,
} from "./constants.mjs";
import { ACCEPTED_STYLE_BLOCK, COMMON_CONSTRAINTS } from "./prompts.mjs";
import { categoricalCounts, judgementFieldsFor, judgementPassComplete } from "./judgements.mjs";

const SOURCE_LABELS = {
  "source-a": "Source photograph A",
  "source-b": "Source photograph B",
  "style-reference": "Experiment-only style reference",
};

export function buildReviewModel({ manifest, judgements, reveal = false }) {
  const pass = judgementPassComplete(manifest, judgements);
  const showNames = Boolean(reveal && pass.complete);
  const fields = judgementFieldsFor(manifest);
  return {
    manifest,
    judgements,
    fields,
    revealLocked: Boolean(reveal && !pass.complete),
    showNames,
    pass,
    counts: showNames ? categoricalCounts(manifest, judgements) : null,
    groups: reviewGroups(manifest),
  };
}

export function renderReviewPage(model) {
  const { manifest, judgements, showNames, revealLocked, pass, groups, fields } = model;
  const saved = judgements?.cells || {};
  const inputIds = ["source-a", "source-b"].concat(manifest.inputs?.["style-reference"] ? ["style-reference"] : []);
  const title = manifest.profile === "cross-identity" ? "Cross-identity prompt comparison" : "Base-anchor style comparison";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Style determinism generation review</title>
  <link rel="stylesheet" href="/review.css">
</head>
<body>
  <header class="page-header">
    <p class="eyebrow">${manifest.mode === "fake" ? "Fake-provider smoke" : "Live raw outputs"}</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="identity-banner">${escapeHtml(manifest.sameIdentityStatement || SAME_IDENTITY_STATEMENT)}</p>
    ${manifest.mode === "fake" ? `<p class="fake-banner">These images were produced by the local fake provider. No external provider request was made.</p>` : `<p class="live-banner">These are raw provider outputs. Nothing here was corrected, cropped, or recolored after generation.</p>`}
  </header>
  <main>
    <section>
      <h2>Inputs</h2>
      <div class="input-row${inputIds.length === 2 ? " is-pair" : ""}">
        ${inputIds.map((id) => renderInput(id, manifest)).join("")}
      </div>
    </section>
    <section>
      <h2>Call counts</h2>
      <dl class="counts">
        ${countItem("Planned cells", manifest.planned)}
        ${countItem("Provider invocations", manifest.providerInvocations ?? manifest.attempted)}
        ${countItem("Successful cells", manifest.succeeded)}
        ${countItem("Failed cells", manifest.failed)}
        ${countItem("Failed invocations", manifest.failedInvocations ?? manifest.failed)}
        ${countItem("Unattempted cells", manifest.unattempted)}
      </dl>
      <p>${escapeHtml(SEED_NOTE)} Model <code>${escapeHtml(manifest.model)}</code>. Aspect <code>${escapeHtml(manifest.aspectRatio)}</code>. Timeout ${Number(manifest.timeoutMs)} ms. Request budget ${Number(manifest.budgetBytes)} bytes. Strategy <code>${escapeHtml(manifest.strategy)}</code>.</p>
      ${manifest.stopReason ? `<p>Run stop: <code>${escapeHtml(manifest.stopReason)}</code>.</p>` : ""}
      <ol class="attempt-order">${attemptItems(manifest)}</ol>
    </section>
    <section>
      <h2>Accepted profile and rubric</h2>
      <pre class="profile">${escapeHtml(`${COMMON_CONSTRAINTS}\n\n${ACCEPTED_STYLE_BLOCK}`)}</pre>
      <p>For each successful output, record separate observations. Leave a field blank until you decide.</p>
      <ul>
        ${fields.map(([, label, options]) => `<li><strong>${escapeHtml(label)}:</strong> ${options.map((option) => escapeHtml(option)).join(", ")}</li>`).join("")}
      </ul>
      <p>Anatomy/artifact note is optional short text. ${escapeHtml(NO_WINNER_NOTE)}</p>
    </section>
    <section class="reveal-bar">
      <h2>Condition labels</h2>
      <p>${escapeHtml(BLIND_NOTE)} Reference roles stay visible because they are run evidence.</p>
      <p id="first-pass">First judgement pass: ${pass.judged} of ${pass.required} successful outputs have a complete categorical record.</p>
      <p id="reveal-lock" class="lock"${revealLocked ? "" : " hidden"}>Reveal stays closed until that first pass is complete.</p>
      <p id="reveal-action">${pass.complete ? `<a class="reveal-link" href="/?reveal=1">Reveal condition labels</a>` : `<span class="reveal-link is-locked">Reveal condition labels</span>`}</p>
      ${showNames ? renderCounts(model) : ""}
    </section>
    ${groups.map((group) => renderGroup(group, saved, showNames, manifest, fields)).join("")}
    <p><a href="/api/judgements.json">Download judgement JSON</a></p>
  </main>
  <script src="/review.js"></script>
</body>
</html>`;
}

function renderInput(id, manifest) {
  const input = manifest.inputs?.[id];
  const role = id === "style-reference"
    ? "Experiment-only style reference. Not a production-wide style authority."
    : manifest.sameIdentity === false
      ? "Identity reference for this person only. Not a style authority."
      : "Identity reference. Same person as the other source photograph.";
  return `<figure>
    <img src="/media/input/${escapeHtml(id)}" alt="${escapeHtml(SOURCE_LABELS[id])}">
    <figcaption>
      <strong>${escapeHtml(SOURCE_LABELS[id])}</strong>
      <span>${escapeHtml(role)}</span>
      <span>${escapeHtml(input?.mime || "")} ${Number(input?.width) || 0}×${Number(input?.height) || 0}</span>
      <code>${escapeHtml(input?.sha256 || "")}</code>
    </figcaption>
  </figure>`;
}

function renderGroup(group, saved, showNames, manifest, fields) {
  const sourceLabel = SOURCE_LABELS[group.sourceId];
  const identityLine = manifest.sameIdentity === false
    ? "Different person from the other source photograph."
    : "Same identity as the other source photograph.";
  return `<section>
    <h2>${escapeHtml(sourceLabel)}, repetition ${escapeHtml(group.repetition)}</h2>
    <p>${escapeHtml(identityLine)}</p>
    <div class="cell-row${group.cells.length === 2 ? " is-pair" : ""}">
      ${group.cells.map((cell) => cell ? renderCell(cell, saved[cell.publicId], showNames, fields) : `<article class="cell"><p>Not recorded</p></article>`).join("")}
    </div>
  </section>`;
}

function renderCell(cell, judgement, showNames, fields) {
  const label = showNames ? `${cell.blindCode} · ${cell.condition}` : cell.blindCode;
  const media = cell.status === "succeeded"
    ? `<div class="output-frame"><img src="/media/output/${escapeHtml(cell.publicId)}" alt="Raw output ${escapeHtml(cell.publicId)}"></div>
       <div class="crop-frame"><img src="/media/crop/${escapeHtml(cell.publicId)}" alt="Matched face crop ${escapeHtml(cell.publicId)}"></div>
       <p class="caption">Display-only matched face crop. The stored output is unchanged.</p>`
    : `<div class="failure-frame"><strong>${cell.status === "failed" ? "No output" : "Not attempted"}</strong><span>${escapeHtml(cell.failureKind || cell.skippedReason || cell.status)}</span>${renderAttemptList(cell)}</div>`;
  return `<article class="cell">
    <h3>${escapeHtml(label)}</h3>
    <p class="public-id">${escapeHtml(cell.publicId)}</p>
    ${media}
    <dl class="evidence">
      ${fact("Status", cell.status)}
      ${fact("Attempts", renderAttemptText(cell))}
      ${fact("Roles", (cell.referenceRoles || []).join(", ") || "—")}
      ${fact("Normalized references", formatRefs(cell.normalizedReferences))}
      ${fact("Request bytes", cell.requestBytes ?? "—")}
      ${fact("Request hash", cell.requestSha256 || "—")}
      ${fact("Prompt hash", cell.promptSha256)}
      ${fact("Output hash", cell.outputSha256 || "—")}
      ${fact("Latency ms", cell.latencyMs ?? "—")}
      ${fact("Model", cell.model || "—")}
      ${fact("Transform", cell.transformStep || "—")}
    </dl>
    ${showNames ? `<pre class="prompt-text">${escapeHtml(cell.promptText || "")}</pre>` : ""}
    ${cell.status === "succeeded" ? renderJudgement(cell, judgement, fields) : ""}
  </article>`;
}

function renderJudgement(cell, judgement = {}, fields = JUDGEMENT_FIELDS) {
  const controls = fields.map(([key, label, options]) => `<label>${escapeHtml(label)}
    <select name="${escapeHtml(key)}">
      <option value="">—</option>
      ${options.map((option) => `<option value="${escapeHtml(option)}"${judgement[key] === option ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
    </select>
  </label>`).join("");
  return `<form class="judgement" method="post" action="/api/judgements">
    <input type="hidden" name="publicId" value="${escapeHtml(cell.publicId)}">
    ${controls}
    <label>Anatomy/artifact note
      <textarea name="anatomyNote" maxlength="400" rows="3">${escapeHtml(judgement.anatomyNote || "")}</textarea>
    </label>
    <button type="submit">Save judgement</button>
    <p class="save-status" data-state="clean"></p>
  </form>`;
}

function invocationRecords(cell) {
  if (Array.isArray(cell.invocations) && cell.invocations.length) return cell.invocations;
  if (cell.attemptNumber == null && cell.status === "unattempted") return [];
  return [{
    attemptNumber: cell.attemptNumber,
    status: cell.status,
    failureKind: cell.failureKind,
  }];
}

function renderAttemptList(cell) {
  const records = invocationRecords(cell);
  if (!records.length) return `<span>Attempt —</span>`;
  return `<ul class="attempts">${records.map((item) => `<li>Attempt ${item.attemptNumber ?? "—"} · ${escapeHtml(item.status)}${item.failureKind ? ` · ${escapeHtml(item.failureKind)}` : ""}</li>`).join("")}</ul>`;
}

function renderAttemptText(cell) {
  const records = invocationRecords(cell);
  if (!records.length) return "—";
  return records.map((item) => `${item.attemptNumber ?? "—"} ${item.status}${item.failureKind ? ` ${item.failureKind}` : ""}`).join("; ");
}

function renderCounts(model) {
  const counts = model.counts || {};
  const fields = model.fields || JUDGEMENT_FIELDS;
  const order = model.manifest.displayCodeOrder || DISPLAY_CODE_ORDER;
  const byCode = model.manifest.conditionByCode || CONDITION_BY_CODE;
  const header = fields.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const rows = order.map((code) => {
    const condition = byCode[code];
    const bucket = counts[condition] || {};
    const cells = fields.map(([key, , options]) => {
      const parts = options.map((option) => `${option}: ${bucket[key]?.[option] || 0}`);
      return `<td>${escapeHtml(parts.join("; "))}</td>`;
    }).join("");
    return `<tr><th>${escapeHtml(code)} · ${escapeHtml(condition)}</th>${cells}</tr>`;
  }).join("");
  return `<h3>Categorical counts</h3><p>${escapeHtml(NO_WINNER_NOTE)}</p><table><thead><tr><th>Setting</th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function attemptItems(manifest) {
  return (manifest.attemptOrder || []).map((id) => {
    const cell = (manifest.cells || []).find((item) => item.id === id);
    return `<li>${escapeHtml(cell?.publicId || "pending")} · ${escapeHtml(cell?.status || "pending")}</li>`;
  }).join("");
}

function formatRefs(references = []) {
  if (!references.length) return "—";
  return references.map((ref) => `${ref.role} ${ref.width}×${ref.height} ${ref.byteLength} bytes`).join("; ");
}

function countItem(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${Number(value) || 0}</dd></div>`;
}

function fact(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function reviewGroups(manifest) {
  const cells = manifest.cells || [];
  const order = manifest.displayCodeOrder || DISPLAY_CODE_ORDER;
  const groups = [];
  for (const sourceId of SOURCES) {
    for (const repetition of REPETITIONS) {
      groups.push({
        sourceId,
        repetition,
        cells: order.map((blindCode) => cells.find((cell) => cell.sourceId === sourceId && cell.repetition === repetition && cell.blindCode === blindCode) || null),
      });
    }
  }
  return groups;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character]));
}
