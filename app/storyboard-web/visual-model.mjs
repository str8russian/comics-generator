import { PLACEMENT_DEFAULTS } from "../../prototypes/storyboard-viewer/frame-renderer.mjs";

const STYLE_LANGUAGE = `
Rendering language:
- clearly illustrated rather than photorealistic
- heavy near-black contour
- a small number of large tonal groups
- broad, hard-edged light and shadow masses
- simplified graphic shapes for the face, hair, facial hair, and clothing
- minimal fine texture
- strong readability at small panel size`;

/** Stable compiler identity for eligible panel-ready prompts (diagnostics in a later task). */
export const PANEL_READY_COMPILER_VERSION = "constrained-panel-intent/v1";

const CANONICAL_DEFAULTS = Object.freeze({
  framing: "chest-up",
  upperBody: "visible shoulders and upper torso",
  gesture: "hands outside crop",
  headPose: "near-frontal head",
  expression: "neutral",
  background: "solid-matte",
});

const HANDS_OUT_GESTURE = CANONICAL_DEFAULTS.gesture;

const FRAMING_PATTERNS = [
  { re: /\bwaist[-\s]?up\b/iu, value: "waist-up" },
  { re: /\bmedium\s+close[-\s]?up\b/iu, value: "medium-close-up" },
  { re: /\bchest[-\s]?up\b/iu, value: "chest-up" },
  { re: /\bhead[-\s]?and[-\s]?shoulders\b/iu, value: "head-and-shoulders" },
  { re: /\bclose[-\s]?up\b/iu, value: "close-up" },
  { re: /поясн(?:ой|ого|ом)?\s+план/iu, value: "waist-up" },
  { re: /по\s+грудь/iu, value: "chest-up" },
  { re: /крупн(?:ый|ого|ом)?\s+план/iu, value: "close-up" },
];

const WIDER_FRAMING_RE = /full[-\s]?body|full[-\s]?length|from\s+head\s+to\s+toe|во\s+весь\s+рост|в\s+полный\s+рост|ниже\s+пояса|below\s+the\s+waist/iu;

const GESTURE_PATTERNS = [
  { re: /open[-\s]?palm/iu, value: "open-palm hand raised in crop" },
  { re: /прав(?:ая|ую|ой)?\s+рук[аиуеой]*\s+(?:слегка\s+)?поднят/iu, value: "right hand raised in crop" },
  { re: /лев(?:ая|ую|ой)?\s+рук[аиуеой]*\s+(?:слегка\s+)?поднят/iu, value: "left hand raised in crop" },
  { re: /right\s+hand\s+raised(?:\s+in\s+(?:an\s+open-palm\s+gesture\s+in\s+)?crop)?/iu, value: "right hand raised in crop" },
  { re: /left\s+hand\s+raised(?:\s+in\s+crop)?/iu, value: "left hand raised in crop" },
  // Meaningful one-hand gestures from constrained Storyboarder prose (not idle edge visibility).
  { re: /(?:one\s+)?hand\s+raised\b/iu, value: "hand raised in crop" },
  { re: /(?:one\s+)?hand\s+lifted\b/iu, value: "hand raised in crop" },
  { re: /(?:one\s+)?hand\s+(?:making|extending|open)\b/iu, value: "hand gesture in crop" },
  { re: /(?:one\s+)?hand\s+clenched\b/iu, value: "hand clenched in crop" },
  { re: /both\s+hands\s+(?:lightly\s+)?raised\b/iu, value: "hands raised in crop" },
  // Idle / default phrasing is not a meaningful gesture; map to hands-out.
  { re: /hands\s+rest\s+in\s+crop|hands?\s+out(?:side)?\s+(?:of\s+|the\s+)?crop|руки\s+в\s+кадре|руки\s+вне\s+кадра/iu, value: HANDS_OUT_GESTURE },
];

function isHandsOutGesture(gesture) {
  return !gesture || gesture === HANDS_OUT_GESTURE;
}

const HEAD_POSE_PATTERNS = [
  { re: /head\s+turned\s+slightly\s+(?:toward\s+)?screen[-\s]?right|голов[аыу]\s+слегка\s+пов[её]рнут\p{L}*\s+вправо/iu, value: "head turned slightly screen-right" },
  { re: /head\s+turned\s+slightly\s+(?:toward\s+)?screen[-\s]?left|голов[аыу]\s+слегка\s+пов[её]рнут\p{L}*\s+влево/iu, value: "head turned slightly screen-left" },
  { re: /голов[аыу]\s+склонен\p{L}*|head\s+(?:lowered|tilted(?:\s+down)?)/iu, value: "head lowered" },
  { re: /near[-\s]?frontal\s+head|голов[аыу]\s+прямо/iu, value: "near-frontal head" },
];

const EXPRESSION_PATTERNS = [
  { re: /растерянн\p{L}*|confused|startled/iu, value: "confused" },
  { re: /раздраж[её]нн\p{L}*|irritated/iu, value: "irritated" },
  { re: /расслабленн\p{L}*\s+выражен|relaxed(?:\s+facial)?(?:\s+expression)?/iu, value: "relaxed" },
  { re: /уверенн\p{L}*\s+выражен|self[-\s]?confident/iu, value: "self-confident" },
  { re: /спокойн\p{L}*(?:\s+выражен|\s+лиц)?|\bcalm\b(?:\s+facial)?(?:\s+expression)?/iu, value: "calm" },
  { re: /\bneutral\b(?:\s+facial)?(?:\s+expression)?/iu, value: "neutral" },
];

const EYES_PATTERNS = [
  { re: /глаза\s+закрыт|closed\s+eyes|eyes\s+closed/iu, value: "closed" },
  { re: /широко\s+раскрыт\p{L}*\s+глаз|wide[-\s]?open\s+eyes/iu, value: "wide-open" },
];

const EYEBROW_PATTERNS = [
  { re: /поднят\p{L}*\s+бров|raised\s+eyebrows/iu, value: "raised" },
];

/** Gaze / look cues only — never head-turn wording such as «повёрнута вправо». */
const EXPLICIT_DIRECTION_RE = /screen[- ]?(left|right)|look(?:s|ing)?\s+(?:to\s+the\s+)?(left|right)|gazes?\s+(?:to\s+the\s+)?(left|right)|to[- ]camera|at[- ]camera|toward(?:s)?\s+camera|facing\s+camera|смотрит\s+влево|смотрит\s+вправо|взгляд\s+влево|взгляд\s+вправо|взгляд\s+прямо|взгляд\s+впер[её]д|на\s+камеру|в\s+камеру/i;

/** Relational look-at-partner language that may derive inward gaze only; never provider-facing prose. */
const RELATIONAL_PARTNER_RE = /looks?\s+at\s+the\s+other\s+panel\s+character|looking\s+at\s+the\s+other\s+panel\s+character|looks?\s+at\s+(?:the\s+)?(?:other|partner|counterpart)|looking\s+at\s+(?:the\s+)?(?:other|partner|counterpart)|toward(?:s)?\s+the\s+(?:other|partner)|at\s+(?:their\s+)?(?:interlocutor|partner)|смотрит\s+на\s+собеседник\p{L}*|взгляд\s+на\s+собеседник\p{L}*|смотрит\s+на\s+партн\p{L}*/iu;

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchFirst(text, patterns) {
  for (const { re, value } of patterns) {
    if (re.test(text)) return value;
  }
  return null;
}

function hasExplicitDirection(...texts) {
  return texts.some((text) => EXPLICIT_DIRECTION_RE.test(String(text ?? "")));
}

function hasRelationalPartnerDirection(texts, partnerName) {
  for (const text of texts) {
    const value = String(text ?? "");
    if (!value.trim()) continue;
    if (RELATIONAL_PARTNER_RE.test(value)) return true;
    if (partnerName) {
      // Avoid \\b: JS word boundaries do not treat Cyrillic letters as word chars.
      const named = new RegExp(
        `(?:смотрит|взглядом?|looks?|looking|gazes?|gazing)\\s+(?:на|at)\\s+${escapeRegExp(partnerName)}(?:а|у|ом|е)?(?=$|[\\s.,;:!?«»"'])`,
        "i",
      );
      if (named.test(value)) return true;
    }
  }
  return false;
}

function partnerNameForPanel(frame, panelIndex) {
  const panels = Array.isArray(frame?.panels) ? frame.panels : [];
  const other = panels[panelIndex === 0 ? 1 : 0];
  const name = other?.subject;
  return typeof name === "string" && name.trim() ? name.trim() : "";
}

function hasClosedEyes(text) {
  return /глаза\s+закрыт|closed\s+eyes|eyes\s+closed/iu.test(String(text ?? ""));
}

/** Remove head-pose spans so head-turn wording cannot be read as gaze. */
function stripHeadPoseForGaze(text) {
  return String(text ?? "")
    .replace(/head\s+turned\s+slightly\s+(?:toward\s+)?screen[-\s]?(?:left|right)/giu, " ")
    .replace(/голов[аыу]\s+слегка\s+пов[её]рнут\p{L}*\s+в(?:лево|право)/giu, " ")
    .replace(/голов[аыу]\s+склонен\p{L}*/giu, " ")
    .replace(/голов[аыу]\s+прямо/giu, " ")
    .replace(/near[-\s]?frontal\s+head/giu, " ");
}

function extractExplicitGaze(text) {
  // Gaze cues only after head-pose spans are removed.
  const value = stripHeadPoseForGaze(text);
  if (
    /to[-\s]?camera|at[-\s]?camera|toward(?:s)?\s+camera|facing\s+camera|на\s+камеру|в\s+камеру|взгляд\s+прямо|взгляд\s+впер[её]д|gaze\s+(?:toward\s+)?(?:straight\s+ahead|forward)/iu
      .test(value)
  ) {
    return "to-camera";
  }
  if (
    /screen[-\s]?right|gaze\s+(?:toward\s+)?screen[-\s]?right|look(?:s|ing)?\s+(?:to\s+the\s+)?right\b|gazes?\s+(?:to\s+the\s+)?right\b|смотрит\s+вправо|взгляд\s+вправо/iu
      .test(value)
  ) {
    return "screen-right";
  }
  if (
    /screen[-\s]?left|gaze\s+(?:toward\s+)?screen[-\s]?left|look(?:s|ing)?\s+(?:to\s+the\s+)?left\b|gazes?\s+(?:to\s+the\s+)?left\b|смотрит\s+влево|взгляд\s+влево/iu
      .test(value)
  ) {
    return "screen-left";
  }
  return null;
}

function extractFraming(text) {
  if (WIDER_FRAMING_RE.test(text)) return CANONICAL_DEFAULTS.framing;
  return matchFirst(text, FRAMING_PATTERNS) || CANONICAL_DEFAULTS.framing;
}

function extractUpperBody(text) {
  const value = String(text ?? "");
  const forward = /корпус\s+наклон[её]н\p{L}*\s+впер[её]д|forward[-\s]?lean(?:ing)?(?:\s+upper\s+body|\s+torso)?/iu.test(value);
  const upright = /выпрямленн\p{L}*\s+корпус|прямая\s+осанка(?:\s+торса)?|upright\s+torso/iu.test(value);
  const tenseShoulders = /напряж[её]нн\p{L}*\s+плеч/iu.test(value);
  const relaxedShoulders = /расслабленн\p{L}*\s+плеч|расправленн\p{L}*\s+плеч/iu.test(value);
  const visibleShoulders = /visible\s+shoulders/iu.test(value);

  if (forward) {
    if (tenseShoulders) return "forward-leaning torso with tense shoulders";
    return "forward-leaning upper body";
  }
  if (upright && tenseShoulders) return "upright torso with tense shoulders";
  if (upright && relaxedShoulders) return "upright torso with relaxed shoulders";
  if (upright && visibleShoulders) return "upright torso with visible shoulders";
  if (upright) return "upright torso with visible shoulders";
  if (tenseShoulders) return "upper body with tense shoulders";
  if (/visible\s+shoulders\s+and\s+upper\s+torso/iu.test(value)) {
    return "visible shoulders and upper torso";
  }
  if (/upright\s+torso\s+(?:with|and)\s+visible\s+shoulders/iu.test(value)) {
    return "upright torso with visible shoulders";
  }
  return CANONICAL_DEFAULTS.upperBody;
}

function resolveCanonicalGaze({
  description,
  instruction,
  panelIndex,
  hasPerformance,
  partnerName,
}) {
  if (hasPerformance === true) return null;
  // Closed eyes are the visible sleep/rest substitute; never invent a looking direction.
  if (hasClosedEyes(description)) return null;
  const fromDescription = extractExplicitGaze(description);
  if (fromDescription) return fromDescription;
  // Non-empty revision may carry explicit direction; do not invent inward gaze over it.
  // Instruction text itself is not mapped into canonical intent in this slice.
  if (hasExplicitDirection(instruction)) return null;
  // Relational partner language (and ordinary dialogue defaults) derive the same inward gaze.
  // partnerName is accepted so named look-at cues can be detected without becoming prompt text.
  hasRelationalPartnerDirection([description, instruction], partnerName);
  return panelIndex === 0 ? "screen-right" : "screen-left";
}

function gazeInstruction(gaze) {
  if (gaze === "to-camera") {
    return "Gaze: toward the camera / straight ahead.";
  }
  if (gaze !== "screen-right" && gaze !== "screen-left") return null;
  const inward = gaze === "screen-right" ? "right" : "left";
  const outer = gaze === "screen-right" ? "left" : "right";
  return (
    `Gaze: from the viewer's perspective, gently turn the head and face toward the viewer's ${inward} (screen-${inward}), `
    + `and direct both eyes toward the viewer's ${inward} (screen-${inward}). `
    + `Do not point the head, face, or either eye toward the viewer's ${outer} (screen-${outer}).`
  );
}

export function isEligiblePanelReadyDialogueFrame(frame) {
  if (!frame || frame.layout !== "split2") return false;
  if (!Array.isArray(frame.panels) || frame.panels.length !== 2) return false;
  if (!String(frame.dialogue ?? "").trim()) return false;
  if (!Number.isInteger(frame.speakerPanel) || (frame.speakerPanel !== 0 && frame.speakerPanel !== 1)) {
    return false;
  }
  if (frame.sourceRole === "action") return false;
  return true;
}

/** Frame- or panel-scoped authority preflight for eligible panel-ready dialogue only. */
export function validatePanelReadyAuthorities({
  frame,
  characters = [],
  styleSeedAssetId = null,
  panelIndex = null,
}) {
  if (!isEligiblePanelReadyDialogueFrame(frame)) return null;
  const indexes = Number.isInteger(panelIndex)
    ? [panelIndex]
    : frame.panels.map((_, index) => index);
  const byName = new Map((characters || []).map((character) => [character.name, character]));
  for (const index of indexes) {
    const panel = frame.panels[index];
    if (!panel || !String(panel.subject ?? "").trim()) {
      return { ok: false, status: "failed", kind: "subject-required", httpStatus: 409 };
    }
    const character = byName.get(panel.subject);
    if (!character?.approvedAnchorId) {
      return { ok: false, status: "failed", kind: "anchor-required", httpStatus: 409 };
    }
  }
  if (!styleSeedAssetId) {
    return { ok: false, status: "failed", kind: "style-required", httpStatus: 409 };
  }
  return { ok: true };
}

export function compilePanelReadyIntent({
  frame,
  panelIndex,
  characterName,
  description,
  instruction,
  hasPerformance = false,
  partnerName = null,
}) {
  const text = String(description ?? "");
  const side = panelIndex === 0 ? "left" : "right";
  const speaking = Number.isInteger(frame?.speakerPanel) && panelIndex === frame.speakerPanel;
  const partner = clean(partnerName ?? partnerNameForPanel(frame, panelIndex), 160);
  const gaze = resolveCanonicalGaze({
    description: text,
    instruction,
    panelIndex,
    hasPerformance,
    partnerName: partner,
  });

  return {
    compilerVersion: PANEL_READY_COMPILER_VERSION,
    characterName: clean(characterName, 160),
    framing: extractFraming(text),
    upperBody: extractUpperBody(text),
    gesture: matchFirst(text, GESTURE_PATTERNS) || CANONICAL_DEFAULTS.gesture,
    headPose: matchFirst(text, HEAD_POSE_PATTERNS) || CANONICAL_DEFAULTS.headPose,
    gaze,
    expression: matchFirst(text, EXPRESSION_PATTERNS) || CANONICAL_DEFAULTS.expression,
    eyes: matchFirst(text, EYES_PATTERNS),
    eyebrows: matchFirst(text, EYEBROW_PATTERNS),
    background: CANONICAL_DEFAULTS.background,
    // Internal derivation inputs only — not provider-facing relational prose.
    panelIndex,
    panelSide: side,
    speakingRole: speaking ? "speaking" : "listening",
    // Separate regen overlay channel; empty on the system-created acceptance path.
    instruction: clean(instruction),
    hasPerformance: hasPerformance === true,
  };
}

export function compilePanelReadyPrompt(intent, {
  hasPrevious = false,
  hasPerformance = false,
  hasStyle = false,
  identityAlsoStyle = false,
  previousDropped = false,
} = {}) {
  const roles = [];
  let next = 1;
  if (intent.characterName) {
    roles.push(
      identityAlsoStyle
        ? `Image ${next} is both the approved identity anchor for ${intent.characterName} and the project style anchor. It controls identity and rendering language only.`
        : `Image ${next} is the approved identity anchor for ${intent.characterName}. It controls identity.`,
    );
    next += 1;
  }
  if (hasStyle && !identityAlsoStyle) {
    roles.push(`Image ${next} is the project style anchor. It controls rendering language only, never identity or staging.`);
    next += 1;
  }
  if (hasPerformance) {
    roles.push(`Image ${next} is the performance reference. It controls pose, expression, gaze, head angle, composition, and crop, but never identity.`);
    next += 1;
  }
  if (hasPrevious && !previousDropped) {
    roles.push(`Image ${next} is the previous result for this panel. Use it as the staging draft and apply the requested revision.`);
  }

  const framingLabel = String(intent.framing || CANONICAL_DEFAULTS.framing);
  const gesture = intent.gesture || CANONICAL_DEFAULTS.gesture;
  const handsOut = isHandsOutGesture(gesture);
  const framingKeep = handsOut
    ? "face, mouth, expression, and essential upper body"
    : "face, mouth, expression, gesture, and essential upper body";
  const gestureLine = handsOut
    ? "Hands: keep hands outside the crop. Do not show resting or idle hands inside the frame."
    : `In-crop gesture: ${gesture}. Keep this meaningful hand gesture visible inside the crop.`;
  const gazeLine = intent.gaze
    ? gazeInstruction(intent.gaze)
    : hasPerformance
      ? "Do not add any independent gaze or head-direction instruction; the performance reference owns gaze and head angle."
      : null;

  const lines = [
    `Create one independent panel-ready character image${intent.characterName ? ` featuring ${intent.characterName}` : ""}.`,
    "",
    `Framing: crop-safe ${framingLabel} so the ${framingKeep} remain inside the image.`,
    `Visible upper-body geometry: ${intent.upperBody || CANONICAL_DEFAULTS.upperBody}.`,
    gestureLine,
    `Head: ${intent.headPose || CANONICAL_DEFAULTS.headPose}.`,
  ];
  if (gazeLine) lines.push(gazeLine);
  if (intent.eyes === "closed") {
    lines.push("Eyes: closed eyes. Do not add an open-eyed looking direction.");
  } else if (intent.eyes === "wide-open") {
    lines.push("Eyes: wide-open eyes.");
  }
  if (intent.eyebrows === "raised") {
    lines.push("Eyebrows: raised eyebrows.");
  }
  lines.push(`Facial expression: ${intent.expression || CANONICAL_DEFAULTS.expression}.`);
  lines.push("Background: solid matte fill. Do not invent a location, room, landscape, patterned backdrop, or scenic environment.");
  lines.push("Color: full-color rendering consistent with the approved project style / style-anchor color treatment. Do not render grayscale or monochrome.");
  lines.push("");
  lines.push("Role of the reference images:");
  lines.push(roles.length ? roles.join("\n") : "No reference image is supplied. Follow the canonical panel intent and approved authorities.");
  lines.push("");
  lines.push("Hard prohibitions:");
  lines.push("- exactly one person; no additional people");
  lines.push("- no nested panels and no split layout inside the generated image");
  lines.push("- no borders, captions, speech bubbles, dialogue bubbles, logos, watermarks, or generated text");
  lines.push("- no unwanted contradictory scene objects");
  lines.push("- no grayscale or monochrome rendering");
  lines.push("");
  lines.push("Generate only this single character image for later external assembly.");
  lines.push("");
  lines.push("Target aspect ratio: 5:4.");

  // Regeneration overlay remains separate from canonical panel intent; not filtered in this slice.
  const overlay = clean(intent.instruction);
  if (overlay) {
    lines.push("");
    lines.push(`User revision request: ${overlay}`);
  }

  return lines.join("\n");
}

export function resolvePanelSubject(description, characters, aliases = []) {
  const text = String(description ?? "").toLocaleLowerCase("ru");
  const candidates = [];
  for (const character of characters || []) {
    if (!character?.name) continue;
    candidates.push({ surface: character.name, characterName: character.name });
  }
  for (const alias of aliases || []) {
    if (!alias?.surface || !alias?.characterName) continue;
    candidates.push({ surface: alias.surface, characterName: alias.characterName });
  }
  let best = null;
  for (const candidate of candidates) {
    const index = text.indexOf(candidate.surface.toLocaleLowerCase("ru"));
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && candidate.surface.length > best.surface.length)) {
      best = { ...candidate, index };
    }
  }
  return best?.characterName ?? null;
}

export function expandStoryboardFrames(frames) {
  const expanded = [];
  for (const frame of frames || []) {
    if (frame?.directingBeat === true && Array.isArray(frame.segments) && frame.segments.length > 0) {
      let cursor = 0;
      frame.segments.forEach((segment, index) => {
        const start = Number.isInteger(segment.start) ? segment.start : cursor;
        const end = Number.isInteger(segment.end) ? segment.end : start + String(segment.quote || "").length;
        expanded.push({
          id: `${frame.id}#${index + 1}`,
          layout: segment.layout,
          origin: frame.origin,
          panels: segment.panels.map((panel) => ({ ...panel })),
          sourceItemId: frame.sourceItemId,
          sourceRole: frame.sourceRole,
          speakerPanel: segment.speakerPanel,
          dialogue: segment.quote,
          displayBlock: { sourceItemId: frame.sourceItemId, start, end },
          structureFrameId: frame.id,
          structureSegmentIndex: index,
          frameKind: segment.frameKind ?? frame.frameKind ?? null,
          textCard: segment.textCard ?? null,
          durationFrames: Number.isInteger(segment.durationFrames) ? segment.durationFrames : null,
        });
        cursor = end;
      });
      continue;
    }
    expanded.push({
      ...frame,
      panels: (frame.panels || []).map((panel) => ({ ...panel })),
      structureFrameId: frame.id,
      structureSegmentIndex: null,
    });
  }
  return expanded;
}

export function anchorPrompt({ characterName, identityComment, instruction, hasPrevious, hasStyle }) {
  const roles = [
    "Image 1 is the real identity reference. It controls who the person is: facial structure, age, hair, and stable traits.",
  ];
  let next = 2;
  if (hasPrevious) {
    roles.push(
      hasStyle
        ? `Image ${next} is the previous anchor candidate. Keep useful identity continuity from it, but do not preserve its rendering language when it conflicts with the project style anchor.`
        : `Image ${next} is the previous anchor candidate. Preserve what already works and apply the requested revision.`,
    );
    next += 1;
  }
  if (hasStyle) {
    roles.push(`Image ${next} is the approved project style anchor. It is the sole authority for rendering language: line weight, tonal groups, shading method, palette treatment, background treatment, and detail density. Never copy that person's facial traits, hair, clothing, or identity.`);
  }
  return `Create one base identity anchor for ${clean(characterName, 160)}.

${roles.join("\n")}

User identity direction: ${clean(identityComment) || "No additional direction."}
Current revision request: ${clean(instruction) || "Create the first candidate."}

Preserve the identity from Image 1 only. Produce a chest-up portrait with the mouth visible, a calm neutral near-frontal performance, comparable head size and safe margins, a plain unobtrusive background, and no other people.
${hasStyle
    ? "Match the project style anchor's rendering language exactly while keeping this person distinct."
    : STYLE_LANGUAGE}

Target aspect ratio: 4:5. No text, logo, or watermark.`;
}

export function panelPrompt({
  characterName,
  description,
  instruction,
  layout,
  panelIndex,
  speakerPanel,
  hasPrevious,
  hasPerformance,
  hasStyle,
}) {
  const roles = [];
  let next = 1;
  if (characterName) {
    roles.push(`Image ${next} is the approved identity anchor for ${clean(characterName, 160)}. It controls identity.`);
    next += 1;
  }
  if (hasPrevious) {
    roles.push(`Image ${next} is the previous result for this panel. Use it as the staging draft and apply the requested revision.`);
    next += 1;
  }
  if (hasPerformance) {
    roles.push(`Image ${next} is the performance reference. It controls pose, expression, gaze, head angle, composition, and crop, but never identity.`);
    next += 1;
  }
  if (hasStyle) {
    roles.push(`Image ${next} is the project style anchor. It controls rendering language only, never identity or staging.`);
  }
  const role = Number.isInteger(speakerPanel)
    ? (panelIndex === speakerPanel ? "This is the speaking panel." : "This is a listening or reaction panel.")
    : "This is a silent action panel.";
  return `Create one scene-specific storyboard panel${characterName ? ` featuring ${clean(characterName, 160)}` : ""}.

Panel description: ${clean(description)}
User revision request: ${clean(instruction) || "No additional revision."}
Layout: ${layout === "split2" ? "one side of a two-panel split screen" : "single wide frame"}. ${role}

Role of the reference images:
${roles.length ? roles.join("\n") : "No reference image is supplied. Follow the panel description and rendering language."}

The finished image must visibly match the described action, emotion, gaze, pose, and composition. Keep the face, mouth, expression, gesture, and essential upper body safely inside the image so placement zoom can be adjusted later without losing them.
${STYLE_LANGUAGE}

No text, speech bubbles, logo, or watermark.`;
}

export function aspectRatioForFrame(frame) {
  return frame?.layout === "split2" || (frame?.panels?.length ?? 0) > 1 ? "5:4" : "21:9";
}

export { PLACEMENT_DEFAULTS };

function roundPlacement(value) {
  return Math.round(value * 1000) / 1000;
}

function finiteIn(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function placement({
  zoom = PLACEMENT_DEFAULTS.zoom,
  positionX = PLACEMENT_DEFAULTS.positionX,
  positionY = PLACEMENT_DEFAULTS.positionY,
  mirrored = PLACEMENT_DEFAULTS.mirrored,
} = {}) {
  const x = Number(positionX);
  const y = Number(positionY);
  return {
    zoom: Number(zoom),
    positionX: x,
    positionY: y,
    mirrored: mirrored === true,
    position: `${x}% ${y}%`,
    align: `${x}% ${y}%`,
  };
}

export function resolvePlacementUpdate(current = {}, patch = {}) {
  if (patch?.reset === true) return { ...PLACEMENT_DEFAULTS };
  if (patch?.reset != null && patch.reset !== false) return null;
  const next = {
    zoom: Number(current.zoom ?? PLACEMENT_DEFAULTS.zoom),
    positionX: Number(current.positionX ?? current.position_x ?? PLACEMENT_DEFAULTS.positionX),
    positionY: Number(current.positionY ?? current.position_y ?? PLACEMENT_DEFAULTS.positionY),
    mirrored: current.mirrored === true,
  };
  if (Object.hasOwn(patch, "zoom")) next.zoom = Number(patch.zoom);
  if (Object.hasOwn(patch, "positionX")) next.positionX = Number(patch.positionX);
  if (Object.hasOwn(patch, "positionY")) next.positionY = Number(patch.positionY);
  if (Object.hasOwn(patch, "mirrored")) {
    if (typeof patch.mirrored !== "boolean") return null;
    next.mirrored = patch.mirrored;
  }
  if (!finiteIn(next.zoom, 1, 3) || !finiteIn(next.positionX, 0, 100) || !finiteIn(next.positionY, 0, 100)) {
    return null;
  }
  return {
    zoom: roundPlacement(next.zoom),
    positionX: roundPlacement(next.positionX),
    positionY: roundPlacement(next.positionY),
    mirrored: next.mirrored,
  };
}

/** Assemble up to three provider reference images without replacing identity authority. */
export function assembleAnchorReferences({ identity, previous = null, style = null }) {
  const slots = [];
  if (identity) slots.push({ role: "identity", asset: identity });
  if (previous) slots.push({ role: "previous", asset: previous });
  const styleId = style?.id ?? null;
  const identityId = identity?.id ?? null;
  const previousId = previous?.id ?? null;
  const styleDistinct = Boolean(styleId) && styleId !== identityId && styleId !== previousId;
  if (styleDistinct && slots.length < 3) slots.push({ role: "style", asset: style });
  const roles = new Set(slots.map((slot) => slot.role));
  const styleRepresented = Boolean(styleId) && (
    roles.has("style") || (previousId != null && previousId === styleId)
  );
  return {
    images: slots.map((slot) => slot.asset),
    roles,
    hasPrevious: roles.has("previous"),
    hasStyle: styleRepresented,
    styleDropped: Boolean(styleId) && styleDistinct && !roles.has("style"),
  };
}

function assembleHistoricalPanelReferences({
  anchor = null,
  previous = null,
  performance = null,
  style = null,
}) {
  const slots = [];
  if (anchor) slots.push({ role: "anchor", asset: anchor });
  if (previous) slots.push({ role: "previous", asset: previous });
  if (performance && slots.length < 3) slots.push({ role: "performance", asset: performance });
  const styleId = style?.id ?? null;
  const usedIds = new Set(slots.map((slot) => slot.asset?.id).filter(Boolean));
  const styleDistinct = Boolean(styleId) && !usedIds.has(styleId);
  if (styleDistinct && slots.length < 3) slots.push({ role: "style", asset: style });
  const roles = new Set(slots.map((slot) => slot.role));
  return {
    images: slots.map((slot) => slot.asset),
    roles,
    hasPrevious: roles.has("previous"),
    hasPerformance: roles.has("performance"),
    hasStyle: roles.has("style") || (previous?.id != null && previous.id === styleId),
    previousDropped: false,
    identityAlsoStyle: Boolean(styleId) && styleId === (anchor?.id ?? null) && !roles.has("style"),
  };
}

function assemblePanelReadyReferences({
  anchor = null,
  previous = null,
  performance = null,
  style = null,
}) {
  const slots = [];
  if (anchor) slots.push({ role: "anchor", asset: anchor });
  const styleId = style?.id ?? null;
  const anchorId = anchor?.id ?? null;
  const styleDistinct = Boolean(styleId) && styleId !== anchorId;
  if (styleDistinct) slots.push({ role: "style", asset: style });
  if (performance && slots.length < 3) slots.push({ role: "performance", asset: performance });
  const previousIncluded = Boolean(previous) && slots.length < 3;
  if (previousIncluded) slots.push({ role: "previous", asset: previous });
  const roles = new Set(slots.map((slot) => slot.role));
  const previousDropped = Boolean(previous) && !previousIncluded;
  return {
    images: slots.map((slot) => slot.asset),
    roles,
    hasPrevious: roles.has("previous"),
    hasPerformance: roles.has("performance"),
    hasStyle: roles.has("style") || (Boolean(styleId) && styleId === anchorId),
    previousDropped,
    identityAlsoStyle: Boolean(styleId) && styleId === anchorId,
  };
}

/** Assemble up to three panel reference images. Historical by default; panel-ready when requested. */
export function assemblePanelReferences({
  anchor = null,
  previous = null,
  performance = null,
  style = null,
  panelReady = false,
} = {}) {
  const refs = { anchor, previous, performance, style };
  return panelReady
    ? assemblePanelReadyReferences(refs)
    : assembleHistoricalPanelReferences(refs);
}
