#!/usr/bin/env bash
# One-step backup of the CMS database: articles, drafts, versions, snapshots,
# images (stored in PostgreSQL), releases and the admin password hash.
#
#   scripts/backup.sh                  # from the Docker Compose database
#   scripts/backup.sh --url <URL>      # from any PostgreSQL, e.g. on AWS
#   scripts/backup.sh --out <dir>      # where to write (default: backups/)
#
# Writes blog-<timestamp>.dump (pg_dump custom format) and a .sha256 beside it.
set -euo pipefail
cd "$(dirname "$0")/.."

# macOS ships shasum; Linux ships sha256sum.
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

url="" out="backups"
while [ $# -gt 0 ]; do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$out"
file="$out/blog-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

if [ -n "$url" ]; then
  pg_dump --format=custom --no-owner --dbname="${url/+psycopg/}" --file="$partial"
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
(cd "$out" && sha256 "$(basename "$file")" > "$(basename "$file").sha256")
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
