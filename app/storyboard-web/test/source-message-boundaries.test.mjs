import assert from "node:assert/strict";
import test from "node:test";
import { anchorDraft } from "../fidelity.mjs";
import { interpretDraft } from "../interpret.mjs";
import { buildChecked, stageStoryboard } from "../stage.mjs";

const LINES = [
  "Katerina 4+: Ilya?",
  "Ilya Zaigralov: Да",
  "Katerina 4+: A у тебя фамилия точно Zaigralov?",
  "Ilya Zaigralov: Да, а что?",
  "Katerina 4+: Просто ты своим спамом в чате ...",
  "Katerina 4+: ... всех уже изрядно ...",
  "Katerina 4+: ... подzaigral",
];
const DRAFT = LINES.join("\n");
const SPOKEN = [
  "Ilya?",
  "Да",
  "A у тебя фамилия точно Zaigralov?",
  "Да, а что?",
  "Просто ты своим спамом в чате ...",
  "... всех уже изрядно ...",
  "... подzaigral",
];
const SPEAKERS = [
  "Katerina 4+",
  "Ilya Zaigralov",
  "Katerina 4+",
  "Ilya Zaigralov",
  "Katerina 4+",
  "Katerina 4+",
  "Katerina 4+",
];

const env = {
  BASE_URL: "https://provider.example.test",
  CONTEST_API_TOKEN: "test-token",
  CONTEST_MODEL: "test-model",
};

function speakerSurface(quote) {
  return [{ id: "speaker-surface", quote, role: "speaker-label" }];
}

function explicit(id, label, quote, segmentIds) {
  return {
    id,
    kind: "utterance",
    segmentIds,
    speakerStatus: "explicit",
    speakerLabel: label,
    sourceQuote: quote,
  };
}

function groupedFixture() {
  return [
    explicit("m0", "Katerina 4+", LINES[0], ["seg-0"]),
    explicit("m1", "Ilya Zaigralov", LINES[1], ["seg-1"]),
    explicit("m2", "Katerina 4+", LINES[2], ["seg-2"]),
    explicit("m3", "Ilya Zaigralov", LINES[3], ["seg-3"]),
    explicit("m4", "Katerina 4+", LINES.slice(4).join("\n"), ["seg-4", "seg-5", "seg-6"]),
  ];
}

function assertSourceExact(draft, items) {
  assert.equal(items.length, LINES.length);
  assert.deepEqual(items.map((item) => item.text), SPOKEN);
  assert.deepEqual(items.map((item) => item.speakerLabel), SPEAKERS);
  assert.deepEqual(items.map((item) => item.speakerStatus), Array.from({ length: 7 }, () => "explicit"));
  for (const item of items) {
    assert.equal(item.kind, "utterance");
    assert.equal(draft.slice(item.draftStart, item.draftEnd), item.sourceQuote);
    assert.equal(item.text.includes("Katerina 4+:"), false);
    assert.equal(item.text.includes("Ilya Zaigralov:"), false);
  }
  const finalThree = items.slice(4);
  assert.equal(new Set(finalThree.map((item) => item.id)).size, 3);
  assert.deepEqual(finalThree.map((item) => item.sourceQuote), LINES.slice(4));
  for (let index = 1; index < items.length; index += 1) {
    assert.equal(items[index - 1].draftEnd <= items[index].draftStart, true);
  }
}

function completion(content) {
  return {
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{
          index: 0,
          message: { role: "assistant", content: JSON.stringify(content) },
          finish_reason: "stop",
        }],
      });
    },
  };
}

test("keeps each labelled source line when interpretation groups the final three", async () => {
  const anchored = anchorDraft(DRAFT, groupedFixture());
  assert.equal(anchored.ok, true);
  assertSourceExact(DRAFT, anchored.sourceItems);

  let providerCalls = 0;
  const fetchImpl = async (_url, init) => {
    providerCalls += 1;
    const body = JSON.parse(init.body);
    const user = JSON.parse(body.messages.find((message) => message.role === "user").content);
    if (Array.isArray(user.segments)) {
      return completion({
        sourceItems: groupedFixture(),
        characters: [
          { id: "katerina", name: "Katerina 4+" },
          { id: "ilya", name: "Ilya Zaigralov" },
        ],
        surfaceForms: [
          { id: "sk", quote: "Katerina 4+", role: "speaker-label", characterId: "katerina" },
          { id: "si", quote: "Ilya Zaigralov", role: "speaker-label", characterId: "ilya" },
        ],
      });
    }
    const utterances = user.sourceItems.filter((item) => item.kind === "utterance");
    return completion({
      frames: utterances.map((item, index) => ({
        id: `f${index}`,
        layout: "single",
        origin: "source",
        panels: [{ description: `Кадр ${index + 1}` }],
        sourceItemId: item.id,
        sourceRole: "utterance",
        speakerPanel: 0,
      })),
      review: [],
    });
  };

  const interpreted = await interpretDraft({
    draft: DRAFT,
    env,
    fetchImpl,
    acceptUnresolved: true,
  });
  assert.equal(interpreted.ok, true);
  assertSourceExact(DRAFT, interpreted.sourceItems);

  const staged = await stageStoryboard({
    draft: DRAFT,
    sourceItems: interpreted.sourceItems,
    env,
    fetchImpl,
  });
  assert.equal(staged.ok, true);
  const frames = staged.body.frames;
  assert.equal(frames.length, 7);
  assert.deepEqual(frames.map((frame) => frame.dialogue), SPOKEN);
  assert.deepEqual(frames.map((frame) => frame.sourceItemId), interpreted.sourceItems.map((item) => item.id));
  assert.equal(new Set(frames.slice(4).map((frame) => frame.sourceItemId)).size, 3);
  assert.deepEqual(frames.slice(4).map((frame) => frame.dialogue), SPOKEN.slice(4));
  assert.equal(providerCalls, 2);
});

test("keeps adjacent explicit messages distinct for both speakers and ellipses", () => {
  const differentDraft = "Аня: да\nБорис: нет";
  const differentItem = [explicit("merged", "Аня", differentDraft, ["seg-0", "seg-1"])];
  const unevidenced = anchorDraft(differentDraft, differentItem);
  assert.equal(unevidenced.ok, true);
  assert.equal(unevidenced.sourceItems.length, 1);
  assert.equal(unevidenced.sourceItems[0].speakerLabel, "Аня");
  assert.equal(unevidenced.sourceItems[0].text, "да\nБорис: нет");

  const different = anchorDraft(differentDraft, differentItem, speakerSurface("Борис"));
  assert.equal(different.ok, true);
  assert.deepEqual(different.sourceItems.map((item) => item.text), ["да", "нет"]);
  assert.deepEqual(different.sourceItems.map((item) => item.speakerLabel), ["Аня", "Борис"]);
  const differentStaged = buildChecked(differentDraft, different.sourceItems, {
    frames: different.sourceItems.map((item, index) => ({
      id: `d${index}`,
      layout: "single",
      origin: "source",
      panels: [{ description: `Кадр ${index + 1}` }],
      sourceItemId: item.id,
      sourceRole: "utterance",
      speakerPanel: 0,
    })),
    review: [],
  });
  assert.equal(differentStaged.ok, true);
  assert.deepEqual(differentStaged.body.frames.map((frame) => frame.dialogue), ["да", "нет"]);
  assert.deepEqual(
    differentStaged.body.frames.map((frame) => frame.sourceItemId),
    different.sourceItems.map((item) => item.id),
  );

  const same = anchorDraft("Аня: первый\nАня: второй", [
    explicit("merged", "Аня", "Аня: первый\nАня: второй", ["seg-0", "seg-1"]),
  ]);
  assert.equal(same.ok, true);
  assert.deepEqual(same.sourceItems.map((item) => item.text), ["первый", "второй"]);
  assert.deepEqual(same.sourceItems.map((item) => item.speakerLabel), ["Аня", "Аня"]);

  const ellipsis = anchorDraft("Аня: конец ...\nАня: ... начало", [
    explicit("merged", "Аня", "Аня: конец ...\nАня: ... начало", ["seg-0", "seg-1"]),
  ]);
  assert.equal(ellipsis.ok, true);
  assert.deepEqual(ellipsis.sourceItems.map((item) => item.text), ["конец ...", "... начало"]);
  assert.equal(ellipsis.sourceItems[0].text.includes("Аня:"), false);

  const tight = anchorDraft("Аня:да\r\nБорис:нет", [
    explicit("merged", "Аня", "Аня:да\r\nБорис:нет", ["seg-0", "seg-1"]),
  ], speakerSurface("Борис"));
  assert.equal(tight.ok, true);
  assert.deepEqual(tight.sourceItems.map((item) => item.text), ["да", "нет"]);
  assert.deepEqual(tight.sourceItems.map((item) => item.speakerLabel), ["Аня", "Борис"]);

  const carried = anchorDraft("Аня: первая\nБорис: вторая\nещё", [
    explicit("merged", "Аня", "Аня: первая\nБорис: вторая\nещё", ["seg-0", "seg-1", "seg-2"]),
  ], speakerSurface("Борис"));
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.sourceItems.map((item) => item.text), ["первая", "вторая\nещё"]);
  assert.deepEqual(carried.sourceItems.map((item) => item.speakerLabel), ["Аня", "Борис"]);
  assert.deepEqual(carried.sourceItems.map((item) => item.segmentIds), [["seg-0"], ["seg-1", "seg-2"]]);
});

test("preserves one-line labels, separate speakers, continuations, and same-line items", () => {
  const oneLine = anchorDraft("Аня: да", [
    explicit("one", "Аня", "Аня: да", ["seg-0"]),
  ]);
  assert.equal(oneLine.ok, true);
  assert.equal(oneLine.sourceItems[0].text, "да");

  const separate = anchorDraft("Аня: да\nБорис: нет", [
    explicit("anya", "Аня", "Аня: да", ["seg-0"]),
    explicit("boris", "Борис", "Борис: нет", ["seg-1"]),
  ]);
  assert.equal(separate.ok, true);
  assert.deepEqual(separate.sourceItems.map((item) => item.text), ["да", "нет"]);
  assert.deepEqual(separate.sourceItems.map((item) => item.speakerLabel), ["Аня", "Борис"]);

  const continuation = anchorDraft("Аня: да\r\nпродолжение", [
    explicit("anya", "Аня", "Аня: да\r\nпродолжение", ["seg-0", "seg-1"]),
  ]);
  assert.equal(continuation.ok, true);
  assert.equal(continuation.sourceItems.length, 1);
  assert.equal(continuation.sourceItems[0].text, "да\r\nпродолжение");

  const ellipsisContinuation = anchorDraft("Аня: конец ...\n... продолжение", [
    explicit("anya", "Аня", "Аня: конец ...\n... продолжение", ["seg-0", "seg-1"]),
  ]);
  assert.equal(ellipsisContinuation.ok, true);
  assert.equal(ellipsisContinuation.sourceItems.length, 1);
  assert.equal(ellipsisContinuation.sourceItems[0].text, "конец ...\n... продолжение");

  const sameLine = anchorDraft("Путин: Привет. (пауза) Дуров: Пока.", [
    explicit("putin", "Путин", "Путин: Привет.", ["seg-0"]),
    {
      id: "pause",
      kind: "action",
      segmentIds: ["seg-0"],
      speakerStatus: "none",
      sourceQuote: "(пауза)",
    },
    explicit("durov", "Дуров", "Дуров: Пока.", ["seg-0"]),
  ]);
  assert.equal(sameLine.ok, true);
  assert.deepEqual(sameLine.sourceItems.map((item) => item.text), ["Привет.", "(пауза)", "Пока."]);
});

test("keeps an unresolved line after grouped explicit messages", async () => {
  const draft = "Аня: первый\nАня: второй\nбез подписи";
  const fetchImpl = async () => completion({
    sourceItems: [
      explicit("merged", "Аня", "Аня: первый\nАня: второй", ["seg-0", "seg-1"]),
      {
        id: "open",
        kind: "utterance",
        segmentIds: ["seg-2"],
        speakerStatus: "unresolved",
        sourceQuote: "без подписи",
      },
    ],
    characters: [{ id: "anya", name: "Аня" }],
    surfaceForms: [{ id: "sanya", quote: "Аня", role: "speaker-label", characterId: "anya" }],
  });
  const interpreted = await interpretDraft({
    draft,
    env,
    fetchImpl,
    acceptUnresolved: true,
  });
  assert.equal(interpreted.ok, true);
  assert.deepEqual(interpreted.sourceItems.map((item) => item.text), ["первый", "второй", "без подписи"]);
  assert.deepEqual(interpreted.sourceItems.map((item) => item.speakerStatus), ["explicit", "explicit", "unresolved"]);
  assert.equal(interpreted.sourceItems[2].speakerLabel, undefined);
});

test("keeps grouped explicit messages distinct when the label has punctuation or repeated spaces", () => {
  const labels = [
    "Мария-Анна",
    "O’Connor",
    "O'Connor",
    "Dr. X",
    "Котёнок № 1",
    "Анна  Мария",
  ];
  for (const label of labels) {
    const lines = [`${label}: первая`, `${label}: вторая`];
    const draft = lines.join("\n");
    const anchored = anchorDraft(draft, [
      explicit("merged", label, draft, ["seg-0", "seg-1"]),
    ]);
    assert.equal(anchored.ok, true, label);
    assert.equal(anchored.sourceItems.length, 2, label);
    assert.deepEqual(anchored.sourceItems.map((item) => item.text), ["первая", "вторая"], label);
    assert.deepEqual(anchored.sourceItems.map((item) => item.speakerLabel), [label, label], label);
    assert.deepEqual(anchored.sourceItems.map((item) => item.sourceQuote), lines, label);
    for (const item of anchored.sourceItems) {
      assert.equal(draft.slice(item.draftStart, item.draftEnd), item.sourceQuote, label);
      assert.equal(item.text.includes(`${label}:`), false, label);
    }
    const staged = buildChecked(draft, anchored.sourceItems, {
      frames: anchored.sourceItems.map((item, index) => ({
        id: `f${index}`,
        layout: "single",
        origin: "source",
        panels: [{ description: `Кадр ${index + 1}` }],
        sourceItemId: item.id,
        sourceRole: "utterance",
        speakerPanel: 0,
      })),
      review: [],
    });
    assert.equal(staged.ok, true, label);
    assert.deepEqual(staged.body.frames.map((frame) => frame.dialogue), ["первая", "вторая"], label);
    assert.deepEqual(
      staged.body.frames.map((frame) => frame.sourceItemId),
      anchored.sourceItems.map((item) => item.id),
      label,
    );
  }
});

test("keeps a colon inside a continuation when that prefix is not a speaker label", () => {
  const cases = [
    ["Аня: вот список", "первое: хлеб", "вот список\nпервое: хлеб"],
    ["Аня: ссылка ниже", "https://example.com", "ссылка ниже\nhttps://example.com"],
    ["Аня: уточнение", "время: 12:30", "уточнение\nвремя: 12:30"],
  ];
  for (const [first, second, spoken] of cases) {
    const draft = `${first}\n${second}`;
    const anchored = anchorDraft(draft, [
      explicit("anya", "Аня", draft, ["seg-0", "seg-1"]),
    ]);
    assert.equal(anchored.ok, true, second);
    assert.equal(anchored.sourceItems.length, 1, second);
    assert.equal(anchored.sourceItems[0].speakerLabel, "Аня", second);
    assert.equal(anchored.sourceItems[0].text, spoken, second);
    assert.equal(draft.slice(anchored.sourceItems[0].draftStart, anchored.sourceItems[0].draftEnd), draft, second);
    assert.equal(anchored.sourceItems.some((item) => ["первое", "https", "время"].includes(item.speakerLabel)), false);
  }
});
