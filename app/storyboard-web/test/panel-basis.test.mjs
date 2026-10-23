import assert from "node:assert/strict";
import test from "node:test";
import { panelBasis } from "../public/panel-basis.mjs";

function frame(panels, extras = {}) {
  return { layout: panels.length > 1 ? "split2" : "single", speakerPanel: 0, dialogue: "Привет", panels, ...extras };
}

test("an assigned image reports its persisted origin", () => {
  const assigned = frame([
    { description: "Путин", assetId: "a", assignmentOrigin: "generation" },
    { description: "Дуров", assetId: "b", assignmentOrigin: "upload" },
  ]);
  assert.deepEqual(panelBasis(assigned, 0), { kind: "generation", label: "Генерация" });
  assert.deepEqual(panelBasis(assigned, 1), { kind: "upload", label: "Загружено" });
  const reused = frame([{ description: "Путин", assetId: "a", assignmentOrigin: "reuse" }]);
  assert.deepEqual(panelBasis(reused, 0), { kind: "reuse", label: "Выбрано из библиотеки" });
});

test("an image without a known origin gets a neutral label", () => {
  for (const origin of [null, undefined, "something-new"]) {
    const result = panelBasis(frame([{ description: "Путин", assetId: "a", assignmentOrigin: origin }]), 0);
    assert.deepEqual(result, { kind: "image", label: "Изображение" });
  }
});

test("a panel shown with the base character portrait says so and reads as intentional", () => {
  const demo = frame([{ description: "Путин за столом" }, { description: "Дуров напротив" }]);
  const result = panelBasis(demo, 1);
  assert.equal(result.kind, "base-portrait");
  assert.equal(result.label, "Базовый образ персонажа");
  assert.match(result.hint, /не ошибка/);
});

test("panels with nothing to show say there is no image", () => {
  const partial = frame([
    { description: "Путин", assetId: "a", assignmentOrigin: "generation" },
    { description: "Дуров", assetId: null, generationStatus: "failed", generationError: "provider" },
  ]);
  assert.deepEqual(panelBasis(partial, 1), { kind: "none", label: "Нет изображения" });
  const unresolved = frame([{ description: "Слушатель без имени" }]);
  assert.deepEqual(panelBasis(unresolved, 0), { kind: "none", label: "Нет изображения" });
  assert.equal(panelBasis(frame([]), 0), null);
  assert.equal(panelBasis(null, 0), null);
});
