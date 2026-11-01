import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import delete

from blog import articles
from blog.db import SessionLocal
from blog.models import PublishedVersion

BACKEND = articles.Taxon("backend", "Backend")


def draft(**overrides):
    return articles.DraftContent(**{"title": "Hello", "topic": BACKEND, "markdown": "body", **overrides})


def test_exports_latest_published_version_and_skips_drafts(content):
    with SessionLocal() as s:
        a = articles.create_article(s, draft(markdown="v1"))
        doc_id = a.article.doc_id
        articles.publish(s, doc_id, 1, draft(markdown="v1", tags=[articles.Taxon("python", "Python")]))
        articles.publish(s, doc_id, 2, draft(markdown="v2"))
        articles.save_draft(s, doc_id, 3, draft(markdown="unpublished edit"))
        articles.create_article(s, draft(title="never published"))

    result = content.release()

    manifest = content.json("manifest.json")
    assert manifest["release_id"] == result.id
    assert result.content_commit == content.api.head()
    assert manifest["schema_version"] == 1
    assert manifest["articles"] == [{"doc_id": doc_id, "version": 2}]
    assert manifest["archived_articles"] == []
    article = content.json(f"articles/{doc_id}.json")
    assert (article["version"], article["markdown"], article["tags"]) == (2, "v2", [])
    assert [f for f in content.files() if f.startswith("articles/")] == [f"articles/{doc_id}.json"]


def test_published_at_is_the_first_publication_date(content):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, draft()).article.doc_id
        first = articles.publish(s, doc_id, 1, draft()).published_at
        articles.publish(s, doc_id, 2, draft(markdown="edit"))

    content.release()

    published_at = content.json(f"articles/{doc_id}.json")["published_at"]
    assert published_at == first.isoformat().replace("+00:00", "Z")


def test_published_at_survives_retention_and_republishing(content):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, draft()).article.doc_id
        first = articles.publish(s, doc_id, 1, draft()).published_at
        articles.publish(s, doc_id, 2, draft(markdown="edit"))
        articles.archive(s, doc_id)
        articles.publish(s, doc_id, 3, draft(markdown="republished"))
        s.execute(delete(PublishedVersion).where(PublishedVersion.version < 3))
        s.commit()

    content.release()

    published_at = content.json(f"articles/{doc_id}.json")["published_at"]
    assert published_at == first.isoformat().replace("+00:00", "Z")


def test_reexport_without_changes_makes_no_commit(content):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, draft()).article.doc_id
        articles.publish(s, doc_id, 1, draft())

    first = content.release()
    assert first is not None
    assert content.release() is None
    assert content.api.head() == first.content_commit


def test_new_publish_produces_a_new_release_commit(content):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, draft()).article.doc_id
        articles.publish(s, doc_id, 1, draft())
        first = content.release()
        articles.publish(s, doc_id, 2, draft(markdown="edit"))
    second = content.release()

    assert second is not None and second.id != first.id
    assert second.content_parent == first.content_commit
    assert content.json("manifest.json")["articles"] == [{"doc_id": doc_id, "version": 2}]


def test_export_leaves_other_files_in_the_repo_alone(content):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, draft()).article.doc_id
        articles.publish(s, doc_id, 1, draft())

    content.release()

    assert content.read("README.md") == "keep me"


FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to run the frontend snapshot parser")
def test_frontend_parser_accepts_the_exported_snapshot(content, tmp_path):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, draft()).article.doc_id
        articles.publish(s, doc_id, 1, draft(tags=[articles.Taxon("python", "Python")]))

    content.release()

    result = subprocess.run(["node", "scripts/check-snapshot.ts", str(content.checkout(tmp_path / "snapshot"))], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ok: 1 published, 0 archived"
