#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLiveConfig } from './lib/config.mjs';
import { fixtureJson } from './lib/fixture.mjs';
import { assertReportHasNoSecrets, formatReport, runLiveMatrix, skippedReport } from './lib/run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const config = readLiveConfig(process.env);
const secrets = [];
if (typeof config.token === 'string') secrets.push(config.token);
for (const value of Object.values(config.extraBody ?? {})) {
  if (typeof value === 'string') secrets.push(value);
}

let report;
if (!config.live && config.status === 'SKIPPED') {
  report = skippedReport(config);
} else if (!config.live) {
  report = {
    spike: 'contest-chat-completions',
    live: 'NOT_RUN',
    reason: config.reason,
    missing: [],
    requestsAttempted: 0,
    capabilities: {},
    observations: [],
    storyboardSuitability: 'Not observed because the live configuration was present but unusable.',
  };
} else {
  report = await runLiveMatrix({ config, fixtureText: fixtureJson() });
}

const rendered = formatReport(report);
assertReportHasNoSecrets(rendered, secrets);
assertReportHasNoSecrets(JSON.stringify(report), secrets);

const reportPath = process.env.CONTEST_REPORT_PATH
  ? resolve(process.env.CONTEST_REPORT_PATH)
  : resolve(here, 'results/capability-report.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(rendered);
process.exit(config.live ? 0 : (config.status === 'SKIPPED' ? 0 : 2));
