import os
import shutil
import signal
import socket
import subprocess
import sys
import urllib.request
from pathlib import Path

import pytest
from sqlalchemy import create_engine, make_url, text

BACKEND = Path(__file__).resolve().parents[1]


def bash(script, cwd=BACKEND, **env):
    return subprocess.run(
        ["bash", "-c", f". scripts/lib.sh && {script}"],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, **env},
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
import signal, socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen()
def stop(*_):
    # Like uvicorn: close the port first, then finish shutting down.
    s.close()
    time.sleep(float(sys.argv[2]))
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
print(s.getsockname()[1], flush=True)
time.sleep(60)
"""


def listen(label, shutdown_seconds=0):
    """A process listening on a free port whose command line contains `label`, like the CMS's does."""
    proc = subprocess.Popen([sys.executable, "-c", LISTENER, label, str(shutdown_seconds)], stdout=subprocess.PIPE, text=True)
    return proc, int(proc.stdout.readline())


@pytest.mark.skipif(shutil.which("lsof") is None, reason="stop_cms needs lsof")
def test_stop_cms_stops_a_running_cms_and_frees_its_port():
    proc, port = listen("blog.api:app")
    assert "Stopping the CMS" in bash(f"stop_cms {port}")
    assert proc.wait(timeout=5) is not None
    assert bash(f"stop_cms {port}") == ""


@pytest.mark.skipif(shutil.which("lsof") is None, reason="stop_cms needs lsof")
def test_stop_cms_waits_for_the_cms_to_exit_not_just_its_port():
    proc, port = listen("blog.api:app", shutdown_seconds=1)
    bash(f"stop_cms {port}")
    assert proc.poll() is not None, "a scheduled backup is stopped after the port closes"


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


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.skipif(shutil.which("lsof") is None, reason="cleanup finds the server with lsof")
def test_start_detached_returns_once_the_server_answers_and_leaves_it_running(tmp_path):
    port, log = free_port(), tmp_path / "logs/cms.log"
    log.parent.mkdir()
    log.write_text("previous run\n")
    server = f"{sys.executable} -m http.server {port} --bind 127.0.0.1 --directory {tmp_path}"
    bash(f"start_detached {log} http://127.0.0.1:{port}/ {server}")
    try:
        assert urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5).status == 200
        assert (tmp_path / "logs/cms.log.1").read_text() == "previous run\n"
    finally:
        pids = subprocess.run(["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.split()
        for pid in pids:
            os.kill(int(pid), signal.SIGTERM)


def test_start_detached_fails_with_the_end_of_the_log_when_the_server_exits(tmp_path):
    log = tmp_path / "cms.log"
    with pytest.raises(subprocess.CalledProcessError) as failed:
        bash(f"start_detached {log} http://127.0.0.1:{free_port()}/ {sys.executable} -c 'raise SystemExit(\"address already in use\")'")
    assert "did not start" in failed.value.stderr
    assert "address already in use" in failed.value.stderr


def release_api(tmp_path, tag):
    """A file:// stand-in for the GitHub API that serves `tag` as the latest release."""
    latest = tmp_path / "repos/owner/blog/releases/latest"
    latest.parent.mkdir(parents=True)
    latest.write_text(f'{{\n  "url": "x",\n  "tag_name": "{tag}",\n  "name": "{tag}"\n}}\n')
    return {"GITHUB_API_URL": tmp_path.as_uri(), "UPDATE_CHECK_REPO": "owner/blog"}


def current_version():
    return bash("sed -n 's/^version = \"\\(.*\\)\"/\\1/p' pyproject.toml")


def test_check_release_announces_a_newer_release(tmp_path):
    out = bash("check_release", **release_api(tmp_path, "v99.0.0"))
    assert f"v99.0.0 (this copy is {current_version()})" in out
    assert "https://github.com/owner/blog/releases/latest" in out


@pytest.mark.parametrize("tag", ["current", "v0.0.1"])
def test_check_release_stays_quiet_when_up_to_date_or_ahead(tmp_path, tag):
    tag = f"v{current_version()}" if tag == "current" else tag
    assert bash("check_release", **release_api(tmp_path, tag)) == ""


def test_check_release_stays_quiet_when_unreachable_or_turned_off(tmp_path):
    assert bash("check_release", GITHUB_API_URL=tmp_path.as_uri(), UPDATE_CHECK_REPO="owner/none") == ""
    assert bash("set -euo pipefail; check_release; echo started", GITHUB_API_URL=tmp_path.as_uri()) == "started"
    assert bash("check_release", **{**release_api(tmp_path, "v99.0.0"), "UPDATE_CHECK_REPO": "off"}) == ""


@pytest.fixture
def scratch_database():
    """A migrated database of its own, since a restore replaces everything in it."""
    base = make_url(os.environ["TEST_DATABASE_URL"])
    name = f"{base.database}_restore"
    server = create_engine(base, isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = base.set(database=name).render_as_string(hide_password=False)
    subprocess.run(["uv", "run", "alembic", "upgrade", "head"], cwd=BACKEND, check=True, capture_output=True, env={**os.environ, "DATABASE_URL": url})
    yield url
    with server.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    server.dispose()


def run_sql(url, statement):
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            result = conn.execute(text(statement))
            return result.scalars().all() if result.returns_rows else None
    finally:
        engine.dispose()


def script(*args, **env):
    return subprocess.run(args, cwd=BACKEND, capture_output=True, text=True, env={**os.environ, **env})


def test_restore_backs_up_first_replaces_everything_at_once_and_signs_everyone_out(scratch_database, tmp_path):
    url = scratch_database
    run_sql(url, "INSERT INTO retired_doc_ids VALUES ('01K00000000000000000000000')")
    run_sql(url, "INSERT INTO admin_sessions (token_hash, expires_at) VALUES ('t', now() + interval '1 day')")
    run_sql(url, "INSERT INTO release_jobs (id, action, status) VALUES ('01K00000000000000000000000', 'create', 'queued')")
    assert script("scripts/backup.sh", "--url", url, "--out", str(tmp_path / "b")).returncode == 0
    (dump,) = (tmp_path / "b").glob("*.dump")
    run_sql(url, "INSERT INTO retired_doc_ids VALUES ('01K00000000000000000000001')")

    broken = tmp_path / "broken.dump"
    broken.write_bytes(dump.read_bytes()[: dump.stat().st_size // 2])
    failed = script("scripts/restore.sh", str(broken), "--url", url, "--yes", BACKUP_TARGET=str(tmp_path / "safety"))
    assert failed.returncode != 0
    assert len(run_sql(url, "SELECT doc_id FROM retired_doc_ids")) == 2, "a failed restore keeps the old data"

    # BACKUP_KEEP=1 must not let the safety backup delete the file being restored.
    restored = script("scripts/restore.sh", str(dump), "--url", url, "--yes", BACKUP_KEEP="1")
    assert restored.returncode == 0, restored.stderr
    assert run_sql(url, "SELECT doc_id FROM retired_doc_ids") == ["01K00000000000000000000000"]
    assert run_sql(url, "SELECT token_hash FROM admin_sessions") == []
    assert run_sql(url, "SELECT status FROM release_jobs") == ["failed"], "a restored queued update does not publish on its own"
    assert dump.exists() and len(list((tmp_path / "b").glob("*.dump"))) == 2, "the safety backup lands beside the restored one"


def test_backup_keep_removes_the_oldest_backups_in_a_folder(scratch_database, tmp_path):
    for stamp in ("20260101T000000Z", "20260102T000000Z"):
        (tmp_path / f"blog-{stamp}.dump").write_text("old")
        (tmp_path / f"blog-{stamp}.dump.sha256").write_text("old")
    (tmp_path / "notes.txt").write_text("not a backup")
    assert script("scripts/backup.sh", "--url", scratch_database, "--out", str(tmp_path), BACKUP_KEEP="2").returncode == 0
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names[:2] == ["blog-20260102T000000Z.dump", "blog-20260102T000000Z.dump.sha256"]
    assert len(names) == 5 and names[-1] == "notes.txt"
