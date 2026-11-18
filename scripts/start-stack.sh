#!/usr/bin/env bash
# Starts the Part 21 app with an optional supervised Temporal stack.
# The application must never fail to boot because Temporal is unavailable.
set -u
APP_PORT="${PORT:-3000}"
TEMPORAL_PORT="${TEMPORAL_PORT:-7233}"
HEALTH_PORT="${TEMPORAL_HEALTH_PORT:-8090}"
BUNDLE="${TEMPORAL_WORKFLOW_BUNDLE_PATH:-/app/dist/temporal/workflow-bundle.js}"
WORKER_ENTRY="${TEMPORAL_WORKER_ENTRY:-/app/dist/temporal/worker-entry.js}"

if command -v temporal >/dev/null 2>&1; then
  echo "[stack] starting Temporal service on ${TEMPORAL_PORT}"
  temporal server start-dev --port "${TEMPORAL_PORT}" --db-filename /tmp/part21-temporal.db --log-level error >/tmp/temporal.log 2>&1 &
  for _ in $(seq 1 40); do
    if temporal operator namespace list --address "127.0.0.1:${TEMPORAL_PORT}" >/dev/null 2>&1; then echo "[stack] Temporal ready"; break; fi
    sleep 1
  done
  export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:${TEMPORAL_PORT}}"
  if [ -f "${BUNDLE}" ] && [ -f "${WORKER_ENTRY}" ]; then
    echo "[stack] starting clock worker"
    TEMPORAL_WORKFLOW_BUNDLE_PATH="${BUNDLE}" TEMPORAL_APPLY_MIGRATION="${TEMPORAL_APPLY_MIGRATION:-true}" \
      node "${WORKER_ENTRY}" >/tmp/worker.log 2>&1 &
  else
    echo "[stack] worker artifacts missing; clocks stay derived"
  fi
else
  echo "[stack] temporal CLI absent; clocks stay derived"
fi

exec node dist/index.js
