import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MATTE_CONTRACT_SHA256,
  MATTE_CONTRACT_TEXT,
  MATTE_CONTRACT_VERSION,
} from "../foreground/contract.mjs";
import {
  anchorPrompt,
  compilePanelReadyIntent,
  compilePanelReadyPrompt,
  panelPrompt,
} from "../visual-model.mjs";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/foreground-prompt-baseline.json", import.meta.url), "utf8"));

const frame = {
  layout: "split2",
  speakerPanel: 0,
  dialogue: "Привет",
  panels: [
    {
      description: "Путин in a chest-up framing with upright torso and visible shoulders, calm facial expression.",
      subject: "Путин",
    },
    { description: "Дуров отвечает", subject: "Дуров" },
  ],
};

test("panel prompts append only the versioned matte contract", () => {
  const intent = compilePanelReadyIntent({
    frame,
    panelIndex: 0,
    characterName: "Путин",
    description: frame.panels[0].description,
    instruction: "",
    hasPerformance: false,
    partnerName: "Дуров",
  });
  const prompt = compilePanelReadyPrompt(intent, { hasStyle: true });
  assert.equal(prompt, `${baseline.prompt}\n\n${MATTE_CONTRACT_TEXT}`);
  assert.equal(prompt.startsWith(baseline.prompt), true);
  assert.equal(MATTE_CONTRACT_VERSION, "stage-a2-matte-contract-v1");
  assert.equal(MATTE_CONTRACT_SHA256, createHash("sha256").update(MATTE_CONTRACT_TEXT).digest("hex"));
  assert.match(prompt, new RegExp(MATTE_CONTRACT_VERSION));

  const historical = panelPrompt({
    characterName: "Песков",
    description: "Песков просыпается в панике",
    instruction: "eyes wider",
    layout: "single",
    panelIndex: 0,
    speakerPanel: 0,
    hasPrevious: true,
    hasPerformance: true,
    hasStyle: false,
  });
  assert.equal(historical, `${baseline.historical}\n\n${MATTE_CONTRACT_TEXT}`);
});

test("the base-anchor prompt is unchanged", () => {
  const anchor = anchorPrompt({
    characterName: "Песков",
    identityComment: "less realistic",
    instruction: "heavier contour",
    hasPrevious: true,
    hasStyle: true,
  });
  assert.equal(anchor, baseline.anchor);
  assert.equal(anchor.includes(MATTE_CONTRACT_VERSION), false);
  assert.equal(anchor.includes("Extraction-matte contract"), false);
});

test("panel generation provenance records the contract version", () => {
  const server = readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");
  assert.equal(server.includes("matteContractVersion: MATTE_CONTRACT_VERSION"), true);
  assert.equal(server.includes("matteContractSha256: MATTE_CONTRACT_SHA256"), true);
  assert.equal(server.includes("backfillPanelForeground"), false);
});
