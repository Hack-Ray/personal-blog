from unittest.mock import Mock

from sqlalchemy import select

from blog import release, release_jobs
from blog.db import SessionLocal
from blog.models import Release, ReleaseJob, ReleaseStatus


def test_job_submission_returns_202_without_exporting(client, monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    create = Mock(side_effect=AssertionError("must not publish during admission"))
    monkeypatch.setattr(release, "create", create)
    response = client.post("/api/release-jobs", json={"action": "create"})
    assert response.status_code == 202
    job = response.json()
    assert job["status"] == "queued"
    assert client.get(f"/api/release-jobs/{job['id']}").json()["id"] == job["id"]
    create.assert_not_called()


def test_duplicate_job_submissions_are_refused(client, monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    assert client.post("/api/release-jobs", json={"action": "create"}).status_code == 202
    assert client.post("/api/release-jobs", json={"action": "create"}).status_code == 409


def test_invalid_jobs_do_not_enter_the_queue(client, monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    for body in ({"action": "retry"}, {"action": "create", "release_id": "x"}, {"action": "other"}):
        assert client.post("/api/release-jobs", json=body).status_code == 409
    assert client.get("/api/release-jobs").json() == []
    assert client.get("/api/release-jobs/missing").status_code == 404


def test_worker_marks_unchanged_content_completed(monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    monkeypatch.setattr(release, "deployer_from_env", lambda: None)
    monkeypatch.setattr(release, "create", lambda *args, **kwargs: None)
    with SessionLocal() as session:
        queued = release_jobs.submit(session, "create")
        job_id = queued.id
    assert release_jobs.run_once()
    with SessionLocal() as session:
        done = session.get(ReleaseJob, job_id)
        assert done.status == "completed"
        assert done.release_id is None
    assert not release_jobs.run_once()


def test_worker_persists_release_link_before_external_publication(monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    monkeypatch.setattr(release, "deployer_from_env", lambda: None)
    with SessionLocal() as session:
        job_id = release_jobs.submit(session, "create").id

    def create(session, repo, deployer, on_prepared):
        result = Release(id="01M00000000000000000000001", content_commit="a" * 40, status=ReleaseStatus.EXPORTED)
        session.add(result)
        on_prepared(result)
        session.commit()
        with SessionLocal() as observer:
            assert observer.get(ReleaseJob, job_id).release_id == result.id
        result.status = ReleaseStatus.DISPATCHED
        session.commit()
        return result

    monkeypatch.setattr(release, "create", create)
    assert release_jobs.run_once()
    with SessionLocal() as session:
        assert session.get(ReleaseJob, job_id).status == "completed"


def test_restart_resumes_prepared_commit_without_exporting_new_content(monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    monkeypatch.setattr(release, "deployer_from_env", lambda: None)
    create = Mock(side_effect=AssertionError("must reuse prepared release"))
    monkeypatch.setattr(release, "create", create)
    with SessionLocal() as session:
        result = Release(id="01M00000000000000000000002", content_commit="b" * 40, status=ReleaseStatus.EXPORTED)
        session.add(result)
        session.flush()
        session.add(ReleaseJob(id="01M00000000000000000000003", action="create", status="running", release_id=result.id))
        session.commit()

    def retry(session, release_id, repo, deployer):
        result = session.get(Release, release_id)
        assert result.content_commit == "b" * 40
        result.status = ReleaseStatus.DISPATCHED
        session.commit()
        return result

    monkeypatch.setattr(release, "retry", retry)
    assert release_jobs.run_once()
    with SessionLocal() as session:
        assert session.scalar(select(ReleaseJob)).status == "completed"
    create.assert_not_called()


def test_unexpected_error_does_not_leak_driver_secrets(monkeypatch, tmp_path):
    monkeypatch.setattr(release, "repo_from_env", lambda: tmp_path)
    monkeypatch.setattr(release, "deployer_from_env", lambda: None)
    monkeypatch.setattr(release, "create", Mock(side_effect=RuntimeError("password=secret")))
    with SessionLocal() as session:
        job_id = release_jobs.submit(session, "create").id
    assert release_jobs.run_once()
    with SessionLocal() as session:
        job = session.get(ReleaseJob, job_id)
        assert job.status == "failed"
        assert "secret" not in job.detail


def test_worker_exports_real_content_links_the_job_and_publishes_one_commit(monkeypatch, tmp_path):
    from blog import articles
    from blog.content_repository import GitHubRepository
    from tests.test_content_repository import LocalGitAPI
    from tests.test_release import FakeDeployer

    api = LocalGitAPI(tmp_path / "content.git")
    repo = GitHubRepository(api, "owner/content", "main")
    deployer = FakeDeployer()
    monkeypatch.setattr(release, "repo_from_env", lambda: repo)
    monkeypatch.setattr(release, "deployer_from_env", lambda: deployer)
    with SessionLocal() as session:
        draft = articles.DraftContent("Queued article", articles.Taxon("backend", "Backend"), "Published through a job")
        doc_id = articles.create_article(session, draft).article.doc_id
        articles.publish(session, doc_id, 1, draft)
        job_id = release_jobs.submit(session, "create").id
    assert release_jobs.run_once()
    with SessionLocal() as session:
        job = session.get(ReleaseJob, job_id)
        assert job.status == "completed", job.detail
        record = session.get(Release, job.release_id)
        assert record.status == ReleaseStatus.DISPATCHED
        assert api.head() == record.content_commit
        assert deployer.dispatched == [record.content_commit]
        assert "Published through a job" in api.contents(record.content_commit, f"articles/{doc_id}.json")
