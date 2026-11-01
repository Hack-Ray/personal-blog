import json
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import func, select, text

from blog import articles, exporter, release, release_jobs
from blog.db import SessionLocal, engine
from blog.github import GitHubClient, GitHubError
from blog.models import PublishedVersion, Release, ReleaseArticle, ReleaseStatus

R = ReleaseStatus
BACKEND = articles.Taxon("backend", "Backend")


@pytest.fixture
def repos(content, monkeypatch):
    monkeypatch.setattr(release, "repo_from_env", lambda: content.repo)
    return content.api, content.repo


class FakeDeployer:
    def __init__(self):
        self.dispatched: list[str] = []
        self.runs: list[tuple[str, release.Run]] = []
        self.deploy_steps: dict[int, str | None] = {}
        self.fail_dispatch = False

    def dispatch(self, content_commit):
        if self.fail_dispatch:
            raise release.ReleaseError("GitHub API POST returned 500")
        self.dispatched.append(content_commit)

    def find_run(self, content_commit, since, after_id=None):
        runs = [r for c, r in self.runs if c == content_commit and r.id > (after_id or 0)]
        return max(runs, key=lambda r: r.id, default=None)

    def get_run(self, run_id):
        return next(r for _, r in self.runs if r.id == run_id)

    def deploy_step_conclusion(self, run_id):
        return self.deploy_steps.get(run_id)

    def start(self, commit, status="in_progress"):
        run = release.Run(id=len(self.runs) + 1, url=f"https://run/{len(self.runs) + 1}", status=status, conclusion=None)
        self.runs.append((commit, run))
        return run

    def finish(self, commit, conclusion="success", deploy_step="success", run=None):
        """Completes the commit's newest run, or a new one."""
        run = run or self.find_run(commit, None) or self.start(commit)
        done = release.Run(id=run.id, url=run.url, status="completed", conclusion=conclusion)
        self.runs = [(c, done if r.id == run.id else r) for c, r in self.runs]
        self.deploy_steps[run.id] = deploy_step
        return done


def update_site(client):
    """Asks for a website update the way the CMS does, lets the worker run it, and returns the job."""
    job = client.post("/api/release-jobs", json={"action": "create"})
    assert job.status_code == 202, job.text
    assert release_jobs.run_once()
    return next(j for j in client.get("/api/release-jobs").json() if j["id"] == job.json()["id"])


def refresh(session, r, deployer):
    release.refresh_in_flight(session, deployer)
    session.refresh(r)
    return r


def publish(session, markdown="body"):
    doc_id = articles.create_article(session, articles.DraftContent("T", BACKEND, markdown)).article.doc_id
    articles.publish(session, doc_id, 1, articles.DraftContent("T", BACKEND, markdown))
    return doc_id


def test_release_exports_pushes_and_dispatches(repos):
    api, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        r = release.create(s, repo, deployer)
        assert r.status == R.DISPATCHED
        assert deployer.dispatched == [r.content_commit]
        assert api.head() == r.content_commit
        assert [(a.version,) for a in s.query(ReleaseArticle).filter_by(release_id=r.id)] == [(1,)]
        assert s.scalars(s.query(ReleaseArticle.article_id).statement).one() == articles.get_article(s, doc_id).id


def test_nothing_changed_makes_no_release(repos):
    _, repo = repos
    with SessionLocal() as s:
        publish(s)
        assert release.create(s, repo, FakeDeployer()) is not None
        assert release.create(s, repo, FakeDeployer()) is None
        assert s.query(Release).count() == 1


def test_without_a_token_the_release_waits_for_a_retry(repos):
    _, repo = repos
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, None)
        assert r.status == R.DISPATCH_FAILED
        assert "CMS_GITHUB_TOKEN" in r.detail
        deployer = FakeDeployer()
        assert release.retry(s, r.id, repo, deployer).status == R.DISPATCHED
        assert deployer.dispatched == [r.content_commit]


def test_push_failure_is_retryable(repos):
    api, repo = repos
    api.fail_patch = True
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, FakeDeployer())
        assert (r.status, r.detail) == (R.PUSH_FAILED, "GitHub API PATCH returned 500")
        api.fail_patch = False
        assert release.retry(s, r.id, repo, FakeDeployer()).status == R.DISPATCHED
        assert api.head() == r.content_commit


def test_dispatch_failure_is_retryable(repos):
    _, repo = repos
    deployer = FakeDeployer()
    deployer.fail_dispatch = True
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, deployer)
        assert (r.status, r.detail) == (R.DISPATCH_FAILED, "GitHub API POST returned 500")
        deployer.fail_dispatch = False
        assert release.retry(s, r.id, repo, deployer).status == R.DISPATCHED


@pytest.mark.parametrize(
    ("conclusion", "deploy_step", "expected"),
    [("success", "success", R.DEPLOYED), ("success", "skipped", R.SUPERSEDED), ("failure", None, R.FAILED)],
)
def test_refresh_records_the_run_outcome(repos, conclusion, deploy_step, expected):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, deployer)
        assert refresh(s, r, deployer).status == R.DISPATCHED
        run = deployer.start(r.content_commit)
        assert refresh(s, r, deployer).status == R.BUILDING
        assert (r.run_id, r.run_url) == (run.id, run.url)
        deployer.finish(r.content_commit, conclusion, deploy_step)
        r = refresh(s, r, deployer)
        assert r.status == expected


def test_failed_build_can_be_retried_only_while_latest(repos):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        first = release.create(s, repo, deployer)
        deployer.finish(first.content_commit, "failure")
        refresh(s, first, deployer)
        articles.publish(s, doc_id, 2, articles.DraftContent("T", BACKEND, "edit"))
        second = release.create(s, repo, deployer)
        with pytest.raises(release.ReleaseError, match="newer release"):
            release.retry(s, first.id, repo, deployer)
        with pytest.raises(release.ReleaseError, match="only failed, interrupted or superseded"):
            release.retry(s, second.id, repo, deployer)


def test_the_latest_release_replaced_by_a_code_deploy_can_be_retried(repos):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, deployer)
        # A code push queued after this release cancels its run; that push's own deploy may then fail CI.
        deployer.finish(r.content_commit, "cancelled")
        assert refresh(s, r, deployer).status == R.SUPERSEDED
        assert release.retry(s, r.id, repo, deployer).status == R.DISPATCHED
        assert deployer.dispatched == [r.content_commit, r.content_commit]


def test_a_new_release_supersedes_older_unfinished_failures(repos):
    _, repo = repos
    with SessionLocal() as s:
        doc_id = publish(s)
        stuck = release.create(s, repo, None)
        articles.publish(s, doc_id, 2, articles.DraftContent("T", BACKEND, "edit"))
        release.create(s, repo, FakeDeployer())
        s.refresh(stuck)
        assert stuck.status == R.SUPERSEDED


def test_release_api_needs_a_content_repo(client, configure, monkeypatch, content):
    configure(content_repo=None, github_token=None)
    assert client.post("/api/release-jobs", json={"action": "create"}).status_code == 409
    monkeypatch.setattr(release, "repo_from_env", lambda: content.repo)
    empty_site = update_site(client)["release_id"]
    assert update_site(client)["release_id"] is None
    doc_id = client.post("/api/articles", json={"title": "T", "topic": {"slug": "b", "name": "B"}, "markdown": "m"}).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json={"title": "T", "topic": {"slug": "b", "name": "B"}, "markdown": "m", "base_revision": 1})
    created = update_site(client)["release_id"]
    listed = client.post("/api/releases/refresh").json()
    assert [r["id"] for r in listed] == [created, empty_site]
    assert listed[0]["status"] == "dispatch_failed"


def test_a_retried_release_is_not_judged_by_the_failed_run(repos):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, deployer)
        old = deployer.finish(r.content_commit, "failure")
        assert refresh(s, r, deployer).status == R.FAILED

        assert release.retry(s, r.id, repo, deployer).status == R.DISPATCHED
        # GitHub has not listed the new run yet; only the failed one is there.
        assert refresh(s, r, deployer).status == R.DISPATCHED
        new = deployer.start(r.content_commit)
        assert refresh(s, r, deployer).status == R.BUILDING
        assert r.run_id == new.id != old.id
        deployer.finish(r.content_commit, run=new)
        assert refresh(s, r, deployer).status == R.DEPLOYED


def test_a_run_cancelled_in_the_queue_is_superseded(repos):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, deployer)
        deployer.finish(r.content_commit, "cancelled", None)
        assert refresh(s, r, deployer).status == R.SUPERSEDED


def test_a_run_never_listed_fails_after_the_search_limit(repos):
    _, repo = repos
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, FakeDeployer())
        s.execute(text("UPDATE releases SET dispatched_at = now() - interval '31 minutes'"))
        s.commit()
        s.expire_all()
        r = refresh(s, r, FakeDeployer())
        assert r.status == R.FAILED
        assert "never listed" in r.detail


def test_refresh_does_not_overwrite_a_state_recorded_meanwhile(repos, monkeypatch):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, deployer)
        deployer.finish(r.content_commit)
        real_check = release._check

        def retried_meanwhile(*args):
            with engine.begin() as conn:
                conn.execute(text("UPDATE releases SET status = 'failed'"))
            return real_check(*args)

        monkeypatch.setattr(release, "_check", retried_meanwhile)
        assert refresh(s, r, deployer).status == R.FAILED


def set_status(session, status):
    session.execute(text("UPDATE releases SET status = :s"), {"s": status.value})
    session.commit()
    session.expire_all()


@pytest.mark.parametrize("stuck", [R.EXPORTED, R.PUSHED])
def test_a_release_cut_off_mid_way_can_be_retried_or_replaced(repos, stuck):
    api, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        r = release.create(s, repo, None)
        set_status(s, stuck)
        assert release.retry(s, r.id, repo, deployer).status == R.DISPATCHED
        assert api.head() == r.content_commit

        set_status(s, stuck)
        articles.publish(s, doc_id, 2, articles.DraftContent("T", BACKEND, "edit"))
        newer = release.create(s, repo, deployer)
        assert newer is not None and newer.id != r.id, newer
        s.refresh(r)
        assert r.status == R.SUPERSEDED


def test_only_one_release_runs_at_a_time(client, configure, repos):
    _, repo = repos
    with engine.connect() as other:
        other.scalar(select(func.pg_advisory_lock(release.LOCK_KEY)))
        with SessionLocal() as s, pytest.raises(release.ReleaseBusy):
            release.create(s, repo, None)
        job = update_site(client)
        assert (job["status"], job["detail"]) == ("failed", "another release is in progress; try again when it finishes")
        other.scalar(select(func.pg_advisory_unlock(release.LOCK_KEY)))
    assert update_site(client)["release_id"] is not None


def test_a_commit_pushed_by_someone_else_stops_the_release(repos):
    api, repo = repos
    with SessionLocal() as s:
        doc_id = publish(s)
        release.create(s, repo, None)
        tree = api.git("rev-parse", f"{api.head()}^{{tree}}")
        api.git("update-ref", "refs/heads/main", api.git("commit-tree", tree, "-p", api.head(), "-m", "Release from elsewhere"))
        articles.publish(s, doc_id, 2, articles.DraftContent("T", BACKEND, "edit"))
        with pytest.raises(exporter.ExportError, match="another CMS may be in use"):
            release.create(s, repo, None)
        assert s.query(Release).count() == 1


def test_listing_releases_asks_github_how_they_are_doing(client, configure, monkeypatch, repos):
    _, repo = repos
    deployer = FakeDeployer()
    monkeypatch.setattr(release, "deployer_from_env", lambda: deployer)
    update_site(client)
    created = client.post("/api/releases/refresh").json()[0]
    assert created["status"] == "dispatched"
    assert created["dispatched_at"] is not None
    deployer.finish(created["content_commit"])
    assert client.post("/api/releases/refresh").json()[0]["status"] == "deployed"


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
    headers: dict[str, str] = {}
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
        for name, value in FakeGitHub.headers.items():
            self.send_header(name, value)
        self.end_headers()
        if payload is not None:
            self.wfile.write(json.dumps(payload).encode())

    do_GET = do_POST = _handle

    def log_message(self, *args):
        pass


@pytest.fixture
def github():
    FakeGitHub.requests, FakeGitHub.responses, FakeGitHub.headers, FakeGitHub.runs = [], {}, {}, []
    server = HTTPServer(("127.0.0.1", 0), FakeGitHub)
    # shutdown() waits for the next poll, every 0.5 s by default.
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
    yield release.GitHubActions(GitHubClient("tok", f"http://127.0.0.1:{server.server_port}"), "o/r", "deploy.yml", "main")
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
    FakeGitHub.responses["GET /repos/o/r/actions/runs/3"] = (200, FakeGitHub.runs[2])
    github.dispatch("abc")
    assert github.find_run("abc", now - timedelta(minutes=1)) == release.Run(id=2, url="u2", status="in_progress", conclusion=None)
    assert github.find_run("abc", now - timedelta(minutes=1), after_id=3) is None
    assert github.get_run(3) == release.Run(id=3, url="u3", status="completed", conclusion="failure")
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
    _, repo = repos
    FakeGitHub.responses = {
        "POST /repos/o/r/actions/workflows/deploy.yml/dispatches": (204, None),
        "GET /repos/o/r/actions/runs/7/jobs": (200, {"jobs": [{"steps": [{"name": release.DEPLOY_STEP, "conclusion": "success"}]}]}),
    }
    with SessionLocal() as s:
        publish(s)
        r = release.create(s, repo, github)
        assert r.status == R.DISPATCHED
        started = r.created_at + clock_skew
        newer = [fake_run(100 + i, f"Deploy content other{i}", started + timedelta(minutes=i + 1)) for i in range(150)]
        FakeGitHub.runs = [*reversed(newer), fake_run(7, f"Deploy content {r.content_commit}", started)]
        assert refresh(s, r, github).status == R.DEPLOYED


def test_token_expiry_comes_from_the_response_header(github):
    FakeGitHub.responses = {"GET /repos/o/r": (200, {})}
    assert github.token_expires_at() is None
    FakeGitHub.headers = {release.TOKEN_EXPIRY_HEADER: "2027-01-18 08:30:00 UTC"}
    assert github.token_expires_at() == datetime(2027, 1, 18, 8, 30, tzinfo=UTC)


def test_the_token_endpoint_reports_an_unconfigured_token(client, configure):
    configure(github_token=None)
    assert client.get("/api/github-token").json() == {"configured": False, "expires_at": None}


def test_with_a_github_app_the_token_endpoint_never_calls_github(client, configure, monkeypatch):
    """Installation tokens are short-lived and renewed by the CMS, so there is no expiry to warn about."""
    configure(github_auth="app", deploy_repo="someone/personal-blog")
    monkeypatch.setattr(release, "deployer_from_env", lambda: pytest.fail("called GitHub"))
    assert client.get("/api/github-token").json() == {"configured": False, "expires_at": None}


def test_a_token_without_a_deploy_repo_dispatches_nowhere(configure):
    configure(github_token="t", deploy_repo=None)
    assert release.deployer_from_env() is None
    configure(deploy_repo="someone/personal-blog")
    assert release.deployer_from_env().repo == "someone/personal-blog"


def test_github_client_reports_http_errors(github):
    with pytest.raises(release.ReleaseError, match="returned 404"):
        github.dispatch("abc")


INCIDENTS = "GET /api/v2/incidents/unresolved.json"


def incident(name, *components):
    return {"name": name, "shortlink": f"https://stspg.io/{name.replace(' ', '')}", "impact": "minor", "components": [{"name": c} for c in components]}


def test_the_status_endpoint_lists_only_incidents_that_hold_up_a_deploy(client, configure, github):
    configure(github_status_url=github.client.api_url)
    FakeGitHub.responses = {
        INCIDENTS: (
            200,
            {
                "incidents": [
                    incident("Actions slow", "Actions"),
                    incident("Issues down", "Issues"),
                    incident("Pages and API", "API Requests", "Pages"),
                    incident("Odd link", "Actions") | {"shortlink": "javascript:alert(1)"},
                ]
            },
        )
    }
    assert client.get("/api/github-status").json() == {
        "incidents": [
            {"name": "Actions slow", "url": "https://stspg.io/Actionsslow"},
            {"name": "Pages and API", "url": "https://stspg.io/PagesandAPI"},
        ]
    }


def test_the_status_endpoint_is_empty_when_nothing_is_open(client, configure, github):
    configure(github_status_url=github.client.api_url)
    FakeGitHub.responses = {INCIDENTS: (200, {"incidents": []})}
    assert client.get("/api/github-status").json() == {"incidents": []}


@pytest.mark.parametrize("response", [(500, {"message": "boom"}), (200, {"unexpected": True}), (200, {"incidents": [{"name": "x"}]})])
def test_the_status_endpoint_answers_502_when_githubstatus_fails(client, configure, github, response):
    configure(github_status_url=github.client.api_url)
    FakeGitHub.responses = {INCIDENTS: response}
    assert client.get("/api/github-status").status_code == 502


def test_the_status_endpoint_needs_a_session(anon):
    assert anon.get("/api/github-status").status_code == 401


def test_going_live_cleans_up_old_versions(repos):
    _, repo = repos
    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s, "v1")
        for v in range(2, 6):
            articles.publish(s, doc_id, v, articles.DraftContent("T", BACKEND, f"v{v}"))
        r = release.create(s, repo, deployer)
        deployer.finish(r.content_commit)
        refresh(s, r, deployer)
        article = articles.get_article(s, doc_id)
        remaining = s.scalars(select(PublishedVersion.version).where(PublishedVersion.article_id == article.id).order_by(PublishedVersion.version)).all()
        assert remaining == [3, 4, 5]


def test_a_release_that_failed_before_committing_is_redone(repos, monkeypatch):
    api, repo = repos
    real_call = api.call

    def no_commit(method, path, body=None):
        if method == "POST" and path.endswith("/git/commits"):
            raise GitHubError("GitHub API POST returned 502", status=502)
        return real_call(method, path, body)

    deployer = FakeDeployer()
    with SessionLocal() as s:
        doc_id = publish(s)
        monkeypatch.setattr(api, "call", no_commit)
        with pytest.raises(GitHubError):
            release.create(s, repo, deployer)
        monkeypatch.setattr(api, "call", real_call)

        r = release.create(s, repo, deployer)

        assert r.status == R.DISPATCHED
        assert api.head() == r.content_commit
        assert f"articles/{doc_id}.json" in api.files(api.head())


def test_a_commit_the_database_never_recorded_is_replaced(repos, monkeypatch):
    api, repo = repos
    real_record = release.record_export

    def crash_before_recording(*args, **kwargs):
        raise RuntimeError("database went away")

    deployer = FakeDeployer()
    with SessionLocal() as s:
        publish(s)
        parent = api.head()
        monkeypatch.setattr(release, "record_export", crash_before_recording)
        with pytest.raises(RuntimeError):
            release.create(s, repo, deployer)
        monkeypatch.setattr(release, "record_export", real_record)
        assert api.head() == parent

        r = release.create(s, repo, deployer)

        assert (r.content_parent, r.status) == (parent, R.DISPATCHED)
        assert api.head() == r.content_commit
        assert [a.version for a in s.query(ReleaseArticle).filter_by(release_id=r.id)] == [1]
        assert release.create(s, repo, deployer) is None


def test_an_article_purged_during_export_is_left_out_of_the_release_record(repos, monkeypatch):
    _, repo = repos
    real_render = exporter.render_snapshot

    with SessionLocal() as s:
        doc_id = publish(s)

        def purge_during_export(session):
            result = real_render(session)
            articles.delete(s, doc_id)
            articles.purge(s, doc_id)
            return result

        monkeypatch.setattr(exporter, "render_snapshot", purge_during_export)
        r = release.create(s, repo, FakeDeployer())

        assert r.status == R.DISPATCHED
        assert s.query(ReleaseArticle).filter_by(release_id=r.id).count() == 0


def test_a_new_release_waits_for_the_cooldown(client, configure, monkeypatch, repos):
    _, repo = repos
    monkeypatch.setattr(release, "COOLDOWN", timedelta(seconds=30))
    monkeypatch.setattr(release, "deployer_from_env", FakeDeployer)
    assert update_site(client)["release_id"] is not None
    second = update_site(client)
    assert second["status"] == "failed"
    assert second["detail"].startswith("a release was just started; try again in ")


def test_api_dispatch_includes_nondefault_content_branch(github):
    FakeGitHub.responses = {"POST /repos/o/r/actions/workflows/deploy.yml/dispatches": (204, None)}
    github.content_branch = "published/mobile"
    github.dispatch("abc")
    assert FakeGitHub.requests[-1][2]["inputs"] == {"content_sha": "abc", "content_branch": "published/mobile"}


def test_retry_refuses_a_different_deployment_destination_before_dispatch(repos):
    _, repo = repos
    original = FakeDeployer()
    original.target = "original-repo-main"
    original.fail_dispatch = True
    with SessionLocal() as session:
        publish(session)
        record = release.create(session, repo, original)
        assert record.status == R.DISPATCH_FAILED
        assert record.deployment_target == original.target
        changed = FakeDeployer()
        changed.target = "other-repo-or-ref"
        with pytest.raises(release.ReleaseError, match="deployment destination differs"):
            release.retry(session, record.id, repo, changed)
        assert changed.dispatched == []
