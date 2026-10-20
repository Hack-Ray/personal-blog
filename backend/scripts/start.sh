#!/usr/bin/env bash
# Start the local CMS: database, a backup, migrations, then the server.
#
#   scripts/start.sh
#
# The backup runs before migrations, so a migration problem can be undone
# with scripts/restore.sh. backups/ is git-ignored; copy it to cloud storage.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "backend/.env is missing: run 'cp .env.example .env' and fill it in (docs/local-setup.md section 4)." >&2; exit 1; }
[ -d ../cms/dist ] || echo "warning: ../cms/dist is missing, so /admin/ will 404; build it with: (cd ../cms && npm ci && npm run build)" >&2

echo "==> Starting the database"
docker compose up -d --wait

echo "==> Backing up"
if ! scripts/backup.sh; then
  echo "warning: the backup FAILED; the CMS still starts, but fix this before editing" >&2
fi

echo "==> Applying migrations"
uv run --env-file .env alembic upgrade head

echo "==> CMS on http://127.0.0.1:8000/admin/ (Ctrl+C to stop)"
exec uv run --env-file .env uvicorn blog.api:app --host 127.0.0.1 --port 8000
