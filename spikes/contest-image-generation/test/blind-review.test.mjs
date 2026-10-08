import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DUROV_BLIND_LIMITATION,
  RATING_FILE_NAMES,
  importBlindRatings,
  ratingsFromFields,
  revealBlindMapping,
  reviewPageHtml,
  validateRatings,
} from '../lib/blind-review.mjs';

const LETTERS = ['A', 'B', 'C'];

function filled(character, ranks = [1, 2, 3], limitation = '') {
  const values = {};
  LETTERS.forEach((letter, index) => {
    values[`identity_likeness_${letter}`] = '4';
    values[`stylization_strength_${letter}`] = '3';
    values[`visual_language_match_${letter}`] = '5';
    values[`non_photorealism_${letter}`] = '5';
    values[`safe_reusable_composition_${letter}`] = index === 2 ? 'fail' : 'pass';
    values[`foreign_identity_leakage_${letter}`] = index === 1 ? 'detected' : 'none detected';
    values[`preference_rank_${letter}`] = String(ranks[index]);
    values[`notes_${letter}`] = '';
  });
  return ratingsFromFields(character, values, '2026-10-08T00:00:00.000Z', limitation);
}

function writeRatings(dir, docs) {
  const files = {};
  for (const [character, doc] of Object.entries(docs)) {
    const file = path.join(dir, RATING_FILE_NAMES[character]);
    writeFileSync(file, JSON.stringify(doc));
    files[character] = file;
  }
  return files;
}

test('review pages start blank, use one form, and explain the scales', () => {
  const html = reviewPageHtml({ character: 'putin' });
  assert.equal((html.match(/<form\b/g) || []).length, 1);
  assert.equal((html.match(/<select\b/g) || []).length, 21);
  assert.equal((html.match(/value="" selected>Select…/g) || []).length, 21);
  assert.equal(html.includes('selected>1<'), false);
  assert.equal(html.includes('selected>pass<'), false);
  assert.equal(html.includes('<option>pass</option>'), false);
  assert.match(html, /required/g);
  assert.match(html, /none detected/);
  assert.match(html, /detected/);
  assert.match(html, /1 = poor/);
  assert.match(html, /3 = mixed/);
  assert.match(html, /5 = strong/);
  assert.match(html, /far from photographic rendering/);
  assert.match(html, /Preference rank 1 means most preferred/);
  assert.match(html, /held only in this page/);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('reset()'), false);
  assert.equal(/V[123]/.test(html), false);
});

test('required scores and unique ranks reject an unfinished review', () => {
  const empty = ratingsFromFields('putin', {}, '2026-10-08T00:00:00.000Z');
  const missing = validateRatings(empty);
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /identity_likeness is required/);
  const duplicated = filled('putin', [1, 1, 2]);
  const ranks = validateRatings(duplicated);
  assert.equal(ranks.ok, false);
  assert.match(ranks.errors.join(' '), /exactly once/);
  assert.equal(validateRatings(filled('putin')).ok, true);
});

test('exported ratings keep anonymous letters and omit generation details', () => {
  const doc = filled('peskov');
  const json = JSON.stringify(doc);
  assert.deepEqual(Object.keys(doc.candidates), ['A', 'B', 'C']);
  assert.equal(doc.schema_version, 1);
  assert.equal(/V[123]/.test(json), false);
  assert.equal(json.includes('prompt'), false);
  assert.equal(json.includes('gemini'), false);
  assert.equal(json.includes('base64'), false);
  assert.equal(json.includes('http'), false);
  assert.equal(json.includes('Bearer'), false);
  const durov = filled('durov', [1, 2, 3], DUROV_BLIND_LIMITATION);
  assert.equal(validateRatings(durov).ok, true);
  assert.equal(durov.blind_limitation, DUROV_BLIND_LIMITATION);
  const durovPage = reviewPageHtml({ character: 'durov', blindLimitation: DUROV_BLIND_LIMITATION });
  assert.match(durovPage, /not fully blind/);
  assert.equal(/V[123]/.test(durovPage), false);
});

test('import rejects incomplete or invalid ratings and does not read a mapping', () => {
  const source = mkdtempSync(path.join(tmpdir(), 'blind-ratings-src-'));
  const destination = path.join(mkdtempSync(path.join(tmpdir(), 'blind-ratings-dest-')), 'ratings');
  const valid = {
    putin: filled('putin'),
    peskov: filled('peskov'),
    durov: filled('durov', [1, 2, 3], DUROV_BLIND_LIMITATION),
  };
  assert.throws(() => importBlindRatings({
    files: { putin: writeRatings(source, { putin: valid.putin }).putin },
    destinationDir: destination,
  }), /incomplete/);
  const invalidFiles = writeRatings(source, {
    ...valid,
    putin: filled('putin', [1, 1, 2]),
  });
  assert.throws(() => importBlindRatings({ files: invalidFiles, destinationDir: destination }), /invalid/);
  let mappingReads = 0;
  assert.throws(() => revealBlindMapping({
    ratingsDir: destination,
    readMapping() {
      mappingReads += 1;
      return { hidden: true };
    },
  }), /incomplete/);
  assert.equal(mappingReads, 0);
  const imported = importBlindRatings({
    files: writeRatings(source, valid),
    destinationDir: destination,
  });
  assert.deepEqual(imported, { imported: ['putin', 'durov', 'peskov'], revealed: false });
  const stored = JSON.parse(readFileSync(path.join(destination, 'putin-blind-ratings.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.candidates), ['A', 'B', 'C']);
});

test('review export and import make no provider request', () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error('provider request');
  };
  try {
    reviewPageHtml({ character: 'putin' });
    validateRatings(filled('putin'));
    const source = mkdtempSync(path.join(tmpdir(), 'blind-ratings-net-'));
    const destination = path.join(mkdtempSync(path.join(tmpdir(), 'blind-ratings-net-dest-')), 'ratings');
    importBlindRatings({
      files: writeRatings(source, {
        putin: filled('putin'),
        peskov: filled('peskov'),
        durov: filled('durov', [1, 2, 3], DUROV_BLIND_LIMITATION),
      }),
      destinationDir: destination,
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
