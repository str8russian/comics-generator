/** Concise Russian copy for hybrid Visual phases and failure kinds. */

const PHASE_COPY = {
  queued: "Подготавливаем кадр…",
  "preparing-background": "Подготавливаем кадр…",
  "generating-background": "Создаём фон…",
  "generating-character-states": "Создаём персонажей…",
  assembling: "Собираем кадр…",
  complete: "Изображения готовы.",
};

const FAILURE_COPY = {
  "matte-failed": "Не удалось чисто подготовить персонажа. Повторите генерацию.",
  "style-required": "Сначала утвердите базовый визуальный стиль проекта.",
  "anchor-required": "Сначала утвердите базовый образ нужного персонажа.",
  "frame-generation-required": "Сначала создайте изображения всего выбранного кадра.",
  "assembly-failed": "Не удалось собрать кадр из готовых частей. Повторите генерацию.",
  provider: "Провайдер не завершил генерацию. Уже готовые результаты сохранены.",
  timeout: "Генерация заняла слишком много времени. Повторите попытку.",
  "invalid-output": "Провайдер не вернул пригодное изображение. Повторите попытку.",
  conflict: "Более новая генерация заменила эту попытку. Показано актуальное состояние.",
  "not-found": "Не удалось найти этот кадр или операцию. Обновите страницу.",
  configuration: "Генерация недоступна из‑за настройки окружения. Проверьте конфигурацию и повторите.",
  "invalid-request": "Не удалось прочитать запрос. Проверьте данные и попробуйте ещё раз.",
  "invalid-image": "Не удалось прочитать изображение. Выберите JPEG, PNG или WebP.",
  "unsupported-image-format": "Этот формат пока не поддерживается. Выберите JPEG, PNG или WebP.",
  database: "Не удалось сохранить результат. Попробуйте ещё раз.",
  "identity-required": "Сначала выберите реальную фотографию персонажа.",
  "structure-rejected": "Не удалось применить эту правку, не меняя реплики. Опишите изменение кадра иначе.",
  "visual-incomplete": "Сначала создайте изображения для всех панелей.",
  "stale-version": "Раскадровка уже изменилась. Обновите страницу и повторите действие.",
  "asset-load-failed": "Изображение не удалось показать. Обновите страницу или создайте панель заново.",
  "nothing-to-undo": "Предыдущей структурной версии пока нет.",
  "image-too-large": "Файл слишком большой. Выберите фото меньшего размера.",
};

export function hybridPhaseMessage(phase) {
  if (phase == null) return "Подготавливаем кадр…";
  return PHASE_COPY[phase] || "Подготавливаем кадр…";
}

export function hybridFailureMessage(kind) {
  if (!kind) return "Не удалось выполнить действие. Попробуйте ещё раз.";
  return FAILURE_COPY[kind] || "Не удалось выполнить действие. Попробуйте ещё раз.";
}

export function actionMessage(kind) {
  return hybridFailureMessage(kind);
}

/** Defaults used by reset (agreed character placement). */
export const DEFAULT_PLACEMENT = Object.freeze({
  zoom: 1,
  positionX: 50,
  positionY: 30,
  fitMode: "manual",
});

export function fitPlacement() {
  return {
    zoom: 1,
    positionX: 50,
    positionY: 50,
    fitMode: "fit",
  };
}

export const POLL_STATUS_RETRIEVAL_FAILURE =
  "Не удалось получить текущий статус генерации. Обновите страницу, чтобы продолжить отслеживание.";

/** Run a background async task without allowing unhandled rejections. */
export function startContainedTask(task, {
  onError = null,
  isAbortError = (error) => error?.name === "AbortError",
} = {}) {
  Promise.resolve()
    .then(() => task())
    .catch((error) => {
      if (isAbortError(error)) return;
      if (typeof onError === "function") {
        try { onError(error); } catch { /* containment must not throw */ }
      }
    });
}

/**
 * Per-key placement writer: debounced start, one in-flight PATCH, latest queued wins.
 * Every enqueue() Promise settles even when superseded.
 */
export function createPlacementWriter({
  debounceMs = 200,
  send,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancelSchedule = (id) => clearTimeout(id),
  onSettled = null,
} = {}) {
  if (typeof send !== "function") {
    throw new Error("createPlacementWriter requires send()");
  }

  /** @type {Map<string, any>} */
  const channels = new Map();

  function channel(key) {
    let entry = channels.get(key);
    if (!entry) {
      entry = {
        nextRevision: 0,
        confirmed: null,
        confirmedRevision: 0,
        preview: null,
        previewRevision: 0,
        debounceId: null,
        debounceRevision: null,
        debouncePlacement: null,
        debounceWaiters: [],
        inFlight: false,
        inFlightRevision: null,
        queued: null,
      };
      channels.set(key, entry);
    }
    return entry;
  }

  function settle(waiters, result) {
    const list = waiters.splice(0, waiters.length);
    for (const waiter of list) waiter.resolve(result);
  }

  function emitSettled(event) {
    if (typeof onSettled === "function") {
      try { onSettled(event); } catch { /* UI hooks must not break the writer */ }
    }
  }

  async function flush(key, revision, placement, waiters) {
    const ch = channel(key);
    ch.inFlight = true;
    ch.inFlightRevision = revision;
    let result = null;
    let error = null;
    try {
      result = await send(key, placement, revision);
    } catch (err) {
      error = err;
    }

    const ok = !error;
    if (ok) {
      ch.confirmed = { ...placement };
      ch.confirmedRevision = revision;
    }

    const hasQueued = Boolean(ch.queued);
    const isNewestPreview = revision === ch.previewRevision;
    const outcome = {
      ok,
      superseded: false,
      revision,
      key,
      placement: { ...placement },
      result,
      error,
      shouldApplyResponse: ok && isNewestPreview,
      shouldRevert: !ok && !hasQueued && isNewestPreview,
      confirmed: ch.confirmed ? { ...ch.confirmed } : null,
      preview: ch.preview ? { ...ch.preview } : null,
      previewRevision: ch.previewRevision,
    };
    settle(waiters, outcome);
    emitSettled(outcome);

    ch.inFlight = false;
    ch.inFlightRevision = null;

    if (ch.queued) {
      const next = ch.queued;
      ch.queued = null;
      await flush(key, next.revision, next.placement, next.waiters);
    }
    return outcome;
  }

  function enqueue(key, placement) {
    const ch = channel(key);
    ch.nextRevision += 1;
    const revision = ch.nextRevision;
    const body = { ...placement };
    ch.preview = body;
    ch.previewRevision = revision;

    return new Promise((resolve) => {
      const waiter = { revision, resolve };

      if (ch.inFlight) {
        if (ch.queued) {
          settle(ch.queued.waiters, {
            ok: true,
            superseded: true,
            revision: ch.queued.revision,
            key,
            placement: ch.queued.placement,
          });
        }
        ch.queued = {
          revision,
          placement: body,
          waiters: [waiter],
        };
        return;
      }

      if (ch.debounceId != null) {
        settle(ch.debounceWaiters, {
          ok: true,
          superseded: true,
          revision: ch.debounceRevision,
          key,
          placement: ch.debouncePlacement,
        });
        cancelSchedule(ch.debounceId);
        ch.debounceId = null;
      }

      ch.debounceWaiters = [waiter];
      ch.debounceRevision = revision;
      ch.debouncePlacement = body;
      ch.debounceId = schedule(() => {
        const waiters = ch.debounceWaiters;
        const rev = ch.debounceRevision;
        const nextPlacement = ch.debouncePlacement;
        ch.debounceId = null;
        ch.debounceWaiters = [];
        ch.debounceRevision = null;
        ch.debouncePlacement = null;
        void flush(key, rev, nextPlacement, waiters);
      }, debounceMs);
    });
  }

  return {
    enqueue,
    getConfirmed(key) {
      const confirmed = channel(key).confirmed;
      return confirmed ? { ...confirmed } : null;
    },
    getPreview(key) {
      const preview = channel(key).preview;
      return preview ? { ...preview } : null;
    },
    getPreviewRevision(key) {
      return channel(key).previewRevision;
    },
    setConfirmed(key, placement) {
      const ch = channel(key);
      ch.confirmed = placement ? { ...placement } : null;
    },
    isInFlight(key) {
      return channel(key).inFlight;
    },
    hasQueued(key) {
      return Boolean(channel(key).queued);
    },
  };
}

/**
 * One active canonical operation poll per frame, with generation tokens.
 */
export function createCanonicalOperationPoller({
  fetchOperation,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 250,
} = {}) {
  if (typeof fetchOperation !== "function") {
    throw new Error("createCanonicalOperationPoller requires fetchOperation()");
  }

  /** @type {Map<string, { operationId: string, controller: AbortController, generation: number }>} */
  const active = new Map();
  let generationSeq = 0;

  function stop(frameId) {
    const entry = active.get(frameId);
    if (!entry) return;
    entry.controller.abort();
    active.delete(frameId);
  }

  function has(frameId) {
    return active.has(frameId);
  }

  function get(frameId) {
    return active.get(frameId) ?? null;
  }

  async function poll(frameId, operationId, { onPhase } = {}) {
    stop(frameId);
    generationSeq += 1;
    const generation = generationSeq;
    const controller = new AbortController();
    active.set(frameId, { operationId, controller, generation });
    try {
      while (!controller.signal.aborted) {
        let payload;
        try {
          payload = await fetchOperation(frameId, operationId, { signal: controller.signal });
        } catch (error) {
          if (error?.name === "AbortError") return { kind: "aborted" };
          if (active.get(frameId)?.generation === generation) active.delete(frameId);
          return { kind: "transport-error", error };
        }
        const current = active.get(frameId);
        if (!current || current.generation !== generation || current.operationId !== operationId) {
          return { kind: "stale" };
        }
        if (payload?.ok === false && payload?.transportError) {
          if (active.get(frameId)?.generation === generation) active.delete(frameId);
          return { kind: "transport-error", error: payload.error || new Error("transport") };
        }
        if (typeof onPhase === "function") onPhase(payload);
        if (payload?.status === "complete" || payload?.status === "failed") {
          if (active.get(frameId)?.generation === generation) active.delete(frameId);
          return { kind: "terminal", payload };
        }
        await delay(intervalMs);
      }
      return { kind: "aborted" };
    } catch (error) {
      if (error?.name === "AbortError") return { kind: "aborted" };
      if (active.get(frameId)?.generation === generation) active.delete(frameId);
      return { kind: "transport-error", error };
    }
  }

  return { stop, has, get, poll, active };
}
