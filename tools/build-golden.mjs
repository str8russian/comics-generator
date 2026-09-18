#!/usr/bin/env node
// Converts the hand-authored zayavka-v1 Remotion composition into schema-conformant JSON.
//
// The scene data below is transcribed from Zayavka.tsx and IntroSequences.tsx. The timing
// constants and the utteranceDuration formula are reproduced exactly, so the emitted
// totalDurationFrames must equal the shipped video's 4748 frames. That equality is the
// proof that the JSON format loses nothing from the original composition.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- constants copied from Zayavka.tsx -------------------------------------
const FPS = 30;
const CHARACTERS_PER_SECOND = 12;
const PRE_ROLL = 12;
const HOLD_AFTER_LINE = 36;

// --- constants copied from IntroSequences.tsx ------------------------------
const OPENING_DURATION = 75;
const PERSON_DURATION = 105;
const APPLICATION_DURATION = 240;

const BEAT_HOLD_FRAMES = {
  listItem: 18,
  acknowledgement: 24,
  quickBeat: 30,
  ordinary: HOLD_AFTER_LINE,
  punchline: 36,
  silentReaction: 42,
  emphasis: 48,
  explanation: 54,
  longExplanation: 66,
};

// Reverse map used to label the hand-tuned holds. Where two beats share a hold
// value the semantically correct one is chosen explicitly at the call site.
const BEAT_BY_HOLD = {
  18: 'listItem',
  24: 'acknowledgement',
  30: 'quickBeat',
  36: 'ordinary',
  42: 'silentReaction',
  48: 'emphasis',
  54: 'explanation',
  66: 'longExplanation',
};

const A = (path) => ({ kind: 'file', path: `assets/${path}` });

const expressionSheets = [
  {
    characterId: 'anton',
    basePortraitId: 'anton.weary-contempt',
    entries: [
      {
        id: 'anton.weary-contempt', label: 'weary contempt',
        descriptor: { valence: 'negative', intensity: 2, mouth: 'closed', gaze: 'to-camera', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('real-anton-01-weary-contempt.png'),
      },
      {
        id: 'anton.guarded-curiosity', label: 'guarded curiosity',
        descriptor: { valence: 'neutral', intensity: 1, mouth: 'closed', gaze: 'to-camera', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('real-anton-02-guarded-curiosity.png'),
      },
      {
        // The production failure here was the model reading this label as terror.
        // valence=negative + intensity=3 (not valence=fearful) is what disambiguates it.
        id: 'anton.disbelieving-astonishment', label: 'disbelieving astonishment',
        descriptor: { valence: 'negative', intensity: 3, mouth: 'slightly-open', gaze: 'to-camera', headOrientation: 'frontal', gesture: 'none' },
        suitableFor: ['speaking', 'listening', 'reaction'], flipSafe: true,
        asset: A('real-anton-03-disbelieving-astonishment.png'),
      },
      {
        id: 'anton.comic-confusion', label: 'comic confusion',
        descriptor: { valence: 'comedic', intensity: 2, mouth: 'slightly-open', gaze: 'screen-left', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('real-anton-04-comic-confusion.png'),
      },
      {
        id: 'anton.focused-engagement', label: 'focused engagement',
        descriptor: { valence: 'neutral', intensity: 2, mouth: 'closed', gaze: 'to-camera', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('real-anton-05-focused-engagement.png'),
      },
      {
        id: 'anton.evaluative-understanding', label: 'evaluative understanding',
        descriptor: { valence: 'neutral', intensity: 2, mouth: 'closed', gaze: 'to-camera', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('real-anton-06-evaluative-understanding.png'),
      },
      {
        // Initially marked speaking-only, which the validator rejected at d18 where Anton
        // holds his excitement while Roman deadpans the punchline. That hold is the joke.
        // The lesson: speaking-only is driven by an active GESTURE, not by emotional intensity.
        id: 'anton.excited-ideation', label: 'excited ideation',
        descriptor: { valence: 'positive', intensity: 3, mouth: 'open-speaking', gaze: 'to-camera', headOrientation: 'frontal', gesture: 'none' },
        suitableFor: ['speaking', 'listening', 'reaction'], flipSafe: true,
        asset: A('real-anton-07-excited-ideation.png'),
      },
      {
        id: 'anton.reluctantly-amused', label: 'reluctantly amused',
        descriptor: { valence: 'comedic', intensity: 2, mouth: 'slightly-open', gaze: 'to-camera', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['listening', 'reaction'], flipSafe: true,
        asset: A('real-anton-08-reluctantly-amused.png'),
      },
      {
        id: 'anton.title', label: 'title-card portrait',
        descriptor: { valence: 'neutral', intensity: 1, mouth: 'closed', gaze: 'to-camera', headOrientation: 'three-quarter-left', gesture: 'none' },
        suitableFor: ['titleCard'], flipSafe: false,
        asset: A('real-anton-title.png'),
      },
    ],
  },
  {
    characterId: 'veronika',
    basePortraitId: 'veronika.knowing-qualification',
    entries: [
      {
        id: 'veronika.knowing-qualification', label: 'knowing qualification',
        descriptor: { valence: 'neutral', intensity: 1, mouth: 'closed', gaze: 'screen-left', headOrientation: 'three-quarter-right', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('veronika-01-knowing-qualification.png'),
      },
      {
        // Active gesture => speaking-only. This single field is what makes the
        // listener-gesture bug impossible to express rather than merely detectable.
        id: 'veronika.quiet-confidence', label: 'quiet confidence, raised finger',
        descriptor: { valence: 'positive', intensity: 2, mouth: 'slightly-open', gaze: 'screen-left', headOrientation: 'three-quarter-right', gesture: 'raised-finger' },
        suitableFor: ['speaking'], flipSafe: true,
        asset: A('veronika-02-quiet-confidence.png'),
      },
      {
        id: 'veronika.active-explanation', label: 'active explanation, open hand',
        descriptor: { valence: 'neutral', intensity: 2, mouth: 'open-speaking', gaze: 'screen-left', headOrientation: 'three-quarter-right', gesture: 'open-hand' },
        suitableFor: ['speaking'], flipSafe: true,
        asset: A('veronika-03-active-explanation.png'),
      },
      {
        id: 'veronika.title', label: 'title-card portrait',
        descriptor: { valence: 'neutral', intensity: 1, mouth: 'closed', gaze: 'to-camera', headOrientation: 'three-quarter-right', gesture: 'none' },
        suitableFor: ['titleCard'], flipSafe: false,
        asset: A('veronika-title.png'),
      },
    ],
  },
  {
    characterId: 'roman',
    basePortraitId: 'roman.dry-interjection',
    entries: [
      {
        id: 'roman.dry-interjection', label: 'dry interjection',
        descriptor: { valence: 'comedic', intensity: 1, mouth: 'slightly-open', gaze: 'to-camera', headOrientation: 'frontal', gesture: 'none' },
        suitableFor: ['speaking', 'listening'], flipSafe: true,
        asset: A('roman-01-dry-interjection.png'),
      },
      {
        id: 'roman.deadpan-punchline', label: 'deadpan punchline',
        descriptor: { valence: 'comedic', intensity: 1, mouth: 'closed', gaze: 'screen-left', headOrientation: 'three-quarter-right', gesture: 'none' },
        suitableFor: ['speaking', 'listening', 'reaction'], flipSafe: true,
        asset: A('roman-02-deadpan-punchline.png'),
      },
      {
        id: 'roman.title', label: 'title-card portrait, neutral background',
        descriptor: { valence: 'neutral', intensity: 1, mouth: 'closed', gaze: 'to-camera', headOrientation: 'frontal', gesture: 'none' },
        suitableFor: ['titleCard'], flipSafe: false,
        asset: A('roman-title-neutral.png'),
      },
    ],
  },
];

// --- dialogue scenes transcribed from Zayavka.tsx --------------------------
// p() = panel, u() = utterance. hold defaults to HOLD_AFTER_LINE as in the original.
const p = (characterId, expressionId, shot = 'medium', flipHorizontal = false) =>
  ({ kind: 'character', characterId, expressionId, shot, flipHorizontal });
const u = (speakerId, text, hold, beat) => ({ speakerId, text, hold: hold ?? HOLD_AFTER_LINE, beat });

const dialogue = [
  { layout: 'single', panels: [p('anton', 'anton.weary-contempt')], lines: [u('anton', 'Ещё один ИИ-генератор видео?')], devices: ['DEV-SOLO-EMPHASIS', 'DEV-DELAYED-REVEAL'] },
  { layout: 'split2', panels: [p('anton', 'anton.weary-contempt'), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Формально — да. Но работает он иначе.')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-DELAYED-REVEAL'] },
  { layout: 'split2', panels: [p('anton', 'anton.guarded-curiosity'), p('veronika', 'veronika.knowing-qualification')], lines: [u('anton', 'Как именно?')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-SPEAKER-SHIFT'] },
  { layout: 'split2', panels: [p('anton', 'anton.guarded-curiosity'), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Сам ролик, как здесь написано, «рендерится» прямо на устройстве пользователя.', 54)], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-SPEAKER-SHIFT'] },
  { layout: 'single', panels: [p('anton', 'anton.disbelieving-astonishment', 'close')], lines: [u('anton', 'Стоп. Разве это вообще возможно?', 48)], devices: ['DEV-CLOSEUP-BEAT', 'DEV-SOLO-EMPHASIS'] },
  { layout: 'split2', panels: [p('anton', 'anton.disbelieving-astonishment'), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'ИИ готовит материалы на сервере. А приложение собирает из них видео уже на устройстве.', 54)], devices: ['DEV-SPLIT-DIALOGUE'] },
  { layout: 'split2', panels: [p('anton', 'anton.comic-confusion', 'medium', true), p('veronika', 'veronika.knowing-qualification')], lines: [u('anton', 'Погоди, я запутался. Давай с самого начала.'), u('anton', 'Допустим, я пользователь. Открыл приложение. Что от меня требуется?')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-GAZE-CORRECTION', 'DEV-SUSTAINED-HOLD'] },
  { layout: 'split2', panels: [p('anton', 'anton.comic-confusion', 'medium', true), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Выбрать фотографии главных героев и в двух словах описать их характеры.')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-SPEAKER-SHIFT'] },
  { layout: 'split2', panels: [p('anton', 'anton.comic-confusion', 'medium', true), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Если хочется, можно добавить идею сюжета или описать ситуацию.', 48)], devices: ['DEV-SUSTAINED-HOLD'] },
  { layout: 'split2', panels: [p('anton', 'anton.focused-engagement'), p('veronika', 'veronika.knowing-qualification')], lines: [u('anton', 'Хорошо. А дальше?')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-SPEAKER-SHIFT'] },
  { layout: 'split2', panels: [p('anton', 'anton.focused-engagement'), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Дальше ИИ работает как сценарист, режиссёр и художник: придумывает историю, раскладывает её по кадрам и рисует их как комикс.', 54)], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-SPEAKER-SHIFT'] },
  { layout: 'split2', panels: [p('anton', 'anton.focused-engagement'), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Затем приложение получает кадры, реплики и эффекты — и собирает готовое видео прямо на устройстве.', 66)], devices: ['DEV-SUSTAINED-HOLD'] },
  { layout: 'split2', panels: [p('anton', 'anton.evaluative-understanding'), p('veronika', 'veronika.knowing-qualification')], lines: [u('anton', 'Необычный подход.', 24), u('anton', 'А зачем люди будут им пользоваться?')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-BEAT-PAUSE'] },
  { layout: 'split2', panels: [p('anton', 'anton.evaluative-understanding'), p('veronika', 'veronika.active-explanation')], lines: [u('veronika', 'Чтобы быстро превращать любую идею в ролик — с собой, друзьями или известными людьми в главных ролях.')], devices: ['DEV-SPLIT-DIALOGUE', 'DEV-SPEAKER-SHIFT'] },
  { layout: 'split2', panels: [p('anton', 'anton.evaluative-understanding'), p('veronika', 'veronika.quiet-confidence')], lines: [u('veronika', 'Например, взять событие из спорта, шоу-бизнеса или политики и разыграть его по-своему.', 54)], devices: ['DEV-SPLIT-DIALOGUE'] },
  { layout: 'single', panels: [p('roman', 'roman.dry-interjection')], lines: [u('roman', 'Или спор в чате подъезда.', 54)], devices: ['DEV-SOLO-EMPHASIS'] },
  { layout: 'single', panels: [p('anton', 'anton.excited-ideation', 'close')], lines: [u('anton', 'Точно!', 18), u('anton', 'Месси против Роналду.', 18), u('anton', 'Демократы против республиканцев.', 24), u('anton', '… Шаман против Канье Уэста.', 30)], devices: ['DEV-CLOSEUP-BEAT', 'DEV-LIST-OF-THREE'] },
  { layout: 'split2', panels: [p('anton', 'anton.excited-ideation'), p('roman', 'roman.deadpan-punchline')], lines: [u('roman', 'И Зинаида Петровна против установки шлагбаума.', 36, 'punchline')], devices: ['DEV-SPLIT-DIALOGUE'] },
  { layout: 'single', panels: [p('anton', 'anton.reluctantly-amused', 'close')], lines: [u('anton', '', 42)], devices: ['DEV-SILENT-REACTION', 'DEV-CLOSEUP-BEAT'] },
];

// --- timing ---------------------------------------------------------------
const graphemeCount = (text) => Array.from(text).length; // matches Zayavka.tsx's Array.from
const revealFrames = (text) =>
  text.length === 0 ? 0 : Math.ceil((graphemeCount(text) / CHARACTERS_PER_SECOND) * FPS);

function buildLines(sceneIndex, lines) {
  return lines.map((line, i) => {
    const beat = line.beat ?? BEAT_BY_HOLD[line.hold];
    if (!beat) throw new Error(`no beat for hold ${line.hold} in scene ${sceneIndex}`);
    if (BEAT_HOLD_FRAMES[beat] !== line.hold) {
      throw new Error(`beat ${beat} implies ${BEAT_HOLD_FRAMES[beat]} frames, transcript says ${line.hold}`);
    }
    return {
      id: `d${String(sceneIndex + 1).padStart(2, '0')}.l${i + 1}`,
      speakerId: line.speakerId,
      text: line.text,
      beat,
      preRollFrames: PRE_ROLL,
      revealFrames: revealFrames(line.text),
      holdFrames: line.hold,
    };
  });
}

// --- template scenes transcribed from IntroSequences.tsx ------------------
const templateScenes = [
  {
    id: 't01', kind: 'template', templateId: 'opening-card', durationFrames: OPENING_DURATION,
    transitionIn: { kind: 'cut' }, devices: ['DEV-CONTEXT-OPENER'],
    slots: { supertitle: 'КОНКУРС ИИ-ПРОДУКТОВ', title: 'КАК МОГЛО БЫ ПРОХОДИТЬ', subtitle: 'РАССМОТРЕНИЕ ЗАЯВКИ' },
  },
  {
    id: 't02', kind: 'template', templateId: 'cast-title-card', durationFrames: PERSON_DURATION,
    transitionIn: { kind: 'cut' }, devices: ['DEV-CAST-TITLES'],
    slots: { number: '01', kicker: 'ЧЛЕН ЖЮРИ', name: 'АНТОН', role: 'РУКОВОДИТЕЛЬ КОНТЕНТ-ПРОЕКТОВ', accent: '#df7131', portrait: 'anton.title' },
  },
  {
    id: 't03', kind: 'template', templateId: 'cast-title-card', durationFrames: PERSON_DURATION,
    transitionIn: { kind: 'cut' }, devices: ['DEV-CAST-TITLES'],
    slots: { number: '02', kicker: 'ЧЛЕН ЖЮРИ', name: 'ВЕРОНИКА', role: 'ИСПОЛНИТЕЛЬНЫЙ ДИРЕКТОР', accent: '#56c7c5', portrait: 'veronika.title' },
  },
  {
    id: 't04', kind: 'template', templateId: 'cast-title-card', durationFrames: PERSON_DURATION,
    transitionIn: { kind: 'cut' }, devices: ['DEV-CAST-TITLES'],
    slots: { number: '03', kicker: 'ЧЛЕН ЖЮРИ', name: 'РОМАН', role: 'ИСПОЛНИТЕЛЬНЫЙ ДИРЕКТОР', accent: '#d5a23d', portrait: 'roman.title' },
  },
  {
    id: 't05', kind: 'template', templateId: 'context-document', durationFrames: APPLICATION_DURATION,
    transitionIn: { kind: 'cut' }, devices: ['DEV-CONTEXT-OPENER'],
    slots: {
      background: { kind: 'file', path: 'assets/application-pov-v2.png' },
      supertitle: 'ЗАЯВКА НА КОНКУРС ИИ-ПРОДУКТОВ',
      title: 'ИИ-ГЕНЕРАТОР ВИДЕОКОМИКСОВ',
      subtitle: 'Генератор персональных видеокомиксов',
      body: ['Фотографии людей + короткое описание', '↓', 'Рисованный ролик с ними в главных ролях'],
    },
  },
];

// --- assembly -------------------------------------------------------------
function build({ crossfades = false } = {}) {
  const dialogueScenes = dialogue.map((scene, i) => {
    const lines = buildLines(i, scene.lines);
    const durationFrames = lines.reduce((sum, l) => sum + l.preRollFrames + l.revealFrames + l.holdFrames, 0);
    return {
      id: `d${String(i + 1).padStart(2, '0')}`,
      kind: 'dialogue',
      layout: scene.layout,
      panels: scene.panels,
      lines,
      transitionIn: { kind: 'cut' },
      extraHoldFrames: 0,
      durationFrames,
      devices: scene.devices,
    };
  });

  const scenes = [...templateScenes, ...dialogueScenes];

  if (crossfades) {
    // Apply a crossfade wherever INV-012 permits one: same layout, same cast in the
    // same slots, same shot and flip, differing only in expression. Everything else
    // stays a hard cut. The rule is mechanical; no directorial judgement is involved.
    const sameSlots = (a, b) =>
      a.length === b.length &&
      a.every((pa, i) => {
        const pb = b[i];
        return pa.kind === 'character' && pb.kind === 'character' &&
          pa.characterId === pb.characterId && pa.shot === pb.shot &&
          Boolean(pa.flipHorizontal) === Boolean(pb.flipHorizontal);
      });
    for (let i = 1; i < scenes.length; i++) {
      const prev = scenes[i - 1], cur = scenes[i];
      if (prev.kind !== 'dialogue' || cur.kind !== 'dialogue') continue;
      if (prev.layout !== cur.layout) continue;
      if (!sameSlots(prev.panels, cur.panels)) continue;
      const changed = cur.panels.filter((pnl, j) => pnl.expressionId !== prev.panels[j].expressionId);
      if (changed.length === 0) continue;
      cur.transitionIn = { kind: 'crossfade', durationFrames: 6 };
    }
  }

  const totalDurationFrames = scenes.reduce((sum, s) => sum + s.durationFrames, 0);

  return {
    schemaVersion: '1.0.0',
    minimumRendererVersion: 1,
    requiredFeatures: [
      'layout.single', 'layout.split2', 'panel.flip', 'shot.close',
      'scene.template', 'text.typewriter',
      ...(crossfades ? ['transition.crossfade'] : []),
    ],
    project: {
      id: crossfades ? 'zayavka-v1-crossfade' : 'zayavka-v1',
      title: 'Как могло бы проходить рассмотрение заявки',
      language: 'ru-RU',
      targetDurationSeconds: 160,
      width: 1920,
      height: 1080,
      fps: FPS,
      totalDurationFrames,
      timing: {
        charactersPerSecond: CHARACTERS_PER_SECOND,
        preRollFrames: PRE_ROLL,
        beatHoldFrames: BEAT_HOLD_FRAMES,
      },
    },
    style: { presetId: 'cel-heavy-outline-01', kenBurnsScale: 1 },
    theme: {
      backgroundColor: '#02090b',
      panelGutterPx: 8,
      dialogueBarHeightPx: 300,
      dialogueBarColor: '#030607',
      dialogueBarBorderColor: '#536064',
      textColor: '#f6f4ed',
      fontFamily: 'Arial, Helvetica, sans-serif',
    },
    characters: [
      { id: 'anton', displayName: 'Антон', role: 'Руководитель контент-проектов', traits: 'Скептичный, прямой, быстро увлекается, когда понимает идею' },
      { id: 'veronika', displayName: 'Вероника', role: 'Исполнительный директор', traits: 'Спокойно объясняет, держит инициативу, говорит по делу' },
      { id: 'roman', displayName: 'Роман', role: 'Исполнительный директор', traits: 'Немногословный, вступает один раз и попадает в точку' },
    ],
    expressionSheets,
    scenes,
    notes: {
      provenance: 'Transcribed from zayavka-remotion/src/Zayavka.tsx and IntroSequences.tsx.',
      timingCheck: `totalDurationFrames must equal 4748 (158.27s at 30fps) to match out/zayavka-real-jury-silent-v2.mp4. Actual: ${totalDurationFrames}.`,
      beatLabelCaveat: 'Beat labels were reverse-engineered from hand-tuned hold values. In scene d17 the labels listItem/acknowledgement/quickBeat are mechanically correct but semantically approximate; the beat taxonomy is expected to be refined from further runs.',
      transitionCaveat: crossfades
        ? 'Crossfades applied mechanically wherever INV-012 permits. This file exists to A/B against the all-cuts original; it is NOT a transcription of the shipped video.'
        : 'The shipped video uses hard cuts exclusively. So does the GTA:CTW reference cutscene, verified frame by frame at every transition.',
    },
  };
}

function emit(relPath, data) {
  const abs = resolve(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${relPath}  (${data.project?.totalDurationFrames ?? '-'} frames)`);
}

const golden = build();
emit('golden/zayavka-full/storyboard.json', golden);
emit('golden/zayavka-full/storyboard.crossfade.json', build({ crossfades: true }));

// A deliberately broken storyboard. Every new invariant must be proved to fire against
// a real bad output before it is trusted; this file is that proof for INV-005, 007, 012, 017.
const bad = structuredClone(golden);
bad.project.id = 'zayavka-v1-broken';
// INV-005: an active gesturing, speaking-only image placed in a listener slot.
bad.scenes.find((s) => s.id === 'd10').panels[1].expressionId = 'veronika.active-explanation';
// INV-007: both panels change while the speaker stays the same across d11 -> d12.
bad.scenes.find((s) => s.id === 'd12').panels[0].expressionId = 'anton.evaluative-understanding';
// INV-012: a crossfade across a layout change.
bad.scenes.find((s) => s.id === 'd05').transitionIn = { kind: 'crossfade', durationFrames: 20 };
// INV-017: a speaker-name label leaking into the text.
bad.scenes.find((s) => s.id === 'd03').lines[0].text = 'Антон: Как именно?';
emit('evals/fixtures/broken-storyboard.json', bad);
