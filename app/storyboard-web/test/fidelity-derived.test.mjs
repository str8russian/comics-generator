import assert from "node:assert/strict";
import test from "node:test";
import { anchorDraft, assessStage } from "../fidelity.mjs";

function codes(result) {
  assert.equal(result.ok, false);
  return result.failures.map((failure) => failure.code);
}

function anchored(draft, items) {
  const result = anchorDraft(draft, items);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  return result.sourceItems;
}

const draft = "[заметка]\nАня: да";
const items = () => anchored(draft, [
  {
    id: "note",
    kind: "note",
    segmentIds: ["seg-0"],
    speakerStatus: "none",
    sourceQuote: "[заметка]",
  },
  {
    id: "anya",
    kind: "utterance",
    segmentIds: ["seg-1"],
    speakerStatus: "explicit",
    speakerLabel: "Аня",
    sourceQuote: "Аня: да",
  },
]);

function utteranceFrame() {
  return {
    id: "fAnya",
    layout: "single",
    origin: "source",
    panels: [{ description: "Аня" }],
    sourceItemId: "anya",
    sourceRole: "utterance",
    speakerPanel: 0,
  };
}

function derived(placement, id = "fBeat") {
  return {
    id,
    layout: "single",
    origin: "derived",
    panels: [{ description: "Пауза" }],
    placement,
  };
}

test("accepts a derived beat that names the note and the next utterance", () => {
  const result = assessStage(items(), {
    frames: [
      derived({ afterSourceItemId: "note", beforeSourceItemId: "anya" }),
      utteranceFrame(),
    ],
    review: ["note"],
  });
  assert.equal(result.ok, true);
});

test("blocks a derived beat that skips the note", () => {
  const around = anchored("Борис: нет\n[заметка]\nАня: да", [
    {
      id: "boris",
      kind: "utterance",
      segmentIds: ["seg-0"],
      speakerStatus: "explicit",
      speakerLabel: "Борис",
      sourceQuote: "Борис: нет",
    },
    {
      id: "note",
      kind: "note",
      segmentIds: ["seg-1"],
      speakerStatus: "none",
      sourceQuote: "[заметка]",
    },
    {
      id: "anya",
      kind: "utterance",
      segmentIds: ["seg-2"],
      speakerStatus: "explicit",
      speakerLabel: "Аня",
      sourceQuote: "Аня: да",
    },
  ]);
  const result = assessStage(around, {
    frames: [
      {
        id: "fBoris",
        layout: "single",
        origin: "source",
        panels: [{ description: "Борис" }],
        sourceItemId: "boris",
        sourceRole: "utterance",
        speakerPanel: 0,
      },
      derived({ afterSourceItemId: "boris", beforeSourceItemId: "anya" }),
      utteranceFrame(),
    ],
    review: ["note"],
  });
  assert.deepEqual(codes(result), ["invalid-derived-beat"]);
});

test("blocks a derived beat that sits outside its gap", () => {
  const result = assessStage(items(), {
    frames: [
      utteranceFrame(),
      derived({ afterSourceItemId: "note", beforeSourceItemId: "anya" }),
    ],
    review: ["note"],
  });
  assert.deepEqual(codes(result), ["invalid-derived-beat"]);
});

test("blocks directing quotes that do not partition the spoken text", () => {
  const source = items();
  const result = assessStage(source, {
    frames: [{
      ...utteranceFrame(),
      directingBeat: true,
      segments: [
        {
          quote: "да",
          layout: "single",
          speakerPanel: 0,
          panels: [{ description: "Первый" }],
        },
        {
          quote: "лишнее",
          layout: "split2",
          speakerPanel: 1,
          panels: [{ description: "Лево" }, { description: "Право" }],
        },
      ],
    }],
    review: ["note"],
  });
  assert.deepEqual(codes(result), ["invalid-directing-beat"]);
});

test("blocks adjacent directing segments that share a composition", () => {
  const longer = anchored("Аня: да нет", [{
    id: "anya",
    kind: "utterance",
    segmentIds: ["seg-0"],
    speakerStatus: "explicit",
    speakerLabel: "Аня",
    sourceQuote: "Аня: да нет",
  }]);
  const shared = {
    quote: "",
    layout: "single",
    speakerPanel: 0,
    panels: [{ description: "Один жест" }],
  };
  const result = assessStage(longer, {
    frames: [{
      id: "fAnya",
      layout: "single",
      origin: "source",
      panels: [{ description: "Один жест" }],
      sourceItemId: "anya",
      sourceRole: "utterance",
      speakerPanel: 0,
      directingBeat: true,
      segments: [
        { ...shared, quote: "да " },
        { ...shared, quote: "нет" },
      ],
    }],
    review: [],
  });
  assert.deepEqual(codes(result), ["invalid-directing-beat"]);
});

test("blocks a directing frame whose composition differs from the first segment", () => {
  const longer = anchored("Аня: да нет", [{
    id: "anya",
    kind: "utterance",
    segmentIds: ["seg-0"],
    speakerStatus: "explicit",
    speakerLabel: "Аня",
    sourceQuote: "Аня: да нет",
  }]);
  const result = assessStage(longer, {
    frames: [{
      id: "fAnya",
      layout: "split2",
      origin: "source",
      panels: [{ description: "Лево" }, { description: "Право" }],
      sourceItemId: "anya",
      sourceRole: "utterance",
      speakerPanel: 1,
      directingBeat: true,
      segments: [
        {
          quote: "да ",
          layout: "single",
          speakerPanel: 0,
          panels: [{ description: "Первый" }],
        },
        {
          quote: "нет",
          layout: "split2",
          speakerPanel: 1,
          panels: [{ description: "Лево" }, { description: "Право" }],
        },
      ],
    }],
    review: [],
  });
  assert.deepEqual(codes(result), ["invalid-directing-beat"]);
});
