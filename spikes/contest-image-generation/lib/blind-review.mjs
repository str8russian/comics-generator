import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RATINGS_SCHEMA_VERSION = 1;
export const REVIEW_CHARACTERS = ['putin', 'durov', 'peskov'];
export const CANDIDATE_LETTERS = ['A', 'B', 'C'];
export const DUROV_BLIND_LIMITATION = 'This review is not fully blind. One candidate was already shown before this page was made. This page does not say which one.';
export const EXPORT_CONFIRMATION = 'Ratings exported. Keep the variant mapping hidden until all three files are imported.';

export const RATING_FILE_NAMES = {
  putin: 'putin-blind-ratings.json',
  peskov: 'peskov-blind-ratings.json',
  durov: 'durov-blind-ratings.json',
};

const SCORE_FIELDS = [
  ['identity_likeness', 'Identity likeness'],
  ['stylization_strength', 'Stylization strength'],
  ['visual_language_match', 'Match to desired visual language'],
  ['non_photorealism', 'Non-photorealism'],
];

function isScore(value) {
  return [1, 2, 3, 4, 5].includes(value);
}

export function validateRatings(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['ratings document is missing'] };
  if (doc.schema_version !== RATINGS_SCHEMA_VERSION) errors.push('schema version is missing');
  if (!REVIEW_CHARACTERS.includes(doc.character)) errors.push('character is missing');
  if (typeof doc.reviewed_at !== 'string' || !doc.reviewed_at) errors.push('review timestamp is missing');
  if (doc.character === 'durov' && doc.blind_limitation !== DUROV_BLIND_LIMITATION) {
    errors.push('Durov partial-blinding limitation is missing');
  }
  if (doc.character !== 'durov' && doc.blind_limitation) errors.push('blind limitation is only recorded for Durov');
  const ranks = [];
  for (const letter of CANDIDATE_LETTERS) {
    const candidate = doc.candidates?.[letter];
    if (!candidate) {
      errors.push(`${letter} is missing`);
      continue;
    }
    for (const [field] of SCORE_FIELDS) {
      if (!isScore(candidate[field])) errors.push(`${letter} ${field} is required`);
    }
    if (!['pass', 'fail'].includes(candidate.safe_reusable_composition)) {
      errors.push(`${letter} safe reusable composition is required`);
    }
    if (!['none detected', 'detected'].includes(candidate.foreign_identity_leakage)) {
      errors.push(`${letter} foreign-identity leakage is required`);
    }
    if (![1, 2, 3].includes(candidate.preference_rank)) errors.push(`${letter} preference rank is required`);
    else ranks.push(candidate.preference_rank);
    if (candidate.notes != null && typeof candidate.notes !== 'string') errors.push(`${letter} notes must be text`);
  }
  if (ranks.length === 3 && new Set(ranks).size !== 3) {
    errors.push('Use each preference rank 1, 2, and 3 exactly once.');
  }
  return { ok: errors.length === 0, errors };
}

export function ratingsFromFields(character, values, reviewedAt, blindLimitation = '') {
  const candidates = {};
  for (const letter of CANDIDATE_LETTERS) {
    const score = (field) => {
      const raw = values[`${field}_${letter}`];
      if (raw == null || raw === '') return null;
      const number = Number(raw);
      return Number.isInteger(number) ? number : null;
    };
    candidates[letter] = {
      identity_likeness: score('identity_likeness'),
      stylization_strength: score('stylization_strength'),
      visual_language_match: score('visual_language_match'),
      non_photorealism: score('non_photorealism'),
      safe_reusable_composition: values[`safe_reusable_composition_${letter}`] || null,
      foreign_identity_leakage: values[`foreign_identity_leakage_${letter}`] || null,
      preference_rank: score('preference_rank'),
      notes: values[`notes_${letter}`] ?? '',
    };
  }
  const document = {
    schema_version: RATINGS_SCHEMA_VERSION,
    character,
    reviewed_at: reviewedAt,
    candidates,
  };
  if (blindLimitation) document.blind_limitation = blindLimitation;
  return document;
}

function options(values, labels = values) {
  return ['<option value="" selected>Select…</option>']
    .concat(values.map((value, index) => `<option value="${value}">${labels[index]}</option>`))
    .join('');
}

function candidateFields(letter) {
  const scores = SCORE_FIELDS.map(([field, label]) => `
        <label>${label}
          <select name="${field}_${letter}" required>${options([1, 2, 3, 4, 5])}</select>
          <span class="field-error" data-error="${field}_${letter}"></span>
        </label>`).join('');
  return `<article>
      <h2>${letter}</h2>
      <img src="candidate-${letter.toLowerCase()}.png" alt="">
      ${scores}
      <label>Safe reusable composition
        <select name="safe_reusable_composition_${letter}" required>${options(['pass', 'fail'])}</select>
        <span class="field-error" data-error="safe_reusable_composition_${letter}"></span>
      </label>
      <label>Foreign-identity leakage
        <select name="foreign_identity_leakage_${letter}" required>${options(['none detected', 'detected'])}</select>
        <span class="field-error" data-error="foreign_identity_leakage_${letter}"></span>
      </label>
      <label>Overall preference rank
        <select name="preference_rank_${letter}" required>${options([1, 2, 3])}</select>
        <span class="field-error" data-error="preference_rank_${letter}"></span>
      </label>
      <label>Notes
        <textarea name="notes_${letter}"></textarea>
      </label>
    </article>`;
}

export function reviewPageHtml({ character, blindLimitation = '' }) {
  const limitation = blindLimitation ? `<p class="limitation">${blindLimitation}</p>` : '';
  const config = JSON.stringify({
    character,
    fileName: RATING_FILE_NAMES[character],
    blindLimitation: blindLimitation || '',
    confirmation: EXPORT_CONFIRMATION,
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${character} base-anchor review</title>
  <style>
    body { margin: 24px; background: #f3efe4; color: #1c1915; font: 16px/1.45 Georgia, serif; }
    img { width: 100%; height: 640px; object-fit: contain; background: #111; }
    .row, .pair { display: grid; gap: 16px; }
    .row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .pair { grid-template-columns: 1fr 1fr; margin-top: 28px; }
    .evaluation { outline: 4px solid #8c2f2a; outline-offset: 4px; }
    label, .warning, .guidance { display: block; margin: 8px 0; }
    select, textarea, button { font: inherit; }
    textarea { width: 100%; min-height: 72px; }
    .limitation, .warning { border: 1px solid #8c2f2a; padding: 12px; }
    .field-error { color: #8c2f2a; min-height: 1.2em; }
    .actions { display: flex; gap: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>${character} base anchors</h1>
  ${limitation}
  <p>Rate the anonymous candidates before looking at other matrix files. This page does not name the generation settings.</p>
  <p class="guidance">1 = poor. 3 = mixed. 5 = strong. For non-photorealism, 5 means clearly illustrated and far from photographic rendering. Preference rank 1 means most preferred.</p>
  <p class="warning">Ratings are held only in this page until you download or copy them. Refreshing or closing the page before export will lose them.</p>
  <h2>Identity photograph</h2>
  <img src="identity.jpg" alt="">
  <form id="ratings" autocomplete="off">
    <div class="row">
      ${candidateFields('A')}
      ${candidateFields('B')}
      ${candidateFields('C')}
    </div>
    <div class="pair">
      <section class="evaluation">
        <h2>Evaluation only — not sent</h2>
        <img src="evaluation-only.png" alt="">
        <p>Manually approved historical anchor. Evaluation only — not sent.</p>
      </section>
      <section>
        <h2>Style authority</h2>
        <img src="style-authority.png" alt="">
        <p>Separate evaluation section for the style authority.</p>
      </section>
    </div>
    <p id="form-error" class="field-error"></p>
    <div class="actions">
      <button type="button" id="download-ratings">Download ratings JSON</button>
      <button type="button" id="copy-ratings">Copy ratings JSON</button>
    </div>
    <p id="export-status"></p>
    <textarea id="copy-fallback" hidden readonly></textarea>
  </form>
  <script>
    const REVIEW = ${config};
    const RATINGS_SCHEMA_VERSION = ${RATINGS_SCHEMA_VERSION};
    const REVIEW_CHARACTERS = ${JSON.stringify(REVIEW_CHARACTERS)};
    const CANDIDATE_LETTERS = ${JSON.stringify(CANDIDATE_LETTERS)};
    const DUROV_BLIND_LIMITATION = ${JSON.stringify(DUROV_BLIND_LIMITATION)};
    const SCORE_FIELDS = ${JSON.stringify(SCORE_FIELDS)};
    ${isScore.toString()}
    ${validateRatings.toString()}
    ${ratingsFromFields.toString()}
    const form = document.getElementById('ratings');
    const formError = document.getElementById('form-error');
    const exportStatus = document.getElementById('export-status');
    const copyFallback = document.getElementById('copy-fallback');

    function readValues() {
      const values = {};
      for (const element of form.elements) {
        if (element.name) values[element.name] = element.value;
      }
      return values;
    }

    function showErrors(errors) {
      for (const node of form.querySelectorAll('[data-error]')) node.textContent = '';
      const messages = [];
      for (const error of errors) {
        const match = /^([A-C]) ([a-z_]+) is required$/.exec(error);
        if (match) {
          const node = form.querySelector('[data-error="' + match[2] + '_' + match[1] + '"]');
          if (node) node.textContent = 'Select a value.';
        }
        messages.push(error);
      }
      formError.textContent = messages.join(' ');
    }

    function collected() {
      const documentRatings = ratingsFromFields(REVIEW.character, readValues(), new Date().toISOString(), REVIEW.blindLimitation);
      const result = validateRatings(documentRatings);
      if (!result.ok) {
        exportStatus.textContent = '';
        showErrors(result.errors);
        return null;
      }
      showErrors([]);
      return JSON.stringify(documentRatings, null, 2);
    }

    function markExported() {
      exportStatus.textContent = REVIEW.confirmation;
    }

    document.getElementById('download-ratings').addEventListener('click', () => {
      const json = collected();
      if (!json) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      link.download = REVIEW.fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      markExported();
    });

    document.getElementById('copy-ratings').addEventListener('click', async () => {
      const json = collected();
      if (!json) return;
      try {
        await navigator.clipboard.writeText(json);
        copyFallback.hidden = true;
        markExported();
      } catch (error) {
        copyFallback.hidden = false;
        copyFallback.value = json;
        copyFallback.focus();
        copyFallback.select();
        exportStatus.textContent = 'Clipboard was unavailable. The ratings JSON is selected below.';
      }
    });
  </script>
</body>
</html>
`;
}

export function importBlindRatings({
  files,
  destinationDir,
  readFile = readFileSync,
  writeFile = writeFileSync,
  mkdir = mkdirSync,
}) {
  const loaded = {};
  for (const character of REVIEW_CHARACTERS) {
    const source = files?.[character];
    if (!source) {
      const error = new Error('ratings incomplete');
      error.code = 'ratings-incomplete';
      throw error;
    }
    let doc;
    try {
      doc = JSON.parse(readFile(source, 'utf8'));
    } catch {
      const error = new Error('ratings invalid');
      error.code = 'ratings-invalid';
      throw error;
    }
    const result = validateRatings(doc);
    if (!result.ok || doc.character !== character) {
      const error = new Error('ratings invalid');
      error.code = 'ratings-invalid';
      error.errors = result.errors;
      throw error;
    }
    loaded[character] = doc;
  }
  mkdir(destinationDir, { recursive: true });
  for (const character of REVIEW_CHARACTERS) {
    writeFile(
      path.join(destinationDir, RATING_FILE_NAMES[character]),
      `${JSON.stringify(loaded[character], null, 2)}\n`,
    );
  }
  return { imported: [...REVIEW_CHARACTERS], revealed: false };
}

export function revealBlindMapping({ ratingsDir, readMapping, readFile = readFileSync }) {
  for (const character of REVIEW_CHARACTERS) {
    let doc;
    try {
      doc = JSON.parse(readFile(path.join(ratingsDir, RATING_FILE_NAMES[character]), 'utf8'));
    } catch {
      const error = new Error('ratings incomplete');
      error.code = 'ratings-incomplete';
      throw error;
    }
    const result = validateRatings(doc);
    if (!result.ok || doc.character !== character) {
      const error = new Error('ratings invalid');
      error.code = 'ratings-invalid';
      error.errors = result.errors;
      throw error;
    }
  }
  return readMapping();
}
