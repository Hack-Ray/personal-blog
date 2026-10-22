import os
import subprocess
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def bash(script, cwd=BACKEND, **env):
    return subprocess.run(
        ["bash", "-c", f". scripts/lib.sh && {script}"],
        cwd=cwd, capture_output=True, text=True, check=True, env={**os.environ, **env},
    ).stdout.strip()


def test_use_url_keeps_the_password_out_of_the_connection_string():
    url = "postgresql+psycopg://pwuser:p%40ss%3Aw%2Frd@db.example:5433/blog?sslmode=verify-full"
    libpq, password = bash('use_url "$URL" && echo "$libpq" && echo "$PGPASSWORD"', URL=url).splitlines()
    assert libpq == "postgresql://pwuser@db.example:5433/blog?sslmode=verify-full"
    assert password == "p@ss:w/rd"


def test_env_value_reads_env_like_uv_and_lets_the_environment_win(tmp_path):
    (tmp_path / "scripts").symlink_to(BACKEND / "scripts")
    (tmp_path / ".env").write_text('BACKUP_TARGET="s3://bucket/cms"\r\nOTHER=x\r\n')
    env = {"UV_PROJECT": str(BACKEND)}
    assert bash("env_value BACKUP_TARGET", cwd=tmp_path, **env) == "s3://bucket/cms"
    assert bash("env_value BACKUP_TARGET", cwd=tmp_path, BACKUP_TARGET="elsewhere", **env) == "elsewhere"
    assert bash("env_value MISSING", cwd=tmp_path, **env) == ""


def test_env_value_reads_plain_lines_without_uv(tmp_path):
    (tmp_path / "scripts").symlink_to(BACKEND / "scripts")
    (tmp_path / ".env").write_text('BACKUP_TARGET="s3://bucket/cms"\r\n')
    assert bash("env_value BACKUP_TARGET", cwd=tmp_path, PATH="/usr/bin:/bin") == "s3://bucket/cms"
