import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES } from './constants.mjs';
import { assertPathAllowed, foldName } from './forbidden.mjs';
import { sniffImage } from './image-info.mjs';

export function spikeRoot() {
  return fileURLToPath(new URL('..', import.meta.url));
}

export function loadCatalog(root = spikeRoot(), { readFile = readFileSync, exists = existsSync } = {}) {
  const spec = JSON.parse(readFile(path.join(root, 'catalog', 'references.json'), 'utf8'));
  const localFile = path.join(root, 'catalog', 'local-paths.json');
  let local = { paths: {}, forbidden_paths: [] };
  if (exists(localFile)) {
    local = { paths: {}, forbidden_paths: [], ...JSON.parse(readFile(localFile, 'utf8')) };
  }
  const rules = {
    basenames: (spec.forbidden ?? []).map((entry) => entry.basename),
    paths: local.forbidden_paths ?? [],
  };
  const references = (spec.references ?? []).map((entry) => {
    const eligible = entry.eligible_roles ?? [entry.default_role];
    for (const role of eligible) {
      if (!ROLES.includes(role)) throw new Error(`unknown role on ${entry.id}`);
    }
    const configured = local.paths?.[entry.id] ?? '';
    let available = false;
    let blocked = null;
    if (configured) {
      try {
        assertPathAllowed(configured, rules);
        available = exists(configured);
      } catch (err) {
        blocked = err.code || 'forbidden-input';
        available = false;
      }
    }
    return {
      id: entry.id,
      character: entry.character ?? null,
      purpose: entry.purpose,
      basename: entry.basename,
      default_role: entry.default_role,
      eligible_roles: eligible,
      optional: Boolean(entry.optional),
      available,
      blocked,
      local_path: blocked ? null : (configured || null),
    };
  });
  return {
    version: spec.version,
    style_authority_id: spec.style_authority_id,
    forbidden: spec.forbidden ?? [],
    rules,
    references,
  };
}

export function publicReference(entry) {
  return {
    id: entry.id,
    character: entry.character,
    purpose: entry.purpose,
    basename: entry.basename,
    default_role: entry.default_role,
    eligible_roles: entry.eligible_roles,
    optional: entry.optional,
    available: entry.available,
    blocked: entry.blocked,
  };
}

export function referenceById(catalog, id) {
  const entry = catalog.references.find((item) => item.id === id);
  if (!entry) {
    const error = new Error(`unknown reference: ${id}`);
    error.code = 'unknown-reference';
    error.status = 400;
    throw error;
  }
  return entry;
}

export function assertAssignment(catalog, { id, role }) {
  const entry = referenceById(catalog, id);
  if (entry.blocked) {
    const error = new Error(`forbidden input: ${entry.basename}`);
    error.code = 'forbidden-input';
    error.status = 400;
    throw error;
  }
  if (!entry.eligible_roles.includes(role)) {
    const error = new Error(`${entry.id} cannot take the role ${role}`);
    error.code = 'role-mismatch';
    error.status = 400;
    throw error;
  }
  if (!entry.local_path) {
    const error = new Error(`reference file is not configured: ${entry.id}`);
    error.code = 'missing-file';
    error.status = 400;
    throw error;
  }
  assertPathAllowed(entry.local_path, catalog.rules);
  if (foldName(path.basename(entry.local_path)) !== foldName(entry.basename) && catalog.rules.basenames.some((name) => foldName(name) === foldName(path.basename(entry.local_path)))) {
    const error = new Error(`forbidden input: ${path.basename(entry.local_path)}`);
    error.code = 'forbidden-input';
    error.status = 400;
    throw error;
  }
  return entry;
}

export function readReferenceFile(entry, catalog, readFile = readFileSync) {
  assertPathAllowed(entry.local_path, catalog.rules);
  let buffer;
  try {
    buffer = readFile(entry.local_path);
  } catch {
    const error = new Error(`reference file is unavailable: ${entry.id}`);
    error.code = 'missing-file';
    error.status = 404;
    throw error;
  }
  const info = sniffImage(buffer);
  if (!info.mime) {
    const error = new Error(`not an image: ${entry.id}`);
    error.code = 'not-image';
    error.status = 400;
    throw error;
  }
  return buffer;
}
