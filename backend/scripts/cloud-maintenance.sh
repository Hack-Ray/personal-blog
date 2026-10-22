#!/usr/bin/env bash
set -euo pipefail

job="${1:-}" name="${2:-blog-cms}" backup_dir="${3:-}" s3_target="${4:-}"
[[ "$job" = backup || "$job" = maintenance ]] && [ -d "$backup_dir" ] || {
  echo "usage: cloud-maintenance.sh backup|maintenance CONTAINER /absolute/backup-directory [s3://bucket/prefix]" >&2; exit 2;
}
[[ "$backup_dir" = /* ]] || { echo "backup directory must be absolute" >&2; exit 2; }
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo "invalid container name" >&2; exit 2; }
if [ -n "$s3_target" ]; then
  [[ "$job" = backup && "$s3_target" = s3://?* ]] || { echo "S3 target is only supported for backups and must start with s3://" >&2; exit 2; }
  command -v aws >/dev/null || { echo "aws CLI is required for S3 backups" >&2; exit 2; }
fi
exec 9>"$backup_dir/.cms-deploy.lock"
flock -n 9 || { echo "CMS deployment or maintenance is already running" >&2; exit 1; }
if [ "$job" = backup ]; then
  docker exec "$name" scripts/backup.sh --env --out /backup
  if [ -n "$s3_target" ]; then aws s3 sync "$backup_dir" "$s3_target" --exclude '.*'; fi
else
  docker exec "$name" python -m blog.maintenance
fi
