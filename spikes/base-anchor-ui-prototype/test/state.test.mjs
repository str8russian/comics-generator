import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVENANCE,
  acceptDraft,
  choosePath,
  confirmDelete,
  confirmDiscard,
  createState,
  escapeKey,
  openCreate,
  openRefine,
  openReplace,
  redoCandidate,
  requestDelete,
  requestDismiss,
  requestGenerate,
  resetEmpty,
  resolveGenerate,
  restoreSession,
  seedReadyAnchor,
  serializeSession,
  setInstruction,
  setSelectedImage,
  undoCandidate,
  undoDelete,
  view,
} from "../lib/state.mjs";

const SOURCE = "data:image/png;base64,SOURCE";
const UPLOAD = "data:image/png;base64,UPLOAD";
const ORIGINAL = "data:image/png;base64,ORIGINAL";
const C1 = "data:image/png;base64,C1";
const C2 = "data:image/png;base64,C2";
const C3 = "data:image/png;base64,C3";
const C4 = "data:image/png;base64,C4";

function uploadedState() {
  return acceptDraft(setSelectedImage(choosePath(openCreate(createState()), "ready"), {
    dataUrl: UPLOAD,
    mime: "image/png",
  }));
}

function generatedState() {
  let state = setSelectedImage(choosePath(openCreate(createState()), "photo"), {
    dataUrl: SOURCE,
    mime: "image/jpeg",
  });
  state = setInstruction(state, "спокойный портрет");
  const next = requestGenerate(state);
  return acceptDraft(resolveGenerate(next.state, {
    ok: true,
    requestId: next.effect.requestId,
    dataUrl: ORIGINAL,
  }));
}

function succeed(state, dataUrl) {
  const next = requestGenerate(state);
  assert.equal(next.blocked, null);
  assert.equal(next.effect?.type, "generate");
  return {
    state: resolveGenerate(next.state, { ok: true, requestId: next.effect.requestId, dataUrl }),
    effect: next.effect,
  };
}

test("empty card exposes only create", () => {
  const model = view(createState());
  assert.equal(model.stable, "NO_BASE_ANCHOR");
  assert.deepEqual(model.actions.map((action) => action.label), ["Создать образ"]);
  assert.equal(model.hasGenericEdit, false);
  assert.equal(model.anchor, null);
});

test("available card exposes refine, replacement, and tertiary delete without a generic edit choice", () => {
  const model = view(uploadedState());
  assert.equal(model.stable, "ANCHOR_AVAILABLE");
  assert.deepEqual(model.actions.map((action) => [action.label, action.tone]), [
    ["Уточнить образ", "secondary"],
    ["Создать замену", "secondary"],
    ["Удалить", "destructive"],
  ]);
  assert.equal(model.hasGenericEdit, false);
  assert.equal(model.anchor.label, "Загружен как готовый anchor");
  assert.equal(model.anchor.provenance, PROVENANCE.uploadedAsReadyAnchor);
  assert.equal(model.anchor.source, null);
});

test("initial creation offers ready-anchor upload and real-photo generation", () => {
  const chooser = view(openCreate(createState()));
  assert.deepEqual(chooser.modal.paths.map((path) => path.label), [
    "Загрузить готовый anchor",
    "Создать по реальному фото",
  ]);
  assert.equal(chooser.modal.showGenerate, false);

  let ready = choosePath(openCreate(createState()), "ready");
  assert.equal(requestGenerate(ready).effect, null);
  ready = setSelectedImage(ready, { dataUrl: UPLOAD, mime: "image/png" });
  assert.equal(requestGenerate(ready).effect, null);
  assert.equal(view(ready).modal.preview.dominant.label, "Загружен как готовый anchor");
  assert.equal(view(ready).modal.preview.secondary.some((item) => item.label === "Исходное фото"), false);
  ready = acceptDraft(ready);
  assert.equal(ready.anchor.dataUrl, UPLOAD);
  assert.equal(ready.anchor.source, null);

  let photo = setSelectedImage(choosePath(openCreate(createState()), "photo"), {
    dataUrl: SOURCE,
    mime: "image/jpeg",
  });
  assert.equal(view(photo).modal.preview.dominant.label, "Исходное фото");
  assert.match(view(photo).modal.preview.note, /не является сгенерированным/);
  const generated = succeed(photo, ORIGINAL);
  assert.equal(generated.effect.body.operation, "from-source");
  assert.equal(generated.effect.body.sourceImage, SOURCE);
  assert.equal(generated.effect.body.previousImage, null);
  assert.notEqual(view(generated.state).modal.preview.dominant.dataUrl, SOURCE);
  assert.equal(view(generated.state).modal.preview.dominant.label, "Сгенерированный вариант");
  assert.equal(view(generated.state).modal.preview.secondary[0].label, "Исходное фото");
  photo = acceptDraft(generated.state);
  assert.equal(photo.anchor.provenance, PROVENANCE.generatedFromSource);
  assert.equal(photo.anchor.dataUrl, ORIGINAL);
  assert.equal(photo.anchor.source.dataUrl, SOURCE);
  assert.equal(view(photo).anchor.source.label, "Исходное фото");
});

test("source-photo candidates stay in history while undo and redo make no provider request", () => {
  let state = setSelectedImage(choosePath(openCreate(createState()), "photo"), {
    dataUrl: SOURCE,
    mime: "image/png",
  });
  state = succeed(state, C1).state;
  state = succeed(setInstruction(state, "ещё"), C2).state;
  assert.deepEqual(state.modal.candidates.map((candidate) => candidate.dataUrl), [C1, C2]);
  assert.notEqual(C1, SOURCE);
  assert.notEqual(C2, SOURCE);
  state = undoCandidate(state);
  assert.equal(state.modal.index, 0);
  assert.equal(state.modal.candidates[state.modal.index].dataUrl, C1);
  state = redoCandidate(state);
  assert.equal(state.modal.candidates[state.modal.index].dataUrl, C2);
  assert.equal(state.modal.candidates.length, 2);
});

test("refine opens directly and keeps candidates 1-4 when the last instruction is empty", () => {
  const original = generatedState();
  let state = openRefine(original);
  assert.equal(state.modal.operation, "refine");
  assert.equal(state.modal.step, "refine");
  assert.deepEqual(view(state).modal.paths, []);
  assert.equal(view(state).modal.title, "Уточнить образ");
  assert.equal(requestGenerate(state).blocked, "instruction-required");
  assert.equal(requestGenerate(state).effect, null);

  const calls = [];
  for (const [instruction, image] of [["светлее", C1], ["контрастнее", C2], ["спокойнее", C3], ["", C4]]) {
    state = setInstruction(state, instruction);
    const next = succeed(state, image);
    calls.push(next.effect);
    state = next.state;
    assert.equal(state.modal.operation, "refine");
    assert.equal(state.modal.step, "refine");
    assert.equal(state.anchor.dataUrl, ORIGINAL);
    assert.equal(state.anchor.source.dataUrl, SOURCE);
  }

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((effect) => effect.body.instruction), ["светлее", "контрастнее", "спокойнее", ""]);
  assert.deepEqual(calls.map((effect) => effect.body.anchorImage), [ORIGINAL, ORIGINAL, ORIGINAL, ORIGINAL]);
  assert.deepEqual(calls.map((effect) => effect.body.sourceImage), [SOURCE, SOURCE, SOURCE, SOURCE]);
  assert.equal(calls[0].body.previousImage, null);
  assert.equal(calls[3].body.previousImage, C3);
  assert.deepEqual(state.modal.candidates.map((candidate) => candidate.dataUrl), [C1, C2, C3, C4]);
  assert.notEqual(C4, SOURCE);
  assert.equal(state.modal.index, 3);

  state = undoCandidate(state);
  state = undoCandidate(state);
  state = undoCandidate(state);
  assert.equal(state.modal.candidates[state.modal.index].dataUrl, C1);
  assert.equal(state.modal.candidates.length, 4);
  state = redoCandidate(redoCandidate(state));
  assert.equal(state.modal.candidates[state.modal.index].dataUrl, C3);
  assert.equal(view(state).modal.position, "Вариант 3 из 4");

  const pending = requestGenerate(setInstruction(state, "ещё один"));
  assert.equal(requestGenerate(pending.state).effect, null);
  assert.equal(requestGenerate(pending.state).blocked, "pending");
  assert.equal(undoCandidate(pending.state).modal.index, state.modal.index);
  assert.equal(acceptDraft(pending.state).anchor.dataUrl, ORIGINAL);
});

test("replacement keeps the old anchor until accept and cancel restores nothing new", () => {
  const original = generatedState();
  let state = openReplace(original);
  assert.deepEqual(view(state).modal.paths.map((path) => path.label), [
    "Загрузить готовый anchor",
    "Создать по реальному фото",
  ]);

  let ready = setSelectedImage(choosePath(openReplace(original), "ready"), {
    dataUrl: UPLOAD,
    mime: "image/webp",
  });
  assert.equal(requestGenerate(ready).effect, null);
  assert.equal(ready.anchor.dataUrl, ORIGINAL);
  ready = acceptDraft(ready);
  assert.equal(ready.anchor.dataUrl, UPLOAD);
  assert.equal(ready.anchor.provenance, PROVENANCE.uploadedAsReadyAnchor);
  assert.equal(ready.anchor.source, null);

  state = setInstruction(setSelectedImage(choosePath(openReplace(original), "photo"), {
    dataUrl: "data:image/png;base64,NEWSOURCE",
    mime: "image/png",
  }), "другой человек");
  const drafted = succeed(state, C1);
  assert.equal(drafted.effect.body.operation, "from-source");
  assert.equal(drafted.effect.body.sourceImage, "data:image/png;base64,NEWSOURCE");
  assert.equal(drafted.effect.body.anchorImage, null);
  assert.equal(drafted.state.anchor.dataUrl, ORIGINAL);
  assert.equal(drafted.state.anchor.source.dataUrl, SOURCE);
  assert.equal(view(drafted.state).modal.preview.secondary.some((item) => item.dataUrl === ORIGINAL), true);

  state = confirmDiscard(requestDismiss(drafted.state));
  assert.equal(state.modal, null);
  assert.equal(state.anchor.dataUrl, ORIGINAL);
  assert.equal(state.anchor.source.dataUrl, SOURCE);

  const replaced = acceptDraft(drafted.state);
  assert.equal(replaced.anchor.dataUrl, C1);
  assert.equal(replaced.anchor.provenance, PROVENANCE.generatedFromSource);
  assert.equal(replaced.anchor.source.dataUrl, "data:image/png;base64,NEWSOURCE");
});

test("provider failure keeps the draft context and candidate history", () => {
  let state = setInstruction(setSelectedImage(choosePath(openCreate(createState()), "photo"), {
    dataUrl: SOURCE,
    mime: "image/png",
  }), "первый");
  state = succeed(state, C1).state;
  state = setInstruction(state, "второй");
  const failedRequest = requestGenerate(state);
  state = resolveGenerate(failedRequest.state, {
    ok: false,
    requestId: failedRequest.effect.requestId,
    kind: "provider",
  });
  assert.equal(state.modal.pending, false);
  assert.equal(state.modal.error, "provider");
  assert.equal(state.modal.instruction, "второй");
  assert.equal(state.modal.source.dataUrl, SOURCE);
  assert.deepEqual(state.modal.candidates.map((candidate) => candidate.dataUrl), [C1]);
  assert.equal(state.anchor, null);
  const retry = requestGenerate(state);
  assert.equal(retry.effect.body.instruction, "второй");
  assert.equal(retry.effect.body.previousImage, C1);
});

test("escape, close, and cancel share discard confirmation and do not discard directly", () => {
  const original = uploadedState();
  let state = setInstruction(openRefine(original), "не терять");
  state = escapeKey(state);
  assert.equal(state.notice.type, "discard");
  assert.equal(state.modal.instruction, "не терять");
  state = escapeKey(state);
  assert.equal(state.notice, null);
  assert.equal(state.modal.instruction, "не терять");

  state = requestDismiss(state);
  assert.equal(state.notice.type, "discard");
  assert.match(view(state).notice.text, /Принятый образ не изменится/);
  state = confirmDiscard(state);
  assert.equal(state.modal, null);
  assert.equal(state.anchor.dataUrl, UPLOAD);

  const clean = openCreate(createState());
  assert.equal(escapeKey(clean).modal, null);
});

test("a pending provider request blocks closure without dropping the draft", () => {
  let state = setInstruction(openRefine(uploadedState()), "ждём");
  state = requestGenerate(state).state;
  state = escapeKey(state);
  assert.equal(state.notice.type, "pending");
  assert.match(view(state).notice.text, /не отменит уже отправленный запрос/);
  assert.equal(state.modal.pending, true);
  state = requestDismiss(state);
  assert.equal(state.modal.pending, true);
  state = confirmDiscard(state);
  assert.equal(state.modal.pending, true);
  assert.equal(state.modal.instruction, "ждём");
  state = escapeKey(state);
  assert.equal(state.notice, null);
  assert.equal(state.modal.pending, true);
  state = escapeKey(requestGenerate(setInstruction(openRefine(uploadedState()), "ждём")).state);
  state = resolveGenerate(state, {
    ok: true,
    requestId: state.modal.requestId,
    dataUrl: C1,
  });
  assert.equal(state.notice, null);
  assert.equal(state.modal.pending, false);
  assert.equal(state.modal.candidates.length, 1);
  assert.equal(state.anchor.dataUrl, UPLOAD);
});

test("delete returns to an empty card and session undo restores the same anchor", () => {
  const original = generatedState();
  let state = confirmDelete(requestDelete(original));
  assert.equal(view(state).stable, "NO_BASE_ANCHOR");
  assert.equal(view(state).sessionUndo.label, "Вернуть образ");
  assert.equal(state.anchor, null);
  state = undoDelete(state);
  assert.equal(state.anchor.dataUrl, ORIGINAL);
  assert.equal(state.anchor.provenance, PROVENANCE.generatedFromSource);
  assert.equal(state.anchor.source.dataUrl, SOURCE);
  assert.equal(state.deleteUndo, null);
});

test("accepted session memory drops unfinished drafts", () => {
  let state = setInstruction(openRefine(generatedState()), "CANARY_DRAFT");
  const saved = serializeSession(state);
  assert.equal(JSON.stringify(saved).includes("CANARY_DRAFT"), false);
  assert.equal(saved.anchor.dataUrl, ORIGINAL);
  const restored = restoreSession({ ...saved, modal: { instruction: "CANARY_DRAFT" }, notice: { type: "discard" } });
  assert.equal(restored.modal, null);
  assert.equal(restored.notice, null);
  assert.equal(JSON.stringify(restored).includes("CANARY_DRAFT"), false);
  assert.equal(restored.anchor.source.dataUrl, SOURCE);
});

test("prototype reset and seeded ready anchor stay out of the draft and do not invent a source photo", () => {
  const seeded = seedReadyAnchor(createState(), { dataUrl: UPLOAD, mime: "image/png" });
  const model = view(seeded);
  assert.equal(model.stable, "ANCHOR_AVAILABLE");
  assert.equal(model.anchor.provenance, PROVENANCE.seededRepositoryAnchor);
  assert.equal(model.anchor.source, null);
  assert.equal(model.anchor.label, "Готовый anchor из фикстуры репозитория");
  assert.match(model.anchor.fixture, /character-anchors\/putin\.png$/);
  assert.equal(model.prototype.enabled, true);

  const drafting = openRefine(seeded);
  assert.equal(view(drafting).prototype.enabled, false);
  assert.equal(resetEmpty(drafting), drafting);
  const cleared = resetEmpty(seeded);
  assert.equal(view(cleared).stable, "NO_BASE_ANCHOR");

  const refined = acceptDraft(succeed(setInstruction(openRefine(seeded), "мягче"), C1).state);
  assert.equal(refined.anchor.provenance, PROVENANCE.refinedFromAcceptedAnchor);
  assert.equal(refined.anchor.source, null);
  assert.equal(view(refined).anchor.label, "Уточнён по принятому образу");
});

test("ready upload, undo, redo, cancel, delete, and accept do not request generation", () => {
  let blockedCalls = 0;
  function assertNoGenerate(state) {
    const next = requestGenerate(state);
    if (next.effect) blockedCalls += 1;
  }

  let state = setSelectedImage(choosePath(openCreate(createState()), "ready"), {
    dataUrl: UPLOAD,
    mime: "image/png",
  });
  assertNoGenerate(state);
  state = acceptDraft(state);
  assertNoGenerate(state);

  state = setInstruction(openRefine(state), "раз");
  state = succeed(state, C1).state;
  state = succeed(setInstruction(state, "два"), C2).state;
  const index = state.modal.index;
  state = undoCandidate(state);
  state = redoCandidate(state);
  assert.equal(state.modal.index, index);
  state = confirmDiscard(requestDismiss(state));
  assertNoGenerate(state);
  state = confirmDelete(requestDelete(state));
  assertNoGenerate(state);
  state = undoDelete(state);
  assertNoGenerate(state);
  assert.equal(blockedCalls, 0);
  assert.equal(state.anchor.dataUrl, UPLOAD);
});
