import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODEL } from './constants.mjs';
import { assertBase } from './url.mjs';

function unquote(value) {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = unquote(trimmed.slice(eq + 1));
  }
  return out;
}

export function loadEnvLayers(env = process.env, { cwd = process.cwd(), readFile = readFileSync, exists = existsSync } = {}) {
  const merged = { ...env };
  const selected = String(env.CONTEST_ENV_FILE ?? '').trim();
  const filePath = selected || resolve(cwd, '.env.local');
  if (!selected && !exists(filePath)) return merged;
  if (selected && !exists(filePath)) return merged;
  let text = '';
  try {
    text = readFile(filePath, 'utf8');
  } catch {
    return merged;
  }
  const parsed = parseEnvFile(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (merged[key] == null) merged[key] = value;
  }
  return merged;
}

export function readImageConfig(env = process.env, options = {}) {
  const source = options.layered === false ? env : loadEnvLayers(env, options);
  const baseUrl = String(source.BASE_URL ?? '').trim();
  const token = String(source.CONTEST_API_TOKEN ?? '').trim();
  const missing = [];
  if (!baseUrl) missing.push('BASE_URL');
  if (!token) missing.push('CONTEST_API_TOKEN');
  if (missing.length > 0) {
    return { configured: false, missing, model: MODEL, reason: 'required live configuration is absent' };
  }
  try {
    assertBase(baseUrl);
  } catch (err) {
    return { configured: false, missing: ['BASE_URL'], model: MODEL, reason: err.message };
  }
  let timeoutMs = 180_000;
  if (source.CONTEST_TIMEOUT_MS != null && String(source.CONTEST_TIMEOUT_MS).trim() !== '') {
    const parsed = Number(source.CONTEST_TIMEOUT_MS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { configured: false, missing: [], model: MODEL, reason: 'CONTEST_TIMEOUT_MS must be a positive number' };
    }
    timeoutMs = parsed;
  }
  return {
    configured: true,
    missing: [],
    model: MODEL,
    reason: null,
    baseUrl,
    token,
    timeoutMs,
  };
}

export function redactOptions(config) {
  if (!config?.configured) return { secrets: [], baseUrl: '' };
  return { secrets: [config.token], baseUrl: config.baseUrl };
}
