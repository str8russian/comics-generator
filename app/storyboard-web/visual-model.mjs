const STYLE_LANGUAGE = `
Rendering language:
- clearly illustrated rather than photorealistic
- heavy near-black contour
- a small number of large tonal groups
- broad, hard-edged light and shadow masses
- simplified graphic shapes for the face, hair, facial hair, and clothing
- minimal fine texture
- strong readability at small panel size`;

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

const EXPLICIT_DIRECTION_RE = /screen[- ]?(left|right)|look(?:s|ing)?\s+(?:to\s+the\s+)?(left|right)|gazes?\s+(?:to\s+the\s+)?(left|right)|to[- ]camera|at[- ]camera|toward(?:s)?\s+camera|facing\s+camera|смотрит\s+влево|смотрит\s+вправо|взгляд\s+влево|взгляд\s+вправо|на\s+камеру|в\s+камеру|повернут[ао]?\s+влево|повернут[ао]?\s+вправо/i;

function hasExplicitDirection(...texts) {
  return texts.some((text) => EXPLICIT_DIRECTION_RE.test(String(text ?? "")));
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
}) {
  const side = panelIndex === 0 ? "left" : "right";
  const speaking = Number.isInteger(frame?.speakerPanel) && panelIndex === frame.speakerPanel;
  const role = speaking ? "speaking" : "listening";
  const explicitDirection = hasExplicitDirection(description, instruction);
  const suppressGazeFallback = explicitDirection || hasPerformance === true;
  const gazeFallback = suppressGazeFallback
    ? null
    : (panelIndex === 0 ? "screen-right" : "screen-left");
  return {
    characterName: clean(characterName, 160),
    description: clean(description),
    instruction: clean(instruction),
    panelIndex,
    panelSide: side,
    speakingRole: role,
    gazeFallback,
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

  const gazeLine = intent.gazeFallback
    ? `Gaze fallback for this ordinary conversational panel: subtle ${intent.gazeFallback}. Do not add any other gaze direction.`
    : hasPerformance
      ? "Do not add any independent gaze or head-direction instruction; the performance reference owns gaze and head angle."
      : "Follow any explicit gaze or head direction from the panel description or revision request. Do not add a conflicting inward gaze fallback.";

  const roleLine = intent.speakingRole === "speaking"
    ? "This is the speaking panel."
    : "This is a listening or reaction panel.";

  return `Create one independent panel-ready character image${intent.characterName ? ` featuring ${intent.characterName}` : ""}.

Panel side: ${intent.panelSide} panel of a two-character dialogue pair. ${roleLine}
Panel description: ${intent.description || "No additional description."}
User revision request: ${intent.instruction || "No additional revision."}
${gazeLine}

Role of the reference images:
${roles.length ? roles.join("\n") : "No reference image is supplied. Follow the panel description and rendering language."}

Produce a crop-safe chest-up framing with the face, mouth, expression, gesture, and essential upper body safely inside the image so later placement zoom does not crop them out.
Use a simple uniform non-scenic background. Do not invent a location, room, landscape, or scenic environment.

Hard prohibitions:
- exactly one person; no additional people
- no nested panels and no split layout inside the generated image
- no borders, captions, speech bubbles, dialogue bubbles, logos, watermarks, or generated text
- no unwanted contradictory scene objects

Generate only this single character image for later external assembly. Do not draw the partner, gutters, or a complete multi-panel page.
${STYLE_LANGUAGE}

Target aspect ratio: 5:4.`;
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

export function placement({ zoom = 1, positionX = 50, positionY = 30 } = {}) {
  return {
    zoom: Number(zoom),
    position: `${Number(positionX)}% ${Number(positionY)}%`,
    align: `${Number(positionX)}% ${Number(positionY)}%`,
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
