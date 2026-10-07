const SAVE_DELAY_MS = 400;
const CONFLICT_TEXT = "Есть более новый сохранённый черновик.";

export function bindDraftAutosave({
  textarea,
  conflict,
  reloadButton,
  keepButton,
  fetchImpl = globalThis.fetch,
  onActivity,
} = {}) {
  let token = null;
  let state = "boot";
  let sent = null;
  let savedText = null;
  let timer = null;

  function notify() {
    if (typeof onActivity !== "function") return;
    onActivity({ state, savedText });
  }

  function showConflict(visible) {
    conflict.hidden = !visible;
    conflict.textContent = CONFLICT_TEXT;
    reloadButton.hidden = !visible;
    keepButton.hidden = !visible;
  }

  function setBusy(busy) {
    textarea.disabled = busy;
    reloadButton.disabled = busy;
    keepButton.disabled = busy;
  }

  function beginResolve() {
    if (state === "resolving") return false;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    state = "resolving";
    setBusy(true);
    return true;
  }

  function finishConflict() {
    state = "conflict";
    showConflict(true);
    setBusy(false);
    notify();
  }

  function finishIdle() {
    state = "idle";
    showConflict(false);
    setBusy(false);
    notify();
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
    finishConflict();
  }

  async function saveLoop() {
    state = "saving";
    notify();
    try {
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
          finishIdle();
          return;
        }
        token = result.payload.revisionToken;
        savedText = sent;
        notify();
        if (textarea.value !== sent) continue;
        finishIdle();
        return;
      }
    } catch {
      if (state === "saving") finishIdle();
    }
  }

  async function flush() {
    if (state === "boot") {
      try {
        await ready;
      } catch {
        return false;
      }
    }
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
      if (state === "idle" && textarea.value !== savedText) await saveLoop();
    }
    while (state === "saving" || state === "resolving") {
      await new Promise((resolve) => {
        setTimeout(resolve, 15);
      });
    }
    if (state === "idle" && textarea.value !== savedText) await saveLoop();
    return state === "idle" && textarea.value === savedText;
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

  function acceptedToken(payload) {
    return typeof payload?.revisionToken === "string" ? payload.revisionToken : null;
  }

  async function reloadStored() {
    if (!beginResolve()) return;
    try {
      const response = await fetchImpl("/api/project");
      const project = await response.json();
      const text = project?.draft?.text;
      const nextToken = project?.draft?.revisionToken;
      if (response.status !== 200 || typeof text !== "string" || typeof nextToken !== "string") {
        finishConflict();
        return;
      }
      textarea.value = text;
      token = nextToken;
      finishIdle();
    } catch {
      finishConflict();
    }
  }

  async function keepLocal() {
    if (!beginResolve()) return;
    const visible = textarea.value;
    try {
      const response = await fetchImpl("/api/project");
      const project = await response.json();
      const nextToken = project?.draft?.revisionToken;
      if (response.status !== 200 || typeof nextToken !== "string") {
        finishConflict();
        return;
      }
      token = nextToken;
      const result = await putDraft(visible);
      const savedToken = acceptedToken(result.payload);
      if (result.status === 200 && savedToken) {
        token = savedToken;
        finishIdle();
        return;
      }
      finishConflict();
    } catch {
      finishConflict();
    }
  }

  reloadButton.addEventListener("click", () => {
    reloadStored();
  });
  keepButton.addEventListener("click", () => {
    keepLocal();
  });

  const ready = (async () => {
    try {
      const project = await readProject();
      textarea.value = project.draft.text;
      token = project.draft.revisionToken;
      savedText = project.draft.text;
      finishIdle();
    } catch {
      finishConflict();
    }
  })();

  return { ready, flush };
}
