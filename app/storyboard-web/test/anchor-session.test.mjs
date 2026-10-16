import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleAnchorSession } from "../anchor-session-request.mjs";
import { compilePrototypePrompt } from "../anchor-prompt.mjs";
import {
  choosePath,
  openCreate,
  openRefine,
  requestGenerate,
  requestGenerateFromSource,
  resolveGenerate,
  seedReadyAnchor,
  setInstruction,
  setSelectedImage,
  undoCandidate,
  view,
  createState,
  acceptDraft,
  acceptPayload,
} from "../public/anchor-session.mjs";

const SOURCE = "data:image/png;base64,SOURCE";
const ANCHOR = "data:image/png;base64,ANCHOR";
const C1 = "data:image/png;base64,C1";
const C2 = "data:image/png;base64,C2";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");

function photoReady() {
  return setSelectedImage(choosePath(openCreate(createState()), "photo"), { dataUrl: SOURCE, mime: "image/png" });
}

test("stable production labels and source-photo action follow the accepted session", () => {
  assert.deepEqual(view(createState()).actions.map((action) => action.label), ["Создать изображение"]);
  const opened = view(openCreate(createState()));
  assert.equal(opened.modal.paths.map((path) => path.label).join("|"), "Загрузить готовый anchor|Создать из реального фото");
  const photo = photoReady();
  assert.equal(view(photo).modal.showGenerateFromSource, false);
  assert.equal(view(photo).modal.generateLabel, "Сгенерировать");
  const first = requestGenerate(photo);
  assert.equal(first.effect.body.basis, "from-source");
  let state = resolveGenerate(first.state, { ok: true, requestId: first.effect.requestId, dataUrl: C1 });
  assert.equal(view(state).modal.showGenerateFromSource, true);
  assert.equal(view(state).modal.generateLabel, "Создать вариант на основе выбранного");
  assert.equal(view(state).modal.candidateOrigin, "Этот вариант создан от исходного фото.");
  state = resolveGenerate(requestGenerate(state).state, { ok: true, requestId: 2, dataUrl: C2 });
  state = undoCandidate(state);
  const branched = requestGenerate(state);
  assert.equal(branched.effect.body.basis, "selected");
  assert.equal(branched.effect.body.previousImage, C1);
  const fresh = requestGenerateFromSource(state);
  assert.equal(fresh.effect.body.basis, "from-source");
  assert.equal(fresh.effect.body.previousImage, null);
  assert.equal(fresh.effect.body.anchorImage, null);
  assert.equal(requestGenerate(fresh.state).blocked, "pending");
  assert.equal(requestGenerateFromSource(fresh.state).blocked, "pending");
});

test("ready upload and seeded anchor do not offer source regeneration", () => {
  const ready = view(setSelectedImage(choosePath(openCreate(createState()), "ready"), { dataUrl: ANCHOR, mime: "image/png" }));
  assert.equal(ready.modal.showGenerate, false);
  assert.equal(ready.modal.showGenerateFromSource, false);
  const seeded = openRefine(seedReadyAnchor(createState(), { dataUrl: ANCHOR, mime: "image/png" }));
  assert.equal(view(seeded).modal.showGenerateFromSource, false);
  assert.equal(view(seeded).modal.basis, "Основа следующего варианта: текущий принятый образ.");
  assert.equal(requestGenerate(seeded).blocked, "instruction-required");
});

test("source-based assembly excludes the accepted anchor and selected candidate", () => {
  const assembled = assembleAnchorSession({
    basis: "from-source",
    instruction: "",
    source: { bytes: png, mime: "image/png" },
    anchor: { bytes: Buffer.from("anchor"), mime: "image/png" },
    previous: { bytes: Buffer.from("previous"), mime: "image/png" },
    style: { bytes: png, mime: "image/png" },
  });
  assert.deepEqual(assembled.references.map((ref) => ref.role), ["identity", "style"]);
  assert.match(assembled.prompt, /muted slate-blue matte/);
  assert.match(assembled.prompt, /not a border around the canvas/);
  assert.match(assembled.prompt, /No microphone, microphone stand/);
  assert.equal(assembled.prompt.includes("plain unobtrusive background"), false);
  const selected = assembleAnchorSession({
    basis: "selected",
    instruction: "тише",
    source: { bytes: png, mime: "image/png" },
    anchor: { bytes: png, mime: "image/png" },
    previous: { bytes: png, mime: "image/png" },
    style: { bytes: png, mime: "image/png" },
  });
  assert.deepEqual(selected.references.map((ref) => ref.role), ["previous", "identity", "anchor"]);
  assert.match(compilePrototypePrompt(selected.references, ""), /Target aspect ratio: 4:5/);
});

test("four character cards and three storyboard frames fit the wide desktop rule", () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(css, /\.page\s*\{[^}]*max-width:\s*1600px/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(300px,\s*1fr\)\)/);
  assert.match(css, /\.story-card\s*\{[^}]*width:\s*384px/s);
  const content = Math.min(1600, 1360) - 48;
  assert.equal(Math.floor((content + 18) / (384 + 18)) >= 3, true);
  assert.equal(Math.floor((content + 16) / (300 + 16)) >= 4, true);
  assert.match(css, /@media \(max-width:\s*760px\)/);
});

test("accept promotes only through the explicit draft accept path", () => {
  let state = resolveGenerate(requestGenerate(photoReady()).state, { ok: true, requestId: 1, dataUrl: C1 });
  assert.equal(state.anchor, null);
  state = acceptDraft(state);
  assert.equal(state.anchor.dataUrl, C1);
  assert.equal(state.anchor.provenance, "generated_from_source");
  assert.equal(state.anchor.source.dataUrl, SOURCE);
});

function refineFromSource() {
  const first = requestGenerate(photoReady());
  const created = resolveGenerate(first.state, { ok: true, requestId: first.effect.requestId, dataUrl: ANCHOR });
  return openRefine(acceptDraft(created));
}

test("the first photo screen does not add a second source action", () => {
  const photo = photoReady();
  assert.equal(view(photo).modal.showGenerateFromSource, false);
  assert.equal(view(photo).modal.generateLabel, "Сгенерировать");
  assert.equal(requestGenerateFromSource(photo).blocked, "source-unavailable");
});

test("initial refine with a retained source shows both actions immediately", () => {
  const opened = refineFromSource();
  const blank = view(opened).modal;
  assert.equal(blank.generateLabel, "Создать вариант с уточнением");
  assert.equal(blank.showGenerateFromSource, true);
  assert.equal(blank.generateEnabled, false);
  assert.equal(blank.basis, "Для варианта с уточнением основа — текущий принятый образ.");
  assert.equal(blank.instructionHint, "Для уточнения принятого образа инструкция обязательна. Вариант от исходного фото можно создать без инструкции.");
  assert.equal(/Основа следующего варианта/.test(blank.basis), false);

  const whitespace = setInstruction(opened, " \n\t ");
  assert.equal(view(whitespace).modal.generateEnabled, false);
  assert.equal(view(whitespace).modal.showGenerateFromSource, true);
  assert.equal(requestGenerate(whitespace).blocked, "instruction-required");
  const emptySource = requestGenerateFromSource(whitespace);
  assert.equal(emptySource.blocked, null);
  assert.equal(emptySource.effect.body.basis, "from-source");
  assert.equal(emptySource.effect.body.instruction, "");
  assert.equal(emptySource.effect.body.sourceImage, SOURCE);
  assert.equal(emptySource.effect.body.previousImage, null);
  assert.equal(emptySource.effect.body.anchorImage, null);

  const typed = setInstruction(opened, "  теплее фон  ");
  assert.equal(view(typed).modal.generateEnabled, true);
  const sourced = requestGenerateFromSource(typed);
  assert.equal(sourced.effect.body.basis, "from-source");
  assert.equal(sourced.effect.body.instruction, "теплее фон");
  assert.equal(sourced.effect.body.sourceImage, SOURCE);
  assert.equal(sourced.effect.body.previousImage, null);
  assert.equal(sourced.effect.body.anchorImage, null);
  assert.equal(requestGenerate(sourced.state).blocked, "pending");
  assert.equal(requestGenerateFromSource(sourced.state).blocked, "pending");

  const primary = requestGenerate(typed);
  assert.equal(primary.blocked, null);
  assert.equal(primary.effect.body.basis, "accepted");
  assert.equal(primary.effect.body.operation, "refine");
  assert.equal(primary.effect.body.instruction, "теплее фон");
  assert.equal(primary.effect.body.anchorImage, ANCHOR);
  assert.equal(primary.effect.body.previousImage, null);
  assert.equal(primary.effect.body.sourceImage, SOURCE);
  assert.equal(requestGenerateFromSource(primary.state).blocked, "pending");

  const appended = resolveGenerate(sourced.state, {
    ok: true,
    requestId: sourced.effect.requestId,
    dataUrl: C1,
  });
  assert.equal(appended.anchor.dataUrl, ANCHOR);
  assert.equal(appended.anchor.source.dataUrl, SOURCE);
  assert.equal(appended.modal.candidates.length, 1);
  assert.equal(appended.modal.index, 0);
  assert.equal(appended.modal.candidates[0].origin.kind, "source");
  assert.equal(view(appended).modal.candidateOrigin, "Этот вариант создан от исходного фото.");
  assert.equal(view(appended).modal.position, "Вариант 1 из 1");
});

test("an uploaded ready anchor offers only instructed refinement", () => {
  const seeded = openRefine(seedReadyAnchor(createState(), { dataUrl: ANCHOR, mime: "image/png" }));
  const modal = view(seeded).modal;
  assert.equal(modal.showGenerateFromSource, false);
  assert.equal(modal.generateLabel, "Создать вариант с уточнением");
  assert.equal(modal.generateEnabled, false);
  assert.equal(modal.basis, "Основа следующего варианта: текущий принятый образ.");
  assert.equal(modal.instructionHint || "", "");
  assert.equal(requestGenerate(seeded).blocked, "instruction-required");
  assert.equal(requestGenerateFromSource(seeded).blocked, "source-unavailable");
  const ready = setInstruction(seeded, "строже");
  assert.equal(view(ready).modal.generateEnabled, true);
  assert.equal(requestGenerate(ready).effect.body.basis, "accepted");
  assert.equal(requestGenerate(ready).effect.body.anchorImage, ANCHOR);
});

test("later candidates keep the selected basis and the source action separate", () => {
  let state = setInstruction(refineFromSource(), "строже");
  const first = requestGenerate(state);
  state = resolveGenerate(first.state, { ok: true, requestId: first.effect.requestId, dataUrl: C1 });
  state = setInstruction(state, "   ");
  const emptyPrimary = requestGenerate(state);
  assert.equal(emptyPrimary.blocked, null);
  assert.equal(emptyPrimary.effect.body.basis, "selected");
  assert.equal(emptyPrimary.effect.body.instruction, "");
  assert.equal(emptyPrimary.effect.body.previousImage, C1);
  assert.equal(view(state).modal.generateLabel, "Создать вариант на основе выбранного");

  const second = requestGenerate(setInstruction(state, ""));
  state = resolveGenerate(second.state, { ok: true, requestId: second.effect.requestId, dataUrl: C2 });
  state = undoCandidate(state);
  const later = view(state).modal;
  assert.equal(later.basis, "Для первой кнопки основа — Вариант 1.");
  assert.equal(later.showGenerateFromSource, true);
  assert.equal(/Основа следующего варианта/.test(later.basis), false);
  assert.match(later.instructionHint, /необязательн/i);
  assert.match(later.instructionHint, /кнопк/i);
  const branched = requestGenerate(state);
  assert.equal(branched.effect.body.basis, "selected");
  assert.equal(branched.effect.body.previousImage, C1);
  const fresh = requestGenerateFromSource(state);
  assert.equal(fresh.effect.body.basis, "from-source");
  assert.equal(fresh.effect.body.sourceImage, SOURCE);
  assert.equal(fresh.effect.body.previousImage, null);
  assert.equal(fresh.effect.body.anchorImage, null);
  assert.equal(state.anchor.dataUrl, ANCHOR);
});

function refineRetainedAsset() {
  const first = requestGenerate(photoReady());
  const created = resolveGenerate(first.state, { ok: true, requestId: first.effect.requestId, dataUrl: ANCHOR });
  const accepted = acceptDraft(created);
  accepted.anchor.source.assetId = "source-1";
  accepted.anchor.source.dataUrl = "/api/projects/00000000-0000-4000-8000-000000000001/visual/assets/source-1";
  return openRefine(accepted);
}

test("accepting a source-origin refine candidate reuses the retained identity asset", () => {
  let state = refineRetainedAsset();
  const generated = requestGenerateFromSource(state);
  state = resolveGenerate(generated.state, { ok: true, requestId: generated.effect.requestId, dataUrl: C1 });
  const payload = acceptPayload(state);
  assert.equal(payload.provenance, "generated_from_source");
  assert.equal(payload.sourceAssetId, "source-1");
  assert.equal(payload.sourceImageDataUrl, null);
  assert.equal(payload.imageDataUrl, C1);
  assert.equal(state.anchor.dataUrl, ANCHOR);
  assert.equal(state.anchor.source.assetId, "source-1");
});

test("accepting an accepted-anchor refinement does not send a new source", () => {
  let state = setInstruction(refineRetainedAsset(), "строже");
  const refined = requestGenerate(state);
  state = resolveGenerate(refined.state, { ok: true, requestId: refined.effect.requestId, dataUrl: C1 });
  const payload = acceptPayload(state);
  assert.equal(payload.provenance, "refined_from_accepted_anchor");
  assert.equal(payload.sourceAssetId, null);
  assert.equal(payload.sourceImageDataUrl, null);
  assert.equal(payload.imageDataUrl, C1);
});

test("ready upload and new-photo acceptance keep their existing source contracts", () => {
  const ready = setSelectedImage(choosePath(openCreate(createState()), "ready"), { dataUrl: ANCHOR, mime: "image/png" });
  const uploaded = acceptPayload(ready);
  assert.equal(uploaded.provenance, "uploaded_as_ready_anchor");
  assert.equal(uploaded.imageDataUrl, ANCHOR);
  assert.equal(uploaded.sourceAssetId, null);
  assert.equal(uploaded.sourceImageDataUrl, null);

  const first = requestGenerate(photoReady());
  const photo = resolveGenerate(first.state, { ok: true, requestId: first.effect.requestId, dataUrl: C1 });
  const created = acceptPayload(photo);
  assert.equal(created.provenance, "generated_from_source");
  assert.equal(created.sourceImageDataUrl, SOURCE);
  assert.equal(created.sourceAssetId, null);
});
