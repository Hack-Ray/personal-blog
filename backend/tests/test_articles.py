import re
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from blog import articles
from blog.db import SessionLocal, engine

BACKEND = {"slug": "backend", "name": "Backend"}


def draft(**overrides):
    return {"title": "Hello", "topic": BACKEND, "tags": [], "markdown": "first", **overrides}


def create(client, **overrides):
    r = client.post("/api/articles", json=draft(**overrides))
    assert r.status_code == 201, r.text
    return r.json()


def test_create_assigns_a_ulid_doc_id_and_revision_1(client):
    body = create(client, tags=[{"slug": "python", "name": "Python"}])
    assert re.fullmatch(r"[0-7][0-9A-HJKMNP-TV-Z]{25}", body["doc_id"])
    assert body["revision"] == 1
    assert body["topic"] == BACKEND
    assert body["tags"] == [{"slug": "python", "name": "Python"}]


def test_saving_a_new_name_for_an_existing_slug_renames_it_everywhere(client):
    a = create(client, tags=[{"slug": "test", "name": "Old"}])
    b = create(client, tags=[{"slug": "test", "name": "Old"}])
    client.post(f"/api/articles/{a['doc_id']}/publish", json=draft(tags=[{"slug": "test", "name": "Old"}], base_revision=1))

    renamed = draft(topic={"slug": "backend", "name": "後端"}, tags=[{"slug": "test", "name": "測試"}], base_revision=1)
    assert client.put(f"/api/articles/{b['doc_id']}/draft", json=renamed).status_code == 200

    for doc_id in (a["doc_id"], b["doc_id"]):
        body = client.get(f"/api/articles/{doc_id}/draft").json()
        assert body["topic"] == {"slug": "backend", "name": "後端"}
        assert body["tags"] == [{"slug": "test", "name": "測試"}]


def test_topic_is_required_to_create_a_draft(client):
    r = client.post("/api/articles", json={"title": "x", "markdown": "y"})
    assert r.status_code == 422


def test_autosave_advances_the_revision(client):
    a = create(client)
    r = client.put(f"/api/articles/{a['doc_id']}/draft", json=draft(markdown="second", base_revision=1))
    assert r.status_code == 200
    assert r.json()["revision"] == 2
    assert client.get(f"/api/articles/{a['doc_id']}/draft").json()["markdown"] == "second"


def test_autosave_from_a_stale_revision_is_rejected(client):
    a = create(client)
    client.put(f"/api/articles/{a['doc_id']}/draft", json=draft(markdown="second", base_revision=1))
    r = client.put(f"/api/articles/{a['doc_id']}/draft", json=draft(markdown="stale", base_revision=1))
    assert r.status_code == 409
    assert r.json()["current_revision"] == 2
    assert client.get(f"/api/articles/{a['doc_id']}/draft").json()["markdown"] == "second"


def test_autosave_that_arrives_after_publish_does_not_overwrite_it(client):
    """Baseline section 13: Auto Save starts at 14:00:00, Publish at 14:00:01,
    and the Auto Save request lands at 14:00:03."""
    a = create(client)
    published = client.post(f"/api/articles/{a['doc_id']}/publish", json=draft(markdown="what I saw", base_revision=1))
    assert published.status_code == 201
    late = client.put(f"/api/articles/{a['doc_id']}/draft", json=draft(markdown="older keystrokes", base_revision=1))
    assert late.status_code == 409
    assert client.get(f"/api/articles/{a['doc_id']}/draft").json()["markdown"] == "what I saw"


def test_publish_numbers_versions_per_article(client):
    a = create(client)
    v1 = client.post(f"/api/articles/{a['doc_id']}/publish", json=draft(base_revision=1)).json()
    v2 = client.post(f"/api/articles/{a['doc_id']}/publish", json=draft(markdown="edit", base_revision=v1["revision"])).json()
    b = create(client)
    other = client.post(f"/api/articles/{b['doc_id']}/publish", json=draft(base_revision=1)).json()
    assert (v1["version"], v2["version"], other["version"]) == (1, 2, 1)
    assert v2["revision"] == 3


def test_publish_requires_title_and_markdown(client):
    a = create(client)
    r = client.post(f"/api/articles/{a['doc_id']}/publish", json=draft(title=" ", base_revision=1))
    assert r.status_code == 422
    assert client.get(f"/api/articles/{a['doc_id']}/draft").json()["revision"] == 1


def test_unknown_article_is_404(client):
    assert client.get("/api/articles/01K7M4Y7P65BDCF8AHRTQY7ZQF/draft").status_code == 404


def test_published_versions_reject_update(client):
    a = create(client)
    client.post(f"/api/articles/{a['doc_id']}/publish", json=draft(base_revision=1))
    with pytest.raises(DBAPIError, match="published_versions rows are immutable"):
        with engine.begin() as conn:
            conn.execute(text("UPDATE published_versions SET markdown = 'rewritten'"))


def test_concurrent_publishes_from_one_revision_produce_one_version(client):
    a = create(client)
    start = Barrier(2)
    content = articles.DraftContent(title="t", topic=articles.Taxon("backend", "Backend"), markdown="m")

    def attempt(_):
        with SessionLocal() as session:
            start.wait()
            try:
                return articles.publish(session, a["doc_id"], 1, content).version
            except articles.RevisionConflict as e:
                return f"conflict@{e.current_revision}"

    with ThreadPoolExecutor(2) as pool:
        results = sorted(map(str, pool.map(attempt, range(2))))
    assert results == ["1", "conflict@2"]
