#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. This REPLACES the whole
# database: everything written after the backup is lost.
#
#   scripts/restore.sh backups/blog-20261020T120000Z.dump
#   scripts/restore.sh s3://bucket/prefix/blog-....dump  # needs the aws CLI
#   scripts/restore.sh <file> --env         # into DATABASE_URL from the environment or .env
#   scripts/restore.sh <file> --url <URL>   # into any PostgreSQL, e.g. on AWS
#   scripts/restore.sh <file> --yes         # skip the confirmation prompt
#
# It first stops the CMS on this machine and backs up the current data. The
# restore runs in one transaction. Afterwards it runs the migrations, so an
# older backup works with newer code, signs everyone out, and records the
# content repository's HEAD so the next website update rolls the site back to
# this backup's content.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

file="" url="" yes=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) url="$(env_value DATABASE_URL)"; [ -n "$url" ] || { echo "DATABASE_URL is not set" >&2; exit 2; }; shift ;;
    --url) url="$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) file="$1"; shift ;;
  esac
done
[ -n "$file" ] || { echo "usage: scripts/restore.sh <backup.dump> [--env | --url URL] [--yes]" >&2; exit 2; }
source="$file"

if [[ "$file" == s3://* ]]; then
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' EXIT
  aws s3 cp --quiet "$file" "$dir/"
  aws s3 cp --quiet "$file.sha256" "$dir/" || echo "warning: could not download $file.sha256" >&2
  file="$dir/$(basename "$file")"
fi
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256 --check --quiet "$(basename "$file").sha256")
else
  echo "warning: no $file.sha256, skipping the checksum check" >&2
fi

target="$(sed -E 's#(://[^:/@]*):[^@]*@#\1:***@#' <<< "${url:-the Docker Compose database}")"
if [ -z "$yes" ]; then
  read -r -p "Replace ALL data in $target with $source? Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
fi

# Nothing may write while the data is replaced.
stop_cms 8000

echo "==> Backing up the current data first"
if [ -n "$url" ]; then DATABASE_URL="$url" scripts/backup.sh --env; else scripts/backup.sh; fi

# The dump becomes one SQL script, applied with the schema reset in a single
# transaction: a failure anywhere leaves the old data in place.
sql="$(mktemp)"
trap 'rm -f "$sql"; [ -z "${dir:-}" ] || rm -rf "$dir"' EXIT
if [ -n "$url" ]; then
  use_url "$url"
  export DATABASE_URL="$url"
  pg_restore --no-owner --file="$sql" "$file"
  target_psql() { psql --dbname="$libpq" "$@"; }
else
  docker compose exec -T db pg_restore --no-owner --file=- < "$file" > "$sql"
  target_psql() { docker compose exec -T db psql -U blog -d blog "$@"; }
fi
{
  echo "SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  cat "$sql"
} | target_psql --quiet --single-transaction --set ON_ERROR_STOP=1 > /dev/null

# The migrations read DATABASE_URL from .env unless --url set it above.
run() { if [ -f .env ]; then uv run --env-file .env "$@"; else uv run "$@"; fi; }
run alembic upgrade head
# Sign-ins saved in the backup are not carried over.
target_psql --quiet --set ON_ERROR_STOP=1 -c "DELETE FROM admin_sessions;" > /dev/null
# The database now decides what the site shows: the next website update
# replaces whatever the content repository holds with this backup's content.
run python -m blog.content_repository after-restore ||
  echo "warning: could not reach the content repository; run 'uv run --env-file .env python -m blog.content_repository after-restore' before the next website update" >&2
echo "Restored $source into $target."
