#!/usr/bin/env node
// Tier-2 eval metrics: numbers with no judgement in them.
//
// These are NOT quality scores. Their job is drift detection. When you edit a role
// prompt, you compare this output against the previous run and against the golden.
// A close-up ratio that jumps from 0.16 to 0.55 tells you which prompt edit did it,
// which no amount of reading the output would tell you as fast.
//
// Usage:
//   node tools/metrics.mjs <storyboard.json> [--json <out.json>] [--compare <other-metrics.json>]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
if (!positional.length) {
  console.error('usage: metrics.mjs <storyboard.json> [--json <out.json>] [--compare <metrics.json>]');
  process.exit(2);
}

const sb = readJson(resolve(positional[0]));
const devices = readJson(resolve(ROOT, 'catalog/devices.json'));

const scenes = sb.scenes ?? [];
const dialogue = scenes.filter((s) => s.kind === 'dialogue');
const lines = dialogue.flatMap((s) => s.lines);
const spoken = lines.filter((l) => l.text !== '');
const fps = sb.project?.fps ?? 30;

const g = (t) => Array.from(t).length;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n, d = 3) => Number(n.toFixed(d));
const ratio = (n, d) => (d === 0 ? 0 : round(n / d));

// --- layout and framing ---------------------------------------------------
const layoutCounts = {};
for (const s of dialogue) layoutCounts[s.layout] = (layoutCounts[s.layout] ?? 0) + 1;
const shotCounts = {};
for (const s of dialogue) for (const p of s.panels) shotCounts[p.shot] = (shotCounts[p.shot] ?? 0) + 1;
const closeScenes = dialogue.filter((s) => s.panels.some((p) => p.shot === 'close' || p.shot === 'extreme')).length;

// --- rhythm ---------------------------------------------------------------
const beatCounts = {};
for (const l of lines) beatCounts[l.beat] = (beatCounts[l.beat] ?? 0) + 1;
const sceneSeconds = dialogue.map((s) => s.durationFrames / fps);

// --- state churn ----------------------------------------------------------
const slotSig = (panels) => panels.map((p) => (p.kind === 'character' ? `${p.characterId}|${p.shot}|${p.flipHorizontal ? 'f' : ''}` : 'insert')).join(',');
let listenerChanges = 0, speakerShifts = 0, layoutChanges = 0, expressionChanges = 0;
for (let i = 1; i < dialogue.length; i++) {
  const prev = dialogue[i - 1], cur = dialogue[i];
  if (prev.layout !== cur.layout) layoutChanges++;
  if (slotSig(prev.panels) !== slotSig(cur.panels)) continue;
  const prevSpeakers = new Set(prev.lines.map((l) => l.speakerId));
  const curSpeakers = new Set(cur.lines.map((l) => l.speakerId));
  for (const [j, p] of cur.panels.entries()) {
    if (p.kind !== 'character' || p.expressionId === prev.panels[j]?.expressionId) continue;
    expressionChanges++;
    if (curSpeakers.has(p.characterId)) speakerShifts++;
    else if (!prevSpeakers.has(p.characterId)) listenerChanges++;
  }
}

// --- asset economy --------------------------------------------------------
const panelRefs = dialogue.flatMap((s) => s.panels.filter((p) => p.kind === 'character').map((p) => p.expressionId));
const distinctExpressions = new Set(panelRefs).size;
const sheetTotal = (sb.expressionSheets ?? []).reduce((n, sh) => n + sh.entries.length, 0);
const placeholders = (sb.expressionSheets ?? []).flatMap((sh) => sh.entries).filter((e) => e.asset?.kind === 'placeholder').length;

// --- longest static run ---------------------------------------------------
let longestStaticRun = 0, run = 1;
for (let i = 1; i < dialogue.length; i++) {
  if (JSON.stringify(dialogue[i].panels) === JSON.stringify(dialogue[i - 1].panels)) run++;
  else { longestStaticRun = Math.max(longestStaticRun, run); run = 1; }
}
longestStaticRun = Math.max(longestStaticRun, run);

// --- devices --------------------------------------------------------------
const deviceCounts = {};
for (const s of scenes) for (const d of s.devices ?? []) deviceCounts[d] = (deviceCounts[d] ?? 0) + 1;
const activeDeviceIds = devices.devices.filter((d) => d.status === 'active').map((d) => d.id);

// --- transitions ----------------------------------------------------------
const transitionCounts = {};
for (const s of scenes) transitionCounts[s.transitionIn?.kind ?? 'none'] = (transitionCounts[s.transitionIn?.kind ?? 'none'] ?? 0) + 1;

const metrics = {
  projectId: sb.project?.id ?? null,
  durationSeconds: round((sb.project?.totalDurationFrames ?? 0) / fps, 2),
  sceneCount: scenes.length,
  dialogueSceneCount: dialogue.length,
  templateSceneCount: scenes.filter((s) => s.kind === 'template').length,
  textCardSceneCount: scenes.filter((s) => s.kind === 'textCard').length,

  lineCount: lines.length,
  spokenLineCount: spoken.length,
  silentBeatCount: lines.filter((l) => l.beat === 'silentReaction').length,
  meanLineChars: spoken.length ? round(spoken.reduce((n, l) => n + g(l.text), 0) / spoken.length, 1) : 0,
  medianLineChars: median(spoken.map((l) => g(l.text))),
  maxLineChars: spoken.length ? Math.max(...spoken.map((l) => g(l.text))) : 0,
  linesOver120Chars: spoken.filter((l) => g(l.text) > 120).length,
  linesPerMinute: round(lines.length / ((sb.project?.totalDurationFrames ?? 1) / fps / 60), 1),

  layoutCounts,
  shotCounts,
  closeUpSceneRatio: ratio(closeScenes, dialogue.length),
  splitSceneRatio: ratio(layoutCounts.split2 ?? 0, dialogue.length),
  soloSceneRatio: ratio(layoutCounts.single ?? 0, dialogue.length),
  layoutChangeRatio: ratio(layoutChanges, Math.max(dialogue.length - 1, 1)),

  beatCounts,
  meanSceneSeconds: dialogue.length ? round(sceneSeconds.reduce((a, b) => a + b, 0) / dialogue.length, 2) : 0,
  medianSceneSeconds: round(median(sceneSeconds), 2),
  maxSceneSeconds: dialogue.length ? round(Math.max(...sceneSeconds), 2) : 0,

  expressionChanges,
  speakerShifts,
  listenerChanges,
  longestStaticRun,

  distinctExpressionsUsed: distinctExpressions,
  expressionSheetSize: sheetTotal,
  expressionReuseFactor: ratio(panelRefs.length, Math.max(distinctExpressions, 1)),
  placeholderAssetCount: placeholders,

  transitionCounts,
  deviceCounts,
  distinctDevicesUsed: Object.keys(deviceCounts).length,
  deviceCoverage: ratio(Object.keys(deviceCounts).length, activeDeviceIds.length),
  unusedActiveDevices: activeDeviceIds.filter((id) => !deviceCounts[id]),
  proposedDeviceCount: (sb.proposedDevices ?? []).length,
};

const jsonOut = flag('json');
if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify(metrics, null, 2) + '\n');

const comparePath = flag('compare');
if (comparePath) {
  const base = readJson(resolve(comparePath));
  console.log(`metric                        baseline        current       delta`);
  console.log('-'.repeat(66));
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v !== 'number') continue;
    const b = base[k];
    if (typeof b !== 'number') continue;
    const d = round(v - b, 3);
    const marker = Math.abs(d) > Math.max(Math.abs(b) * 0.25, 0.05) ? '  <-- drift' : '';
    console.log(`${k.padEnd(28)} ${String(b).padStart(10)} ${String(v).padStart(13)} ${String(d).padStart(11)}${marker}`);
  }
} else {
  console.log(JSON.stringify(metrics, null, 2));
}
