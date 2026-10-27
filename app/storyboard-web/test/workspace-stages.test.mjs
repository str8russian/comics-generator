import assert from "node:assert/strict";
import test from "node:test";
import {
  STAGES,
  defaultStage,
  deriveStages,
  framesLabel,
  stageFromHash,
  stageHash,
} from "../public/workspace-stages.mjs";

function frames(spec) {
  return spec.map((entry, index) => ({
    id: `display-${index + 1}`,
    frameKind: entry.kind ?? null,
    visualReady: Boolean(entry.ready),
  }));
}

function visual({ approved = [true, true], complete = false, approvedVisual = false, ready = [false, false, false] } = {}) {
  const characters = approved.map((value, index) => ({
    name: ["Путин", "Дуров", "Песков"][index],
    approvedAnchorId: value ? `anchor-${index}` : null,
  }));
  return {
    characters,
    allAnchorsApproved: characters.length > 0 && characters.every((entry) => entry.approvedAnchorId),
    complete,
    approved: approvedVisual,
    readyForVideo: complete && approvedVisual,
    frames: ready.map((value) => ({ visualReady: value })),
  };
}

const empty = { draftText: "", review: null, storyboardFailed: false, frames: [], visual: null, render: null };

test("stages are the five accepted W1 stages in order with Russian labels", () => {
  assert.deepEqual(STAGES.map((stage) => stage.id), ["story", "storyboard", "characters", "visual", "video"]);
  assert.deepEqual(STAGES.map((stage) => stage.label), ["История", "Раскадровка", "Персонажи", "Визуал", "Видео"]);
});

test("empty project: only Story is open and every later stage is locked with an unlocking action", () => {
  const stages = deriveStages(empty);
  assert.equal(stages.story.status, "Нет черновика");
  assert.equal(stages.story.locked, false);
  assert.deepEqual(stages.story.next, { label: "Вставьте черновик диалога", focus: "draft" });
  for (const id of ["storyboard", "characters", "visual", "video"]) {
    assert.equal(stages[id].locked, true, id);
    assert.equal(stages[id].status, "Заблокировано", id);
    assert.ok(stages[id].lockReason, id);
    assert.ok(stages[id].next?.goto, `${id} unlock action navigates`);
    assert.equal(stages[id].next.action, undefined, id);
  }
  assert.equal(defaultStage(empty), "story");
});

test("Story steps with a visible local action do not publish a duplicate focus next action", () => {
  const draft = deriveStages({ ...empty, draftText: "Путин: Привет" });
  assert.equal(draft.story.status, "Черновик");
  assert.equal(draft.story.next, null);

  const reading = deriveStages({ ...empty, draftText: "x", review: "reading" });
  assert.equal(reading.story.status, "Нужно подтвердить");
  assert.equal(reading.story.next, null);
  assert.equal(defaultStage({ ...empty, review: "reading" }), "story");

  const material = deriveStages({ ...empty, draftText: "x", review: "material" });
  assert.equal(material.story.status, "Подтверждено");
  assert.equal(material.story.tone, "done");
  assert.equal(material.story.next, null);
  assert.equal(material.storyboard.locked, true);
  assert.deepEqual(material.storyboard.next, { label: "Перейти к истории", goto: "story" });
  assert.equal(defaultStage({ ...empty, review: "material" }), "story");
});

test("a failed staging reports itself on Storyboard without inventing frames", () => {
  const stages = deriveStages({ ...empty, review: "material", storyboardFailed: true });
  assert.equal(stages.storyboard.status, "Ошибка сборки");
  assert.equal(stages.storyboard.locked, true);
});

test("storyboard ready with no approved base anchors opens Characters by default", () => {
  const facts = {
    ...empty,
    review: "material",
    frames: frames([{}, {}, {}]),
    visual: visual({ approved: [false, false] }),
  };
  const stages = deriveStages(facts);
  assert.equal(stages.story.status, "Подтверждено");
  assert.deepEqual(stages.story.next, { label: "Перейти к раскадровке", goto: "storyboard" });
  assert.equal(stages.storyboard.status, "3 кадра");
  assert.equal(stages.storyboard.locked, false);
  assert.deepEqual(stages.storyboard.next, { label: "Перейти к персонажам", goto: "characters" });
  assert.equal(stages.characters.status, "0/2 утверждены");
  assert.deepEqual(stages.characters.next, { label: "Нужен базовый образ: Путин", focus: "character-cards" });
  assert.equal(stages.visual.status, "Нужны базовые образы");
  assert.equal(stages.visual.locked, true);
  assert.match(stages.visual.lockReason, /базовый образ каждого персонажа/);
  assert.deepEqual(stages.visual.next, { label: "Перейти к персонажам", goto: "characters" });
  assert.equal(defaultStage(facts), "characters");
});

test("partially approved anchors name the next character still missing a base anchor", () => {
  const stages = deriveStages({ ...empty, frames: frames([{}]), visual: visual({ approved: [true, false] }) });
  assert.equal(stages.characters.status, "1/2 утверждены");
  assert.equal(stages.characters.tone, "todo");
  assert.equal(stages.characters.next.label, "Нужен базовый образ: Дуров");
});

test("Visual in progress offers the relocated per-frame generation for the first generatable frame", () => {
  const facts = {
    ...empty,
    frames: frames([{ ready: true }, { kind: "image" }, { kind: "text", ready: true }, {}]),
    visual: visual({ ready: [true, false, true, false] }),
  };
  const stages = deriveStages(facts);
  assert.equal(stages.characters.status, "2/2 утверждены");
  assert.deepEqual(stages.characters.next, { label: "Перейти к визуалу", goto: "visual" });
  assert.equal(stages.visual.status, "2/4 готовы");
  assert.equal(stages.visual.locked, false);
  assert.deepEqual(stages.visual.next, { label: "Создать изображения кадра 4", action: "generate-frame", frameIndex: 3 });
  assert.equal(stages.video.locked, false);
  assert.equal(stages.video.status, "Визуал не утверждён");
  assert.equal(defaultStage(facts), "visual");
});

test("Visual next action opens a manual frame when no generatable frame is missing images", () => {
  const stages = deriveStages({
    ...empty,
    frames: frames([{ ready: true }, { kind: "image" }]),
    visual: visual({ ready: [true, false] }),
  });
  assert.deepEqual(stages.visual.next, { label: "Открыть кадр 2", action: "open-frame", frameIndex: 1 });
});

test("complete but unapproved Visual is a required gate pointing at the existing approve button", () => {
  const facts = { ...empty, frames: frames([{ ready: true }]), visual: visual({ complete: true, ready: [true] }) };
  const stages = deriveStages(facts);
  assert.equal(stages.visual.status, "Нужно утвердить");
  assert.equal(stages.visual.tone, "gate");
  assert.deepEqual(stages.visual.next, { label: "Утвердить визуальную раскадровку", focus: "approve-visual" });
  assert.equal(defaultStage(facts), "visual");
});

test("complete Visual is reachable without approved anchors when images were assigned manually", () => {
  const facts = {
    ...empty,
    frames: frames([{ ready: true }]),
    visual: visual({ approved: [false], complete: true, ready: [true] }),
  };
  const stages = deriveStages(facts);
  assert.equal(stages.visual.status, "Нужно утвердить");
  assert.equal(stages.visual.locked, false);
  assert.equal(defaultStage(facts), "visual");
});

test("approved Visual opens Video, and render status comes from the loaded render state", () => {
  const base = { ...empty, frames: frames([{ ready: true }]), visual: visual({ complete: true, approvedVisual: true, ready: [true] }) };
  const stages = deriveStages(base);
  assert.equal(stages.visual.status, "Утверждено");
  assert.equal(stages.visual.tone, "done");
  assert.deepEqual(stages.visual.next, { label: "Перейти к видео", goto: "video" });
  assert.equal(stages.video.status, "Готово к сборке");
  assert.deepEqual(stages.video.next, { label: "Собрать видео", focus: "start-render" });
  assert.equal(defaultStage(base), "video");
  assert.equal(deriveStages({ ...base, render: { status: "running" } }).video.status, "Сборка идёт");
  assert.equal(deriveStages({ ...base, render: { status: "success" } }).video.status, "Видео готово");
  assert.equal(deriveStages({ ...base, render: { status: "failure" } }).video.status, "Сборка не удалась");
});

test("Video stays reachable before approval because render is available today", () => {
  const stages = deriveStages({ ...empty, frames: frames([{}]), visual: visual({ ready: [false] }) });
  assert.equal(stages.video.locked, false);
  assert.match(stages.video.note, /не утверждена/);
  assert.deepEqual(stages.video.next, { label: "Собрать видео", focus: "start-render" });
});

test("stage hash round-trips and rejects unknown values", () => {
  for (const stage of STAGES) assert.equal(stageFromHash(stageHash(stage.id)), stage.id);
  assert.equal(stageHash("visual"), "#stage=visual");
  assert.equal(stageFromHash(""), null);
  assert.equal(stageFromHash(undefined), null);
  assert.equal(stageFromHash("#stage=bogus"), null);
  assert.equal(stageFromHash("#visual"), null);
});

test("frame counts use Russian plural forms", () => {
  assert.equal(framesLabel(1), "1 кадр");
  assert.equal(framesLabel(3), "3 кадра");
  assert.equal(framesLabel(5), "5 кадров");
  assert.equal(framesLabel(11), "11 кадров");
  assert.equal(framesLabel(21), "21 кадр");
  assert.equal(framesLabel(22), "22 кадра");
});
