#!/usr/bin/env bash
# Writes the CMS environment file from AWS SSM Parameter Store, so secrets are
# kept and rotated in SSM instead of edited on the host.
#
#   ssm-env.sh --path /blog/cms --env-file /srv/blog/cms.env [--region ap-northeast-1]
#
# Each parameter directly under --path becomes one KEY=value line, named after
# the last part of its name (/blog/cms/DATABASE_URL -> DATABASE_URL). The file
# is replaced only when every parameter is valid. Run deploy-cloud.sh afterwards:
# a running container keeps the environment it was started with.
set -euo pipefail

path="" env_file="" region=""
while [ $# -gt 0 ]; do
  case "$1" in
    --path|--env-file|--region)
      [ $# -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
      key="${1#--}"; key="${key//-/_}"; printf -v "$key" '%s' "$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "$path" =~ ^/[a-zA-Z0-9_./-]+$ && "$env_file" == /* ]] || {
  echo "usage: ssm-env.sh --path /blog/cms --env-file /srv/blog/cms.env [--region REGION]" >&2; exit 2;
}
for tool in aws python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 2; }; done

aws_args=(ssm get-parameters-by-path --path "$path" --with-decryption --output json)
if [ -n "$region" ]; then aws_args+=(--region "$region"); fi
umask 077
tmp="$(mktemp "$(dirname "$env_file")/.cms.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
aws "${aws_args[@]}" | python3 -c '
import json, re, sys
lines = {}
for p in json.load(sys.stdin)["Parameters"]:
    key = p["Name"].rsplit("/", 1)[-1]
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
        sys.exit(f"parameter {p['"'"'Name'"'"']} is not a valid variable name")
    if "\n" in p["Value"] or "\r" in p["Value"]:
        sys.exit(f"{key} contains a line break; store multi-line secrets as files")
    lines[key] = p["Value"]
if lines.get("CMS_ENV") != "cloud":
    sys.exit("CMS_ENV=cloud must be one of the parameters")
sys.stdout.write("".join(f"{k}={v}\n" for k, v in sorted(lines.items())))
' > "$tmp"
mv "$tmp" "$env_file"
trap - EXIT
printf 'Wrote %s variables to %s\n' "$(wc -l < "$env_file" | tr -d ' ')" "$env_file"
