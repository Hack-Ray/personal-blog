#!/usr/bin/env bash
set -euo pipefail

image="" env_file="" backup_dir="" secrets_dir="" name=blog-cms port=8000 memory="" log_group="" log_region="" dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --image|--env-file|--backup-dir|--secrets-dir|--name|--port|--memory|--log-group|--log-region)
      [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
      key="${1#--}"; key="${key//-/_}"; printf -v "$key" '%s' "$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$image" ] && [ -n "$env_file" ] && [ -n "$backup_dir" ] || {
  echo "usage: deploy-cloud.sh --image IMAGE --env-file /path/cms.env --backup-dir /path/backups [--secrets-dir /path/secrets] [--name blog-cms] [--port 8000] [--memory 1g] [--log-group GROUP --log-region REGION] [--dry-run]" >&2; exit 2;
}
[[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9./:@_-]+$ ]] || { echo "invalid image" >&2; exit 2; }
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo "invalid container name" >&2; exit 2; }
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1024 && 10#$port <= 65535)) || { echo "port must be 1024-65535" >&2; exit 2; }
[ -z "$memory" ] || [[ "$memory" =~ ^[1-9][0-9]*[mg]$ ]] || { echo "memory must look like 512m or 1g" >&2; exit 2; }
if [ -n "$log_group$log_region" ]; then
  [[ "$log_group" =~ ^[a-zA-Z0-9_./#-]{1,512}$ && "$log_region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || {
    echo "--log-group and --log-region must be set together and be valid CloudWatch names" >&2; exit 2;
  }
fi
for path in "$env_file" "$backup_dir" ${secrets_dir:+"$secrets_dir"}; do
  [[ "$path" == /* && "$path" != *:* && "$path" != *,* ]] || { echo "paths must be absolute and contain no colon or comma" >&2; exit 2; }
done
[ -r "$env_file" ] || { echo "CMS environment file is not readable" >&2; exit 2; }
[ -d "$backup_dir" ] || { echo "backup directory does not exist" >&2; exit 2; }
[ -z "$secrets_dir" ] || [ -d "$secrets_dir" ] || { echo "secrets directory does not exist" >&2; exit 2; }
grep -Eq '^CMS_ENV=cloud\r?$' "$env_file" || { echo "CMS_ENV=cloud must be set in the environment file" >&2; exit 2; }
if [ "$dry_run" = 1 ]; then
  printf 'Validated deploy of %s to container %s on 127.0.0.1:%s\n' "$image" "$name" "$port"
  printf 'Memory limit: %s. Logs: %s\n' "${memory:-none}" "${log_group:+CloudWatch $log_group in $log_region}${log_group:-local json-file, 5 x 10 MB}"
  echo 'Plan: pull image; stop CMS; back up; migrate; replace CMS; check health.'
  exit 0
fi
[ "$(uname -s)" = Linux ] || { echo "cloud deployment requires a Linux Docker host" >&2; exit 2; }
for tool in docker flock curl; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 2; }; done

exec 9>"$backup_dir/.cms-deploy.lock"
flock -n 9 || { echo "CMS deployment or maintenance is already running" >&2; exit 1; }
hardening=(--read-only --mount type=volume,target=/tmp --cap-drop ALL --security-opt no-new-privileges --pids-limit 256)
if [ -n "$memory" ]; then hardening+=(--memory "$memory"); fi
mounts=(--mount "type=bind,source=$backup_dir,target=/backup")
if [ -n "$secrets_dir" ]; then mounts+=(--mount "type=bind,source=$secrets_dir,target=/run/secrets,readonly"); fi
common=(--rm --network host --env-file "$env_file" "${hardening[@]}" "${mounts[@]}")
logging=(--log-driver json-file --log-opt max-size=10m --log-opt max-file=5)
if [ -n "$log_group" ]; then
  logging=(--log-driver awslogs --log-opt "awslogs-group=$log_group" --log-opt "awslogs-region=$log_region" --log-opt "awslogs-stream=$name")
fi
docker pull "$image"
docker run "${common[@]}" "$image" python -c 'from blog.config import settings; assert settings.env == "cloud"'
was_running=0
if [ "$(docker inspect --type container -f '{{.State.Running}}' "$name" 2>/dev/null || true)" = true ]; then
  was_running=1
  docker stop "$name" >/dev/null
fi
backup_complete=0
recover_before_migration() {
  status=$?
  if [ "$status" != 0 ] && [ "$backup_complete" = 0 ] && [ "$was_running" = 1 ]; then
    docker start "$name" >/dev/null || true
  fi
  exit "$status"
}
trap recover_before_migration EXIT
docker run "${common[@]}" "$image" scripts/backup.sh --env --out /backup
backup_complete=1
docker run "${common[@]}" "$image" alembic upgrade head
if docker inspect --type container "$name" >/dev/null 2>&1; then docker rm -v "$name" >/dev/null; fi
docker run -d --name "$name" --restart unless-stopped --network host --env-file "$env_file" \
  "${hardening[@]}" "${logging[@]}" "${mounts[@]}" \
  "$image" uvicorn blog.api:app --host 127.0.0.1 --port "$port" --proxy-headers >/dev/null
for ((attempt=1; attempt<=30; attempt++)); do
  if [ "$(docker inspect --type container -f '{{.State.Running}}' "$name")" != true ]; then break; fi
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/healthz" >/dev/null; then
    printf 'CMS %s is healthy on 127.0.0.1:%s\n' "$name" "$port"
    exit 0
  fi
  sleep 1
done
docker stop "$name" >/dev/null || true
echo "CMS health check failed; the container is stopped. Inspect docker logs and restore the backup if needed." >&2
exit 1
