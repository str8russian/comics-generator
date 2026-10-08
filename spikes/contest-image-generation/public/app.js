const ROLE_LABELS = {
  'identity-reference': 'Identity reference',
  'identity-anchor': 'Identity anchor',
  'style-anchor': 'Style anchor',
  'supporting-style-reference': 'Supporting style reference',
  'performance-reference': 'Performance reference',
  'authoritative-staging-source': 'Authoritative staging source',
};

const RATINGS = [
  ['identity_preservation', 'Identity preservation'],
  ['style_anchor_match', 'Match to the style anchor'],
  ['expression', 'Expression'],
  ['gaze_direction', 'Gaze direction'],
  ['head_angle', 'Head angle'],
  ['pose_silhouette', 'Pose and silhouette'],
  ['shot_crop', 'Shot and crop'],
  ['performance_compliance', 'Performance-reference compliance'],
  ['identity_leakage_absent', 'Absence of identity leakage'],
  ['panel_scale_difference', 'Difference visible at panel size'],
  ['survives_crop', 'Survives the intended crop'],
];

const BLOCKING = [
  ['identity_substitution', 'Identity substitution or strong identity leakage'],
  ['wrong_gaze', 'Wrong gaze when direction was specified'],
  ['photorealism_drift', 'Drift back toward photorealism'],
  ['crop_loss', 'Mouth, expression, pose, or essential upper body lost in the crop'],
];

const state = {
  status: null,
  experiments: [],
  selected: null,
  promptDirty: false,
  optional: new Set(),
  runs: [],
};

const $ = (id) => document.getElementById(id);

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'request failed');
    error.code = payload.code;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function selectedInputs() {
  const experiment = state.selected;
  if (!experiment) return [];
  return [
    ...experiment.inputs,
    ...experiment.optional_inputs.filter((input) => state.optional.has(`${input.id}:${input.role}`)),
  ].map((input) => ({ id: input.id, role: input.role }));
}

function renderStatus() {
  const status = state.status;
  if (!status) return;
  $('live-count').textContent = String(status.campaign.live_requests);
  const transport = status.capability.transport?.status ?? 'unverified';
  const aspect = status.capability.aspect_ratio ?? 'untested';
  const refs = status.capability.reference_images ?? 'untested';
  $('status-bar').textContent = [
    status.configured ? 'Credentials are present on the server.' : `Server is missing ${status.missing.join(', ')}.`,
    `Model ${status.model}.`,
    `Transport ${transport}.`,
    `Reference images ${refs}.`,
    `Aspect parameter ${aspect}.`,
    `Envelope ${status.envelope.total} calls: discovery ${status.envelope.discovery}, anchors ${status.envelope.anchor}, derived ${status.envelope.derived}, layout ${status.envelope.layout}, repetition ${status.envelope.repetition}, diagnostic ${status.envelope.diagnostic}.`,
  ].join(' ');
}

function renderExperiments() {
  const groups = new Map();
  for (const experiment of state.experiments) {
    if (!groups.has(experiment.phase)) groups.set(experiment.phase, []);
    groups.get(experiment.phase).push(experiment);
  }
  const root = $('experiment-list');
  root.replaceChildren();
  for (const [phase, items] of groups) {
    const heading = document.createElement('h3');
    heading.className = 'phase';
    heading.textContent = phase;
    root.append(heading);
    for (const experiment of items) {
      const row = document.createElement('div');
      row.className = `case${state.selected?.id === experiment.id ? ' is-selected' : ''}`;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.batch = experiment.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = experiment.title;
      button.addEventListener('click', () => selectExperiment(experiment.id));
      row.append(box, button);
      root.append(row);
    }
  }
}

function renderReferences() {
  const experiment = state.selected;
  const root = $('references');
  root.replaceChildren();
  if (!experiment) return;
  const rows = [
    ...experiment.inputs.map((input) => ({ ...input, required: true })),
    ...experiment.optional_inputs.map((input) => ({ ...input, required: false })),
  ];
  for (const input of rows) {
    const key = `${input.id}:${input.role}`;
    const row = document.createElement('article');
    row.className = 'reference';
    if (input.available && !input.blocked) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = `/api/references/${input.id}/file`;
      row.append(image);
    } else {
      const missing = document.createElement('div');
      missing.className = 'missing';
      missing.textContent = input.blocked ? 'Blocked' : 'Missing';
      row.append(missing);
    }
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = input.id;
    const role = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'role';
    badge.textContent = ROLE_LABELS[input.role] ?? input.role;
    role.append(badge);
    if (!input.required) {
      const toggle = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.optional.has(key);
      box.addEventListener('change', async () => {
        if (box.checked) state.optional.add(key);
        else state.optional.delete(key);
        state.promptDirty = false;
        await refreshPrompt();
      });
      toggle.append(box, document.createTextNode(' include'));
      role.append(toggle);
    }
    const purpose = document.createElement('p');
    purpose.textContent = input.purpose;
    copy.append(title, role, purpose);
    row.append(copy);
    root.append(row);
  }
}

function renderAspect() {
  const select = $('aspect');
  const capability = state.status?.capability;
  const accepted = capability?.aspect_ratio === 'accepted';
  const verified = new Set(capability?.verified_aspect_ratios ?? []);
  select.replaceChildren();
  for (const ratio of state.status?.aspect_ratios ?? []) {
    const option = document.createElement('option');
    option.value = ratio;
    option.textContent = verified.has(ratio) ? ratio : `${ratio} (not individually verified)`;
    select.append(option);
  }
  if (state.selected) select.value = state.selected.aspect_ratio;
  select.disabled = !accepted;
  $('aspect-note').textContent = accepted
    ? 'The aspect parameter was accepted. Ratios other than the probed one are still individually unverified.'
    : 'The aspect parameter is not verified, so a run records the target ratio but does not send it as an API parameter.';
}

async function refreshPrompt() {
  if (!state.selected || state.promptDirty) return;
  const preview = await api('/api/prompt-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      experiment_id: state.selected.id,
      workflow: $('workflow').value,
      aspect_ratio: $('aspect').value,
      layout_purpose: state.selected.layout_purpose,
      inputs: selectedInputs(),
    }),
  });
  $('prompt').value = preview.prompt;
  const warning = $('role-warning');
  const limit = state.status?.capability?.reference_image_count_verified ?? 0;
  const selectedCount = selectedInputs().length;
  if (preview.role_error) {
    warning.hidden = false;
    warning.textContent = 'These references do not match the selected workflow, so the request will not be sent.';
    $('execute').disabled = true;
  } else if (limit > 0 && selectedCount > limit) {
    warning.hidden = false;
    warning.textContent = `This selection uses ${selectedCount} reference images. Discovery has verified at most ${limit}.`;
    $('execute').disabled = true;
  } else {
    warning.hidden = true;
    $('execute').disabled = false;
  }
}

async function selectExperiment(id) {
  state.selected = state.experiments.find((item) => item.id === id) ?? null;
  state.promptDirty = false;
  state.optional = new Set();
  renderExperiments();
  if (!state.selected) return;
  $('case-title').textContent = state.selected.title;
  $('case-meta').textContent = `${state.selected.character} · ${state.selected.workflow} · ${state.selected.phase} · intended crop ${state.selected.intended_crop}`;
  $('workflow').value = state.selected.workflow;
  $('aspect').value = state.selected.aspect_ratio;
  if (state.selected.orientation) $('orientation').textContent = state.selected.orientation;
  renderReferences();
  await refreshPrompt();
}

function frame(imageUrl, mode, scale, intended) {
  const viewport = document.createElement('div');
  viewport.className = `frame-viewport${intended ? ' is-intended' : ''}`;
  viewport.style.setProperty('--scale', String(scale));
  const canvas = document.createElement('div');
  canvas.className = 'frame-canvas';
  const strip = document.createElement('div');
  strip.className = 'panel-strip';
  const visualHeight = mode === 'wide-single' ? 780 : 780;
  strip.style.height = `${visualHeight}px`;
  const slots = mode === 'split-panel' ? 2 : 1;
  for (let index = 0; index < slots; index += 1) {
    const slot = document.createElement('div');
    slot.className = 'panel-slot';
    if (index === 0) {
      const image = document.createElement('img');
      image.alt = 'Generated result in the panel crop';
      image.src = imageUrl;
      slot.append(image);
    }
    strip.append(slot);
  }
  const dialogue = document.createElement('div');
  dialogue.className = 'dialogue';
  dialogue.textContent = 'Dialogue bar';
  canvas.append(strip, dialogue);
  viewport.append(canvas);
  return viewport;
}

function resultView(run) {
  const root = document.createElement('div');
  const meta = document.createElement('p');
  meta.textContent = [
    run.run_id,
    run.http?.error_class ? `error ${run.http.error_class}` : `HTTP ${run.http?.status}`,
    run.output ? `${run.output.mime} ${run.output.width}×${run.output.height}` : 'no image',
    `target ${run.aspect_ratio}`,
    run.request_parameters?.aspect_ratio ? `sent ${run.request_parameters.aspect_ratio}` : 'aspect parameter not sent',
  ].join(' · ');
  root.append(meta);
  if (!run.output) return root;
  const url = `/api/outputs/${run.output.filename}`;
  const previews = document.createElement('div');
  previews.className = 'previews';
  const uncropped = document.createElement('figure');
  uncropped.className = 'uncropped';
  const image = document.createElement('img');
  image.alt = 'Uncropped generated result';
  image.src = url;
  const caption = document.createElement('figcaption');
  caption.textContent = 'Uncropped';
  uncropped.append(image, caption);
  const splitCaption = document.createElement('figcaption');
  splitCaption.textContent = 'Split panel, 936×780 inside 1920×1080';
  const wideCaption = document.createElement('figcaption');
  wideCaption.textContent = 'Wide single frame, 1920×780 inside 1920×1080';
  const split = document.createElement('figure');
  split.append(frame(url, 'split-panel', 0.22, run.layout_purpose === 'split-panel'), splitCaption);
  const wide = document.createElement('figure');
  wide.append(frame(url, 'wide-single', 0.22, run.layout_purpose === 'wide-single' || run.layout_purpose === 'anchor-review'), wideCaption);
  previews.append(uncropped, split, wide);
  root.append(previews, evaluationForm(run));
  return root;
}

function evaluationForm(run) {
  const form = document.createElement('form');
  const ratings = document.createElement('div');
  ratings.className = 'ratings';
  for (const [key, label] of RATINGS) {
    const field = document.createElement('label');
    field.append(document.createTextNode(label));
    const select = document.createElement('select');
    select.name = `rating-${key}`;
    for (const value of ['pass', 'fail', 'unsure', 'not-applicable']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if (run.ratings?.[key]) select.value = run.ratings[key];
    field.append(select);
    ratings.append(field);
  }
  const blocking = document.createElement('fieldset');
  blocking.className = 'blocking';
  const legend = document.createElement('legend');
  legend.textContent = 'Blocking findings';
  blocking.append(legend);
  for (const [key, label] of BLOCKING) {
    const field = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = `blocking-${key}`;
    box.checked = Boolean(run.blocking?.[key]);
    field.append(box, document.createTextNode(label));
    blocking.append(field);
  }
  const rationale = document.createElement('textarea');
  rationale.name = 'rationale';
  rationale.rows = 3;
  rationale.placeholder = 'Concise rationale';
  rationale.value = run.rationale ?? '';
  const failure = document.createElement('input');
  failure.name = 'failure_class';
  failure.placeholder = 'failure-class';
  const technique = document.createElement('select');
  technique.name = 'technique';
  for (const value of ['prompt-tweak', 'different-reference-composition', 'edit-accepted', 'layout-from-accepted', 'other']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    technique.append(option);
  }
  const buttons = document.createElement('div');
  buttons.className = 'verdict-row';
  for (const verdict of ['accepted', 'rejected', 'retry', 'reuse-existing']) {
    const button = document.createElement('button');
    button.type = 'submit';
    button.value = verdict;
    button.textContent = verdict;
    if (verdict !== 'accepted') button.className = 'secondary';
    buttons.append(button);
  }
  const note = document.createElement('p');
  note.className = 'warning';
  note.hidden = true;
  blocking.addEventListener('change', () => {
    const present = BLOCKING.some(([key]) => form.elements[`blocking-${key}`].checked);
    note.hidden = !present;
    note.textContent = 'A blocking finding is present. Acceptance stays disabled until it is cleared.';
    buttons.querySelector('button[value="accepted"]').disabled = present;
  });
  form.append(ratings, blocking, note, rationale, failure, technique, buttons);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const verdict = event.submitter?.value;
    const payload = {
      verdict,
      rationale: rationale.value,
      ratings: Object.fromEntries(RATINGS.map(([key]) => [key, form.elements[`rating-${key}`].value])),
      blocking: Object.fromEntries(BLOCKING.map(([key]) => [key, form.elements[`blocking-${key}`].checked])),
      failure_class: failure.value,
      technique: technique.value,
    };
    try {
      const saved = await api(`/api/runs/${run.run_id}/evaluation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      $('result').prepend(Object.assign(document.createElement('p'), { textContent: `${saved.run_id} recorded as ${saved.verdict}.` }));
    } catch (err) {
      note.hidden = false;
      note.textContent = err.message;
    }
  });
  return form;
}

async function executeOne() {
  const experiment = state.selected;
  if (!experiment) return;
  $('execute').disabled = true;
  try {
    const manifest = await api('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: 'run-one',
        experiment_id: experiment.id,
        workflow: $('workflow').value,
        aspect_ratio: $('aspect').value || experiment.aspect_ratio,
        layout_purpose: experiment.layout_purpose,
        inputs: selectedInputs(),
        prompt: $('prompt').value,
        retry_of: null,
      }),
    });
    $('result').replaceChildren(resultView(manifest));
  } catch (err) {
    $('result').replaceChildren(Object.assign(document.createElement('p'), { className: 'warning', textContent: err.message }));
  } finally {
    state.status = await api('/api/status');
    renderStatus();
    $('execute').disabled = false;
  }
}

function bind() {
  $('prompt').addEventListener('input', () => { state.promptDirty = true; });
  $('workflow').addEventListener('change', () => { state.promptDirty = false; refreshPrompt(); });
  $('aspect').addEventListener('change', () => { if (!state.promptDirty) refreshPrompt(); });
  $('execute').addEventListener('click', executeOne);
  $('discover').addEventListener('click', async () => {
    if (!window.confirm('This sends exactly one live Chat Completions request. Continue?')) return;
    try {
      await api('/api/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'run-transport-probe' }),
      });
    } catch (err) {
      $('result').replaceChildren(Object.assign(document.createElement('p'), { className: 'warning', textContent: err.message }));
    }
    state.status = await api('/api/status');
    renderStatus();
    renderAspect();
  });
  $('batch-run').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('[data-batch]:checked')].map((box) => box.dataset.batch);
    if (!ids.length || ids.length > 3) {
      $('result').replaceChildren(Object.assign(document.createElement('p'), { className: 'warning', textContent: 'Select one to three experiments.' }));
      return;
    }
    if (!window.confirm(`This sends ${ids.length} live API request${ids.length === 1 ? '' : 's'}. Continue?`)) return;
    try {
      const payload = await api('/api/runs/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'run-batch', experiment_ids: ids }),
      });
      const wrap = document.createElement('div');
      for (const run of payload.runs) wrap.append(resultView(run));
      $('result').replaceChildren(wrap);
    } catch (err) {
      $('result').replaceChildren(Object.assign(document.createElement('p'), { className: 'warning', textContent: err.message }));
    }
    state.status = await api('/api/status');
    renderStatus();
  });
}

async function main() {
  state.status = await api('/api/status');
  const campaign = await api('/api/experiments');
  state.experiments = campaign.experiments;
  renderStatus();
  const workflow = $('workflow');
  for (const [id, label] of Object.entries(state.status.workflows)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    workflow.append(option);
  }
  renderAspect();
  renderExperiments();
  bind();
  $('batch-run').disabled = false;
  if (state.experiments[0]) await selectExperiment(state.experiments[0].id);
}

main().catch((err) => {
  $('status-bar').textContent = err.message;
});
