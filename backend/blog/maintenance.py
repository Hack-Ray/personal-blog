"""Runs the jobs that are due: purge articles deleted 30+ days ago, drop
Published Versions that are no longer needed, and delete unreferenced images.

    uv run --env-file .env python -m blog.maintenance

scripts/start.sh runs it once at start-up; a long-running CMS runs it on a
schedule (cron or a systemd timer). Every job is safe to repeat.
"""

import logging
from datetime import UTC, datetime

from blog import articles, images, retention
from blog.db import SessionLocal, advisory_lock

# Arbitrary key for pg_try_advisory_lock, distinct from release.LOCK_KEY.
LOCK_KEY = 0x6D61_696E

log = logging.getLogger(__name__)


def run(now: datetime | None = None) -> bool:
    """Returns False, doing nothing, when another run holds the lock."""
    now = now or datetime.now(UTC)
    with advisory_lock(LOCK_KEY) as acquired:
        if not acquired:
            log.info("maintenance is already running elsewhere; skipped")
            return False
        with SessionLocal() as session:
            purged = articles.purge_expired(session, now)
            versions = retention.cleanup_versions(session)
            deleted = images.collect_garbage(session, now)
    log.info("purged %d articles, %d versions, %d images", len(purged), len(versions), len(deleted))
    return True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run()
