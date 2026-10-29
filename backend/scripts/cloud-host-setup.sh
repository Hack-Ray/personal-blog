#!/usr/bin/env bash
# Prepares an Amazon Linux 2023 EC2 host for the cloud CMS. Run it as root from
# a clone of this repo, through SSM Session Manager. Safe to run again.
#
#   sudo bash backend/scripts/cloud-host-setup.sh --region <region> \
#     [--ssm-path /blog/cms] [--root /srv/blog] [--s3 s3://<bucket>/cms/] \
#     [--tunnel-token-param /blog/cloudflared-token] [--container blog-cms] \
#     [--cloudflared-image cloudflare/cloudflared:<version>]
#
# Installs Docker, cron and automatic security updates, renders cms.env from
# SSM, starts a local PostgreSQL container when DATABASE_URL points at this
# host, schedules backups and maintenance, and runs Cloudflare Tunnel. See
# docs/cloud-ec2.md.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
etc="${HOST_PREFIX:-}/etc"
region="" ssm_path=/blog/cms root=/srv/blog s3="" tunnel_token_param="" container=blog-cms
cloudflared_image=cloudflare/cloudflared:2026.10.0
while [ $# -gt 0 ]; do
  case "$1" in
    --region|--ssm-path|--root|--s3|--tunnel-token-param|--container|--cloudflared-image)
      [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
      key="${1#--}"; key="${key//-/_}"; printf -v "$key" '%s' "$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "$region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || {
  echo "usage: cloud-host-setup.sh --region REGION [--ssm-path /blog/cms] [--root /srv/blog] [--s3 s3://bucket/prefix/] [--tunnel-token-param NAME] [--container blog-cms] [--cloudflared-image IMAGE]" >&2; exit 2;
}
[[ "$root" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "--root must be an absolute path without spaces" >&2; exit 2; }
[[ "$container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo "invalid container name" >&2; exit 2; }
[ -z "$s3" ] || [[ "$s3" =~ ^s3://[a-z0-9][a-z0-9.-]+(/[A-Za-z0-9_./-]*)?$ ]] || { echo "--s3 must look like s3://bucket/prefix/" >&2; exit 2; }
[ -z "$tunnel_token_param" ] || [[ "$tunnel_token_param" =~ ^(/[A-Za-z0-9_.-]+)+$ ]] || { echo "invalid --tunnel-token-param" >&2; exit 2; }
[[ "$cloudflared_image" =~ ^[a-z0-9][a-z0-9./_-]*:[A-Za-z0-9._-]+$ ]] || { echo "--cloudflared-image needs an explicit tag" >&2; exit 2; }

echo "==> Packages"
dnf install -y docker cronie dnf-automatic git
automatic="$etc/dnf/automatic.conf"
[ -f "$automatic" ] || { echo "$automatic is missing after installing dnf-automatic" >&2; exit 1; }
sed -i -E 's/^upgrade_type[[:space:]]*=.*/upgrade_type = security/; s/^apply_updates[[:space:]]*=.*/apply_updates = yes/' "$automatic"
systemctl enable --now docker crond dnf-automatic.timer

echo "==> Directories and scripts in $root"
mkdir -p "$root/backups" "$root/secrets"
chown 1000:1000 "$root/backups" "$root/secrets"
chmod 750 "$root/backups" "$root/secrets"
install -m 755 "$here/cloud-maintenance.sh" "$here/ssm-env.sh" "$root/"

echo "==> Environment file from SSM $ssm_path"
bash "$root/ssm-env.sh" --path "$ssm_path" --env-file "$root/cms.env" --region "$region"

echo "==> Database"
umask 077
db_env="$(mktemp)"
trap 'rm -f "$db_env"' EXIT
# Prints the port and writes the POSTGRES_* variables to $db_env when the
# database is local; prints nothing for RDS or another server.
db_port="$(DB_ENV="$db_env" python3 - "$root/cms.env" <<'PY'
import os, sys
from urllib.parse import unquote, urlsplit
url = ""
for line in open(sys.argv[1]):
    if line.startswith("DATABASE_URL="):
        url = line.rstrip("\r\n").split("=", 1)[1]
if not url:
    sys.exit("DATABASE_URL is missing from the environment file")
u = urlsplit(url)
if u.hostname not in ("127.0.0.1", "localhost"):
    sys.exit(0)
if not (u.username and u.password and u.path.strip("/")):
    sys.exit("a local DATABASE_URL needs a user, a password and a database name")
with open(os.environ["DB_ENV"], "w") as f:
    f.write(f"POSTGRES_USER={unquote(u.username)}\nPOSTGRES_PASSWORD={unquote(u.password)}\nPOSTGRES_DB={unquote(u.path.strip('/'))}\n")
print(u.port or 5432)
PY
)"
if [ -z "$db_port" ]; then
  echo "DATABASE_URL is not on this host; skipping the local PostgreSQL container."
else
  if docker inspect --type container blog-db >/dev/null 2>&1; then
    # The data and password stay as they were created; only start it.
    docker start blog-db >/dev/null
  else
    docker run -d --name blog-db --restart unless-stopped -p "127.0.0.1:$db_port:5432" \
      --mount type=volume,source=blog-pgdata,target=/var/lib/postgresql/data \
      --env-file "$db_env" postgres:16 >/dev/null
  fi
  db_user="$(sed -n 's/^POSTGRES_USER=//p' "$db_env")"
  for ((attempt=1; ; attempt++)); do
    if docker exec blog-db pg_isready -q -U "$db_user" >/dev/null 2>&1; then break; fi
    ((attempt < 60)) || { echo "PostgreSQL in blog-db did not become ready" >&2; exit 1; }
    sleep 2
  done
  echo "PostgreSQL is ready on 127.0.0.1:$db_port (container blog-db, volume blog-pgdata)."
fi
rm -f "$db_env"
umask 022

echo "==> Scheduled backup and maintenance"
mkdir -p "$etc/cron.d"
printf '%s\n' \
  "PATH=/usr/local/bin:/usr/bin:/bin" \
  "0 * * * * root bash $root/cloud-maintenance.sh maintenance $container $root/backups 2>&1 | logger -t blog-cms-maintenance" \
  "0 3 * * * root bash $root/cloud-maintenance.sh backup $container $root/backups${s3:+ $s3} 2>&1 | logger -t blog-cms-backup" \
  > "$etc/cron.d/blog-cms"
chmod 644 "$etc/cron.d/blog-cms"

if [ -n "$tunnel_token_param" ]; then
  echo "==> Cloudflare Tunnel"
  mkdir -p "$etc/cloudflared"
  chmod 700 "$etc/cloudflared"
  umask 077
  token="$(aws ssm get-parameter --name "$tunnel_token_param" --with-decryption --query Parameter.Value --output text --region "$region")"
  [[ -n "$token" && "$token" != *[[:space:]]* ]] || { echo "the tunnel token in $tunnel_token_param is empty or has whitespace" >&2; exit 1; }
  new_token="$(mktemp "$etc/cloudflared/.token.XXXXXX")"
  trap 'rm -f "$new_token"' EXIT
  printf 'TUNNEL_TOKEN=%s\n' "$token" > "$new_token"
  changed=0
  if cmp -s "$new_token" "$etc/cloudflared/token.env"; then rm -f "$new_token"; else mv "$new_token" "$etc/cloudflared/token.env"; changed=1; fi
  umask 022
  current="$(docker inspect --type container -f '{{.Config.Image}}' blog-cloudflared 2>/dev/null || true)"
  if [ "$changed" = 1 ] || [ "$current" != "$cloudflared_image" ]; then
    if [ -n "$current" ]; then docker rm -f blog-cloudflared >/dev/null; fi
    docker run -d --name blog-cloudflared --restart unless-stopped --network host \
      --read-only --cap-drop ALL --security-opt no-new-privileges \
      --env-file "$etc/cloudflared/token.env" \
      "$cloudflared_image" tunnel --no-autoupdate run >/dev/null
    echo "Started blog-cloudflared ($cloudflared_image)."
  else
    docker start blog-cloudflared >/dev/null
    echo "blog-cloudflared is unchanged."
  fi
fi

echo
echo "Host is ready: Docker, cron in $etc/cron.d/blog-cms, automatic security updates, $root/cms.env."
echo "Next: set the cms-production variables in GitHub and push a cms-v* tag to deploy the CMS."
