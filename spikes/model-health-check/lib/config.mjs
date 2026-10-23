import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertBase } from './url.mjs';

function unquote(value) {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

export function parseEnvFile(text) {
  const parsed = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = unquote(trimmed.slice(separator + 1));
  }
  return parsed;
}

export function loadEnvironment(env = process.env, options = {}) {
  const readFile = options.readFile ?? readFileSync;
  const exists = options.exists ?? existsSync;
  const cwd = options.cwd ?? process.cwd();
  const selected = String(env.MODEL_HEALTH_ENV_FILE ?? env.CONTEST_ENV_FILE ?? '').trim();
  const envPath = selected || resolve(cwd, '.env.local');
  const merged = { ...env };
  if (!exists(envPath)) return merged;
  try {
    for (const [key, value] of Object.entries(parseEnvFile(readFile(envPath, 'utf8')))) {
      if (merged[key] == null) merged[key] = value;
    }
  } catch {
    return merged;
  }
  return merged;
}

export function readConfig(env = process.env, options = {}) {
  const source = options.layered === false ? env : loadEnvironment(env, options);
  const baseUrl = String(source.BASE_URL ?? '').trim();
  const token = String(source.CONTEST_API_TOKEN ?? source.API_TOKEN ?? '').trim();
  const missing = [];
  if (!baseUrl) missing.push('BASE_URL');
  if (!token) missing.push('CONTEST_API_TOKEN or API_TOKEN');
  if (missing.length) return { configured: false, missing, reason: 'required configuration is absent' };
  try {
    assertBase(baseUrl);
  } catch (error) {
    return { configured: false, missing: ['BASE_URL'], reason: error.message };
  }
  const timeoutMs = Number(source.MODEL_HEALTH_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { configured: false, missing: [], reason: 'MODEL_HEALTH_TIMEOUT_MS must be a positive number' };
  }
  return { configured: true, missing: [], reason: null, baseUrl, token, timeoutMs };
}
