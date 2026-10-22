#!/usr/bin/env bash
# Start the local CMS: stop one already running, then database, a backup,
# migrations, due maintenance, then the server.
#
#   scripts/start.sh
#
# The backup runs before migrations, so a migration problem can be undone
# with scripts/restore.sh. backups/ is git-ignored; copy it to cloud storage,
# or set BACKUP_TARGET in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "backend/.env is missing: run 'cp .env.example .env' and fill it in (docs/local-setup.md section 4)." >&2; exit 1; }
. scripts/lib.sh
stop_cms 8000

[ -d ../cms/dist ] || echo "warning: ../cms/dist is missing, so /admin/ will 404; build it with: (cd ../cms && npm ci && npm run build)" >&2

echo "==> Starting the database"
docker compose up -d --wait

echo "==> Backing up"
if ! scripts/backup.sh; then
  if ! uv run --env-file .env alembic current 2>/dev/null | grep -q '(head)'; then
    echo "error: the backup FAILED and migrations are pending; fix the backup first so a bad migration can be undone" >&2
    exit 1
  fi
  echo "warning: the backup FAILED; the CMS still starts, but fix this before editing" >&2
fi

echo "==> Applying migrations"
uv run --env-file .env alembic upgrade head

echo "==> Running due maintenance"
uv run --env-file .env python -m blog.maintenance

echo "==> CMS on http://127.0.0.1:8000/admin/ (Ctrl+C to stop)"
exec uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
