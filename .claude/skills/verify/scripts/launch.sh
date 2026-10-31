#!/usr/bin/env bash
# Starts a throwaway CMS for verification: its own database, a throwaway
# password, no .env and no GitHub credentials, so it cannot publish anything.
#   .claude/skills/verify/scripts/launch.sh [--empty]
# Restores the newest backend/backups/*.dump unless --empty or none exists.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../.." && pwd)"
state="$repo/.audit/verify/instance"
port="${VERIFY_PORT:-8010}"
db="${VERIFY_DB:-blog_verify}"
password="verify-only-$(openssl rand -hex 6)"
url="postgresql+psycopg://blog:blog@127.0.0.1:5432/$db"

[ ! -f "$state/pid" ] || { echo "an instance is already running (pid $(cat "$state/pid")); run cleanup.sh first" >&2; exit 1; }
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $port is taken; set VERIFY_PORT" >&2; exit 1; fi
mkdir -p "$state"

cd "$repo/backend"
docker compose up -d --wait db >/dev/null
docker compose exec -T db dropdb -U blog --if-exists "$db"
docker compose exec -T db createdb -U blog "$db"
dump="$(ls -t backups/*.dump 2>/dev/null | head -1 || true)"
if [ "${1:-}" != "--empty" ] && [ -n "$dump" ]; then
  docker compose exec -T db pg_restore -U blog -d "$db" --no-owner < "$dump" 2>/dev/null || true
  echo "restored $dump"
fi
clean_env=(env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$url" ALLOWED_HOSTS=127.0.0.1,localhost)
"${clean_env[@]}" uv run alembic upgrade head >/dev/null
"${clean_env[@]}" uv run python -c "
import sys
from blog.db import SessionLocal
from blog.auth import set_password
with SessionLocal() as s: set_password(s, sys.argv[1])" "$password"

(cd "$repo/cms" && npm run build >/dev/null)
nohup "${clean_env[@]}" uv run uvicorn blog.api:app --host 127.0.0.1 --port "$port" > "$state/cms.log" 2>&1 &
echo $! > "$state/pid"
printf '%s' "$password" > "$state/password"
printf 'http://127.0.0.1:%s' "$port" > "$state/url"
printf '%s' "$db" > "$state/db"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$port/admin/" >/dev/null && { echo "ready at http://127.0.0.1:$port/admin/"; exit 0; }
  sleep 1
done
echo "CMS did not become ready; see $state/cms.log" >&2
exit 1
