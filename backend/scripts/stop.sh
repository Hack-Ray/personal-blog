#!/usr/bin/env bash
# Stop the local CMS that scripts/start.sh runs in the background. The
# database keeps running; `docker compose stop` stops it too.
set -euo pipefail
cd "$(dirname "$0")/.."

. scripts/lib.sh
stopped="$(stop_cms 8000)"
echo "${stopped:-==> No CMS is running on port 8000}"
