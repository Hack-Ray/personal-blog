#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the cloud CMS's database,
# using the image of the CMS container that deploy-cloud.sh started. This
# REPLACES the whole database.
#
#   cloud-restore.sh --dump /srv/blog/backups/blog-<stamp>.dump \
#     --env-file /srv/blog/cms.env --backup-dir /srv/blog/backups [--secrets-dir /srv/blog/secrets] [--yes]
#   cloud-restore.sh --url '<presigned https URL>' --sha256 <hex> ...
#
# --url downloads the dump into the backup directory and writes its checksum
# beside it. The CMS is stopped for the restore and started again afterwards.
set -euo pipefail

dump="" url="" sha256="" env_file="" backup_dir="" secrets_dir="" name=blog-cms port=8000 yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dump|--url|--sha256|--env-file|--backup-dir|--secrets-dir|--name|--port)
      [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
      key="${1#--}"; key="${key//-/_}"; printf -v "$key" '%s' "$2"; shift 2 ;;
    --yes) yes=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
usage="usage: cloud-restore.sh (--dump FILE | --url HTTPS_URL --sha256 HEX) --env-file /path/cms.env --backup-dir /path/backups [--secrets-dir /path/secrets] [--name blog-cms] [--port 8000] [--yes]"
[ -n "$env_file" ] && [ -n "$backup_dir" ] && { [ -n "$dump" ] || [ -n "$url" ]; } && { [ -z "$dump" ] || [ -z "$url" ]; } || { echo "$usage" >&2; exit 2; }
for path in "$env_file" "$backup_dir" ${secrets_dir:+"$secrets_dir"}; do
  [[ "$path" == /* && "$path" != *:* && "$path" != *,* ]] || { echo "paths must be absolute and contain no colon or comma" >&2; exit 2; }
done
backup_dir="${backup_dir%/}"
if [ -n "$url" ]; then
  [[ "$url" =~ ^https://[^[:space:]\"\\]+$ ]] || { echo "--url must be an https URL" >&2; exit 2; }
  [[ "$sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "--url needs --sha256 with the dump's 64-character SHA-256" >&2; exit 2; }
  file="$(basename "${url%%\?*}")"
else
  [ "$(dirname "$dump")" = "$backup_dir" ] || [ "$(dirname "$dump")" = . ] || { echo "the dump must be in $backup_dir, which is mounted into the restore container" >&2; exit 2; }
  file="$(basename "$dump")"
fi
[[ "$file" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$ ]] || { echo "the dump's file name must end in .dump" >&2; exit 2; }
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo "invalid container name" >&2; exit 2; }
[[ "$port" =~ ^[0-9]{1,5}$ ]] || { echo "invalid port" >&2; exit 2; }
[ -r "$env_file" ] || { echo "CMS environment file is not readable" >&2; exit 2; }
[ -d "$backup_dir" ] || { echo "backup directory does not exist" >&2; exit 2; }
[ -z "$secrets_dir" ] || [ -d "$secrets_dir" ] || { echo "secrets directory does not exist" >&2; exit 2; }
for tool in docker flock curl sha256sum; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 2; }; done

exec 9>"$backup_dir/.cms-deploy.lock"
flock -n 9 || { echo "CMS deployment or maintenance is already running" >&2; exit 1; }
image="$(docker inspect --type container -f '{{.Config.Image}}' "$name" 2>/dev/null || true)"
[ -n "$image" ] || { echo "no $name container; deploy once first so the restore uses the CMS image" >&2; exit 1; }

if [ -n "$url" ]; then
  [ ! -e "$backup_dir/$file" ] || { echo "$backup_dir/$file already exists; restore it with --dump" >&2; exit 1; }
  # Through --config so the presigned signature stays off the command line.
  printf 'url = "%s"\n' "$url" | curl --config - --fail --silent --show-error --output "$backup_dir/$file.partial"
  mv "$backup_dir/$file.partial" "$backup_dir/$file"
  printf '%s  %s\n' "$sha256" "$file" > "$backup_dir/$file.sha256"
fi
[ -f "$backup_dir/$file" ] || { echo "no such file: $backup_dir/$file" >&2; exit 2; }
if [ -f "$backup_dir/$file.sha256" ]; then
  (cd "$backup_dir" && sha256sum --check --quiet "$file.sha256") || { echo "checksum mismatch; the CMS was not stopped" >&2; exit 1; }
fi

if [ "$yes" != 1 ]; then
  read -r -p "Replace ALL CMS data with $file? Type 'restore' to continue: " answer
  [ "$answer" = restore ] || { echo "Cancelled."; exit 1; }
fi

hardening=(--read-only --mount type=volume,target=/tmp --cap-drop ALL --security-opt no-new-privileges --pids-limit 256)
mounts=(--mount "type=bind,source=$backup_dir,target=/backup")
if [ -n "$secrets_dir" ]; then mounts+=(--mount "type=bind,source=$secrets_dir,target=/run/secrets,readonly"); fi
docker stop "$name" >/dev/null
docker run --rm --network host --env-file "$env_file" -e BACKUP_TARGET=/backup "${hardening[@]}" "${mounts[@]}" \
  "$image" scripts/restore.sh "/backup/$file" --env --yes || {
  echo "Restore failed; $name stays stopped. Fix the error above, then retry with: cloud-restore.sh --dump $backup_dir/$file --env-file $env_file --backup-dir $backup_dir${secrets_dir:+ --secrets-dir $secrets_dir} --name $name --port $port" >&2
  exit 1
}
docker start "$name" >/dev/null
for ((attempt=1; attempt<=30; attempt++)); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/healthz" >/dev/null; then
    printf 'Restored %s; CMS %s is healthy on 127.0.0.1:%s\n' "$file" "$name" "$port"
    exit 0
  fi
  sleep 1
done
echo "Restored $file, but $name failed its health check. Inspect docker logs $name." >&2
exit 1
