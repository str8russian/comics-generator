import assert from "node:assert/strict";
import test from "node:test";
import { assessPanelIntent } from "../panel-intent.mjs";
import { buildChecked } from "../stage.mjs";
import { editStoryboard } from "../storyboard-edit.mjs";

const cast = {
  characters: [
    { id: "c-anya", name: "Аня" },
    { id: "c-boris", name: "Борис" },
    { id: "c-peskov", name: "Песков" },
  ],
  aliases: [
    { surface: "Дмитрий Сергеевич", characterId: "c-peskov" },
    { surface: "Anya", characterName: "Аня" },
  ],
};

export function supportedDescription(name, framing = "поясной план") {
  return [
    `${name}, ${framing},`,
    "прямая осанка торса и расправленные плечи,",
    "правая рука слегка поднята в кадре,",
    "голова слегка повёрнута вправо,",
    "взгляд вправо,",
    "спокойное выражение лица,",
    "сплошной матовый фон.",
  ].join(" ");
}

function singleFrame(description, extras = {}) {
  return {
    id: "f1",
    layout: "single",
    origin: "source",
    panels: [{ description }],
    sourceItemId: "u1",
    sourceRole: "utterance",
    speakerPanel: 0,
    ...extras,
  };
}

function sourceItems() {
  return [{
    id: "u1",
    kind: "utterance",
    segmentIds: ["seg-0"],
    speakerStatus: "explicit",
    speakerLabel: "Аня",
    sourceQuote: "Аня: Привет.",
    draftStart: 0,
    draftEnd: 12,
    text: "Привет.",
  }];
}

function codes(result) {
  return (result.failures || []).map((failure) => failure.code);
}

test("exactly one cast-resolved character passes for an ordinary panel", () => {
  const result = assessPanelIntent(
    [singleFrame(supportedDescription("Аня"))],
    cast,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("zero character matches → panel-subject-required", () => {
  const result = assessPanelIntent(
    [singleFrame(supportedDescription("Неизвестный"))],
    cast,
  );
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("panel-subject-required"), true);
});

test("multiple distinct cast matches → panel-subject-ambiguous", () => {
  const description = supportedDescription("Аня").replace("Аня,", "Аня и Борис,");
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("panel-subject-ambiguous"), true);
});

test("multiple aliases for the same canonical character count as one", () => {
  const description = supportedDescription("Песков").replace(
    "Песков,",
    "Песков, Дмитрий Сергеевич,",
  );
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("English alias for the same character still counts as one", () => {
  const description = supportedDescription("Аня").replace("Аня,", "Аня, Anya,");
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("directing-beat segment panels are assessed for subject cardinality", () => {
  const frame = singleFrame(supportedDescription("Аня"), {
    directingBeat: true,
    segments: [
      {
        quote: "При",
        layout: "single",
        speakerPanel: 0,
        panels: [{ description: supportedDescription("Аня") }],
      },
      {
        quote: "вет.",
        layout: "single",
        speakerPanel: 0,
        panels: [{ description: supportedDescription("Аня").replace("Аня,", "Аня и Борис,") }],
      },
    ],
  });
  const result = assessPanelIntent([frame], cast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("panel-subject-ambiguous"), true);
  assert.equal(result.failures.some((f) => f.panelIndex === 0 && f.frameId === "f1"), true);
});

const unsupportedCases = [
  ["locations/scenery", "Аня, поясной план, в кабинете у окна, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["interiors", "Аня, поясной план, interior hallway, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["furniture", "Аня, поясной план, сидит на стуле, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["props/objects", "Аня, поясной план, держит телефон, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["additional people", "Аня, поясной план, crowd behind her, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["physical interaction", "Аня, поясной план, обнимает партнёра, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["visible text", "Аня, поясной план, надпись на груди, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["rendering-style", "Аня, поясной план, в стиле GTA, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["invisible narrative/temporal", "Аня, поясной план, потому что вспоминает прошлое, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
];

for (const [label, description] of unsupportedCases) {
  test(`unsupported category blocked: ${label}`, () => {
    const result = assessPanelIntent([singleFrame(description)], cast);
    assert.equal(result.ok, false, label);
    assert.equal(codes(result).includes("unsupported-panel-intent"), true, label);
  });
}

const supportDependent = [
  ["sitting", "Аня, поясной план, сидит прямо, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["standing", "Аня, поясной план, standing upright, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["lying", "Аня, поясной план, лежит, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["sleeping", "Аня, поясной план, sleeping, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["waking", "Аня, поясной план, просыпается, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["continuing-to-speak", "Аня, поясной план, продолжая говорить, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
  ["meeting-context", "Аня, поясной план, на встрече, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон."],
];

for (const [label, description] of supportDependent) {
  test(`support-dependent narrative rejected: ${label}`, () => {
    const result = assessPanelIntent([singleFrame(description)], cast);
    assert.equal(result.ok, false, label);
    assert.equal(codes(result).includes("unsupported-panel-intent"), true, label);
  });
}

test("sits upright is rejected even when upright torso also appears", () => {
  const description = "Аня, поясной план, sits upright, upright torso and tense shoulders, hand in crop, head straight, gaze forward, calm expression, solid matte background.";
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("unsupported-panel-intent"), true);
});

test("more-than-waist-up / full-body language → panel-framing-unsupported", () => {
  const description = "Аня, full-body, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон.";
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("panel-framing-unsupported"), true);
});

test("во весь рост framing is unsupported", () => {
  const description = "Аня, во весь рост, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон.";
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("panel-framing-unsupported"), true);
});

const acceptedFraming = [
  "close-up",
  "крупный план",
  "head-and-shoulders",
  "chest-up",
  "по грудь",
  "medium close-up",
  "waist-up",
  "поясной план",
];

for (const framing of acceptedFraming) {
  test(`accepted framing must not be treated as invalid: ${framing}`, () => {
    const result = assessPanelIntent(
      [singleFrame(supportedDescription("Аня", framing))],
      cast,
    );
    assert.equal(result.ok, true, framing);
  });
}

test("ready-passing description requires system solid-matte background", () => {
  const missing = supportedDescription("Аня").replace(", сплошной матовый фон.", ".");
  const result = assessPanelIntent([singleFrame(missing)], cast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("unsupported-panel-intent"), true);
});

test("English solid matte background wording is accepted", () => {
  const description = "Anya, waist-up, upright torso and open shoulders, right hand raised in crop, head turned slightly right, gaze to the right, calm expression, solid matte background.";
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("supported description using only allowed visible geometry/expression passes", () => {
  const result = assessPanelIntent(
    [singleFrame(supportedDescription("Борис", "chest-up"))],
    cast,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("buildChecked blocks unsupported Stage candidates via shared panel-intent gate", () => {
  const result = buildChecked(
    "Аня: Привет.",
    sourceItems(),
    {
      frames: [singleFrame("Аня в кабинете с телефоном")],
      review: [],
    },
    cast,
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(
    codes(result).some((code) => [
      "unsupported-panel-intent",
      "panel-subject-required",
      "panel-framing-unsupported",
    ].includes(code)),
    true,
  );
});

test("buildChecked accepts a complete supported board", () => {
  const result = buildChecked(
    "Аня: Привет.",
    sourceItems(),
    {
      frames: [singleFrame(supportedDescription("Аня"))],
      review: [],
    },
    cast,
  );
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.body.status, "checked");
  assert.equal(result.body.frames[0].dialogue, "Привет.");
});

test("editStoryboard rejects unsupported edit candidate through the same assessment", async () => {
  const result = await editStoryboard({
    draft: "Аня: Привет.",
    sourceItems: sourceItems(),
    cast,
    frames: [singleFrame(supportedDescription("Аня"))],
    displayFrames: null,
    instruction: "Сделай кадр 1 крупнее",
    env: {
      BASE_URL: "https://provider.example.test",
      CONTEST_API_TOKEN: "test-token",
      CONTEST_MODEL: "test-model",
    },
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                frames: [singleFrame(
                  "Аня, поясной план, сидит в комнате с книгой, прямая осанка торса, рука в кадре, голова прямо, взгляд вперёд, спокойное лицо, сплошной матовый фон.",
                )],
                review: [],
              }),
            },
            finish_reason: "stop",
          }],
        });
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "structure-rejected");
  assert.equal(result.status, "blocked");
  assert.equal(result.httpStatus, 409);
  assert.equal(
    codes(result).some((code) => [
      "unsupported-panel-intent",
      "panel-subject-required",
      "panel-subject-ambiguous",
      "panel-framing-unsupported",
    ].includes(code)),
    true,
  );
  assert.equal(Object.hasOwn(result, "body"), false);
});

test("Structure checkpoint: supported complete board is ready; mutations are blocked", () => {
  const items = [
    {
      id: "u1",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Аня",
      sourceQuote: "Аня: Привет.",
      draftStart: 0,
      draftEnd: 12,
      text: "Привет.",
    },
    {
      id: "a1",
      kind: "action",
      segmentIds: ["seg-1"],
      speakerStatus: "none",
      sourceQuote: "(пауза)",
      draftStart: 13,
      draftEnd: 20,
      text: "(пауза)",
    },
    {
      id: "u2",
      kind: "utterance",
      segmentIds: ["seg-2"],
      speakerStatus: "explicit",
      speakerLabel: "Борис",
      sourceQuote: "Борис: Пока.",
      draftStart: 21,
      draftEnd: 33,
      text: "Пока.",
    },
  ];
  const supported = {
    frames: [
      singleFrame(supportedDescription("Аня"), { id: "fAnya", sourceItemId: "u1" }),
      {
        id: "fPause",
        layout: "single",
        origin: "source",
        panels: [{ description: supportedDescription("Аня", "крупный план") }],
        sourceItemId: "a1",
        sourceRole: "action",
      },
      {
        id: "fBoris",
        layout: "split2",
        origin: "source",
        panels: [
          { description: supportedDescription("Борис", "chest-up") },
          { description: supportedDescription("Аня", "head-and-shoulders") },
        ],
        sourceItemId: "u2",
        sourceRole: "utterance",
        speakerPanel: 0,
      },
    ],
    review: [],
  };
  const ready = buildChecked("Аня: Привет.\n(пауза)\nБорис: Пока.", items, supported, cast);
  assert.equal(ready.ok, true, JSON.stringify(ready.failures));
  assert.equal(ready.body.status, "checked");
  assert.equal(ready.body.frames[0].dialogue, "Привет.");
  assert.equal(ready.body.frames[2].dialogue, "Пока.");
  for (const frame of ready.body.frames) {
    for (const panel of frame.panels) {
      assert.match(panel.description, /матовый|matte/i);
    }
  }

  const zero = buildChecked(
    "Аня: Привет.\n(пауза)\nБорис: Пока.",
    items,
    {
      ...supported,
      frames: supported.frames.map((frame, index) => (
        index === 0
          ? { ...frame, panels: [{ description: supportedDescription("Неизвестный") }] }
          : frame
      )),
    },
    cast,
  );
  assert.equal(zero.ok, false);
  assert.equal(codes(zero).includes("panel-subject-required"), true);

  const multi = buildChecked(
    "Аня: Привет.\n(пауза)\nБорис: Пока.",
    items,
    {
      ...supported,
      frames: supported.frames.map((frame, index) => (
        index === 0
          ? {
            ...frame,
            panels: [{ description: supportedDescription("Аня").replace("Аня,", "Аня и Борис,") }],
          }
          : frame
      )),
    },
    cast,
  );
  assert.equal(multi.ok, false);
  assert.equal(codes(multi).includes("panel-subject-ambiguous"), true);

  const scenery = buildChecked(
    "Аня: Привет.\n(пауза)\nБорис: Пока.",
    items,
    {
      ...supported,
      frames: supported.frames.map((frame, index) => (
        index === 2
          ? {
            ...frame,
            panels: [
              { description: `${supportedDescription("Борис")} в офисе` },
              frame.panels[1],
            ],
          }
          : frame
      )),
    },
    cast,
  );
  assert.equal(scenery.ok, false);
  assert.equal(codes(scenery).includes("unsupported-panel-intent"), true);
});

function withUnsupportedFragment(name, fragment) {
  return supportedDescription(name).replace(
    "прямая осанка торса и расправленные плечи,",
    `${fragment}, прямая осанка торса и расправленные плечи,`,
  );
}

const observedUnsupported = [
  ["проснувшийся", "проснувшийся"],
  ["продолжает говорить", "продолжает говорить"],
  ["передаёт слово", "передаёт слово"],
  ["окликает его", "окликает его"],
  ["обращается к присутствующим", "обращается к присутствующим"],
];

for (const [label, fragment] of observedUnsupported) {
  test(`observed unsupported scenario wording rejected: ${label}`, () => {
    const result = assessPanelIntent(
      [singleFrame(withUnsupportedFragment("Аня", fragment))],
      cast,
    );
    assert.equal(result.ok, false, label);
    assert.equal(codes(result).includes("unsupported-panel-intent"), true, label);
  });
}

test("approved однотонный матовый фон wording is accepted", () => {
  const description = supportedDescription("Аня").replace(
    "сплошной матовый фон.",
    "однотонный матовый фон.",
  );
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("approved матовый однотонный фон wording is accepted", () => {
  const description = supportedDescription("Аня").replace(
    "сплошной матовый фон.",
    "матовый однотонный фон.",
  );
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("stable gaze and understanding expression are not rejected by table/standing substrings", () => {
  const description = [
    "Anya, waist-up,",
    "upright torso and open shoulders,",
    "right hand raised in crop,",
    "head turned slightly right,",
    "stable gaze to the right,",
    "understanding expression,",
    "solid matte background.",
  ].join(" ");
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("standalone table and standing remain unsupported", () => {
  const table = [
    "Anya, waist-up,",
    "upright torso near a table,",
    "right hand raised in crop,",
    "head turned slightly right,",
    "gaze to the right,",
    "calm expression,",
    "solid matte background.",
  ].join(" ");
  const standing = [
    "Anya, waist-up,",
    "standing with upright torso,",
    "right hand raised in crop,",
    "head turned slightly right,",
    "gaze to the right,",
    "calm expression,",
    "solid matte background.",
  ].join(" ");
  assert.equal(assessPanelIntent([singleFrame(table)], cast).ok, false);
  assert.equal(codes(assessPanelIntent([singleFrame(table)], cast)).includes("unsupported-panel-intent"), true);
  assert.equal(assessPanelIntent([singleFrame(standing)], cast).ok, false);
  assert.equal(codes(assessPanelIntent([singleFrame(standing)], cast)).includes("unsupported-panel-intent"), true);
});

test("Распутин does not resolve as bounded cast surface Путин", () => {
  const putinCast = {
    characters: [{ id: "c-putin", name: "Путин" }],
    aliases: [],
  };
  const description = supportedDescription("Распутин");
  const result = assessPanelIntent([singleFrame(description)], putinCast);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes("panel-subject-required"), true);
});

test("punctuation-adjacent cast name still resolves", () => {
  const description = supportedDescription("Аня").replace("Аня,", "Аня:");
  const result = assessPanelIntent([singleFrame(description)], cast);
  assert.equal(result.ok, true, JSON.stringify(result));
});
