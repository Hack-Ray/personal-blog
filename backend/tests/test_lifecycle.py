import json
import subprocess
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from blog import articles, maintenance
from blog.db import SessionLocal, engine
from blog.exporter import export
from blog.models import RetiredDocId

BACKEND = {"slug": "backend", "name": "Backend"}


def draft(**overrides):
    return {"title": "Hello", "topic": BACKEND, "tags": [], "markdown": "body", **overrides}


def create(client):
    return client.post("/api/articles", json=draft()).json()["doc_id"]


def published(client):
    doc_id = create(client)
    assert client.post(f"/api/articles/{doc_id}/publish", json=draft(base_revision=1)).status_code == 201
    return doc_id


def state(client, doc_id):
    return client.get(f"/api/articles/{doc_id}/draft").json()["state"]


def backdate_deletion(doc_id, days):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE articles SET deleted_at = now() - make_interval(days => :d) WHERE doc_id = :id"),
            {"d": days, "id": doc_id},
        )


def test_new_article_is_a_draft(client):
    assert state(client, create(client)) == "draft"


def test_archive_and_republish_keep_the_doc_id(client):
    doc_id = published(client)
    r = client.post(f"/api/articles/{doc_id}/archive")
    assert r.status_code == 200 and r.json()["state"] == "archived"

    again = client.post(f"/api/articles/{doc_id}/publish", json=draft(markdown="back", base_revision=2))
    assert again.status_code == 201
    assert (again.json()["doc_id"], again.json()["version"]) == (doc_id, 2)
    assert state(client, doc_id) == "published"


@pytest.mark.parametrize("make", [create, lambda c: c.post(f"/api/articles/{published(c)}/archive").json()["doc_id"]])
def test_only_published_articles_can_be_archived(client, make):
    doc_id = make(client)
    r = client.post(f"/api/articles/{doc_id}/archive")
    assert r.status_code == 409


def test_delete_moves_to_pending_deletion_for_30_days(client):
    doc_id = published(client)
    r = client.delete(f"/api/articles/{doc_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "pending_deletion"
    deleted_at = datetime.fromisoformat(body["deleted_at"])
    assert datetime.fromisoformat(body["purge_after"]) - deleted_at == timedelta(days=30)
    listed = client.get("/api/articles", params={"state": "pending_deletion"}).json()
    assert [a["doc_id"] for a in listed] == [doc_id]


def test_pending_deletion_blocks_editing_and_publishing(client):
    doc_id = published(client)
    client.delete(f"/api/articles/{doc_id}")
    assert client.put(f"/api/articles/{doc_id}/draft", json=draft(base_revision=2)).status_code == 409
    assert client.post(f"/api/articles/{doc_id}/publish", json=draft(base_revision=2)).status_code == 409
    assert client.post(f"/api/articles/{doc_id}/archive").status_code == 409


@pytest.mark.parametrize("before", ["draft", "published", "archived"])
def test_restore_returns_to_the_state_before_deletion(client, before):
    doc_id = create(client) if before == "draft" else published(client)
    if before == "archived":
        client.post(f"/api/articles/{doc_id}/archive")
    client.delete(f"/api/articles/{doc_id}")

    r = client.post(f"/api/articles/{doc_id}/restore")

    assert r.status_code == 200
    assert (r.json()["state"], r.json()["deleted_at"]) == (before, None)


def test_restore_requires_pending_deletion(client):
    assert client.post(f"/api/articles/{published(client)}/restore").status_code == 409


def test_purge_deletes_permanently_and_retires_the_doc_id(client):
    doc_id = published(client)
    assert client.post(f"/api/articles/{doc_id}/purge").status_code == 409
    client.delete(f"/api/articles/{doc_id}")

    assert client.post(f"/api/articles/{doc_id}/purge").status_code == 204

    assert client.get(f"/api/articles/{doc_id}/draft").status_code == 404
    with SessionLocal() as s:
        assert s.get(RetiredDocId, doc_id) is not None
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM published_versions")).scalar() == 0


def test_retired_doc_ids_are_never_reassigned(monkeypatch):
    with SessionLocal() as s:
        s.add(RetiredDocId(doc_id="01K7M4Y7P65BDCF8AHRTQY7ZQA"))
        s.commit()
        ids = iter(["01K7M4Y7P65BDCF8AHRTQY7ZQA", "01K7M4Y7P65BDCF8AHRTQY7ZQB"])
        monkeypatch.setattr(articles, "ULID", lambda: next(ids))
        created = articles.create_article(s, articles.DraftContent("t", articles.Taxon("backend", "Backend"), "m"))
        assert created.article.doc_id == "01K7M4Y7P65BDCF8AHRTQY7ZQB"


def test_purge_expired_removes_only_articles_past_30_days(client):
    old, recent = published(client), published(client)
    for doc_id in (old, recent):
        client.delete(f"/api/articles/{doc_id}")
    backdate_deletion(old, 31)
    backdate_deletion(recent, 29)

    with SessionLocal() as s:
        assert articles.purge_expired(s, datetime.now(UTC)) == [old]
        assert articles.purge_expired(s, datetime.now(UTC)) == []

    assert client.get(f"/api/articles/{old}/draft").status_code == 404
    assert state(client, recent) == "pending_deletion"


def test_maintenance_purges_expired_articles(client):
    doc_id = published(client)
    client.delete(f"/api/articles/{doc_id}")
    backdate_deletion(doc_id, 30)

    assert maintenance.run()
    assert client.get(f"/api/articles/{doc_id}/draft").status_code == 404


def test_maintenance_skips_while_another_run_holds_the_lock(client):
    doc_id = published(client)
    client.delete(f"/api/articles/{doc_id}")
    backdate_deletion(doc_id, 30)

    with engine.connect() as other:
        other.scalar(select(func.pg_advisory_lock(maintenance.LOCK_KEY)))
        assert not maintenance.run()
        assert state(client, doc_id) == "pending_deletion"
        other.scalar(select(func.pg_advisory_unlock(maintenance.LOCK_KEY)))
    assert maintenance.run()


def test_database_rejects_pending_deletion_without_deleted_at(client):
    doc_id = create(client)
    with pytest.raises(IntegrityError, match="articles_pending_deletion_fields"):
        with engine.begin() as conn:
            conn.execute(text("UPDATE articles SET state = 'pending_deletion' WHERE doc_id = :id"), {"id": doc_id})


def test_export_follows_lifecycle_state(client, tmp_path):
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True)
    for key, value in (("user.email", "t@example.com"), ("user.name", "T")):
        subprocess.run(["git", "-C", str(tmp_path), "config", key, value], check=True)
    live, gone, hidden = published(client), published(client), published(client)
    client.post(f"/api/articles/{gone}/archive")
    client.delete(f"/api/articles/{hidden}")

    export(tmp_path)

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert [a["doc_id"] for a in manifest["articles"]] == [live]
    assert manifest["archived_articles"] == [{"doc_id": gone}]
    assert sorted(p.stem for p in (tmp_path / "articles").iterdir()) == [live]
