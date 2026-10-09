import { expandStoryboardFrames } from "../visual-model.mjs";

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=", "base64");

export function tinyJpeg() {
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xFF, 0xD9,
  ]);
}

export function heicLike() {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(24, 0);
  buffer.write("ftyp", 4);
  buffer.write("heic", 8);
  return buffer;
}

function utterance(id, text, speaker = "Путин") {
  return {
    id,
    kind: "utterance",
    segmentIds: [`seg-${id}`],
    speakerStatus: "explicit",
    speakerLabel: speaker,
    sourceQuote: `${speaker}: ${text}`,
    draftStart: 0,
    draftEnd: text.length,
    text,
  };
}

export function putinBoard() {
  const opening = "Первая. Вторая. Третья.";
  const sourceItems = [
    {
      id: "item-1",
      kind: "context",
      segmentIds: ["seg-context"],
      speakerStatus: "none",
      sourceQuote: "(встреча)",
      draftStart: 0,
      draftEnd: 9,
      text: "(встреча)",
    },
    utterance("item-2", opening),
  ];
  const frames = [{
    id: "frame-1",
    layout: "split2",
    origin: "source",
    panels: [{ description: "Путин говорит первую фразу" }, { description: "Дуров слушает" }],
    sourceItemId: "item-2",
    sourceRole: "utterance",
    speakerPanel: 0,
    directingBeat: true,
    segments: [
      {
        quote: "Первая. ",
        layout: "split2",
        speakerPanel: 0,
        panels: [{ description: "Путин говорит первую фразу" }, { description: "Дуров слушает" }],
      },
      {
        quote: "Вторая. ",
        layout: "split2",
        speakerPanel: 0,
        panels: [{ description: "Путин продолжает" }, { description: "Дуров слушает" }],
      },
      {
        quote: "Третья.",
        layout: "split2",
        speakerPanel: 0,
        panels: [{ description: "Путин заканчивает" }, { description: "Дуров слушает" }],
      },
    ],
  }];
  const lines = [
    "(далее пауза).",
    "ДМИТРИЙ СЕРГЕЕВИЧ!!",
    "(паника).",
    "Всем привет! Я использую WhatsApp!",
    "Опять пургу несёт.",
    "И что вы хотите от меня взамен?",
    "Нет.",
    "Заблокировать каналы?",
    "Нет.",
    "Что тогда?",
    "Пожалуйста, не выкладывайте фотографии с голым торсом.",
  ];
  lines.forEach((line, index) => {
    const itemId = `item-${index + 3}`;
    const frameId = `frame-${index + 2}`;
    const isAction = line.startsWith("(");
    sourceItems.push(isAction
      ? {
        id: itemId,
        kind: "action",
        segmentIds: [`seg-${itemId}`],
        speakerStatus: "none",
        sourceQuote: line,
        draftStart: 0,
        draftEnd: line.length,
        text: line,
      }
      : utterance(itemId, line));
    if (isAction) {
      frames.push({
        id: frameId,
        layout: "single",
        origin: "source",
        panels: [{ description: "Песков в кадре" }],
        sourceItemId: itemId,
        sourceRole: "action",
      });
      return;
    }
    frames.push({
      id: frameId,
      layout: "split2",
      origin: "source",
      panels: [{ description: "Путин говорит" }, { description: "Дуров слушает" }],
      sourceItemId: itemId,
      sourceRole: "utterance",
      speakerPanel: 0,
    });
  });
  return {
    sourceItems,
    frames,
    displayFrames: expandStoryboardFrames(frames),
    draft: sourceItems.map((item) => item.text).join("\n"),
    cast: {
      characters: [{ name: "Путин" }, { name: "Дуров" }, { name: "Песков" }],
      aliases: [],
      speakers: sourceItems.filter((item) => item.kind === "utterance").map((item) => ({
        sourceItemId: item.id,
        characterName: "Путин",
      })),
    },
  };
}
