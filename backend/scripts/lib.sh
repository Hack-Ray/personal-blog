# Shared by the scripts in this folder; source it from backend/.

# macOS ships shasum; Linux ships sha256sum.
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

# The value of a setting as the CMS sees it: the environment first, then
# .env, parsed by uv exactly as `uv run --env-file .env` does. Without uv
# (e.g. a short cron PATH), a plain KEY=value line is read instead.
env_value() {
  if [ -n "${!1+set}" ] || [ ! -f .env ]; then echo "${!1:-}"; return; fi
  if ! command -v uv > /dev/null; then
    sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
    return
  fi
  BLOG_ENV_KEY="$1" uv run --no-sync --env-file .env python -c 'import os; print(os.environ.get(os.environ["BLOG_ENV_KEY"], ""))'
}

# Splits a DATABASE_URL into $libpq (no password) and $PGPASSWORD, so the
# password stays out of the pg tools' command lines. The URL reaches Python
# through the environment, not argv.
use_url() {
  local parts password
  parts="$(DB_URL="$1" uv run --no-sync python -c '
import os
from sqlalchemy.engine import URL, make_url
u = make_url(os.environ["DB_URL"])
print(URL.create("postgresql", u.username, None, u.host, u.port, u.database, u.query).render_as_string(hide_password=False))
print(u.password or "")
')"
  libpq="$(sed -n 1p <<< "$parts")"
  password="$(sed -n 2p <<< "$parts")"
  if [ -n "$password" ]; then export PGPASSWORD="$password"; fi
}

# Stops a CMS (`uvicorn blog.api:app`) still listening on port $1, so a restart
# runs the new code and settings. Refuses when another program holds the port.
# Without lsof it does nothing, and uvicorn reports a busy port itself.
stop_cms() {
  local port="$1" pids pid
  command -v lsof > /dev/null || return 0
  pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2> /dev/null)" || return 0
  for pid in $pids; do
    if ! ps -ww -o command= -p "$pid" | grep -q 'blog\.api:app'; then
      echo "error: port $port is used by another program (pid $pid): $(ps -ww -o command= -p "$pid")" >&2
      return 1
    fi
  done
  echo "==> Stopping the CMS already running on port $port (pid $(echo $pids))"
  kill $pids 2> /dev/null || true
  # Wait for the process, not the port: uvicorn closes the port first and
  # stops a scheduled backup (blog/backups.py) only after that.
  for _ in $(seq 150); do
    # A zombie has exited; only its parent can reap it.
    ps -o stat= -p "$(echo $pids | tr ' ' ,)" 2> /dev/null | grep -qv '^Z' || return 0
    sleep 0.2
  done
  echo "error: the old CMS (pid $(echo $pids)) did not stop within 30 seconds" >&2
  return 1
}

# Runs the command after $1 and $2 in the background, writing its output to
# log file $1 (the previous run's is kept as $1.1), and waits up to 30
# seconds for URL $2 to answer. If the command exits or never answers, prints
# the end of the log and returns 1.
start_detached() {
  local log="$1" url="$2" pid
  shift 2
  mkdir -p "$(dirname "$log")"
  if [ -f "$log" ]; then mv "$log" "$log.1"; fi
  nohup "$@" > "$log" 2>&1 < /dev/null &
  pid=$!
  for _ in $(seq 150); do
    curl -fsS --max-time 1 "$url" > /dev/null 2>&1 && return 0
    kill -0 "$pid" 2> /dev/null || break
    sleep 0.2
  done
  kill "$pid" 2> /dev/null || true
  echo "error: the CMS did not start; the end of $log:" >&2
  tail -n 20 "$log" >&2
  return 1
}

# Prints a notice when the upstream repo has a release newer than this
# checkout's version (pyproject.toml). Never fails: offline, rate-limited,
# no release yet, or UPDATE_CHECK_REPO=off all print nothing. It only tells;
# merging the update stays the user's choice.
check_release() {
  local repo api current latest
  repo="$(env_value UPDATE_CHECK_REPO)"; repo="${repo:-Hack-Ray/personal-blog}"
  [ "$repo" = off ] && return 0
  command -v curl > /dev/null || return 0
  api="$(env_value GITHUB_API_URL)"; api="${api:-https://api.github.com}"
  current="$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml)"
  latest="$(curl -fsS --max-time 3 "$api/repos/$repo/releases/latest" 2> /dev/null \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p')" || return 0
  [ -n "$latest" ] && [ -n "$current" ] && [ "$latest" != "$current" ] || return 0
  [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -n 1)" = "$latest" ] || return 0
  echo "==> A new release is out: v$latest (this copy is $current). Notes: https://github.com/$repo/releases/latest"
  echo "    To update, sync your fork and run 'git pull' (README, \"Keep your fork up to date\")."
}
