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
