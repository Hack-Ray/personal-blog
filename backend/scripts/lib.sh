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
