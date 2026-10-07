const SAVE_DELAY_MS = 400;
const CONFLICT_TEXT = "Есть более новый сохранённый черновик.";

export function bindDraftAutosave({
  textarea,
  conflict,
  reloadButton,
  keepButton,
  fetchImpl = globalThis.fetch,
} = {}) {
  let token = null;
  let state = "boot";
  let sent = null;
  let timer = null;

  function showConflict(visible) {
    conflict.hidden = !visible;
    conflict.textContent = CONFLICT_TEXT;
    reloadButton.hidden = !visible;
    keepButton.hidden = !visible;
  }

  async function readProject() {
    const response = await fetchImpl("/api/project");
    return response.json();
  }

  async function putDraft(text) {
    const response = await fetchImpl("/api/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, revisionToken: token }),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, payload };
  }

  function enterConflict() {
    state = "conflict";
    showConflict(true);
  }

  async function saveLoop() {
    state = "saving";
    while (state === "saving") {
      const text = textarea.value;
      sent = text;
      const result = await putDraft(text);
      if (state !== "saving") return;
      if (result.status === 409 && result.payload?.kind === "stale-draft") {
        enterConflict();
        return;
      }
      if (result.status !== 200 || typeof result.payload?.revisionToken !== "string") {
        state = "idle";
        return;
      }
      token = result.payload.revisionToken;
      if (textarea.value !== sent) continue;
      state = "idle";
      return;
    }
  }

  function scheduleSave() {
    if (state !== "idle") return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (state === "idle") saveLoop();
    }, SAVE_DELAY_MS);
  }

  textarea.addEventListener("input", () => {
    if (state !== "idle") return;
    scheduleSave();
  });

  async function reloadStored() {
    const project = await readProject();
    textarea.value = project.draft.text;
    token = project.draft.revisionToken;
    state = "idle";
    showConflict(false);
  }

  async function keepLocal() {
    const visible = textarea.value;
    const project = await readProject();
    token = project.draft.revisionToken;
    const result = await putDraft(visible);
    if (result.status === 409 && result.payload?.kind === "stale-draft") {
      enterConflict();
      return;
    }
    if (result.status === 200 && typeof result.payload?.revisionToken === "string") {
      token = result.payload.revisionToken;
      state = "idle";
      showConflict(false);
    }
  }

  reloadButton.addEventListener("click", () => {
    reloadStored();
  });
  keepButton.addEventListener("click", () => {
    keepLocal();
  });

  const ready = (async () => {
    const project = await readProject();
    textarea.value = project.draft.text;
    token = project.draft.revisionToken;
    state = "idle";
    showConflict(false);
  })();

  return { ready };
}
