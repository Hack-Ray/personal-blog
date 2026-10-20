#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. This REPLACES the whole
# database: everything written after the backup is lost.
#
#   scripts/restore.sh backups/blog-20261020T120000Z.dump
#   scripts/restore.sh <file> --url <URL>   # into any PostgreSQL, e.g. on AWS
#   scripts/restore.sh <file> --yes         # skip the confirmation prompt
#
# Afterwards it runs the migrations, so an older backup works with newer code.
set -euo pipefail
cd "$(dirname "$0")/.."

# macOS ships shasum; Linux ships sha256sum.
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

file="" url="" yes=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) file="$1"; shift ;;
  esac
done
[ -n "$file" ] || { echo "usage: scripts/restore.sh <backup.dump> [--url URL] [--yes]" >&2; exit 2; }
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256 --check --quiet "$(basename "$file").sha256")
else
  echo "warning: no $file.sha256, skipping the checksum check" >&2
fi

target="${url:-the Docker Compose database}"
if [ -z "$yes" ]; then
  read -r -p "Replace ALL data in $target with $file? Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
fi

if [ -n "$url" ]; then
  libpq="${url/+psycopg/}"
  psql --dbname="$libpq" --quiet --set ON_ERROR_STOP=1 -c "SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  pg_restore --no-owner --exit-on-error --dbname="$libpq" "$file"
  db_url="$url"
else
  docker compose exec -T db psql -U blog -d blog --quiet --set ON_ERROR_STOP=1 -c "SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  docker compose exec -T db pg_restore --no-owner --exit-on-error -U blog -d blog < "$file"
  db_url="${DATABASE_URL:-postgresql+psycopg://blog:blog@127.0.0.1:5432/blog}"
fi

DATABASE_URL="$db_url" uv run alembic upgrade head
echo "Restored $file into $target."
