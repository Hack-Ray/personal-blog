"""Release the published content to the public site (Addendum 02, PUB-001,
PUB-004): export a snapshot, push it to the content repo, start the deploy
workflow, and follow that run until the site is live."""

import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import Message
from pathlib import Path
from typing import Protocol

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from blog import exporter, retention
from blog.db import engine
from blog.models import Article, Release, ReleaseArticle, ReleaseStatus

R = ReleaseStatus
TERMINAL = frozenset({R.DEPLOYED, R.SUPERSEDED, R.FAILED})
# A release left at exported or pushed was cut off mid-way (the CMS stopped);
# retrying carries on from there.
RETRYABLE = frozenset({R.EXPORTED, R.PUSH_FAILED, R.PUSHED, R.DISPATCH_FAILED, R.FAILED})
IN_FLIGHT = (R.DISPATCHED, R.BUILDING)
# GitHub lists a dispatched run within seconds; after this, stop looking.
RUN_SEARCH_LIMIT = timedelta(minutes=30)
# Arbitrary key for pg_try_advisory_lock; one release runs at a time.
LOCK_KEY = 0x7265_6C65
DEPLOY_STEP = "Deploy to GitHub Pages"
CLOCK_SKEW = timedelta(minutes=5)
RUNS_PER_PAGE = 100
TOKEN_EXPIRY_HEADER = "github-authentication-token-expiration"


class ReleaseError(Exception):
    pass


class ReleaseBusy(ReleaseError):
    pass


@dataclass(frozen=True)
class Run:
    id: int
    url: str
    status: str
    conclusion: str | None


class Deployer(Protocol):
    def dispatch(self, content_commit: str) -> None: ...
    def find_run(self, content_commit: str, since: datetime, after_id: int | None) -> Run | None: ...
    def get_run(self, run_id: int) -> Run: ...
    def deploy_step_conclusion(self, run_id: int) -> str | None: ...


class GitHubActions:
    """Starts and reads the deploy workflow through the GitHub REST API."""

    def __init__(self, token: str, repo: str, workflow: str, ref: str, api_url: str = "https://api.github.com"):
        self.token, self.repo, self.workflow, self.ref, self.api_url = token, repo, workflow, ref, api_url.rstrip("/")

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        raw, _ = self._request(method, path, body)
        return json.loads(raw) if raw else {}

    def _request(self, method: str, path: str, body: dict | None = None) -> tuple[bytes, Message]:
        request = urllib.request.Request(
            f"{self.api_url}{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "authorization": f"Bearer {self.token}",
                "accept": "application/vnd.github+json",
                "x-github-api-version": "2022-11-28",
                "content-type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read(), response.headers
        except urllib.error.HTTPError as e:
            raise ReleaseError(f"GitHub API {method} {path} returned {e.code}") from e
        except urllib.error.URLError as e:
            raise ReleaseError(f"GitHub API unreachable: {e.reason}") from e

    def token_expires_at(self) -> datetime | None:
        """When the token stops working; None for a token without an expiry date."""
        expiry = self._request("GET", f"/repos/{self.repo}")[1].get(TOKEN_EXPIRY_HEADER)
        # GitHub sends e.g. "2027-01-18 00:00:00 UTC".
        return datetime.strptime(expiry, "%Y-%m-%d %H:%M:%S %Z").replace(tzinfo=UTC) if expiry else None

    def dispatch(self, content_commit: str) -> None:
        self._call(
            "POST",
            f"/repos/{self.repo}/actions/workflows/{self.workflow}/dispatches",
            {"ref": self.ref, "inputs": {"content_sha": content_commit}},
        )

    def find_run(self, content_commit: str, since: datetime, after_id: int | None = None) -> Run | None:
        """The newest run for the commit, skipping after_id and older runs
        (run ids only grow), which belong to an earlier attempt."""
        created = (since - CLOCK_SKEW).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        page = 1
        while True:
            query = urllib.parse.urlencode(
                {"event": "workflow_dispatch", "created": f">={created}", "per_page": RUNS_PER_PAGE, "page": page}
            )
            runs = self._call("GET", f"/repos/{self.repo}/actions/workflows/{self.workflow}/runs?{query}").get("workflow_runs", [])
            for r in runs:
                if r.get("display_title") == f"Deploy content {content_commit}" and r["id"] > (after_id or 0):
                    return _run(r)
            if len(runs) < RUNS_PER_PAGE:
                return None
            page += 1

    def get_run(self, run_id: int) -> Run:
        return _run(self._call("GET", f"/repos/{self.repo}/actions/runs/{run_id}"))

    def deploy_step_conclusion(self, run_id: int) -> str | None:
        jobs = self._call("GET", f"/repos/{self.repo}/actions/runs/{run_id}/jobs")
        for job in jobs.get("jobs", []):
            for step in job.get("steps", []):
                if step.get("name") == DEPLOY_STEP:
                    return step.get("conclusion")
        return None


def _run(r: dict) -> Run:
    return Run(id=r["id"], url=r["html_url"], status=r["status"], conclusion=r.get("conclusion"))


def deployer_from_env() -> Deployer | None:
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("DEPLOY_REPO")
    if not token or not repo:
        return None
    return GitHubActions(
        token=token,
        repo=repo,
        workflow=os.environ.get("DEPLOY_WORKFLOW", "deploy.yml"),
        ref=os.environ.get("DEPLOY_REF", "main"),
        api_url=os.environ.get("GITHUB_API_URL", "https://api.github.com"),
    )


def content_repo_from_env() -> Path | None:
    path = os.environ.get("CONTENT_REPO_DIR")
    return Path(path) if path else None


def _set(release: Release, status: ReleaseStatus, detail: str | None = None) -> None:
    release.status = status
    release.detail = detail
    release.updated_at = func.now()


def _redact(text: str) -> str:
    """Drops credentials from URLs in git output, e.g. https://token@github.com/."""
    return re.sub(r"(\w+://)[^/\s@]+@", r"\1", text)


@contextmanager
def _exclusive() -> Iterator[None]:
    """Lets one release or retry run at a time, across requests and processes."""
    with engine.connect() as conn:
        if not conn.scalar(select(func.pg_try_advisory_lock(LOCK_KEY))):
            raise ReleaseBusy("another release is in progress; try again when it finishes")
        try:
            yield
        finally:
            conn.scalar(select(func.pg_advisory_unlock(LOCK_KEY)))


def _advance(session: Session, release: Release, repo: Path, deployer: Deployer | None) -> Release:
    """Pushes and dispatches as far as possible; failures leave a retryable status."""
    if release.status in (R.EXPORTED, R.PUSH_FAILED):
        try:
            exporter.push(repo)
            _set(release, R.PUSHED)
        except subprocess.CalledProcessError as e:
            _set(release, R.PUSH_FAILED, _redact(e.stderr or str(e)).strip()[-500:])
        except subprocess.TimeoutExpired:
            _set(release, R.PUSH_FAILED, f"git push did not finish within {exporter.GIT_TIMEOUT} seconds")
        session.commit()
    if release.status in (R.PUSHED, R.DISPATCH_FAILED, R.FAILED):
        # run_id stays: it is now the earlier attempt's run, for refresh to skip.
        if deployer is None:
            _set(release, R.DISPATCH_FAILED, "GITHUB_TOKEN or DEPLOY_REPO is not set; start the deploy workflow on GitHub instead")
        else:
            try:
                deployer.dispatch(release.content_commit)
                _set(release, R.DISPATCHED)
                release.run_url = None
                release.dispatched_at = func.now()
            except ReleaseError as e:
                _set(release, R.DISPATCH_FAILED, str(e))
        session.commit()
    return release


def latest(session: Session) -> Release | None:
    return session.scalars(select(Release).order_by(Release.id.desc()).limit(1)).first()


def create(session: Session, repo: Path, deployer: Deployer | None) -> Release | None:
    """Exports the published content and starts deploying it. Returns None
    when nothing changed since the last release."""
    with _exclusive():
        return _create(session, repo, deployer)


def _create(session: Session, repo: Path, deployer: Deployer | None) -> Release | None:
    if unknown := exporter.unknown_remote_commit(repo):
        raise ReleaseError(
            f"the content repo has commit {unknown[:7]} that this CMS did not make; another CMS may be in use."
            " See docs/local-setup.md, section 12"
        )
    result = exporter.export(repo) or exporter.head_release(repo)
    if result is None or session.get(Release, result.release_id) is not None:
        return None
    release = Release(id=result.release_id, content_commit=result.commit, status=R.EXPORTED)
    session.add(release)
    for doc_id, article_id in session.execute(select(Article.doc_id, Article.id).where(Article.doc_id.in_(result.versions))):
        session.add(ReleaseArticle(release_id=release.id, article_id=article_id, version=result.versions[doc_id]))

    for older in session.scalars(select(Release).where(Release.id != release.id, Release.status.not_in(TERMINAL))):
        if older.status in RETRYABLE:
            _set(older, R.SUPERSEDED, f"replaced by release {release.id}")
    session.commit()
    return _advance(session, release, repo, deployer)


def retry(session: Session, release_id: str, repo: Path, deployer: Deployer | None) -> Release:
    with _exclusive():
        return _retry(session, release_id, repo, deployer)


def _retry(session: Session, release_id: str, repo: Path, deployer: Deployer | None) -> Release:
    release = session.get(Release, release_id)
    if release is None:
        raise ReleaseError(f"release {release_id} not found")
    if release.status not in RETRYABLE:
        raise ReleaseError(f"release is {release.status}; only failed releases can be retried")
    if latest(session).id != release.id:
        raise ReleaseError("a newer release exists; retry that one instead")
    return _advance(session, release, repo, deployer)


def _outcome(run: Run, deployer: Deployer) -> dict:
    values: dict = {"run_id": run.id, "run_url": run.url, "detail": None}
    if run.status != "completed":
        return values | {"status": R.BUILDING}
    if run.conclusion == "cancelled":
        # deploy.yml's concurrency group cancels a queued run when a newer one starts.
        return values | {"status": R.SUPERSEDED, "detail": "a newer deploy replaced this run before it started"}
    if run.conclusion != "success":
        return values | {"status": R.FAILED, "detail": f"workflow run {run.conclusion}"}
    if deployer.deploy_step_conclusion(run.id) == "skipped":
        return values | {"status": R.SUPERSEDED, "detail": "a newer content commit was pushed before this build finished"}
    return values | {"status": R.DEPLOYED}


@dataclass(frozen=True)
class _InFlight:
    id: str
    status: ReleaseStatus
    content_commit: str
    run_id: int | None
    dispatched_at: datetime


def _check(release: _InFlight, deployer: Deployer, now: datetime) -> dict | None:
    """What GitHub says about a dispatched release, as column values; None when nothing changed."""
    try:
        if release.status == R.BUILDING and release.run_id is not None:
            return _outcome(deployer.get_run(release.run_id), deployer)
        run = deployer.find_run(release.content_commit, release.dispatched_at, release.run_id)
        if run is not None:
            return _outcome(run, deployer)
        if now - release.dispatched_at > RUN_SEARCH_LIMIT:
            return {"status": R.FAILED, "detail": "GitHub never listed the deploy run; retry to dispatch it again"}
        return None
    except ReleaseError as e:
        return {"detail": str(e)}


def refresh_in_flight(session: Session, deployer: Deployer | None) -> None:
    """Asks GitHub about every dispatched or building release and records the outcome."""
    if deployer is None:
        return
    pending = [
        _InFlight(r.id, r.status, r.content_commit, r.run_id, r.dispatched_at or r.created_at)
        for r in session.scalars(select(Release).where(Release.status.in_(IN_FLIGHT)))
    ]
    # GitHub calls can take seconds each; don't hold a database connection meanwhile.
    session.commit()
    now = datetime.now(UTC)
    deployed = False
    for release in pending:
        values = _check(release, deployer, now)
        if values is None:
            continue
        if "status" in values:
            values["updated_at"] = func.now()
        # Only if no other request recorded a newer state meanwhile.
        changed = session.execute(
            update(Release)
            .where(Release.id == release.id, Release.status == release.status, Release.run_id.is_not_distinct_from(release.run_id))
            .values(**values)
        ).rowcount
        session.commit()
        deployed |= bool(changed) and values.get("status") == R.DEPLOYED
    if deployed:
        retention.cleanup_versions(session)


def recent(session: Session, limit: int = 20) -> list[Release]:
    return list(session.scalars(select(Release).order_by(Release.id.desc()).limit(limit)))
