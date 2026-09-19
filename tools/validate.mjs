#!/usr/bin/env node
// Storyboard validator. Enforces every rule in catalog/invariants.json whose
// checkedBy is "validator". Rules checked here MUST NOT be repeated in role
// prompts: prompt budget is scarce, and a rule the machine enforces does not
// need to be remembered by a language model.
//
// Usage:
//   node tools/validate.mjs <storyboard.json> [--brief <brief.json>] [--json <out.json>] [--strict]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// --- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
};
if (positional.length === 0) {
  console.error('usage: validate.mjs <storyboard.json> [--brief <brief.json>] [--json <out.json>] [--strict]');
  process.exit(2);
}
const storyboardPath = resolve(positional[0]);
const briefPath = flag('brief');
const jsonOut = flag('json');
const strict = args.includes('--strict');

const sb = readJson(storyboardPath);
const brief = briefPath ? readJson(resolve(briefPath)) : null;
const devices = readJson(resolve(ROOT, 'catalog/devices.json'));
const schema = readJson(resolve(ROOT, 'schema/storyboard.schema.json'));
const invariants = readJson(resolve(ROOT, 'catalog/invariants.json'));
const stylePresets = readJson(resolve(ROOT, 'catalog/style-presets.json'));

// --- provenance and thresholds -------------------------------------------
// Thresholds are catalog data, not literals in this file. A number sitting in code cannot
// carry the record of who chose it, and every one of these was chosen rather than measured.
const ruleOf = new Map(invariants.rules.map((r) => [r.id, r]));

// House-style findings are printed and written to the JSON output, but excluded from the
// defect count: a run is not broken because it disagrees with a preference derived from one
// video. See provenanceMeaning in catalog/invariants.json.
const DIAGNOSTIC_PROVENANCE = new Set([
  'style-preset preference',
  'single-sample prior',
  'arbitrary initial threshold',
]);

for (const r of invariants.rules) {
  if (r.checkedBy !== 'validator') continue;
  if (r.severity === 'error' && DIAGNOSTIC_PROVENANCE.has(r.provenance)) {
    console.error(`catalog inconsistency: ${r.id} is severity "error" but provenance "${r.provenance}". An unvalidated preference may not invalidate a storyboard.`);
    process.exit(2);
  }
}

const threshold = (id, key) => {
  const v = ruleOf.get(id)?.threshold?.[key];
  if (v === undefined) {
    console.error(`missing threshold ${id}.${key} in catalog/invariants.json`);
    process.exit(2);
  }
  return v;
};

// Preset-keyed thresholds. Never substitute another preset's values: an unknown preset must
// surface as absent coverage, not as silent conformance to limits chosen for a different
// visual language.
const skippedRules = [];
const presetId = sb.style?.presetId ?? null;
const preset = stylePresets.presets.find((p) => p.id === presetId) ?? null;
const presetThreshold = (key, ruleId) => {
  const t = preset?.thresholds?.[key];
  if (t === undefined) {
    skippedRules.push({
      id: ruleId,
      reason: preset
        ? `style preset "${presetId}" defines no thresholds.${key}`
        : `style preset "${presetId}" is not in catalog/style-presets.json`,
    });
    return null;
  }
  return t.value;
};

// --- findings -------------------------------------------------------------
const findings = [];
const report = (id, severity, location, message) => findings.push({ id, severity, location, message });
const err = (id, location, message) => report(id, 'error', location, message);
const warn = (id, location, message) => report(id, 'warning', location, message);

// --- helpers --------------------------------------------------------------
const MIRROR_GAZE = { 'screen-left': 'screen-right', 'screen-right': 'screen-left' };
const MIRROR_HEAD = {
  'three-quarter-left': 'three-quarter-right',
  'three-quarter-right': 'three-quarter-left',
  'profile-left': 'profile-right',
  'profile-right': 'profile-left',
};
// INV-026 duplicate expression ids.
//
// Both this validator and the renderer resolve a panel's expressionId through one flat index.
// A repeated id used to win silently: the later entry replaced the earlier one, so every panel
// referencing it drew the other character's asset, and the INV-002 ownership check then fired
// on the innocent panel instead. The first definition is kept so the cascade is at least
// deterministic, and the duplicate is reported at the sheet that redefines it.
const entryIndex = new Map();
const entryOwner = new Map();
for (const sheet of sb.expressionSheets ?? []) {
  for (const e of sheet.entries ?? []) {
    if (entryIndex.has(e.id)) {
      const owner = entryOwner.get(e.id);
      err('INV-026', `expressionSheets ${sheet.characterId}`,
        `expression id "${e.id}" is already defined ${owner === sheet.characterId ? 'earlier in this sheet' : `by "${owner}"`}. ` +
        'Ids resolve through one flat index, so the duplicate would render the first definition\'s asset. ' +
        'Expect follow-on INV-002 findings on panels that meant the second one.');
      continue;
    }
    entryOwner.set(e.id, sheet.characterId);
    entryIndex.set(e.id, { ...e, characterId: sheet.characterId });
  }
}
const entryOf = (panel) => (panel.kind === 'character' ? entryIndex.get(panel.expressionId) : null);
const effGaze = (panel) => {
  const e = entryOf(panel);
  if (!e) return null;
  const g = e.descriptor.gaze;
  return panel.flipHorizontal ? (MIRROR_GAZE[g] ?? g) : g;
};
const effHead = (panel) => {
  const e = entryOf(panel);
  if (!e) return null;
  const h = e.descriptor.headOrientation;
  return panel.flipHorizontal ? (MIRROR_HEAD[h] ?? h) : h;
};
const dialogueScenes = (sb.scenes ?? []).filter((s) => s.kind === 'dialogue');
const isCloseUp = (s) => s.kind === 'dialogue' && s.panels.some((p) => p.shot === 'close' || p.shot === 'extreme');
const graphemes = (t) => Array.from(t).length;

// --- INV-001 schema -------------------------------------------------------
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
if (!validateSchema(sb)) {
  for (const e of validateSchema.errors.slice(0, 40)) {
    err('INV-001', e.instancePath || '/', `${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`);
  }
}

// Structural checks below assume the top-level shape exists. Bail out early if not.
if (!Array.isArray(sb.scenes) || !Array.isArray(sb.expressionSheets)) {
  finish();
}

// --- per-scene / per-line checks -----------------------------------------
for (const [si, scene] of sb.scenes.entries()) {
  const at = `scenes[${si}] ${scene.id ?? '?'}`;

  // INV-022 device ids
  for (const d of scene.devices ?? []) {
    const def = devices.devices.find((x) => x.id === d);
    if (!def) err('INV-022', at, `unknown device "${d}". Invented devices belong in proposedDevices, not in scene.devices.`);
    else if (def.status !== 'active') err('INV-022', at, `device "${d}" has status "${def.status}" and may not be used.`);
  }

  // INV-012 crossfade legality
  const tr = scene.transitionIn;
  if (tr?.kind === 'crossfade') {
    const prev = si > 0 ? sb.scenes[si - 1] : null;
    const dur = tr.durationFrames ?? 0;
    if (!prev) {
      err('INV-012', at, 'crossfade on the first scene: nothing to cross from.');
    } else if (prev.kind !== 'dialogue' || scene.kind !== 'dialogue') {
      err('INV-012', at, 'crossfade is only legal between two dialogue scenes.');
    } else if (prev.layout !== scene.layout) {
      err('INV-012', at, `crossfade across a layout change (${prev.layout} -> ${scene.layout}). A crossfade between different framings reads as a flashback; use a cut.`);
    } else {
      const same = prev.panels.length === scene.panels.length && scene.panels.every((p, j) => {
        const q = prev.panels[j];
        return p.kind === 'character' && q.kind === 'character' && p.characterId === q.characterId &&
          p.shot === q.shot && Boolean(p.flipHorizontal) === Boolean(q.flipHorizontal);
      });
      if (!same) err('INV-012', at, 'crossfade where cast, slot order, shot size, or flip changed. Only an expression-only change may be crossfaded.');
      const changed = scene.panels.filter((p, j) => p.expressionId !== prev.panels[j]?.expressionId);
      if (same && changed.length === 0) warn('INV-012', at, 'crossfade between identical panels has no visible effect.');
    }
    const cfMin = threshold('INV-012', 'crossfadeDurationFramesMin');
    const cfMax = threshold('INV-012', 'crossfadeDurationFramesMax');
    if (dur < cfMin || dur > cfMax) {
      err('INV-012', at, `crossfade durationFrames=${dur}; must be ${cfMin}-${cfMax}. Longer produces a visible double-exposure ghost around the jaw and eyes.`);
    }
  }

  if (scene.kind !== 'dialogue') continue;

  // --- panel-level ------------------------------------------------------
  for (const [pi, panel] of scene.panels.entries()) {
    const pAt = `${at} panels[${pi}]`;
    if (panel.kind !== 'character') continue;

    // INV-002 expression exists and belongs to the right character
    const e = entryOf(panel);
    if (!e) { err('INV-002', pAt, `expressionId "${panel.expressionId}" is not in any expression sheet.`); continue; }
    if (e.characterId !== panel.characterId) {
      err('INV-002', pAt, `expression "${panel.expressionId}" belongs to "${e.characterId}" but the panel is "${panel.characterId}".`);
    }
    // INV-015 flip safety
    if (panel.flipHorizontal && !e.flipSafe) {
      err('INV-015', pAt, `flipHorizontal on "${e.id}" which is not flipSafe. Mirroring corrupts in-image text and asymmetric identifying features.`);
    }
    // titleCard-only assets must not appear in dialogue
    if (e.suitableFor.length === 1 && e.suitableFor[0] === 'titleCard') {
      err('INV-002', pAt, `"${e.id}" is a title-card portrait and is framed differently from dialogue portraits.`);
    }
  }

  // INV-013 / INV-014 split composition
  if (scene.layout === 'split2' && scene.panels.length === 2) {
    const [p0, p1] = scene.panels;
    if (p0.kind === 'character' && p1.kind === 'character' && entryOf(p0) && entryOf(p1)) {
      if (effHead(p0) === effHead(p1) && effGaze(p0) === effGaze(p1)) {
        warn('INV-013', at, `both panels share headOrientation "${effHead(p0)}" and gaze "${effGaze(p0)}". Individually fine, absurd as a pair.`);
      }
      if (effGaze(p0) === 'screen-left') warn('INV-014', `${at} panels[0]`, 'left panel gazes screen-left, away from its partner. Consider DEV-GAZE-CORRECTION.');
      if (effGaze(p1) === 'screen-right') warn('INV-014', `${at} panels[1]`, 'right panel gazes screen-right, away from its partner. Consider DEV-GAZE-CORRECTION.');
    }
  }

  // --- line-level -------------------------------------------------------
  let sum = 0;
  for (const [li, line] of scene.lines.entries()) {
    const lAt = `${at} lines[${li}] ${line.id ?? ''}`.trim();
    const silent = line.beat === 'silentReaction';

    // INV-025 silent-beat coherence
    if (line.text === '' && !silent) err('INV-025', lAt, 'empty text requires beat=silentReaction.');
    if (silent && line.text !== '') err('INV-025', lAt, 'beat=silentReaction requires empty text.');

    // INV-003 speaker is on screen
    const speakerPanels = scene.panels.filter((p) => p.kind === 'character' && p.characterId === line.speakerId);
    if (speakerPanels.length === 0) {
      err('INV-003', lAt, `speaker "${line.speakerId}" has no panel in this scene; there is nowhere to place the text.`);
    }

    // INV-004 / INV-005 speaking and listening suitability
    for (const panel of scene.panels) {
      if (panel.kind !== 'character') continue;
      const e = entryOf(panel);
      if (!e) continue;
      const isSpeaker = panel.characterId === line.speakerId;
      if (isSpeaker) {
        const need = silent ? 'reaction' : 'speaking';
        if (!e.suitableFor.includes(need)) {
          err('INV-004', lAt, `"${e.id}" is not suitableFor "${need}" but ${panel.characterId} is the active character here (suitableFor: ${e.suitableFor.join(', ')}).`);
        }
      } else if (!e.suitableFor.includes('listening')) {
        err('INV-005', lAt, `"${e.id}" is not suitableFor "listening" but ${panel.characterId} is listening here${e.descriptor.gesture && e.descriptor.gesture !== 'none' ? ` (active gesture: ${e.descriptor.gesture})` : ''}.`);
      }
    }

    // INV-017 no speaker labels
    if (/^\s*[^\s:]{1,20}\s*:/.test(line.text)) {
      err('INV-017', lAt, `text appears to begin with a speaker label: "${line.text.slice(0, 30)}". Attribution is positional.`);
    }

    // INV-009 reveal derivation
    const expectedReveal = line.text === '' ? 0 : Math.ceil((graphemes(line.text) / sb.project.timing.charactersPerSecond) * sb.project.fps);
    if (Math.abs((line.revealFrames ?? 0) - expectedReveal) > threshold('INV-009', 'revealToleranceFrames')) {
      warn('INV-009', lAt, `revealFrames=${line.revealFrames}, derivation gives ${expectedReveal} for ${graphemes(line.text)} characters.`);
    }
    // INV-010 hold comes from the beat table
    const tableHold = sb.project.timing.beatHoldFrames?.[line.beat];
    if (tableHold !== undefined && line.holdFrames !== tableHold && !scene.reason) {
      warn('INV-010', lAt, `holdFrames=${line.holdFrames} but beat "${line.beat}" implies ${tableHold}. Tune rhythm in the beat table, or record scene.reason.`);
    }
    sum += (line.preRollFrames ?? 0) + (line.revealFrames ?? 0) + (line.holdFrames ?? 0);
  }

  // INV-008 scene arithmetic
  const expected = sum + (scene.extraHoldFrames ?? 0);
  if (scene.durationFrames !== expected) {
    err('INV-008', at, `durationFrames=${scene.durationFrames} but lines + extraHold = ${expected}.`);
  }
}

// --- INV-008 total --------------------------------------------------------
const totalExpected = sb.scenes.reduce((s, x) => s + (x.durationFrames ?? 0), 0);
if (sb.project?.totalDurationFrames !== totalExpected) {
  err('INV-008', 'project', `totalDurationFrames=${sb.project?.totalDurationFrames} but scenes sum to ${totalExpected}.`);
}

// --- INV-006 / INV-007 cross-scene state ---------------------------------
const slotSignature = (panels) =>
  panels.map((p) => (p.kind === 'character' ? `${p.characterId}|${p.shot}|${p.flipHorizontal ? 'f' : ''}` : `insert|${p.shot}`)).join(',');
const speakersOf = (scene) => [...new Set(scene.lines.map((l) => l.speakerId))];

for (let i = 1; i < sb.scenes.length; i++) {
  const prev = sb.scenes[i - 1], cur = sb.scenes[i];
  if (prev.kind !== 'dialogue' || cur.kind !== 'dialogue') continue;
  const at = `scenes[${i}] ${cur.id}`;
  if (prev.layout !== cur.layout || slotSignature(prev.panels) !== slotSignature(cur.panels)) continue;

  const changed = cur.panels
    .map((p, j) => ({ p, j, prevId: prev.panels[j]?.expressionId }))
    .filter(({ p, prevId }) => p.kind === 'character' && p.expressionId !== prevId);

  // INV-006 listener stability
  const curSpeakers = speakersOf(cur), prevSpeakers = speakersOf(prev);
  for (const { p, j, prevId } of changed) {
    const wasListener = !prevSpeakers.includes(p.characterId);
    const isListener = !curSpeakers.includes(p.characterId);
    if (wasListener && isListener && !cur.deliberateReaction) {
      warn('INV-006', `${at} panels[${j}]`, `${p.characterId} listens in both scenes but changes ${prevId} -> ${p.expressionId}. Set deliberateReaction with a reason, or hold the image.`);
    }
  }

  // INV-007 churn while the speaker is unchanged
  const sameSpeaker = curSpeakers.length === 1 && prevSpeakers.length === 1 && curSpeakers[0] === prevSpeakers[0];
  if (sameSpeaker && changed.length > 1 && !cur.deliberateReaction) {
    warn('INV-007', at, `${changed.length} panels change expression while ${curSpeakers[0]} keeps speaking. Expected at most one.`);
  }
}

// --- INV-011 close-up budget ---------------------------------------------
const closeUpRatioMax = presetThreshold('closeUpSceneRatioMax', 'INV-011');
if (dialogueScenes.length > 0 && closeUpRatioMax !== null) {
  const closeCount = dialogueScenes.filter(isCloseUp).length;
  const ratio = closeCount / dialogueScenes.length;
  if (ratio > closeUpRatioMax) {
    warn('INV-011', 'scenes', `${closeCount}/${dialogueScenes.length} dialogue scenes (${(ratio * 100).toFixed(0)}%) are close or extreme. Budget for preset "${presetId}" is ${(closeUpRatioMax * 100).toFixed(0)}%.`);
  }
  for (let i = 1; i < dialogueScenes.length; i++) {
    if (isCloseUp(dialogueScenes[i - 1]) && isCloseUp(dialogueScenes[i])) {
      const isReaction = dialogueScenes[i].lines.some((l) => l.beat === 'silentReaction');
      if (!isReaction) warn('INV-011', `scenes ${dialogueScenes[i].id}`, 'consecutive close-ups; the second is not a silent reaction.');
    }
  }
}

// --- INV-016 punchline needs a reaction ----------------------------------
const flatLines = sb.scenes.flatMap((s) => (s.kind === 'dialogue' ? s.lines.map((l) => ({ l, s })) : []));
for (let i = 0; i < flatLines.length; i++) {
  if (flatLines[i].l.beat !== 'punchline') continue;
  const next = flatLines[i + 1];
  if (!next || next.l.beat !== 'silentReaction') {
    warn('INV-016', `${flatLines[i].s.id} ${flatLines[i].l.id}`, 'punchline is not followed by a silent reaction beat. Without it the joke does not land.');
  }
}

// --- INV-020 monotony ----------------------------------------------------
const identicalPanelRunMax = presetThreshold('identicalPanelRunMax', 'INV-020');
let runStart = 0;
for (let i = 1; identicalPanelRunMax !== null && i <= dialogueScenes.length; i++) {
  const same = i < dialogueScenes.length &&
    JSON.stringify(dialogueScenes[i].panels) === JSON.stringify(dialogueScenes[runStart].panels);
  if (!same) {
    const len = i - runStart;
    if (len > identicalPanelRunMax) {
      warn('INV-020', `scenes ${dialogueScenes[runStart].id}..${dialogueScenes[i - 1].id}`, `${len} consecutive scenes with an identical panel configuration.`);
    }
    runStart = i;
  }
}

// --- INV-021 / INV-024 sheet hygiene -------------------------------------
const referenced = new Set();
for (const scene of sb.scenes) {
  if (scene.kind === 'dialogue') {
    for (const p of scene.panels) if (p.kind === 'character') referenced.add(p.expressionId);
  } else if (scene.kind === 'template') {
    for (const v of Object.values(scene.slots ?? {})) {
      if (typeof v === 'string' && entryIndex.has(v)) referenced.add(v);
      if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && entryIndex.has(x)) referenced.add(x);
    }
  }
}
for (const sheet of sb.expressionSheets) {
  for (const e of sheet.entries) {
    if (!referenced.has(e.id)) err('INV-021', `expressionSheets ${sheet.characterId}`, `entry "${e.id}" is never used. That is a generated image nobody sees.`);
    if (e.asset?.kind === 'placeholder' && (!e.asset.visibleDescription || !e.asset.generationPrompt)) {
      err('INV-023', `expressionSheets ${sheet.characterId}`, `placeholder "${e.id}" is missing visibleDescription or generationPrompt.`);
    }
  }
  const dialogueEntries = sheet.entries.filter((e) => !(e.suitableFor.length === 1 && e.suitableFor[0] === 'titleCard'));
  const expressionMax = threshold('INV-024', 'dialogueExpressionMax');
  if (dialogueEntries.length > expressionMax) {
    warn('INV-024', `expressionSheets ${sheet.characterId}`, `${dialogueEntries.length} dialogue expressions; MVP budget is ${expressionMax}.`);
  }
  if (sheet.basePortraitId && !sheet.entries.some((e) => e.id === sheet.basePortraitId)) {
    err('INV-002', `expressionSheets ${sheet.characterId}`, `basePortraitId "${sheet.basePortraitId}" is not among the entries.`);
  }
}

// --- brief-dependent checks ---------------------------------------------
if (brief) {
  // INV-018 duration target
  const seconds = totalExpected / sb.project.fps;
  const target = brief.targetDurationSeconds;
  const durationTolerance = threshold('INV-018', 'durationToleranceFraction');
  if (target && Math.abs(seconds - target) / target > durationTolerance) {
    warn('INV-018', 'project', `duration ${seconds.toFixed(1)}s is more than ${(durationTolerance * 100).toFixed(0)}% from the ${target}s target.`);
  }
  // INV-019 must-include lines
  const allText = flatLines.map(({ l }) => l.text);
  for (const must of brief.mustIncludeLines ?? []) {
    if (!allText.includes(must)) err('INV-019', 'scenes', `required line missing verbatim: "${must}"`);
  }
  // cast agreement
  const briefIds = new Set((brief.cast ?? []).map((c) => c.id));
  for (const c of sb.characters ?? []) {
    if (briefIds.size && !briefIds.has(c.id)) err('INV-002', 'characters', `character "${c.id}" is not in the brief cast.`);
  }
}

finish();

// --- output --------------------------------------------------------------
function finish() {
  // A finding's class is its severity unless its rule's provenance is house-style, in which
  // case it is a diagnostic: visible, attributable, and outside the defect count.
  for (const f of findings) {
    f.provenance = ruleOf.get(f.id)?.provenance ?? 'unlabelled';
    f.class = DIAGNOSTIC_PROVENANCE.has(f.provenance) ? 'diagnostic' : f.severity;
  }
  const errors = findings.filter((f) => f.class === 'error');
  const warnings = findings.filter((f) => f.class === 'warning');
  const diagnostics = findings.filter((f) => f.class === 'diagnostic');

  const out = {
    storyboard: storyboardPath.replace(ROOT + '/', ''),
    projectId: sb.project?.id ?? null,
    stylePresetId: presetId,
    errorCount: errors.length,
    warningCount: warnings.length,
    diagnosticCount: diagnostics.length,
    // Rules that could not be evaluated. Absent coverage must not read as a clean result.
    skippedRules,
    findings,
  };
  if (jsonOut && typeof jsonOut === 'string') {
    writeFileSync(resolve(jsonOut), JSON.stringify(out, null, 2) + '\n');
  }

  const label = { error: 'ERROR     ', warning: 'WARNING   ', diagnostic: 'DIAGNOSTIC' };
  for (const f of [...errors, ...warnings]) {
    console.log(`${label[f.class]} ${f.id}  ${f.location}\n           ${f.message}`);
  }
  if (diagnostics.length) {
    console.log('\n--- diagnostics: house-style observations, not defects ---');
    for (const f of diagnostics) {
      console.log(`${label[f.class]} ${f.id}  ${f.location}  [${f.provenance}]\n           ${f.message}`);
    }
  }
  for (const s of skippedRules) console.log(`SKIPPED    ${s.id}  ${s.reason}`);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s), ${diagnostics.length} diagnostic(s) — ${out.storyboard}`);

  process.exit(errors.length > 0 || (strict && warnings.length > 0) ? 1 : 0);
}
