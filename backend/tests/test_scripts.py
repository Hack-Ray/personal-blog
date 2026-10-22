import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

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


LISTENER = """
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen()
print(s.getsockname()[1], flush=True)
time.sleep(60)
"""


def listen(label):
    """A process listening on a free port whose command line contains `label`, like the CMS's does."""
    proc = subprocess.Popen([sys.executable, "-c", LISTENER, label], stdout=subprocess.PIPE, text=True)
    return proc, int(proc.stdout.readline())


@pytest.mark.skipif(shutil.which("lsof") is None, reason="stop_cms needs lsof")
def test_stop_cms_stops_a_running_cms_and_frees_its_port():
    proc, port = listen("blog.api:app")
    assert "Stopping the CMS" in bash(f"stop_cms {port}")
    assert proc.wait(timeout=5) is not None
    assert bash(f"stop_cms {port}") == ""


@pytest.mark.skipif(shutil.which("lsof") is None, reason="stop_cms needs lsof")
def test_stop_cms_leaves_another_program_on_the_port_alone():
    proc, port = listen("some-other-server")
    try:
        with pytest.raises(subprocess.CalledProcessError) as failed:
            bash(f"stop_cms {port}")
        assert "used by another program" in failed.value.stderr
        assert proc.poll() is None
    finally:
        proc.kill()
        proc.wait()
