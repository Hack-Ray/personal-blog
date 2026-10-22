# Shared by the scripts in this folder; source it from backend/.

# macOS ships shasum; Linux ships sha256sum.
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

# The value of KEY in .env, unless the environment already sets it.
env_value() {
  local current="${!1:-}"
  if [ -n "$current" ] || [ ! -f .env ]; then echo "$current"; return; fi
  sed -n "s/^$1=//p" .env | tail -n 1
}

# Splits a DATABASE_URL into $libpq (no password) and $PGPASSWORD, so the
# password stays out of the process list.
use_url() {
  local parts
  parts="$(uv run --no-sync python -c '
import sys
from sqlalchemy.engine import make_url
u = make_url(sys.argv[1])
print(u.set(drivername="postgresql", password=None).render_as_string(hide_password=False))
print(u.password or "")
' "$1")"
  libpq="$(sed -n 1p <<< "$parts")"
  local password
  password="$(sed -n 2p <<< "$parts")"
  if [ -n "$password" ]; then export PGPASSWORD="$password"; fi
}
