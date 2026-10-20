#!/bin/sh
# Project-local adaptation of pstack's hooks/session-start.sh (Claude runtime only).
set -eu

dir="$(dirname "$0")"
sheet="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/pstack-models.md"
reader="$dir/../skills/setup-pstack/scripts/read-sheet.sh"

# A sheet that cannot be decoded counts as missing, so injection stays on.
if [ -f "$sheet" ] && [ -r "$sheet" ] && normalized=$(sh "$reader" "$sheet"); then
  if printf '%s\n' "$normalized" | grep -qx 'session hook: off'; then
    exit 0
  fi
fi

cat "$dir/pstack-session-start-context.md"
