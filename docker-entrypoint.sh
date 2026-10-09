#!/bin/sh
set -e

echo "[entrypoint] Initializing SQS queues..."
bun scripts/init-queues.ts

echo "[entrypoint] Running database migrations..."
retry=0
until bunx mikro-orm migration:up --config mikro-orm.config.prod.ts; do
  retry=$((retry + 1))
  if [ "$retry" -ge 10 ]; then
    echo "[entrypoint] ERROR: migrations failed after 10 attempts" >&2
    exit 1
  fi
  echo "[entrypoint] Retrying in 2s... (attempt $retry/10)"
  sleep 2
done

echo "[entrypoint] Starting application..."
exec bun dist/main.js
