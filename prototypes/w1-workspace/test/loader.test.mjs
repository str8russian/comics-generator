import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { displayFrames, loadSnapshot, panelBasis } from "../public/model.mjs";
import { deriveStages } from "../public/stages.mjs";
import { createStore } from "../public/store.mjs";
import { fixtureRaw, prototypeRoot } from "./helpers.mjs";

const exported = join(prototypeRoot, "snapshot", "snapshot.json");

test("the synthetic fixture loads cleanly and covers every dialogue mode, a text card, and a beat", () => {
  const { model, warnings } = loadSnapshot(fixtureRaw());
  assert.deepEqual(warnings, []);
  assert.equal(model.source.method, "synthetic-fixture");
  const frames = displayFrames(model);
  assert.equal(frames.length, 7);
  assert.deepEqual(frames.map((frame) => frame.frameKind === "text" ? "text" : frame.dialogueMode),
    ["spoken", "spoken", "silent", "hidden", "text", "spoken", "spoken"]);
  assert.equal(frames[5].structureSegmentIndex, 0);
  assert.equal(frames[0].panels[0].asset, "/data/assets/anna-generated.svg");
  const kinds = new Set(frames.flatMap((frame) => frame.panels.map((panel) => panel.basis.kind)));
  assert.deepEqual([...kinds].sort(), ["base", "explicit", "missing", "specialized"]);
});

test("a local read-only export loads when present", { skip: !existsSync(exported) && "no local snapshot export" }, () => {
  const { model, warnings } = loadSnapshot(JSON.parse(readFileSync(exported, "utf8")));
  assert.equal(model.source.method, "read-only-sql");
  const frames = displayFrames(model);
  assert.ok(frames.length > 0);
  assert.ok(frames.some((frame) => frame.panels.length > 1));
  for (const frame of frames) {
    for (const panel of frame.panels) {
      if (panel.assetId) assert.ok(existsSync(join(prototypeRoot, "snapshot", panel.asset.replace("/data/", ""))), panel.asset);
    }
  }
  assert.ok(Array.isArray(warnings));
});

test("an unreadable snapshot degrades to an empty workspace with a visible note", () => {
  for (const raw of [null, "nonsense", [], { format: "other" }]) {
    const { model, warnings } = loadSnapshot(raw);
    assert.ok(warnings.length > 0);
    assert.equal(model.project.title, "Untitled project (title missing in snapshot)");
    assert.deepEqual(displayFrames(model), []);
    const stages = deriveStages({ model, frames: [], visualApproved: false, dirty: false });
    assert.equal(stages.video.chip, "Locked");
    assert.equal(stages.storyboard.next.stub, "stage_storyboard");
  }
});

test("partial frames and panel states become labels instead of crashes", () => {
  const raw = {
    format: "w1-workspace-snapshot/v1",
    project: { id: "p" },
    characters: [{ name: "Анна", anchor: { status: "approved", assetId: "a1" } }],
    storyboard: {
      frames: [
        { layout: "single", dialogue: "Привет", speakerPanel: 0, panels: [{ description: "Анна, close-up" }] },
        { id: "f2", layout: "split2", panels: "broken" },
        "not a frame",
        { id: "f3", layout: "single", dialogue: "", panels: [{ id: "p3", manualSubject: "Анна" }] },
        { id: "f4", layout: "single", dialogueMode: "spoken", dialogue: "Да", speakerPanel: 0, panels: [{ id: "p4" }] },
      ],
    },
    panelStates: { p4: { assetId: "gone", assetOrigin: "generation", zoom: "bad" } },
    assets: { a1: { file: "assets/a1.png" } },
  };
  const { model, warnings } = loadSnapshot(raw);
  const joined = warnings.join(" | ");
  assert.match(joined, /title is missing/);
  assert.match(joined, /not an object/);
  assert.match(joined, /unreadable panel list/);
  assert.match(joined, /id\(s\) were missing/);
  assert.match(joined, /no explicit dialogue mode/);
  const frames = displayFrames(model);
  assert.equal(frames.length, 4);
  assert.equal(frames[0].dialogueMode, "spoken");
  assert.equal(frames[1].panels.length, 0);
  assert.equal(frames[2].dialogueMode, "hidden");
  assert.equal(frames[2].panels[0].basis.kind, "base", "an approved anchor stands in as the base state");
  assert.equal(frames[2].panels[0].asset, "/data/assets/a1.png");
  assert.equal(frames[3].panels[0].assetMissing, true);
  assert.equal(frames[3].panels[0].zoom, 1);
  assert.equal(frames[3].visualReady, false);
  const store = createStore(model);
  assert.equal(store.dispatch({ op: "duplicateFrame", structureFrameId: "f2" }).ok, true);
});

test("basis priority is explicit override, then specialized, then base mapping", () => {
  const anchor = { url: "/data/anchor.png" };
  assert.equal(panelBasis({ assetId: "a", assetOrigin: "upload" }, anchor).kind, "explicit");
  assert.equal(panelBasis({ assetId: "a", assetOrigin: "reuse" }, anchor).kind, "explicit");
  assert.equal(panelBasis({ assetId: "a", assetOrigin: "generation" }, anchor).kind, "specialized");
  assert.equal(panelBasis({ assetId: null }, anchor).kind, "base");
  assert.equal(panelBasis(null, null).kind, "missing");
});
