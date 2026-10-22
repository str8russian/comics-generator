const forms = [...document.querySelectorAll("form.judgement")];

function formValues(form) {
  return JSON.stringify(Object.fromEntries(new FormData(form)));
}

function statusNode(form) {
  let node = form.querySelector(".save-status");
  if (!node) {
    node = document.createElement("p");
    node.className = "save-status";
    form.append(node);
  }
  return node;
}

function hasSavedContent(form) {
  const data = Object.fromEntries(new FormData(form));
  return Object.entries(data).some(([key, value]) => key !== "publicId" && String(value || "").trim() !== "");
}

function markSaved(form) {
  form.dataset.saved = "1";
  form.classList.add("is-saved");
  form.classList.remove("is-unsaved");
  const status = statusNode(form);
  status.dataset.state = "saved";
  status.textContent = "Saved";
}

function markUnsaved(form) {
  form.classList.add("is-unsaved");
  form.classList.remove("is-saved");
  const status = statusNode(form);
  status.dataset.state = "unsaved";
  status.textContent = "Unsaved changes";
}

function markError(form) {
  const status = statusNode(form);
  status.dataset.state = "error";
  status.textContent = "Save failed. Your entries are still here. Try again.";
}

function refreshDirty(form) {
  if (formValues(form) !== baselines.get(form)) markUnsaved(form);
  else if (form.dataset.saved === "1") markSaved(form);
  else {
    form.classList.remove("is-unsaved", "is-saved");
    const status = statusNode(form);
    status.dataset.state = "clean";
    status.textContent = "";
  }
}

function updatePass(data) {
  const pass = document.querySelector("#first-pass");
  if (pass && Number.isInteger(data.judged) && Number.isInteger(data.required)) {
    pass.textContent = `First judgement pass: ${data.judged} of ${data.required} successful outputs have a complete categorical record.`;
  }
  if (!data.complete) return;
  const reveal = document.querySelector("#reveal-action");
  if (!reveal) return;
  reveal.textContent = "";
  const link = document.createElement("a");
  link.className = "reveal-link";
  link.href = "/?reveal=1";
  link.textContent = "Reveal condition labels";
  reveal.append(link);
  const lock = document.querySelector("#reveal-lock");
  if (lock) lock.hidden = true;
}

const baselines = new Map(forms.map((form) => [form, formValues(form)]));

for (const form of forms) {
  if (hasSavedContent(form)) markSaved(form);
  form.addEventListener("input", () => refreshDirty(form));
  form.addEventListener("change", () => refreshDirty(form));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const response = await fetch("/api/judgements", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("save failed");
      const data = await response.json();
      if (!data?.ok) throw new Error("save failed");
      baselines.set(form, formValues(form));
      markSaved(form);
      updatePass(data);
      button.disabled = false;
    } catch {
      button.disabled = false;
      markError(form);
    }
  });
}

window.addEventListener("beforeunload", (event) => {
  const dirty = forms.some((form) => formValues(form) !== baselines.get(form));
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
