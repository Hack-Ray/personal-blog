#!/usr/bin/env bash
# Stops the instance launch.sh started and drops its database. Evidence under
# .audit/verify/<run>/ is kept.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../.." && pwd)"
state="$repo/.audit/verify/instance"
[ -d "$state" ] || { echo "nothing to clean"; exit 0; }
if [ -f "$state/pid" ]; then
  pid="$(cat "$state/pid")"
  pkill -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
fi
if [ -f "$state/db" ]; then
  (cd "$repo/backend" && docker compose exec -T db dropdb -U blog --if-exists "$(cat "$state/db")")
fi
rm -rf "$state"
echo "cleaned"
