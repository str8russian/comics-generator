const descriptions = {
  text: 'Ожидается короткий текстовый ответ. Страница отдельно покажет, совпал ли он с ожидаемым значением «4».',
  image: 'Ожидается inline PNG с красным квадратом. Возвращённое изображение будет показано прямо в карточке.',
  invalid: 'Контрольный запрос с заведомо неверным именем модели. HTTP-ошибка означает, что сервер доступен и валидирует запрос.',
  quota: 'Показывает расход, бюджет, оставшийся процент и время последней активности.',
};

const labels = { text: 'TEXT MODEL', image: 'IMAGE MODEL', invalid: 'NEGATIVE CONTROL', quota: 'QUOTA' };
const roots = {
  text: document.querySelector('#text-checks'),
  image: document.querySelector('#image-checks'),
  invalid: document.querySelector('#service-checks'),
  quota: document.querySelector('#service-checks'),
};

function formatMoney(value) {
  return value == null ? 'N/A' : `$${Number(value).toFixed(2)}`;
}

function localTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'medium',
  }).format(date);
}

function resultMeta(result) {
  const fragment = document.createDocumentFragment();
  const row = document.createElement('div');
  row.className = 'meta-row';
  const http = document.createElement('span');
  http.textContent = result.http_status == null ? 'Нет HTTP-ответа' : `HTTP ${result.http_status}`;
  const latency = document.createElement('span');
  latency.textContent = `${result.latency_ms} ms`;
  const at = document.createElement('span');
  at.textContent = localTime(result.checked_at);
  row.append(http, latency, at);
  fragment.append(row);
  return fragment;
}

function renderResult(root, result) {
  root.replaceChildren(resultMeta(result));
  if (result.answer != null) {
    const answer = document.createElement('p');
    answer.className = 'answer';
    answer.textContent = `Ответ: ${result.answer}${result.answer_matches_expected ? ' ✓' : ' — отличается от ожидаемого'}`;
    root.append(answer);
  }
  if (result.image) {
    const meta = document.createElement('p');
    meta.className = 'answer';
    meta.textContent = `${result.image.mime} · ${result.image.width}×${result.image.height}`;
    const image = document.createElement('img');
    image.className = 'result-image';
    image.alt = 'Результат тестовой генерации';
    image.src = result.image.data_url;
    root.append(meta, image);
  }
  if (result.quota) {
    const quota = document.createElement('div');
    quota.className = 'quota';
    const values = [
      [`${formatMoney(result.quota.spend)} / ${formatMoney(result.quota.max_budget)}`, 'Потрачено / бюджет'],
      [result.quota.spent_percent == null ? 'N/A' : `${result.quota.spent_percent}%`, 'Потрачено'],
      [result.quota.left_percent == null ? 'N/A' : `${result.quota.left_percent}%`, 'Осталось'],
      [localTime(result.quota.last_active), 'Последняя активность, UTC+3'],
    ];
    for (const [value, label] of values) {
      const item = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = value;
      const caption = document.createElement('span');
      caption.textContent = label;
      item.append(strong, caption);
      quota.append(item);
    }
    root.append(quota);
  }
  if (result.error) {
    const error = document.createElement('p');
    error.className = result.ok ? 'answer' : 'error-message';
    error.textContent = result.error;
    root.append(error);
  }
  if (result.usage) {
    const usage = document.createElement('p');
    usage.className = 'meta-row';
    usage.textContent = `Usage: ${JSON.stringify(result.usage)}`;
    root.append(usage);
  }
}

function cardFor(check) {
  const template = document.querySelector('#check-card-template');
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.check = check.id;
  card.querySelector('.kind').textContent = labels[check.kind];
  card.querySelector('h3').textContent = check.label;
  card.querySelector('.model').textContent = check.model || '/key/info';
  card.querySelector('.description').textContent = descriptions[check.kind];
  const badge = card.querySelector('.badge');
  const button = card.querySelector('button');
  button.setAttribute('aria-label', `Проверить ${check.label}`);
  const result = card.querySelector('.result');
  button.addEventListener('click', async () => {
    button.disabled = true;
    badge.className = 'badge is-running';
    badge.textContent = 'Проверяю…';
    result.replaceChildren();
    try {
      const response = await fetch(`/api/checks/${check.id}`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Локальный сервер вернул ошибку');
      renderResult(result, payload);
      badge.className = `badge ${payload.ok ? 'is-ok' : 'is-error'}`;
      badge.textContent = payload.ok ? (payload.outcome === 'expected-error' ? 'Сервер отвечает' : 'Доступна') : 'Ошибка';
    } catch (error) {
      badge.className = 'badge is-error';
      badge.textContent = 'Ошибка';
      const message = document.createElement('p');
      message.className = 'error-message';
      message.textContent = error.message;
      result.append(message);
    } finally {
      button.disabled = false;
    }
  });
  return card;
}

async function initialize() {
  const statusNode = document.querySelector('#server-status');
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    if (!response.ok) throw new Error('status request failed');
    statusNode.className = `server-status ${status.configured ? 'is-ok' : 'is-error'}`;
    statusNode.textContent = status.configured
      ? `Локальный сервер готов · ${status.transport}`
      : `Нет конфигурации: ${status.missing.join(', ')}`;
    for (const check of status.checks) roots[check.kind].append(cardFor(check));
    if (!status.configured) {
      document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    }
  } catch {
    statusNode.className = 'server-status is-error';
    statusNode.textContent = 'Локальный сервер недоступен';
  }
}

initialize();
