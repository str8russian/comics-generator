/** Authoritative intro catalog. The browser receives a projection of this list; it does not redefine it. */

const EYEBROW = "ВИДЕОКОМИКС";
const ENTER_DURATION_FRAMES = 16;

const SEQUENCE = {
  namesStartFrame: 55,
  namesFadeFrame: 113,
  nameEnterFrames: 11,
  nameFadeFrames: 9,
  titleStartFrame: 122,
  titleEnterFrames: 16,
  closeStartFrame: 185,
  closeFrames: 15,
};

const NAME_START_FRAMES = {
  2: [55, 62],
  3: [55, 59, 63],
};

/** slot, character index, image index within that character, enter start frame */
const SHARD_LAYOUT = {
  2: [
    ["left-top", 0, 0, 0],
    ["left-bottom", 0, 1, 7],
    ["right-top", 1, 0, 17],
    ["right-bottom", 1, 1, 25],
    ["center-top", 0, 2, 11],
    ["center-bottom", 1, 2, 31],
  ],
  3: [
    ["left-top", 0, 0, 0],
    ["left-bottom", 0, 1, 7],
    ["right-top", 1, 0, 17],
    ["right-bottom", 1, 1, 25],
    ["center-top", 2, 0, 11],
    ["center-bottom", 2, 1, 31],
  ],
};

const MESSAGES = {
  "unknown-intro": "Этот шаблон интро недоступен.",
  "invalid-intro-version": "Версия шаблона интро не поддерживается.",
  "intro-no-cast": "Не удалось определить персонажей текущей раскадровки для интро.",
  "intro-missing-title": "У проекта нет названия для интро.",
  "intro-missing-anchor": "Для интро нужен утверждённый базовый образ каждого участвующего персонажа.",
  "intro-asset": "Изображение для интро не принадлежит этому проекту.",
};

export const INTRO_CATALOG = [
  {
    id: "story-shards-v1",
    version: 1,
    label: "Осколки истории",
    durationFrames: 201,
    fps: 30,
    minCharacters: 2,
    maxCharacters: 3,
    rendererKey: "story-shards-v1",
    slots: [
      { id: "eyebrow", kind: "text", description: "Серая надпись ВИДЕОКОМИКС" },
      { id: "title", kind: "text", description: "Название текущего проекта" },
      { id: "names", kind: "text", description: "Канонические имена участвующих персонажей по порядку появления" },
      { id: "shards", kind: "image", count: 6, description: "Шесть осколков с изображениями участвующих персонажей" },
    ],
  },
];

function failure(kind, template = null) {
  const message = kind === "intro-cast-count" && template
    ? `«${template.label}» доступны только для двух или трёх персонажей текущей раскадровки.`
    : MESSAGES[kind];
  return { ok: false, kind, message, httpStatus: 400 };
}

export function introRendererKey(templateId, version) {
  const template = INTRO_CATALOG.find((entry) => entry.id === templateId && entry.version === version);
  return template?.rendererKey ?? null;
}

export function isSupportedIntroRenderer(templateId, version) {
  return introRendererKey(templateId, version) != null;
}

export function normalizeIntroSelection(payload = {}) {
  const id = payload?.introTemplateId;
  if (id == null || id === "") return { ok: true, templateId: null, version: null };
  if (typeof id !== "string") return failure("unknown-intro");
  const template = INTRO_CATALOG.find((entry) => entry.id === id);
  if (!template) return failure("unknown-intro");
  if (Object.hasOwn(payload, "introTemplateVersion")
    && payload.introTemplateVersion != null
    && payload.introTemplateVersion !== template.version) {
    return failure("invalid-intro-version");
  }
  return { ok: true, templateId: template.id, version: template.version };
}

function participatingCharacters(visual) {
  const canonical = new Map();
  for (const character of visual?.characters || []) {
    if (character && typeof character.name === "string" && character.name) {
      canonical.set(character.name, character);
    }
  }
  const order = [];
  const seen = new Set();
  for (const frame of visual?.frames || []) {
    for (const panel of frame?.panels || []) {
      const subject = panel?.subject;
      if (typeof subject !== "string" || !canonical.has(subject) || seen.has(subject)) continue;
      seen.add(subject);
      order.push(canonical.get(subject));
    }
  }
  return order;
}

function characterAssets(character, visual, ownsAsset) {
  const anchor = character.approvedAssetId;
  if (typeof anchor !== "string" || !anchor) return failure("intro-missing-anchor");
  if (!ownsAsset(anchor)) return failure("intro-asset");
  const ordered = [anchor];
  for (const frame of visual?.frames || []) {
    for (const panel of frame?.panels || []) {
      if (panel?.subject !== character.name) continue;
      const id = panel.assetId;
      if (typeof id !== "string" || !id || ordered.includes(id) || !ownsAsset(id)) continue;
      ordered.push(id);
    }
  }
  return { ok: true, anchor, ordered };
}

function projectAssetUrl(assetOrigin, assetId) {
  if (!assetOrigin || !assetId) return null;
  return `${String(assetOrigin).replace(/\/$/, "")}/visual/assets/${assetId}`;
}

export function resolveIntro({
  templateId,
  version = null,
  visual,
  title,
  assetOrigin = "",
  ownsAsset,
} = {}) {
  const template = INTRO_CATALOG.find((entry) => entry.id === templateId);
  if (!template) return failure("unknown-intro");
  if (version != null && version !== template.version) return failure("invalid-intro-version");
  const characters = participatingCharacters(visual);
  if (characters.length === 0) return failure("intro-no-cast", template);
  if (characters.length < template.minCharacters || characters.length > template.maxCharacters) {
    return failure("intro-cast-count", template);
  }
  const projectTitle = typeof title === "string" ? title.trim() : "";
  if (!projectTitle) return failure("intro-missing-title", template);
  const owned = typeof ownsAsset === "function" ? ownsAsset : () => false;
  const perCharacter = characters.length === 2 ? 3 : 2;
  const filled = [];
  for (const character of characters) {
    const assets = characterAssets(character, visual, owned);
    if (!assets.ok) return assets;
    const slots = [];
    for (let index = 0; index < perCharacter; index += 1) {
      slots.push(assets.ordered[index] || assets.anchor);
    }
    filled.push({ character, slots });
  }
  const nameStarts = NAME_START_FRAMES[characters.length];
  const shards = SHARD_LAYOUT[characters.length].map(([slot, characterIndex, imageIndex, enterStartFrame]) => {
    const source = filled[characterIndex];
    const assetId = source.slots[imageIndex];
    return {
      slot,
      characterName: source.character.name,
      assetId,
      asset: projectAssetUrl(assetOrigin, assetId),
      enterStartFrame,
      enterDurationFrames: ENTER_DURATION_FRAMES,
    };
  });
  return {
    ok: true,
    intro: {
      templateId: template.id,
      version: template.version,
      durationFrames: template.durationFrames,
      text: {
        eyebrow: EYEBROW,
        title: projectTitle,
      },
      characters: filled.map((entry, index) => ({
        name: entry.character.name,
        nameStartFrame: nameStarts[index],
      })),
      shards,
      sequence: { ...SEQUENCE },
    },
  };
}

export function listIntroTemplates(input = {}) {
  return {
    templates: INTRO_CATALOG.map((template) => {
      const resolved = resolveIntro({ ...input, templateId: template.id, assetOrigin: "" });
      return {
        id: template.id,
        version: template.version,
        label: template.label,
        durationFrames: template.durationFrames,
        fps: template.fps,
        available: resolved.ok === true,
        reason: resolved.ok ? null : resolved.kind,
        message: resolved.ok ? null : resolved.message,
      };
    }),
  };
}

export function acceptedIntroSegment(intro) {
  if (!intro || typeof intro !== "object" || Array.isArray(intro)) return null;
  const template = INTRO_CATALOG.find((entry) => entry.id === intro.templateId && entry.version === intro.version);
  if (!template || intro.durationFrames !== template.durationFrames) return null;
  if (typeof intro.text?.title !== "string" || !intro.text.title.trim()) return null;
  if (intro.text?.eyebrow !== EYEBROW) return null;
  if (!Array.isArray(intro.characters)
    || intro.characters.length < template.minCharacters
    || intro.characters.length > template.maxCharacters) return null;
  if (!Array.isArray(intro.shards) || intro.shards.length !== 6) return null;
  if (!Number.isInteger(intro.sequence?.namesStartFrame)) return null;
  return intro;
}

export function collectIntroAssetIds(visual) {
  const ids = new Set();
  for (const character of visual?.characters || []) {
    if (typeof character?.approvedAssetId === "string" && character.approvedAssetId) {
      ids.add(character.approvedAssetId);
    }
  }
  for (const frame of visual?.frames || []) {
    for (const panel of frame?.panels || []) {
      if (typeof panel?.assetId === "string" && panel.assetId) ids.add(panel.assetId);
    }
  }
  return [...ids];
}
