import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from blog import articles, release
from blog.db import SessionLocal
from blog.models import Release, ReleaseArticle, ReleaseStatus

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

    def find_run(self, content_commit):
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


class FakeGitHub(BaseHTTPRequestHandler):
    requests: list[tuple[str, str, dict | None, str]] = []
    responses: dict[str, tuple[int, dict | None]] = {}

    def _handle(self):
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        FakeGitHub.requests.append((self.command, self.path, body, self.headers["authorization"]))
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
    FakeGitHub.requests, FakeGitHub.responses = [], {}
    server = HTTPServer(("127.0.0.1", 0), FakeGitHub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield release.GitHubActions("tok", "o/r", "deploy.yml", "main", api_url=f"http://127.0.0.1:{server.server_port}")
    server.shutdown()


def test_github_client_requests(github):
    FakeGitHub.responses = {
        "POST /repos/o/r/actions/workflows/deploy.yml/dispatches": (204, None),
        "GET /repos/o/r/actions/workflows/deploy.yml/runs?event=workflow_dispatch&per_page=30": (
            200,
            {
                "workflow_runs": [
                    {"id": 1, "display_title": "Deploy content other", "html_url": "u1", "status": "completed", "conclusion": "success"},
                    {"id": 2, "display_title": "Deploy content abc", "html_url": "u2", "status": "in_progress", "conclusion": None},
                ]
            },
        ),
        "GET /repos/o/r/actions/runs/2/jobs": (
            200,
            {"jobs": [{"steps": [{"name": "Set up job", "conclusion": "success"}]}, {"steps": [{"name": "Deploy to GitHub Pages", "conclusion": "skipped"}]}]},
        ),
    }
    github.dispatch("abc")
    assert github.find_run("abc") == release.Run(id=2, url="u2", status="in_progress", conclusion=None)
    assert github.find_run("missing") is None
    assert github.deploy_step_conclusion(2) == "skipped"
    method, path, body, authorization = FakeGitHub.requests[0]
    assert (method, path, body, authorization) == (
        "POST",
        "/repos/o/r/actions/workflows/deploy.yml/dispatches",
        {"ref": "main", "inputs": {"content_sha": "abc"}},
        "Bearer tok",
    )


def test_github_client_reports_http_errors(github):
    with pytest.raises(release.ReleaseError, match="returned 404"):
        github.dispatch("abc")
