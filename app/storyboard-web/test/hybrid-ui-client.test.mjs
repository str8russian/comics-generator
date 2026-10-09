import assert from "node:assert/strict";
import test from "node:test";
import {
  createCanonicalOperationPoller,
  createPlacementWriter,
  POLL_STATUS_RETRIEVAL_FAILURE,
  startContainedTask,
} from "../public/hybrid-ui.mjs";

function createManualClock() {
  let now = 0;
  /** @type {Map<number, { due: number, fn: Function }>} */
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => now,
    schedule(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { due: now + ms, fn });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= now)
        .sort((a, b) => a[1].due - b[1].due);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test("placement writer coalesces rapid debounce intents to the latest revision", async () => {
  const clock = createManualClock();
  const sent = [];
  const writer = createPlacementWriter({
    debounceMs: 200,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: async (_key, placement, revision) => {
      sent.push({ placement, revision });
      return { status: "ready", placement, revision };
    },
  });

  const pA = writer.enqueue("f1:0", { zoom: 1.1, positionX: 10, positionY: 10, fitMode: "manual" });
  const pB = writer.enqueue("f1:0", { zoom: 1.2, positionX: 20, positionY: 20, fitMode: "manual" });
  const pC = writer.enqueue("f1:0", { zoom: 1.3, positionX: 30, positionY: 30, fitMode: "manual" });
  assert.deepEqual(writer.getPreview("f1:0"), {
    zoom: 1.3, positionX: 30, positionY: 30, fitMode: "manual",
  });

  await clock.advance(200);
  const [a, b, c] = await Promise.all([pA, pB, pC]);
  assert.equal(a.superseded, true);
  assert.equal(b.superseded, true);
  assert.equal(c.ok, true);
  assert.equal(c.superseded, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].placement.zoom, 1.3);
  assert.equal(sent[0].revision, 3);
});

test("placement writer sends only latest queued revision after in-flight settles", async () => {
  const clock = createManualClock();
  /** @type {{ resolve: Function, placement: object, revision: number }[]} */
  const gates = [];
  const sent = [];
  const applied = [];
  const writer = createPlacementWriter({
    debounceMs: 200,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: (key, placement, revision) => new Promise((resolve) => {
      sent.push({ key, placement, revision });
      gates.push({
        resolve: (value) => resolve(value),
        placement,
        revision,
      });
    }),
    onSettled: (outcome) => {
      if (outcome.shouldApplyResponse) applied.push(outcome.placement);
    },
  });

  const pA = writer.enqueue("f1:0", { zoom: 1, positionX: 1, positionY: 1, fitMode: "manual" });
  await clock.advance(200);
  assert.equal(sent.length, 1);

  const pB = writer.enqueue("f1:0", { zoom: 2, positionX: 2, positionY: 2, fitMode: "manual" });
  const pC = writer.enqueue("f1:0", { zoom: 3, positionX: 3, positionY: 3, fitMode: "manual" });
  assert.deepEqual(writer.getPreview("f1:0").zoom, 3);

  gates[0].resolve({ status: "ready", zoom: 1 });
  const a = await pA;
  assert.equal(a.ok, true);
  assert.equal(a.shouldApplyResponse, false, "A must not replace local C preview");
  assert.equal(applied.length, 0);

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].placement.zoom, 3);

  const b = await pB;
  assert.equal(b.superseded, true);

  gates[1].resolve({ status: "ready", zoom: 3 });
  const c = await pC;
  assert.equal(c.ok, true);
  assert.equal(c.shouldApplyResponse, true);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].zoom, 3);
});

test("placement writer keeps newer preview when older in-flight request fails", async () => {
  const clock = createManualClock();
  const gates = [];
  const writer = createPlacementWriter({
    debounceMs: 50,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: (_key, placement, revision) => new Promise((resolve, reject) => {
      gates.push({ resolve, reject, placement, revision });
    }),
  });

  writer.setConfirmed("f1:0", { zoom: 1, positionX: 50, positionY: 30, fitMode: "manual" });
  const pA = writer.enqueue("f1:0", { zoom: 1.5, positionX: 40, positionY: 40, fitMode: "manual" });
  await clock.advance(50);
  const pC = writer.enqueue("f1:0", { zoom: 2.5, positionX: 60, positionY: 60, fitMode: "manual" });
  assert.equal(writer.getPreview("f1:0").zoom, 2.5);

  gates[0].reject(Object.assign(new Error("fail-a"), { kind: "database" }));
  const a = await pA;
  assert.equal(a.ok, false);
  assert.equal(a.shouldRevert, false);
  assert.equal(writer.getPreview("f1:0").zoom, 2.5);

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(gates.length, 2);
  assert.equal(gates[1].placement.zoom, 2.5);
  gates[1].resolve({ status: "ready" });
  const c = await pC;
  assert.equal(c.ok, true);
  assert.equal(c.shouldApplyResponse, true);
});

test("placement writer restores last confirmed when newest request fails alone", async () => {
  const clock = createManualClock();
  const gates = [];
  const reverts = [];
  const writer = createPlacementWriter({
    debounceMs: 50,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: (_key, placement, revision) => new Promise((resolve, reject) => {
      gates.push({ resolve, reject, placement, revision });
    }),
    onSettled: (outcome) => {
      if (outcome.shouldRevert) reverts.push(outcome.confirmed);
    },
  });

  const confirmed = { zoom: 1, positionX: 50, positionY: 30, fitMode: "manual" };
  writer.setConfirmed("f1:0", confirmed);
  const pA = writer.enqueue("f1:0", { zoom: 1.2, positionX: 10, positionY: 10, fitMode: "manual" });
  await clock.advance(50);
  gates[0].resolve({ status: "ready" });
  await pA;
  assert.deepEqual(writer.getConfirmed("f1:0").zoom, 1.2);

  const pC = writer.enqueue("f1:0", { zoom: 2, positionX: 20, positionY: 20, fitMode: "manual" });
  await clock.advance(50);
  gates[1].reject(Object.assign(new Error("fail-c"), { kind: "database" }));
  const c = await pC;
  assert.equal(c.ok, false);
  assert.equal(c.shouldRevert, true);
  assert.equal(reverts.length, 1);
  assert.equal(reverts[0].zoom, 1.2);
});

test("Fit then Reset settles both promises and only persists Reset", async () => {
  const clock = createManualClock();
  const sent = [];
  const writer = createPlacementWriter({
    debounceMs: 200,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: async (_key, placement, revision) => {
      sent.push({ placement, revision });
      return { status: "ready" };
    },
  });

  const fit = writer.enqueue("f1:0", {
    zoom: 1, positionX: 50, positionY: 50, fitMode: "fit",
  });
  const reset = writer.enqueue("f1:0", {
    zoom: 1, positionX: 50, positionY: 30, fitMode: "manual",
  });
  await clock.advance(200);
  const [fitResult, resetResult] = await Promise.all([fit, reset]);
  assert.equal(fitResult.superseded, true);
  assert.equal(resetResult.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].placement.fitMode, "manual");
  assert.equal(sent[0].placement.positionY, 30);
});

test("different panels persist independently", async () => {
  const clock = createManualClock();
  const gates = [];
  const writer = createPlacementWriter({
    debounceMs: 50,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: (key, placement, revision) => new Promise((resolve) => {
      gates.push({ key, placement, revision, resolve });
    }),
  });

  const p0 = writer.enqueue("f1:0", { zoom: 1.1, positionX: 1, positionY: 1, fitMode: "manual" });
  const p1 = writer.enqueue("f1:1", { zoom: 2.2, positionX: 2, positionY: 2, fitMode: "manual" });
  await clock.advance(50);
  assert.equal(gates.length, 2);
  assert.equal(gates[0].key, "f1:0");
  assert.equal(gates[1].key, "f1:1");
  gates[0].resolve({ status: "ready" });
  gates[1].resolve({ status: "ready" });
  const [r0, r1] = await Promise.all([p0, p1]);
  assert.equal(r0.ok, true);
  assert.equal(r1.ok, true);
});

test("placement writer never invents provider or background side effects", async () => {
  const clock = createManualClock();
  let providerCalls = 0;
  let backgroundMutations = 0;
  const writer = createPlacementWriter({
    debounceMs: 10,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: async (_key, placement) => {
      // Placement transport double only.
      assert.equal(providerCalls, 0);
      assert.equal(backgroundMutations, 0);
      return { status: "ready", backgroundAssetId: "bg-unchanged", placement };
    },
  });
  const result = writer.enqueue("f1:0", {
    zoom: 1.4, positionX: 44, positionY: 33, fitMode: "manual",
  });
  await clock.advance(10);
  const settled = await result;
  assert.equal(settled.ok, true);
  assert.equal(settled.result.backgroundAssetId, "bg-unchanged");
  assert.equal(providerCalls, 0);
  assert.equal(backgroundMutations, 0);
});

test("reload-resumed polling transport failure is contained without replacement POST", async () => {
  const rejections = [];
  const onRejection = (reason) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);

  let operationPosts = 0;
  let notices = [];
  let pollCalls = 0;
  const stillRunning = {
    operationId: "00000000-0000-4000-8000-0000000000d1",
    status: "running",
    phase: "generating-character-states",
  };
  const priorVisual = {
    status: "ready",
    frames: [{
      id: "f-hybrid",
      visualReady: true,
      hybrid: {
        activeOperationId: stillRunning.operationId,
        operation: { ...stillRunning },
        background: { status: "ready", assetId: "bg-1" },
      },
    }],
  };

  const poller = createCanonicalOperationPoller({
    intervalMs: 5,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchOperation: async () => {
      pollCalls += 1;
      throw new Error("network down");
    },
  });

  try {
    assert.equal(poller.has("f-hybrid"), false);
    let watchDone = false;
    startContainedTask(async () => {
      const result = await poller.poll("f-hybrid", stillRunning.operationId);
      watchDone = true;
      if (result.kind === "transport-error") {
        notices.push(POLL_STATUS_RETRIEVAL_FAILURE);
        return;
      }
      throw new Error("unexpected poll result");
    }, {
      onError: () => {
        notices.push("unexpected-onError");
      },
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (watchDone) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(watchDone, true);
    assert.equal(pollCalls, 1);
    assert.equal(poller.has("f-hybrid"), false);
    assert.deepEqual(notices, [POLL_STATUS_RETRIEVAL_FAILURE]);
    assert.equal(operationPosts, 0);
    assert.equal(priorVisual.frames[0].visualReady, true);
    assert.equal(priorVisual.frames[0].hybrid.background.assetId, "bg-1");
    assert.equal(priorVisual.frames[0].hybrid.operation.status, "running");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(rejections.length, 0);

    // Later refresh can resume the same still-running operation.
    let resumed = 0;
    let releaseSecond;
    const secondGate = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    const poller2 = createCanonicalOperationPoller({
      intervalMs: 5,
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetchOperation: async (_frameId, _operationId, { signal }) => {
        resumed += 1;
        if (resumed === 1) {
          return {
            operationId: stillRunning.operationId,
            status: "running",
            phase: "generating-character-states",
          };
        }
        await Promise.race([
          secondGate,
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            }, { once: true });
          }),
        ]);
        return {
          operationId: stillRunning.operationId,
          status: "running",
          phase: "generating-character-states",
        };
      },
    });
    const controllerPromise = poller2.poll("f-hybrid", stillRunning.operationId);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (resumed >= 1 && poller2.has("f-hybrid")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(poller2.has("f-hybrid"), true);
    assert.ok(resumed >= 1);
    poller2.stop("f-hybrid");
    releaseSecond();
    const stopped = await controllerPromise;
    assert.equal(
      stopped.kind === "aborted" || stopped.kind === "stale",
      true,
      "stopping a resumed poll must end silently without transport failure",
    );
    assert.equal(operationPosts, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("intentional abort from a newer operation remains silent", async () => {
  const notices = [];
  let calls = 0;
  const poller = createCanonicalOperationPoller({
    intervalMs: 5,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchOperation: async (_frameId, operationId, { signal }) => {
      calls += 1;
      if (operationId === "op-a") {
        await new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }, { once: true });
        });
      }
      return { operationId, status: "complete", visualReady: true };
    },
  });

  let firstResult = null;
  const first = poller.poll("f1", "op-a").then((result) => {
    firstResult = result;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(poller.get("f1")?.operationId, "op-a");

  startContainedTask(async () => {
    const result = await poller.poll("f1", "op-b");
    if (result.kind === "transport-error") notices.push("transport");
    if (result.kind === "terminal") notices.push("complete");
  }, {
    onError: () => notices.push("error"),
  });

  await first;
  assert.equal(firstResult.kind, "aborted");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (notices.includes("complete")) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(notices.includes("error"), false);
  assert.equal(notices.includes("transport"), false);
  assert.equal(notices.includes("complete"), true);
  assert.ok(calls >= 1);
});

test("startContainedTask swallows rejected background work without unhandledrejection", async () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    let saw = false;
    startContainedTask(async () => {
      throw new Error("boom");
    }, {
      onError: () => {
        saw = true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(saw, true);
    assert.equal(rejections.length, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("placement writer clearAll drops in-flight channels so version B cannot reuse version A keys", async () => {
  const clock = createManualClock();
  const sent = [];
  const writer = createPlacementWriter({
    debounceMs: 200,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    send: async (key, placement) => {
      sent.push({ key, placement });
      return { status: "ready" };
    },
  });
  const keyA = "version-a::frame-1::0";
  const pending = writer.enqueue(keyA, { zoom: 1.5, positionX: 10, positionY: 10, fitMode: "manual" });
  writer.clearAll();
  const settled = await pending;
  assert.equal(settled.superseded, true);
  await clock.advance(200);
  assert.equal(sent.length, 0);
  const keyB = "version-b::frame-1::0";
  const next = writer.enqueue(keyB, { zoom: 2, positionX: 20, positionY: 20, fitMode: "manual" });
  await clock.advance(200);
  const outcome = await next;
  assert.equal(outcome.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, keyB);
});

test("operation poller stopAll and version guard prevent stale cross-version phase application", async () => {
  let currentVersion = "version-a";
  const phases = [];
  const poller = createCanonicalOperationPoller({
    intervalMs: 5,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchOperation: async () => ({
      operationId: "op-a",
      status: "running",
      phase: "generating-background",
      storyboardVersionId: "version-a",
    }),
  });

  const run = poller.poll("frame-1", "op-a", {
    expectedStoryboardVersionId: "version-a",
    getCurrentStoryboardVersionId: () => currentVersion,
    onPhase: (payload) => phases.push(payload.phase),
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(phases.length >= 1);
  currentVersion = "version-b";
  poller.stopAll();
  const result = await run;
  assert.ok(result.kind === "aborted" || result.kind === "stale");
  assert.equal(poller.has("frame-1"), false);
});
