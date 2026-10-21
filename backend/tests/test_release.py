import json
import subprocess
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select

from blog import articles, exporter, release
from blog.db import SessionLocal
from blog.models import PublishedVersion, Release, ReleaseArticle, ReleaseStatus

R = ReleaseStatus
BACKEND = articles.Taxon("backend", "Backend")


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repos(tmp_path):
    remote, clone = tmp_path / "remote.git", tmp_path / "content"
    subprocess.run(["git", "init", "--quiet", "--bare", str(remote)], check=True)
    subprocess.run(["git", "clone", "--quiet", str(remote), str(clone)], check=True, capture_output=True)
    git(clone, "config", "user.email", "t@example.com")
    git(clone, "config", "user.name", "T")
    (clone / "README.md").write_text("content\n")
    git(clone, "add", "README.md")
    git(clone, "commit", "--quiet", "-m", "init")
    git(clone, "push", "--quiet", "-u", "origin", "HEAD")
    return remote, clone


class FakeDeployer:
    def __init__(self):
        self.dispatched: list[str] = []
        self.runs: dict[str, release.Run] = {}
        self.deploy_steps: dict[int, str | None] = {}
        self.fail_dispatch = False

    def dispatch(self, content_commit):
        if self.fail_dispatch:
            raise release.ReleaseError("GitHub API POST returned 500")
        self.dispatched.append(content_commit)

    def find_run(self, content_commit, since):
        return self.runs.get(content_commit)

    def deploy_step_conclusion(self, run_id):
        return self.deploy_steps.get(run_id)

    def finish(self, commit, conclusion="success", deploy_step="success"):
        self.runs[commit] = release.Run(id=len(self.runs) + 1, url=f"https://run/{commit}", status="completed", conclusion=conclusion)
        self.deploy_steps[self.runs[commit].id] = deploy_step


def publish(session, markdown="body"):
    doc_id = articles.create_article(session, articles.DraftContent("T", BACKEND, markdown)).article.doc_id
    articles.publish(session, doc_id, 1, articles.DraftContent("T", BACKEND, markdown))
    return doc_id


def test_release_exports_pushes_and_dispatches(repos):
    remote, clone = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        r = release.create(s, clone, deployer)
        assert r.status == R.DISPATCHED
        assert deployer.dispatched == [r.content_commit]
        assert git(remote, "rev-parse", "HEAD") == r.content_commit
        assert [(a.version,) for a in s.query(ReleaseArticle).filter_by(release_id=r.id)] == [(1,)]
        assert s.scalars(s.query(ReleaseArticle.article_id).statement).one() == articles.get_article(s, doc_id).id


def test_nothing_changed_makes_no_release(repos):
    _, clone = repos
    with SessionLocal() as s:
        publish(s)
        assert release.create(s, clone, FakeDeployer()) is not None
        assert release.create(s, clone, FakeDeployer()) is None
        assert s.query(Release).count() == 1


def test_without_a_token_the_release_waits_for_a_retry(repos):
    _, clone = repos
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, clone, None)
        assert r.status == R.DISPATCH_FAILED
        assert "GITHUB_TOKEN" in r.detail
        deployer = FakeDeployer()
        assert release.retry(s, r.id, clone, deployer).status == R.DISPATCHED
        assert deployer.dispatched == [r.content_commit]


def test_push_failure_is_retryable(repos):
    remote, clone = repos
    git(clone, "remote", "set-url", "origin", str(remote) + "-missing")
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, clone, FakeDeployer())
        assert r.status == R.PUSH_FAILED
        git(clone, "remote", "set-url", "origin", str(remote))
        assert release.retry(s, r.id, clone, FakeDeployer()).status == R.DISPATCHED
        assert git(remote, "rev-parse", "HEAD") == r.content_commit


def test_dispatch_failure_is_retryable(repos):
    _, clone = repos
    deployer = FakeDeployer()
    deployer.fail_dispatch = True
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, clone, deployer)
        assert (r.status, r.detail) == (R.DISPATCH_FAILED, "GitHub API POST returned 500")
        deployer.fail_dispatch = False
        assert release.retry(s, r.id, clone, deployer).status == R.DISPATCHED


@pytest.mark.parametrize(
    ("conclusion", "deploy_step", "expected"),
    [("success", "success", R.DEPLOYED), ("success", "skipped", R.SUPERSEDED), ("failure", None, R.FAILED)],
)
def test_refresh_records_the_run_outcome(repos, conclusion, deploy_step, expected):
    _, clone = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, clone, deployer)
        assert release.refresh(s, r, deployer).status == R.DISPATCHED
        deployer.runs[r.content_commit] = release.Run(id=9, url="https://run/9", status="in_progress", conclusion=None)
        assert release.refresh(s, r, deployer).status == R.BUILDING
        deployer.finish(r.content_commit, conclusion, deploy_step)
        r = release.refresh(s, r, deployer)
        assert r.status == expected
        assert r.run_url == f"https://run/{r.content_commit}"


def test_failed_build_can_be_retried_only_while_latest(repos):
    _, clone = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        first = release.create(s, clone, deployer)
        deployer.finish(first.content_commit, "failure")
        release.refresh(s, first, deployer)
        articles.publish(s, doc_id, 2, articles.DraftContent("T", BACKEND, "edit"))
        second = release.create(s, clone, deployer)
        with pytest.raises(release.ReleaseError, match="newer release"):
            release.retry(s, first.id, clone, deployer)
        with pytest.raises(release.ReleaseError, match="only failed releases"):
            release.retry(s, second.id, clone, deployer)


def test_a_new_release_supersedes_older_unfinished_failures(repos):
    _, clone = repos
    with SessionLocal() as s:
        doc_id = publish(s)
        stuck = release.create(s, clone, None)
        articles.publish(s, doc_id, 2, articles.DraftContent("T", BACKEND, "edit"))
        release.create(s, clone, FakeDeployer())
        s.refresh(stuck)
        assert stuck.status == R.SUPERSEDED


def test_release_api_needs_a_content_repo(client, monkeypatch, repos):
    _, clone = repos
    monkeypatch.delenv("CONTENT_REPO_DIR", raising=False)
    assert client.post("/api/releases").status_code == 503
    monkeypatch.setenv("CONTENT_REPO_DIR", str(clone))
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    empty_site = client.post("/api/releases").json()["release"]
    assert client.post("/api/releases").json() == {"release": None}
    doc_id = client.post("/api/articles", json={"title": "T", "topic": {"slug": "b", "name": "B"}, "markdown": "m"}).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json={"title": "T", "topic": {"slug": "b", "name": "B"}, "markdown": "m", "base_revision": 1})
    created = client.post("/api/releases").json()["release"]
    assert created["status"] == "dispatch_failed"
    assert [r["id"] for r in client.get("/api/releases").json()] == [created["id"], empty_site["id"]]


def fake_run(run_id, title, created_at, status="completed", conclusion="success"):
    return {
        "id": run_id,
        "display_title": title,
        "html_url": f"u{run_id}",
        "status": status,
        "conclusion": conclusion,
        "created_at": created_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


class FakeGitHub(BaseHTTPRequestHandler):
    requests: list[tuple[str, str, dict | None, str]] = []
    responses: dict[str, tuple[int, dict | None]] = {}
    runs: list[dict] = []

    def _list_runs(self, query):
        runs = FakeGitHub.runs
        if "created" in query:
            created = query["created"][0]
            assert created.startswith(">=")
            since = datetime.fromisoformat(created[2:])
            runs = [r for r in runs if datetime.fromisoformat(r["created_at"]) >= since]
        per_page, page = int(query.get("per_page", ["30"])[0]), int(query.get("page", ["1"])[0])
        return 200, {"total_count": len(runs), "workflow_runs": runs[(page - 1) * per_page : page * per_page]}

    def _handle(self):
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        FakeGitHub.requests.append((self.command, self.path, body, self.headers["authorization"]))
        url = urlsplit(self.path)
        if self.command == "GET" and url.path == "/repos/o/r/actions/workflows/deploy.yml/runs":
            code, payload = self._list_runs(parse_qs(url.query))
        else:
            code, payload = FakeGitHub.responses.get(f"{self.command} {self.path}", (404, {"message": "Not Found"}))
        self.send_response(code)
        self.end_headers()
        if payload is not None:
            self.wfile.write(json.dumps(payload).encode())

    do_GET = do_POST = _handle

    def log_message(self, *args):
        pass


@pytest.fixture
def github():
    FakeGitHub.requests, FakeGitHub.responses, FakeGitHub.runs = [], {}, []
    server = HTTPServer(("127.0.0.1", 0), FakeGitHub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield release.GitHubActions("tok", "o/r", "deploy.yml", "main", api_url=f"http://127.0.0.1:{server.server_port}")
    server.shutdown()


def test_github_client_requests(github):
    FakeGitHub.responses = {
        "POST /repos/o/r/actions/workflows/deploy.yml/dispatches": (204, None),
        "GET /repos/o/r/actions/runs/2/jobs": (
            200,
            {"jobs": [{"steps": [{"name": "Set up job", "conclusion": "success"}]}, {"steps": [{"name": "Deploy to GitHub Pages", "conclusion": "skipped"}]}]},
        ),
    }
    now = datetime.now(UTC)
    FakeGitHub.runs = [
        fake_run(1, "Deploy content other", now),
        fake_run(2, "Deploy content abc", now - timedelta(seconds=10), status="in_progress", conclusion=None),
        fake_run(3, "Deploy content abc", now - timedelta(seconds=20), conclusion="failure"),
    ]
    github.dispatch("abc")
    assert github.find_run("abc", now - timedelta(minutes=1)) == release.Run(id=2, url="u2", status="in_progress", conclusion=None)
    assert github.find_run("missing", now - timedelta(minutes=1)) is None
    assert github.deploy_step_conclusion(2) == "skipped"
    method, path, body, authorization = FakeGitHub.requests[0]
    assert (method, path, body, authorization) == (
        "POST",
        "/repos/o/r/actions/workflows/deploy.yml/dispatches",
        {"ref": "main", "inputs": {"content_sha": "abc"}},
        "Bearer tok",
    )


@pytest.mark.parametrize("clock_skew", [timedelta(seconds=5), timedelta(minutes=-1)])
def test_a_release_is_found_behind_many_newer_runs(repos, github, clock_skew):
    _, clone = repos
    FakeGitHub.responses = {
        "POST /repos/o/r/actions/workflows/deploy.yml/dispatches": (204, None),
        "GET /repos/o/r/actions/runs/7/jobs": (200, {"jobs": [{"steps": [{"name": release.DEPLOY_STEP, "conclusion": "success"}]}]}),
    }
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, clone, github)
        assert r.status == R.DISPATCHED
        started = r.created_at + clock_skew
        newer = [fake_run(100 + i, f"Deploy content other{i}", started + timedelta(minutes=i + 1)) for i in range(150)]
        FakeGitHub.runs = [*reversed(newer), fake_run(7, f"Deploy content {r.content_commit}", started)]
        assert release.refresh(s, r, github).status == R.DEPLOYED


def test_github_client_reports_http_errors(github):
    with pytest.raises(release.ReleaseError, match="returned 404"):
        github.dispatch("abc")


def test_going_live_cleans_up_old_versions(repos):
    _, clone = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s, "v1")
        for v in range(2, 6):
            articles.publish(s, doc_id, v, articles.DraftContent("T", BACKEND, f"v{v}"))
        r = release.create(s, clone, deployer)
        deployer.finish(r.content_commit)
        release.refresh(s, r, deployer)
        article = articles.get_article(s, doc_id)
        remaining = s.scalars(
            select(PublishedVersion.version).where(PublishedVersion.article_id == article.id).order_by(PublishedVersion.version)
        ).all()
        assert remaining == [3, 4, 5]


def test_a_release_that_failed_before_committing_is_redone(repos, monkeypatch):
    remote, clone = repos
    real_git = exporter._git

    def no_commit(repo, *args):
        if args[0] == "commit":
            raise subprocess.CalledProcessError(1, "git commit")
        return real_git(repo, *args)

    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        monkeypatch.setattr(exporter, "_git", no_commit)
        with pytest.raises(subprocess.CalledProcessError):
            release.create(s, clone, deployer)
        monkeypatch.setattr(exporter, "_git", real_git)

        r = release.create(s, clone, deployer)

        assert r.status == R.DISPATCHED
        assert git(remote, "rev-parse", "HEAD") == r.content_commit
        assert doc_id in git(remote, "ls-tree", "-r", "--name-only", "HEAD")


def test_a_commit_the_database_never_recorded_is_released(repos, monkeypatch):
    remote, clone = repos
    real_export = exporter.export

    def crash_after_commit(repo):
        real_export(repo)
        raise RuntimeError("database went away")

    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        monkeypatch.setattr(exporter, "export", crash_after_commit)
        with pytest.raises(RuntimeError):
            release.create(s, clone, deployer)
        monkeypatch.setattr(exporter, "export", real_export)
        orphan = git(clone, "rev-parse", "HEAD")

        r = release.create(s, clone, deployer)

        assert (r.content_commit, r.status) == (orphan, R.DISPATCHED)
        assert git(remote, "rev-parse", "HEAD") == orphan
        assert r.id == json.loads((clone / "manifest.json").read_text())["release_id"]
        assert [a.version for a in s.query(ReleaseArticle).filter_by(release_id=r.id)] == [1]
        assert release.create(s, clone, deployer) is None


def test_an_article_purged_during_export_is_left_out_of_the_release_record(repos, monkeypatch):
    _, clone = repos
    real_export = exporter.export

    with SessionLocal() as s:
        doc_id = publish(s)

        def purge_during_export(repo):
            result = real_export(repo)
            articles.delete(s, doc_id)
            articles.purge(s, doc_id)
            return result

        monkeypatch.setattr(exporter, "export", purge_during_export)
        r = release.create(s, clone, FakeDeployer())

        assert r.status == R.DISPATCHED
        assert s.query(ReleaseArticle).filter_by(release_id=r.id).count() == 0
