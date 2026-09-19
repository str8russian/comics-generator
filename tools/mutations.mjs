#!/usr/bin/env node
// Negative mutation coverage: proof that every validator rule actually fires.
//
// Zero findings on the golden shows the rule set accepts one artefact. It says nothing about
// whether any individual rule works — a rule with an inverted comparison, a typo in an id, or
// an unreachable branch is indistinguishable from a rule that is simply never violated.
//
// So: one row per rule. Break exactly one thing in the golden, run the real validator CLI, and
// assert the expected finding id appears. Deliberately a flat table rather than a mutation
// framework. Some rules are broken by swapping one string; others need adjacent-scene surgery
// that no generic mutator would produce. A table stays readable at both extremes, and the
// mutation itself is the documentation of what the rule means.
//
// "One thing" means one defect, not one JSON field. Making two portraits share head and gaze
// is a single defect that necessarily touches two descriptor fields.
//
// Cascades are expected and are reported, not suppressed: breaking a speaker's expression also
// changes what the listener checks see. The assertion is that the target rule fires, and the
// observed id set is printed so an unexpected cascade is visible rather than silently accepted.
//
//   node tools/mutations.mjs [--json <out.json>] [--only INV-0xx]

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const BASE_STORYBOARD = resolve(ROOT, 'golden/zayavka-full/storyboard.json');
const BASE_BRIEF = resolve(ROOT, 'evals/cases/zayavka-full/brief.json');

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const only = flag('only');
const jsonOut = flag('json');

// --- helpers used by the mutations ---------------------------------------
const must = (x, what) => {
  if (x === undefined || x === null) throw new Error(`no mutation target found: ${what}`);
  return x;
};
const dialogueScenes = (sb) => sb.scenes.filter((s) => s.kind === 'dialogue');
const allEntries = (sb) => sb.expressionSheets.flatMap((s) => s.entries.map((e) => ({ ...e, characterId: s.characterId })));
const entryById = (sb, id) => must(allEntries(sb).find((e) => e.id === id), `entry ${id}`);
const sheetOf = (sb, characterId) => must(sb.expressionSheets.find((s) => s.characterId === characterId), `sheet ${characterId}`);
const charPanels = (scene) => scene.panels.filter((p) => p.kind === 'character');
const speakersOf = (scene) => [...new Set(scene.lines.map((l) => l.speakerId))];
const slotSignature = (panels) =>
  panels.map((p) => (p.kind === 'character' ? `${p.characterId}|${p.shot}|${p.flipHorizontal ? 'f' : ''}` : `insert|${p.shot}`)).join(',');

// An entry of this character suitable for the given use, other than the one in use.
const altEntry = (sb, characterId, use, notId) =>
  must(
    allEntries(sb).find((e) => e.characterId === characterId && e.suitableFor.includes(use) && e.id !== notId),
    `${characterId} entry suitableFor ${use} other than ${notId}`
  );

// Recompute frame arithmetic so a mutation that changes a duration does not also trip INV-008.
// Used by every mutation that touches frame counts except the INV-008 row itself.
const retime = (sb) => {
  for (const s of sb.scenes) {
    if (s.kind !== 'dialogue') continue;
    s.durationFrames =
      s.lines.reduce((a, l) => a + (l.preRollFrames ?? 0) + (l.revealFrames ?? 0) + (l.holdFrames ?? 0), 0) +
      (s.extraHoldFrames ?? 0);
  }
  sb.project.totalDurationFrames = sb.scenes.reduce((a, s) => a + (s.durationFrames ?? 0), 0);
};

// First adjacent dialogue pair the cross-scene rules will actually compare: same layout and
// same slot signature, which is the precondition INV-006 and INV-007 both require.
const adjacentPair = (sb, extra = () => true) => {
  for (let i = 1; i < sb.scenes.length; i++) {
    const prev = sb.scenes[i - 1], cur = sb.scenes[i];
    if (prev.kind !== 'dialogue' || cur.kind !== 'dialogue') continue;
    if (prev.layout !== cur.layout) continue;
    if (slotSignature(prev.panels) !== slotSignature(cur.panels)) continue;
    if (!extra(prev, cur)) continue;
    return { prev, cur, index: i };
  }
  throw new Error('no comparable adjacent dialogue pair found');
};

// --- the table ------------------------------------------------------------
// rule -> mutation -> expected finding id. Each `apply` returns a human-readable note saying
// which concrete target it hit, so the report shows real locations rather than descriptions.
const MUTATIONS = [
  {
    rule: 'INV-001',
    expect: 'INV-001',
    mutation: 'set schemaVersion to an unsupported value',
    apply: ({ sb }) => {
      sb.schemaVersion = '0.0.0';
      return 'schemaVersion=0.0.0';
    },
  },
  {
    rule: 'INV-002',
    expect: 'INV-002',
    mutation: 'point a panel at an expressionId that is in no sheet',
    apply: ({ sb }) => {
      const p = charPanels(dialogueScenes(sb)[0])[0];
      p.expressionId = 'ghost.missing';
      return `${dialogueScenes(sb)[0].id} panels[0] -> ghost.missing`;
    },
  },
  {
    rule: 'INV-003',
    expect: 'INV-003',
    mutation: 'attribute a line to a character who has no panel in that scene',
    apply: ({ sb }) => {
      const scene = must(
        dialogueScenes(sb).find((s) => {
          const on = charPanels(s).map((p) => p.characterId);
          // Every remaining panel must stay listening-suitable, so the cascade stays small.
          return sb.characters.some((c) => !on.includes(c.id)) &&
            charPanels(s).every((p) => entryById(sb, p.expressionId).suitableFor.includes('listening'));
        }),
        'dialogue scene with an off-screen character and all-listening-suitable panels'
      );
      const on = charPanels(scene).map((p) => p.characterId);
      const off = sb.characters.find((c) => !on.includes(c.id));
      scene.lines[0].speakerId = off.id;
      return `${scene.id} lines[0].speakerId -> ${off.id} (not on screen)`;
    },
  },
  {
    rule: 'INV-004',
    expect: 'INV-004',
    mutation: 'give the speaking character an expression whose sheet entry is not suitableFor speaking',
    apply: ({ sb }) => {
      for (const scene of dialogueScenes(sb)) {
        for (const line of scene.lines) {
          if (line.beat === 'silentReaction') continue;
          const panel = charPanels(scene).find((p) => p.characterId === line.speakerId);
          if (!panel) continue;
          const alt = allEntries(sb).find(
            (e) => e.characterId === panel.characterId && !e.suitableFor.includes('speaking') && !e.suitableFor.includes('titleCard')
          );
          if (!alt) continue;
          panel.expressionId = alt.id;
          return `${scene.id} ${line.id} speaker panel -> ${alt.id} (${alt.suitableFor.join('+')})`;
        }
      }
      throw new Error('no speaker panel with a non-speaking alternative entry');
    },
  },
  {
    rule: 'INV-005',
    expect: 'INV-005',
    mutation: 'give a listening character a speaking-only expression (the listener-gesture bug)',
    apply: ({ sb }) => {
      for (const scene of dialogueScenes(sb)) {
        const speakers = speakersOf(scene);
        for (const panel of charPanels(scene)) {
          if (speakers.includes(panel.characterId)) continue;
          const alt = allEntries(sb).find(
            (e) => e.characterId === panel.characterId && e.suitableFor.includes('speaking') && !e.suitableFor.includes('listening')
          );
          if (!alt) continue;
          panel.expressionId = alt.id;
          return `${scene.id} listener ${panel.characterId} -> ${alt.id} (${alt.suitableFor.join('+')})`;
        }
      }
      throw new Error('no listener panel with a speaking-only alternative entry');
    },
  },
  {
    rule: 'INV-006',
    expect: 'INV-006',
    mutation: 'change a listener\'s expression between two adjacent scenes where it listens in both',
    apply: ({ sb }) => {
      const { prev, cur } = adjacentPair(sb, (a, b) => {
        const sa = speakersOf(a), sbk = speakersOf(b);
        return charPanels(b).some((p, j) => {
          const q = charPanels(a)[j];
          return q && q.characterId === p.characterId && !sa.includes(p.characterId) && !sbk.includes(p.characterId);
        });
      });
      const sa = speakersOf(prev), sc = speakersOf(cur);
      const j = charPanels(cur).findIndex(
        (p, k) => charPanels(prev)[k]?.characterId === p.characterId && !sa.includes(p.characterId) && !sc.includes(p.characterId)
      );
      const panel = charPanels(cur)[j];
      const alt = altEntry(sb, panel.characterId, 'listening', panel.expressionId);
      panel.expressionId = alt.id;
      delete cur.deliberateReaction;
      return `${cur.id} listener ${panel.characterId} -> ${alt.id}, deliberateReaction unset`;
    },
  },
  {
    rule: 'INV-007',
    expect: 'INV-007',
    mutation: 'change two panels\' expressions across adjacent scenes while the same character keeps speaking',
    apply: ({ sb }) => {
      const { cur } = adjacentPair(sb, (a, b) => {
        const sa = speakersOf(a), sbk = speakersOf(b);
        return sa.length === 1 && sbk.length === 1 && sa[0] === sbk[0] && charPanels(b).length >= 2;
      });
      const speaker = speakersOf(cur)[0];
      const notes = [];
      for (const panel of charPanels(cur)) {
        const use = panel.characterId === speaker ? 'speaking' : 'listening';
        const alt = altEntry(sb, panel.characterId, use, panel.expressionId);
        panel.expressionId = alt.id;
        notes.push(`${panel.characterId}->${alt.id}`);
      }
      delete cur.deliberateReaction;
      return `${cur.id} ${notes.join(', ')} while ${speaker} keeps speaking`;
    },
  },
  {
    rule: 'INV-008',
    expect: 'INV-008',
    mutation: 'add one frame to a scene duration without changing its lines (no retime)',
    apply: ({ sb }) => {
      const scene = dialogueScenes(sb)[0];
      scene.durationFrames += 1;
      return `${scene.id}.durationFrames ${scene.durationFrames - 1} -> ${scene.durationFrames}`;
    },
  },
  {
    rule: 'INV-009',
    expect: 'INV-009',
    mutation: 'invent a typing duration instead of deriving it from the grapheme count',
    apply: ({ sb }) => {
      const scene = dialogueScenes(sb)[0];
      const line = must(scene.lines.find((l) => l.text !== ''), 'spoken line');
      line.revealFrames += 25;
      retime(sb);
      return `${scene.id} ${line.id}.revealFrames +25`;
    },
  },
  {
    rule: 'INV-010',
    expect: 'INV-010',
    mutation: 'set a hold that disagrees with the beat table, with no scene.reason recorded',
    apply: ({ sb }) => {
      const scene = must(dialogueScenes(sb).find((s) => !s.reason), 'dialogue scene without a reason');
      const line = must(
        scene.lines.find((l) => sb.project.timing.beatHoldFrames[l.beat] !== undefined),
        'line whose beat is in the hold table'
      );
      line.holdFrames = sb.project.timing.beatHoldFrames[line.beat] + 13;
      retime(sb);
      return `${scene.id} ${line.id}.holdFrames -> table+13 (beat ${line.beat})`;
    },
  },
  {
    rule: 'INV-011',
    expect: 'INV-011',
    mutation: 'push close and extreme shots past the preset\'s close-up budget',
    apply: ({ sb }) => {
      const scenes = dialogueScenes(sb);
      const needed = Math.floor(scenes.length * 0.35) + 2;
      for (const s of scenes.slice(0, needed)) for (const p of s.panels) p.shot = 'close';
      return `${needed}/${scenes.length} dialogue scenes forced to shot=close`;
    },
  },
  {
    rule: 'INV-012',
    expect: 'INV-012',
    mutation: 'crossfade across a layout change, with a duration outside the legal window',
    apply: ({ sb }) => {
      let target = null;
      for (let i = 1; i < sb.scenes.length; i++) {
        const prev = sb.scenes[i - 1], cur = sb.scenes[i];
        if (prev.kind === 'dialogue' && cur.kind === 'dialogue' && prev.layout !== cur.layout) { target = cur; break; }
      }
      must(target, 'adjacent dialogue scenes with different layouts');
      target.transitionIn = { kind: 'crossfade', durationFrames: 20 };
      return `${target.id}.transitionIn -> crossfade 20 frames across a layout change`;
    },
  },
  {
    rule: 'INV-013',
    expect: 'INV-013',
    mutation: 'make the two portraits in a split share head orientation and gaze (the "two pigeons" pair)',
    apply: ({ sb }) => {
      const scene = must(
        dialogueScenes(sb).find((s) => s.layout === 'split2' && charPanels(s).length === 2),
        'split2 scene with two character panels'
      );
      const [p0, p1] = scene.panels;
      p0.flipHorizontal = false;
      p1.flipHorizontal = false;
      const a = entryById(sb, p0.expressionId);
      const b = sheetOf(sb, p1.characterId).entries.find((e) => e.id === p1.expressionId);
      b.descriptor.gaze = a.descriptor.gaze;
      b.descriptor.headOrientation = a.descriptor.headOrientation;
      return `${scene.id}: ${p1.expressionId} descriptor matched to ${p0.expressionId} (${a.descriptor.headOrientation}/${a.descriptor.gaze})`;
    },
  },
  {
    rule: 'INV-014',
    expect: 'INV-014',
    mutation: 'point the right-hand portrait\'s gaze away from its partner',
    apply: ({ sb }) => {
      const scene = must(
        dialogueScenes(sb).find((s) => s.layout === 'split2' && charPanels(s).length === 2),
        'split2 scene with two character panels'
      );
      const p1 = scene.panels[1];
      const e = sheetOf(sb, p1.characterId).entries.find((x) => x.id === p1.expressionId);
      p1.flipHorizontal = false;
      e.descriptor.gaze = 'screen-right';
      return `${scene.id} panels[1] ${e.id} gaze -> screen-right (away from partner)`;
    },
  },
  {
    rule: 'INV-015',
    expect: 'INV-015',
    mutation: 'mark an entry used by a flipped panel as unsafe to mirror',
    apply: ({ sb }) => {
      for (const scene of dialogueScenes(sb)) {
        const panel = charPanels(scene).find((p) => p.flipHorizontal);
        if (!panel) continue;
        const e = sheetOf(sb, panel.characterId).entries.find((x) => x.id === panel.expressionId);
        e.flipSafe = false;
        return `${scene.id}: ${e.id}.flipSafe -> false while a flipped panel uses it`;
      }
      throw new Error('no flipped character panel in the golden');
    },
  },
  {
    rule: 'INV-016',
    expect: 'INV-016',
    mutation: 'mark a line as a punchline when the next line is not a silent reaction',
    apply: ({ sb }) => {
      const flat = dialogueScenes(sb).flatMap((s) => s.lines.map((l) => ({ l, s })));
      for (let i = 0; i < flat.length - 1; i++) {
        const { l, s } = flat[i];
        if (l.beat === 'punchline' || flat[i + 1].l.beat === 'silentReaction') continue;
        // punchline and ordinary share a hold of 36 in the golden's table, so this does not
        // also trip INV-010. Assert that rather than assume it.
        if (sb.project.timing.beatHoldFrames.punchline !== l.holdFrames) continue;
        l.beat = 'punchline';
        return `${s.id} ${l.id}.beat -> punchline, next beat is ${flat[i + 1].l.beat}`;
      }
      throw new Error('no line whose hold already matches the punchline table value');
    },
  },
  {
    rule: 'INV-017',
    expect: 'INV-017',
    mutation: 'prefix a line with a speaker label, which the renderer places positionally',
    apply: ({ sb }) => {
      const scene = dialogueScenes(sb)[0];
      const line = must(scene.lines.find((l) => l.text !== ''), 'spoken line');
      const name = must(sb.characters.find((c) => c.id === line.speakerId), `character ${line.speakerId}`);
      line.text = `${name.displayName ?? name.name ?? name.id}: ${line.text}`;
      // Keep the reveal derived from the new length so INV-009 does not also fire.
      line.revealFrames = Math.ceil((Array.from(line.text).length / sb.project.timing.charactersPerSecond) * sb.project.fps);
      retime(sb);
      return `${scene.id} ${line.id}.text prefixed with a speaker label`;
    },
  },
  {
    rule: 'INV-018',
    expect: 'INV-018',
    mutation: 'move the brief\'s target duration far from what the storyboard runs',
    apply: ({ brief }) => {
      const was = brief.targetDurationSeconds;
      brief.targetDurationSeconds = 20;
      return `brief.targetDurationSeconds ${was} -> 20`;
    },
  },
  {
    rule: 'INV-019',
    expect: 'INV-019',
    mutation: 'require a verbatim line the storyboard does not contain',
    apply: ({ brief }) => {
      brief.mustIncludeLines = [...(brief.mustIncludeLines ?? []), 'Эта строка нигде не встречается.'];
      return 'brief.mustIncludeLines += an absent line';
    },
  },
  {
    rule: 'INV-020',
    expect: 'INV-020',
    mutation: 'hold one identical panel configuration across five consecutive scenes',
    apply: ({ sb }) => {
      const scenes = dialogueScenes(sb);
      const run = 5;
      const start = must(
        scenes.findIndex((s, i) => i + run <= scenes.length && scenes.slice(i, i + run).every((x) => charPanels(x).length === charPanels(s).length)) + 1 || null,
        'window of five dialogue scenes with a consistent panel count'
      ) - 1;
      // Use entries that serve as both speaker and listener, so freezing the panels does not
      // also trip the speaking/listening suitability checks in every scene of the window.
      const template = charPanels(scenes[start]).map((p) => ({
        ...p,
        expressionId: allEntries(sb).find(
          (e) => e.characterId === p.characterId && e.suitableFor.includes('speaking') && e.suitableFor.includes('listening')
        )?.id ?? p.expressionId,
      }));
      for (const s of scenes.slice(start, start + run)) s.panels = structuredClone(template);
      return `dialogue scenes ${scenes.slice(start, start + run).map((s) => s.id).join('..')} frozen to one configuration`;
    },
  },
  {
    rule: 'INV-021',
    expect: 'INV-021',
    mutation: 'add an expression entry no panel references',
    apply: ({ sb }) => {
      // A character well under the expression cap, so INV-024 does not fire as well.
      const sheet = must(
        [...sb.expressionSheets].sort((a, b) => a.entries.length - b.entries.length)[0],
        'smallest expression sheet'
      );
      sheet.entries.push({
        id: `${sheet.characterId}.never-used`,
        label: 'never used',
        descriptor: structuredClone(sheet.entries[0].descriptor),
        suitableFor: ['listening'],
        flipSafe: true,
        asset: { kind: 'file', path: 'assets/never-used.png' },
      });
      return `${sheet.characterId}.never-used added, referenced by nothing`;
    },
  },
  {
    rule: 'INV-022',
    expect: 'INV-022',
    mutation: 'cite a device id that is not in the active catalog',
    apply: ({ sb }) => {
      const scene = dialogueScenes(sb)[0];
      scene.devices = [...(scene.devices ?? []), 'DEV-INVENTED-BY-THE-DIRECTOR'];
      return `${scene.id}.devices += DEV-INVENTED-BY-THE-DIRECTOR`;
    },
  },
  {
    rule: 'INV-023',
    expect: 'INV-023',
    mutation: 'give an entry a placeholder asset with no visibleDescription',
    apply: ({ sb }) => {
      const sheet = sb.expressionSheets[0];
      const e = sheet.entries[0];
      e.asset = { kind: 'placeholder', generationPrompt: 'a portrait' };
      return `${e.id}.asset -> placeholder missing visibleDescription`;
    },
  },
  {
    rule: 'INV-024',
    expect: 'INV-024',
    mutation: 'exceed the dialogue expression budget for one character',
    apply: ({ sb }) => {
      const sheet = must(
        [...sb.expressionSheets].sort(
          (a, b) => b.entries.filter((e) => !e.suitableFor.includes('titleCard')).length - a.entries.filter((e) => !e.suitableFor.includes('titleCard')).length
        )[0],
        'largest expression sheet'
      );
      const before = sheet.entries.filter((e) => !(e.suitableFor.length === 1 && e.suitableFor[0] === 'titleCard')).length;
      sheet.entries.push({
        id: `${sheet.characterId}.over-budget`,
        label: 'over budget',
        descriptor: structuredClone(sheet.entries[0].descriptor),
        suitableFor: ['speaking', 'listening'],
        flipSafe: true,
        asset: { kind: 'file', path: 'assets/over-budget.png' },
      });
      return `${sheet.characterId} dialogue entries ${before} -> ${before + 1}`;
    },
  },
  {
    rule: 'INV-025',
    expect: 'INV-025',
    mutation: 'empty a line\'s text while leaving its beat non-silent',
    apply: ({ sb }) => {
      const scene = dialogueScenes(sb)[0];
      const line = must(scene.lines.find((l) => l.text !== '' && l.beat !== 'silentReaction'), 'spoken line');
      line.text = '';
      line.revealFrames = 0;
      retime(sb);
      return `${scene.id} ${line.id}.text emptied, beat stays ${line.beat}`;
    },
  },
  {
    rule: 'INV-026',
    expect: 'INV-026',
    mutation: 'reuse one expression id across two characters\' sheets',
    apply: ({ sb }) => {
      const victim = sb.expressionSheets[1];
      const taken = sb.expressionSheets[0].entries[0].id;
      const was = victim.entries[0].id;
      victim.entries[0].id = taken;
      return `${victim.characterId} entry ${was} -> ${taken}, already owned by ${sb.expressionSheets[0].characterId}`;
    },
  },
];

// --- runner ---------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'comics-mutations-'));
const runValidator = (sb, brief, tag) => {
  const sbPath = join(tmp, `${tag}.storyboard.json`);
  const briefPath = join(tmp, `${tag}.brief.json`);
  const outPath = join(tmp, `${tag}.validator.json`);
  writeFileSync(sbPath, JSON.stringify(sb));
  writeFileSync(briefPath, JSON.stringify(brief));
  const r = spawnSync(
    process.execPath,
    [resolve(ROOT, 'tools/validate.mjs'), sbPath, '--brief', briefPath, '--json', outPath],
    { encoding: 'utf8' }
  );
  if (r.status === 2 || !r.stdout) {
    throw new Error(`validator failed to run: ${r.stderr || r.stdout}`);
  }
  return readJson(outPath);
};

const base = { sb: readJson(BASE_STORYBOARD), brief: readJson(BASE_BRIEF) };

// Every assertion below means "this finding is caused by the mutation". That only holds if the
// unmutated base produces nothing at all, so check it rather than trust it.
const baseline = runValidator(base.sb, base.brief, 'baseline');
const baselineClean =
  baseline.errorCount === 0 && baseline.warningCount === 0 && baseline.diagnosticCount === 0 && baseline.skippedRules.length === 0;
if (!baselineClean) {
  console.error('base storyboard is not clean; mutation results would not be attributable:');
  console.error(`  ${baseline.errorCount} error(s), ${baseline.warningCount} warning(s), ${baseline.diagnosticCount} diagnostic(s), ${baseline.skippedRules.length} skipped`);
  for (const f of baseline.findings) console.error(`  ${f.id} ${f.location}`);
  for (const s of baseline.skippedRules) console.error(`  SKIPPED ${s.id} ${s.reason}`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

const rows = [];
for (const m of MUTATIONS) {
  if (only && m.rule !== only) continue;
  const mutated = structuredClone(base);
  let note, observed = [], status, detail = '';
  try {
    note = m.apply(mutated);
    const result = runValidator(mutated.sb, mutated.brief, m.rule);
    observed = [...new Set(result.findings.map((f) => f.id))].sort();
    status = observed.includes(m.expect) ? 'pass' : 'FAIL';
    if (status === 'FAIL') detail = `expected ${m.expect}, observed ${observed.join(', ') || 'nothing'}`;
  } catch (e) {
    status = 'ERROR';
    detail = e.message;
  }
  rows.push({
    rule: m.rule,
    expect: m.expect,
    mutation: m.mutation,
    target: note ?? null,
    observed,
    cascade: observed.filter((id) => id !== m.expect),
    status,
    detail,
  });
}

rmSync(tmp, { recursive: true, force: true });

// --- report ---------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('rule', 9)} ${pad('status', 7)} mutation -> expected finding`);
console.log('-'.repeat(100));
for (const r of rows) {
  console.log(`${pad(r.rule, 9)} ${pad(r.status, 7)} ${r.mutation} -> ${r.expect}`);
  if (r.target) console.log(`${' '.repeat(17)}target: ${r.target}`);
  if (r.cascade.length) console.log(`${' '.repeat(17)}cascade: ${r.cascade.join(', ')}`);
  if (r.detail) console.log(`${' '.repeat(17)}${r.detail}`);
}

const failed = rows.filter((r) => r.status !== 'pass');
const covered = rows.filter((r) => r.status === 'pass').map((r) => r.rule);
console.log('-'.repeat(100));
console.log(`${covered.length}/${rows.length} rules proved to fire`);
if (failed.length) console.log(`not proved: ${failed.map((r) => `${r.rule} (${r.status})`).join(', ')}`);

if (jsonOut) {
  writeFileSync(resolve(jsonOut), JSON.stringify({ base: 'golden/zayavka-full/storyboard.json', covered, rows }, null, 2) + '\n');
  console.log(`wrote ${resolve(jsonOut).replace(ROOT + '/', '')}`);
}

process.exit(failed.length ? 1 : 0);
