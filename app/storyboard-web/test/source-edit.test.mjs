import assert from "node:assert/strict";
import test from "node:test";
import { assessDialogue } from "../overflow.mjs";
import {
  applyExclusions,
  applyUtteranceToFrames,
  raisedDuration,
  reconcileExclusion,
  repartitionSegments,
  replaceSpokenSpan,
  speakingExclusion,
  utteranceImpactMessage,
} from "../source-edit.mjs";
import { minimumDurationFrames } from "../timing.mjs";

const prefix = "Владимир: ";
const spoken = "Что ты несешь, обезьяна ты ебаная?";
const line = `${prefix}${spoken}`;
const rest = "\nВладимир: Все в сборе";

test("replaces only the spoken span and shifts the next offset", () => {
  const text = `${line}${rest}`;
  const items = [
    {
      id: "u1",
      kind: "utterance",
      speakerStatus: "explicit",
      speakerLabel: "Владимир",
      sourceQuote: line,
      spokenText: spoken,
      draftStart: 0,
      draftEnd: line.length,
    },
    {
      id: "u2",
      kind: "utterance",
      speakerStatus: "explicit",
      speakerLabel: "Владимир",
      sourceQuote: "Владимир: Все в сборе",
      spokenText: "Все в сборе",
      draftStart: line.length + 1,
      draftEnd: text.length,
    },
  ];
  const nextSpoken = "Короче.";
  const result = replaceSpokenSpan({ text, items, sourceItemId: "u1", spokenText: nextSpoken });
  assert.equal(result.ok, true);
  assert.equal(result.text.startsWith(`${prefix}${nextSpoken}`), true);
  assert.equal(result.text.endsWith(rest), true);
  assert.equal(result.items[0].id, "u1");
  assert.equal(result.items[0].speakerLabel, "Владимир");
  assert.equal(result.items[1].id, "u2");
  assert.equal(result.items[1].sourceQuote, "Владимир: Все в сборе");
  assert.equal(result.text.slice(result.items[1].draftStart, result.items[1].draftEnd), result.items[1].sourceQuote);
});

test("blocks an unsafe directing repartition and accepts one inside a segment", () => {
  const segments = [
    { quote: "Раз, ", layout: "single", speakerPanel: 0, panels: [{ id: "p1", description: "Владимир" }] },
    { quote: "два.", layout: "split2", speakerPanel: 0, panels: [{ id: "p2", description: "Владимир" }] },
  ];
  const safe = repartitionSegments(segments, "Раз, дважды.");
  assert.equal(safe.ok, true);
  assert.equal(safe.segments[0].quote, "Раз, ");
  assert.equal(safe.segments[1].quote, "дважды.");
  assert.equal(safe.segments[1].panels[0].id, "p2");
  const blocked = repartitionSegments(segments, "Совсем другой текст");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.kind, "directing-repartition");
});

test("ordinary reflow keeps the structure frame and can change the display count", () => {
  const frames = [{
    id: "f1",
    sourceItemId: "u1",
    sourceRole: "utterance",
    layout: "single",
    speakerPanel: 0,
    dialogue: "Коротко.",
    displayBlock: { sourceItemId: "u1", start: 0, end: "Коротко.".length },
    panels: [{ id: "p1", description: "Владимир", assetId: "asset-1" }],
    durationFrames: 400,
  }];
  const longer = "Это гораздо более длинная реплика, которую компилятор может разбить.";
  const applied = applyUtteranceToFrames(frames, "u1", longer);
  assert.equal(applied.ok, true);
  assert.equal(applied.frames.length, 1);
  assert.equal(applied.frames[0].id, "f1");
  assert.equal(applied.frames[0].panels[0].id, "p1");
  assert.equal(applied.frames[0].panels[0].assetId, "asset-1");
  assert.equal(applied.frames[0].durationFrames, 400);
  assert.equal(applied.frames[0].retainedImageNotice.includes("изображение сохранено"), true);
  const minimum = minimumDurationFrames(longer);
  assert.equal(raisedDuration(12, longer) >= minimum, true);
  assert.equal(raisedDuration(400, "А"), 400);
  const assessed = assessDialogue(
    [{ id: "u1", kind: "utterance", text: longer }],
    applied.frames,
  );
  assert.equal(assessed.ok, true);
});

test("exclusion removes a derived listener and keeps a source remark", () => {
  const cast = {
    characters: [{ name: "Владимир" }, { name: "Андрей Сергеич" }],
    aliases: [],
  };
  const frames = [
    {
      id: "talk",
      sourceItemId: "u1",
      sourceRole: "utterance",
      origin: "source",
      layout: "split2",
      speakerPanel: 0,
      dialogue: "Так, я вижу, что Андрей Сергеич подключился",
      panels: [
        { id: "v", description: "Владимир крупно" },
        { id: "a", description: "Андрей Сергеич слушает", manualSubject: "Андрей Сергеич" },
      ],
    },
    {
      id: "remark",
      sourceItemId: "a1",
      sourceRole: "action",
      origin: "source",
      dialogue: "",
      panels: [{ id: "vr", description: "Владимир" }],
    },
    {
      id: "andrey-only",
      origin: "derived",
      dialogue: "",
      panels: [{ id: "only", description: "Андрей Сергеич один", manualSubject: "Андрей Сергеич" }],
    },
  ];
  const result = reconcileExclusion(frames, "Андрей Сергеич", cast);
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].layout, "single");
  assert.equal(result.frames[0].panels.length, 1);
  assert.equal(result.frames[0].panels[0].id, "v");
  assert.equal(result.frames[0].dialogue.includes("Андрей Сергеич"), true);
  assert.equal(result.frames[1].id, "remark");
  const blocked = reconcileExclusion([{
    id: "only-dialogue",
    sourceItemId: "u9",
    sourceRole: "utterance",
    origin: "source",
    dialogue: "реплика",
    panels: [{ id: "a", manualSubject: "Андрей Сергеич", description: "Андрей Сергеич" }],
  }], "Андрей Сергеич", cast);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.kind, "cast-reconciliation");
});

test("a speaking character cannot be excluded and a recheck keeps the extracted name out", () => {
  const cast = {
    characters: [
      { name: "Владимир", extractedName: "Владимир", included: false },
      { name: "Андрей Сергеич", extractedName: "Андрей Сергеич", included: false },
    ],
    aliases: [],
    speakers: [
      { sourceItemId: "u1", characterName: "Владимир" },
      { sourceItemId: "u2", characterName: "Владимир" },
    ],
  };
  const blocked = speakingExclusion(cast);
  assert.equal(blocked.kind, "speaking-character");
  assert.equal(blocked.message, utteranceImpactMessage(2));
  const fresh = applyExclusions({
    characters: [{ name: "Андрей Сергеич" }, { name: "Владимир" }],
    aliases: [],
    speakers: [],
  }, ["Андрей Сергеич"]);
  assert.equal(fresh.characters.find((character) => character.name === "Андрей Сергеич").included, false);
  assert.equal(fresh.characters.find((character) => character.name === "Владимир").included, true);
});
