import json
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import delete

from blog import articles
from blog.db import SessionLocal
from blog.exporter import export
from blog.models import PublishedVersion

BACKEND = articles.Taxon("backend", "Backend")


def content(**overrides):
    return articles.DraftContent(**{"title": "Hello", "topic": BACKEND, "markdown": "body", **overrides})


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "--quiet")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    return tmp_path


def read(repo, path):
    return json.loads((repo / path).read_text())


def test_exports_latest_published_version_and_skips_drafts(repo):
    with SessionLocal() as s:
        a = articles.create_article(s, content(markdown="v1"))
        doc_id = a.article.doc_id
        articles.publish(s, doc_id, 1, content(markdown="v1", tags=[articles.Taxon("python", "Python")]))
        articles.publish(s, doc_id, 2, content(markdown="v2"))
        articles.save_draft(s, doc_id, 3, content(markdown="unpublished edit"))
        articles.create_article(s, content(title="never published"))

    result = export(repo)

    manifest = read(repo, "manifest.json")
    assert manifest["release_id"] == result.release_id
    assert result.versions == {doc_id: 2}
    assert result.commit == git(repo, "rev-parse", "HEAD").strip()
    assert manifest["schema_version"] == 1
    assert manifest["articles"] == [{"doc_id": doc_id, "version": 2}]
    assert manifest["archived_articles"] == []
    article = read(repo, f"articles/{doc_id}.json")
    assert (article["version"], article["markdown"], article["tags"]) == (2, "v2", [])
    assert sorted(p.name for p in (repo / "articles").iterdir()) == [f"{doc_id}.json"]
    assert git(repo, "log", "-1", "--format=%s").strip() == f"Release {result.release_id}"


def test_published_at_is_the_first_publication_date(repo):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, content()).article.doc_id
        first = articles.publish(s, doc_id, 1, content()).published_at
        articles.publish(s, doc_id, 2, content(markdown="edit"))

    export(repo)

    published_at = read(repo, f"articles/{doc_id}.json")["published_at"]
    assert published_at == first.isoformat().replace("+00:00", "Z")


def test_published_at_survives_retention_and_republishing(repo):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, content()).article.doc_id
        first = articles.publish(s, doc_id, 1, content()).published_at
        articles.publish(s, doc_id, 2, content(markdown="edit"))
        articles.archive(s, doc_id)
        articles.publish(s, doc_id, 3, content(markdown="republished"))
        s.execute(delete(PublishedVersion).where(PublishedVersion.version < 3))
        s.commit()

    export(repo)

    published_at = read(repo, f"articles/{doc_id}.json")["published_at"]
    assert published_at == first.isoformat().replace("+00:00", "Z")


def test_reexport_without_changes_makes_no_commit(repo):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, content()).article.doc_id
        articles.publish(s, doc_id, 1, content())

    assert export(repo) is not None
    assert export(repo) is None
    assert git(repo, "rev-list", "--count", "HEAD").strip() == "1"


def test_new_publish_produces_a_new_release_commit(repo):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, content()).article.doc_id
        articles.publish(s, doc_id, 1, content())
        first = export(repo)
        articles.publish(s, doc_id, 2, content(markdown="edit"))
    second = export(repo)

    assert second is not None and second.release_id != first.release_id
    assert git(repo, "rev-list", "--count", "HEAD").strip() == "2"
    assert read(repo, "manifest.json")["articles"] == [{"doc_id": doc_id, "version": 2}]


def test_export_leaves_other_files_in_the_repo_alone(repo):
    (repo / "README.md").write_text("content repo\n")
    with SessionLocal() as s:
        doc_id = articles.create_article(s, content()).article.doc_id
        articles.publish(s, doc_id, 1, content())

    export(repo)

    assert "README.md" not in git(repo, "ls-files")
    assert (repo / "README.md").read_text() == "content repo\n"


FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to run the frontend snapshot parser")
def test_frontend_parser_accepts_the_exported_snapshot(repo):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, content()).article.doc_id
        articles.publish(s, doc_id, 1, content(tags=[articles.Taxon("python", "Python")]))

    export(repo)

    result = subprocess.run(["node", "scripts/check-snapshot.ts", str(repo)], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ok: 1 published, 0 archived"
