import base64
import json
import os
import subprocess
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock
from urllib.parse import unquote, urlsplit

import pytest

from blog import content_repository, exporter, release
from blog.content_repository import GitHubRepository
from blog.db import SessionLocal
from blog.github import GitHubError
from blog.models import Release, ReleaseStatus


class LocalGitAPI:
    api_url = "https://github.test"

    def __init__(self, path):
        self.path = path
        self.calls = []
        self.truncated = False
        self.lose_patch_response = False
        self.env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@example.com",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "test@example.com",
            "GIT_INDEX_FILE": str(path.parent / "git-api-index"),
        }
        subprocess.run(["git", "init", "--bare", "--quiet", str(path)], check=True)
        readme = self.git("hash-object", "-w", "--stdin", data=b"keep me\n")
        self.git("update-index", "--add", "--cacheinfo", f"100644,{readme},README.md")
        tree = self.git("write-tree")
        initial = self.git("commit-tree", tree, "-m", "Initialize")
        self.git("update-ref", "refs/heads/main", initial)

    def git(self, *args, data=None):
        return (
            subprocess.run(
                ["git", "--git-dir", str(self.path), *args],
                input=data,
                check=True,
                capture_output=True,
                env=self.env,
            )
            .stdout.decode()
            .strip()
        )

    def head(self):
        return self.git("rev-parse", "refs/heads/main")

    def files(self, commit):
        return self.git("ls-tree", "-r", "--name-only", commit).splitlines()

    def contents(self, commit, path):
        return self.git("show", f"{commit}:{path}")

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        suffix = unquote(urlsplit(path).path.split("/git/", 1)[1])
        if method == "GET" and suffix.startswith("ref/heads/"):
            if suffix != "ref/heads/main":
                raise GitHubError("not found", status=404)
            return {"object": {"sha": self.head()}}
        if method == "GET" and suffix.startswith("commits/"):
            commit = suffix.removeprefix("commits/")
            return {"tree": {"sha": self.git("rev-parse", f"{commit}^{{tree}}")}}
        if method == "GET" and suffix.startswith("trees/"):
            entries = []
            for line in self.git("ls-tree", "-r", suffix.removeprefix("trees/")).splitlines():
                meta, name = line.split("\t")
                mode, kind, sha = meta.split()
                entries.append({"path": name, "mode": mode, "type": kind, "sha": sha})
            return {"tree": entries, "truncated": self.truncated}
        if method == "GET" and suffix.startswith("blobs/"):
            data = subprocess.run(
                ["git", "--git-dir", str(self.path), "cat-file", "blob", suffix.removeprefix("blobs/")],
                check=True,
                capture_output=True,
            ).stdout
            return {"encoding": "base64", "content": base64.b64encode(data).decode()}
        if method == "POST" and suffix == "blobs":
            return {"sha": self.git("hash-object", "-w", "--stdin", data=base64.b64decode(body["content"]))}
        if method == "POST" and suffix == "trees":
            self.git("read-tree", body["base_tree"])
            for entry in body["tree"]:
                if entry["sha"] is None:
                    self.git("update-index", "--index-info", data=f"0 {'0' * 40}\t{entry['path']}\n".encode())
                else:
                    self.git("update-index", "--add", "--cacheinfo", f"{entry['mode']},{entry['sha']},{entry['path']}")
            return {"sha": self.git("write-tree")}
        if method == "POST" and suffix == "commits":
            assert len(body["parents"]) == 1
            return {"sha": self.git("commit-tree", body["tree"], "-p", body["parents"][0], "-m", body["message"])}
        if method == "PATCH" and suffix == "refs/heads/main":
            assert body["force"] is False
            previous = self.head()
            if subprocess.run(
                ["git", "--git-dir", str(self.path), "merge-base", "--is-ancestor", previous, body["sha"]],
                capture_output=True,
            ).returncode:
                raise GitHubError("not a fast-forward", status=422)
            self.git("update-ref", "refs/heads/main", body["sha"], previous)
            if self.lose_patch_response:
                self.lose_patch_response = False
                raise GitHubError("response lost")
            return {}
        raise AssertionError((method, path, body))


@pytest.fixture
def repository(tmp_path):
    api = LocalGitAPI(tmp_path / "content.git")
    return GitHubRepository(api, "owner/content", "main"), api


@pytest.fixture
def snapshot(monkeypatch):
    files = {
        "manifest.json": json.dumps(
            {
                "schema_version": 1,
                "release_id": "01K7M4Y7P65BDCF8AHRTQY7Z01",
                "created_at": "2026-01-01T00:00:00Z",
                "articles": [{"doc_id": "article", "version": 1}],
                "archived_articles": [],
            }
        ).encode(),
        "profile.json": b'{"name":"Example"}',
        "articles/article.json": b'{"title":"One","markdown":"Body"}',
    }
    connection = MagicMock()
    connection.execution_options.return_value = nullcontext(None)
    monkeypatch.setattr(content_repository, "engine", connection)
    connection.connect.return_value = connection
    monkeypatch.setattr(content_repository, "Session", lambda **kwargs: nullcontext(None))
    monkeypatch.setattr(exporter, "render_snapshot", lambda session: (files, set()))
    return files


def saved(result):
    return Release(id=result.release_id, content_commit=result.commit, content_parent=result.parent_commit, content_target=result.target)


def test_prepare_creates_one_commit_without_publishing(repository, snapshot):
    repo, api = repository
    initial = api.head()
    result = repo.prepare(None)
    assert api.head() == initial
    assert api.git("rev-parse", f"{result.commit}^") == initial
    assert api.files(result.commit) == ["README.md", "articles/article.json", "manifest.json", "profile.json"]
    assert result.versions == {"article": 1}
    assert api.contents(result.commit, "README.md") == "keep me"
    assert sum(method == "POST" and path.endswith("/commits") for method, path, _ in api.calls) == 1
    assert not any(method == "PATCH" for method, _, _ in api.calls)


def test_publish_recovers_when_ref_update_response_was_lost(repository, snapshot):
    repo, api = repository
    record = saved(repo.prepare(None))
    api.lose_patch_response = True
    with pytest.raises(GitHubError, match="response lost"):
        repo.publish(record)
    assert api.head() == record.content_commit
    repo.publish(record)
    assert sum(method == "PATCH" for method, _, _ in api.calls) == 1


def test_publish_refuses_another_writers_commit(repository, snapshot):
    repo, api = repository
    record = saved(repo.prepare(None))
    other = api.git("commit-tree", api.git("rev-parse", "refs/heads/main^{tree}"), "-p", api.head(), "-m", "Another CMS")
    api.git("update-ref", "refs/heads/main", other)
    with pytest.raises(exporter.ExportError, match="another writer"):
        repo.publish(record)
    assert api.head() == other
    assert not any(method == "PATCH" for method, _, _ in api.calls)


def test_unchanged_content_does_not_create_another_commit(repository, snapshot):
    repo, api = repository
    record = saved(repo.prepare(None))
    repo.publish(record)
    calls = len(api.calls)
    manifest = json.loads(snapshot["manifest.json"])
    manifest.update(release_id="01K7M4Y7P65BDCF8AHRTQY7Z02", created_at="2026-02-01T00:00:00Z")
    snapshot["manifest.json"] = json.dumps(manifest).encode()
    assert repo.prepare(record) is None
    assert not any(method in ("POST", "PATCH") for method, _, _ in api.calls[calls:])


def test_next_snapshot_deletes_only_stale_managed_files(repository, snapshot):
    repo, api = repository
    first = saved(repo.prepare(None))
    repo.publish(first)
    del snapshot["articles/article.json"]
    snapshot["articles/replacement.json"] = b'{"title":"Replacement"}'
    result = repo.prepare(first)
    assert api.files(result.commit) == ["README.md", "articles/replacement.json", "manifest.json", "profile.json"]
    assert api.head() == first.content_commit


def test_truncated_tree_is_refused_before_writes(repository):
    repo, api = repository
    api.truncated = True
    with pytest.raises(exporter.ExportError, match="truncated"):
        repo.prepare(None)
    assert all(method == "GET" for method, _, _ in api.calls)


def test_existing_snapshot_requires_verified_adoption(repository, snapshot):
    repo, api = repository
    original = saved(repo.prepare(None))
    repo.publish(original)
    with pytest.raises(exporter.ExportError, match="no local release history"):
        repo.prepare(None)
    calls = len(api.calls)
    adopted = repo.prepare(None, adopt=True)
    assert adopted.commit == original.content_commit
    assert adopted.release_id == original.id
    assert not any(method in ("POST", "PATCH") for method, _, _ in api.calls[calls:])
    snapshot["articles/article.json"] = b'{"title":"Different database"}'
    with pytest.raises(exporter.ExportError, match="adoption refused"):
        repo.prepare(None, adopt=True)


def test_retry_refuses_a_different_destination(repository, snapshot):
    repo, api = repository
    record = saved(repo.prepare(None))
    changed = GitHubRepository(api, "owner/other", "main")
    with pytest.raises(exporter.ExportError, match="destination differs"):
        changed.publish(record)
    assert not any(method == "PATCH" for method, _, _ in api.calls)


def test_prepare_refuses_unknown_head_and_changed_destination(repository, snapshot):
    repo, api = repository
    wrong = SimpleNamespace(content_commit="0" * 40, content_parent=None, content_target=repo.target, status=ReleaseStatus.DEPLOYED)
    with pytest.raises(exporter.ExportError, match="another CMS"):
        repo.prepare(wrong)
    wrong = SimpleNamespace(content_commit=api.head(), content_parent=None, content_target="https://different/content#main", status=ReleaseStatus.DEPLOYED)
    with pytest.raises(exporter.ExportError, match="destination changed"):
        repo.prepare(wrong)
    assert all(method == "GET" for method, _, _ in api.calls)


def test_a_new_release_replaces_one_whose_push_failed(repository, snapshot):
    repo, api = repository
    failed = saved(repo.prepare(None))
    failed.status = ReleaseStatus.PUSH_FAILED
    snapshot["articles/article.json"] = b'{"title":"Edited"}'
    assert repo.prepare(failed).parent_commit == api.head()
    failed.status = ReleaseStatus.PUSHED
    with pytest.raises(exporter.ExportError, match="another CMS"):
        repo.prepare(failed)


def test_after_a_restore_the_next_release_replaces_newer_remote_content(repository, snapshot):
    repo, api = repository
    backed_up = dict(snapshot)
    with SessionLocal() as s:
        first = saved(repo.prepare(None))
        repo.publish(first)
        first.status = ReleaseStatus.DEPLOYED
        s.add(first)
        s.commit()
        # Released after the backup was taken, so the restored database does not know it.
        snapshot["articles/article.json"] = b'{"title":"Written after the backup"}'
        later = saved(repo.prepare(first))
        repo.publish(later)
        snapshot.update(backed_up)
        with pytest.raises(exporter.ExportError, match="another CMS"):
            repo.prepare(release.latest(s))

        assert content_repository.record_remote_head(s, repo) == later.content_commit
        assert content_repository.record_remote_head(s, repo) is None
        rollback = repo.prepare(release.latest(s))
        assert rollback.parent_commit == later.content_commit
        assert api.contents(rollback.commit, "articles/article.json") == backed_up["articles/article.json"].decode()


def test_missing_branch_has_actionable_initialization_error(repository):
    repo, api = repository
    missing = GitHubRepository(api, "owner/content", "missing")
    with pytest.raises(exporter.ExportError, match="initialize.*README"):
        missing.head()


def test_existing_image_blob_is_reused(repository, snapshot, monkeypatch):
    repo, api = repository
    image_id = "a" * 64 + ".webp"
    image_bytes = b"image data"
    session = MagicMock()
    session.scalars.return_value.one.return_value = image_bytes
    monkeypatch.setattr(content_repository, "Session", lambda **kwargs: nullcontext(session))
    monkeypatch.setattr(exporter, "render_snapshot", lambda session: (snapshot, {image_id}))
    first = saved(repo.prepare(None))
    repo.publish(first)
    calls = len(api.calls)
    snapshot["articles/article.json"] = b'{"title":"Edited article"}'
    result = repo.prepare(first)
    assert f"images/{image_id}" in api.files(result.commit)
    encoded_image = base64.b64encode(image_bytes).decode()
    assert not any(method == "POST" and path.endswith("/blobs") and body["content"] == encoded_image for method, path, body in api.calls[calls:])


def test_prepares_the_real_database_snapshot(repository):
    from blog import articles
    from blog.db import SessionLocal

    content = articles.DraftContent("API article", articles.Taxon("backend", "Backend"), "Real published body")
    with SessionLocal() as session:
        doc_id = articles.create_article(session, content).article.doc_id
        articles.publish(session, doc_id, 1, content)
    repo, api = repository
    original_head = api.head()
    result = repo.prepare(None)
    assert api.head() == original_head
    exported = json.loads(api.contents(result.commit, f"articles/{doc_id}.json"))
    assert exported["markdown"] == "Real published body"
    assert result.versions == {doc_id: 1}
    manifest = json.loads(api.contents(result.commit, "manifest.json"))
    assert manifest["articles"] == [{"doc_id": doc_id, "version": 1}]
