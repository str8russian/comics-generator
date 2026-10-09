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

export function assemblePanelReferences({
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
  };
}
