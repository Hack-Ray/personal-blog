#!/usr/bin/env bash
# Read-only: is the verification instance ours, up, serving the CMS, and signed-in-able?
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../.." && pwd)"
state="$repo/.audit/verify/instance"
[ -f "$state/pid" ] || { echo "no verification instance; run launch.sh" >&2; exit 1; }
pid="$(cat "$state/pid")"; url="$(cat "$state/url")"
kill -0 "$pid" 2>/dev/null || { echo "pid $pid is not running" >&2; exit 1; }
port="${url##*:}"
owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
pgrep -P "$pid" | grep -qx "$owner" || [ "$owner" = "$pid" ] || { echo "port $port is not owned by our pid $pid" >&2; exit 1; }
curl -fsS "$url/healthz" >/dev/null || { echo "healthz failed" >&2; exit 1; }
curl -fsS "$url/admin/" | grep -q '<div id="root">' || { echo "/admin/ does not serve the CMS build" >&2; exit 1; }
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d "{\"password\":\"$(cat "$state/password")\"}" "$url/api/session")"
[ "$code" = 204 ] || { echo "sign-in returned $code" >&2; exit 1; }
echo "ok: $url (pid $pid, db $(cat "$state/db"), cms build $(stat -f %Sm "$repo/cms/dist/index.html"))"
