#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
PORT="${MODEL_HEALTH_PORT:-4321}"
PAGE_URL="http://127.0.0.1:${PORT}"
STATUS_URL="${PAGE_URL}/api/status"
ENV_FILE="${MODEL_HEALTH_ENV_FILE:-${SCRIPT_DIR:h}/comics-pipeline/.env.local}"
LOG_FILE="/tmp/comics-model-health-${PORT}.log"
PID_FILE="/tmp/comics-model-health-${PORT}.pid"

page_is_ready() {
  /usr/bin/curl --silent --fail --max-time 1 "${STATUS_URL}" >/dev/null 2>&1
}

open_page() {
  if [[ "${MODEL_HEALTH_NO_OPEN:-0}" != "1" ]]; then
    /usr/bin/open "${PAGE_URL}"
  fi
}

if page_is_ready; then
  open_page
  exit 0
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  print -u2 "Не найден файл конфигурации: ${ENV_FILE}"
  print -u2 "Задайте MODEL_HEALTH_ENV_FILE или верните .env.local в основной comics-pipeline checkout."
  read -k 1 "?Нажмите любую клавишу, чтобы закрыть окно."
  exit 1
fi

cd "${SCRIPT_DIR}" || exit 1

NODE_BIN="$(command -v node 2>/dev/null)"
if [[ -z "${NODE_BIN}" ]]; then
  print -u2 "Не найден Node.js. Установите Node.js или добавьте node в PATH."
  read -k 1 "?Нажмите любую клавишу, чтобы закрыть окно."
  exit 1
fi

/usr/bin/nohup /usr/bin/env \
  MODEL_HEALTH_ENV_FILE="${ENV_FILE}" \
  MODEL_HEALTH_PORT="${PORT}" \
  "${NODE_BIN}" spikes/model-health-check/server.mjs \
  >"${LOG_FILE}" 2>&1 &

SERVER_PID=$!
print -r -- "${SERVER_PID}" > "${PID_FILE}"

for attempt in {1..40}; do
  if page_is_ready; then
    open_page
    exit 0
  fi
  /bin/sleep 0.25
done

print -u2 "Не удалось запустить Model Health Check."
print -u2 "Диагностический лог: ${LOG_FILE}"
if [[ -f "${LOG_FILE}" ]]; then
  /usr/bin/tail -n 20 "${LOG_FILE}"
fi
read -k 1 "?Нажмите любую клавишу, чтобы закрыть окно."
exit 1
