#!/usr/bin/env node
// Eval run bookkeeping.
//
// The single most important property of this harness: nothing is ever overwritten, and
// every run records the exact prompt versions that produced it. Without that link you can
// see that quality changed but never attribute it to a prompt edit, and prompt tuning
// degenerates into whack-a-mole where fixing rhythm silently re-breaks tautology.
//
//   node tools/run.mjs new "<label>"        create a run folder for every case
//   node tools/run.mjs summarize <runDir>   collect validator + metrics into summary.md

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);

const [cmd, ...rest] = process.argv.slice(2);

const caseNames = () =>
  readdirSync(resolve(ROOT, 'evals/cases'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(ROOT, 'evals/cases', d.name, 'brief.json')))
    .map((d) => d.name);

if (cmd === 'new') {
  const label = (rest[0] ?? 'run').replace(/[^a-zA-Z0-9._-]/g, '-');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const runId = `${stamp}_${label}`;
  const runDir = resolve(ROOT, 'evals/runs', runId);

  const promptDir = resolve(ROOT, 'prompts');
  const prompts = Object.fromEntries(
    readdirSync(promptDir).filter((f) => f.endsWith('.md')).sort().map((f) => [f, sha(resolve(promptDir, f))])
  );

  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    label,
    // The provenance that makes attribution possible. If two runs differ and these
    // hashes are equal, the difference is model nondeterminism, not your prompt edit.
    promptHashes: prompts,
    catalogHashes: {
      'devices.json': sha(resolve(ROOT, 'catalog/devices.json')),
      'invariants.json': sha(resolve(ROOT, 'catalog/invariants.json')),
      'style-presets.json': sha(resolve(ROOT, 'catalog/style-presets.json')),
      'storyboard.schema.json': sha(resolve(ROOT, 'schema/storyboard.schema.json')),
    },
    model: process.env.PIPELINE_MODEL ?? 'UNRECORDED — set PIPELINE_MODEL before the run',
    cases: caseNames(),
  };

  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  for (const name of manifest.cases) {
    const dir = resolve(runDir, name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(resolve(ROOT, 'evals/cases', name, 'brief.json'), resolve(dir, 'brief.json'));
    writeFileSync(resolve(dir, 'NOTES.md'), `# ${name}\n\nPaste artefacts here as you go:\n\n- \`01-script.json\` — Writer output\n- \`02-script-edited.json\` — Editor output\n- \`03-storyboard.json\` — Director output\n- \`04-review.json\` — Reviewer output\n- \`05-storyboard-repaired.json\` — after repair, if any\n\nThen:\n\n\`\`\`\nnode tools/validate.mjs ${basename(runDir)}/${name}/03-storyboard.json --brief evals/cases/${name}/brief.json --json evals/runs/${basename(runDir)}/${name}/validator.json\nnode tools/metrics.mjs evals/runs/${basename(runDir)}/${name}/03-storyboard.json --json evals/runs/${basename(runDir)}/${name}/metrics.json\n\`\`\`\n\n## Your verdict on the rendered video\n\n(the only real oracle — watch it and write what is wrong, in the finding form:\nlocation / observation / consequence / minimum correction)\n`);
  }

  console.log(`created evals/runs/${runId}`);
  console.log(`cases: ${manifest.cases.join(', ')}`);
  if (!process.env.PIPELINE_MODEL) console.log('\nwarning: PIPELINE_MODEL not set; the run will not record which model produced it.');
  process.exit(0);
}

if (cmd === 'summarize') {
  const runDir = resolve(rest[0] ?? '');
  if (!existsSync(runDir)) { console.error(`no such run: ${runDir}`); process.exit(2); }
  const manifest = readJson(resolve(runDir, 'manifest.json'));

  const rows = [];
  for (const name of manifest.cases) {
    const vPath = resolve(runDir, name, 'validator.json');
    const mPath = resolve(runDir, name, 'metrics.json');
    const v = existsSync(vPath) ? readJson(vPath) : null;
    const m = existsSync(mPath) ? readJson(mPath) : null;
    rows.push({ name, v, m });
  }

  const goldenMetricsPath = resolve(ROOT, 'golden/zayavka-full/metrics.json');
  const golden = existsSync(goldenMetricsPath) ? readJson(goldenMetricsPath) : null;

  const cell = (x) => (x === undefined || x === null ? '—' : String(x));
  let md = `# Run ${manifest.runId}\n\n`;
  md += `Model: \`${manifest.model}\`\n\n`;
  md += `Prompt versions: ${Object.entries(manifest.promptHashes).map(([k, h]) => `\`${k}@${h}\``).join(', ')}\n\n`;

  md += `## Tier 1 — validity\n\n| case | errors | warnings | top rules |\n|---|---|---|---|\n`;
  for (const { name, v } of rows) {
    const top = v ? [...new Set(v.findings.map((f) => f.id))].slice(0, 5).join(', ') : '—';
    md += `| ${name} | ${cell(v?.errorCount)} | ${cell(v?.warningCount)} | ${top || '—'} |\n`;
  }

  const keys = ['durationSeconds', 'lineCount', 'linesPerMinute', 'closeUpSceneRatio', 'splitSceneRatio',
    'silentBeatCount', 'expressionReuseFactor', 'distinctExpressionsUsed', 'longestStaticRun',
    'listenerChanges', 'distinctDevicesUsed', 'proposedDeviceCount'];
  md += `\n## Tier 2 — drift metrics\n\n| metric | golden |${rows.map((r) => ` ${r.name} |`).join('')}\n`;
  md += `|---|---|${rows.map(() => '---|').join('')}\n`;
  for (const k of keys) {
    md += `| ${k} | ${cell(golden?.[k])} |${rows.map((r) => ` ${cell(r.m?.[k])} |`).join('')}\n`;
  }

  md += `\n## Tier 3 — judgement\n\nRubric scores go here (see \`evals/RUBRIC.md\`). Then your own verdict on the\nrendered video, which outranks every number above.\n\n`;
  md += `## Corrections produced by this run\n\nEvery correction below must be triaged per \`docs/CORRECTION_PROCESS.md\` into exactly one of:\ninvariant (code) / heuristic (prompt + rubric) / device (catalog) / schema gap / taste (approval gate).\n\n| observation | location | triage | artefact changed |\n|---|---|---|---|\n| | | | |\n`;

  writeFileSync(resolve(runDir, 'summary.md'), md);
  console.log(`wrote ${resolve(runDir, 'summary.md').replace(ROOT + '/', '')}`);
  process.exit(0);
}

console.error('usage: run.mjs new "<label>" | run.mjs summarize <runDir>');
process.exit(2);
