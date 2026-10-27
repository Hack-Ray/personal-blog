#!/usr/bin/env bash
# One-step backup of the CMS database: articles, drafts, versions, snapshots,
# images (stored in PostgreSQL), releases and the admin password hash.
#
#   scripts/backup.sh                  # from the Docker Compose database
#   scripts/backup.sh --env            # from DATABASE_URL in the environment or .env
#   scripts/backup.sh --url <URL>      # from any PostgreSQL, e.g. on AWS
#   scripts/backup.sh --out <target>   # a folder or s3://bucket/prefix
#
# Writes blog-<timestamp>.dump (pg_dump custom format) and a .sha256 beside it.
# The target defaults to BACKUP_TARGET (environment or .env), then backups/.
# BACKUP_KEEP (environment or .env) keeps only the newest N backups in a
# folder target. An s3:// target needs the aws CLI. --env keeps the password
# out of this script's command line; --url puts it there.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

url="" out="$(env_value BACKUP_TARGET)"
out="${out:-backups}"
while [ $# -gt 0 ]; do
  case "$1" in
    --env) url="$(env_value DATABASE_URL)"; [ -n "$url" ] || { echo "DATABASE_URL is not set" >&2; exit 2; }; shift ;;
    --url) url="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$out" in
  s3://*) dir="$(mktemp -d)" ;;
  *) dir="$out"; mkdir -p "$dir" ;;
esac
name="blog-$(date -u +%Y%m%dT%H%M%SZ).dump"
file="$dir/$name"
partial="$file.partial"
trap 'rm -f "$partial"; [ "$dir" = "$out" ] || rm -rf "$dir"' EXIT

if [ -n "$url" ]; then
  use_url "$url"
  pg_dump --format=custom --no-owner --dbname="$libpq" --file="$partial"
else
  docker compose exec -T db pg_dump --format=custom --no-owner -U blog blog > "$partial"
fi

# A dump that pg_restore cannot list is not a backup.
if [ -n "$url" ]; then
  pg_restore --list "$partial" > /dev/null
else
  docker compose exec -T db pg_restore --list < "$partial" > /dev/null
fi

mv "$partial" "$file"
(cd "$dir" && sha256 "$name" > "$name.sha256")
if [ "$dir" != "$out" ]; then
  aws s3 cp --quiet "$file.sha256" "${out%/}/$name.sha256"
  aws s3 cp --quiet "$file" "${out%/}/$name"
fi
echo "Backup written: ${out%/}/$name ($(du -h "$file" | cut -f1))"

# BACKUP_KEEP=N keeps the newest N backups in a folder target; an s3://
# target uses the bucket's lifecycle rules instead.
keep="$(env_value BACKUP_KEEP)"
if [ -n "$keep" ] && [ "$dir" = "$out" ]; then
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "BACKUP_KEEP must be a positive whole number" >&2; exit 2; }
  ls -1 "$dir" | grep -E '^blog-[0-9]{8}T[0-9]{6}Z\.dump$' | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
    rm -f "$dir/$old" "$dir/$old.sha256"
    echo "Removed old backup: $dir/$old"
  done
fi
