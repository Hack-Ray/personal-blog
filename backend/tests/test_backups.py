import sys
import time

from blog.backups import Scheduler

# Records each run in a file; "slow" keeps running until stopped.
FAKE_BACKUP = """
import sys, time
open(sys.argv[1], "a").write("run\\n")
if sys.argv[2] == "slow":
    time.sleep(30)
sys.exit(int(sys.argv[2]) if sys.argv[2] != "slow" else 0)
"""


def fake(tmp_path, outcome):
    script = tmp_path / "backup.py"
    script.write_text(FAKE_BACKUP)
    return [sys.executable, str(script), str(tmp_path / "runs"), outcome]


def runs(tmp_path):
    path = tmp_path / "runs"
    return len(path.read_text().splitlines()) if path.exists() else 0


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


def wait_for(condition, timeout=5):
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def test_backs_up_once_the_interval_has_passed_and_not_before(tmp_path):
    clock = Clock()
    scheduler = Scheduler(24, fake(tmp_path, "0"), check_every=0.01, clock=clock)
    scheduler.start()
    try:
        time.sleep(0.1)
        assert runs(tmp_path) == 0, "start.sh has just backed up"
        clock.now += 24 * 3600
        wait_for(lambda: scheduler.last == clock.now)
        assert runs(tmp_path) == 1
        time.sleep(0.1)
        assert runs(tmp_path) == 1, "the next one waits a full interval"
        clock.now += 24 * 3600
        wait_for(lambda: runs(tmp_path) == 2)
    finally:
        scheduler.close()


def test_a_failed_backup_is_retried_at_the_next_check(tmp_path):
    clock = Clock()
    scheduler = Scheduler(24, fake(tmp_path, "1"), check_every=0.01, clock=clock)
    clock.now += 24 * 3600
    scheduler.start()
    try:
        wait_for(lambda: runs(tmp_path) >= 2)
    finally:
        scheduler.close()


def test_zero_hours_never_backs_up(tmp_path):
    clock = Clock()
    scheduler = Scheduler(0, fake(tmp_path, "0"), check_every=0.01, clock=clock)
    scheduler.start()
    clock.now += 365 * 24 * 3600
    time.sleep(0.1)
    scheduler.close()
    assert runs(tmp_path) == 0


def test_an_error_starting_the_backup_does_not_stop_the_schedule(tmp_path):
    clock = Clock()
    scheduler = Scheduler(24, [str(tmp_path / "missing")], check_every=0.01, clock=clock)
    clock.now += 24 * 3600
    scheduler.start()
    try:
        time.sleep(0.1)
        assert scheduler.thread.is_alive()
        scheduler.command = fake(tmp_path, "0")
        wait_for(lambda: runs(tmp_path) == 1)
    finally:
        scheduler.close()


def test_closing_stops_a_backup_in_progress(tmp_path):
    clock = Clock()
    scheduler = Scheduler(24, fake(tmp_path, "slow"), check_every=0.01, clock=clock)
    clock.now += 24 * 3600
    scheduler.start()
    wait_for(lambda: runs(tmp_path) == 1)
    started = time.monotonic()
    scheduler.close()
    assert time.monotonic() - started < 5
    assert not scheduler.thread.is_alive()
    assert scheduler.last == 1_000_000.0, "a stopped backup does not count"
