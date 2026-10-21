"""Release the published content to the public site (Addendum 02, PUB-001,
PUB-004): export a snapshot, push it to the content repo, start the deploy
workflow, and follow that run until the site is live."""

import json
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import Message
from pathlib import Path
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from blog import exporter, retention
from blog.models import Article, Release, ReleaseArticle, ReleaseStatus

R = ReleaseStatus
TERMINAL = frozenset({R.DEPLOYED, R.SUPERSEDED, R.FAILED})
RETRYABLE = frozenset({R.PUSH_FAILED, R.DISPATCH_FAILED, R.FAILED})
DEPLOY_STEP = "Deploy to GitHub Pages"
CLOCK_SKEW = timedelta(minutes=5)
RUNS_PER_PAGE = 100
TOKEN_EXPIRY_HEADER = "github-authentication-token-expiration"


class ReleaseError(Exception):
    pass


@dataclass(frozen=True)
class Run:
    id: int
    url: str
    status: str
    conclusion: str | None


class Deployer(Protocol):
    def dispatch(self, content_commit: str) -> None: ...
    def find_run(self, content_commit: str, since: datetime) -> Run | None: ...
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

    def find_run(self, content_commit: str, since: datetime) -> Run | None:
        created = (since - CLOCK_SKEW).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        page = 1
        while True:
            query = urllib.parse.urlencode(
                {"event": "workflow_dispatch", "created": f">={created}", "per_page": RUNS_PER_PAGE, "page": page}
            )
            runs = self._call("GET", f"/repos/{self.repo}/actions/workflows/{self.workflow}/runs?{query}").get("workflow_runs", [])
            for r in runs:
                if r.get("display_title") == f"Deploy content {content_commit}":
                    return Run(id=r["id"], url=r["html_url"], status=r["status"], conclusion=r.get("conclusion"))
            if len(runs) < RUNS_PER_PAGE:
                return None
            page += 1

    def deploy_step_conclusion(self, run_id: int) -> str | None:
        jobs = self._call("GET", f"/repos/{self.repo}/actions/runs/{run_id}/jobs")
        for job in jobs.get("jobs", []):
            for step in job.get("steps", []):
                if step.get("name") == DEPLOY_STEP:
                    return step.get("conclusion")
        return None


def deployer_from_env() -> Deployer | None:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return None
    return GitHubActions(
        token=token,
        repo=os.environ.get("DEPLOY_REPO", "Hack-Ray/personal-blog"),
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


def _advance(session: Session, release: Release, repo: Path, deployer: Deployer | None) -> Release:
    """Pushes and dispatches as far as possible; failures leave a retryable status."""
    if release.status in (R.EXPORTED, R.PUSH_FAILED):
        try:
            exporter.push(repo)
            _set(release, R.PUSHED)
        except subprocess.CalledProcessError as e:
            _set(release, R.PUSH_FAILED, (e.stderr or str(e)).strip()[-500:])
        session.commit()
    if release.status in (R.PUSHED, R.DISPATCH_FAILED, R.FAILED):
        if deployer is None:
            _set(release, R.DISPATCH_FAILED, "GITHUB_TOKEN is not set; start the deploy workflow on GitHub instead")
        else:
            try:
                deployer.dispatch(release.content_commit)
                _set(release, R.DISPATCHED)
                release.run_url = None
            except ReleaseError as e:
                _set(release, R.DISPATCH_FAILED, str(e))
        session.commit()
    return release


def latest(session: Session) -> Release | None:
    return session.scalars(select(Release).order_by(Release.id.desc()).limit(1)).first()


def create(session: Session, repo: Path, deployer: Deployer | None) -> Release | None:
    """Exports the published content and starts deploying it. Returns None
    when nothing changed since the last release."""
    result = exporter.export(repo) or exporter.head_release(repo)
    if result is None or session.get(Release, result.release_id) is not None:
        return None
    release = Release(id=result.release_id, content_commit=result.commit, status=R.EXPORTED)
    session.add(release)
    for doc_id, article_id in session.execute(select(Article.doc_id, Article.id).where(Article.doc_id.in_(result.versions))):
        session.add(ReleaseArticle(release_id=release.id, article_id=article_id, version=result.versions[doc_id]))
    for older in session.scalars(select(Release).where(Release.id != release.id, Release.status.not_in(TERMINAL))):
        if older.status in RETRYABLE | {R.EXPORTED}:
            _set(older, R.SUPERSEDED, f"replaced by release {release.id}")
    session.commit()
    return _advance(session, release, repo, deployer)


def retry(session: Session, release_id: str, repo: Path, deployer: Deployer | None) -> Release:
    release = session.get(Release, release_id)
    if release is None:
        raise ReleaseError(f"release {release_id} not found")
    if release.status not in RETRYABLE:
        raise ReleaseError(f"release is {release.status}; only failed releases can be retried")
    if latest(session).id != release.id:
        raise ReleaseError("a newer release exists; retry that one instead")
    return _advance(session, release, repo, deployer)


def refresh(session: Session, release: Release, deployer: Deployer | None) -> Release:
    """Reads the workflow run for a dispatched release and records the outcome."""
    if deployer is None or release.status not in (R.DISPATCHED, R.BUILDING):
        return release
    try:
        run = deployer.find_run(release.content_commit, release.created_at)
        if run is None:
            return release
        release.run_url = run.url
        if run.status != "completed":
            _set(release, R.BUILDING)
        elif run.conclusion != "success":
            _set(release, R.FAILED, f"workflow run {run.conclusion}")
        elif deployer.deploy_step_conclusion(run.id) == "skipped":
            _set(release, R.SUPERSEDED, "a newer content commit was pushed before this build finished")
        else:
            _set(release, R.DEPLOYED)
    except ReleaseError as e:
        release.detail = str(e)
    session.commit()
    if release.status == R.DEPLOYED:
        retention.cleanup_versions(session)
    return release


def recent(session: Session, deployer: Deployer | None, limit: int = 20) -> list[Release]:
    releases = list(session.scalars(select(Release).order_by(Release.id.desc()).limit(limit)))
    for r in releases:
        refresh(session, r, deployer)
    return releases
