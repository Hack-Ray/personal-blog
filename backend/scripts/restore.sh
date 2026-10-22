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
# Afterwards it runs the migrations, so an older backup works with newer code.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

file="" url="" yes=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) url="$(env_value DATABASE_URL)"; [ -n "$url" ] || { echo "DATABASE_URL is not set" >&2; exit 2; }; shift ;;
    --url) url="$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
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

if [ -n "$url" ]; then
  use_url "$url"
  psql --dbname="$libpq" --quiet --set ON_ERROR_STOP=1 -c "SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  pg_restore --no-owner --exit-on-error --dbname="$libpq" "$file"
  export DATABASE_URL="$url"
else
  docker compose exec -T db psql -U blog -d blog --quiet --set ON_ERROR_STOP=1 -c "SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  docker compose exec -T db pg_restore --no-owner --exit-on-error -U blog -d blog < "$file"
fi

# The migrations read DATABASE_URL from .env unless --url set it above.
if [ -f .env ]; then
  uv run --env-file .env alembic upgrade head
else
  uv run alembic upgrade head
fi
echo "Restored $source into $target."
