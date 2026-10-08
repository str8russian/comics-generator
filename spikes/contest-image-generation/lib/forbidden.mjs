import { realpathSync } from 'node:fs';
import path from 'node:path';

export function foldName(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('en-US');
}

export function pathIdentity(filePath) {
  const resolved = path.resolve(String(filePath ?? ''));
  let real = resolved;
  try {
    real = realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  return {
    resolved,
    real,
    basename: path.basename(real),
  };
}

export function isForbiddenIdentity(identity, { basenames = [], paths = [] } = {}) {
  const name = foldName(identity.basename);
  if (basenames.some((entry) => foldName(entry) === name)) return true;
  const forbiddenPaths = paths.map((entry) => pathIdentity(entry));
  return forbiddenPaths.some((entry) => (
    foldName(entry.resolved) === foldName(identity.resolved)
    || foldName(entry.real) === foldName(identity.real)
    || foldName(entry.basename) === name
  ));
}

export function assertPathAllowed(filePath, rules) {
  const identity = pathIdentity(filePath);
  if (isForbiddenIdentity(identity, rules)) {
    const error = new Error(`forbidden input: ${identity.basename}`);
    error.code = 'forbidden-input';
    error.status = 400;
    throw error;
  }
  return identity;
}
