import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, publicReference, referenceById, readReferenceFile } from './lib/catalog.mjs';
import { ASPECT_RATIOS, BATCH_LIMIT, FRAME, MODEL } from './lib/constants.mjs';
import { readImageConfig, redactOptions } from './lib/config.mjs';
import { buildEvidence, executeRun, outputFile, publicManifest, saveEvaluation } from './lib/execute.mjs';
import { sniffImage } from './lib/image-info.mjs';
import { http1Fetch } from './lib/http1.mjs';
import { runDiscovery, runTransportProbe } from './lib/probe.mjs';
import {
  WORKFLOW_RULES,
  assemblePrompt,
  assertWorkflowInputs,
  experimentById,
  loadCampaign,
} from './lib/prompt.mjs';
import { redact } from './lib/redact.mjs';
import { createStore } from './lib/store.mjs';

const SPIKE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = path.join(SPIKE_ROOT, 'public');
const STATIC = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413, code: 'body' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('body was not JSON'), { status: 400, code: 'body' }));
      }
    });
    req.on('error', reject);
  });
}

function publicExperiment(experiment, catalog, root) {
  const mapInput = (input, required) => {
    const entry = referenceById(catalog, input.id);
    return { ...publicReference(entry), role: input.role, required };
  };
  const inputs = (experiment.inputs ?? []).map((input) => mapInput(input, input.required !== false));
  const optional = (experiment.optional_inputs ?? []).map((input) => mapInput(input, false));
  const assembled = assemblePrompt({
    root,
    workflow: experiment.workflow,
    character: experiment.character,
    stateIntent: experiment.state_intent,
    gaze: experiment.gaze,
    aspectRatio: experiment.aspect_ratio,
    layoutPurpose: experiment.layout_purpose,
    inputs: experiment.inputs,
  });
  return {
    id: experiment.id,
    version: experiment.version,
    phase: experiment.phase,
    workflow: experiment.workflow,
    character: experiment.character,
    title: experiment.title,
    state_intent: experiment.state_intent,
    gaze: experiment.gaze,
    aspect_ratio: experiment.aspect_ratio,
    layout_purpose: experiment.layout_purpose,
    intended_crop: experiment.intended_crop,
    parent_reference_id: experiment.parent_reference_id ?? null,
    orientation: experiment.orientation ?? null,
    inputs,
    optional_inputs: optional,
    prompt: assembled.prompt,
    template_id: assembled.template_id,
    template_version: assembled.template_version,
  };
}

function resolveRunBody(body, catalog, campaign, root) {
  const experiment = experimentById(campaign, body.experiment_id);
  const allowed = [...(experiment.inputs ?? []), ...(experiment.optional_inputs ?? [])];
  const requested = Array.isArray(body.inputs) ? body.inputs : experiment.inputs;
  for (const input of experiment.inputs ?? []) {
    if (input.required === false) continue;
    if (!requested.some((item) => item.id === input.id && item.role === input.role)) {
      const error = new Error(`missing required reference ${input.id}`);
      error.status = 400;
      error.code = 'references';
      throw error;
    }
  }
  for (const input of requested) {
    if (!allowed.some((item) => item.id === input.id && item.role === input.role)) {
      const error = new Error(`reference ${input.id} is not part of this experiment`);
      error.status = 400;
      error.code = 'references';
      throw error;
    }
    referenceById(catalog, input.id);
  }
  const workflow = body.workflow || experiment.workflow;
  if (!WORKFLOW_RULES[workflow]) {
    const error = new Error('unknown workflow');
    error.status = 400;
    error.code = 'unknown-workflow';
    throw error;
  }
  const assembled = assemblePrompt({
    root,
    workflow,
    character: experiment.character,
    stateIntent: experiment.state_intent,
    gaze: experiment.gaze,
    aspectRatio: body.aspect_ratio || experiment.aspect_ratio,
    layoutPurpose: body.layout_purpose || experiment.layout_purpose,
    inputs: requested,
  });
  const prompt = String(body.prompt ?? assembled.prompt);
  return {
    experiment_id: experiment.id,
    recipe_version: experiment.version,
    workflow,
    phase: experiment.phase,
    aspect_ratio: body.aspect_ratio || experiment.aspect_ratio,
    layout_purpose: body.layout_purpose || experiment.layout_purpose,
    inputs: requested,
    prompt,
    prompt_edited: prompt.trim() !== assembled.prompt.trim(),
    template_id: assembled.template_id,
    template_version: assembled.template_version,
    parent_reference_id: experiment.parent_reference_id ?? null,
    parent_run_id: body.parent_run_id ?? null,
    retry_of: body.retry_of ?? null,
  };
}

export function createApp(options = {}) {
  const root = options.root ?? SPIKE_ROOT;
  const catalog = options.catalog ?? loadCatalog(root);
  const store = options.store ?? createStore(options.runsDir ?? path.join(root, 'runs'));
  const config = options.config ?? readImageConfig(options.env);
  const fetchImpl = options.fetchImpl ?? http1Fetch;
  const redactWith = options.redactWith ?? redactOptions(config);
  const log = options.log ?? ((fields) => {
    const line = redact(JSON.stringify({ at: new Date().toISOString(), ...fields }), redactWith);
    store.appendLog(line);
    if (options.quiet !== true) console.log(line);
  });

  return async function app(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    try {
      const staticFile = STATIC[pathname];
      if (req.method === 'GET' && staticFile) {
        const file = path.join(PUBLIC_DIR, staticFile.file);
        if (!existsSync(file)) {
          sendJson(res, 404, { error: 'not found', code: 'not-found' });
          return;
        }
        const body = readFileSync(file);
        res.writeHead(200, { 'content-type': staticFile.type, 'cache-control': 'no-store' });
        res.end(body);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/status') {
        const campaign = loadCampaign(root);
        const profile = store.readCapability();
        sendJson(res, 200, {
          model: MODEL,
          configured: Boolean(config.configured),
          missing: config.missing ?? [],
          frame: FRAME,
          aspect_ratios: ASPECT_RATIOS,
          workflows: Object.fromEntries(Object.entries(WORKFLOW_RULES).map(([id, rules]) => [id, rules.label])),
          campaign: store.readCampaign(),
          envelope: campaign.envelope,
          capability: profile,
          limitations: store.readLimitations(),
        });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/experiments') {
        const campaign = loadCampaign(root);
        sendJson(res, 200, {
          id: campaign.id,
          version: campaign.version,
          envelope: campaign.envelope,
          experiments: campaign.experiments.map((experiment) => publicExperiment(experiment, catalog, root)),
        });
        return;
      }
      const experimentMatch = pathname.match(/^\/api\/experiments\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && experimentMatch) {
        const campaign = loadCampaign(root);
        sendJson(res, 200, publicExperiment(experimentById(campaign, experimentMatch[1]), catalog, root));
        return;
      }
      const referenceMatch = pathname.match(/^\/api\/references\/([a-z0-9-]+)\/file$/);
      if (req.method === 'GET' && referenceMatch) {
        const entry = referenceById(catalog, referenceMatch[1]);
        if (!entry.local_path || entry.blocked) {
          sendJson(res, 404, { error: 'reference file is unavailable', code: 'missing-file' });
          return;
        }
        const buffer = readReferenceFile(entry, catalog, readFileSync);
        const info = sniffImage(buffer);
        res.writeHead(200, {
          'content-type': info.mime,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        res.end(buffer);
        return;
      }
      const outputMatch = pathname.match(/^\/api\/outputs\/([A-Za-z0-9._-]+)$/);
      if (req.method === 'GET' && outputMatch) {
        const file = outputFile(store, outputMatch[1]);
        if (!file) {
          sendJson(res, 404, { error: 'output not found', code: 'not-found' });
          return;
        }
        const buffer = readFileSync(file);
        const info = sniffImage(buffer);
        res.writeHead(200, {
          'content-type': info.mime || 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        res.end(buffer);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/runs') {
        sendJson(res, 200, { runs: store.listManifests().map(publicManifest) });
        return;
      }
      const runMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9._-]+)$/);
      if (req.method === 'GET' && runMatch) {
        const manifest = store.readManifest(runMatch[1]);
        if (!manifest) {
          sendJson(res, 404, { error: 'run not found', code: 'not-found' });
          return;
        }
        sendJson(res, 200, publicManifest(manifest));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/prompt-preview') {
        const body = await readBody(req);
        const campaign = loadCampaign(root);
        const resolved = resolveRunBody({ ...body, prompt: null }, catalog, campaign, root);
        let roleError = null;
        try {
          assertWorkflowInputs(resolved.workflow, resolved.inputs);
        } catch (err) {
          roleError = { code: err.code, missing: err.missing ?? [], forbidden_roles: err.forbidden_roles ?? [] };
        }
        sendJson(res, 200, {
          prompt: resolved.prompt,
          template_id: resolved.template_id,
          template_version: resolved.template_version,
          role_error: roleError,
        });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/probe') {
        const body = await readBody(req);
        if (body.confirm !== 'run-discovery' && body.confirm !== 'run-transport-probe') {
          sendJson(res, 400, { error: 'probe requires confirm run-discovery or run-transport-probe', code: 'confirm' });
          return;
        }
        const profile = body.confirm === 'run-transport-probe'
          ? await runTransportProbe({ config, store, fetchImpl, redactWith })
          : await runDiscovery({ config, store, fetchImpl, redactWith });
        log({ route: '/api/probe', transport: profile.transport.status, requests: profile.discovery_requests });
        sendJson(res, 200, profile);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/runs') {
        const body = await readBody(req);
        if (body.confirm !== 'run-one') {
          sendJson(res, 400, { error: 'a run requires confirm run-one', code: 'confirm' });
          return;
        }
        const campaign = loadCampaign(root);
        const resolved = resolveRunBody(body, catalog, campaign, root);
        const manifest = await executeRun({
          config,
          store,
          catalog,
          profile: store.readCapability(),
          fetchImpl,
          redactWith,
          body: resolved,
        });
        log({
          route: '/api/runs',
          run_id: manifest.run_id,
          http_status: manifest.http.status,
          error_class: manifest.http.error_class,
        });
        sendJson(res, 200, manifest);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/runs/batch') {
        const body = await readBody(req);
        if (body.confirm !== 'run-batch') {
          sendJson(res, 400, { error: 'a batch requires confirm run-batch', code: 'confirm' });
          return;
        }
        const ids = Array.isArray(body.experiment_ids) ? body.experiment_ids : [];
        if (!ids.length || ids.length > BATCH_LIMIT) {
          sendJson(res, 400, { error: `select 1 to ${BATCH_LIMIT} experiments`, code: 'batch' });
          return;
        }
        const campaign = loadCampaign(root);
        const runs = [];
        for (const id of ids) {
          const experiment = experimentById(campaign, id);
          const resolved = resolveRunBody({
            experiment_id: experiment.id,
            inputs: experiment.inputs,
            workflow: experiment.workflow,
            aspect_ratio: experiment.aspect_ratio,
            layout_purpose: experiment.layout_purpose,
            prompt: null,
          }, catalog, campaign, root);
          const manifest = await executeRun({
            config,
            store,
            catalog,
            profile: store.readCapability(),
            fetchImpl,
            redactWith,
            body: resolved,
          });
          runs.push(manifest);
          log({ route: '/api/runs/batch', run_id: manifest.run_id, http_status: manifest.http.status, error_class: manifest.http.error_class });
          if (!manifest.output) break;
        }
        sendJson(res, 200, { runs });
        return;
      }
      const evaluationMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9._-]+)\/evaluation$/);
      if (req.method === 'POST' && evaluationMatch) {
        const body = await readBody(req);
        const manifest = saveEvaluation(store, evaluationMatch[1], body);
        log({ route: '/api/runs/evaluation', run_id: manifest.run_id, verdict: manifest.verdict });
        sendJson(res, 200, manifest);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/exports') {
        const evidence = buildEvidence(store, redactWith);
        const filename = `evidence-${Date.now()}.json`;
        store.saveExport(filename, evidence);
        log({ route: '/api/exports', filename });
        sendJson(res, 200, { filename, evidence });
        return;
      }
      sendJson(res, 404, { error: 'not found', code: 'not-found' });
    } catch (err) {
      const status = err.status || 500;
      const code = err.code || 'internal';
      const message = status >= 500 ? 'request failed' : redact(err.message || 'request failed', redactWith);
      log({ route: pathname, code, status });
      if (!res.headersSent) sendJson(res, status, { error: message, code });
    }
  };
}

export function startServer(options = {}) {
  const env = options.env ?? process.env;
  const runsDir = options.runsDir ?? env.IMAGE_SPIKE_RUNS_DIR ?? path.join(SPIKE_ROOT, 'runs');
  const config = options.config ?? readImageConfig(env);
  const store = options.store ?? createStore(runsDir);
  const app = createApp({ ...options, env, runsDir, config, store, root: SPIKE_ROOT });
  const server = createServer((req, res) => {
    app(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'request failed', code: 'internal' });
    });
  });
  const host = '127.0.0.1';
  const port = Number(options.port ?? env.IMAGE_SPIKE_PORT ?? 4317);
  return new Promise((resolveListen) => {
    server.listen(port, host, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      if (options.quiet !== true) {
        console.log(`image spike listening on http://${host}:${bound}`);
      }
      resolveListen({
        server,
        baseUrl: `http://${host}:${bound}`,
        store,
        config,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
