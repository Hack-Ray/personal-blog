"""Runs scripts/backup.sh every BACKUP_EVERY_HOURS while the CMS runs, so a
CMS left open for days still gets a fresh backup. scripts/start.sh takes one
at start-up, so the first scheduled backup comes a full interval later.

The backup runs as a child of the CMS, with its environment, PATH and (on
macOS) its folder permissions, so a BACKUP_TARGET in a cloud-synced folder
works without extra setup. BACKUP_KEEP prunes old backups as usual.
"""

import logging
import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable, Sequence
from pathlib import Path

log = logging.getLogger(__name__)
BACKEND = Path(__file__).resolve().parents[1]


class Scheduler:
    def __init__(
        self,
        every_hours: float,
        command: Sequence[str] = ("scripts/backup.sh",),
        check_every: float = 600,
        clock: Callable[[], float] = time.time,
    ):
        self.every = every_hours * 3600
        self.command = list(command)
        self.check_every = check_every
        # Wall-clock time, so hours a laptop spends asleep count toward the interval.
        self.clock = clock
        self.last = clock()
        self.stop = threading.Event()
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, name="backups", daemon=True)

    def _run(self) -> None:
        while not self.stop.wait(self.check_every):
            if self.clock() - self.last >= self.every:
                try:
                    self.run_once()
                except Exception:
                    log.exception("scheduled backup failed")

    def run_once(self) -> bool:
        with self.lock:
            if self.stop.is_set():
                return False
            # A new session, so close() can stop pg_dump and docker along with the script.
            self.proc = subprocess.Popen(self.command, cwd=BACKEND, start_new_session=True)
        code = self.proc.wait()
        with self.lock:
            self.proc = None
        if code == 0:
            self.last = self.clock()
            return True
        if self.stop.is_set():
            return False
        # Retried at the next check; the last good backup stays in place.
        log.error("scheduled backup failed exit_code=%d", code)
        return False

    def start(self) -> None:
        if self.every > 0:
            self.thread.start()

    def close(self) -> None:
        """Stops a backup in progress, so restore.sh, which stops the CMS
        first, never runs alongside one that prunes old backups."""
        with self.lock:
            self.stop.set()
            if self.proc is not None:
                try:
                    os.killpg(self.proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        if self.thread.is_alive():
            self.thread.join(timeout=10)
