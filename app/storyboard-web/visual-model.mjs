export const HYBRID_PROMPT_COMPILER_VERSION = "hybrid-dialogue-v2";

const STYLE_LANGUAGE = `
Rendering language:
- clearly illustrated rather than photorealistic
- heavy near-black contour
- a small number of large tonal groups
- broad, hard-edged light and shadow masses
- simplified graphic shapes for the face, hair, facial hair, and clothing
- minimal fine texture
- strong readability at small panel size`;

const HYBRID_NEGATIVE = [
  "No nested comic panels, gutters, borders, or split-screen layout inside the image.",
  "No dialogue, speech bubbles, captions, text, logos, or watermarks.",
  "Do not render any final comic page or nested split-panel framing.",
].join(" ");

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
  // Ordinary dialogue success uses hybrid compilers. This historical helper remains for
  // non-hybrid / non-ordinary paths and must not request split-layout nesting.
  return `Create one scene-specific storyboard panel${characterName ? ` featuring ${clean(characterName, 160)}` : ""}.

Panel description: ${clean(description)}
User revision request: ${clean(instruction) || "No additional revision."}
Frame framing: ${layout === "split2" ? "portrait-friendly panel crop for later assembly" : "single wide frame"}. ${role}

Role of the reference images:
${roles.length ? roles.join("\n") : "No reference image is supplied. Follow the panel description and rendering language."}

The finished image must visibly match the described action, emotion, gaze, pose, and composition. Keep the face, mouth, expression, gesture, and essential upper body safely inside the image so placement zoom can be adjusted later without losing them.
${STYLE_LANGUAGE}

No text, speech bubbles, logo, watermark, nested panels, gutters, or split-screen layout.`;
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

export function validateStyleRequired(styleAssetId) {
  if (!styleAssetId) return { ok: false, kind: "style-required" };
  return { ok: true };
}

export function validateAnchorRequired(anchorVersionId, { subjectRequired = true } = {}) {
  if (!subjectRequired) return { ok: true };
  if (!anchorVersionId) return { ok: false, kind: "anchor-required" };
  return { ok: true };
}

/**
 * Deterministic eligibility for the ordinary split-dialogue hybrid path.
 * Single, silent, action, and other out-of-scope frames remain on prior behavior.
 */
export function isEligibleHybridDialogueFrame(frame) {
  if (!frame || frame.layout !== "split2") return false;
  if (!Array.isArray(frame.panels) || frame.panels.length !== 2) return false;
  if (frame.silent === true) return false;
  if (frame.sourceRole === "action") return false;
  const dialogue = typeof frame.dialogue === "string" ? frame.dialogue.trim() : "";
  if (!dialogue) return false;
  if (!Number.isInteger(frame.speakerPanel) || frame.speakerPanel < 0 || frame.speakerPanel > 1) {
    return false;
  }
  return true;
}

/** People-free background prompt + style-only reference manifest. */
export function compileSceneBackgroundPrompt({
  sceneContinuity,
  compositionMode = "near-frontal-pair",
  styleAsset = null,
} = {}) {
  const styleCheck = validateStyleRequired(styleAsset?.id);
  if (!styleCheck.ok) return { ok: false, kind: styleCheck.kind };

  const prompt = [
    "Create one people-free scene background for a comic dialogue frame assembly.",
    `Scene continuity: ${clean(sceneContinuity || "shared interior for a conversation")}.`,
    `Composition support mode: ${clean(compositionMode, 80)}.`,
    "Image 1 is the approved project style authority. It controls rendering language only.",
    "Do not depict any people, faces, hands, silhouettes, reflections of people, or character identity traits.",
    "No furniture-scale props that imply a specific portrait subject. Keep the space empty of human presence.",
    STYLE_LANGUAGE.trim(),
    HYBRID_NEGATIVE,
    "Target aspect ratio: 21:9 wide scene plate suitable for later panel cropping.",
  ].join("\n");

  const manifest = [{
    role: "style",
    assetId: styleAsset.id,
    required: true,
  }];

  return {
    ok: true,
    prompt,
    promptCompilerVersion: HYBRID_PROMPT_COMPILER_VERSION,
    referenceManifest: manifest,
    images: [styleAsset],
    omittedReferences: [],
  };
}

function performanceRoleLabel({ role, panelIndex, speakerPanel }) {
  const normalized = clean(role, 40).toLowerCase();
  if (normalized === "speaker" || normalized === "speaking") return "speaking";
  if (normalized === "listener" || normalized === "listening" || normalized === "listening/reaction") {
    return "listening/reaction";
  }
  if (normalized === "reaction") return "listening/reaction";
  if (normalized === "silent") return "silent";
  if (Number.isInteger(speakerPanel)) {
    return panelIndex === speakerPanel ? "speaking" : "listening/reaction";
  }
  return "silent";
}

/**
 * Map structured gaze/screen tokens to provider-facing screen direction.
 * Relational intent survives as screen left/right only — never as an interlocutor name.
 */
export function screenDirectionForCharacterPrompt(gazeOrScreenDirection, { panelIndex = 0 } = {}) {
  const raw = clean(gazeOrScreenDirection, 160).toLowerCase();
  if (/(screen-right|rightward|inward-right|subtle-right|right-bias)/.test(raw)) {
    return "subtle screen-right";
  }
  if (/(screen-left|leftward|inward-left|subtle-left|left-bias)/.test(raw)) {
    return "subtle screen-left";
  }
  if (panelIndex === 0) return "subtle screen-right";
  if (panelIndex === 1) return "subtle screen-left";
  return "near-frontal";
}

/**
 * Single-character chromakey state prompt.
 * Identity and style remain distinct roles even when they resolve to the same asset id.
 *
 * Compiles only from character-performance structured fields. The human-readable panel
 * `description` remains available to callers for intent/diagnostics but must not be
 * copied wholesale into the provider prompt (scene nouns and interlocutor names leak).
 */
export function compileCharacterStatePrompt({
  characterName,
  description: _humanReadableDescription = null,
  compositionMode = "near-frontal-pair",
  panelIndex = 0,
  speakerPanel = null,
  role = null,
  expressionAndPose = null,
  shotScale = "chest-up",
  gazeOrScreenDirection = null,
  cropAndSafeMargins = null,
  prohibitedContent = null,
  offscreenOthers: _offscreenOthers = [],
  identityAsset = null,
  styleAsset = null,
  gazeHint = null,
} = {}) {
  const styleCheck = validateStyleRequired(styleAsset?.id);
  if (!styleCheck.ok) return { ok: false, kind: styleCheck.kind };
  const anchorCheck = validateAnchorRequired(identityAsset?.id, { subjectRequired: true });
  if (!anchorCheck.ok) return { ok: false, kind: anchorCheck.kind };

  const performanceRole = performanceRoleLabel({ role, panelIndex, speakerPanel });
  const expression = clean(
    expressionAndPose || "calm conversational near-frontal performance with mouth visible",
    400,
  );
  const scale = clean(shotScale || "chest-up", 80);
  const margins = clean(
    cropAndSafeMargins || "safe margins around head and shoulders for later placement zoom and pan",
    400,
  );
  const screenDirection = screenDirectionForCharacterPrompt(
    gazeOrScreenDirection || gazeHint,
    { panelIndex },
  );
  const prohibitions = Array.isArray(prohibitedContent) && prohibitedContent.length
    ? prohibitedContent.map((entry) => clean(entry, 80)).filter(Boolean)
    : [
      "nested-panels",
      "split-screen-layout",
      "second-visible-person",
      "dialogue-text",
      "speech-bubbles",
      "captions",
      "logos",
      "watermarks",
      "gutters",
      "borders",
    ];

  const sameAsset = identityAsset.id === styleAsset.id;
  const prompt = [
    `Create one reusable single-character visual state of ${clean(characterName, 160)} for comic compositing.`,
    `Assigned subject: exactly one person — ${clean(characterName, 160)} — and no one else.`,
    `Performance role: ${performanceRole}.`,
    `Expression and pose: ${expression}.`,
    `Head angle and gaze/screen direction: near-frontal head with ${screenDirection} gaze. Do not name or depict any other person.`,
    `Shot scale: ${scale}. Isolated chest-up character with mouth visible.`,
    `Safe margins: ${margins}.`,
    `Composition support mode (framing only, not a scene to draw): ${clean(compositionMode, 80)}.`,
    "Image 1 is the approved identity anchor. It controls who the person is.",
    sameAsset
      ? "Image 1 also carries the project style authority as a distinct required role (same underlying asset). Match that rendering language while preserving this person's identity only."
      : "Image 2 is the approved project style authority. It controls rendering language only; never copy that person's identity.",
    "Exactly one visible assigned person. No second person is present, even partially.",
    "Prohibit other body fragments, faces, heads, ears, shoulders, reflections, silhouettes, props, furniture, foreground surfaces, environmental objects, and scene fragments.",
    "Do not depict rooms, cabinets, tables, desks, telephones, folders, furniture, or any environmental/scene content — scene and props belong to the shared background path, not this character state.",
    "Fill every non-character pixel with a flat pure chroma-key green exactly #00FF00. No gradients, shadows, floor, wall, or surface behind the character.",
    `Structured prohibitions: ${prohibitions.join(", ")}.`,
    STYLE_LANGUAGE.trim(),
    HYBRID_NEGATIVE,
    "Target aspect ratio: 4:5.",
  ].join("\n");

  const referenceManifest = [
    { role: "identity", assetId: identityAsset.id, required: true },
    { role: "style", assetId: styleAsset.id, required: true },
  ];
  const images = sameAsset ? [identityAsset] : [identityAsset, styleAsset];

  return {
    ok: true,
    prompt,
    promptCompilerVersion: HYBRID_PROMPT_COMPILER_VERSION,
    referenceManifest,
    images,
    omittedReferences: [],
    hasDistinctStyleImage: !sameAsset,
  };
}
