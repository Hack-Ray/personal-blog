import logging
import threading

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ulid import ULID

from blog import exporter, release
from blog.db import SessionLocal, advisory_lock
from blog.models import Release, ReleaseJob

log = logging.getLogger(__name__)
LOCK_KEY = 0x6A6F_6273
ACTIVE = ("queued", "running")
FAILURES = (release.R.PUSH_FAILED, release.R.DISPATCH_FAILED, release.R.FAILED)


def recent(session: Session) -> list[ReleaseJob]:
    return list(session.scalars(select(ReleaseJob).order_by(ReleaseJob.id.desc()).limit(20)))


def submit(session: Session, action: str, requested_release_id: str | None = None) -> ReleaseJob:
    if action not in ("create", "retry") or (action == "retry") != bool(requested_release_id):
        raise release.ReleaseError("retry requires a release id; create does not accept one")
    release.repo_from_env()
    with advisory_lock(LOCK_KEY) as acquired:
        if not acquired or session.scalar(select(ReleaseJob.id).where(ReleaseJob.status.in_(ACTIVE)).limit(1)):
            raise release.ReleaseBusy("a website update is already queued or running")
        if action == "retry":
            previous = session.get(Release, requested_release_id)
            if previous is None or previous.status not in release.RETRYABLE:
                raise release.ReleaseError("only an interrupted, failed or superseded release can be retried")
            if release.latest(session).id != previous.id:
                raise release.ReleaseError("a newer release exists; retry that one instead")
        job = ReleaseJob(id=str(ULID()), action=action, requested_release_id=requested_release_id, status="queued")
        session.add(job)
        session.commit()
        return job


def _execute(session: Session, job: ReleaseJob) -> None:
    job.status = "running"
    job.updated_at = func.now()
    session.commit()
    repo, deployer = release.repo_from_env(), release.deployer_from_env()

    def prepared(result: Release) -> None:
        job.release_id = result.id

    target = job.release_id or job.requested_release_id
    if target:
        result = session.get(Release, target)
        if result is None:
            raise release.ReleaseError("the release for this job no longer exists")
        # A create job resumed after a restart carries on an interrupted release; a superseded one has run its course.
        if result.status in release.RETRYABLE and (job.action == "retry" or result.status != release.R.SUPERSEDED):
            result = release.retry(session, target, repo, deployer)
        job.release_id = result.id
    else:
        result = release.create(session, repo, deployer, on_prepared=prepared)
    job.status = "failed" if result is not None and result.status in FAILURES else "completed"
    job.detail = result.detail if job.status == "failed" else None
    job.updated_at = func.now()
    session.commit()


def run_once() -> bool:
    # Taking the lock only when there is work keeps submit from seeing a busy queue while idle.
    with SessionLocal() as session:
        if session.scalar(select(ReleaseJob.id).where(ReleaseJob.status.in_(ACTIVE)).limit(1)) is None:
            return False
    with advisory_lock(LOCK_KEY) as acquired:
        if not acquired:
            return False
        with SessionLocal() as session:
            job = session.scalar(select(ReleaseJob).where(ReleaseJob.status.in_(ACTIVE)).order_by(ReleaseJob.id).limit(1))
            if job is None:
                return False
            job_id = job.id
            try:
                _execute(session, job)
            except Exception as error:
                session.rollback()
                job = session.get(ReleaseJob, job_id)
                job.status = "failed"
                # Unexpected exceptions may contain secrets from a driver or URL.
                job.detail = str(error) if isinstance(error, (release.ReleaseError, exporter.ExportError)) else "website update failed; check CMS logs"
                job.updated_at = func.now()
                session.commit()
                log.error("release_job=%s failed error_type=%s", job_id, type(error).__name__)
            return True


class Worker:
    def __init__(self, interval: float = 1):
        self.interval = interval
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name="release-jobs", daemon=True)

    def _run(self) -> None:
        while not self.stop.is_set():
            try:
                run_once()
            except Exception as error:
                log.error("release worker unavailable error_type=%s", type(error).__name__)
            self.stop.wait(self.interval)

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=5)
