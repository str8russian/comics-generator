#!/usr/bin/env node
// Eval run bookkeeping.
//
// Two properties make a run usable as evidence. Nothing is ever overwritten: a repair loop
// files a new version beside the old one, so the pre-repair state the experiment measures
// survives. And every run carries a copy of the exact inputs that produced it: hashes prove
// two runs used the same prompt, but only a copy lets you read the prompt a run actually
// used after you have since edited it.
//
//   node tools/run.mjs new "<label>"                          create a run folder for every case
//   node tools/run.mjs stage <runDir> <case> <stage> <file>   file a stage output as the next version
//   node tools/run.mjs summarize <runDir>                     collect validator + metrics into summary.md

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);
const rel = (p) => p.replace(ROOT + '/', '');

const [cmd, ...rest] = process.argv.slice(2);

// The closed set of stage artefacts. A repair does not get its own name — it is the next
// version of the artefact it repairs, which is what keeps a lineage readable as a sequence.
const STAGES = ['01-script', '02-script-edited', '03-storyboard', '04-review'];

// Settings that change output and are therefore part of a run's identity. Null means
// "not recorded", which for a hand-driven chat run is the honest value.
const GENERATION_ENV = {
  temperature: 'PIPELINE_TEMPERATURE',
  topP: 'PIPELINE_TOP_P',
  seed: 'PIPELINE_SEED',
  reasoningEffort: 'PIPELINE_REASONING_EFFORT',
  interface: 'PIPELINE_INTERFACE',
};

const caseNames = () =>
  readdirSync(resolve(ROOT, 'evals/cases'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(ROOT, 'evals/cases', d.name, 'brief.json')))
    .map((d) => d.name);

// Versions present for one stage, ascending.
const versionsOf = (dir, stage) => {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${stage}\\.v(\\d+)\\.json$`);
  return readdirSync(dir)
    .map((f) => re.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
};
const latestVersion = (dir, stage) => versionsOf(dir, stage).at(-1) ?? null;

if (cmd === 'new') {
  const label = (rest[0] ?? 'run').replace(/[^a-zA-Z0-9._-]/g, '-');

  // A run whose model is unknown cannot be compared with any other run, which is the only
  // reason these folders exist. Refuse rather than record a placeholder nobody notices.
  const model = process.env.PIPELINE_MODEL;
  if (!model) {
    console.error(
      'PIPELINE_MODEL is not set.\n\n' +
        'Every comparison in this experiment is between runs. A run that does not record which\n' +
        'model produced it is not evidence, so this refuses to create one.\n\n' +
        '  PIPELINE_MODEL="<provider>/<model>" node tools/run.mjs new "' + label + '"\n'
    );
    process.exit(2);
  }

  // Second resolution plus random suffix. Minute resolution collided, and because the run
  // directory was created recursively the second run silently wrote into the first one's
  // folder — losing exactly the evidence this harness exists to preserve.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runId = `${stamp}_${label}_${randomBytes(3).toString('hex')}`;
  const runDir = resolve(ROOT, 'evals/runs', runId);
  if (existsSync(runDir)) {
    console.error(`run directory already exists: ${rel(runDir)}`);
    process.exit(2);
  }

  const promptDir = resolve(ROOT, 'prompts');
  const promptFiles = readdirSync(promptDir).filter((f) => f.endsWith('.md')).sort();
  const catalogFiles = [
    ['catalog', 'devices.json'],
    ['catalog', 'invariants.json'],
    ['catalog', 'style-presets.json'],
    ['schema', 'storyboard.schema.json'],
    ['schema', 'brief.schema.json'],
  ];

  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    label,
    model,
    generation: Object.fromEntries(
      Object.entries(GENERATION_ENV).map(([k, env]) => [k, process.env[env] ?? null])
    ),
    generationNote:
      'null means the setting was not recorded. For a run driven by hand through a chat UI that is ' +
      'expected: set PIPELINE_INTERFACE to say so, and do not invent values you did not control.',
    // Hashes make attribution possible: if two runs differ and these are equal, the difference
    // is model nondeterminism rather than a prompt edit. The copies under inputs/ make the
    // hashes readable — a hash tells you two runs differ, the copy tells you how.
    promptHashes: Object.fromEntries(promptFiles.map((f) => [f, sha(resolve(promptDir, f))])),
    catalogHashes: Object.fromEntries(
      catalogFiles.map(([d, f]) => [f, sha(resolve(ROOT, d, f))])
    ),
    inputsCopiedTo: 'inputs/',
    stages: STAGES,
    cases: caseNames(),
  };

  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const inputsDir = resolve(runDir, 'inputs');
  mkdirSync(resolve(inputsDir, 'prompts'), { recursive: true });
  mkdirSync(resolve(inputsDir, 'catalog'), { recursive: true });
  mkdirSync(resolve(inputsDir, 'schema'), { recursive: true });
  for (const f of promptFiles) copyFileSync(resolve(promptDir, f), resolve(inputsDir, 'prompts', f));
  for (const [d, f] of catalogFiles) copyFileSync(resolve(ROOT, d, f), resolve(inputsDir, d, f));

  for (const name of manifest.cases) {
    const dir = resolve(runDir, name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(resolve(ROOT, 'evals/cases', name, 'brief.json'), resolve(dir, 'brief.json'));
    writeFileSync(resolve(dir, 'NOTES.md'), notesFor(runId, name));
  }

  console.log(`created evals/runs/${runId}`);
  console.log(`model: ${model}`);
  console.log(`inputs copied: ${promptFiles.length} prompt file(s), ${catalogFiles.length} catalog/schema file(s)`);
  console.log(`cases: ${manifest.cases.join(', ')}`);
  process.exit(0);
}

if (cmd === 'stage') {
  const [runDirArg, caseName, stage, srcArg] = rest;
  if (!runDirArg || !caseName || !stage || !srcArg) {
    console.error('usage: run.mjs stage <runDir> <case> <stage> <file>');
    console.error(`stages: ${STAGES.join(', ')}`);
    process.exit(2);
  }
  if (!STAGES.includes(stage)) {
    console.error(`unknown stage "${stage}".\nstages: ${STAGES.join(', ')}`);
    console.error('A repair is not a new stage; it is the next version of the stage it repairs.');
    process.exit(2);
  }
  const caseDir = resolve(runDirArg, caseName);
  if (!existsSync(caseDir)) {
    console.error(`no such case folder: ${caseDir}`);
    process.exit(2);
  }
  const src = resolve(srcArg);
  if (!existsSync(src)) {
    console.error(`no such file: ${src}`);
    process.exit(2);
  }
  // Parse before filing. A stage artefact that is not JSON is a paste error, and catching it
  // here costs nothing while catching it three stages later costs the run.
  try {
    JSON.parse(readFileSync(src, 'utf8'));
  } catch (e) {
    console.error(`${rel(src)} is not valid JSON: ${e.message}`);
    process.exit(2);
  }

  const version = (latestVersion(caseDir, stage) ?? 0) + 1;
  const dest = resolve(caseDir, `${stage}.v${version}.json`);
  if (existsSync(dest)) {
    console.error(`refusing to overwrite ${rel(dest)}`);
    process.exit(2);
  }
  copyFileSync(src, dest);
  console.log(`filed ${rel(dest)}`);
  if (version > 1) console.log(`previous version kept: ${stage}.v${version - 1}.json`);
  process.exit(0);
}

if (cmd === 'summarize') {
  const runDir = resolve(rest[0] ?? '');
  if (!existsSync(runDir)) { console.error(`no such run: ${runDir}`); process.exit(2); }
  const manifest = readJson(resolve(runDir, 'manifest.json'));

  const rows = [];
  for (const name of manifest.cases) {
    const caseDir = resolve(runDir, name);
    // Report the latest version of each artefact, and say which version that was: a summary
    // that hides the repair depth makes a heavily repaired run look like a clean one.
    const sbVersions = versionsOf(caseDir, '03-storyboard');
    const pick = (prefix) => {
      const v = latestVersion(caseDir, prefix);
      return v === null ? null : readJson(resolve(caseDir, `${prefix}.v${v}.json`));
    };
    rows.push({
      name,
      v: pick('validator'),
      m: pick('metrics'),
      storyboardVersion: sbVersions.at(-1) ?? null,
      repairTurns: sbVersions.length ? sbVersions.length - 1 : null,
    });
  }

  const goldenMetricsPath = resolve(ROOT, 'golden/zayavka-full/metrics.json');
  const golden = existsSync(goldenMetricsPath) ? readJson(goldenMetricsPath) : null;

  const cell = (x) => (x === undefined || x === null ? '—' : String(x));
  let md = `# Run ${manifest.runId}\n\n`;
  md += `Model: \`${manifest.model}\`\n\n`;
  md += `Generation: ${Object.entries(manifest.generation ?? {}).map(([k, v]) => `${k}=${v ?? '—'}`).join(', ')}\n\n`;
  md += `Prompt versions: ${Object.entries(manifest.promptHashes).map(([k, h]) => `\`${k}@${h}\``).join(', ')}\n\n`;
  md += `Exact inputs used by this run are copied under \`inputs/\`.\n\n`;

  md += `## Tier 1 — validity\n\n| case | storyboard | repair turns | errors | warnings | diagnostics | top rules |\n|---|---|---|---|---|---|---|\n`;
  for (const { name, v, storyboardVersion, repairTurns } of rows) {
    const top = v ? [...new Set(v.findings.map((f) => f.id))].slice(0, 5).join(', ') : '—';
    md += `| ${name} | ${storyboardVersion ? `v${storyboardVersion}` : '—'} | ${cell(repairTurns)} | ${cell(v?.errorCount)} | ${cell(v?.warningCount)} | ${cell(v?.diagnosticCount)} | ${top || '—'} |\n`;
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
  console.log(`wrote ${rel(resolve(runDir, 'summary.md'))}`);
  process.exit(0);
}

console.error('usage: run.mjs new "<label>" | run.mjs stage <runDir> <case> <stage> <file> | run.mjs summarize <runDir>');
process.exit(2);

function notesFor(runId, name) {
  const base = `evals/runs/${runId}/${name}`;
  return `# ${name}

File every stage artefact with \`run.mjs stage\`, which writes the next version and never
overwrites the previous one:

\`\`\`
node tools/run.mjs stage evals/runs/${runId} ${name} 01-script <file>        # Writer
node tools/run.mjs stage evals/runs/${runId} ${name} 02-script-edited <file> # Editor
node tools/run.mjs stage evals/runs/${runId} ${name} 03-storyboard <file>    # Director
node tools/run.mjs stage evals/runs/${runId} ${name} 04-review <file>        # Reviewer
\`\`\`

A repair is **not** a new stage. Filing a repaired storyboard writes \`03-storyboard.v2.json\`
and leaves \`v1\` in place: the pre-repair state is what the experiment measures.

Then, per storyboard version (bump \`v1\` to match the version you are checking):

\`\`\`
node tools/validate.mjs ${base}/03-storyboard.v1.json --brief evals/cases/${name}/brief.json --json ${base}/validator.v1.json
node tools/metrics.mjs ${base}/03-storyboard.v1.json --json ${base}/metrics.v1.json
\`\`\`

\`run.mjs summarize\` reports the highest version it finds, and derives repair turns from how
many storyboard versions exist.

## Your verdict on the rendered video

(the only real oracle — watch it and write what is wrong, in the finding form:
location / observation / consequence / minimum correction)
`;
}
