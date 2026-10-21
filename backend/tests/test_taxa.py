import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from blog.db import engine

BACKEND = {"slug": "backend", "name": "Backend"}


def draft(**overrides):
    return {"title": "Hello", "topic": BACKEND, "tags": [], "markdown": "body", **overrides}


def create(client, **overrides):
    r = client.post("/api/articles", json=draft(**overrides))
    assert r.status_code == 201, r.text
    return r.json()["doc_id"]


def publish(client, doc_id, revision, **overrides):
    r = client.post(f"/api/articles/{doc_id}/publish", json={"base_revision": revision, **draft(**overrides)})
    assert r.status_code == 201, r.text


def usage(client, kind):
    return {t["slug"]: (t["name"], t["articles"], t["in_use"]) for t in client.get("/api/taxa").json()[kind]}


def tag(slug):
    return {"slug": slug, "name": slug.title()}


def test_lists_each_kind_with_live_article_counts(client):
    create(client, tags=[tag("go"), tag("python")], series={"slug": "s", "name": "S"})
    create(client, tags=[tag("go")])
    gone = create(client, tags=[tag("rust")])
    client.delete(f"/api/articles/{gone}")
    body = client.get("/api/taxa").json()
    assert set(body) == {"topics", "tags", "series"}
    assert usage(client, "topics") == {"backend": ("Backend", 2, True)}
    assert usage(client, "tags") == {"go": ("Go", 2, True), "python": ("Python", 1, True), "rust": ("Rust", 0, True)}
    assert usage(client, "series") == {"s": ("S", 1, True)}


def test_rename_changes_the_name_everywhere(client):
    doc_id = create(client)
    assert client.put("/api/taxa/topics/backend", json={"name": " 後端 "}).status_code == 204
    assert client.get(f"/api/articles/{doc_id}/draft").json()["topic"] == {"slug": "backend", "name": "後端"}


def test_rename_or_merge_of_an_unknown_taxon_is_404(client):
    assert client.put("/api/taxa/tags/nope", json={"name": "x"}).status_code == 404
    create(client)
    assert client.post("/api/taxa/topics/backend/merge", json={"into": "nope"}).status_code == 404
    assert client.put("/api/taxa/colors/x", json={"name": "x"}).status_code == 422


def test_merging_topics_repoints_drafts_and_published_versions(client):
    a = create(client)
    publish(client, a, 1)
    b = create(client, topic={"slug": "back-end", "name": "Back End"})
    publish(client, b, 1, topic={"slug": "back-end", "name": "Back End"})
    assert client.post("/api/taxa/topics/back-end/merge", json={"into": "backend"}).status_code == 204
    assert usage(client, "topics") == {"backend": ("Backend", 2, True)}
    assert client.get(f"/api/articles/{b}/draft").json()["topic"] == BACKEND
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(DISTINCT topic_id) FROM published_versions")).scalar_one() == 1


def test_merging_tags_keeps_one_reference_per_draft_and_version(client):
    a = create(client, tags=[tag("js"), tag("javascript")])
    publish(client, a, 1, tags=[tag("js"), tag("javascript")])
    b = create(client, tags=[tag("js")])
    publish(client, b, 1, tags=[tag("js")])
    assert client.post("/api/taxa/tags/js/merge", json={"into": "javascript"}).status_code == 204
    assert usage(client, "tags") == {"javascript": ("Javascript", 2, True)}
    for doc_id in (a, b):
        assert client.get(f"/api/articles/{doc_id}/draft").json()["tags"] == [tag("javascript")]
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT published_version_id, tag_id FROM published_version_tags")).all()
    assert len(rows) == 2 and len({t for _, t in rows}) == 1


def test_merging_into_itself_is_rejected(client):
    create(client)
    assert client.post("/api/taxa/topics/backend/merge", json={"into": "backend"}).status_code == 422


def test_only_unused_taxa_can_be_deleted(client):
    doc_id = create(client, tags=[tag("go")])
    publish(client, doc_id, 1, tags=[tag("go")])
    client.put(f"/api/articles/{doc_id}/draft", json={"base_revision": 2, **draft()})
    # The draft dropped the tag but the published version still uses it.
    assert usage(client, "tags") == {"go": ("Go", 0, True)}
    assert client.delete("/api/taxa/tags/go").status_code == 409
    create(client, tags=[tag("unused")])
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM working_draft_tags WHERE tag_id = (SELECT id FROM tags WHERE slug = 'unused')"))
    assert client.delete("/api/taxa/tags/unused").status_code == 204
    assert "unused" not in usage(client, "tags")


def test_published_versions_still_reject_content_updates(client):
    doc_id = create(client)
    publish(client, doc_id, 1)
    with pytest.raises(DBAPIError, match="immutable"), engine.begin() as conn:
        conn.execute(text("UPDATE published_versions SET markdown = 'changed'"))
    with pytest.raises(DBAPIError, match="immutable"), engine.begin() as conn:
        conn.execute(text("UPDATE published_versions SET topic_id = topic_id, title = 'changed'"))
