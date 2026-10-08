import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CAMPAIGN_ENVELOPE, DISCOVERY_BUDGET } from './constants.mjs';

function emptyCampaign() {
  return {
    live_requests: 0,
    envelope: CAMPAIGN_ENVELOPE,
    discovery_budget: DISCOVERY_BUDGET,
    by_phase: {},
  };
}

export function emptyCapability() {
  return {
    version: 1,
    model: 'gemini-3-pro-image-preview',
    documentation: 'untested',
    documented_paths: [],
    docs_paths_tried: [],
    transport: {
      status: 'unverified',
      shape: null,
      endpoint_path: null,
      request_format: null,
      locked: false,
    },
    shapes_tried: [],
    reference_images: 'untested',
    reference_image_count_verified: 0,
    image_edit: 'untested',
    aspect_ratio: 'untested',
    output: {
      representation: 'untested',
      mime: null,
      width: null,
      height: null,
    },
    usage: 'untested',
    error_behavior: 'untested',
    discovery_requests: 0,
    verified_aspect_ratios: [],
    pending_without_aspect: null,
    pending_image_download: false,
    log: [],
    notes: [],
  };
}

export function createStore(root) {
  const runsDir = root;
  mkdirSync(path.join(runsDir, 'manifests'), { recursive: true });
  mkdirSync(path.join(runsDir, 'outputs'), { recursive: true });
  mkdirSync(path.join(runsDir, 'exports'), { recursive: true });

  function writeJson(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, file);
  }

  function readJson(file, fallback) {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  return {
    root: runsDir,
    campaignFile: path.join(runsDir, 'campaign.json'),
    capabilityFile: path.join(runsDir, 'capability.json'),
    attemptsDir: path.join(runsDir, 'attempts'),
    limitationsFile: path.join(runsDir, 'limitations.json'),
    logFile: path.join(runsDir, 'server.log'),
    readCampaign() {
      return { ...emptyCampaign(), ...readJson(this.campaignFile, emptyCampaign()) };
    },
    writeCampaign(value) {
      writeJson(this.campaignFile, value);
    },
    bump(phase) {
      const campaign = this.readCampaign();
      campaign.live_requests += 1;
      campaign.by_phase[phase] = (campaign.by_phase[phase] ?? 0) + 1;
      this.writeCampaign(campaign);
      return campaign.live_requests;
    },
    readCapability() {
      return readJson(this.capabilityFile, emptyCapability());
    },
    writeCapability(value) {
      writeJson(this.capabilityFile, value);
    },
    appendAttempt(record) {
      mkdirSync(this.attemptsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const kind = String(record.kind || 'discovery').replace(/[^a-z0-9-]/gi, '');
      const file = path.join(this.attemptsDir, `${stamp}-${kind}.json`);
      writeJson(file, record);
      return file;
    },
    listAttempts() {
      if (!existsSync(this.attemptsDir)) return [];
      return readdirSync(this.attemptsDir)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => JSON.parse(readFileSync(path.join(this.attemptsDir, name), 'utf8')));
    },
    readLimitations() {
      return readJson(this.limitationsFile, []);
    },
    writeLimitations(value) {
      writeJson(this.limitationsFile, value);
    },
    appendLog(line) {
      const previous = existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8') : '';
      writeFileSync(this.logFile, `${previous}${line}\n`);
    },
    manifestPath(runId) {
      return path.join(runsDir, 'manifests', `${runId}.json`);
    },
    saveManifest(manifest) {
      writeJson(this.manifestPath(manifest.run_id), manifest);
    },
    readManifest(runId) {
      if (!/^[A-Za-z0-9._-]+$/.test(runId)) return null;
      const file = this.manifestPath(runId);
      if (!existsSync(file)) return null;
      return JSON.parse(readFileSync(file, 'utf8'));
    },
    listManifests() {
      const dir = path.join(runsDir, 'manifests');
      return readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
    },
    saveOutput(filename, buffer) {
      if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw new Error('unsafe output filename');
      const file = path.join(runsDir, 'outputs', filename);
      writeFileSync(file, buffer);
      return file;
    },
    outputPath(filename) {
      if (!/^[A-Za-z0-9._-]+$/.test(filename)) return null;
      const file = path.join(runsDir, 'outputs', filename);
      return existsSync(file) ? file : null;
    },
    saveExport(filename, value) {
      if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw new Error('unsafe export filename');
      const file = path.join(runsDir, 'exports', filename);
      writeJson(file, value);
      return file;
    },
  };
}
