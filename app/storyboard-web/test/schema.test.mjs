import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";

const interpretSchema = JSON.parse(readFileSync(new URL("../../../specs/001-structure-storyboard-tracer/contracts/interpret-response.schema.json", import.meta.url), "utf8"));
const stageSchema = JSON.parse(readFileSync(new URL("../../../specs/001-structure-storyboard-tracer/contracts/stage-response.schema.json", import.meta.url), "utf8"));

function compile(schema) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  return ajv.compile(structuredClone(schema));
}

const validateInterpret = compile(interpretSchema);
const validateStage = compile(stageSchema);

function sourceItem(overrides) {
  return {
    id: "item1",
    kind: "utterance",
    segmentIds: ["seg-0"],
    speakerStatus: "explicit",
    speakerLabel: "Аня",
    sourceQuote: "Аня: да",
    ...overrides,
  };
}

function stageFrame(overrides) {
  return {
    id: "frame1",
    layout: "single",
    origin: "source",
    panels: [{ description: "Крупный план" }],
    sourceItemId: "item1",
    sourceRole: "utterance",
    speakerPanel: 0,
    ...overrides,
  };
}

test("compiles both response schemas in strict mode", () => {
  assert.equal(typeof validateInterpret, "function");
  assert.equal(typeof validateStage, "function");
});

test("accepts explicit, inferred, and unresolved utterances", () => {
  assert.equal(validateInterpret({
    sourceItems: [sourceItem()],
  }), true);
  assert.equal(validateInterpret({
    sourceItems: [sourceItem({
      id: "item2",
      speakerStatus: "inferred",
      speakerLabel: "Борис",
      sourceQuote: "нет",
    })],
  }), true);
  const unresolved = sourceItem({
    id: "item3",
    speakerStatus: "unresolved",
    sourceQuote: "кто говорит",
  });
  delete unresolved.speakerLabel;
  assert.equal(validateInterpret({ sourceItems: [unresolved] }), true);
});

test("accepts action, context, and note only with speaker status none and no label", () => {
  for (const kind of ["action", "context", "note"]) {
    const item = sourceItem({
      id: kind + "1",
      kind,
      speakerStatus: "none",
      sourceQuote: "(" + kind + ")",
    });
    delete item.speakerLabel;
    assert.equal(validateInterpret({ sourceItems: [item] }), true, kind);
    assert.equal(validateInterpret({
      sourceItems: [sourceItem({
        id: kind + "Label",
        kind,
        speakerStatus: "none",
        speakerLabel: "Аня",
        sourceQuote: "(" + kind + ")",
      })],
    }), false, kind + " label");
    assert.equal(validateInterpret({
      sourceItems: [sourceItem({
        id: kind + "Speaker",
        kind,
        speakerStatus: "explicit",
        sourceQuote: "(" + kind + ")",
      })],
    }), false, kind + " status");
  }
});

test("requires sourceQuote and rejects a whitespace-only quote, utteranceQuote, and numeric offsets", () => {
  const missing = sourceItem();
  delete missing.sourceQuote;
  assert.equal(validateInterpret({ sourceItems: [missing] }), false);
  assert.equal(validateInterpret({
    sourceItems: [sourceItem({ sourceQuote: " \n\t" })],
  }), false);
  assert.equal(validateInterpret({
    sourceItems: [sourceItem({ utteranceQuote: "да" })],
  }), false);
  assert.equal(validateInterpret({
    sourceItems: [sourceItem({ start: 0, end: 4 })],
  }), false);
  assert.equal(validateInterpret({
    sourceItems: [sourceItem({ draftStart: 0 })],
  }), false);
});

test("accepts one panel for single and two panels for split2", () => {
  assert.equal(validateStage({
    frames: [stageFrame()],
    review: [],
  }), true);
  assert.equal(validateStage({
    frames: [stageFrame({
      layout: "split2",
      speakerPanel: 1,
      panels: [{ description: "Слева" }, { description: "Справа" }],
    })],
    review: [],
  }), true);
  assert.equal(validateStage({
    frames: [stageFrame({
      panels: [{ description: "Слева" }, { description: "Справа" }],
    })],
    review: [],
  }), false);
  assert.equal(validateStage({
    frames: [stageFrame({
      layout: "split2",
      speakerPanel: 0,
      panels: [{ description: "Только одна" }],
    })],
    review: [],
  }), false);
});

test("allows speakerPanel only on an utterance", () => {
  const action = stageFrame({ sourceRole: "action", sourceItemId: "action1" });
  delete action.speakerPanel;
  assert.equal(validateStage({ frames: [action], review: [] }), true);
  assert.equal(validateStage({
    frames: [stageFrame({ sourceRole: "action", sourceItemId: "action1", speakerPanel: 0 })],
    review: [],
  }), false);
  const derived = {
    id: "derived1",
    layout: "single",
    origin: "derived",
    panels: [{ description: "Пауза" }],
    placement: { afterSourceItemId: "item1" },
  };
  assert.equal(validateStage({ frames: [derived], review: [] }), true);
  assert.equal(validateStage({
    frames: [{ ...derived, speakerPanel: 0 }],
    review: [],
  }), false);
  const utterance = stageFrame();
  delete utterance.speakerPanel;
  assert.equal(validateStage({ frames: [utterance], review: [] }), false);
});

test("requires derived placement to name at least one adjacent source item", () => {
  const derived = {
    id: "derived1",
    layout: "single",
    origin: "derived",
    panels: [{ description: "Пауза" }],
  };
  assert.equal(validateStage({
    frames: [{ ...derived, placement: { beforeSourceItemId: "item1" } }],
    review: [],
  }), true);
  assert.equal(validateStage({
    frames: [{
      ...derived,
      placement: { afterSourceItemId: "note1", beforeSourceItemId: "item1" },
    }],
    review: ["note1"],
  }), true);
  assert.equal(validateStage({
    frames: [{ ...derived, placement: {} }],
    review: [],
  }), false);
  assert.equal(validateStage({ frames: [derived], review: [] }), false);
});

test("allows segments only when directingBeat is true", () => {
  const segments = [
    {
      quote: "Привет",
      layout: "single",
      speakerPanel: 0,
      panels: [{ description: "Первый жест" }],
    },
    {
      quote: "Пока",
      layout: "split2",
      speakerPanel: 1,
      panels: [{ description: "Слева" }, { description: "Справа" }],
    },
  ];
  assert.equal(validateStage({
    frames: [stageFrame({ directingBeat: true, segments })],
    review: [],
  }), true);
  assert.equal(validateStage({
    frames: [stageFrame({ segments })],
    review: [],
  }), false);
  assert.equal(validateStage({
    frames: [stageFrame({ directingBeat: false, segments })],
    review: [],
  }), false);
  assert.equal(validateStage({
    frames: [stageFrame({ directingBeat: true })],
    review: [],
  }), false);
  assert.equal(validateStage({
    frames: [stageFrame({ fontSize: 42, start: 0, end: 3 })],
    review: [],
  }), false);
});
