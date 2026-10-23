export const STAGES = Object.freeze([
  Object.freeze({ id: "story", label: "История" }),
  Object.freeze({ id: "storyboard", label: "Раскадровка" }),
  Object.freeze({ id: "characters", label: "Персонажи" }),
  Object.freeze({ id: "visual", label: "Визуал" }),
  Object.freeze({ id: "video", label: "Видео" }),
]);

const STAGE_IDS = new Set(STAGES.map((stage) => stage.id));
const HASH_PREFIX = "#stage=";
const FRAME_STAGES = new Set(["storyboard", "visual"]);

export function stageFromHash(hash) {
  if (typeof hash !== "string" || !hash.startsWith(HASH_PREFIX)) return null;
  const id = hash.slice(HASH_PREFIX.length);
  return STAGE_IDS.has(id) ? id : null;
}

export function stageHash(id) {
  return `${HASH_PREFIX}${id}`;
}

export function framesLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  let noun = "кадров";
  if (mod10 === 1 && mod100 !== 11) noun = "кадр";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) noun = "кадра";
  return `${count} ${noun}`;
}

function locked(reason, next) {
  return { status: "Заблокировано", tone: "locked", locked: true, lockReason: reason, next };
}

function storyStage({ draftText, review, visual, frames }) {
  if (review === "material" || visual) {
    return {
      status: "Подтверждено",
      tone: "done",
      locked: false,
      next: frames.length
        ? { label: "Перейти к раскадровке", goto: "storyboard" }
        : { label: "Собрать раскадровку", focus: "stage-material" },
    };
  }
  if (review === "reading") {
    return { status: "Нужно подтвердить", tone: "todo", locked: false, next: { label: "Подтвердить разбор", focus: "confirm-material" } };
  }
  if (String(draftText || "").trim()) {
    return { status: "Черновик", tone: "todo", locked: false, next: { label: "Разобрать черновик", focus: "read-draft" } };
  }
  return { status: "Нет черновика", tone: "todo", locked: false, next: { label: "Вставьте черновик диалога", focus: "draft" } };
}

function storyboardStage({ frames, visual, storyboardFailed }) {
  if (!frames.length) {
    const stage = locked("Сначала подтвердите разбор в «Истории» и соберите раскадровку.", { label: "Перейти к истории", goto: "story" });
    if (storyboardFailed) stage.status = "Ошибка сборки";
    return stage;
  }
  let next = null;
  if (visual?.allAnchorsApproved) next = { label: "Перейти к визуалу", goto: "visual" };
  else if (visual) next = { label: "Перейти к персонажам", goto: "characters" };
  return { status: framesLabel(frames.length), tone: "done", locked: false, next };
}

function charactersStage({ visual, frames }) {
  if (!visual) {
    return locked(
      "Персонажи появятся после сборки раскадровки.",
      frames.length ? { label: "Перейти к раскадровке", goto: "storyboard" } : { label: "Перейти к истории", goto: "story" },
    );
  }
  const characters = Array.isArray(visual.characters) ? visual.characters : [];
  if (!characters.length) return { status: "Нет персонажей", tone: "todo", locked: false, next: null };
  const approved = characters.filter((character) => character?.approvedAnchorId).length;
  const missing = characters.find((character) => !character?.approvedAnchorId);
  return {
    status: `${approved}/${characters.length} утверждены`,
    tone: missing ? "todo" : "done",
    locked: false,
    next: missing
      ? { label: `Нужен базовый образ: ${missing.name}`, focus: "character-cards" }
      : { label: "Перейти к визуалу", goto: "visual" },
  };
}

function visualNext(frames) {
  const generatable = frames.findIndex((frame) => (
    !frame.visualReady && frame.frameKind !== "text" && frame.frameKind !== "image"
  ));
  if (generatable >= 0) {
    return { label: `Создать изображения кадра ${generatable + 1}`, action: "generate-frame", frameIndex: generatable };
  }
  const manual = frames.findIndex((frame) => !frame.visualReady);
  if (manual >= 0) return { label: `Открыть кадр ${manual + 1}`, action: "open-frame", frameIndex: manual };
  return null;
}

function visualStage({ visual, frames }) {
  if (!visual) {
    return locked(
      "Визуальная раскадровка появится после сборки раскадровки.",
      frames.length ? { label: "Перейти к раскадровке", goto: "storyboard" } : { label: "Перейти к истории", goto: "story" },
    );
  }
  if (visual.readyForVideo) {
    return { status: "Утверждено", tone: "done", locked: false, next: { label: "Перейти к видео", goto: "video" } };
  }
  if (visual.complete) {
    return {
      status: "Нужно утвердить",
      tone: "gate",
      locked: false,
      next: { label: "Утвердить визуальную раскадровку", focus: "approve-visual" },
    };
  }
  if (!visual.allAnchorsApproved) {
    return {
      status: "Нужны базовые образы",
      tone: "locked",
      locked: true,
      lockReason: "Сначала утвердите базовый образ каждого персонажа. Назначить готовое изображение можно и сейчас.",
      next: { label: "Перейти к персонажам", goto: "characters" },
    };
  }
  const all = Array.isArray(visual.frames) ? visual.frames : [];
  const ready = all.filter((frame) => frame?.visualReady).length;
  return {
    status: `${ready}/${all.length} готовы`,
    tone: "todo",
    locked: false,
    next: visualNext(frames),
  };
}

const RENDER_STATUS = {
  running: "Сборка идёт",
  success: "Видео готово",
  failure: "Сборка не удалась",
};

function videoStage({ visual, frames, render }) {
  if (!visual) {
    return locked(
      "Видео собирается из готовой раскадровки.",
      frames.length ? { label: "Перейти к раскадровке", goto: "storyboard" } : { label: "Перейти к истории", goto: "story" },
    );
  }
  const status = RENDER_STATUS[render?.status]
    || (visual.readyForVideo ? "Готово к сборке" : "Визуал не утверждён");
  return {
    status,
    tone: visual.readyForVideo ? "todo" : "gate",
    locked: false,
    note: visual.readyForVideo ? null : "Визуальная раскадровка ещё не утверждена: обязательная проверка находится в «Визуале».",
    next: { label: "Собрать видео", focus: "start-render" },
  };
}

function normalizeFacts(facts = {}) {
  return {
    draftText: typeof facts.draftText === "string" ? facts.draftText : "",
    review: facts.review === "reading" || facts.review === "material" ? facts.review : null,
    storyboardFailed: Boolean(facts.storyboardFailed),
    frames: Array.isArray(facts.frames) ? facts.frames : [],
    visual: facts.visual && typeof facts.visual === "object" ? facts.visual : null,
    render: facts.render && typeof facts.render === "object" ? facts.render : null,
  };
}

export function deriveStages(facts) {
  const normalized = normalizeFacts(facts);
  const derived = {
    story: storyStage(normalized),
    storyboard: storyboardStage(normalized),
    characters: charactersStage(normalized),
    visual: visualStage(normalized),
    video: videoStage(normalized),
  };
  for (const stage of STAGES) Object.assign(derived[stage.id], { id: stage.id, label: stage.label });
  return derived;
}

export function defaultStage(facts) {
  const { visual, frames } = normalizeFacts(facts);
  if (visual?.readyForVideo) return "video";
  if (visual?.complete || visual?.allAnchorsApproved) return "visual";
  if (visual && Array.isArray(visual.characters) && visual.characters.length) return "characters";
  if (frames.length) return "storyboard";
  return "story";
}

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function bindWorkspaceStages({
  nav,
  views = {},
  framesArea = null,
  headers = {},
  getFacts,
  onAction = null,
  document = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
}) {
  let current = stageFromHash(location?.hash) || "story";
  let explicit = Boolean(stageFromHash(location?.hash));
  let settled = false;
  let derived = deriveStages({});

  function focusTarget(id) {
    const target = document.querySelector(`#${id}`);
    if (!target) return;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.focus?.();
  }

  function runNext(next, button) {
    if (!next) return;
    if (next.goto) select(next.goto);
    else if (next.focus) focusTarget(next.focus);
    else if (next.action) onAction?.(next, button);
  }

  function renderNav() {
    if (!nav) return;
    nav.replaceChildren();
    STAGES.forEach((stage, index) => {
      const info = derived[stage.id];
      if (index > 0) {
        const arrow = element(document, "span", "stage-arrow", "→");
        arrow.setAttribute?.("aria-hidden", "true");
        nav.append(arrow);
      }
      const button = element(document, "button", settled ? `stage-tab tone-${info.tone}` : "stage-tab");
      button.type = "button";
      button.dataset.stage = stage.id;
      if (stage.id === current) button.setAttribute?.("aria-current", "step");
      button.append(
        element(document, "span", "stage-name", stage.label),
        element(document, "span", "stage-chip", settled ? info.status : "…"),
      );
      button.addEventListener("click", () => select(stage.id, { persist: true }));
      nav.append(button);
    });
  }

  function renderHeader(id) {
    const host = headers[id];
    if (!host) return;
    const info = derived[id];
    host.replaceChildren();
    if (!settled) {
      host.append(element(document, "h2", "stage-title", info.label));
      return;
    }
    const copy = element(document, "div", "stage-copy");
    copy.append(
      element(document, "h2", "stage-title", info.label),
      element(document, "p", `stage-status tone-${info.tone}`, info.status),
    );
    if (info.locked && info.lockReason) copy.append(element(document, "p", "stage-lock", info.lockReason));
    if (info.note) copy.append(element(document, "p", "stage-note", info.note));
    host.append(copy);
    if (info.next) {
      const action = element(document, "div", "stage-next-wrap");
      action.append(element(document, "span", "stage-next-label", "Дальше"));
      const button = element(document, "button", "stage-next", info.next.label);
      button.type = "button";
      button.addEventListener("click", () => runNext(info.next, button));
      action.append(button);
      host.append(action);
    }
  }

  function applyVisibility() {
    for (const stage of STAGES) {
      const view = views[stage.id];
      if (view) view.hidden = stage.id !== current;
    }
    if (framesArea) {
      framesArea.hidden = !FRAME_STAGES.has(current);
      if (framesArea.dataset) framesArea.dataset.stage = current;
    }
    if (document.body?.dataset) document.body.dataset.stage = current;
  }

  function refresh() {
    derived = deriveStages(typeof getFacts === "function" ? getFacts() : {});
    renderNav();
    for (const stage of STAGES) renderHeader(stage.id);
    applyVisibility();
  }

  function select(id, { persist = true } = {}) {
    if (!STAGE_IDS.has(id)) return;
    current = id;
    if (persist) {
      explicit = true;
      history?.replaceState?.(null, "", stageHash(id));
    }
    refresh();
  }

  function settleDefault() {
    settled = true;
    if (explicit) {
      refresh();
      return current;
    }
    current = defaultStage(typeof getFacts === "function" ? getFacts() : {});
    refresh();
    return current;
  }

  globalThis.addEventListener?.("hashchange", () => {
    const fromHash = stageFromHash(location?.hash);
    if (fromHash && fromHash !== current) {
      explicit = true;
      current = fromHash;
      refresh();
    }
  });

  refresh();

  return {
    refresh,
    select,
    settleDefault,
    current: () => current,
    derived: () => derived,
    isFrameStage: () => FRAME_STAGES.has(current),
  };
}
